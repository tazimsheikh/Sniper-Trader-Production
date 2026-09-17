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
  EUROPE_USD_FX: ["EURUSD", "GBPUSD", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "EURCAD", "GBPCAD", "GBPAUD", "EURAUD"],
  EQUITY_INDICES: ["GER40", "US30", "NAS100"],
  COMMODITIES: ["XAUUSD"]
};

export function getMacroGroup(symbol: string): string {
  const norm = symbol.replace(/\.daily$/i, "").toUpperCase();
  for (const [grp, syms] of Object.entries(MACRO_GROUPS)) {
    if (syms.includes(norm)) return grp;
  }
  return "OTHER";
}

/**
 * Builds candidate hedging units across tri-bot alphas (Mage + Sage + Seer)
 * Creates TRI_PAIR, SELF_PAIR, CROSS_TRI, CROSS_PAIR, and SINGLETON units.
 */
export function buildNextGenHedgingUnits(
  pool: IndependentSynthesisComponent[],
  globalDates: string[]
): HedgingUnit[] {
  const units: HedgingUnit[] = [];
  const getSetupKey = (c: IndependentSynthesisComponent) => `${c.symbol}_${c.botType}_${c.setup}`;

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

    // Hedging synergy multiplier: reward lower / negative correlation
    if (comps.length === 2 && corr !== undefined) {
      if (corr <= 0.15) {
        combinedHedgeScore *= (1.0 + 0.65 * (1.0 - corr));
      }
    } else if (comps.length === 3 && corr !== undefined) {
      if (corr <= 0.25) {
        combinedHedgeScore *= (1.0 + 0.90 * (1.0 - corr));
      }
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

  // PASS 1: Same-Symbol Tri-Hedges (Mage + Sage + Seer)
  for (const sym of symbols) {
    const symMages = magePool.filter(c => c.symbol === sym);
    const symSages = sagePool.filter(c => c.symbol === sym);
    const symSeers = seerPool.filter(c => c.symbol === sym);

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

  // PASS 2: Same-Symbol Dual-Hedges (Mage+Sage, Mage+Seer, Sage+Seer)
  for (const sym of symbols) {
    const symMages = magePool.filter(c => c.symbol === sym);
    const symSages = sagePool.filter(c => c.symbol === sym);
    const symSeers = seerPool.filter(c => c.symbol === sym);

    const pairTypes: Array<{ poolA: IndependentSynthesisComponent[]; poolB: IndependentSynthesisComponent[]; label: string }> = [
      { poolA: symMages, poolB: symSages, label: "MAGE_SAGE" },
      { poolA: symMages, poolB: symSeers, label: "MAGE_SEER" },
      { poolA: symSages, poolB: symSeers, label: "SAGE_SEER" }
    ];

    for (const pt of pairTypes) {
      if (pt.poolA.length > 0 && pt.poolB.length > 0) {
        for (const a of pt.poolA.slice(0, 3)) {
          for (const b of pt.poolB.slice(0, 3)) {
            const corr = calculateDailyCalendarCorrelation(a.dailyReturns, b.dailyReturns, globalDates);
            if (corr <= 0.45) {
              const sigA = a.setup.substring(0, 12).replace(/[^a-zA-Z0-9]/g, "");
              const sigB = b.setup.substring(0, 12).replace(/[^a-zA-Z0-9]/g, "");
              units.push(makeUnit(`${sym}_${pt.label}_SELF_HEDGE_${sigA}_${sigB}`, "SELF_PAIR", [a, b], corr));
            }
          }
        }
      }
    }
  }

  // PASS 3: Cross-Pair Macro Tri-Hedges
  for (const [groupName, groupSymbols] of Object.entries(MACRO_GROUPS)) {
    const groupMages = magePool.filter(c => groupSymbols.includes(c.symbol.replace(/\.daily$/i, "")));
    const groupSages = sagePool.filter(c => groupSymbols.includes(c.symbol.replace(/\.daily$/i, "")));
    const groupSeers = seerPool.filter(c => groupSymbols.includes(c.symbol.replace(/\.daily$/i, "")));

    if (groupMages.length > 0 && groupSages.length > 0 && groupSeers.length > 0) {
      let bestCrossTri: [IndependentSynthesisComponent, IndependentSynthesisComponent, IndependentSynthesisComponent] | null = null;
      let bestScore = -Infinity;
      let bestAvgCorr = 0;

      for (const m of groupMages.slice(0, 3)) {
        for (const s of groupSages.slice(0, 3)) {
          if (m.symbol === s.symbol) continue;
          const c_ms = calculateDailyCalendarCorrelation(m.dailyReturns, s.dailyReturns, globalDates);
          if (c_ms > 0.35) continue;

          for (const e of groupSeers.slice(0, 3)) {
            if (e.symbol === m.symbol || e.symbol === s.symbol) continue;
            const c_me = calculateDailyCalendarCorrelation(m.dailyReturns, e.dailyReturns, globalDates);
            const c_se = calculateDailyCalendarCorrelation(s.dailyReturns, e.dailyReturns, globalDates);
            const maxCorr = Math.max(c_ms, c_me, c_se);

            if (maxCorr <= 0.30) {
              const combinedR = m.totalTotalR + s.totalTotalR + e.totalTotalR;
              const avgCorr = (c_ms + c_me + c_se) / 3;
              const score = combinedR * (1.0 - avgCorr);

              if (score > bestScore) {
                bestScore = score;
                bestAvgCorr = avgCorr;
                bestCrossTri = [m, s, e];
              }
            }
          }
        }
      }

      if (bestCrossTri) {
        units.push(makeUnit(`${groupName}_CROSS_TRI_HEDGE`, "CROSS_TRI", bestCrossTri, bestAvgCorr));
      }
    }
  }

  // PASS 4: Cross-Pair Macro Dual-Hedges
  for (const [groupName, groupSymbols] of Object.entries(MACRO_GROUPS)) {
    const groupAvailable = pool.filter(c => groupSymbols.includes(c.symbol.replace(/\.daily$/i, ""))).sort(compareDeterministically);
    if (groupAvailable.length >= 2) {
      for (let i = 0; i < groupAvailable.length; i++) {
        const candA = groupAvailable[i];

        for (let j = i + 1; j < groupAvailable.length; j++) {
          const candB = groupAvailable[j];
          if (candA.symbol === candB.symbol && candA.botType === candB.botType) continue;

          const corr = calculateDailyCalendarCorrelation(candA.dailyReturns, candB.dailyReturns, globalDates);
          if (corr < 0.25) {
            const sigA = candA.setup.substring(0, 10).replace(/[^a-zA-Z0-9]/g, "");
            const sigB = candB.setup.substring(0, 10).replace(/[^a-zA-Z0-9]/g, "");
            units.push(makeUnit(`${candA.symbol}_${candA.botType}_${candB.symbol}_${candB.botType}_CROSS_${sigA}_${sigB}`, "CROSS_PAIR", [candA, candB], corr));
          }
        }
      }
    }
  }

  // PASS 5: Standalone Singletons (All candidate alphas in the pool)
  const remainingPool = [...pool].sort(compareDeterministically);
  for (const c of remainingPool) {
    units.push(makeUnit(`${c.symbol}_${c.botType}_SINGLE`, "SINGLETON", [c]));
  }

  return units;
}

export const buildHedgingUnits = buildNextGenHedgingUnits;

interface PortfolioCurveMetrics {
  totalR: number;
  maxDrawdownR: number;
  sharpeRatio: number;
  marRatio: number;
  utilityScore: number;
}

function evaluatePortfolioCurve(dailyReturns: Float64Array): PortfolioCurveMetrics {
  const n = dailyReturns.length;
  let totalR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let sumDaily = 0;
  let sumDailySq = 0;
  let activeDays = 0;

  for (let i = 0; i < n; i++) {
    const val = dailyReturns[i];
    totalR += val;
    if (totalR > peakR) peakR = totalR;
    const dd = peakR - totalR;
    if (dd > maxDrawdownR) maxDrawdownR = dd;

    if (val !== 0) {
      sumDaily += val;
      sumDailySq += val * val;
      activeDays++;
    }
  }

  const effectiveDd = Math.max(0.5, maxDrawdownR);
  const marRatio = totalR / effectiveDd;

  let sharpeRatio = 0;
  if (activeDays > 10) {
    const mean = sumDaily / n;
    const variance = Math.max(0, (sumDailySq / n) - (mean * mean));
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0.00001) {
      sharpeRatio = (mean / stdDev) * Math.sqrt(252);
    }
  }

  // Utility function: Combines Sharpe and log-MAR
  const utilityScore = sharpeRatio * Math.log(1.0 + Math.max(0, marRatio));

  return {
    totalR,
    maxDrawdownR,
    sharpeRatio,
    marRatio,
    utilityScore
  };
}

/**
 * Marginal Portfolio Utility Forward Selection (Option B: Pure Meritocracy)
 * Iteratively admits candidate units that strictly improve portfolio Sharpe & MAR,
 * or add positive expected return without increasing portfolio drawdown.
 */
export function selectUnitsByMarginalUtility(
  units: HedgingUnit[],
  globalDates: string[],
  maxTotalUnits: number = 35,
  maxTotalComponents: number = 50
): HedgingUnit[] {
  if (units.length === 0) return [];

  const selected: HedgingUnit[] = [];
  const selectedSetupKeys = new Set<string>();
  let totalComponents = 0;

  const getSetupKey = (c: IndependentSynthesisComponent) => `${c.symbol}_${c.botType}_${c.setup}`;
  const nDates = globalDates.length;
  const currentPortfolioReturns = new Float64Array(nDates);
  const testReturns = new Float64Array(nDates);

  const admitUnit = (unit: HedgingUnit, reason: string): PortfolioCurveMetrics => {
    selected.push(unit);
    totalComponents += unit.components.length;
    for (const c of unit.components) {
      selectedSetupKeys.add(getSetupKey(c));
      (c as any).unitId = unit.unitId;
      (c as any).unitType = unit.type;
    }
    for (let i = 0; i < nDates; i++) {
      currentPortfolioReturns[i] += (unit.combinedDailyReturns[globalDates[i]] || 0);
    }
    const metrics = evaluatePortfolioCurve(currentPortfolioReturns);
    console.log(`  ➕ Admitted [${selected.length.toString().padStart(2, ' ')}]: ${unit.unitId.padEnd(42)} (${unit.type.padEnd(10)}) [${reason.padEnd(14)}] -> Portfolio: +${metrics.totalR.toFixed(1)}R, MaxDD=${metrics.maxDrawdownR.toFixed(2)}R, Sharpe=${metrics.sharpeRatio.toFixed(2)}, MAR=${metrics.marRatio.toFixed(2)}`);
    return metrics;
  };

  // STAGE 1: Tri-Bot Hedges (Mage + Sage + Seer)
  const triUnits = units.filter(u => u.type === "TRI_PAIR" || u.type === "CROSS_TRI").sort((a, b) => b.combinedHedgeScore - a.combinedHedgeScore);
  for (const u of triUnits) {
    if (totalComponents + u.components.length > maxTotalComponents) break;
    const hasOverlap = u.components.some(c => selectedSetupKeys.has(getSetupKey(c)));
    if (hasOverlap) continue;
    admitUnit(u, "TRI_HEDGE");
  }

  // STAGE 2: Self-Pair Orthogonal Hedges (Mage + Sage on same asset)
  // Structural diversification: combine trend breakouts with liquidity sweeps on the same pair
  const selfUnits = units.filter(u => u.type === "SELF_PAIR").sort((a, b) => b.combinedHedgeScore - a.combinedHedgeScore);
  for (const u of selfUnits) {
    if (totalComponents + u.components.length > 26 || totalComponents + u.components.length > maxTotalComponents) break;
    const hasOverlap = u.components.some(c => selectedSetupKeys.has(getSetupKey(c)));
    if (hasOverlap) continue;
    admitUnit(u, "SELF_HEDGE");
  }

  let currentMetrics = evaluatePortfolioCurve(currentPortfolioReturns);

  // If no self-pairs or tri-pairs admitted, seed with top overall unit
  if (selected.length === 0) {
    const sorted = [...units].sort((a, b) => b.combinedHedgeScore - a.combinedHedgeScore);
    currentMetrics = admitUnit(sorted[0], "SEED");
  }

  // STAGE 3: Greedy Marginal Utility Forward Selection for Cross-Pairs & Singletons
  const remainingUnits = units
    .filter(u => !selected.some(s => s.unitId === u.unitId))
    .sort((a, b) => b.combinedHedgeScore - a.combinedHedgeScore);

  while (selected.length < maxTotalUnits && totalComponents < maxTotalComponents) {
    let bestCandidate: HedgingUnit | null = null;
    let bestCandidateUtility = -Infinity;
    let bestCandidateMetrics = currentMetrics;

    for (const unit of remainingUnits) {
      if (selected.some(s => s.unitId === unit.unitId)) continue;
      if (totalComponents + unit.components.length > maxTotalComponents) continue;
      const hasOverlap = unit.components.some(c => selectedSetupKeys.has(getSetupKey(c)));
      if (hasOverlap) continue;

      for (let i = 0; i < nDates; i++) {
        testReturns[i] = currentPortfolioReturns[i] + (unit.combinedDailyReturns[globalDates[i]] || 0);
      }
      const simMetrics = evaluatePortfolioCurve(testReturns);
      const rAdded = simMetrics.totalR - currentMetrics.totalR;
      const ddChange = simMetrics.maxDrawdownR - currentMetrics.maxDrawdownR;
      const sharpeChange = simMetrics.sharpeRatio - currentMetrics.sharpeRatio;
      const marChange = simMetrics.marRatio - currentMetrics.marRatio;

      if (rAdded <= 0) continue;

      const isFavorable = (
        sharpeChange >= -0.08 &&
        (marChange >= -0.15 || (ddChange <= 0) || (ddChange > 0 && rAdded / ddChange >= 1.8))
      );

      if (isFavorable && simMetrics.utilityScore > bestCandidateUtility) {
        bestCandidateUtility = simMetrics.utilityScore;
        bestCandidate = unit;
        bestCandidateMetrics = simMetrics;
      }
    }

    if (!bestCandidate) {
      console.log(`[NextGen Synthesizer] 💡 Marginal utility plateau reached at ${selected.length} units.`);
      break;
    }

    currentMetrics = admitUnit(bestCandidate, "MARGINAL_UTILITY");
  }

  // STAGE 4: Multi-Strategy Balance Guarantee (ensure >= 25% Mage components)
  const currentMages = selected.flatMap(u => u.components).filter(c => c.botType === "Mage").length;
  const mageRatio = currentMages / Math.max(1, totalComponents);
  if (mageRatio < 0.25 && totalComponents < maxTotalComponents) {
    console.log(`[NextGen Synthesizer] ⚖️ Enforcing multi-strategy balance (Mage: ${(mageRatio * 100).toFixed(1)}% < 25%)...`);
    const mageSingletons = units.filter(u => u.type === "SINGLETON" && u.components[0].botType === "Mage")
      .sort((a, b) => b.combinedHedgeScore - a.combinedHedgeScore);

    for (const u of mageSingletons) {
      if (totalComponents + u.components.length > maxTotalComponents) break;
      const hasOverlap = u.components.some(c => selectedSetupKeys.has(getSetupKey(c)));
      if (hasOverlap) continue;
      currentMetrics = admitUnit(u, "MAGE_BALANCE");
    }
  }

  // Fill any remaining slots up to maxTotalComponents with best available singletons
  if (totalComponents < maxTotalComponents) {
    const fillerSingletons = units.filter(u => u.type === "SINGLETON")
      .sort((a, b) => b.combinedHedgeScore - a.combinedHedgeScore);

    for (const u of fillerSingletons) {
      if (totalComponents + u.components.length > maxTotalComponents) break;
      const hasOverlap = u.components.some(c => selectedSetupKeys.has(getSetupKey(c)));
      if (hasOverlap) continue;
      currentMetrics = admitUnit(u, "FILL_CAPACITY");
    }
  }

  return selected;
}

export const admitHedgingUnitsWithCorrelationPenalty = selectUnitsByMarginalUtility;

/**
 * Institutional Monte Carlo Risk Sizing (Option A: Target MC DD = 6.0R)
 * Strictly bounds individual component risk between 0.8% and 2.5%
 */
export function computeNextGenMasterRiskSizing(
  portfolio: IndependentSynthesisComponent[],
  globalDates: string[],
  targetMcDd: number = 6.0,
  minRiskPct: number = 0.008,
  maxRiskPct: number = 0.025
): { masterMcDrawdown99: number; globalRiskPct: number; averageComponentRiskPct: number } {
  if (portfolio.length === 0) {
    return { masterMcDrawdown99: 0, globalRiskPct: 1.0, averageComponentRiskPct: minRiskPct };
  }

  // 1. Calculate covariance penalty per component
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

  // 2. Expectancy and safety weighting
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

    const r = p.threeYearNetR !== undefined ? p.threeYearNetR : (p.totalTotalR || 0);
    const tradesCount = p.threeYearTrades || p.totalTrades || 1;
    const compExpectancy = tradesCount > 0 ? r / tradesCount : 0;
    const expectancyFactor = Math.max(0.60, Math.min(2.00, compExpectancy / meanPortfolioExpectancy));

    const calmarVal = effectiveDd > 0 ? r / effectiveDd : 1.0;
    const calmarFactor = Math.max(0.60, Math.min(2.00, calmarVal / 1.50));

    const regime = Math.max(0.8, Math.min(1.2, p.regimeRatio ?? 1.0));
    const sampleSizeFactor = Math.max(0.7, Math.min(1.0, Math.sqrt(tradesCount / 40)));

    const score = baseSafety * expectancyFactor * calmarFactor * regime * sampleSizeFactor;
    return { p, score };
  });

  const totalScore = safetyScores.reduce((sum, item) => sum + item.score, 0);
  const avgScore = totalScore > 0 ? (totalScore / portfolio.length) : 1.0;

  // Base raw risk multiplier around 1.25% (0.0125)
  for (const item of safetyScores) {
    const relativeWeight = avgScore > 0 ? (item.score / avgScore) : 1.0;
    item.p.riskPct = 0.0125 * relativeWeight;
  }

  // 3. Monte Carlo Scaling to targetMcDd (6.0R)
  const masterDailyReturns = new Float64Array(globalDates.length);
  const buildMasterReturns = (multiplier: number): number[] => {
    for (let i = 0; i < globalDates.length; i++) {
      let dailySum = 0;
      for (const p of portfolio) {
        dailySum += (p.dailyReturns[globalDates[i]] || 0) * (p.riskPct || 0.01) * multiplier;
      }
      masterDailyReturns[i] = dailySum;
    }
    return Array.from(masterDailyReturns);
  };

  let currentMcDd = runMonteCarlo(buildMasterReturns(1.0), 10000, 0xCAFEBABE);
  let globalMultiplier = 1.0;

  if (currentMcDd > targetMcDd && targetMcDd > 0) {
    let lo = 0.1;
    let hi = 3.0;
    for (let iter = 0; iter < 20; iter++) {
      const mid = (lo + hi) / 2;
      const midDd = runMonteCarlo(buildMasterReturns(mid), 10000, 0xCAFEBABE);
      if (midDd <= targetMcDd) {
        lo = mid;
        currentMcDd = midDd;
        globalMultiplier = mid;
      } else {
        hi = mid;
      }
    }
  } else if (currentMcDd < targetMcDd * 0.75 && targetMcDd > 0) {
    globalMultiplier = Math.min(2.0, targetMcDd / Math.max(1.0, currentMcDd));
  }

  // Enforce strict risk bounds: minRiskPct (0.8%) to maxRiskPct (2.5%)
  let sumFinalRisk = 0;
  for (const p of portfolio) {
    let scaledRisk = (p.riskPct || 0.01) * globalMultiplier;
    scaledRisk = Math.max(minRiskPct, Math.min(maxRiskPct, scaledRisk));
    p.riskPct = scaledRisk;
    sumFinalRisk += scaledRisk;
  }

  const finalMcDd = runMonteCarlo(buildMasterReturns(1.0), 10000, 0xCAFEBABE);
  const avgRisk = sumFinalRisk / portfolio.length;

  console.log(`[NextGen Sizing] 🎯 Global Risk Multiplier: ${globalMultiplier.toFixed(3)}x | Avg Component Risk: ${(avgRisk * 100).toFixed(2)}% | 99% MC DD: ${finalMcDd.toFixed(2)}R (Target: ${targetMcDd}R)`);

  return {
    masterMcDrawdown99: finalMcDd,
    globalRiskPct: globalMultiplier,
    averageComponentRiskPct: avgRisk
  };
}

export const computeMasterRiskSizing = computeNextGenMasterRiskSizing;
