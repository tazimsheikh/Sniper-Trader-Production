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

export interface HedgingUnit {
  unitId: string;
  type: "SELF_PAIR" | "CROSS_PAIR" | "SINGLETON";
  components: IndependentSynthesisComponent[];
  combinedHedgeScore: number;
  combinedDailyReturns: Record<string, number>;
  periodReturns: number[];
  pairwiseCorrelation?: number;
}

const MACRO_GROUPS: Record<string, string[]> = {
  YEN_CROSS: ["USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "CHFJPY"],
  EUROPE_USD_FX: ["EURUSD", "GBPUSD", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "EURCAD", "GBPCAD", "GBPAUD", "GBPNZD", "EURAUD", "EURNZD"],
  EQUITY_INDICES: ["GER40", "US30", "NAS100", "SPX500", "JPN225"],
  COMMODITIES: ["XAUUSD", "XTIUSD", "ETHUSD"]
};

function getMacroGroup(symbol: string): string {
  for (const [grp, syms] of Object.entries(MACRO_GROUPS)) {
    if (syms.includes(symbol)) return grp;
  }
  return "OTHER";
}

export function buildHedgingUnits(
  pool: IndependentSynthesisComponent[],
  globalDates: string[]
): HedgingUnit[] {
  const units: HedgingUnit[] = [];
  const usedSetups = new Set<string>();

  const getSetupKey = (c: IndependentSynthesisComponent) => `${c.symbol}_${c.botType}_${c.setup}`;

  // Helper to combine component daily returns into a unified unit
  const makeUnit = (
    unitId: string,
    type: "SELF_PAIR" | "CROSS_PAIR" | "SINGLETON",
    comps: IndependentSynthesisComponent[],
    corr?: number
  ): HedgingUnit => {
    const combinedDailyReturns: Record<string, number> = {};
    const periodReturns: number[] = [];

    for (const d of globalDates) {
      let dayR = 0;
      for (const c of comps) {
        dayR += (c.dailyReturns && c.dailyReturns[d]) || 0;
      }
      combinedDailyReturns[d] = dayR;
      periodReturns.push(dayR);
    }

    let totalScore = 0;
    for (const c of comps) totalScore += c.hedgeScore || 0;
    let combinedHedgeScore = totalScore / comps.length;

    // Apply natural hedging synergy bonus for low/negative correlation
    if (comps.length === 2 && corr !== undefined) {
      if (corr <= 0.20) {
        combinedHedgeScore *= (1.0 + 0.60 * (1.0 - corr));
      }
    }

    for (const c of comps) {
      (c as any).unitId = unitId;
      (c as any).unitType = type;
      usedSetups.add(getSetupKey(c));
    }

    return {
      unitId,
      type,
      components: comps,
      combinedHedgeScore,
      combinedDailyReturns,
      periodReturns,
      pairwiseCorrelation: corr
    };
  };

  // PASS 1: Direct Self-Hedging (Same Symbol, Opposite Strategy: Mage Breakout + Sage Reversal)
  const magePool = pool.filter(c => c.botType === "Mage").sort((a, b) => b.hedgeScore - a.hedgeScore);
  const sagePool = pool.filter(c => c.botType === "Sage").sort((a, b) => b.hedgeScore - a.hedgeScore);

  const symbols = Array.from(new Set(pool.map(c => c.symbol)));

  for (const sym of symbols) {
    const symMages = magePool.filter(c => c.symbol === sym && !usedSetups.has(getSetupKey(c)));
    const symSages = sagePool.filter(c => c.symbol === sym && !usedSetups.has(getSetupKey(c)));

    if (symMages.length > 0 && symSages.length > 0) {
      let bestPair: [IndependentSynthesisComponent, IndependentSynthesisComponent] | null = null;
      let bestCorr = Infinity;
      let bestScore = -Infinity;

      for (const m of symMages) {
        for (const s of symSages) {
          let corr = 0;
          if (m.periodReturns && s.periodReturns && m.periodReturns.length > 10 && s.periodReturns.length > 10) {
            const len = Math.min(m.periodReturns.length, s.periodReturns.length);
            corr = calculatePearsonCorrelation(m.periodReturns.slice(0, len), s.periodReturns.slice(0, len));
          }
          const combinedR = m.totalTotalR + s.totalTotalR;
          const corrWeight = corr <= 0.1 ? 1.5 : (corr <= 0.3 ? 1.2 : 0.9);
          const score = combinedR * corrWeight;

          if (corr <= 0.35 && score > bestScore) {
            bestScore = score;
            bestCorr = corr;
            bestPair = [m, s];
          }
        }
      }

      if (bestPair) {
        units.push(makeUnit(`${sym}_SELF_HEDGE`, "SELF_PAIR", bestPair, bestCorr));
      }
    }
  }

  // PASS 2: Cross-Asset Synthetic Residual Hedging (Leftover Mage + Leftover Sage)
  const remainingMage = pool.filter(c => c.botType === "Mage" && !usedSetups.has(getSetupKey(c))).sort((a, b) => b.hedgeScore - a.hedgeScore);
  const remainingSage = pool.filter(c => c.botType === "Sage" && !usedSetups.has(getSetupKey(c))).sort((a, b) => b.hedgeScore - a.hedgeScore);

  for (const mageCand of remainingMage) {
    if (usedSetups.has(getSetupKey(mageCand))) continue;
    const mageGroup = getMacroGroup(mageCand.symbol);

    let bestSagePartner: IndependentSynthesisComponent | null = null;
    let bestPartnerCorr = Infinity;

    for (const sageCand of remainingSage) {
      if (usedSetups.has(getSetupKey(sageCand))) continue;
      const sageGroup = getMacroGroup(sageCand.symbol);

      if (mageCand.periodReturns && sageCand.periodReturns && mageCand.periodReturns.length > 10 && sageCand.periodReturns.length > 10) {
        const len = Math.min(mageCand.periodReturns.length, sageCand.periodReturns.length);
        const corr = calculatePearsonCorrelation(mageCand.periodReturns.slice(0, len), sageCand.periodReturns.slice(0, len));

        // Prioritize same macro group or low/negative correlation
        const isSameGroup = (mageGroup === sageGroup && mageGroup !== "OTHER");
        const effectiveCorr = isSameGroup ? corr - 0.15 : corr;

        if (effectiveCorr < bestPartnerCorr && corr <= 0.25) {
          bestPartnerCorr = effectiveCorr;
          bestSagePartner = sageCand;
        }
      }
    }

    if (bestSagePartner) {
      let trueCorr = 0;
      const len = Math.min(mageCand.periodReturns.length, bestSagePartner.periodReturns.length);
      trueCorr = calculatePearsonCorrelation(mageCand.periodReturns.slice(0, len), bestSagePartner.periodReturns.slice(0, len));

      units.push(makeUnit(`${mageCand.symbol}_${bestSagePartner.symbol}_CROSS_HEDGE`, "CROSS_PAIR", [mageCand, bestSagePartner], trueCorr));
    }
  }

  // PASS 3: Elite Singletons (Remaining high-quality standalone alphas)
  const remainingPool = pool.filter(c => !usedSetups.has(getSetupKey(c))).sort((a, b) => b.hedgeScore - a.hedgeScore);
  for (const c of remainingPool) {
    units.push(makeUnit(`${c.symbol}_${c.botType}_SINGLE`, "SINGLETON", [c]));
  }

  return units;
}

export function admitHedgingUnitsWithCorrelationPenalty(
  units: HedgingUnit[],
  globalDates: string[],
  maxTotalUnits = 100,
  maxComponents = 100
): HedgingUnit[] {
  const candidates = [...units];
  const selected: HedgingUnit[] = [];
  let totalCompCount = 0;

  while (selected.length < maxTotalUnits && totalCompCount < maxComponents) {
    let bestUnit: HedgingUnit | null = null;
    let bestScore = 0.05; // Quality threshold: Only admit units that add net positive value

    for (const unit of candidates) {
      if (selected.some(s => s.unitId === unit.unitId)) continue;
      if (totalCompCount + unit.components.length > maxComponents) continue;

      let maxPairwiseCorr = 0;
      if (unit.periodReturns && unit.periodReturns.length > 10) {
        for (const sel of selected) {
          if (sel.periodReturns && sel.periodReturns.length > 10) {
            const len = Math.min(unit.periodReturns.length, sel.periodReturns.length);
            const corr = Math.abs(calculatePearsonCorrelation(unit.periodReturns.slice(0, len), sel.periodReturns.slice(0, len)));
            if (corr > maxPairwiseCorr) maxPairwiseCorr = corr;
          }
        }
      }

      const correlationTax = Math.max(0.2, 1.0 - maxPairwiseCorr);
      const effectiveScore = unit.combinedHedgeScore * correlationTax;

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestUnit = unit;
      }
    }

    if (!bestUnit) break;

    selected.push(bestUnit);
    totalCompCount += bestUnit.components.length;
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
    const effectiveDd = Math.max(2.0, p.threeYearMaxDrawdown || p.monteCarloDrawdown99 || p.maxDrawdown || 2.0);
    const baseSafety = 1.0 / Math.sqrt(effectiveDd);
    const regime = Math.max(0.7, Math.min(1.3, p.regimeRatio ?? 1.0));
    const dsrFactor = p.dsrProb ?? 0.5;
    const corrTax = (p as any).correlationTax ?? 1.0;
    const tradesCount = p.threeYearTrades || p.totalTrades || 1;
    const sampleSizeFactor = Math.max(0.6, Math.min(1.0, Math.sqrt(tradesCount / 50)));
    return { p, score: baseSafety * regime * (0.5 + 0.5 * dsrFactor) * corrTax * sampleSizeFactor };
  });

  const totalScore = safetyScores.reduce((sum, item) => sum + item.score, 0);

  // Dynamic bounds adaptive to any portfolio size N:
  const baseWeight = 1.0 / portfolio.length;
  const minWeight = baseWeight * 0.25;
  const maxWeight = baseWeight * 3.50;

  for (const item of safetyScores) {
    const rawWeight = totalScore > 0 ? item.score / totalScore : baseWeight;
    item.p.riskPct = Math.max(minWeight, Math.min(maxWeight, rawWeight));
  }

  const finalWeightSum = portfolio.reduce((sum, p) => sum + (p.riskPct || 0), 0);
  for (const p of portfolio) {
    if (finalWeightSum > 0) {
      p.riskPct = (p.riskPct || 0) / finalWeightSum;
    }
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
    p.riskPct = (p.riskPct || 0) * globalRiskPct;
  }

  const scaledMasterReturns = masterReturnsArray.map(r => r * globalRiskPct);
  const scaledMasterMcDd99 = runMonteCarlo(scaledMasterReturns, 10000);

  return { masterMcDrawdown99: scaledMasterMcDd99, globalRiskPct };
}
