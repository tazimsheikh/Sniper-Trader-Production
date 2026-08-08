/**
 * 🎲 Monte Carlo Robustness Validator
 * Resamples daily P&L streams with replacement (bootstrapping)
 * to evaluate portfolio drawdown distributions and ruin probability.
 */

export interface MonteCarloResult {
  medianReturn: number;
  pct5Return: number;
  pct95MaxDrawdown: number;
  probabilityOfRuin: number; // Probability of exceeding maxAllowedDrawdown
  passed: boolean;
}

export function validateMonteCarlo(
  dailyReturns: number[],
  numSimulations: number = 10000,
  maxAllowedDrawdown: number = 15.0,
  maxRuinProbThreshold: number = 0.05
): MonteCarloResult {
  if (!dailyReturns || dailyReturns.length === 0) {
    return {
      medianReturn: 0,
      pct5Return: 0,
      pct95MaxDrawdown: 0,
      probabilityOfRuin: 1.0,
      passed: false,
    };
  }

  const n = dailyReturns.length;
  const terminalReturns: number[] = [];
  const maxDrawdowns: number[] = [];
  let ruinCount = 0;

  for (let sim = 0; sim < numSimulations; sim++) {
    let cumReturn = 0;
    let peak = 0;
    let maxDd = 0;

    for (let day = 0; day < n; day++) {
      // Bootstrap resample with replacement
      const randomIdx = Math.floor(Math.random() * n);
      const ret = dailyReturns[randomIdx];
      cumReturn += ret;

      if (cumReturn > peak) {
        peak = cumReturn;
      }
      const dd = peak - cumReturn;
      if (dd > maxDd) {
        maxDd = dd;
      }
    }

    terminalReturns.push(cumReturn);
    maxDrawdowns.push(maxDd);

    if (maxDd > maxAllowedDrawdown) {
      ruinCount++;
    }
  }

  // Sort results for percentiles
  terminalReturns.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const medianReturn = terminalReturns[Math.floor(numSimulations * 0.5)];
  const pct5Return = terminalReturns[Math.floor(numSimulations * 0.05)];
  const pct95MaxDrawdown = maxDrawdowns[Math.floor(numSimulations * 0.95)];
  const probabilityOfRuin = ruinCount / numSimulations;
  const passed = probabilityOfRuin <= maxRuinProbThreshold;

  return {
    medianReturn,
    pct5Return,
    pct95MaxDrawdown,
    probabilityOfRuin,
    passed,
  };
}
