// ============================================================
// simulate_portfolio_risk_shadow.ts
//
// Multi-Risk Mode Capital & Drawdown Simulator using Tier 2 Shadow Engine.
// Feeds multiple pairs chronologically into real LiveOrchestrator and
// simulates compounding models (Continuous, Monthly, Fixed, DWCB, Cohorts,
// and Institutional Proximity Scaling) over historical portfolios.
//
// Usage:
//   npx tsx server/trading/testing/simulate_portfolio_risk_shadow.ts [all|modes|monthly|cohorts|institutional] [--3yr]
// Example:
//   npm run backtest:modes:shadow
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { runShadowBacktest } from "../backtester/OrchestratorShadowBacktester.js";
import { clearMageBacktestCache } from "../backtester/MageMathBacktester.js";
import { clearSageBacktestCache } from "../backtester/SageMathBacktester.js";
import { clearSeerBacktestCache } from "../backtester/SeerMathBacktester.js";
import { PairConfigManager, MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG, SEER_PAIR_CONFIG } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { generateMagicNumber } from "../../utils/magicNumber.js";
import { getFixedEstDate } from "../engine/LiveOrchestrator.js";
import parseSeerSetupToConfig from "../optimizer/grandmaster/utils/seer_params_parser.js";

process.env.SIMULATION_MODE = "true";
(global as any).isSimulator = true;

// ─────────────────────────────────────────────────────────────────────────────
// Setup Parser Utility (Mirrors Math Simulator)
// ─────────────────────────────────────────────────────────────────────────────
function parseSetupToConfig(setupStr: string, symbol: string, isSage: boolean): any {
  const parts = setupStr.split("_");
  let session = parts[0];
  if (parts[0] === "NY") session = `NY_${parts[1]}`;

  const findNum = (prefix: string, isSuffix = false): number | undefined => {
    const p = isSuffix
      ? parts.find((item) => item.endsWith(prefix))
      : parts.find((item) => item.startsWith(prefix));
    if (!p) return undefined;
    const raw = isSuffix ? p.slice(0, -prefix.length) : p.slice(prefix.length);
    const num = parseFloat(raw);
    return isNaN(num) ? undefined : num;
  };

  const findStr = (prefix: string): string | undefined => {
    const p = parts.find((item) => item.startsWith(prefix));
    return p ? p.slice(prefix.length) : undefined;
  };

  const baseSym = symbol.split('.')[0].toUpperCase();
  const baseProps = OPTIMIZER_CONFIG[baseSym] || { tickSize: 0.00001, pipSize: 0.0001, spread: 2.0 };

  const parsedPct = findNum("%", true) ?? 0;
  const minSl = findNum("MinSL") ?? 10;
  const maxSl = findNum("MaxSl") ?? findNum("MaxSL") ?? 100;

  if (isSage) {
    const sweep = findNum("Sweep") ?? 0;
    const maxSwp = findNum("MaxSwp") ?? 3;
    const reqCls = findStr("ReqCls") === "true";
    const exitModeStr = findStr("Exit") ?? "TRAILING";
    const trig = findNum("Trig") ?? 0;
    const step = findNum("Step") ?? 0;
    const fc = findNum("FC") ?? 8;
    const startH = findNum("StartH") ?? 0;
    const startM = findNum("StartM") ?? 0;
    const orbMins = findNum("OrbMins") ?? 15;
    const actMins = findNum("ActMins");

    return {
      tickSize: baseProps.tickSize,
      pipSize: baseProps.pipSize,
      spread: baseProps.spread,
      session,
      orbEnabled: true,
      orbStartHour: startH,
      orbStartMin: startM,
      orbMinutes: orbMins,
      actionMinutes: actMins,
      minSlDist: minSl,
      maxSlDist: maxSl,
      entryPenetrationPct: parsedPct,
      sweepPips: sweep,
      maxSweepMultiplier: maxSwp,
      requireCloseInside: reqCls,
      exitMode: exitModeStr,
      trailingSlTrigger: trig,
      trailingSlStep: step,
      forceCloseHours: fc,
      htfAlignmentRequired: true,
      maxH1EmaSlope: 20,
    };
  } else {
    const fc = findNum("FC") ?? 24;
    const exitModeStr = findStr("Exit") ?? "TRAILING";
    const trig = findNum("Trig") ?? 0;
    const step = findNum("Step") ?? 0;
    const startH = findNum("StartH") ?? 0;
    const startM = findNum("StartM") ?? 0;
    const orbMins = findNum("OrbMins") ?? 10;
    const actMins = findNum("ActMins") ?? 60;
    const minBody = findNum("Body") ?? 0;

    return {
      tickSize: baseProps.tickSize,
      pipSize: baseProps.pipSize,
      spread: baseProps.spread,
      session,
      orbEnabled: true,
      orbStartHour: startH,
      orbStartMin: startM,
      orbMinutes: orbMins,
      actionMinutes: actMins,
      minSlDist: minSl,
      maxSlDist: maxSl,
      minBodyPips: minBody,
      exitMode: exitModeStr,
      trailingSlTrigger: trig,
      trailingSlStep: step,
      forceCloseHours: fc,
      htfAlignmentRequired: true,
      maxH1EmaSlope: 20,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Multi-Pair Live Shadow Trade Loader
// ─────────────────────────────────────────────────────────────────────────────
async function loadUnifiedPortfolioShadowTrades(startDate: string, endDate: string, slippagePoints = 0): Promise<any[]> {
  process.stdout.write(`\n🔮 [PORTFOLIO SHADOW] Executing LiveOrchestrator Shadow Backtests (${startDate} → ${endDate})...\n`);

  const jsonPath = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster_holy_grail_portfolios.json");
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Holy Grail portfolio not found at ${jsonPath}`);
  }

  const portfolio: any[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  let allTrades: any[] = [];
  const targetStartMs = new Date(startDate).getTime();

  for (const comp of portfolio) {
    const cleanSym = comp.symbol.replace(/\.daily$/i, "");
    const isMage = comp.botType.toUpperCase() === "MAGE";
    const isSage = comp.botType.toUpperCase() === "SAGE";
    const isSeer = comp.botType.toUpperCase() === "SEER";

    try {
      let cfg: any;
      if (isSeer) {
        const liveCfgs = PairConfigManager.getSeerConfigs(cleanSym);
        const parsed = parseSeerSetupToConfig(comp.setup, cleanSym);
        cfg = (liveCfgs && liveCfgs.length > 0) ? { ...liveCfgs[0] } : parsed;
        if (!cfg.riskPct && comp.riskPct) cfg.riskPct = comp.riskPct;
      } else {
        const liveCfgs = isSage ? PairConfigManager.getSageConfigs(cleanSym) : PairConfigManager.getMageConfigs(cleanSym);
        const parsed = parseSetupToConfig(comp.setup, cleanSym, isSage);
        if (liveCfgs && liveCfgs.length > 0) {
          const match = liveCfgs.find((c: any) =>
            c.orbStartHour === parsed.orbStartHour &&
            c.orbStartMin === parsed.orbStartMin &&
            c.orbMinutes === parsed.orbMinutes
          );
          cfg = match ? { ...match } : parsed;
          if (!cfg.toxicHours && liveCfgs[0]?.toxicHours) cfg.toxicHours = liveCfgs[0].toxicHours;
          if (!cfg.toxicDays && liveCfgs[0]?.toxicDays) cfg.toxicDays = liveCfgs[0].toxicDays;
        } else {
          cfg = parsed;
        }
      }

      const res = await runShadowBacktest(cleanSym, startDate, endDate, {
        enableMage: isMage,
        enableSage: isSage,
        enableSeer: isSeer,
      }, [cfg]);

      const records = res.tradeLog || [];
      const valid = records.filter((r: any) =>
        r.openTime >= targetStartMs &&
        r.outcome !== "SKIPPED" &&
        r.outcome !== "NO_TRADE" &&
        (r.botId?.toUpperCase() === comp.botType.toUpperCase() || (!r.botId && isMage))
      );

      valid.forEach((r: any) => {
        r.pair = cleanSym;
        r.symbol = cleanSym;
        r.bot = comp.botType.toUpperCase();
        r.setup = comp.setup || (cfg.signature || "default");
        r.configKey = `${r.bot} | ${cleanSym} | ${r.setup}`;
        r.riskMultiplier = comp.riskPct || cfg.riskPct || 1.0;
        r.entryTime = new Date(r.openTime).toISOString();
        r.exitTime = new Date(r.closeTime || r.openTime).toISOString();
      });

      allTrades = allTrades.concat(valid);
      if (isMage) clearMageBacktestCache(cleanSym);
      if (isSage) clearSageBacktestCache(cleanSym);
      if (isSeer) clearSeerBacktestCache(cleanSym);
    } catch (e: any) {
      console.error(`[SHADOW] Error running ${cleanSym} (${comp.botType}):`, e.message);
    }
  }

  allTrades.sort((a, b) => (a.openTime || 0) - (b.openTime || 0));

  allTrades.forEach((t: any) => {
    const d = new Date(t.exitTime || t.entryTime || t.date || t.time || t.openTime);
    const estDate = getFixedEstDate(d);
    let y = estDate.getUTCFullYear();
    let m = estDate.getUTCMonth() + 1;
    let day = estDate.getUTCDate();
    if (estDate.getUTCHours() >= 17) {
      const nextD = new Date(estDate.getTime() + 24 * 3600 * 1000);
      y = nextD.getUTCFullYear();
      m = nextD.getUTCMonth() + 1;
      day = nextD.getUTCDate();
    }
    t.simEstDay = `${y}-${m}-${day}`;
  });

  return allTrades;
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
      const tDateStr = t.simEstDay || (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 10);
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
  console.log("\n======================================================================================================================================================");
  console.log(" 📅 MODULE 2: MONTH-BY-MONTH PORTFOLIO PERFORMANCE TABLE — SHADOW ORCHESTRATOR");
  console.log("======================================================================================================================================================");

  const monthlyBuckets: Record<string, any[]> = {};
  for (const t of trades) {
    const dStr = t.exitTime || t.entryTime || t.date || t.time || "";
    if (!dStr) continue;
    const mKey = dStr.substring(0, 7);
    if (!monthlyBuckets[mKey]) monthlyBuckets[mKey] = [];
    monthlyBuckets[mKey].push(t);
  }

  const sortedMonths = Object.keys(monthlyBuckets).sort();
  console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log(" MONTH   | TRADES | WINS | LOSS |  BE  |  WIN %  | LOSS %  |  BE %   | RAW NET R   | WEIGHTED NET R | MONTH MAX DD (R) | CUMULATIVE NET R | CUM MAX DD (R)");
  console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");

  let cumRawR = 0;
  let cumWeightedR = 0;
  let cumPeakWeightedR = 0;
  let cumMaxDdWeightedR = 0;

  let currentYear = sortedMonths[0]?.substring(0, 4) || "";
  let yearRawR = 0;
  let yearWeightedR = 0;
  let yearTrades = 0;
  let yearWins = 0;
  let yearLosses = 0;
  let yearBe = 0;

  for (const mKey of sortedMonths) {
    const monthTrades = monthlyBuckets[mKey];
    const monthYear = mKey.substring(0, 4);

    if (monthYear !== currentYear) {
      const yrWinPct = yearTrades > 0 ? ((yearWins / yearTrades) * 100).toFixed(1) : "0.0";
      const yrLossPct = yearTrades > 0 ? ((yearLosses / yearTrades) * 100).toFixed(1) : "0.0";
      const yrBePct = yearTrades > 0 ? ((yearBe / yearTrades) * 100).toFixed(1) : "0.0";
      console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
      console.log(` 🏆 TOTAL ${currentYear} | Trades: ${String(yearTrades).padStart(4)} | Win%: ${yrWinPct}% | Loss%: ${yrLossPct}% | BE%: ${yrBePct}% | Raw Net R: ${yearRawR >= 0 ? '+' : ''}${yearRawR.toFixed(2)} R | Weighted Net R: ${yearWeightedR >= 0 ? '+' : ''}${yearWeightedR.toFixed(2)} R`);
      console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
      currentYear = monthYear;
      yearRawR = 0;
      yearWeightedR = 0;
      yearTrades = 0;
      yearWins = 0;
      yearLosses = 0;
      yearBe = 0;
    }

    let mWins = 0;
    let mLosses = 0;
    let mBe = 0;
    let mRawR = 0;
    let mWeightedR = 0;
    let mPeakR = 0;
    let mMaxDd = 0;

    for (const t of monthTrades) {
      const r = t.rMultiple || 0;
      if (r > 0.0001) {
        mWins++;
      } else if (r < -0.0001) {
        mLosses++;
      } else {
        mBe++;
      }
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
    yearLosses += mLosses;
    yearBe += mBe;

    const winPct = monthTrades.length > 0 ? ((mWins / monthTrades.length) * 100).toFixed(1) : "0.0";
    const lossPct = monthTrades.length > 0 ? ((mLosses / monthTrades.length) * 100).toFixed(1) : "0.0";
    const bePct = monthTrades.length > 0 ? ((mBe / monthTrades.length) * 100).toFixed(1) : "0.0";
    const rawRStr = (mRawR >= 0 ? "+" : "") + mRawR.toFixed(2) + " R";
    const wRStr = (mWeightedR >= 0 ? "+" : "") + mWeightedR.toFixed(2) + " R";
    const cumWRStr = (cumWeightedR >= 0 ? "+" : "") + cumWeightedR.toFixed(2) + " R";

    console.log(` ${mKey} | ${String(monthTrades.length).padStart(6)} | ${String(mWins).padStart(4)} | ${String(mLosses).padStart(4)} | ${String(mBe).padStart(4)} | ${winPct.padStart(6)}% | ${lossPct.padStart(6)}% | ${bePct.padStart(6)}% | ${rawRStr.padStart(11)} | ${wRStr.padStart(14)} | ${mMaxDd.toFixed(2).padStart(14)} R | ${cumWRStr.padStart(14)} | ${cumMaxDdWeightedR.toFixed(2).padStart(13)} R`);
  }

  if (yearTrades > 0) {
    const yrWinPct = ((yearWins / yearTrades) * 100).toFixed(1);
    const yrLossPct = ((yearLosses / yearTrades) * 100).toFixed(1);
    const yrBePct = ((yearBe / yearTrades) * 100).toFixed(1);
    console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
    console.log(` 🏆 TOTAL ${currentYear} | Trades: ${String(yearTrades).padStart(4)} | Win%: ${yrWinPct}% | Loss%: ${yrLossPct}% | BE%: ${yrBePct}% | Raw Net R: ${yearRawR >= 0 ? '+' : ''}${yearRawR.toFixed(2)} R | Weighted Net R: ${yearWeightedR >= 0 ? '+' : ''}${yearWeightedR.toFixed(2)} R`);
    console.log("======================================================================================================================================================\n");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2B: Per-Pair Month-by-Month Net R Contribution Matrix
// ─────────────────────────────────────────────────────────────────────────────
async function runPerPairMonthlyMatrixModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 📊 MODULE 2B: PER-PAIR MONTH-BY-MONTH NET R CONTRIBUTION MATRIX (Raw Net R) — SHADOW");
  console.log("====================================================================================================");

  const symbols = Array.from(new Set(trades.map(t => t.symbol || t.pair))).sort();
  const monthlyBuckets: Record<string, boolean> = {};
  for (const t of trades) {
    const dStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 7);
    if (dStr && dStr.length === 7) monthlyBuckets[dStr] = true;
  }
  const months = Object.keys(monthlyBuckets).sort();

  const matrix: Record<string, Record<string, { r: number; trades: number; wins: number }>> = {};
  for (const sym of symbols) {
    matrix[sym] = {};
    for (const m of months) {
      matrix[sym][m] = { r: 0, trades: 0, wins: 0 };
    }
  }

  for (const t of trades) {
    const sym = t.symbol || t.pair;
    const m = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 7);
    if (matrix[sym] && matrix[sym][m]) {
      const r = t.rMultiple || 0;
      matrix[sym][m].r += r;
      matrix[sym][m].trades++;
      if (r > 0) matrix[sym][m].wins++;
    }
  }

  const colWidth = 9;
  const symHeader = symbols.map(s => s.padStart(colWidth)).join(" | ");
  console.log(` MONTH   | ${symHeader} |    TOTAL`);
  console.log(`---------+-${symbols.map(() => "---------").join("-+-")}---+---------`);

  let currentYear = months[0]?.substring(0, 4) || "";
  const yearPairTotals: Record<string, number> = {};
  for (const sym of symbols) yearPairTotals[sym] = 0;
  let yearGrandTotal = 0;

  for (const m of months) {
    const y = m.substring(0, 4);
    if (y !== currentYear) {
      console.log(`---------+-${symbols.map(() => "---------").join("-+-")}---+---------`);
      const yrSummary = symbols.map(s => {
        const rVal = yearPairTotals[s];
        const str = (rVal >= 0 ? "+" : "") + rVal.toFixed(1) + "R";
        return str.padStart(colWidth);
      }).join(" | ");
      const yrTotStr = (yearGrandTotal >= 0 ? "+" : "") + yearGrandTotal.toFixed(1) + "R";
      console.log(` ${currentYear} YR | ${yrSummary} | ${yrTotStr.padStart(8)}`);
      console.log(`---------+-${symbols.map(() => "---------").join("-+-")}---+---------`);

      currentYear = y;
      for (const sym of symbols) yearPairTotals[sym] = 0;
      yearGrandTotal = 0;
    }

    let monthTotal = 0;
    const rowCols = symbols.map(s => {
      const cell = matrix[s][m];
      monthTotal += cell.r;
      yearPairTotals[s] += cell.r;
      if (cell.trades === 0) return "-".padStart(colWidth);
      const str = (cell.r >= 0 ? "+" : "") + cell.r.toFixed(1) + "R";
      return str.padStart(colWidth);
    });

    yearGrandTotal += monthTotal;
    const mTotStr = (monthTotal >= 0 ? "+" : "") + monthTotal.toFixed(1) + "R";
    console.log(` ${m} | ${rowCols.join(" | ")} | ${mTotStr.padStart(8)}`);
  }

  console.log(`---------+-${symbols.map(() => "---------").join("-+-")}---+---------`);
  const finalYrSummary = symbols.map(s => {
    const rVal = yearPairTotals[s];
    const str = (rVal >= 0 ? "+" : "") + rVal.toFixed(1) + "R";
    return str.padStart(colWidth);
  }).join(" | ");
  const finalYrTotStr = (yearGrandTotal >= 0 ? "+" : "") + yearGrandTotal.toFixed(1) + "R";
  console.log(` ${currentYear} YR | ${finalYrSummary} | ${finalYrTotStr.padStart(8)}`);
  console.log(`====================================================================================================`);

  // ─────────────────────────────────────────────────────────
  // Per-Config Performance Audit (Net R & Max Drawdown in R)
  // ─────────────────────────────────────────────────────────
  console.log(`\n🏆 ALL-TIME PER-CONFIG PERFORMANCE & DRAWDOWN AUDIT:`);
  
  const configGroups = new Map<string, {
    bot: string;
    symbol: string;
    setup: string;
    trades: any[];
  }>();

  for (const t of trades) {
    const key = t.configKey || `${t.bot || "BOT"} | ${t.symbol || t.pair} | ${t.setup || "default"}`;
    if (!configGroups.has(key)) {
      configGroups.set(key, {
        bot: t.bot || "BOT",
        symbol: t.symbol || t.pair,
        setup: t.setup || "default",
        trades: [],
      });
    }
    configGroups.get(key)!.trades.push(t);
  }

  const configSummaryTable: any[] = [];

  for (const [key, grp] of configGroups.entries()) {
    // Chronological sort for accurate drawdown calculation
    grp.trades.sort((a, b) => {
      const timeA = new Date(a.exitTime || a.entryTime || a.date || a.time || a.openTime).getTime();
      const timeB = new Date(b.exitTime || b.entryTime || b.date || b.time || b.openTime).getTime();
      return timeA - timeB;
    });

    let totalR = 0;
    let wins = 0;
    let peakR = 0;
    let maxDd = 0;

    for (const t of grp.trades) {
      const r = t.rMultiple || 0;
      totalR += r;
      if (r > 0.0001) wins++;

      if (totalR > peakR) peakR = totalR;
      const dd = peakR - totalR;
      if (dd > maxDd) maxDd = dd;
    }

    const tradeCount = grp.trades.length;
    const winPct = tradeCount > 0 ? ((wins / tradeCount) * 100).toFixed(1) + "%" : "0.0%";
    const avgR = tradeCount > 0 ? (totalR / tradeCount).toFixed(2) + " R" : "0.00 R";

    configSummaryTable.push({
      Bot: grp.bot,
      Symbol: grp.symbol,
      Setup: grp.setup,
      Trades: tradeCount,
      Wins: wins,
      "Win %": winPct,
      "Net R": (totalR >= 0 ? "+" : "") + totalR.toFixed(2) + " R",
      "Max DD (R)": maxDd.toFixed(2) + " R",
      "Avg R": avgR,
    });
  }

  configSummaryTable.sort((a, b) => parseFloat(b["Net R"]) - parseFloat(a["Net R"]));
  console.table(configSummaryTable);
  console.log("====================================================================================================\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3: Isolated Single-Month Compounding Performance Audit (10% Risk) — Shadow
// ─────────────────────────────────────────────────────────────────────────────
async function runCohortsModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 🔬 MODULE 3: ISOLATED SINGLE-MONTH PERFORMANCE AUDIT ($100 Starting Balance Reset Each Month)");
  console.log("====================================================================================================");

  const monthlyBuckets: Record<string, boolean> = {};
  for (const t of trades) {
    const dStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 7);
    if (dStr && dStr.length === 7) monthlyBuckets[dStr] = true;
  }
  const months = Object.keys(monthlyBuckets).sort();

  const results = [];

  for (const mKey of months) {
    const monthTrades = trades.filter(t => {
      const d = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 7);
      return d === mKey;
    });

    if (monthTrades.length === 0) continue;

    let bal = 100.0;
    let peak = 100.0;
    let maxDdPct = 0;
    let maxDailyDdPct = 0;
    let dailyStart = 100.0;
    let curDay = "";
    let circuitedDays = 0;

    let wins = 0;
    for (const t of monthTrades) {
      const dStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 10);
      if (dStr !== curDay) {
        curDay = dStr;
        dailyStart = bal;
      }

      const r = t.rMultiple || 0;
      if (r > 0) wins++;
      const riskCapital = bal * (0.10 * (t.riskMultiplier || 1.0));
      bal += riskCapital * r;

      if (bal > peak) peak = bal;
      const dd = ((peak - bal) / peak) * 100;
      if (dd > maxDdPct) maxDdPct = dd;

      const dDd = ((dailyStart - bal) / dailyStart) * 100;
      if (dDd > maxDailyDdPct) maxDailyDdPct = dDd;

      if (dDd >= 4.0) circuitedDays++;
    }

    const retPct = ((bal - 100.0) / 100.0) * 100;
    const wr = (wins / monthTrades.length) * 100;
    results.push({
      month: mKey,
      tradesCount: monthTrades.length,
      winRate: wr.toFixed(1) + "%",
      startBalance: "$100.00",
      finalBalance: "$" + bal.toFixed(2),
      monthlyReturn: (retPct >= 0 ? "+" : "") + retPct.toFixed(1) + "%",
      maxDailyDd: maxDailyDdPct.toFixed(2) + "%",
      maxPeakDd: maxDdPct.toFixed(2) + "%",
      circuitedDays,
      status: retPct > 0 ? "🟢 PROFITABLE" : "🔴 LOSS"
    });
  }

  console.table(results);
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

      // 🛡️ Pre-Trade Daily Headroom Protection (Preventative Sizing)
      const currentDailyLoss = Math.max(0, (startOfDayBal - bal) / startOfDayBal);
      const remainingHeadroom = Math.max(0, dailyCapPct - currentDailyLoss);

      // If remaining headroom is smaller than 0.15% (e.g. >=90% of daily cap consumed), halt new entries for the day
      if (remainingHeadroom <= 0.0015 || currentDailyLoss >= dailyCapPct * 0.90) {
        dayHalted = true;
        daysCircuited++;
        continue;
      }

      // Clamp incoming trade risk so that even a maximum worst-case -1.0R loss CANNOT breach the daily cap
      const maxRiskAllowedByDailyCap = remainingHeadroom * 0.85; // 15% safety buffer for adverse slippage

      const nominalRisk = baseRisk * (t.riskMultiplier || 1.0) * institutionalMultiplier * consecutiveDayClamp;
      const effectiveRisk = Math.min(nominalRisk, maxRiskAllowedByDailyCap);
      const riskCapital = bal * effectiveRisk;
      const r = t.rMultiple || 0;
      bal += riskCapital * r;
      tradesTaken++;

      const postTradeDailyLoss = (startOfDayBal - bal) / startOfDayBal;
      if (postTradeDailyLoss > maxDailyLossSeen) maxDailyLossSeen = postTradeDailyLoss;

      if (postTradeDailyLoss >= dailyCapPct * 0.90) {
        dayHalted = true;
        daysCircuited++;
      }

      if (postTradeDailyLoss > dailyCapPct + 0.0001) {
        accountHalted = true; // Breached daily cap!
      }
    }

    const netRetPct = ((bal - 100.0) / 100.0) * 100;
    const isBreached = accountHalted || (maxDailyLossSeen > dailyCapPct + 0.0001);
    return {
      baseRisk: (baseRisk * 100).toFixed(1) + "%",
      dailyCap: (dailyCapPct * 100).toFixed(1) + "%",
      trailingLimit: (peakToDrawPct * 100).toFixed(1) + "%",
      finalBalance: "$" + bal.toFixed(2),
      rawFinalBal: bal,
      netReturn: (netRetPct >= 0 ? "+" : "") + netRetPct.toFixed(1) + "%",
      maxDailyDd: (maxDailyLossSeen * 100).toFixed(2) + "%",
      maxPeakDd: (maxPeakDdPct * 100).toFixed(2) + "%",
      circuitedDays: daysCircuited,
      status: isBreached ? "🔴 BREACHED" : "🟢 SAFE"
    };
  }

  console.log("\n▶ [Preset: Account A (Conservative) — 2.5% Daily Cap / 5.5% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.025, 0.055)));

  // 2. Account B (Balanced / Moderate Profile — 3.0% Daily Cap / 9.5% Trailing Max DD)
  console.log("\n▶ [Preset: Account B (Balanced / Moderate) — 3.0% Daily Cap / 9.5% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.03, 0.095)));

  // 3. Account C (Aggressive / High Risk Profile — 10.0% Daily Cap / 40.0% Trailing Max DD)
  console.log("\n▶ [Preset: Account C (Aggressive / High Risk) — 10.0% Daily Cap / 40.0% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.10, 0.40)));

  console.log("\n▶ [Preset: Account D (Unconstrained Optimal Growth) — 100.0% Daily Cap / 100.0% Trailing Max DD]");
  console.table([0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.75, 1.00].map(r => evaluateInstitutionalScenario(r, 1.00, 1.00)));

  console.log("\n====================================================================================================");
  console.log(" 🎯 MAX / OPTIMAL RISK SCANNER: HIGHEST SAFE & OPTIMAL RISK MULTIPLIER");
  console.log("====================================================================================================");

  const fineRisks: number[] = [];
  for (let r = 0.005; r <= 1.005; r += 0.005) {
    fineRisks.push(parseFloat(r.toFixed(3)));
  }

  const accountConfigs = [
    { name: "Account A (Conservative)", dailyCap: 0.025, peakToDraw: 0.055 },
    { name: "Account B (Balanced / Moderate)", dailyCap: 0.030, peakToDraw: 0.095 },
    { name: "Account C (High Equity Prop)", dailyCap: 0.200, peakToDraw: 0.500 },
    { name: "Account D (Aggressive / High Risk)", dailyCap: 0.100, peakToDraw: 0.400 },
    { name: "Account E (Optimal Growth / 100% Unconstrained)", dailyCap: 1.000, peakToDraw: 1.000 },
  ];

  const maxRiskResults: any[] = [];

  for (const acc of accountConfigs) {
    let optimalOrMaxRisk = 0;
    let bestResult: any = null;

    for (const r of fineRisks) {
      const res = evaluateInstitutionalScenario(r, acc.dailyCap, acc.peakToDraw);
      if (res.status === "🟢 SAFE" && parseFloat(res.maxDailyDd) <= (acc.dailyCap * 100 + 0.01)) {
        if (acc.peakToDraw >= 0.99) {
          // For Account D (100% Cap / 100% DD), find the optimal Kelly growth peak (max final balance)
          if (!bestResult || res.rawFinalBal > bestResult.rawFinalBal) {
            optimalOrMaxRisk = r;
            bestResult = res;
          }
        } else {
          // For prop firm accounts, find highest risk without breaching DD ceiling
          optimalOrMaxRisk = r;
          bestResult = res;
        }
      }
    }

    if (bestResult) {
      maxRiskResults.push({
        account: acc.name,
        dailyCap: (acc.dailyCap * 100).toFixed(1) + "%",
        trailingMaxDDLimit: (acc.peakToDraw * 100).toFixed(1) + "%",
        optimalOrMaxSafeRisk: (optimalOrMaxRisk * 100).toFixed(1) + "%",
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
  const modeArg = (args.find(a => !a.startsWith("-") && !/^\d{4}-\d{2}-\d{2}$/.test(a)) || "all").toLowerCase();
  const is3Yr = args.includes("--3yr") || args.includes("3yr");
  const csvDir = path.join(process.cwd(), "data", "csv");
  let dynamicEnd = "2026-08-14";
  try {
    const csvFiles = fs.readdirSync(csvDir).filter((f) => f.endsWith(".csv"));
    if (csvFiles.length > 0) {
      const { getLatestDate } = await import("../backtester/loadCsv.js");
      const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
      dynamicEnd = latestDate.toISOString().substring(0, 10);
    }
  } catch {}

  const dateArgs = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const endDate = dateArgs.length >= 2 ? dateArgs[1] : dynamicEnd;
  const sd = new Date(new Date(endDate).getTime());
  sd.setFullYear(sd.getFullYear() - (is3Yr ? 3 : 1));
  const startDate = dateArgs.length >= 1 ? dateArgs[0] : sd.toISOString().substring(0, 10);

  const slipArg = args.find(a => a.startsWith("--slip") || a.startsWith("--slippage"));
  const slippagePoints = slipArg ? parseInt(slipArg.split("=")[1] || "0", 10) : 0;

  console.log(`\n========================================================================`);
  console.log(` 🔮 UNIFIED SHADOW ORCHESTRATOR MULTI-PAIR SIMULATOR`);
  console.log(` 🕹️  Command Mode: "${modeArg}" | Multi-Pair Date Range: ${startDate} → ${endDate}`);
  console.log(`========================================================================`);

  const trades = await loadUnifiedPortfolioShadowTrades(startDate, endDate, slippagePoints);

  console.log(`\n📦 Loaded ${trades.length} Unified Multi-Pair Shadow Trades (${startDate} → ${endDate})\n`);

  if (modeArg === "modes" || modeArg === "--modes") {
    await runRiskModesModule(trades);
  } else if (modeArg === "monthly" || modeArg === "--monthly") {
    await runMonthlyModule(trades);
    await runPerPairMonthlyMatrixModule(trades);
  } else if (modeArg === "cohorts" || modeArg === "--cohorts") {
    await runCohortsModule(trades);
  } else if (modeArg === "institutional" || modeArg === "--institutional" || modeArg === "grid" || modeArg === "--grid") {
    await runInstitutionalGridModule(trades);
  } else {
    // Run all modules
    await runRiskModesModule(trades);
    await runMonthlyModule(trades);
    await runPerPairMonthlyMatrixModule(trades);
    await runCohortsModule(trades);
    await runInstitutionalGridModule(trades);
  }

  console.log("\n🎉 Multi-Pair Shadow Orchestrator Simulation Complete!\n");
}

main();
