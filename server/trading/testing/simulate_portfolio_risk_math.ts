// ============================================================
// simulate_portfolio_risk_math.ts
//
// Multi-Risk Mode Capital & Drawdown Simulator using Tier 1 Math Engine.
// Simulates compounding models (Continuous, Monthly, Fixed, DWCB, Cohorts,
// and Institutional Proximity Scaling) over historical portfolios.
//
// Usage:
//   npx tsx server/trading/testing/simulate_portfolio_risk_math.ts [all|modes|monthly|cohorts|institutional]
// Example:
//   npm run backtest:modes
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { runMathBacktest as runMageMathBacktest, clearMageBacktestCache } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest, clearSageBacktestCache } from "../backtester/SageMathBacktester.js";
import { runSeerMathBacktest, clearSeerBacktestCache } from "../backtester/SeerMathBacktester.js";
import { clearCsvCache } from "../backtester/loadCsv.js";
import { PairConfigManager, MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG, SEER_PAIR_CONFIG } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { getFixedEstDate } from "../engine/LiveOrchestrator.js";
import parseSeerSetupToConfig from "../optimizer/grandmaster/utils/seer_params_parser.js";

// ─────────────────────────────────────────────────────────────────────────────
// Setup Parser Utility
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
      htfAlignmentRequired: false,
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
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Trade Loader
// ─────────────────────────────────────────────────────────────────────────────
export async function loadPortfolioTrades(startDate: string, endDate: string): Promise<any[]> {
  const jsonPath = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster_holy_grail_portfolios.json");
  let allTrades: any[] = [];

  if (fs.existsSync(jsonPath)) {
    const portfolio: any[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    for (const comp of portfolio) {
      const cleanSym = comp.symbol.replace(/\.daily$/i, "");
      const isSage = comp.botType === "Sage";
      const isSeer = comp.botType === "Seer";

      if (isSeer) {
        const liveCfgs = PairConfigManager.getSeerConfigs(cleanSym);
        const parsed = parseSeerSetupToConfig(comp.setup, cleanSym);
        let cfg: any = (liveCfgs && liveCfgs.length > 0) ? { ...liveCfgs[0] } : parsed;
        if (!cfg.riskPct && comp.riskPct) cfg.riskPct = comp.riskPct;
        try {
          const res = await runSeerMathBacktest(cleanSym, startDate, endDate, false, {}, [cfg], false);
          const records = res.records || (Array.isArray(res) ? res : []);
          const valid = records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
          valid.forEach((r: any) => {
            r.symbol = cleanSym;
            r.pair = cleanSym;
            r.bot = "SEER";
            r.setup = comp.setup || (cfg.signature || "default");
            r.configKey = `${r.bot} | ${cleanSym} | ${r.setup}`;
            r.riskMultiplier = comp.riskPct || cfg.riskPct || 1.0;
          });
          allTrades = allTrades.concat(valid);
          clearSeerBacktestCache(cleanSym);
        } catch (e: any) {
          console.error(`[Loader] Error on ${cleanSym} (SEER):`, e.message);
        }
      } else {
        const liveCfgs = isSage ? PairConfigManager.getSageConfigs(cleanSym) : PairConfigManager.getMageConfigs(cleanSym);
        const parsed = parseSetupToConfig(comp.setup, cleanSym, isSage);
        let cfg: any;
        if (liveCfgs && liveCfgs.length > 0) {
          const match = liveCfgs.find((c: any) =>
            c.orbStartHour === parsed.orbStartHour &&
            c.orbStartMin === parsed.orbStartMin &&
            c.orbMinutes === parsed.orbMinutes &&
            c.session === parsed.session &&
            c.exitMode === parsed.exitMode
          ) || liveCfgs.find((c: any) =>
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
        try {
          const res = isSage
            ? await runSageMathBacktest(cleanSym, startDate, endDate, false, {}, [cfg])
            : await runMageMathBacktest(cleanSym, startDate, endDate, false, undefined, undefined, null, [cfg]);
          const records = res.records || (Array.isArray(res) ? res : []);
          const valid = records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
          valid.forEach((r: any) => {
            r.symbol = cleanSym;
            r.pair = cleanSym;
            r.bot = comp.botType.toUpperCase();
            r.setup = comp.setup || (cfg.signature || "default");
            r.configKey = `${r.bot} | ${cleanSym} | ${r.setup}`;
            r.riskMultiplier = comp.riskPct || 1.0;
          });
          allTrades = allTrades.concat(valid);
          if (isSage) clearSageBacktestCache(cleanSym);
          else clearMageBacktestCache(cleanSym);
        } catch (e: any) {
          console.error(`[Loader] Error on ${cleanSym} (${comp.botType}):`, e.message);
        }
        clearCsvCache();
      }
    }
  } else {
    const botPairs = [
      { bot: "MAGE", pairs: Object.keys(MAGE_PAIR_CONFIG) },
      { bot: "SAGE", pairs: Object.keys(SAGE_PAIR_CONFIG || {}) },
      { bot: "SEER", pairs: Object.keys(SEER_PAIR_CONFIG || {}) },
    ];
    for (const group of botPairs) {
      const { bot, pairs } = group;
      for (const pair of pairs) {
        try {
          if (bot === "MAGE") {
            const configs = PairConfigManager.getMageConfigs(pair);
            for (const c of configs) {
              const res = await runMageMathBacktest(pair, startDate, endDate, false, undefined, undefined, null, [c], false);
              const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
              valid.forEach((r: any) => { r.bot = bot; r.pair = pair; r.symbol = pair; r.riskMultiplier = c.riskPct || 1.0; });
              allTrades = allTrades.concat(valid);
            }
          } else if (bot === "SAGE") {
            const configs = PairConfigManager.getSageConfigs(pair);
            for (const c of configs) {
              const res = await runSageMathBacktest(pair, startDate, endDate, false, {}, [c], false);
              const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
              valid.forEach((r: any) => { r.bot = bot; r.pair = pair; r.symbol = pair; r.riskMultiplier = c.riskPct || 1.0; });
              allTrades = allTrades.concat(valid);
            }
          } else if (bot === "SEER") {
            const configs = PairConfigManager.getSeerConfigs(pair);
            for (const c of configs) {
              const res = await runSeerMathBacktest(pair, startDate, endDate, false, {}, [c], false);
              const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
              valid.forEach((r: any) => { r.bot = bot; r.pair = pair; r.symbol = pair; r.riskMultiplier = c.riskPct || 1.0; });
              allTrades = allTrades.concat(valid);
            }
          }
        } catch (e: any) {
          console.error(`[Loader] Error on ${pair} for ${bot}:`, e.message);
        }
      }
    }
  }

  // Sort strictly chronological
  allTrades.sort((a, b) => {
    const timeA = new Date(a.exitTime || a.entryTime || a.date || a.time).getTime();
    const timeB = new Date(b.exitTime || b.entryTime || b.date || b.time).getTime();
    return timeA - timeB;
  });

  allTrades.forEach((t: any) => {
    const d = new Date(t.exitTime || t.entryTime || t.date || t.time);
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
  console.log(" 💰 MODULE 1: MULTI-RISK MODE SIMULATION ($100 Starting Balance)");
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
// MODULE 2: Comprehensive 3-Year Monthly Breakdown
// ─────────────────────────────────────────────────────────────────────────────
async function runMonthlyModule(trades: any[]) {
  console.log("\n======================================================================================================================================================");
  console.log(" 📅 MODULE 2: 3-YEAR MONTH-BY-MONTH PORTFOLIO PERFORMANCE TABLE");
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
    const y = mKey.substring(0, 4);

    if (y !== currentYear) {
      const yWinPct = yearTrades > 0 ? (yearWins / yearTrades) * 100 : 0;
      const yLossPct = yearTrades > 0 ? (yearLosses / yearTrades) * 100 : 0;
      const yBePct = yearTrades > 0 ? (yearBe / yearTrades) * 100 : 0;
      console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
      console.log(` 🏆 TOTAL ${currentYear} | Trades: ${String(yearTrades).padStart(4)} | Win%: ${yWinPct.toFixed(1)}% | Loss%: ${yLossPct.toFixed(1)}% | BE%: ${yBePct.toFixed(1)}% | Raw Net R: +${yearRawR.toFixed(2)} R | Weighted Net R: +${yearWeightedR.toFixed(2)} R`);
      console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
      currentYear = y;
      yearRawR = 0;
      yearWeightedR = 0;
      yearTrades = 0;
      yearWins = 0;
      yearLosses = 0;
      yearBe = 0;
    }

    let mRawR = 0;
    let mWeightedR = 0;
    let mWins = 0;
    let mLosses = 0;
    let mBe = 0;
    let mPeakWeightedR = 0;
    let mMaxDdWeightedR = 0;

    for (const t of monthTrades) {
      const r = t.rMultiple || 0;
      const wR = r * (t.riskMultiplier || 1.0);
      mRawR += r;
      mWeightedR += wR;
      if (r > 0.0001) {
        mWins++;
      } else if (r < -0.0001) {
        mLosses++;
      } else {
        mBe++;
      }

      if (mWeightedR > mPeakWeightedR) mPeakWeightedR = mWeightedR;
      const dd = mPeakWeightedR - mWeightedR;
      if (dd > mMaxDdWeightedR) mMaxDdWeightedR = dd;

      cumRawR += r;
      cumWeightedR += wR;
      if (cumWeightedR > cumPeakWeightedR) cumPeakWeightedR = cumWeightedR;
      const cDd = cumPeakWeightedR - cumWeightedR;
      if (cDd > cumMaxDdWeightedR) cumMaxDdWeightedR = cDd;
    }

    yearRawR += mRawR;
    yearWeightedR += mWeightedR;
    yearTrades += monthTrades.length;
    yearWins += mWins;
    yearLosses += mLosses;
    yearBe += mBe;

    const winPct = monthTrades.length > 0 ? (mWins / monthTrades.length) * 100 : 0;
    const lossPct = monthTrades.length > 0 ? (mLosses / monthTrades.length) * 100 : 0;
    const bePct = monthTrades.length > 0 ? (mBe / monthTrades.length) * 100 : 0;
    const rawRStr = (mRawR >= 0 ? "+" : "") + mRawR.toFixed(2) + " R";
    const wRStr = (mWeightedR >= 0 ? "+" : "") + mWeightedR.toFixed(2) + " R";
    const cumRStr = (cumWeightedR >= 0 ? "+" : "") + cumWeightedR.toFixed(2) + " R";

    console.log(
      ` ${mKey} | ${String(monthTrades.length).padStart(6)} | ${String(mWins).padStart(4)} | ${String(mLosses).padStart(4)} | ${String(mBe).padStart(4)} | ${winPct.toFixed(1).padStart(6)}% | ${lossPct.toFixed(1).padStart(6)}% | ${bePct.toFixed(1).padStart(6)}% | ${rawRStr.padStart(11)} | ${wRStr.padStart(14)} | ${mMaxDdWeightedR.toFixed(2).padStart(14)} R | ${cumRStr.padStart(14)} | ${cumMaxDdWeightedR.toFixed(2).padStart(12)} R`
    );
  }

  const finalYearWinPct = yearTrades > 0 ? (yearWins / yearTrades) * 100 : 0;
  const finalYearLossPct = yearTrades > 0 ? (yearLosses / yearTrades) * 100 : 0;
  const finalYearBePct = yearTrades > 0 ? (yearBe / yearTrades) * 100 : 0;
  console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log(` 🏆 TOTAL ${currentYear} | Trades: ${String(yearTrades).padStart(4)} | Win%: ${finalYearWinPct.toFixed(1)}% | Loss%: ${finalYearLossPct.toFixed(1)}% | BE%: ${finalYearBePct.toFixed(1)}% | Raw Net R: +${yearRawR.toFixed(2)} R | Weighted Net R: +${yearWeightedR.toFixed(2)} R`);
  console.log("======================================================================================================================================================\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2D: Week-by-Week Portfolio Performance Breakdown
// ─────────────────────────────────────────────────────────────────────────────
async function runWeeklyModule(trades: any[]) {
  console.log("\n======================================================================================================================================================");
  console.log(" 📅 MODULE 2D: WEEK-BY-WEEK PORTFOLIO PERFORMANCE TABLE");
  console.log("======================================================================================================================================================");

  function getTradingWeek(date: Date) {
    const d = new Date(date.getTime());
    const day = d.getUTCDay();
    const diffToMonday = day === 0 ? 1 : (1 - day);
    const monday = new Date(d.getTime() + diffToMonday * 86400000);
    const friday = new Date(monday.getTime() + 4 * 86400000);
    const mIso = monday.toISOString().substring(0, 10);
    const fIso = friday.toISOString().substring(0, 10);
    
    const target = new Date(monday.getTime());
    target.setUTCDate(target.getUTCDate() + 3);
    const firstJan = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((target.getTime() - firstJan.getTime()) / 86400000) + 1) / 7);
    const year = target.getUTCFullYear();
    const weekKey = `${year}-W${String(weekNum).padStart(2, "0")}`;
    return { weekKey, mondayStr: mIso, fridayStr: fIso, label: `${weekKey} (${mIso} → ${fIso})` };
  }

  const weeklyBuckets: Record<string, { label: string; trades: any[] }> = {};
  for (const t of trades) {
    const dStr = t.exitTime || t.entryTime || t.date || t.time || "";
    if (!dStr) continue;
    const cleanStr = dStr.includes("T") ? dStr : dStr.replace(" ", "T");
    const d = new Date(cleanStr);
    if (isNaN(d.getTime())) continue;
    const { weekKey, label } = getTradingWeek(d);
    if (!weeklyBuckets[weekKey]) weeklyBuckets[weekKey] = { label, trades: [] };
    weeklyBuckets[weekKey].trades.push(t);
  }

  const sortedWeeks = Object.keys(weeklyBuckets).sort();
  console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log(" WEEK KEY & SPAN                    | TRADES | WINS | LOSS |  BE  |  WIN %  | LOSS %  |  BE %   | RAW NET R   | WEIGHTED NET R | WEEK MAX DD (R) | CUMULATIVE NET R | STATUS");
  console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");

  let cumRawR = 0;
  let cumWeightedR = 0;
  let cumPeakWeightedR = 0;
  let cumMaxDdWeightedR = 0;

  let winWeeks = 0;
  let lossWeeks = 0;
  let beWeeks = 0;
  let bestWeek = { label: "", rawR: -Infinity };
  let worstWeek = { label: "", rawR: Infinity };

  for (const wKey of sortedWeeks) {
    const { label, trades: wTrades } = weeklyBuckets[wKey];
    let wRawR = 0;
    let wWeightedR = 0;
    let wWins = 0;
    let wLosses = 0;
    let wBe = 0;
    let wPeakWeightedR = 0;
    let wMaxDdWeightedR = 0;

    for (const t of wTrades) {
      const r = t.rMultiple || 0;
      const wR = r * (t.riskMultiplier || 1.0);
      wRawR += r;
      wWeightedR += wR;
      if (r > 0.0001) {
        wWins++;
      } else if (r < -0.0001) {
        wLosses++;
      } else {
        wBe++;
      }

      if (wWeightedR > wPeakWeightedR) wPeakWeightedR = wWeightedR;
      const dd = wPeakWeightedR - wWeightedR;
      if (dd > wMaxDdWeightedR) wMaxDdWeightedR = dd;

      cumRawR += r;
      cumWeightedR += wR;
      if (cumWeightedR > cumPeakWeightedR) cumPeakWeightedR = cumWeightedR;
      const cDd = cumPeakWeightedR - cumWeightedR;
      if (cDd > cumMaxDdWeightedR) cumMaxDdWeightedR = cDd;
    }

    if (wRawR > 0.05) winWeeks++;
    else if (wRawR < -0.05) lossWeeks++;
    else beWeeks++;

    if (wRawR > bestWeek.rawR) bestWeek = { label, rawR: wRawR };
    if (wRawR < worstWeek.rawR) worstWeek = { label, rawR: wRawR };

    const winPct = wTrades.length > 0 ? (wWins / wTrades.length) * 100 : 0;
    const lossPct = wTrades.length > 0 ? (wLosses / wTrades.length) * 100 : 0;
    const bePct = wTrades.length > 0 ? (wBe / wTrades.length) * 100 : 0;
    const rawRStr = (wRawR >= 0 ? "+" : "") + wRawR.toFixed(2) + " R";
    const wRStr = (wWeightedR >= 0 ? "+" : "") + wWeightedR.toFixed(2) + " R";
    const cumRStr = (cumWeightedR >= 0 ? "+" : "") + cumWeightedR.toFixed(2) + " R";
    const status = wRawR > 0.05 ? "🟢 WIN" : (wRawR < -0.05 ? "🔴 LOSS" : "⚪ FLAT");

    console.log(
      ` ${label.padEnd(34)} | ${String(wTrades.length).padStart(6)} | ${String(wWins).padStart(4)} | ${String(wLosses).padStart(4)} | ${String(wBe).padStart(4)} | ${winPct.toFixed(1).padStart(6)}% | ${lossPct.toFixed(1).padStart(6)}% | ${bePct.toFixed(1).padStart(6)}% | ${rawRStr.padStart(11)} | ${wRStr.padStart(14)} | ${wMaxDdWeightedR.toFixed(2).padStart(13)} R | ${cumRStr.padStart(14)} | ${status}`
    );
  }

  const totalWeeks = sortedWeeks.length;
  const weekWinRate = totalWeeks > 0 ? (winWeeks / totalWeeks) * 100 : 0;
  console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
  console.log(` 📊 WEEKLY CONSISTENCY SUMMARY:`);
  console.log(`    Total Weeks Traded : ${totalWeeks}`);
  console.log(`    Profitable Weeks   : ${winWeeks} (${weekWinRate.toFixed(1)}%) | Losing Weeks: ${lossWeeks} | Flat/BE Weeks: ${beWeeks}`);
  console.log(`    Best Single Week   : ${bestWeek.label} (${(bestWeek.rawR >= 0 ? "+" : "") + bestWeek.rawR.toFixed(2)} R)`);
  console.log(`    Worst Single Week  : ${worstWeek.label} (${(worstWeek.rawR >= 0 ? "+" : "") + worstWeek.rawR.toFixed(2)} R)`);
  console.log(`    Total Raw Net R    : ${(cumRawR >= 0 ? "+" : "") + cumRawR.toFixed(2)} R | Weighted Net R: ${(cumWeightedR >= 0 ? "+" : "") + cumWeightedR.toFixed(2)} R`);
  console.log("======================================================================================================================================================\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2E: Forensic Dip & Historical Drawdown Audit
// ─────────────────────────────────────────────────────────────────────────────
async function runDipAuditModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 🔬 MODULE 2E: FORENSIC AUDIT OF RECENT 4-WEEK DIP (2026-08-17 → 2026-09-11)");
  console.log("====================================================================================================");

  const dipTrades = trades.filter((t: any) => {
    const dStr = t.exitTime || t.entryTime || t.date || t.time || "";
    return dStr >= "2026-08-17" && dStr <= "2026-09-11 23:59:59";
  });

  console.log(`\n📦 Total Trades in Recent Dip: ${dipTrades.length}`);
  const totalDipRawR = dipTrades.reduce((s, t) => s + (t.rMultiple || 0), 0);
  const totalDipWeightedR = dipTrades.reduce((s, t) => s + ((t.rMultiple || 0) * (t.riskMultiplier || 1.0)), 0);
  const dipWins = dipTrades.filter(t => (t.rMultiple || 0) > 0.0001).length;
  const dipLosses = dipTrades.filter(t => (t.rMultiple || 0) < -0.0001).length;
  const dipBe = dipTrades.length - dipWins - dipLosses;
  const dipWinPct = dipTrades.length > 0 ? (dipWins / dipTrades.length) * 100 : 0;

  console.log(`   Raw Net R        : ${totalDipRawR.toFixed(2)} R`);
  console.log(`   Weighted Net R   : ${totalDipWeightedR.toFixed(2)} R`);
  console.log(`   Win / Loss / BE  : ${dipWins} Wins (${dipWinPct.toFixed(1)}%) | ${dipLosses} Losses | ${dipBe} BE`);

  // 1. Bot Breakdown
  const botMap: Record<string, { trades: number; wins: number; losses: number; be: number; rawR: number; weightedR: number }> = {};
  for (const t of dipTrades) {
    const b = t.bot || "UNKNOWN";
    if (!botMap[b]) botMap[b] = { trades: 0, wins: 0, losses: 0, be: 0, rawR: 0, weightedR: 0 };
    botMap[b].trades++;
    const r = t.rMultiple || 0;
    const wR = r * (t.riskMultiplier || 1.0);
    botMap[b].rawR += r;
    botMap[b].weightedR += wR;
    if (r > 0.0001) botMap[b].wins++;
    else if (r < -0.0001) botMap[b].losses++;
    else botMap[b].be++;
  }

  console.log("\n🤖 1. PERFORMANCE BY BOT IN DIP:");
  console.table(Object.entries(botMap).map(([b, st]) => ({
    Bot: b,
    Trades: st.trades,
    Wins: st.wins,
    Losses: st.losses,
    "Win %": ((st.wins / st.trades) * 100).toFixed(1) + "%",
    "Raw Net R": (st.rawR >= 0 ? "+" : "") + st.rawR.toFixed(2) + " R",
    "Weighted Net R": (st.weightedR >= 0 ? "+" : "") + st.weightedR.toFixed(2) + " R",
  })));

  // 2. Pair Breakdown
  const symMap: Record<string, { trades: number; wins: number; losses: number; be: number; rawR: number; weightedR: number }> = {};
  for (const t of dipTrades) {
    const s = t.symbol || t.pair;
    if (!symMap[s]) symMap[s] = { trades: 0, wins: 0, losses: 0, be: 0, rawR: 0, weightedR: 0 };
    symMap[s].trades++;
    const r = t.rMultiple || 0;
    const wR = r * (t.riskMultiplier || 1.0);
    symMap[s].rawR += r;
    symMap[s].weightedR += wR;
    if (r > 0.0001) symMap[s].wins++;
    else if (r < -0.0001) symMap[s].losses++;
    else symMap[s].be++;
  }

  console.log("\n📊 2. PERFORMANCE BY PAIR IN DIP (Sorted Worst to Best):");
  const sortedSyms = Object.entries(symMap).sort((a, b) => a[1].rawR - b[1].rawR);
  console.table(sortedSyms.map(([s, st]) => ({
    Pair: s,
    Trades: st.trades,
    Wins: st.wins,
    Losses: st.losses,
    "Win %": ((st.wins / st.trades) * 100).toFixed(1) + "%",
    "Raw Net R": (st.rawR >= 0 ? "+" : "") + st.rawR.toFixed(2) + " R",
    "Weighted Net R": (st.weightedR >= 0 ? "+" : "") + st.weightedR.toFixed(2) + " R",
  })));

  // 3. Historical Drawdown Comparison
  console.log("\n📉 3. HISTORICAL DRAWDOWN CYCLES IN DATASET (> 4.0 Raw R):");
  const sortedAll = [...trades].sort((a, b) => {
    const da = new Date(a.exitTime || a.entryTime || a.date || a.time || 0).getTime();
    const db = new Date(b.exitTime || b.entryTime || b.date || b.time || 0).getTime();
    return da - db;
  });

  let runningR = 0, peakR = 0, maxDD = 0;
  let currentDDBegan = "";
  let currentDDPeakDate = "";
  let currentDD = 0;
  let currentDDTroughDate = "";
  let currentDDTroughR = 0;
  const drawdowns: { peakDate: string; troughDate: string; recoveryDate: string; depthR: number; peakR: number; troughR: number }[] = [];

  for (const t of sortedAll) {
    const r = t.rMultiple || 0;
    runningR += r;
    const dStr = (t.exitTime || t.entryTime || t.date || "").substring(0, 10);
    if (runningR >= peakR) {
      if (currentDD >= 4.0) {
        drawdowns.push({
          peakDate: currentDDPeakDate,
          troughDate: currentDDTroughDate,
          recoveryDate: dStr,
          depthR: currentDD,
          peakR,
          troughR: currentDDTroughR,
        });
      }
      peakR = runningR;
      currentDD = 0;
      currentDDBegan = "";
      currentDDPeakDate = dStr;
    } else {
      const dd = peakR - runningR;
      if (dd > currentDD) {
        currentDD = dd;
        currentDDTroughDate = dStr;
        currentDDTroughR = runningR;
        if (!currentDDBegan) currentDDBegan = dStr;
      }
      if (dd > maxDD) maxDD = dd;
    }
  }

  if (currentDD >= 3.0) {
    drawdowns.push({
      peakDate: currentDDPeakDate,
      troughDate: currentDDTroughDate,
      recoveryDate: "ONGOING",
      depthR: currentDD,
      peakR,
      troughR: currentDDTroughR,
    });
  }

  console.table(drawdowns.map((d, i) => ({
    "DD #": i + 1,
    "Peak Date": d.peakDate,
    "Trough Date": d.troughDate,
    "Recovery Date": d.recoveryDate,
    "Drawdown Depth": d.depthR.toFixed(2) + " R",
    "Peak Net R": "+" + d.peakR.toFixed(1) + " R",
    "Trough Net R": "+" + d.troughR.toFixed(1) + " R",
  })));
  console.log("====================================================================================================\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2B: Per-Pair Month-by-Month Net R Contribution Matrix
// ─────────────────────────────────────────────────────────────────────────────
async function runPerPairMonthlyMatrixModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 📊 MODULE 2B: PER-PAIR MONTH-BY-MONTH NET R CONTRIBUTION MATRIX (Raw Net R)");
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
// MODULE 2C: Per-Pair Monthly Trades, Net R & Drawdown Deep Audit
// ─────────────────────────────────────────────────────────────────────────────
async function runPerPairDeepMonthlyAuditModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 🔬 MODULE 2C: PER-PAIR MONTHLY TRADES, NET R & DRAWDOWN DEEP AUDIT (Last 1 Year)");
  console.log("====================================================================================================");

  const symbols = Array.from(new Set(trades.map(t => (t.symbol || t.pair || "").replace(/\.daily$/i, "")))).sort();
  const monthlyBuckets: Record<string, boolean> = {};
  for (const t of trades) {
    const dStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 7);
    if (dStr && dStr.length === 7) monthlyBuckets[dStr] = true;
  }
  const months = Object.keys(monthlyBuckets).sort();

  interface PairMonthData {
    trades: number;
    wins: number;
    losses: number;
    netR: number;
    maxDd: number;
  }

  const pairMonthlyMap: Record<string, Record<string, PairMonthData>> = {};
  const pairYearSummary: Record<string, {
    trades: number;
    wins: number;
    losses: number;
    netR: number;
    maxDd: number;
    grossWinR: number;
    grossLossR: number;
  }> = {};

  for (const sym of symbols) {
    pairMonthlyMap[sym] = {};
    for (const m of months) {
      pairMonthlyMap[sym][m] = { trades: 0, wins: 0, losses: 0, netR: 0, maxDd: 0 };
    }
    pairYearSummary[sym] = { trades: 0, wins: 0, losses: 0, netR: 0, maxDd: 0, grossWinR: 0, grossLossR: 0 };
  }

  for (const sym of symbols) {
    const symTrades = trades.filter(t => (t.symbol || t.pair || "").replace(/\.daily$/i, "") === sym);
    symTrades.sort((a, b) => {
      const tA = new Date(a.exitTime || a.entryTime || a.date || a.time || 0).getTime();
      const tB = new Date(b.exitTime || b.entryTime || b.date || b.time || 0).getTime();
      return tA - tB;
    });

    let runningR = 0;
    let peakR = 0;
    let yearMaxDd = 0;

    for (const t of symTrades) {
      const r = t.rMultiple || 0;
      const m = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 7);

      pairYearSummary[sym].trades++;
      pairYearSummary[sym].netR += r;
      if (r > 0.0001) {
        pairYearSummary[sym].wins++;
        pairYearSummary[sym].grossWinR += r;
      } else if (r < -0.0001) {
        pairYearSummary[sym].losses++;
        pairYearSummary[sym].grossLossR += Math.abs(r);
      }

      runningR += r;
      if (runningR > peakR) peakR = runningR;
      const dd = peakR - runningR;
      if (dd > yearMaxDd) yearMaxDd = dd;

      if (pairMonthlyMap[sym][m]) {
        pairMonthlyMap[sym][m].trades++;
        pairMonthlyMap[sym][m].netR += r;
        if (r > 0.0001) pairMonthlyMap[sym][m].wins++;
        else if (r < -0.0001) pairMonthlyMap[sym][m].losses++;
      }
    }
    pairYearSummary[sym].maxDd = yearMaxDd;

    // Calculate monthly peak-to-trough Drawdown within each month
    for (const m of months) {
      const mTrades = symTrades.filter(t => (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 7) === m);
      let mRunningR = 0;
      let mPeakR = 0;
      let mMaxDd = 0;
      for (const mt of mTrades) {
        const r = mt.rMultiple || 0;
        mRunningR += r;
        if (mRunningR > mPeakR) mPeakR = mRunningR;
        const dd = mPeakR - mRunningR;
        if (dd > mMaxDd) mMaxDd = dd;
      }
      pairMonthlyMap[sym][m].maxDd = mMaxDd;
    }
  }

  // ── TABLE 1: Master 1-Year Summary Per Pair ──
  console.log("\n📋 1-YEAR AGGREGATE SUMMARY PER PAIR:");
  const summaryRows = symbols.map(sym => {
    const s = pairYearSummary[sym];
    const winPct = s.trades > 0 ? ((s.wins / s.trades) * 100).toFixed(1) + "%" : "0.0%";
    const pf = s.grossLossR > 0 ? (s.grossWinR / s.grossLossR).toFixed(2) : (s.grossWinR > 0 ? "∞" : "0.00");
    const retDd = s.maxDd > 0 ? (s.netR / s.maxDd).toFixed(2) : "∞";
    return {
      Pair: sym,
      Trades: s.trades,
      Wins: s.wins,
      Losses: s.losses,
      "Win %": winPct,
      "1-Yr Net R": (s.netR >= 0 ? "+" : "") + s.netR.toFixed(2) + " R",
      "1-Yr Max DD": s.maxDd.toFixed(2) + " R",
      "Profit Factor": pf,
      "Ret / DD Ratio": retDd,
    };
  });
  summaryRows.sort((a, b) => parseFloat(b["1-Yr Net R"]) - parseFloat(a["1-Yr Net R"]));
  console.table(summaryRows);

  const colW = 8;
  const headerSyms = symbols.map(s => s.padStart(colW)).join(" | ");

  // ── TABLE 2: Monthly Trade Counts by Pair ──
  console.log("\n📈 MONTHLY TRADE COUNTS MATRIX (Trades Taken / Month):");
  console.log(` MONTH   | ${headerSyms} |    TOTAL`);
  console.log(`---------+-${symbols.map(() => "--------").join("-+-")}---+---------`);
  for (const m of months) {
    let mTotal = 0;
    const cols = symbols.map(s => {
      const cnt = pairMonthlyMap[s][m].trades;
      mTotal += cnt;
      return (cnt > 0 ? String(cnt) : "-").padStart(colW);
    });
    console.log(` ${m} | ${cols.join(" | ")} | ${String(mTotal).padStart(8)}`);
  }
  const totalTradesCols = symbols.map(s => String(pairYearSummary[s].trades).padStart(colW));
  const grandTotalTrades = Object.values(pairYearSummary).reduce((sum, s) => sum + s.trades, 0);
  console.log(`---------+-${symbols.map(() => "--------").join("-+-")}---+---------`);
  console.log(` 1-YR TOT| ${totalTradesCols.join(" | ")} | ${String(grandTotalTrades).padStart(8)}`);

  // ── TABLE 3: Monthly Net R by Pair ──
  console.log("\n💰 MONTHLY NET R MATRIX (Net R Generated / Month):");
  console.log(` MONTH   | ${headerSyms} |    TOTAL`);
  console.log(`---------+-${symbols.map(() => "--------").join("-+-")}---+---------`);
  for (const m of months) {
    let mNetR = 0;
    const cols = symbols.map(s => {
      const r = pairMonthlyMap[s][m].netR;
      mNetR += r;
      if (pairMonthlyMap[s][m].trades === 0) return "-".padStart(colW);
      return ((r >= 0 ? "+" : "") + r.toFixed(1) + "R").padStart(colW);
    });
    console.log(` ${m} | ${cols.join(" | ")} | ${((mNetR >= 0 ? "+" : "") + mNetR.toFixed(1) + "R").padStart(8)}`);
  }
  const totalNetRCols = symbols.map(s => ((pairYearSummary[s].netR >= 0 ? "+" : "") + pairYearSummary[s].netR.toFixed(1) + "R").padStart(colW));
  const grandTotalNetR = Object.values(pairYearSummary).reduce((sum, s) => sum + s.netR, 0);
  console.log(`---------+-${symbols.map(() => "--------").join("-+-")}---+---------`);
  console.log(` 1-YR TOT| ${totalNetRCols.join(" | ")} | ${((grandTotalNetR >= 0 ? "+" : "") + grandTotalNetR.toFixed(1) + "R").padStart(8)}`);

  // ── TABLE 4: Monthly Max Drawdown by Pair ──
  console.log("\n⚠️  MONTHLY MAX DRAWDOWN MATRIX (Peak-to-Trough R Drop within Each Month):");
  console.log(` MONTH   | ${headerSyms} |  MAX PAIR DD`);
  console.log(`---------+-${symbols.map(() => "--------").join("-+-")}---+-------------`);
  for (const m of months) {
    let maxPairDdInMonth = 0;
    const cols = symbols.map(s => {
      const dd = pairMonthlyMap[s][m].maxDd;
      if (dd > maxPairDdInMonth) maxPairDdInMonth = dd;
      if (pairMonthlyMap[s][m].trades === 0) return "-".padStart(colW);
      return (dd.toFixed(1) + "R").padStart(colW);
    });
    console.log(` ${m} | ${cols.join(" | ")} | ${(maxPairDdInMonth.toFixed(1) + "R").padStart(12)}`);
  }
  const totalMaxDdCols = symbols.map(s => (pairYearSummary[s].maxDd.toFixed(1) + "R").padStart(colW));
  const peakYearPairDd = Math.max(...Object.values(pairYearSummary).map(s => s.maxDd));
  console.log(`---------+-${symbols.map(() => "--------").join("-+-")}---+-------------`);
  console.log(` 1-YR MAX| ${totalMaxDdCols.join(" | ")} | ${(peakYearPairDd.toFixed(1) + "R").padStart(12)}`);
  console.log("====================================================================================================\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3: Isolated Single-Month Compounding Performance Audit (10% Risk)
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

  const results: any[] = [];

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
    let startOfDayBal = 100.0;
    let currentDay = "";
    let dayHalted = false;
    let daysCircuited = 0;

    for (const t of monthTrades) {
      const tDateStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 10);
      if (tDateStr !== currentDay) {
        currentDay = tDateStr;
        startOfDayBal = bal;
        dayHalted = false;
      }

      if (dayHalted) continue;

      const r = t.rMultiple || 0;
      const riskCapital = bal * (0.10 * (t.riskMultiplier || 1.0));
      bal += riskCapital * r;

      if (bal > peak) peak = bal;
      const dd = ((peak - bal) / peak) * 100;
      if (dd > maxDdPct) maxDdPct = dd;

      const dailyDd = ((startOfDayBal - bal) / startOfDayBal) * 100;
      if (dailyDd > maxDailyDdPct) maxDailyDdPct = dailyDd;

      if (dailyDd >= 4.0) {
        dayHalted = true;
        daysCircuited++;
      }
    }

    const retPct = ((bal - 100.0) / 100.0) * 100;
    let status = "🟢 PROFITABLE";
    if (retPct < 0) {
      status = "🔴 LOSS";
    }

    results.push({
      month: mKey,
      tradesCount: monthTrades.length,
      startBalance: "$100.00",
      finalBalance: "$" + bal.toFixed(2),
      monthlyReturn: (retPct >= 0 ? "+" : "") + retPct.toFixed(1) + "%",
      maxDailyDd: maxDailyDdPct.toFixed(2) + "%",
      maxPeakDd: maxDdPct.toFixed(2) + "%",
      circuitedDays: daysCircuited,
      status
    });
  }

  console.table(results);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 4: 2-Parameter Institutional Dynamic Grid Optimizer (Intraday Max Loss Cap × Peak-to-Trough Trailing Drawdown)
// ─────────────────────────────────────────────────────────────────────────────
async function runInstitutionalGridModule(trades: any[]) {
  console.log("\n====================================================================================================");
  console.log(" 🏛️ MODULE 4: 2-PARAMETER INSTITUTIONAL RISK & TRAILING PROXIMITY GRID OPTIMIZER");
  console.log(" 🔬 Grid Search: Daily Loss Cap (3% to 6%) × Trailing Peak Drawdown (6% to 15%) across Base Risks");
  console.log("====================================================================================================");

  const dailyCaps = [0.025, 0.03, 0.04, 0.05, 0.10];
  const peakToTroughs = [0.06, 0.08, 0.095, 0.12, 0.40];
  const testRisks = [0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];

  function evaluateInstitutionalScenario(baseRisk: number, dailyCapPct: number, peakToDrawPct: number) {
    let bal = 100.0;
    let peak = 100.0;
    let maxDailyLossSeen = 0;
    let maxPeakDdPct = 0;
    let startOfDayBal = 100.0;
    let currentEstDay = "";
    let dayHalted = false;
    let accountHalted = false;
    let daysCircuited = 0;
    let consecutiveCircuitedDays = 0;
    let tradesTaken = 0;

    for (const t of trades) {
      if (accountHalted) continue;

      const simEstDay = t.simEstDay;

      if (simEstDay !== currentEstDay) {
        currentEstDay = simEstDay;
        startOfDayBal = bal;
        if (dayHalted) {
          consecutiveCircuitedDays++;
        } else {
          consecutiveCircuitedDays = 0;
        }
        dayHalted = false;
      }

      if (dayHalted) continue;

      if (bal > peak) peak = bal;
      const currentPeakDd = (peak - bal) / peak;
      if (currentPeakDd > maxPeakDdPct) maxPeakDdPct = currentPeakDd;

      if (currentPeakDd >= peakToDrawPct) {
        accountHalted = true;
        continue;
      }

      // 🛡️ Live Production Proximity Scaling (MageEngine / SageEngine parity)
      let institutionalMultiplier = 1.0;
      const rho = currentPeakDd / peakToDrawPct; // 0.0 at peak -> 1.0 at limit
      if (rho >= 0.85) {
        institutionalMultiplier = 0.15;
      } else if (rho >= 0.70) {
        institutionalMultiplier = 0.30;
      } else if (rho >= 0.50) {
        institutionalMultiplier = 0.50;
      }

      // 🛡️ Post-Circuit Breaker Dampener (0.50x next day, 0.25x if 2 days consecutive)
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
      netReturn: (netRetPct >= 0 ? "+" : "") + netRetPct.toFixed(1) + "%",
      maxDailyDd: (maxDailyLossSeen * 100).toFixed(2) + "%",
      maxPeakDd: (maxPeakDdPct * 100).toFixed(2) + "%",
      circuitedDays: daysCircuited,
      status: isBreached ? "🔴 BREACHED" : "🟢 SAFE"
    };
  }

  // 1. Account A (Conservative Profile — 2.5% Daily Cap / 5.5% Trailing Max DD)
  console.log("\n▶ [Preset: Account A (Conservative) — 2.5% Daily Cap / 5.5% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.025, 0.055)));

  // 2. Account B (Balanced / Moderate Profile — 3.0% Daily Cap / 9.5% Trailing Max DD)
  console.log("\n▶ [Preset: Account B (Balanced / Moderate) — 3.0% Daily Cap / 9.5% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.03, 0.095)));

  // 3. Account C (Aggressive / High Risk Profile — 10.0% Daily Cap / 40.0% Trailing Max DD)
  console.log("\n▶ [Preset: Account C (Aggressive / High Risk) — 10.0% Daily Cap / 40.0% Trailing Max DD]");
  console.table(testRisks.map(r => evaluateInstitutionalScenario(r, 0.10, 0.40)));

  // 4. Fine-Grained Optimal Risk Finder (0.5% resolution from 1% to 60%)
  console.log("\n====================================================================================================");
  console.log(" 🎯 MAX RISK SCANNER: HIGHEST ASSIGNABLE RISK WITHOUT BREACHING DAILY OR TRAILING DD");
  console.log("====================================================================================================");

  const fineRisks: number[] = [];
  for (let r = 0.01; r <= 0.605; r += 0.005) {
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
    let highestSafeRisk = 0;
    let bestResult: any = null;

    for (const r of fineRisks) {
      const res = evaluateInstitutionalScenario(r, acc.dailyCap, acc.peakToDraw);
      if (res.status === "🟢 SAFE" && parseFloat(res.maxDailyDd) <= (acc.dailyCap * 100 + 0.01)) {
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
  const arg = (args[0] || "all").toLowerCase();

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

  console.log(`\n========================================================================`);
  console.log(` 🏆 UNIFIED MATHEMATICAL PORTFOLIO SIMULATOR`);
  console.log(` 🕹️  Command Mode: "${arg}" | Date Range: ${startDate} → ${endDate}`);
  console.log(`========================================================================`);

  const trades = await loadPortfolioTrades(startDate, endDate);

  const isFlatRisk = args.includes("--flat-risk") || args.includes("--flat") || args.includes("--flat-1pct") || args.includes("--1pct");
  if (isFlatRisk) {
    console.log(`⚡ [MODE OVERRIDE] Flat 1.0% Risk Mode Activated: Ignoring individual PairConfig riskPct, setting flat 1% to all trades.\n`);
    trades.forEach(t => t.riskMultiplier = 0.01);
  } else {
    console.log(`⚖️  [MODE] Normal Weighted Risk Mode: Using individual riskPct from PairConfig.\n`);
  }

  console.log(`📦 Loaded ${trades.length} Math Trades (${startDate} → ${endDate})\n`);

  if (arg === "modes" || arg === "--modes") {
    await runRiskModesModule(trades);
  } else if (arg === "monthly" || arg === "--monthly") {
    await runMonthlyModule(trades);
    await runPerPairMonthlyMatrixModule(trades);
    await runPerPairDeepMonthlyAuditModule(trades);
  } else if (arg === "weekly" || arg === "--weekly" || arg === "weeks" || arg === "--weeks") {
    await runWeeklyModule(trades);
  } else if (arg === "dip" || arg === "--dip" || arg === "audit-dip") {
    await runDipAuditModule(trades);
  } else if (arg === "pair-audit" || arg === "--pair-audit" || arg === "pairs" || arg === "--pairs") {
    await runPerPairDeepMonthlyAuditModule(trades);
  } else if (arg === "cohorts" || arg === "--cohorts") {
    await runCohortsModule(trades);
  } else if (arg === "institutional" || arg === "--institutional" || arg === "grid" || arg === "--grid") {
    await runInstitutionalGridModule(trades);
  } else {
    // Run all modules
    await runRiskModesModule(trades);
    await runMonthlyModule(trades);
    await runWeeklyModule(trades);
    await runPerPairMonthlyMatrixModule(trades);
    await runPerPairDeepMonthlyAuditModule(trades);
    await runCohortsModule(trades);
    await runInstitutionalGridModule(trades);
  }

  console.log("\n🎉 Simulation Complete!\n");
}

main();
