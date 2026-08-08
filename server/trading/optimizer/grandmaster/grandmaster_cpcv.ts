import { IndependentSynthesisComponent } from "./GrandmasterMetrics.js";
import { PLWFOWindow } from "./grandmaster_plwfo.js";

export interface CPCVResult {
  passed: boolean;
  pathsPassed: number;
  totalPaths: number;
  minSharpe: number;
  maxDD: number;
  minR: number;
  pathResults: {
    pathIndex: number;
    oosR: number;
    oosDD: number;
    oosSharpe: number;
    isWindows: number[];
    oosWindows: number[];
  }[];
}

function getCombinations(arr: number[], k: number): number[][] {
  const result: number[][] = [];
  function combine(start: number, combo: number[]) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return result;
}

function extractDaysFromWindows(
  windows: PLWFOWindow[],
  selectedIndices: number[],
  type: 'IS' | 'OOS',
  purgeDays?: Set<number>
): number[] {
  const daysSet = new Set<number>();
  for (const idx of selectedIndices) {
    const win = windows[idx];
    const start = type === 'IS' ? win.isStart : win.oosStart;
    const end = type === 'IS' ? win.isEnd : win.oosEnd;
    for (let d = start; d <= end; d++) {
      if (!purgeDays || !purgeDays.has(d)) {
        daysSet.add(d);
      }
    }
  }
  return Array.from(daysSet).sort((a, b) => a - b);
}

function calcMetricsOnDays(
  components: IndependentSynthesisComponent[],
  globalDates: string[],
  days: number[]
) {
  let totalR = 0;
  let peakR = 0;
  let maxDD = 0;
  const numDays = days.length;
  
  const dailyReturnsArray = new Float64Array(numDays);
  
  for (let i = 0; i < numDays; i++) {
    const d = days[i];
    let dailyR = 0;
    const dateStr = globalDates[d];
    for (const c of components) {
      dailyR += (c.dailyReturns[dateStr] || 0) * (c.riskPct || 1.0);
    }
    
    totalR += dailyR;
    dailyReturnsArray[i] = dailyR;
    
    if (totalR > peakR) peakR = totalR;
    const dd = peakR - totalR;
    if (dd > maxDD) maxDD = dd;
  }
  
  // Only compute Sharpe on days where at least one component had a trade.
  // Including zero-return days artificially suppresses stdDev and inflates Sharpe.
  const activeDailyReturns: number[] = [];
  for (let i = 0; i < numDays; i++) {
    if (dailyReturnsArray[i] !== 0) activeDailyReturns.push(dailyReturnsArray[i]);
  }
  const nActive = activeDailyReturns.length;

  // Guard: if no active days or no calendar days, Sharpe is 0 (undefined period)
  if (nActive === 0 || numDays === 0) {
    return { totalR, maxDD, sharpe: 0 };
  }

  const mean = totalR / nActive;
  let varSum = 0;
  for (const r of activeDailyReturns) {
    varSum += (r - mean) * (r - mean);
  }
  const stdDev = Math.sqrt(varSum / nActive);

  // Guard: if stdDev is effectively zero (all returns identical), Sharpe is 0
  if (stdDev < 1e-12) {
    return { totalR, maxDD, sharpe: 0 };
  }

  // Annualize by trades-per-year rate — clamp to [1, 252] to prevent Inf/NaN
  let activeDaysPerYear = 252;
  if (numDays > 1) {
    const start = new Date(globalDates[days[0]]).getTime();
    const end = new Date(globalDates[days[numDays - 1]]).getTime();
    const calYears = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
    if (calYears > 0.1) activeDaysPerYear = numDays / calYears;
  }
  const calendarDaysPerActive = numDays / nActive;
  const tradesPerYear = calendarDaysPerActive > 0
    ? Math.min(252, Math.max(1, activeDaysPerYear / calendarDaysPerActive))
    : 1;

  const sharpe = (mean / stdDev) * Math.sqrt(tradesPerYear);
  // Final safety clamp: reject any NaN or Inf that slipped through
  const safeSharpe = isFinite(sharpe) ? sharpe : 0;
  
  return { totalR, maxDD, sharpe: safeSharpe };
}

function calculateCorrelationPenaltyDays(
  components: IndependentSynthesisComponent[],
  globalDates: string[],
  days: number[]
): number {
  if (components.length <= 1) return 1.0;
  const n = components.length;
  let totalCorr = 0;
  let pairs = 0;
  const numDays = days.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sumI = 0, sumJ = 0, sumI2 = 0, sumJ2 = 0, pSum = 0;
      for (let idx = 0; idx < numDays; idx++) {
        const dateStr = globalDates[days[idx]];
        const rI = (components[i].dailyReturns[dateStr] || 0) * (components[i].riskPct || 1.0);
        const rJ = (components[j].dailyReturns[dateStr] || 0) * (components[j].riskPct || 1.0);
        
        sumI += rI;
        sumJ += rJ;
        sumI2 += rI * rI;
        sumJ2 += rJ * rJ;
        pSum += rI * rJ;
      }
      
      const num = pSum - (sumI * sumJ) / numDays;
      const den = Math.sqrt(Math.max(0, sumI2 - (sumI * sumI) / numDays) * Math.max(0, sumJ2 - (sumJ * sumJ) / numDays));
      const corr = den > 0 ? num / den : 0;
      
      totalCorr += Math.abs(corr);
      pairs++;
    }
  }
  
  const avgCorr = pairs > 0 ? totalCorr / pairs : 0;
  return Math.max(0.1, 1.0 - avgCorr);
}

function scorePortfolioISDays(
  components: IndependentSynthesisComponent[],
  globalDates: string[],
  isDays: number[],
  category: string
): number {
  const metrics = calcMetricsOnDays(components, globalDates, isDays);
  const corrPenalty = calculateCorrelationPenaltyDays(components, globalDates, isDays);
  
  const returnToDD = metrics.maxDD > 0 ? metrics.totalR / metrics.maxDD : metrics.totalR * 10;
  const pf = 1.5; 
  
  let score = 0;
  if (category.includes("Lowest Max Drawdown")) score = -metrics.maxDD * corrPenalty;
  else if (category.includes("Highest Net Profit")) score = metrics.totalR * corrPenalty;
  else if (category.includes("Most Consistent")) score = metrics.sharpe * corrPenalty;
  else if (category.includes("Highest Win Rate")) score = returnToDD * corrPenalty;
  else if (category.includes("Highest Profit Factor")) score = returnToDD * corrPenalty;
  else if (category.includes("Most Balanced")) score = (returnToDD + metrics.sharpe * 10) * corrPenalty;
  else if (category.includes("Best Risk-Adjusted Return")) score = metrics.sharpe * returnToDD * corrPenalty;
  else if (category.includes("The Ultimate Trifecta")) score = metrics.sharpe * returnToDD * corrPenalty;
  else if (category.includes("The Holy Grail")) score = metrics.sharpe * returnToDD * pf * corrPenalty;
  else score = returnToDD * corrPenalty;
  
  return score;
}

export function runCPCV(
  grandmasters: IndependentSynthesisComponent[],
  globalDates: string[],
  category: string,
  windows: PLWFOWindow[]
): CPCVResult {
  const windowIndices = windows.map(w => w.index);
  // Get all combinations of 2 windows for OOS. The remaining 4 are IS.
  const oosCombinations = getCombinations(windowIndices, 2);
  
  const pathResults = [];
  
  let pathsPassed = 0;
  let overallMinSharpe = Infinity;
  let overallMaxDD = 0;
  let overallMinR = Infinity;
  
  for (let pathIdx = 0; pathIdx < oosCombinations.length; pathIdx++) {
    const oosWindows = oosCombinations[pathIdx];
    const isWindows = windowIndices.filter(w => !oosWindows.includes(w));
    
    // Extract OOS days first, then purge them from IS to prevent look-ahead data leakage
    const oosDays = extractDaysFromWindows(windows, oosWindows, 'OOS');
    const oosDaysSet = new Set(oosDays);
    const isDays = extractDaysFromWindows(windows, isWindows, 'IS', oosDaysSet);
    
    // Greedy IS selection
    let currentPortfolio: IndependentSynthesisComponent[] = [];
    let currentScore = -Infinity;
    
    while (currentPortfolio.length < 25) {
      let bestComponent: IndependentSynthesisComponent | null = null;
      let bestNewScore = -Infinity;
      
      for (const gm of grandmasters) {
        if (currentPortfolio.some(p => p.setup === gm.setup)) continue;
        
        const testPortfolio = [...currentPortfolio, gm];
        const score = scorePortfolioISDays(testPortfolio, globalDates, isDays, category);
        
        if (score > bestNewScore) {
          bestNewScore = score;
          bestComponent = gm;
        }
      }
      
      if (bestComponent && bestNewScore > currentScore) {
        currentPortfolio.push(bestComponent);
        currentScore = bestNewScore;
      } else {
        break; 
      }
    }
    
    // Evaluate OOS
    const oosMetrics = calcMetricsOnDays(currentPortfolio, globalDates, oosDays);
    
    pathResults.push({
      pathIndex: pathIdx,
      oosR: oosMetrics.totalR,
      oosDD: oosMetrics.maxDD,
      oosSharpe: oosMetrics.sharpe,
      isWindows,
      oosWindows
    });
    
    if (oosMetrics.sharpe >= 0.00 && oosMetrics.totalR > 0) {
      pathsPassed++;
    }
    
    if (oosMetrics.sharpe < overallMinSharpe) overallMinSharpe = oosMetrics.sharpe;
    if (oosMetrics.maxDD > overallMaxDD) overallMaxDD = oosMetrics.maxDD;
    if (oosMetrics.totalR < overallMinR) overallMinR = oosMetrics.totalR;
  }
  
  // Enforce pass criteria: 10/15 paths must pass + combined OOS Max DD < 12.0R
  const passed = pathsPassed >= 10 && overallMaxDD < 12.0;
  
  return {
    passed,
    pathsPassed,
    totalPaths: oosCombinations.length,
    minSharpe: overallMinSharpe,
    maxDD: overallMaxDD,
    minR: overallMinR,
    pathResults
  };
}
