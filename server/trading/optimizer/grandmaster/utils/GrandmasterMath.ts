import { IndependentSynthesisComponent } from "../GrandmasterMetrics.js";

export function calculateCorrelation(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): number {
  if (x.length !== y.length || x.length === 0) return 0;
  const n = x.length;
  let sumX = 0,
    sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0,
    denX = 0,
    denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  return num / Math.sqrt(denX * denY) || 0;
}

export function calculatePearsonCorrelation(arr1: number[] | Float64Array, arr2: number[] | Float64Array): number {
  const n = arr1.length;
  let sum1 = 0, sum2 = 0, sum1Sq = 0, sum2Sq = 0, pSum = 0;
  for (let i = 0; i < n; i++) {
    const a = arr1[i];
    const b = arr2[i];
    sum1 += a;
    sum2 += b;
    sum1Sq += a * a;
    sum2Sq += b * b;
    pSum += a * b;
  }
  const num = pSum - (sum1 * sum2) / n;
  const den = Math.sqrt(Math.max(0, sum1Sq - (sum1 * sum1) / n) * Math.max(0, sum2Sq - (sum2 * sum2) / n));
  return den === 0 ? 0 : num / den;
}

export function rankPercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  let low = 0,
    high = sortedValues.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (sortedValues[mid] <= value) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return low / sortedValues.length;
}

export function runMonteCarlo(trades: number[], iterations: number): number {
  const drawdowns: number[] = new Array(iterations);
  const n = trades.length;
  const tempArray = new Float64Array(n);

  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < n; j++) {
      const randomIndex = Math.floor(Math.random() * n);
      tempArray[j] = trades[randomIndex];
    }
    let totalR = 0;
    let peakR = 0;
    let maxDrawdownR = 0;
    for (let j = 0; j < n; j++) {
      totalR += tempArray[j];
      if (totalR > peakR) peakR = totalR;
      const currentDrawdown = peakR - totalR;
      if (currentDrawdown > maxDrawdownR) maxDrawdownR = currentDrawdown;
    }
    drawdowns[i] = maxDrawdownR;
  }
  drawdowns.sort((a, b) => a - b);
  const index99 = Math.floor(iterations * 0.99);
  return drawdowns[index99];
}

export function admitAllWithCorrelationPenalty(
  pool: IndependentSynthesisComponent[],
  globalDates: string[],
  maxPerSymbolAndSession = 1,
  bannedSessions?: Set<string>,
  previouslySelected: IndependentSynthesisComponent[] = []
): IndependentSynthesisComponent[] {
  const candidates = [...pool].sort((a, b) => b.hedgeScore - a.hedgeScore);
  const selected: IndependentSynthesisComponent[] = [];
  const symbolSessionCounts: Record<string, number> = {};
  const seenSetups = new Set<string>();

  for (const cand of candidates) {
    const parts = cand.setup.split("_");
    let session = parts[0];
    if (parts[0] === "NY") session = `NY_${parts[1]}`;

    const setupKey = `${cand.symbol}_${cand.botType}_${cand.setup}`;
    if (seenSetups.has(setupKey)) continue;

    const key = `${cand.symbol}_${cand.botType}_${session}`;
    const currentCount = symbolSessionCounts[key] || 0;

    if (currentCount >= maxPerSymbolAndSession) continue;

    let maxPairwiseCorr = 0;
    if (cand.periodReturns && cand.periodReturns.length > 10) {
      for (const sel of [...previouslySelected, ...selected]) {
        if (sel.periodReturns && sel.periodReturns.length > 10) {
          const corr = Math.abs(calculatePearsonCorrelation(cand.periodReturns, sel.periodReturns));
          if (corr > maxPairwiseCorr) maxPairwiseCorr = corr;
        }
      }
    }
    (cand as any).correlationTax = Math.max(0.2, 1.0 - maxPairwiseCorr);

    selected.push(cand);
    seenSetups.add(setupKey);
    symbolSessionCounts[key] = currentCount + 1;
  }

  return selected;
}

export function computeMasterRiskSizing(
    portfolio: IndependentSynthesisComponent[], 
    globalDates: string[],
    targetMcDd: number = 1.0,
    maxRiskPct: number = 0.10
) {
  if (portfolio.length === 0) return { masterMcDrawdown99: 0, globalRiskPct: 1.0 };

  for (let i = 0; i < portfolio.length; i++) {
    let totalCorr = 0;
    let count = 0;
    for (let j = 0; j < portfolio.length; j++) {
      if (i !== j && portfolio[i].periodReturns && portfolio[j].periodReturns) {
        const len = Math.min(portfolio[i].periodReturns.length, portfolio[j].periodReturns.length);
        if (len > 10) {
          const corr = Math.max(0, calculatePearsonCorrelation(
            portfolio[i].periodReturns.slice(0, len),
            portfolio[j].periodReturns.slice(0, len)
          ));
          totalCorr += corr;
          count++;
        }
      }
    }
    const avgCorr = count > 0 ? totalCorr / count : 0;
    portfolio[i].covPenalty = Math.max(0.1, 1.0 - avgCorr);
  }

  const safetyScores = portfolio.map(p => {
    const baseSafety = 1.0 / Math.max(0.1, p.monteCarloDrawdown99 || p.maxDrawdown || 0.1);
    const regime = p.regimeRatio ?? 1.0;
    const dsrFactor = p.dsrProb ?? 0.5;
    const corrTax = (p as any).correlationTax ?? 1.0;
    const sampleSizeFactor = Math.min(1.0, Math.sqrt(p.totalTrades / 30));
    return { p, score: baseSafety * regime * (0.3 + 0.7 * dsrFactor) * corrTax * sampleSizeFactor };
  });

  let maxScore = 0;
  for (const item of safetyScores) {
    if (item.score > maxScore) maxScore = item.score;
  }

  for (const item of safetyScores) {
    item.p.riskPct = maxScore > 0 ? item.score / maxScore : 1.0;
  }

  const masterDailyReturns = new Float64Array(globalDates.length);
  for (let i = 0; i < globalDates.length; i++) {
    let dailySum = 0;
    for (const p of portfolio) {
      dailySum += (p.dailyReturns[globalDates[i]] || 0) * (p.riskPct || 1.0);
    }
    masterDailyReturns[i] = dailySum;
  }

  const masterReturnsArray = Array.from(masterDailyReturns);
  const masterMcDrawdown99 = runMonteCarlo(masterReturnsArray, 10000);
  const globalRiskPct = masterMcDrawdown99 > targetMcDd ? targetMcDd / masterMcDrawdown99 : 1.0;

  for (const p of portfolio) {
    p.riskPct = (p.riskPct || 1.0) * globalRiskPct;
    if (maxRiskPct > 0) {
        p.riskPct = Math.min(p.riskPct, maxRiskPct);
    }
  }

  return { masterMcDrawdown99: masterMcDrawdown99 * globalRiskPct, globalRiskPct };
}
