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

/**
 * Calculates calendar-synchronized Pearson correlation between two daily returns maps.
 * Evaluates identical calendar dates across globalDates.
 */
export function calculateDailyCalendarCorrelation(
  returns1: Record<string, number> | undefined,
  returns2: Record<string, number> | undefined,
  dates: string[]
): number {
  if (!returns1 || !returns2 || dates.length === 0) return 0;
  const n = dates.length;
  let sum1 = 0, sum2 = 0, sum1Sq = 0, sum2Sq = 0, pSum = 0;
  let activeDays = 0;

  for (let i = 0; i < n; i++) {
    const d = dates[i];
    const r1 = returns1[d] || 0;
    const r2 = returns2[d] || 0;
    sum1 += r1;
    sum2 += r2;
    sum1Sq += r1 * r1;
    sum2Sq += r2 * r2;
    pSum += r1 * r2;
    if (r1 !== 0 || r2 !== 0) activeDays++;
  }

  if (activeDays < 5) return 0; // Independent / decorrelated if active co-occurrence is negligible

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

export function hashStringToSeed(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createMulberry32(seed: number = 0x1337BEEF): () => number {
  let s = seed >>> 0;
  return function (): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runMonteCarlo(trades: number[], iterations: number = 10000, seed: number = 0x1337BEEF): number {
  if (!trades || trades.length === 0) return 0;
  const drawdowns: number[] = new Array(iterations);
  const n = trades.length;
  const tempArray = new Float64Array(n);
  const rng = createMulberry32(seed);

  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < n; j++) {
      const randomIndex = Math.floor(rng() * n);
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
  return drawdowns[index99] || 0;
}

export interface HedgingUnit {
  unitId: string;
  type: "SELF_PAIR" | "CROSS_PAIR" | "SINGLETON" | "TRI_PAIR" | "CROSS_TRI";
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
    type: "SELF_PAIR" | "CROSS_PAIR" | "SINGLETON" | "TRI_PAIR" | "CROSS_TRI",
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
    } else if (comps.length === 3 && corr !== undefined) {
      if (corr <= 0.25) {
        // High synergy bonus for 3-unit uncorrelated hedge
        combinedHedgeScore *= (1.0 + 0.85 * (1.0 - corr));
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

  const compareDeterministically = (a: IndependentSynthesisComponent, b: IndependentSynthesisComponent) =>
    (b.hedgeScore - a.hedgeScore) ||
    (a.symbol || "").localeCompare(b.symbol || "") ||
    (a.setup || "").localeCompare(b.setup || "");

  const magePool = pool.filter(c => c.botType === "Mage").sort(compareDeterministically);
  const sagePool = pool.filter(c => c.botType === "Sage").sort(compareDeterministically);
  const seerPool = pool.filter(c => c.botType === "Seer").sort(compareDeterministically);

  const symbols = Array.from(new Set(pool.map(c => c.symbol))).sort();

  // PASS 1: Same-Symbol Tri-Hedge (3 units: Mage Breakout + Sage Reversal + Seer Liquidity Hunt)
  for (const sym of symbols) {
    const symMages = magePool.filter(c => c.symbol === sym && !usedSetups.has(getSetupKey(c)));
    const symSages = sagePool.filter(c => c.symbol === sym && !usedSetups.has(getSetupKey(c)));
    const symSeers = seerPool.filter(c => c.symbol === sym && !usedSetups.has(getSetupKey(c)));

    if (symMages.length > 0 && symSages.length > 0 && symSeers.length > 0) {
      let bestTriad: [IndependentSynthesisComponent, IndependentSynthesisComponent, IndependentSynthesisComponent] | null = null;
      let bestMaxCorr = Infinity;
      let bestAvgCorr = 0;
      let bestScore = -Infinity;

      for (const m of symMages.slice(0, 5)) {
        for (const s of symSages.slice(0, 5)) {
          const c_ms = calculateDailyCalendarCorrelation(m.dailyReturns, s.dailyReturns, globalDates);
          if (c_ms > 0.40) continue;

          for (const e of symSeers.slice(0, 5)) {
            const c_me = calculateDailyCalendarCorrelation(m.dailyReturns, e.dailyReturns, globalDates);
            const c_se = calculateDailyCalendarCorrelation(s.dailyReturns, e.dailyReturns, globalDates);
            const maxCorr = Math.max(c_ms, c_me, c_se);

            if (maxCorr <= 0.35) {
              const combinedR = m.totalTotalR + s.totalTotalR + e.totalTotalR;
              const avgCorr = (c_ms + c_me + c_se) / 3;
              const corrWeight = avgCorr <= 0.1 ? 1.8 : (avgCorr <= 0.25 ? 1.4 : 1.1);
              const score = combinedR * corrWeight;

              if (score > bestScore) {
                bestScore = score;
                bestMaxCorr = maxCorr;
                bestAvgCorr = avgCorr;
                bestTriad = [m, s, e];
              }
            }
          }
        }
      }

      if (bestTriad) {
        units.push(makeUnit(`${sym}_TRI_HEDGE`, "TRI_PAIR", bestTriad, bestAvgCorr));
      }
    }
  }

  // PASS 2: Same-Symbol Dual-Hedges (2 units: Mage+Sage, Mage+Seer, or Sage+Seer)
  for (const sym of symbols) {
    const symMages = magePool.filter(c => c.symbol === sym && !usedSetups.has(getSetupKey(c)));
    const symSages = sagePool.filter(c => c.symbol === sym && !usedSetups.has(getSetupKey(c)));
    const symSeers = seerPool.filter(c => c.symbol === sym && !usedSetups.has(getSetupKey(c)));

    const pairTypes: Array<{ poolA: IndependentSynthesisComponent[]; poolB: IndependentSynthesisComponent[]; label: string }> = [
      { poolA: symMages, poolB: symSages, label: "MAGE_SAGE" },
      { poolA: symMages, poolB: symSeers, label: "MAGE_SEER" },
      { poolA: symSages, poolB: symSeers, label: "SAGE_SEER" }
    ];

    for (const pt of pairTypes) {
      const availA = pt.poolA.filter(c => !usedSetups.has(getSetupKey(c)));
      const availB = pt.poolB.filter(c => !usedSetups.has(getSetupKey(c)));

      if (availA.length > 0 && availB.length > 0) {
        let bestPair: [IndependentSynthesisComponent, IndependentSynthesisComponent] | null = null;
        let bestCorr = Infinity;
        let bestScore = -Infinity;

        for (const a of availA.slice(0, 6)) {
          for (const b of availB.slice(0, 6)) {
            const corr = calculateDailyCalendarCorrelation(a.dailyReturns, b.dailyReturns, globalDates);
            const combinedR = a.totalTotalR + b.totalTotalR;
            const corrWeight = corr <= 0.1 ? 1.5 : (corr <= 0.3 ? 1.2 : 0.9);
            const score = combinedR * corrWeight;

            if (corr <= 0.35 && score > bestScore) {
              bestScore = score;
              bestCorr = corr;
              bestPair = [a, b];
            }
          }
        }

        if (bestPair) {
          units.push(makeUnit(`${sym}_${pt.label}_SELF_HEDGE`, "SELF_PAIR", bestPair, bestCorr));
        }
      }
    }
  }

  // PASS 3: Cross-Asset Synthetic Tri-Hedges (3 units: 1 Mage + 1 Sage + 1 Seer across different symbols)
  const remMage = pool.filter(c => c.botType === "Mage" && !usedSetups.has(getSetupKey(c))).sort(compareDeterministically);
  const remSage = pool.filter(c => c.botType === "Sage" && !usedSetups.has(getSetupKey(c))).sort(compareDeterministically);
  const remSeer = pool.filter(c => c.botType === "Seer" && !usedSetups.has(getSetupKey(c))).sort(compareDeterministically);

  for (const m of remMage) {
    if (usedSetups.has(getSetupKey(m))) continue;
    let bestTriad: [IndependentSynthesisComponent, IndependentSynthesisComponent, IndependentSynthesisComponent] | null = null;
    let bestAvgCorr = 0;
    let bestScore = -Infinity;

    for (const s of remSage) {
      if (usedSetups.has(getSetupKey(s)) || s.symbol === m.symbol) continue;
      const c_ms = calculateDailyCalendarCorrelation(m.dailyReturns, s.dailyReturns, globalDates);
      if (c_ms > 0.35) continue;

      for (const e of remSeer) {
        if (usedSetups.has(getSetupKey(e)) || e.symbol === m.symbol || e.symbol === s.symbol) continue;
        const c_me = calculateDailyCalendarCorrelation(m.dailyReturns, e.dailyReturns, globalDates);
        const c_se = calculateDailyCalendarCorrelation(s.dailyReturns, e.dailyReturns, globalDates);
        const maxCorr = Math.max(c_ms, c_me, c_se);

        if (maxCorr <= 0.35) {
          const combinedR = m.totalTotalR + s.totalTotalR + e.totalTotalR;
          const avgCorr = (c_ms + c_me + c_se) / 3;
          const score = combinedR * (1.0 - avgCorr);

          if (score > bestScore) {
            bestScore = score;
            bestAvgCorr = avgCorr;
            bestTriad = [m, s, e];
          }
        }
      }
    }

    if (bestTriad) {
      units.push(makeUnit(`${bestTriad[0].symbol}_${bestTriad[1].symbol}_${bestTriad[2].symbol}_CROSS_TRI`, "CROSS_TRI", bestTriad, bestAvgCorr));
    }
  }

  // PASS 4: Cross-Asset Synthetic Residual Dual-Hedges (2 units across different symbols)
  const remPairs = [
    { poolA: pool.filter(c => c.botType === "Mage" && !usedSetups.has(getSetupKey(c))), poolB: pool.filter(c => c.botType === "Sage" && !usedSetups.has(getSetupKey(c))) },
    { poolA: pool.filter(c => c.botType === "Mage" && !usedSetups.has(getSetupKey(c))), poolB: pool.filter(c => c.botType === "Seer" && !usedSetups.has(getSetupKey(c))) },
    { poolA: pool.filter(c => c.botType === "Sage" && !usedSetups.has(getSetupKey(c))), poolB: pool.filter(c => c.botType === "Seer" && !usedSetups.has(getSetupKey(c))) },
  ];

  for (const group of remPairs) {
    const listA = group.poolA.sort(compareDeterministically);
    const listB = group.poolB.sort(compareDeterministically);

    for (const candA of listA) {
      if (usedSetups.has(getSetupKey(candA))) continue;
      const groupA = getMacroGroup(candA.symbol);

      let bestPartner: IndependentSynthesisComponent | null = null;
      let bestPartnerCorr = Infinity;

      for (const candB of listB) {
        if (usedSetups.has(getSetupKey(candB)) || candB.symbol === candA.symbol) continue;
        const groupB = getMacroGroup(candB.symbol);

        const corr = calculateDailyCalendarCorrelation(candA.dailyReturns, candB.dailyReturns, globalDates);
        const isSameGroup = (groupA === groupB && groupA !== "OTHER");
        const effectiveCorr = isSameGroup ? corr - 0.15 : corr;

        if (effectiveCorr < bestPartnerCorr && corr <= 0.35) {
          bestPartnerCorr = effectiveCorr;
          bestPartner = candB;
        }
      }

      if (bestPartner) {
        const trueCorr = calculateDailyCalendarCorrelation(candA.dailyReturns, bestPartner.dailyReturns, globalDates);
        units.push(makeUnit(`${candA.symbol}_${bestPartner.symbol}_CROSS_HEDGE`, "CROSS_PAIR", [candA, bestPartner], trueCorr));
      }
    }
  }

  // PASS 5: Elite Singletons (Remaining high-quality standalone alphas)
  const remainingPool = pool.filter(c => !usedSetups.has(getSetupKey(c))).sort(compareDeterministically);
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

  // Organic Adaptive Threshold: Calculate the 35th percentile of HedgeScores across candidate units
  // to weed out low-scoring units while admitting a deep, diversified bench of hedged units.
  const sortedScores = candidates.map(u => u.combinedHedgeScore).sort((a, b) => a - b);
  console.log(`[DEBUG] sortedScores: length=${sortedScores.length}, min=${sortedScores[0]}, max=${sortedScores[sortedScores.length-1]}`);
  let adaptiveFloor = 0.0001;
  if (sortedScores.length > 0) {
    const percentile35Idx = Math.floor(sortedScores.length * 0.35);
    adaptiveFloor = Math.max(0.0001, sortedScores[percentile35Idx] * 0.25);
  }
  
  const QUALITY_THRESHOLD = adaptiveFloor; 
  console.log(`[DEBUG] QUALITY_THRESHOLD = ${QUALITY_THRESHOLD}`);

  while (selected.length < maxTotalUnits && totalCompCount < maxComponents) {
    let bestUnit: HedgingUnit | null = null;
    let bestScore = QUALITY_THRESHOLD; // Replaced 0.005 with adaptive quality threshold

    for (const unit of candidates) {
      if (selected.some(s => s.unitId === unit.unitId)) continue;
      if (totalCompCount + unit.components.length > maxComponents) continue;

      let maxPairwiseCorr = 0;
      for (const sel of selected) {
        const corr = Math.abs(calculateDailyCalendarCorrelation(unit.combinedDailyReturns, sel.combinedDailyReturns, globalDates));
        if (corr > maxPairwiseCorr) maxPairwiseCorr = corr;
      }

      const correlationTax = Math.max(0.15, 1.0 - maxPairwiseCorr);
      const effectiveScore = unit.combinedHedgeScore * correlationTax;

      if (effectiveScore > bestScore || (bestUnit === null && effectiveScore >= bestScore)) {
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
      if (i !== j) {
        const corr = Math.max(0, calculateDailyCalendarCorrelation(
          portfolio[i].dailyReturns,
          portfolio[j].dailyReturns,
          globalDates
        ));
        totalCorr += corr;
        count++;
      }
    }
    const avgCorr = count > 0 ? totalCorr / count : 0;
    portfolio[i].covPenalty = Math.max(0.1, 1.0 - avgCorr);
  }

  // Calculate average portfolio trade expectancy
  let totalPortfolioR = 0;
  let totalPortfolioTrades = 0;
  for (const p of portfolio) {
    const r = p.threeYearNetR !== undefined ? p.threeYearNetR : (p.totalTotalR || 0);
    const tr = p.threeYearTrades || p.totalTrades || 1;
    totalPortfolioR += r;
    totalPortfolioTrades += tr;
  }
  const meanPortfolioExpectancy = totalPortfolioTrades > 0 ? Math.max(0.05, totalPortfolioR / totalPortfolioTrades) : 0.15;

  const safetyScores = portfolio.map(p => {
    const effectiveDd = Math.max(2.0, p.threeYearMaxDrawdown || p.monteCarloDrawdown99 || p.maxDrawdown || 2.0);
    const baseSafety = 1.0 / Math.sqrt(effectiveDd);

    // Expectancy factor: reward alphas with superior per-trade edge
    const r = p.threeYearNetR !== undefined ? p.threeYearNetR : (p.totalTotalR || 0);
    const tradesCount = p.threeYearTrades || p.totalTrades || 1;
    const compExpectancy = tradesCount > 0 ? r / tradesCount : 0;
    const expectancyFactor = Math.max(0.40, Math.min(2.50, compExpectancy / meanPortfolioExpectancy));

    // Calmar / MAR factor: reward setups with high return relative to historical drawdown
    const calmarVal = effectiveDd > 0 ? r / effectiveDd : 1.0;
    const calmarFactor = Math.max(0.50, Math.min(2.50, calmarVal / 1.50));

    const regime = Math.max(0.7, Math.min(1.3, p.regimeRatio ?? 1.0));
    const dsrFactor = p.dsrProb ?? 0.5;
    const corrTax = (p as any).correlationTax ?? 1.0;
    const sampleSizeFactor = Math.max(0.6, Math.min(1.0, Math.sqrt(tradesCount / 50)));

    const score = baseSafety * expectancyFactor * calmarFactor * regime * (0.5 + 0.5 * dsrFactor) * corrTax * sampleSizeFactor;
    return { p, score };
  });

  const totalScore = safetyScores.reduce((sum, item) => sum + item.score, 0);
  const avgScore = totalScore > 0 ? (totalScore / portfolio.length) : 1.0;

  for (const item of safetyScores) {
    const rawWeight = avgScore > 0 ? (item.score / avgScore) : 1.0;
    // Bound each asset multiplier between 0.50x (cautious) and 1.80x (champion anchor)
    item.p.riskPct = Math.max(0.50, Math.min(1.80, rawWeight));
  }

  const masterDailyReturns = new Float64Array(globalDates.length);

  // FIX 11: Enforce Scaled Portfolio Max DD (99% MC) ≤ targetMcDd (default 1.0R).
  // The targetMcDd parameter was previously accepted but never enforced. We now
  // iteratively scale all riskPct values down via a global multiplier until the
  // portfolio-level MC DD satisfies the hard cap. Binary search converges in ≤ 20 steps.
  const buildMasterReturns = (globalMultiplier: number): number[] => {
    for (let i = 0; i < globalDates.length; i++) {
      let dailySum = 0;
      for (const p of portfolio) {
        dailySum += (p.dailyReturns[globalDates[i]] || 0) * (p.riskPct || 1.0) * globalMultiplier;
      }
      masterDailyReturns[i] = dailySum;
    }
    return Array.from(masterDailyReturns);
  };

  // First check at full scale (globalMultiplier = 1.0)
  let currentMcDd = runMonteCarlo(buildMasterReturns(1.0), 10000, 0xCAFEBABE);
  let globalMultiplier = 1.0;

  if (currentMcDd > targetMcDd && targetMcDd > 0) {
    // Binary search: find largest globalMultiplier where MC DD ≤ targetMcDd
    let lo = 0.001;
    let hi = 1.0;
    for (let iter = 0; iter < 20; iter++) {
      const mid = (lo + hi) / 2;
      const midDd = runMonteCarlo(buildMasterReturns(mid), 10000, 0xCAFEBABE);
      if (midDd <= targetMcDd) {
        lo = mid;    // Can afford more
        currentMcDd = midDd;
        globalMultiplier = mid;
      } else {
        hi = mid;    // Too aggressive, scale down
      }
    }
    // Apply the found globalMultiplier to all component riskPct values permanently
    for (const p of portfolio) {
      p.riskPct = (p.riskPct || 1.0) * globalMultiplier;
    }
    console.log(`[MC DD CAP] 🎯 Applied global scale factor ${globalMultiplier.toFixed(4)}x to enforce ≤ ${targetMcDd}R MC DD (actual: ${currentMcDd.toFixed(3)}R)`);
  }

  const masterMcDrawdown99 = currentMcDd;

  // FIX 4: Return the actual computed globalRiskPct instead of hardcoded 1.0
  return { masterMcDrawdown99, globalRiskPct: globalMultiplier };
}
