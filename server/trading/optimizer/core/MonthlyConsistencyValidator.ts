/**
 * ============================================================
 * MONTHLY CONSISTENCY & ANTI-ANOMALY VALIDATOR
 * ============================================================
 * Centralized quantitative filtering logic for all strategy synthesizers
 * (Mage, Sage, Seer, and Grandmaster Portfolio Synthesizer).
 *
 * Rules Enforced:
 *  1. No losing month in the last 2 completed months (beyond noise threshold maxAllowedMonthlyLossR).
 *  2. No >= 2 losing months in the last 6 completed months.
 *  3. No losing same calendar month across multiple years (seasonal consistency check).
 *  4. Anti-Anomaly Concentration & Win Rate Caps:
 *     - Minimum Win Rate Floor >= 40% (Requires winning on >= 40% of trades).
 *     - Single trade cannot exceed 30% of total multi-year profit.
 *     - Top 3 trades combined cannot exceed 60% of total multi-year profit.
 * ============================================================
 */

export interface MonthlyValidationResult {
  isValid: boolean;
  rejectReason?: string;
  hasLosingMonthInLastTwo: boolean;
  losingMonthsInLastSixCount: number;
  hasLosingSameMonthInLastYears: boolean;
  hasAnyTwoConsecutiveLosingMonths?: boolean;
  monthlyNetR: Record<string, number>;
}

export function validateMonthlyConsistency(
  dailyNetR: Record<string, number> | undefined | null,
  maxAllowedMonthlyLossR: number = -5.0
): MonthlyValidationResult {
  const monthlyNetR: Record<string, number> = {};
  const monthDaysCount: Record<string, number> = {};
  
  if (!dailyNetR) {
    return {
      isValid: true,
      hasLosingMonthInLastTwo: false,
      losingMonthsInLastSixCount: 0,
      hasLosingSameMonthInLastYears: false,
      hasAnyTwoConsecutiveLosingMonths: false,
      monthlyNetR,
    };
  }

  const sortedDates = Object.keys(dailyNetR).sort();

  for (const d of sortedDates) {
    const monthKey = d.substring(0, 7); // e.g. "2024-03"
    monthlyNetR[monthKey] = (monthlyNetR[monthKey] || 0) + dailyNetR[d];
    monthDaysCount[monthKey] = (monthDaysCount[monthKey] || 0) + 1;
  }

  let sortedMonths = Object.keys(monthlyNetR).sort();

  if (sortedMonths.length === 0) {
    return {
      isValid: true,
      hasLosingMonthInLastTwo: false,
      losingMonthsInLastSixCount: 0,
      hasLosingSameMonthInLastYears: false,
      hasAnyTwoConsecutiveLosingMonths: false,
      monthlyNetR,
    };
  }

  // If the last month in the dataset is a partial/incomplete month (fewer than 10 trading days),
  // exclude it from the completed month evaluation window so partial current month noise doesn't distort results.
  const lastMonthKey = sortedMonths[sortedMonths.length - 1];
  if (monthDaysCount[lastMonthKey] < 10 && sortedMonths.length > 1) {
    sortedMonths = sortedMonths.slice(0, -1);
  }

  // ── Rule 1: No losing month (< maxAllowedMonthlyLossR) in the last 2 completed months ──
  const last2Months = sortedMonths.slice(-2);
  let hasLosingMonthInLastTwo = false;
  for (const mKey of last2Months) {
    if (monthlyNetR[mKey] < maxAllowedMonthlyLossR) {
      hasLosingMonthInLastTwo = true;
      break;
    }
  }

  if (hasLosingMonthInLastTwo) {
    return {
      isValid: false,
      rejectReason: `Losing month (< ${maxAllowedMonthlyLossR}R) in the last 2 completed months`,
      hasLosingMonthInLastTwo: true,
      losingMonthsInLastSixCount: 0,
      hasLosingSameMonthInLastYears: false,
      hasAnyTwoConsecutiveLosingMonths: false,
      monthlyNetR,
    };
  }

  // ── Rule 2: No >= 2 losing months (< maxAllowedMonthlyLossR) in the last 6 completed months ──
  const last6Months = sortedMonths.slice(-6);
  let losingMonthsInLastSixCount = 0;
  for (const mKey of last6Months) {
    if (monthlyNetR[mKey] < maxAllowedMonthlyLossR) {
      losingMonthsInLastSixCount++;
    }
  }

  if (losingMonthsInLastSixCount >= 2) {
    return {
      isValid: false,
      rejectReason: `Too many losing months in the last 6 completed months (${losingMonthsInLastSixCount} >= 2)`,
      hasLosingMonthInLastTwo: false,
      losingMonthsInLastSixCount,
      hasLosingSameMonthInLastYears: false,
      hasAnyTwoConsecutiveLosingMonths: false,
      monthlyNetR,
    };
  }

  // ── Rule 3: No losing same month across multiple years (Seasonal check) ───
  const sameMonthYearlyReturns: Record<string, { year: string; netR: number }[]> = {};
  for (const mKey of sortedMonths) {
    const year = mKey.substring(0, 4);
    const monthIndex = mKey.substring(4); // e.g. "-03"
    if (!sameMonthYearlyReturns[monthIndex]) {
      sameMonthYearlyReturns[monthIndex] = [];
    }
    sameMonthYearlyReturns[monthIndex].push({ year, netR: monthlyNetR[mKey] });
  }

  let hasLosingSameMonthInLastYears = false;
  for (const monthIndex in sameMonthYearlyReturns) {
    const records = sameMonthYearlyReturns[monthIndex];
    let losingYearsCount = 0;
    for (const r of records) {
      if (r.netR < maxAllowedMonthlyLossR) {
        losingYearsCount++;
      }
    }
    if (losingYearsCount >= 2) {
      hasLosingSameMonthInLastYears = true;
      break;
    }
  }

  if (hasLosingSameMonthInLastYears) {
    return {
      isValid: false,
      rejectReason: `Same calendar month was negative (< ${maxAllowedMonthlyLossR}R) across multiple years`,
      hasLosingMonthInLastTwo: false,
      losingMonthsInLastSixCount,
      hasLosingSameMonthInLastYears: true,
      hasAnyTwoConsecutiveLosingMonths: false,
      monthlyNetR,
    };
  }

  // ── Rule 4: ANY 3 consecutive losing months (< 0 R) in the last 1 year (12 months) ──
  let hasAnyThreeConsecutiveLosingMonths = false;
  const last12Months = sortedMonths.slice(-12);
  for (let i = 0; i < last12Months.length - 2; i++) {
    if (monthlyNetR[last12Months[i]] < 0 && 
        monthlyNetR[last12Months[i + 1]] < 0 && 
        monthlyNetR[last12Months[i + 2]] < 0) {
      hasAnyThreeConsecutiveLosingMonths = true;
      break;
    }
  }

  if (hasAnyThreeConsecutiveLosingMonths) {
    return {
      isValid: false,
      rejectReason: `Failed consecutive losing month check: had >= 3 consecutive months with < 0 R in the last 1 year (12 months)`,
      hasLosingMonthInLastTwo,
      losingMonthsInLastSixCount,
      hasLosingSameMonthInLastYears,
      hasAnyTwoConsecutiveLosingMonths: true,
      monthlyNetR,
    };
  }

  // ── Rule 5: Must have Net Positive R in the last 1 year (12 months) ──
  let last1YearTotalR = 0;
  for (let i = 0; i < last12Months.length; i++) {
    last1YearTotalR += monthlyNetR[last12Months[i]];
  }

  if (last1YearTotalR < 0) {
    return {
      isValid: false,
      rejectReason: `Failed recent performance check: Last 1 year (12 months) total Net R is negative (${last1YearTotalR.toFixed(2)} R)`,
      hasLosingMonthInLastTwo,
      losingMonthsInLastSixCount,
      hasLosingSameMonthInLastYears,
      monthlyNetR,
    };
  }

  return {
    isValid: true,
    hasLosingMonthInLastTwo: false,
    losingMonthsInLastSixCount,
    hasLosingSameMonthInLastYears: false,
    hasAnyTwoConsecutiveLosingMonths: false,
    monthlyNetR,
  };
}

export interface AnomalyValidationResult {
  isValid: boolean;
  rejectReason?: string;
  top1WinPct: number;
  top3WinPct: number;
  winRate: number;
}

export function validateAnomalyConcentration(
  dailyNetR: Record<string, number> | undefined | null,
  maxTop1WinPct: number = 30.0,
  maxTop3WinPct: number = 60.0,
  minWinRatePct: number = 40.0 // User rule: At least 40% Win Rate required
): AnomalyValidationResult {
  if (!dailyNetR) return { isValid: true, top1WinPct: 0, top3WinPct: 0, winRate: 100 };

  const dates = Object.keys(dailyNetR);
  if (dates.length === 0) return { isValid: true, top1WinPct: 0, top3WinPct: 0, winRate: 100 };

  const returns = dates.map((d) => dailyNetR[d]);
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const totalTrades = wins.length + losses.length;

  if (totalTrades < 5) {
    return { isValid: true, top1WinPct: 0, top3WinPct: 0, winRate: 100 };
  }

  const winRate = (wins.length / totalTrades) * 100;
  if (winRate < minWinRatePct) {
    return {
      isValid: false,
      rejectReason: `Win Rate (${winRate.toFixed(1)}%) is below minimum 40% floor`,
      top1WinPct: 0,
      top3WinPct: 0,
      winRate,
    };
  }

  const totalNetR = returns.reduce((a, b) => a + b, 0);
  if (totalNetR <= 0) {
    return { isValid: false, rejectReason: "Total Net R <= 0", top1WinPct: 0, top3WinPct: 0, winRate };
  }

  const sortedWins = [...wins].sort((a, b) => b - a);
  const top1Win = sortedWins[0] || 0;
  const top3WinsSum = sortedWins.slice(0, 3).reduce((a, b) => a + b, 0);

  const top1WinPct = (top1Win / totalNetR) * 100;
  const top3WinPct = (top3WinsSum / totalNetR) * 100;

  if (top1WinPct > maxTop1WinPct) {
    return {
      isValid: false,
      rejectReason: `Single largest win accounts for ${top1WinPct.toFixed(1)}% of total profit (cap: ${maxTop1WinPct}%)`,
      top1WinPct,
      top3WinPct,
      winRate,
    };
  }

  if (top3WinPct > maxTop3WinPct) {
    return {
      isValid: false,
      rejectReason: `Top 3 wins account for ${top3WinPct.toFixed(1)}% of total profit (cap: ${maxTop3WinPct}%)`,
      top1WinPct,
      top3WinPct,
      winRate,
    };
  }

  return {
    isValid: true,
    top1WinPct,
    top3WinPct,
    winRate,
  };
}
