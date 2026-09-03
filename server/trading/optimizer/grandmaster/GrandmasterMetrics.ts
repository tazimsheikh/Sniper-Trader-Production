import { GrandmasterOptimizerState, IndependentSynthesisComponent } from "../../config/types.js";
import { DailyContextTracker } from "../../market/DailyContextTracker.js";
export type { IndependentSynthesisComponent };

const MIN_TRADES = 3;
const MAX_DRAWDOWN = 70;
const BLACK_SWAN_MAX_DD = 10.0;
const BLACK_SWAN_MIN_TRADES = 30;

function rankPercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  let low = 0,
    high = sortedValues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sortedValues[mid] < value) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return low / sortedValues.length;
}

function getISOWeek(dateStr: string): string {
  const date = new Date(dateStr);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function evaluateComponent(
  state: GrandmasterOptimizerState & { dailyRArray: Float64Array },
  symbol: string,
  botType: "Mage" | "Sage" | "Seer",
  globalDates: string[],
  hydrate = false,
): IndependentSynthesisComponent | null {
  const arr = state.dailyRArray;
  const n = globalDates.length;

  let totalR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;

  let tradesCount =
    typeof (state as any).trades === "number"
      ? (state as any).trades
      : Object.keys(state.dailyNetR || {}).length;

  // Absolute floor: 3 trades minimum to ensure basic mathematical signal.
  // Continuous sampleSizeFactor discounts low-sample configs proportionally.
  if (tradesCount < 3) return null;

  let periodLength = 0;
  let negativeLength = 0;
  let winningTrades = 0;
  let recentTwoMonthR = 0;
  let recentThreeMonthR = 0;
  let recentMomentumR = 0;
  const recentSixMonthsNetRByMonth: Record<string, number> = {};
  
  let cutoff2MonthDateStr = "1970-01-01";
  let cutoffDateStr = "1970-01-01";
  let cutoff3MonthDateStr = "1970-01-01";
  let cutoff1YearDateStr = "1970-01-01";
  let THREE_YEARS_AGO = "1970-01-01";
  let targetMonthStr = "-00-";
  let lastDate: Date | null = null;
  
  if (n > 0) {
    lastDate = new Date(globalDates[n - 1]);
    const cutoff2MonthDate = new Date(lastDate.getTime() - 60 * 24 * 60 * 60 * 1000);
    cutoff2MonthDateStr = cutoff2MonthDate.toISOString().split("T")[0];

    const cutoff3MonthDate = new Date(lastDate.getTime() - 90 * 24 * 60 * 60 * 1000);
    cutoff3MonthDateStr = cutoff3MonthDate.toISOString().split("T")[0];

    const cutoffDate = new Date(lastDate.getTime() - 180 * 24 * 60 * 60 * 1000);
    cutoffDateStr = cutoffDate.toISOString().split("T")[0];

    const cutoff1YearDate = new Date(lastDate.getTime() - 365.25 * 24 * 60 * 60 * 1000);
    cutoff1YearDateStr = cutoff1YearDate.toISOString().split("T")[0];
    
    const threeYearsAgoDate = new Date(lastDate.getTime() - 3 * 365.25 * 24 * 60 * 60 * 1000);
    THREE_YEARS_AGO = threeYearsAgoDate.toISOString().split("T")[0];
    
    // Determine target month (current month based on the dataset's final date)
    const targetMonthIndex = lastDate.getUTCMonth();
    targetMonthStr = `-${String(targetMonthIndex + 1).padStart(2, '0')}-`;
  }

  // --- 3-Year Window & Yearly Consistency Tracking ---
  let tyTotalR = 0;
  let tyPeakR = 0;
  let tyMaxDrawdownR = 0;
  let tyGrossProfit = 0;
  let tyGrossLoss = 0;
  let tyTradesCount = 0;
  let tyWinningTrades = 0;
  let tyLosingDaysCount = 0;
  const tyMonthlyNetR: Record<string, number> = {};
  const tyWeeklyNetR: Record<string, number> = {};
  const yearlyNetR: Record<string, number> = {};
  const yearlyTrades: Record<string, number> = {};
  
  let smTradesCount = 0;
  let smWinningTrades = 0;
  let recentOneYearTrades = 0;
  let recentOneYearR = 0;
  
  let seasonalTrades = 0;
  let seasonalNetR = 0;
  let seasonalGrossProfit = 0;
  let seasonalGrossLoss = 0;

  const fcMatch = state.setup.match(/_FC(\d+)_/);
  const forceCloseHours = fcMatch ? parseInt(fcMatch[1]) : 24;

  const dailyTracker = new DailyContextTracker();

  for (let i = 0; i < n; i++) {
    const val = arr[i];
    if (val !== 0) {
      totalR += val;
      periodLength++;
      if (val < 0) negativeLength++;
      if (val > 0) winningTrades++;
      
      const dateStr = globalDates[i];
      const yKey = dateStr.substring(0, 4);
      yearlyNetR[yKey] = (yearlyNetR[yKey] || 0) + val;
      yearlyTrades[yKey] = (yearlyTrades[yKey] || 0) + 1;

      if (dateStr >= cutoff2MonthDateStr) {
        recentTwoMonthR += val;
      }
      if (dateStr >= cutoff3MonthDateStr) {
        recentThreeMonthR += val;
      }
      if (dateStr >= cutoffDateStr) {
        recentMomentumR += val;
        const monthKey = dateStr.substring(0, 7);
        recentSixMonthsNetRByMonth[monthKey] = (recentSixMonthsNetRByMonth[monthKey] || 0) + val;
      }
      if (dateStr >= cutoff1YearDateStr) {
        recentOneYearTrades++;
        recentOneYearR += val;
      }

      if (dateStr >= THREE_YEARS_AGO) {
        tyTotalR += val;
        if (tyTotalR > tyPeakR) tyPeakR = tyTotalR;
        const tyDD = tyPeakR - tyTotalR;
        if (tyDD > tyMaxDrawdownR) tyMaxDrawdownR = tyDD;
        
        const mKey = dateStr.substring(0, 7);
        tyMonthlyNetR[mKey] = (tyMonthlyNetR[mKey] || 0) + val;
        
        const wKey = getISOWeek(dateStr);
        tyWeeklyNetR[wKey] = (tyWeeklyNetR[wKey] || 0) + val;
        
        if (val < 0) tyLosingDaysCount++;
        
        tyTradesCount++;
        if (val > 0) { tyGrossProfit += val; tyWinningTrades++; }
        else if (val < 0) tyGrossLoss += Math.abs(val);
      }

      if (dateStr >= cutoffDateStr) {
        smTradesCount++;
        if (val > 0) smWinningTrades++;
      }
      
      if (dateStr >= THREE_YEARS_AGO && dateStr.includes(targetMonthStr)) {
        seasonalTrades++;
        seasonalNetR += val;
        if (val > 0) seasonalGrossProfit += val;
        else if (val < 0) seasonalGrossLoss += Math.abs(val);
      }
    }

    if (totalR > peakR) peakR = totalR;
    const currentDrawdown = peakR - totalR;
    if (currentDrawdown > maxDrawdownR) maxDrawdownR = currentDrawdown;
  }

  const isPotentialBlackSwan = maxDrawdownR <= BLACK_SWAN_MAX_DD && tradesCount >= BLACK_SWAN_MIN_TRADES;
  const minRequiredR = isPotentialBlackSwan ? 5 : 8;

  // Low-frequency assets (Crypto, Indices, Energy, JPY Crosses) trade 4-9 times/year.
  const isLowFreqAsset = /BTC|ETH|XTI|NAS100|US30|GER40|JPN225|SPX500|CADJPY|EURJPY/i.test(symbol);

  const minRecentOneYearTrades = isLowFreqAsset ? 2 : 3;
  const minTotalTrades = isLowFreqAsset ? 3 : 10;

  if (totalR < minRequiredR || maxDrawdownR > 70 || recentOneYearTrades < minRecentOneYearTrades || tradesCount < minTotalTrades)
    return null;

  // Calendar Year Consistency Guard:
  // IMPORTANT: yearlyNetR is built from state.dailyRArray (the OOS dump slice data),
  // NOT from the 3-Year CSV audit data in GrandmasterPreProcessor. This guard runs
  // as a fast pre-filter before the CSV audit. A config that passes here may still
  // be rejected by the authoritative CSV audit gates (threeYearNetR, calmar, etc.).
  // Reject any setup that loses net money in any calendar year with active trading (≥ 3 trades or net loss < -1.5R)
  for (const [year, yNet] of Object.entries(yearlyNetR)) {
    const yCnt = yearlyTrades[year] || 0;
    if ((yCnt >= 3 && yNet < 0) || yNet < -1.5) {
      return null;
    }
  }

  // ── Sharpe / Sortino ────────────────────────────────────────────────────────
  // IMPORTANT: We compute statistics ONLY on active trading days.
  const activeTrades: number[] = [];
  for (let i = 0; i < n; i++) {
    if (arr[i] !== 0) activeTrades.push(arr[i]);
  }

  const nActive = activeTrades.length;
  const meanActiveReturn = nActive > 0 ? totalR / nActive : 0;

  let activeSumSq = 0;
  let activeDownsideVarianceSum = 0;
  let upsideSum = 0;
  let downsideSum = 0;

  for (const v of activeTrades) {
    activeSumSq += v * v;
    if (v < 0) {
      activeDownsideVarianceSum += v * v;
      downsideSum += Math.abs(v);
    } else if (v > 0) {
      upsideSum += v;
    }
  }

  const activeVariance = nActive > 1
    ? (activeSumSq / nActive) - (meanActiveReturn * meanActiveReturn)
    : 0;
  const activeStdDev = Math.sqrt(Math.max(0, activeVariance));
  const activeDownsideStdDev = Math.sqrt(activeDownsideVarianceSum / (nActive || 1));

  // Annualize: scale by √(trades per year) to convert per-trade Sharpe → annual
  let activeDaysPerYear = 252;
  if (n > 1) {
    const start = new Date(globalDates[0]).getTime();
    const end = new Date(globalDates[n - 1]).getTime();
    const calYears = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
    if (calYears > 0.1) activeDaysPerYear = n / calYears;
  }
  const tradesPerYear = nActive > 0 && activeDaysPerYear > 0
    ? (nActive / (n / activeDaysPerYear))
    : activeDaysPerYear;

  const sharpeRatio =
    activeStdDev > 0
      ? (meanActiveReturn / activeStdDev) * Math.sqrt(tradesPerYear)
      : (meanActiveReturn > 0 ? 99 : 0);
  const sortinoRatio =
    activeDownsideStdDev > 0
      ? (meanActiveReturn / activeDownsideStdDev) * Math.sqrt(tradesPerYear)
      : (meanActiveReturn > 0 ? 99 : 0);
  const recoveryFactor =
    maxDrawdownR > 0 ? totalR / maxDrawdownR : totalR * 2.0;

  // Discrete Omega Ratio with L = 0
  const omegaRatio = downsideSum === 0 ? (upsideSum > 0 ? 99.0 : 1.0) : Math.min(99.0, upsideSum / downsideSum);

  // 95% CVaR (Expected Shortfall)
  let cvar95 = 0;
  if (activeTrades.length > 0) {
    const losses = activeTrades.map(r => -r).sort((a, b) => a - b);
    const cutoffIndex = Math.floor(losses.length * 0.95);
    let tailSum = 0;
    let count = 0;
    for (let i = cutoffIndex; i < losses.length; i++) {
      tailSum += Math.max(0, losses[i]);
      count++;
    }
    cvar95 = count > 0 ? tailSum / count : (losses[losses.length - 1] > 0 ? losses[losses.length - 1] : 0);
  }
  
  // Minimum Risk-Reward Ratio Guard (3-year window)
  const avgWinR = tyWinningTrades > 0 ? tyGrossProfit / tyWinningTrades : 0;
  if (avgWinR < 0.2) {
    return null; // Eradicate strategies with < 0.2 RR on average winning day (3yr window)
  }

  // Walk-Forward Efficiency (wfMultiplier)
  const NUM_STEPS = 10;
  const stepSize = Math.floor(n / NUM_STEPS);
  let stepSum = 0, stepSumSq = 0, minStepReturn = Infinity;
  for (let i = 0; i < NUM_STEPS; i++) {
    let sRet = 0;
    const startIdx = i * stepSize;
    const endIdx = i === NUM_STEPS - 1 ? n : (i + 1) * stepSize;
    for (let j = startIdx; j < endIdx; j++) {
      sRet += arr[j];
    }
    stepSum += sRet;
    stepSumSq += sRet * sRet;
    if (sRet < minStepReturn) minStepReturn = sRet;
  }
  
  const stepMean = stepSum / NUM_STEPS;
  const stepVariance = (stepSumSq / NUM_STEPS) - (stepMean * stepMean);
  const stepStdDev = Math.sqrt(Math.max(0, stepVariance));
  
  let wfMultiplier = stepStdDev > 0 ? (stepMean / (stepStdDev + 1)) : 0.1;
  if (minStepReturn < 0) {
    // FIX 5: Replace flat 10x penalty with magnitude-proportional continuous penalty.
    // A small dip (−0.5R in a period averaging +10R) should not be treated identically
    // to a catastrophic losing period (−15R). Scale penalty proportionally by loss
    // depth vs total portfolio R. Min floor of 0.30 prevents full elimination.
    const lossMagnitude = Math.abs(minStepReturn);
    const penaltyFactor = Math.max(0.30, 1.0 - (lossMagnitude / (Math.abs(totalR) + 1.0)));
    wfMultiplier *= penaltyFactor;
  } else if (minStepReturn < stepMean * 0.2) {
    wfMultiplier *= 0.5;
  }
  wfMultiplier = Math.max(0.1, Math.min(2.0, wfMultiplier));
  const maxStepLoss = minStepReturn < 0 ? Math.abs(minStepReturn) : 0;

  let periodReturns: number[] = [];
  let dailyReturns: Record<string, number> = {};

  if (hydrate) {
    for (let i = 0; i < n; i++) {
      if (arr[i] !== 0) {
        periodReturns.push(arr[i]);
        dailyReturns[globalDates[i]] = arr[i];
      }
    }
  }

  const calcWinRate = (state as any).winRate !== undefined
    ? ((state as any).winRate > 1 ? (state as any).winRate : (state as any).winRate * 100)
    : (tradesCount > 0 ? (winningTrades / tradesCount) * 100 : 0);
  
  const tyProfitFactor = tyGrossLoss === 0 ? Infinity : tyGrossProfit / tyGrossLoss;
  const smWinRate = smTradesCount > 0 ? (smWinningTrades / smTradesCount) * 100 : 0;

  const hasLosingMonth = Object.values(tyMonthlyNetR).some(v => v < 0);
  const hasLosingWeek = Object.values(tyWeeklyNetR).some(v => v < 0);
  const hasLosingDay = tyLosingDaysCount > 0;

  const totalYears = Math.max(0.5, n / 252);
  const annualAvgR = totalR / totalYears;
  const ratio = annualAvgR > 0 ? (recentOneYearR / annualAvgR) : 0;
  let regimeRatio = 1.0;
  if (ratio > 1.4) {
    // If recent 1 year accounts for disproportionate outperformance, penalize regime overfitting
    regimeRatio = Math.max(0.2, 1.0 - (ratio - 1.4) * 0.5);
  } else if (ratio < 0.6) {
    // If strategy decayed significantly recently, penalize decay
    regimeRatio = Math.max(0.2, ratio / 0.6);
  }

  // Continuous sample size confidence
  const sampleConfidence = Math.min(1.0, Math.sqrt(tradesCount / 30));

  // ── Deflated Sharpe Ratio (DSR) Calculation ────────────────────────────────
  let activeSkew = 0;
  let activeKurt = 3;
  if (nActive > 3 && activeStdDev > 0) {
    let m3 = 0, m4 = 0;
    for (const v of activeTrades) {
      const diff = v - meanActiveReturn;
      m3 += diff * diff * diff;
      m4 += diff * diff * diff * diff;
    }
    m3 /= nActive;
    m4 /= nActive;
    activeSkew = m3 / Math.pow(activeStdDev, 3);
    activeKurt = m4 / Math.pow(activeStdDev, 4);
  }
  // Assume ~500 trials per pair optimization run
  const { dsr, dsrProb } = calculateDeflatedSharpeRatio(sharpeRatio, 500, nActive, activeSkew, activeKurt);

  // ── Recency Momentum & Quarterly Acceleration Multiplier ───────────────────
  // Reward setups that are actively surging and thriving in the recent 60-90 days
  // (June, July, August 2026) and penalize setups that have gone stale or negative recently.
  let recencyMultiplier = 1.0;
  if (recentThreeMonthR > 0) {
    const recentVelocity = Math.min(2.5, 1.0 + (recentThreeMonthR / Math.max(4.0, Math.abs(totalR) * 0.3)));
    recencyMultiplier = recentVelocity;
  } else if (recentThreeMonthR < 0) {
    recencyMultiplier = Math.max(0.2, 1.0 + (recentThreeMonthR / (Math.abs(totalR) + 4.0)));
  }

  // ── Trajectory Curvature & Ballooning Convexity (beta2) ───────────────────
  let cum = 0;
  const cumY: number[] = [];
  for (let i = 0; i < n; i++) {
    cum += arr[i];
    cumY.push(cum);
  }
  const yStart = cumY[0] || 0;
  const yMid = cumY[Math.floor(n / 2)] || 0;
  const yEnd = cumY[n - 1] || 0;
  const curvatureBeta2 = (yEnd - yMid) - (yMid - yStart); // Positive = accelerating/ballooning upward!
  const recentQuarterR = recentThreeMonthR;

  const hedgeScore = sortinoRatio * recoveryFactor * regimeRatio * wfMultiplier * recencyMultiplier * (0.2 + 0.8 * dsrProb);

  return {
    symbol,
    botType,
    setup: state.setup,
    totalTrades: tradesCount,
    totalTotalR: totalR,
    maxDrawdown: maxDrawdownR,
    sharpeRatio,
    sortinoRatio,
    recoveryFactor,
    hedgeScore,
    profitFactor: tyProfitFactor,
    deflatedSharpeRatio: dsr,
    dsrProb,
    periodReturns,
    dailyReturns,
    dailyRArray: arr,
    winRate: calcWinRate,
    recentTwoMonthR,
    recentThreeMonthR,
    recentMomentumR,
    recentOneYearR,
    recentQuarterR,
    curvatureBeta2,
    regimeRatio,
    omegaRatio,
    cvar95,
    sampleConfidence,
    threeYearMaxDrawdown: tyMaxDrawdownR,
    threeYearTrades: tyTradesCount,
    threeYearProfitFactor: tyProfitFactor,
    forceCloseHours,
    recentSixMonthTrades: smTradesCount,
    recentSixMonthWinRate: smWinRate,
    seasonalMultiplier: 1.0,
    wfMultiplier,
    stepMean,
    maxStepLoss,
    hasLosingMonth,
    hasLosingWeek,
    hasLosingDay,
    avgWinR
  };
}

export function evaluatePortfolio(
  ids: number[],
  avgCorr: number,
  params: {
    numDays: number;
    recentReturnStartIndex: number;
    stepSize: number;
    NUM_STEPS: number;
    returns2D: Float64Array;
    gmRiskPct: Float64Array;
    gmTrades: Int32Array;
    gmSeasonalMultiplier: Float64Array;
    category: string;
  }
) {
  const {
    numDays,
    recentReturnStartIndex,
    stepSize,
    NUM_STEPS,
    returns2D,
    gmRiskPct,
    gmTrades,
    gmSeasonalMultiplier,
    category
  } = params;

  const pCount = ids.length;
  let sum = 0, sumSq = 0;
  let rawCumulative = 0, rawPeak = 0, rawMaxDrawdown = 0;
  let grossProfit = 0, grossLoss = 0, totalTrades = 0, recentReturn = 0;
  let worstDailyLoss = 0; // Prop Firm tracking
  const stepReturns = new Float64Array(NUM_STEPS);

  for (let d = 0; d < numDays; d++) {
    let dailyRaw = 0;
    for (let pIdx = 0; pIdx < pCount; pIdx++) {
        const id = ids[pIdx];
        dailyRaw += returns2D[id * numDays + d] * gmRiskPct[id];
    }

    if (dailyRaw < worstDailyLoss) worstDailyLoss = dailyRaw; // Prop Firm 4.0% limit

    if (d >= recentReturnStartIndex) recentReturn += dailyRaw;
    if (dailyRaw > 0) grossProfit += dailyRaw;
    else if (dailyRaw < 0) grossLoss += Math.abs(dailyRaw);

    const stepIdx = Math.min(NUM_STEPS - 1, Math.floor(d / stepSize));
    stepReturns[stepIdx] += dailyRaw;

    sum += dailyRaw;
    sumSq += dailyRaw * dailyRaw;

    rawCumulative += dailyRaw;
    if (rawCumulative > rawPeak) rawPeak = rawCumulative;
    const rawDD = rawPeak - rawCumulative;
    if (rawDD > rawMaxDrawdown) rawMaxDrawdown = rawDD;
  }

  for (let pIdx = 0; pIdx < pCount; pIdx++) totalTrades += gmTrades[ids[pIdx]];

  const totalReturn = sum;
  const mean = sum / numDays;
  const variance = (sumSq / numDays) - (mean * mean);
  const stdDev = Math.sqrt(Math.max(0, variance));
  const activeDaysPerYear = numDays > 1 ? (numDays / 5.0) : 252;
  const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(activeDaysPerYear) : 0;

  let stepSum = 0, stepSumSq = 0, minStepReturn = Infinity;
  for (let i = 0; i < NUM_STEPS; i++) {
    stepSum += stepReturns[i];
    stepSumSq += stepReturns[i] * stepReturns[i];
    if (stepReturns[i] < minStepReturn) minStepReturn = stepReturns[i];
  }
  
  const stepMean = stepSum / NUM_STEPS;
  const stepVariance = (stepSumSq / NUM_STEPS) - (stepMean * stepMean);
  const stepStdDev = Math.sqrt(Math.max(0, stepVariance));
  
  let wfMultiplier = stepStdDev > 0 ? (stepMean / (stepStdDev + 1)) : 0.1;
  if (minStepReturn < 0) {
      wfMultiplier *= 0.1;
  } else if (minStepReturn < stepMean * 0.2) {
      wfMultiplier *= 0.5;
  }
  wfMultiplier = Math.max(0.1, Math.min(2.0, wfMultiplier));

  const finalProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;
  const returnToDrawdown = rawMaxDrawdown > 0 ? totalReturn / rawMaxDrawdown : 0;
  
  let avgSeasonalMultiplier = 0;
  for (let pIdx = 0; pIdx < pCount; pIdx++) {
      avgSeasonalMultiplier += gmSeasonalMultiplier[ids[pIdx]];
  }
  avgSeasonalMultiplier /= pCount;

  let score = 0;
  if (category.includes("Lowest Max Drawdown")) score = -rawMaxDrawdown * wfMultiplier;
  else if (category.includes("Highest Net Profit")) score = totalReturn * wfMultiplier;
  else if (category.includes("Most Consistent")) score = sharpeRatio * wfMultiplier;
  else if (category.includes("Best Last 6 Months")) score = recentReturn;
  else if (category.includes("Highest Win Rate")) score = finalProfitFactor * wfMultiplier;
  else if (category.includes("Highest Profit Factor")) score = finalProfitFactor * wfMultiplier;
  else if (category.includes("Most Balanced")) score = (returnToDrawdown + sharpeRatio * 10) * wfMultiplier;
  
  else if (category.includes("Best Risk-Adjusted Return")) {
    score = sharpeRatio * returnToDrawdown * wfMultiplier;
  }
  else if (category.includes("The Ultimate Trifecta")) {
    const recentWeight = Math.max(0.01, recentReturn);
    const ddPenalty = Math.max(0.1, 1.0 - rawMaxDrawdown / 10.0);
    score = recentWeight * ddPenalty * totalReturn * wfMultiplier;
  }
  else if (category.includes("The Holy Grail") || category.includes("Experimental")) {
     const correlationPenalty = Math.max(0.1, 1 - Math.max(0, avgCorr));
     const recentPenalty = recentReturn >= 0
       ? Math.min(2.0, 1.0 + recentReturn / 60)
       : Math.max(0.05, 1.0 + recentReturn / 30);
     score = sharpeRatio * returnToDrawdown * finalProfitFactor * wfMultiplier * correlationPenalty * recentPenalty;
  } 
  else if (category.includes("The Black Swan")) {
     const corrPenalty = Math.max(0.1, 1 - Math.max(0, avgCorr));
     if (rawMaxDrawdown <= 4.0 && totalTrades >= 40) {
        score = totalReturn * 10000 * wfMultiplier * corrPenalty;
      } else if (rawMaxDrawdown <= 6.0 && totalTrades >= 40) {
        const overshoot = rawMaxDrawdown - 4.0;
        score = (totalReturn * corrPenalty * wfMultiplier) * Math.exp(-overshoot * 2.0);
      } else {
        score = -10000;
     }
  }
  else score = returnToDrawdown * wfMultiplier;
  
  if (score > 0) {
      score *= avgSeasonalMultiplier;
  }

  if (worstDailyLoss < -4.0) score -= 10000;
  if (rawMaxDrawdown > 25.0) score -= 10000;
  if (recentReturn < 0) score -= 10000;

  return {
    score, totalReturn, rawMaxDrawdown, worstDailyLoss, finalProfitFactor, recentReturn, returnToDrawdown, sharpeRatio, wfMultiplier, totalTrades
  };
}

/**
 * Marcos López de Prado's Deflated Sharpe Ratio (DSR)
 * Calculates the probability that an observed Sharpe Ratio is true (not a false discovery / overfit artifact)
 * given:
 * - SR: Annualized Sharpe Ratio of the strategy
 * - N: Number of trials / parameter configurations tested
 * - tradesCount: Number of active trade observations
 * - skew: Skewness of active trade returns
 * - kurt: Kurtosis of active trade returns
 */
export function calculateDeflatedSharpeRatio(
  sr: number,
  numTrials: number,
  tradesCount: number,
  skew: number = 0,
  kurt: number = 3
): { dsr: number; dsrProb: number } {
  if (sr <= 0 || tradesCount < 4) return { dsr: 0, dsrProb: 0.5 };
  
  // Euler-Mascheroni constant approximation for expected max Sharpe among N IID Gaussian trials
  const emConst = 0.5772156649015329;
  const num = Math.max(2, numTrials);
  const logN = Math.log(num);
  const sqrt2LogN = Math.sqrt(2 * logN);
  const expMaxZ = sqrt2LogN * (1 - emConst / (2 * logN)) + (emConst / sqrt2LogN);
  
  // Variance of the Sharpe Ratio estimator under non-normality (Mertens 2002 / Bailey & Lopez de Prado 2014)
  const srVar = (1 - skew * sr + ((kurt - 1) / 4) * sr * sr) / Math.max(1, tradesCount - 1);
  const srStdDev = Math.sqrt(Math.max(1e-6, srVar));
  
  // Deflated Sharpe Ratio statistic (Z-score relative to expected benchmark under multiple testing)
  const dsrZ = (sr - expMaxZ) / srStdDev;
  
  // Standard Normal Cumulative Distribution Function approximation (Abramowitz and Stegun)
  const p = 1 / (1 + 0.2316419 * Math.abs(dsrZ));
  const poly = p * (0.319381530 + p * (-0.356563782 + p * (1.781477937 + p * (-1.821255978 + p * 1.330274429))));
  const normCdf = dsrZ >= 0 
    ? 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * dsrZ * dsrZ) * poly
    : (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * dsrZ * dsrZ) * poly;

  return { dsr: dsrZ, dsrProb: Math.max(0, Math.min(1, normCdf)) };
}

