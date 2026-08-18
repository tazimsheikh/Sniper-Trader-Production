import * as fs from "fs";
import * as path from "path";
import { runPortfolioShadowBacktest } from "./portfolio_shadow_backtester.js";
import { PairConfigManager, MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG } from "../config/PairConfig.js";
import { logger } from "../../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Multi-Pair Live Shadow Trade Loader
// ─────────────────────────────────────────────────────────────────────────────
async function loadUnifiedPortfolioShadowTrades(startDate: string, endDate: string): Promise<any[]> {
  process.stdout.write(`\n🔮 [PORTFOLIO SHADOW] Feeding ALL 11 Pairs Chronologically into Real LiveOrchestrator (${startDate} → ${endDate})...\n`);

  // Silence internal engine log spam during multi-million tick feed
  const origLoggerInfo = logger.info;
  const origLoggerVerbose = logger.verbose;
  const origConsoleLog = console.log;

  logger.info = () => {};
  logger.verbose = () => {};
  console.log = () => {};

  let rawTrades: any[] = [];
  try {
    rawTrades = await runPortfolioShadowBacktest(startDate, endDate);
  } finally {
    logger.info = origLoggerInfo;
    logger.verbose = origLoggerVerbose;
    console.log = origConsoleLog;
  }

  const targetStartMs = new Date(startDate).getTime();
  const valid = rawTrades.filter((r: any) => r.openTime >= targetStartMs && r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");

  // Read Holy Grail portfolio weights if available
  const jsonPath = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster_holy_grail_portfolios.json");
  const riskMap: Record<string, number> = {};
  if (fs.existsSync(jsonPath)) {
    try {
      const portfolio: any[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      for (const comp of portfolio) {
        riskMap[`${comp.symbol}_${comp.botType.toUpperCase()}`] = comp.riskPct || 1.0;
      }
    } catch (e) {}
  }

  valid.forEach((r: any) => {
    const isSage = (r.botId || "").toUpperCase() === "SAGE";
    const botType = isSage ? "SAGE" : "MAGE";
    const liveCfgs = isSage ? PairConfigManager.getSageConfigs(r.symbol) : PairConfigManager.getMageConfigs(r.symbol);
    const assignedRisk = riskMap[`${r.symbol}_${botType}`] || liveCfgs?.[0]?.riskPct || 1.0;

    r.pair = r.symbol;
    r.bot = isSage ? "Sage" : "Mage";
    r.riskMultiplier = assignedRisk;
    r.entryTime = new Date(r.openTime).toISOString();
    r.exitTime = new Date(r.closeTime || r.openTime).toISOString();
  });

  valid.sort((a, b) => (a.openTime || 0) - (b.openTime || 0));
  return valid;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1: Multi-Risk Mode Simulation (Continuous, Monthly, Fixed, DWCB)
// ─────────────────────────────────────────────────────────────────────────────
async function runRiskModesModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 💰 MODULE 1: MULTI-RISK MODE SIMULATION ($100 Starting Balance) — SHADOW ORCHESTRATOR");
  console.log("====================================================================================================");

  const riskSpectrum = [0.01, 0.02, 0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30];

  function runSimulation(baseRisk: number, mode: 'CONTINUOUS' | 'MONTHLY' | 'FIXED') {
    let balance = 100.0;
    let peakBalance = 100.0;
    let maxDrawdownPct = 0;
    let maxDailyDrawdownPct = 0;
    let dailyStartBalance = 100.0;
    let currentDayStr = "";
    let circuitBreakerHits = 0;
    let monthlyBalance = 100.0;
    let currentMonthStr = "";

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const r = t.rMultiple || 0;
      const tDateStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 10);
      const mStr = tDateStr.substring(0, 7);

      if (mode === 'MONTHLY' && mStr !== currentMonthStr) {
        currentMonthStr = mStr;
        monthlyBalance = balance;
      }

      if (tDateStr !== currentDayStr) {
        dailyStartBalance = balance;
        currentDayStr = tDateStr;
      }

      let riskCapital = 0;
      if (mode === 'CONTINUOUS') {
        riskCapital = balance * (baseRisk * (t.riskMultiplier || 1.0));
      } else if (mode === 'MONTHLY') {
        riskCapital = monthlyBalance * (baseRisk * (t.riskMultiplier || 1.0));
      } else {
        riskCapital = 100.0 * (baseRisk * (t.riskMultiplier || 1.0));
      }

      const pnl = riskCapital * r;
      balance += pnl;

      if (balance > peakBalance) peakBalance = balance;
      const currentDdPct = ((peakBalance - balance) / peakBalance) * 100;
      if (currentDdPct > maxDrawdownPct) maxDrawdownPct = currentDdPct;

      const intradayDdPct = ((dailyStartBalance - balance) / dailyStartBalance) * 100;
      if (intradayDdPct > maxDailyDrawdownPct) maxDailyDrawdownPct = intradayDdPct;

      if (intradayDdPct >= 4.0) {
        circuitBreakerHits++;
      }
    }

    const netReturnPct = ((balance - 100.0) / 100.0) * 100;
    const calmar = maxDrawdownPct > 0 ? netReturnPct / maxDrawdownPct : netReturnPct;

    return {
      baseRisk: (baseRisk * 100).toFixed(1) + "%",
      finalBalance: "$" + balance.toFixed(2),
      returnPct: (netReturnPct > 0 ? "+" : "") + netReturnPct.toFixed(1) + "%",
      maxDrawdownPct: maxDrawdownPct.toFixed(2) + "%",
      maxDailyDrawdownPct: maxDailyDrawdownPct.toFixed(2) + "%",
      calmarRatio: calmar.toFixed(2),
      breakerHits: circuitBreakerHits
    };
  }

  console.log("\n▶ [Mode A] Continuous Dynamic Compounding:");
  console.table(riskSpectrum.map(r => runSimulation(r, 'CONTINUOUS')));

  console.log("\n▶ [Mode B] Monthly Step Compounding:");
  console.table(riskSpectrum.map(r => runSimulation(r, 'MONTHLY')));

  console.log("\n▶ [Mode C] Fixed Dollar Sizing:");
  console.table(riskSpectrum.map(r => runSimulation(r, 'FIXED')));
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2: Comprehensive Month-by-Month Breakdown
// ─────────────────────────────────────────────────────────────────────────────
async function runMonthlyModule(trades: any[]) {
  console.log("\n========================================================================================================================");
  console.log(" 📅 MODULE 2: MONTH-BY-MONTH PORTFOLIO PERFORMANCE TABLE — SHADOW ORCHESTRATOR");
  console.log("========================================================================================================================");

  const monthlyBuckets: Record<string, any[]> = {};
  for (const t of trades) {
    const dStr = t.exitTime || t.entryTime || t.date || t.time || "";
    if (!dStr) continue;
    const mKey = dStr.substring(0, 7);
    if (!monthlyBuckets[mKey]) monthlyBuckets[mKey] = [];
    monthlyBuckets[mKey].push(t);
  }

  const sortedMonths = Object.keys(monthlyBuckets).sort();
  console.log("------------------------------------------------------------------------------------------------------------------------");
  console.log(" MONTH   | TRADES | WINS | WIN %  | RAW NET R   | WEIGHTED NET R | MONTH MAX DD (R) | CUMULATIVE NET R | CUM MAX DD (R)");
  console.log("------------------------------------------------------------------------------------------------------------------------");

  let cumRawR = 0;
  let cumWeightedR = 0;
  let cumPeakWeightedR = 0;
  let cumMaxDdWeightedR = 0;

  let currentYear = sortedMonths[0]?.substring(0, 4) || "";
  let yearRawR = 0;
  let yearWeightedR = 0;
  let yearTrades = 0;
  let yearWins = 0;

  for (const mKey of sortedMonths) {
    const monthTrades = monthlyBuckets[mKey];
    const monthYear = mKey.substring(0, 4);

    if (monthYear !== currentYear) {
      const yrWinPct = yearTrades > 0 ? ((yearWins / yearTrades) * 100).toFixed(1) : "0.0";
      console.log("------------------------------------------------------------------------------------------------------------------------");
      console.log(` 🏆 TOTAL ${currentYear} | Trades: ${String(yearTrades).padStart(4)} | Win%: ${yrWinPct}% | Raw Net R: ${yearRawR >= 0 ? '+' : ''}${yearRawR.toFixed(2)} R | Weighted Net R: ${yearWeightedR >= 0 ? '+' : ''}${yearWeightedR.toFixed(2)} R`);
      console.log("------------------------------------------------------------------------------------------------------------------------");
      currentYear = monthYear;
      yearRawR = 0;
      yearWeightedR = 0;
      yearTrades = 0;
      yearWins = 0;
    }

    let mWins = 0;
    let mRawR = 0;
    let mWeightedR = 0;
    let mPeakR = 0;
    let mMaxDd = 0;

    for (const t of monthTrades) {
      const r = t.rMultiple || 0;
      if (r > 0) mWins++;
      mRawR += r;
      const wR = r * (t.riskMultiplier || 1.0);
      mWeightedR += wR;

      if (mWeightedR > mPeakR) mPeakR = mWeightedR;
      const dd = mPeakR - mWeightedR;
      if (dd > mMaxDd) mMaxDd = dd;

      cumWeightedR += wR;
      if (cumWeightedR > cumPeakWeightedR) cumPeakWeightedR = cumWeightedR;
      const cumDd = cumPeakWeightedR - cumWeightedR;
      if (cumDd > cumMaxDdWeightedR) cumMaxDdWeightedR = cumDd;
    }

    cumRawR += mRawR;
    yearRawR += mRawR;
    yearWeightedR += mWeightedR;
    yearTrades += monthTrades.length;
    yearWins += mWins;

    const winPct = monthTrades.length > 0 ? ((mWins / monthTrades.length) * 100).toFixed(1) : "0.0";
    const rawRStr = (mRawR >= 0 ? "+" : "") + mRawR.toFixed(2) + " R";
    const wRStr = (mWeightedR >= 0 ? "+" : "") + mWeightedR.toFixed(2) + " R";
    const cumWRStr = (cumWeightedR >= 0 ? "+" : "") + cumWeightedR.toFixed(2) + " R";

    console.log(` ${mKey} | ${String(monthTrades.length).padStart(6)} | ${String(mWins).padStart(4)} | ${winPct.padStart(5)}% | ${rawRStr.padStart(11)} | ${wRStr.padStart(14)} | ${mMaxDd.toFixed(2).padStart(14)} R | ${cumWRStr.padStart(14)} | ${cumMaxDdWeightedR.toFixed(2).padStart(13)} R`);
  }

  if (yearTrades > 0) {
    const yrWinPct = ((yearWins / yearTrades) * 100).toFixed(1);
    console.log("------------------------------------------------------------------------------------------------------------------------");
    console.log(` 🏆 TOTAL ${currentYear} | Trades: ${String(yearTrades).padStart(4)} | Win%: ${yrWinPct}% | Raw Net R: ${yearRawR >= 0 ? '+' : ''}${yearRawR.toFixed(2)} R | Weighted Net R: ${yearWeightedR >= 0 ? '+' : ''}${yearWeightedR.toFixed(2)} R`);
    console.log("========================================================================================================================\n");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3: Rolling Inception Cohort Survival Audit
// ─────────────────────────────────────────────────────────────────────────────
async function runCohortsModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 🔬 MODULE 3: ROLLING INCEPTION COHORT SURVIVAL AUDIT — SHADOW ORCHESTRATOR");
  console.log("====================================================================================================");

  const monthlyBuckets: Record<string, boolean> = {};
  for (const t of trades) {
    const dStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 7);
    if (dStr) monthlyBuckets[dStr] = true;
  }
  const cohortStarts = Object.keys(monthlyBuckets).sort().map(m => `${m}-01`);

  const cohortResults = [];

  for (const cStart of cohortStarts) {
    const cTrades = trades.filter(t => {
      const d = t.exitTime || t.entryTime || t.date || t.time || "";
      return d >= cStart;
    });

    let bal = 100.0;
    let peak = 100.0;
    let maxDdPct = 0;
    let maxDailyDdPct = 0;
    let dailyStart = 100.0;
    let curDay = "";
    let circuitedDays = 0;

    for (const t of cTrades) {
      const dStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 10);
      if (dStr !== curDay) {
        curDay = dStr;
        dailyStart = bal;
      }

      const riskCapital = bal * (0.10 * (t.riskMultiplier || 1.0));
      const r = t.rMultiple || 0;
      bal += riskCapital * r;

      if (bal > peak) peak = bal;
      const dd = ((peak - bal) / peak) * 100;
      if (dd > maxDdPct) maxDdPct = dd;

      const dDd = ((dailyStart - bal) / dailyStart) * 100;
      if (dDd > maxDailyDdPct) maxDailyDdPct = dDd;

      if (dDd >= 4.0) circuitedDays++;
    }

    const retPct = ((bal - 100.0) / 100.0) * 100;
    cohortResults.push({
      cohortStart: cStart.substring(0, 7),
      tradesCount: cTrades.length,
      finalBalance: "$" + bal.toFixed(2),
      returnPct: (retPct >= 0 ? "+" : "") + retPct.toFixed(1) + "%",
      maxDdPct: maxDdPct.toFixed(2) + "%",
      maxDailyDdPct: maxDailyDdPct.toFixed(2) + "%",
      circuitedDays,
      status: retPct > 0 ? "🟢 PROFITABLE" : "🔴 LOSS"
    });
  }

  console.table(cohortResults);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 4: Institutional Grid & Prop Firm Maximum Safe Risk Scanner
// ─────────────────────────────────────────────────────────────────────────────
async function runInstitutionalGridModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 🏛️  MODULE 4: INSTITUTIONAL COMPLIANCE GRID & PROP FIRM SCANNER — SHADOW ORCHESTRATOR");
  console.log("====================================================================================================");

  const testRisks = [0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];

  function evaluateInstitutionalScenario(baseRisk: number, dailyCapPct: number, peakToDrawPct: number) {
    let bal = 100.0;
    let highWaterMark = 100.0;
    let startOfDayBal = 100.0;
    let currentDayStr = "";
    let dayHalted = false;
    let daysCircuited = 0;
    let accountHalted = false;
    let maxPeakDdPct = 0;
    let maxDailyLossSeen = 0;
    let consecutiveCircuitedDays = 0;
    let previousDayWasCircuited = false;
    let tradesTaken = 0;

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const dStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 10);

      if (dStr !== currentDayStr) {
        if (dayHalted) {
          consecutiveCircuitedDays = previousDayWasCircuited ? consecutiveCircuitedDays + 1 : 1;
          previousDayWasCircuited = true;
        } else {
          consecutiveCircuitedDays = 0;
          previousDayWasCircuited = false;
        }
        currentDayStr = dStr;
        startOfDayBal = bal;
        dayHalted = false;
      }

      if (accountHalted || dayHalted) continue;

      if (bal > highWaterMark) highWaterMark = bal;
      const currentPeakDdPct = (highWaterMark - bal) / highWaterMark;
      if (currentPeakDdPct > maxPeakDdPct) maxPeakDdPct = currentPeakDdPct;

      if (currentPeakDdPct >= peakToDrawPct) {
        accountHalted = true;
        continue;
      }

      const rho = currentPeakDdPct / peakToDrawPct;
      let institutionalMultiplier = 1.0;
      if (rho >= 0.85) {
        institutionalMultiplier = 0.10;
      } else if (rho >= 0.70) {
        institutionalMultiplier = 0.30;
      } else if (rho >= 0.50) {
        institutionalMultiplier = 0.50;
      }

      let consecutiveDayClamp = 1.0;
      if (consecutiveCircuitedDays === 1) {
        consecutiveDayClamp = 0.50;
      } else if (consecutiveCircuitedDays >= 2) {
        consecutiveDayClamp = 0.25;
      }

      const effectiveRisk = baseRisk * (t.riskMultiplier || 1.0) * institutionalMultiplier * consecutiveDayClamp;
      const riskCapital = bal * effectiveRisk;
      const r = t.rMultiple || 0;
      bal += riskCapital * r;
      tradesTaken++;

      const dailyLoss = (startOfDayBal - bal) / startOfDayBal;
      if (dailyLoss > maxDailyLossSeen) maxDailyLossSeen = dailyLoss;

      if (dailyLoss >= dailyCapPct) {
        dayHalted = true;
        daysCircuited++;
      }
    }

    const netRetPct = ((bal - 100.0) / 100.0) * 100;
    return {
      baseRisk: (baseRisk * 100).toFixed(1) + "%",
      dailyCap: (dailyCapPct * 100).toFixed(1) + "%",
      trailingLimit: (peakToDrawPct * 100).toFixed(1) + "%",
      finalBalance: "$" + bal.toFixed(2),
      netReturn: (netRetPct >= 0 ? "+" : "") + netRetPct.toFixed(1) + "%",
      maxDailyDd: (maxDailyLossSeen * 100).toFixed(2) + "%",
      maxPeakDd: (maxPeakDdPct * 100).toFixed(2) + "%",
      circuitedDays: daysCircuited,
      status: accountHalted ? "🔴 BREACHED" : "🟢 SAFE"
    };
  }

  console.log("\n▶ [Preset: Account A (Conservative) — 2.5% Daily Cap / 6.0% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.025, 0.06)));

  console.log("\n▶ [Preset: Account B (Balanced / Moderate) — 3.0% Daily Cap / 9.5% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.03, 0.095)));

  console.log("\n▶ [Preset: Account C (Aggressive / High Risk) — 10.0% Daily Cap / 40.0% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.10, 0.40)));

  console.log("\n====================================================================================================");
  console.log(" 🎯 MAX RISK SCANNER: HIGHEST ASSIGNABLE RISK WITHOUT BREACHING TRAILING DD");
  console.log("====================================================================================================");

  const fineRisks: number[] = [];
  for (let r = 0.01; r <= 0.605; r += 0.005) {
    fineRisks.push(parseFloat(r.toFixed(3)));
  }

  const accountConfigs = [
    { name: "Account A (Conservative)", dailyCap: 0.025, peakToDraw: 0.060 },
    { name: "Account B (Balanced / Moderate)", dailyCap: 0.030, peakToDraw: 0.095 },
    { name: "Account C (Aggressive / High Risk)", dailyCap: 0.100, peakToDraw: 0.400 },
  ];

  const maxRiskResults: any[] = [];

  for (const acc of accountConfigs) {
    let highestSafeRisk = 0;
    let bestResult: any = null;

    for (const r of fineRisks) {
      const res = evaluateInstitutionalScenario(r, acc.dailyCap, acc.peakToDraw);
      if (res.status === "🟢 SAFE") {
        highestSafeRisk = r;
        bestResult = res;
      }
    }

    if (bestResult) {
      maxRiskResults.push({
        account: acc.name,
        dailyCap: (acc.dailyCap * 100).toFixed(1) + "%",
        trailingMaxDDLimit: (acc.peakToDraw * 100).toFixed(1) + "%",
        maxSafeRisk: (highestSafeRisk * 100).toFixed(1) + "%",
        finalBalance: bestResult.finalBalance,
        netReturn: bestResult.netReturn,
        actualPeakDD: bestResult.maxPeakDd,
        actualMaxDailyDD: bestResult.maxDailyDd,
        circuitedDays: bestResult.circuitedDays
      });
    }
  }

  console.table(maxRiskResults);
}

// ─────────────────────────────────────────────────────────────────────────────
// Master CLI Entry Point
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const modeArg = (args[0] || "all").toLowerCase();
  const is3Yr = args.includes("--3yr") || args.includes("3yr");

  const startDate = is3Yr ? "2023-08-01" : "2026-02-01";
  const endDate = "2026-08-14";

  console.log(`\n========================================================================`);
  console.log(` 🔮 UNIFIED SHADOW ORCHESTRATOR MULTI-PAIR SIMULATOR`);
  console.log(` 🕹️  Command Mode: "${modeArg}" | Multi-Pair Date Range: ${startDate} → ${endDate}`);
  console.log(`========================================================================`);

  const trades = await loadUnifiedPortfolioShadowTrades(startDate, endDate);

  console.log(`\n📦 Loaded ${trades.length} Unified Multi-Pair Shadow Trades (${startDate} → ${endDate})\n`);

  if (modeArg === "modes" || modeArg === "--modes") {
    await runRiskModesModule(trades);
  } else if (modeArg === "monthly" || modeArg === "--monthly") {
    await runMonthlyModule(trades);
  } else if (modeArg === "cohorts" || modeArg === "--cohorts") {
    await runCohortsModule(trades);
  } else if (modeArg === "institutional" || modeArg === "--institutional" || modeArg === "grid" || modeArg === "--grid") {
    await runInstitutionalGridModule(trades);
  } else {
    // Run all modules
    await runRiskModesModule(trades);
    await runMonthlyModule(trades);
    await runCohortsModule(trades);
    await runInstitutionalGridModule(trades);
  }

  console.log("\n🎉 Multi-Pair Shadow Orchestrator Simulation Complete!\n");
}

main();
