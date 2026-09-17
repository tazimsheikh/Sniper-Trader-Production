// ============================================================
// analyze_fundamental_losses.ts
//
// Deep Fundamental Loss Diagnostics across Mage, Sage, and Seer
// for the 1-year portfolio backtest (2025-09-02 to 2026-09-02).
//
// Analyzes:
//   - Excursion Dynamics: MFE (Max Favorable Excursion) & MAE
//   - Candlestick Quality: Breakout Wick-to-Body Ratio & Close Location
//   - Volatility & Range Expansion: OR size vs 14-period ATR
//   - Trade Duration & Time-to-Stop distributions
//   - Exit Outcomes (SL vs EOD vs News)
//   - Config & Asset-level loss concentration
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { runMathBacktest as runMageMathBacktest, clearMageBacktestCache } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest, clearSageBacktestCache } from "../backtester/SageMathBacktester.js";
import { runSeerMathBacktest, clearSeerBacktestCache } from "../backtester/SeerMathBacktester.js";
import { PairConfigManager } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { loadCsv } from "../backtester/loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { buildAtrArray } from "../market/Indicators.js";
import { HTFContextTracker } from "../market/HTFContextTracker.js";
import { getFixedEstDate } from "../backtester/math_core/MathCoreUtils.js";
import parseSeerSetupToConfig from "../optimizer/grandmaster/utils/seer_params_parser.js";

const START_DATE = "2025-09-02";
const END_DATE = "2026-09-02";
const PORTFOLIO_JSON = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster_holy_grail_portfolios.json");
const OUTPUT_REPORT = path.join(process.cwd(), "fundamental_loss_analysis_1yr.txt");

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

  const baseSym = symbol.split(".")[0].toUpperCase();
  const baseProps = OPTIMIZER_CONFIG[baseSym] || { tickSize: 0.00001, pipSize: 0.0001, spread: 2.0 };

  const parsedPct = findNum("%", true) ?? 0;
  const minSl = findNum("MinSL") ?? 10;
  const maxSl = findNum("MaxSl") ?? findNum("MaxSL") ?? 100;

  if (isSage) {
    return {
      tickSize: baseProps.tickSize,
      pipSize: baseProps.pipSize,
      spread: baseProps.spread,
      session,
      orbEnabled: true,
      orbStartHour: findNum("StartH") ?? 0,
      orbStartMin: findNum("StartM") ?? 0,
      orbMinutes: findNum("OrbMins") ?? 15,
      actionMinutes: findNum("ActMins"),
      minSlDist: minSl,
      maxSlDist: maxSl,
      entryPenetrationPct: parsedPct,
      sweepPips: findNum("Sweep") ?? 0,
      maxSweepMultiplier: findNum("MaxSwp") ?? 3,
      requireCloseInside: findStr("ReqCls") === "true",
      exitMode: findStr("Exit") ?? "TRAILING",
      trailingSlTrigger: findNum("Trig") ?? 0,
      trailingSlStep: findNum("Step") ?? 0,
      forceCloseHours: findNum("FC") ?? 8,
      htfAlignmentRequired: true,
      maxH1EmaSlope: 20,
    };
  } else {
    return {
      tickSize: baseProps.tickSize,
      pipSize: baseProps.pipSize,
      spread: baseProps.spread,
      session,
      orbEnabled: true,
      orbStartHour: findNum("StartH") ?? 0,
      orbStartMin: findNum("StartM") ?? 0,
      orbMinutes: findNum("OrbMins") ?? 10,
      actionMinutes: findNum("ActMins") ?? 60,
      minSlDist: minSl,
      maxSlDist: maxSl,
      minBodyPips: findNum("Body") ?? 0,
      exitMode: findStr("Exit") ?? "TRAILING",
      trailingSlTrigger: findNum("Trig") ?? 0,
      trailingSlStep: findNum("Step") ?? 0,
      forceCloseHours: findNum("FC") ?? 24,
      htfAlignmentRequired: true,
      maxH1EmaSlope: 20,
    };
  }
}

interface EnrichedTrade {
  bot: "MAGE" | "SAGE" | "SEER";
  pair: string;
  setup: string;
  configKey: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  initialRisk: number;
  riskPips: number;
  outcome: string;
  rMultiple: number;
  entryTimeMs: number;
  exitTimeMs: number;
  durationMins: number;
  mfeR: number;
  maeR: number;
  mfePips: number;
  maePips: number;
  orPips: number;
  orAtrRatio: number;
  actionCandleBodyRatio: number;
  actionCandleWbr: number;
  actionCandleCloseLoc: number;
  htfEmaAligned: boolean;
}

const pairDataCache = new Map<string, { m1Rows: any[]; m5Candles: any[]; atr14: Float64Array | number[]; htfData: any }>();

async function getPairMarketData(cleanSym: string) {
  if (pairDataCache.has(cleanSym)) return pairDataCache.get(cleanSym)!;

  const optCfg = OPTIMIZER_CONFIG[cleanSym] || { spread: 2.0, pipSize: 0.0001 };
  const basePrefix = cleanSym.split("_")[0].split(".")[0];
  const csvDir = path.join(process.cwd(), "data", "csv");
  const files = fs.readdirSync(csvDir).filter(
    (f) =>
      (f.toLowerCase().startsWith(cleanSym.toLowerCase()) ||
        f.toLowerCase().startsWith(basePrefix.toLowerCase())) &&
      f.endsWith(".csv")
  );

  if (!files.length) {
    throw new Error("No CSV data found for " + cleanSym);
  }

  const startD = new Date(new Date(START_DATE).getTime() - 40 * 24 * 60 * 60 * 1000);
  const endD = new Date(new Date(END_DATE).getTime() + 86400000);

  let m1Rows: any[] = [];
  for (const f of files) {
    m1Rows = m1Rows.concat(await loadCsv(path.join(csvDir, f), optCfg.spread, startD, endD));
  }

  const m5Candles = aggregateCandles(m1Rows, 5);
  const atr14 = buildAtrArray(m5Candles, 14);
  const htfData = HTFContextTracker.precomputeHTFData(m5Candles);

  const data = { m1Rows, m5Candles, atr14, htfData };
  pairDataCache.set(cleanSym, data);
  return data;
}

function pct(n: number, d: number): string {
  return d === 0 ? "0.0%" : ((n / d) * 100).toFixed(1) + "%";
}

async function main() {
  const lines: string[] = [];
  const log = (...args: any[]) => {
    const s = args.map(String).join(" ");
    console.log(s);
    lines.push(s);
  };

  log("=".repeat(100));
  log("  BRAIN: DEEP FUNDAMENTAL LOSS ANALYSIS -- MAGE, SAGE & SEER (1-YEAR BACKTEST)");
  log("  Date Range: " + START_DATE + " -> " + END_DATE);
  log("=".repeat(100));

  if (!fs.existsSync(PORTFOLIO_JSON)) {
    log("[ERROR] Portfolio JSON not found: " + PORTFOLIO_JSON);
    process.exit(1);
  }

  const portfolio: any[] = JSON.parse(fs.readFileSync(PORTFOLIO_JSON, "utf-8"));
  log("Loaded " + portfolio.length + " configurations from portfolio file.\n");

  const enrichedTrades: EnrichedTrade[] = [];

  for (let idx = 0; idx < portfolio.length; idx++) {
    const comp = portfolio[idx];
    const cleanSym = comp.symbol.replace(/\.daily$/i, "");
    const botType = comp.botType.toUpperCase() as "MAGE" | "SAGE" | "SEER";
    const optCfg = OPTIMIZER_CONFIG[cleanSym] || { pipSize: 0.0001, spread: 2.0, tickSize: 0.00001 };
    const pipSize = optCfg.pipSize;
    const spreadPts = optCfg.spread * pipSize;

    log("[" + (idx + 1) + "/" + portfolio.length + "] Backtesting " + botType + " on " + cleanSym + " (" + comp.setup.substring(0, 45) + "...)...");

    let rawRecords: any[] = [];
    try {
      if (botType === "SEER") {
        const liveCfgs = PairConfigManager.getSeerConfigs(cleanSym);
        const parsed = parseSeerSetupToConfig(comp.setup, cleanSym);
        const cfg: any = liveCfgs && liveCfgs.length > 0 ? { ...liveCfgs[0] } : parsed;
        const res = await runSeerMathBacktest(cleanSym, START_DATE, END_DATE, false, {}, [cfg], false);
        rawRecords = (res.records || (Array.isArray(res) ? res : [])).filter(
          (r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE"
        );
        clearSeerBacktestCache(cleanSym);
      } else if (botType === "SAGE") {
        const liveCfgs = PairConfigManager.getSageConfigs(cleanSym);
        const parsed = parseSetupToConfig(comp.setup, cleanSym, true);
        const match = liveCfgs?.find(
          (c: any) =>
            c.orbStartHour === parsed.orbStartHour &&
            c.orbStartMin === parsed.orbStartMin &&
            c.orbMinutes === parsed.orbMinutes
        );
        const cfg = match ? { ...match } : parsed;
        const res = await runSageMathBacktest(cleanSym, START_DATE, END_DATE, false, {}, [cfg], false);
        rawRecords = (res.records || []).filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
        clearSageBacktestCache(cleanSym);
      } else {
        const liveCfgs = PairConfigManager.getMageConfigs(cleanSym);
        const parsed = parseSetupToConfig(comp.setup, cleanSym, false);
        const match = liveCfgs?.find(
          (c: any) =>
            c.orbStartHour === parsed.orbStartHour &&
            c.orbStartMin === parsed.orbStartMin &&
            c.orbMinutes === parsed.orbMinutes
        );
        const cfg = match ? { ...match } : parsed;
        const res = await runMageMathBacktest(cleanSym, START_DATE, END_DATE, false, undefined, undefined, null, [cfg], false);
        rawRecords = (res.records || []).filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
        clearMageBacktestCache(cleanSym);
      }
    } catch (err: any) {
      log("   [ERROR] Failed to backtest " + cleanSym + " " + botType + ": " + err.message);
      continue;
    }

    if (rawRecords.length === 0) {
      log("   No trades generated.");
      continue;
    }

    let marketData: { m1Rows: any[]; m5Candles: any[]; atr14: Float64Array | number[]; htfData: any };
    try {
      marketData = await getPairMarketData(cleanSym);
    } catch (e: any) {
      log("   [MarketData Error] " + cleanSym + ": " + e.message);
      continue;
    }

    const { m1Rows, m5Candles, atr14, htfData } = marketData;

    for (const r of rawRecords) {
      const entryPrice = r.entry ?? r.entryPrice ?? 0;
      const slPrice = r.stopLoss ?? r.slPrice ?? 0;
      const tpPrice = r.takeProfit ?? r.tpPrice ?? 0;
      const initialRisk = Math.abs(entryPrice - slPrice);
      if (initialRisk <= 0 || !entryPrice) continue;

      let direction: "BUY" | "SELL" = "BUY";
      if (r.direction) direction = r.direction;
      else direction = entryPrice > slPrice ? "BUY" : "SELL";

      const entryTimeMs = r.entryTimeMs ?? r.timestamp ?? 0;
      const exitTimeMs = r.exitTimeMs ?? r.closeTime ?? entryTimeMs;
      const durationMins = Math.max(1, Math.round((exitTimeMs - entryTimeMs) / 60000));

      let mfePips = 0;
      let maePips = 0;
      let mfeR = 0;
      let maeR = 0;

      let maxHigh = -Infinity;
      let minLow = Infinity;

      let m1StartIdx = 0;
      while (m1StartIdx < m1Rows.length && m1Rows[m1StartIdx].timestamp < entryTimeMs) {
        m1StartIdx++;
      }

      let m1EndIdx = m1StartIdx;
      while (m1EndIdx < m1Rows.length && m1Rows[m1EndIdx].timestamp <= exitTimeMs) {
        const row = m1Rows[m1EndIdx];
        if (row.high > maxHigh) maxHigh = row.high;
        if (row.low < minLow) minLow = row.low;
        m1EndIdx++;
      }

      if (maxHigh !== -Infinity && minLow !== Infinity) {
        if (direction === "BUY") {
          const favorableDist = maxHigh - entryPrice;
          const adverseDist = entryPrice - minLow;
          mfePips = favorableDist / pipSize;
          maePips = adverseDist / pipSize;
          mfeR = favorableDist / initialRisk;
          maeR = adverseDist / initialRisk;
        } else {
          const favorableDist = entryPrice - minLow;
          const adverseDist = maxHigh - entryPrice;
          mfePips = favorableDist / pipSize;
          maePips = adverseDist / pipSize;
          mfeR = favorableDist / initialRisk;
          maeR = adverseDist / initialRisk;
        }
      }

      let m5Idx = 0;
      while (m5Idx < m5Candles.length && m5Candles[m5Idx].timestamp < entryTimeMs) {
        m5Idx++;
      }
      const actionM5 = m5Idx > 0 ? m5Candles[m5Idx - 1] : m5Candles[0];

      let actionCandleBodyRatio = 0;
      let actionCandleWbr = 0;
      let actionCandleCloseLoc = 0.5;
      let orPips = 0;
      let orAtrRatio = 1.0;
      let htfEmaAligned = true;

      if (actionM5) {
        const cRange = actionM5.high - actionM5.low;
        const cBody = Math.abs(actionM5.close - actionM5.open);
        const bodyTop = Math.max(actionM5.open, actionM5.close);
        const bodyBottom = Math.min(actionM5.open, actionM5.close);

        if (cRange > 0) {
          actionCandleBodyRatio = cBody / cRange;
          actionCandleCloseLoc = (actionM5.close - actionM5.low) / cRange;
        }

        const breakoutWick = direction === "BUY" ? actionM5.high - bodyTop : bodyBottom - actionM5.low;
        actionCandleWbr = cBody > 0 ? breakoutWick / cBody : 0;

        const orH = r.orHigh ?? 0;
        const orL = r.orLow ?? 0;
        if (orH > 0 && orL > 0) {
          orPips = (orH - orL) / pipSize;
        }

        const curAtr = m5Idx > 0 && atr14[m5Idx - 1] ? atr14[m5Idx - 1] / pipSize : 10;
        if (curAtr > 0 && orPips > 0) {
          orAtrRatio = orPips / curAtr;
        }

        const h1Idx = htfData.h1IndexMap[m5Idx > 0 ? m5Idx - 1 : 0];
        if (h1Idx !== undefined && htfData.h1Candles && htfData.ema50 && htfData.ema50[h1Idx]) {
          const h1Close = htfData.h1Candles[h1Idx]?.close;
          const h1Ema = htfData.ema50[h1Idx];
          if (direction === "BUY" && h1Close < h1Ema) htfEmaAligned = false;
          if (direction === "SELL" && h1Close > h1Ema) htfEmaAligned = false;
        }
      }

      enrichedTrades.push({
        bot: botType,
        pair: cleanSym,
        setup: comp.setup,
        configKey: botType + " | " + cleanSym + " | " + comp.setup,
        direction,
        entryPrice,
        slPrice,
        tpPrice,
        initialRisk,
        riskPips: initialRisk / pipSize,
        outcome: r.outcome,
        rMultiple: r.rMultiple ?? 0,
        entryTimeMs,
        exitTimeMs,
        durationMins,
        mfeR,
        maeR,
        mfePips,
        maePips,
        orPips,
        orAtrRatio,
        actionCandleBodyRatio,
        actionCandleWbr,
        actionCandleCloseLoc,
        htfEmaAligned,
      });
    }
  }

  log("\nEnriched " + enrichedTrades.length + " trades with tick-level excursion and market geometry!\n");

  const winTrades = enrichedTrades.filter((t) => t.rMultiple > 0);
  const lossTrades = enrichedTrades.filter((t) => t.rMultiple < 0);
  const beTrades = enrichedTrades.filter((t) => t.rMultiple === 0);

  const totalWinR = winTrades.reduce((s, t) => s + t.rMultiple, 0);
  const totalLossR = lossTrades.reduce((s, t) => s + t.rMultiple, 0);
  const netR = totalWinR + totalLossR;
  const grossProfitDrag = totalWinR > 0 ? (Math.abs(totalLossR) / totalWinR) * 100 : 0;

  log("=".repeat(100));
  log("  SECTION 1: OVERALL PORTFOLIO PERFORMANCE & LOSS DRAG");
  log("=".repeat(100));
  log("  Total Trades   : " + enrichedTrades.length);
  log("  Wins           : " + winTrades.length + " (" + pct(winTrades.length, enrichedTrades.length) + ")");
  log("  Losses         : " + lossTrades.length + " (" + pct(lossTrades.length, enrichedTrades.length) + ")");
  log("  Breakeven      : " + beTrades.length + " (" + pct(beTrades.length, enrichedTrades.length) + ")");
  log("  Gross Win R    : +" + totalWinR.toFixed(2) + "R");
  log("  Gross Loss R   : " + totalLossR.toFixed(2) + "R");
  log("  Net R          : " + (netR >= 0 ? "+" : "") + netR.toFixed(2) + "R");
  log("  Profit Factor  : " + (Math.abs(totalLossR) > 0 ? (totalWinR / Math.abs(totalLossR)).toFixed(2) : "N/A"));
  log("  Loss Drag      : " + grossProfitDrag.toFixed(1) + "% of gross profits are eroded by losing trades!");
  log("  Avg Win R      : +" + (winTrades.length > 0 ? (totalWinR / winTrades.length).toFixed(2) : "0") + "R");
  log("  Avg Loss R     : " + (lossTrades.length > 0 ? (totalLossR / lossTrades.length).toFixed(2) : "0") + "R");

  log("\n" + "=".repeat(100));
  log("  SECTION 2: BOT-BY-BOT BREAKDOWN (MAGE vs SAGE vs SEER)");
  log("=".repeat(100));
  const bots = ["MAGE", "SAGE", "SEER"] as const;

  for (const b of bots) {
    const bTrades = enrichedTrades.filter((t) => t.bot === b);
    if (bTrades.length === 0) continue;
    const bWins = bTrades.filter((t) => t.rMultiple > 0);
    const bLoss = bTrades.filter((t) => t.rMultiple < 0);
    const bWinR = bWins.reduce((s, t) => s + t.rMultiple, 0);
    const bLossR = bLoss.reduce((s, t) => s + t.rMultiple, 0);
    const bNetR = bWinR + bLossR;
    const bPF = Math.abs(bLossR) > 0 ? (bWinR / Math.abs(bLossR)).toFixed(2) : "N/A";
    const bDrag = bWinR > 0 ? ((Math.abs(bLossR) / bWinR) * 100).toFixed(1) : "N/A";

    log("\n  BOT [" + b + "]");
    log("     Total Trades: " + bTrades.length + " | Wins: " + bWins.length + " (" + pct(bWins.length, bTrades.length) + ") | Losses: " + bLoss.length + " (" + pct(bLoss.length, bTrades.length) + ")");
    log("     Net R: " + (bNetR >= 0 ? "+" : "") + bNetR.toFixed(2) + "R | Win R: +" + bWinR.toFixed(2) + "R | Loss R: " + bLossR.toFixed(2) + "R | PF: " + bPF);
    log("     Loss Drag: " + bDrag + "% | Avg Win: +" + (bWins.length > 0 ? (bWinR / bWins.length).toFixed(2) : "0") + "R | Avg Loss: " + (bLoss.length > 0 ? (bLossR / bLoss.length).toFixed(2) : "0") + "R");
  }

  log("\n" + "=".repeat(100));
  log("  SECTION 3: THE 3 FUNDAMENTAL LOSS ARCHETYPES (MFE / EXCURSION FORENSICS)");
  log("=".repeat(100));

  for (const b of bots) {
    const bLosses = lossTrades.filter((t) => t.bot === b);
    if (bLosses.length === 0) continue;

    const instantFakeout = bLosses.filter((t) => t.mfeR < 0.25);
    const choppyStall = bLosses.filter((t) => t.mfeR >= 0.25 && t.mfeR < 0.80);
    const givenBack = bLosses.filter((t) => t.mfeR >= 0.80);
    const givenBack1R = bLosses.filter((t) => t.mfeR >= 1.0);

    const totalL = bLosses.length;
    const lossRTotal = bLosses.reduce((s, t) => s + t.rMultiple, 0);

    log("\n  [BOT: " + b + "] Failure Archetype Distribution (" + totalL + " losing trades, " + lossRTotal.toFixed(2) + "R lost):");
    log("     1. INSTANT FAKEOUT (MFE < 0.25R)        : " + instantFakeout.length + " trades (" + pct(instantFakeout.length, totalL) + ") | Lost: " + instantFakeout.reduce((s, t) => s + t.rMultiple, 0).toFixed(2) + "R");
    log("        -> Price instantly rejected at entry; never expanded favorably.");
    log("     2. CHOPPY STALL   (0.25R <= MFE < 0.8R) : " + choppyStall.length + " trades (" + pct(choppyStall.length, totalL) + ") | Lost: " + choppyStall.reduce((s, t) => s + t.rMultiple, 0).toFixed(2) + "R");
    log("        -> Penetrated slightly, stalled, lost momentum and died.");
    log("     3. GIVEN-BACK WIN (MFE >= 0.80R)        : " + givenBack.length + " trades (" + pct(givenBack.length, totalL) + ") | Lost: " + givenBack.reduce((s, t) => s + t.rMultiple, 0).toFixed(2) + "R");
    log("        -> Trade reached >= +0.8R profit before reversing into a loss!");
    log("        (Of which " + givenBack1R.length + " trades reached >= +1.0R! Lost: " + givenBack1R.reduce((s, t) => s + t.rMultiple, 0).toFixed(2) + "R)");
  }

  log("\n" + "=".repeat(100));
  log("  SECTION 4: TRADE SURVIVAL DURATION & EXIT REASON");
  log("=".repeat(100));

  for (const b of bots) {
    const bLosses = lossTrades.filter((t) => t.bot === b);
    if (bLosses.length === 0) continue;

    const fastStop = bLosses.filter((t) => t.durationMins <= 30);
    const medStop = bLosses.filter((t) => t.durationMins > 30 && t.durationMins <= 120);
    const slowStop = bLosses.filter((t) => t.durationMins > 120 && t.durationMins <= 360);
    const zombieStop = bLosses.filter((t) => t.durationMins > 360);

    const slCount = bLosses.filter((t) => t.outcome === "SL");
    const eodCount = bLosses.filter((t) => t.outcome === "EOD");
    const newsCount = bLosses.filter((t) => t.outcome === "NEWS_CLOSE");

    log("\n  [BOT: " + b + "] Loss Duration & Exits (" + bLosses.length + " losses):");
    log("     Duration <= 30 mins (Flash Stop)   : " + fastStop.length + " (" + pct(fastStop.length, bLosses.length) + ")");
    log("     Duration 30 - 120 mins             : " + medStop.length + " (" + pct(medStop.length, bLosses.length) + ")");
    log("     Duration 2 - 6 hours               : " + slowStop.length + " (" + pct(slowStop.length, bLosses.length) + ")");
    log("     Duration > 6 hours (Slow Bleed)    : " + zombieStop.length + " (" + pct(zombieStop.length, bLosses.length) + ")");
    log("     Exit Type Breakdown:");
    log("        - Hard SL hit: " + slCount.length + " (" + pct(slCount.length, bLosses.length) + ") | " + slCount.reduce((s, t) => s + t.rMultiple, 0).toFixed(2) + "R");
    log("        - EOD / Force Close: " + eodCount.length + " (" + pct(eodCount.length, bLosses.length) + ") | " + eodCount.reduce((s, t) => s + t.rMultiple, 0).toFixed(2) + "R");
    log("        - News Force Close : " + newsCount.length + " (" + pct(newsCount.length, bLosses.length) + ") | " + newsCount.reduce((s, t) => s + t.rMultiple, 0).toFixed(2) + "R");
  }

  log("\n" + "=".repeat(100));
  log("  SECTION 5: CANDLESTICK QUALITY FORENSICS (WBR & CLOSE LOCATION)");
  log("=".repeat(100));

  const mageTrades = enrichedTrades.filter((t) => t.bot === "MAGE");
  if (mageTrades.length > 0) {
    log("  MAGE: Breakout Wick-to-Body Ratio (WBR = Breakout Wick / Candle Body)");
    const wbrBuckets = [
      { label: "WBR <= 0.25 (Pristine breakout candle, tiny/no wick)", min: 0, max: 0.25 },
      { label: "0.25 < WBR <= 0.50 (Moderate wick)", min: 0.25, max: 0.50 },
      { label: "0.50 < WBR <= 1.00 (Heavy wick, 50-100% of body)", min: 0.50, max: 1.00 },
      { label: "WBR > 1.00 (Severe rejection wick > body size!)", min: 1.00, max: Infinity },
    ];

    for (const b of wbrBuckets) {
      const match = mageTrades.filter((t) => t.actionCandleWbr >= b.min && t.actionCandleWbr < b.max);
      const w = match.filter((t) => t.rMultiple > 0).length;
      const nR = match.reduce((s, t) => s + t.rMultiple, 0);
      const negR = match.filter((t) => t.rMultiple < 0).reduce((s, t) => s + t.rMultiple, 0);
      const posR = match.filter((t) => t.rMultiple > 0).reduce((s, t) => s + t.rMultiple, 0);
      const pfStr = Math.abs(negR) > 0 ? (posR / Math.abs(negR)).toFixed(2) : "N/A";
      log("     " + b.label.padEnd(65) + ": " + match.length + " trades | WR: " + pct(w, match.length) + " | NetR: " + (nR >= 0 ? "+" : "") + nR.toFixed(2) + "R | PF: " + pfStr);
    }
  }

  log("\n  ALL BOTS: Action Candle Close Location Percentile");
  const closeLocBuckets = [
    { label: "Close in extreme 20% (Buy close >= 80%, Sell close <= 20%)", test: (t: EnrichedTrade) => t.direction === "BUY" ? t.actionCandleCloseLoc >= 0.80 : t.actionCandleCloseLoc <= 0.20 },
    { label: "Close in 20%-35% zone (Moderate conviction)", test: (t: EnrichedTrade) => t.direction === "BUY" ? (t.actionCandleCloseLoc >= 0.65 && t.actionCandleCloseLoc < 0.80) : (t.actionCandleCloseLoc > 0.20 && t.actionCandleCloseLoc <= 0.35) },
    { label: "Close in weak half (Opposite Half! Close < 50% for buy)", test: (t: EnrichedTrade) => t.direction === "BUY" ? t.actionCandleCloseLoc < 0.50 : t.actionCandleCloseLoc > 0.50 },
  ];

  for (const b of closeLocBuckets) {
    const match = enrichedTrades.filter(b.test);
    const w = match.filter((t) => t.rMultiple > 0).length;
    const nR = match.reduce((s, t) => s + t.rMultiple, 0);
    const negR = match.filter((t) => t.rMultiple < 0).reduce((s, t) => s + t.rMultiple, 0);
    const posR = match.filter((t) => t.rMultiple > 0).reduce((s, t) => s + t.rMultiple, 0);
    const pfStr = Math.abs(negR) > 0 ? (posR / Math.abs(negR)).toFixed(2) : "N/A";
    log("     " + b.label.padEnd(72) + ": " + match.length + " trades | WR: " + pct(w, match.length) + " | NetR: " + (nR >= 0 ? "+" : "") + nR.toFixed(2) + "R | PF: " + pfStr);
  }

  log("\n" + "=".repeat(100));
  log("  SECTION 6: VOLATILITY REGIME ANALYSIS (OPENING RANGE vs 14-PERIOD ATR)");
  log("=".repeat(100));

  const orbTrades = enrichedTrades.filter((t) => t.orAtrRatio > 0);
  const atrBuckets = [
    { label: "OR/ATR < 0.40 (Compressed Range - False Breakout Risk)", min: 0, max: 0.40 },
    { label: "0.40 <= OR/ATR < 0.80 (Healthy Compression)", min: 0.40, max: 0.80 },
    { label: "0.80 <= OR/ATR < 1.30 (Normal Expansion)", min: 0.80, max: 1.30 },
    { label: "OR/ATR >= 1.30 (Bloated / Exhausted Range - Overextended)", min: 1.30, max: Infinity },
  ];

  for (const b of atrBuckets) {
    const match = orbTrades.filter((t) => t.orAtrRatio >= b.min && t.orAtrRatio < b.max);
    const w = match.filter((t) => t.rMultiple > 0).length;
    const nR = match.reduce((s, t) => s + t.rMultiple, 0);
    const negR = match.filter((t) => t.rMultiple < 0).reduce((s, t) => s + t.rMultiple, 0);
    const posR = match.filter((t) => t.rMultiple > 0).reduce((s, t) => s + t.rMultiple, 0);
    const pfStr = Math.abs(negR) > 0 ? (posR / Math.abs(negR)).toFixed(2) : "N/A";
    log("     " + b.label.padEnd(70) + ": " + match.length + " trades | WR: " + pct(w, match.length) + " | NetR: " + (nR >= 0 ? "+" : "") + nR.toFixed(2) + "R | PF: " + pfStr);
  }

  log("\n" + "=".repeat(100));
  log("  SECTION 7: HIGHER TIMEFRAME (H1 50 EMA) TREND ALIGNMENT");
  log("=".repeat(100));
  const htfWith = enrichedTrades.filter((t) => t.htfEmaAligned);
  const htfAgainst = enrichedTrades.filter((t) => !t.htfEmaAligned);

  const wWith = htfWith.filter((t) => t.rMultiple > 0).length;
  const nRWith = htfWith.reduce((s, t) => s + t.rMultiple, 0);
  const negRWith = htfWith.filter((t) => t.rMultiple < 0).reduce((s, t) => s + t.rMultiple, 0);
  const posRWith = htfWith.filter((t) => t.rMultiple > 0).reduce((s, t) => s + t.rMultiple, 0);
  const pfWith = Math.abs(negRWith) > 0 ? (posRWith / Math.abs(negRWith)).toFixed(2) : "N/A";

  const wAgainst = htfAgainst.filter((t) => t.rMultiple > 0).length;
  const nRAgainst = htfAgainst.reduce((s, t) => s + t.rMultiple, 0);
  const negRAgainst = htfAgainst.filter((t) => t.rMultiple < 0).reduce((s, t) => s + t.rMultiple, 0);
  const posRAgainst = htfAgainst.filter((t) => t.rMultiple > 0).reduce((s, t) => s + t.rMultiple, 0);
  const pfAgainst = Math.abs(negRAgainst) > 0 ? (posRAgainst / Math.abs(negRAgainst)).toFixed(2) : "N/A";

  log("     With HTF H1 50 EMA Trend    : " + htfWith.length + " trades | WR: " + pct(wWith, htfWith.length) + " | NetR: " + (nRWith >= 0 ? "+" : "") + nRWith.toFixed(2) + "R | PF: " + pfWith);
  log("     Against HTF H1 50 EMA Trend : " + htfAgainst.length + " trades | WR: " + pct(wAgainst, htfAgainst.length) + " | NetR: " + (nRAgainst >= 0 ? "+" : "") + nRAgainst.toFixed(2) + "R | PF: " + pfAgainst);

  log("\n" + "=".repeat(100));
  log("  SECTION 8: CONFIG-LEVEL LOSS CONCENTRATION (SORTED BY TOTAL LOSS R)");
  log("=".repeat(100));

  const configMap = new Map<string, any>();
  for (const t of enrichedTrades) {
    if (!configMap.has(t.configKey)) {
      configMap.set(t.configKey, {
        bot: t.bot,
        pair: t.pair,
        setup: t.setup,
        trades: 0,
        wins: 0,
        losses: 0,
        netR: 0,
        winR: 0,
        lossR: 0,
        givenBackWinsCount: 0,
        instantFakeoutsCount: 0,
      });
    }
    const c = configMap.get(t.configKey)!;
    c.trades++;
    c.netR += t.rMultiple;
    if (t.rMultiple > 0) {
      c.wins++;
      c.winR += t.rMultiple;
    } else {
      c.losses++;
      c.lossR += t.rMultiple;
      if (t.mfeR >= 0.80) c.givenBackWinsCount++;
      if (t.mfeR < 0.25) c.instantFakeoutsCount++;
    }
  }

  const sortedConfigs = [...configMap.values()].sort((a, b) => a.lossR - b.lossR);

  log("\n  BOT    PAIR         TRADES   WINS   LOSS    WIN%     WIN_R    LOSS_R     NET_R  GIVE_BACK  INSTANT_FAIL");
  log("  " + "-".repeat(95));

  for (const c of sortedConfigs) {
    log(
      "  " +
      c.bot.padEnd(6) + " " +
      c.pair.padEnd(12) + " " +
      c.trades.toString().padStart(6) + " " +
      c.wins.toString().padStart(6) + " " +
      c.losses.toString().padStart(6) + " " +
      pct(c.wins, c.trades).padStart(7) + " " +
      c.winR.toFixed(2).padStart(9) + " " +
      c.lossR.toFixed(2).padStart(9) + " " +
      c.netR.toFixed(2).padStart(9) + " " +
      c.givenBackWinsCount.toString().padStart(10) + " " +
      c.instantFakeoutsCount.toString().padStart(13)
    );
  }

  log("\n" + "=".repeat(100));
  log("  SECTION 9: WHAT-IF SIMULATION OF FUNDAMENTAL LEVERS TO CUT LOSSES");
  log("=".repeat(100));

  // Lever 1: Early Break-Even / Profit Protection (Lock BE when MFE >= 0.8R)
  let simulatedNetR_Lever1 = 0;
  let savedLossR_Lever1 = 0;
  let affectedTrades_Lever1 = 0;

  for (const t of enrichedTrades) {
    if (t.rMultiple < 0 && t.mfeR >= 0.80) {
      savedLossR_Lever1 += Math.abs(t.rMultiple);
      affectedTrades_Lever1++;
    } else {
      simulatedNetR_Lever1 += t.rMultiple;
    }
  }

  log("  LEVER 1: ADAPTIVE PROFIT LOCK (Move SL to Break-Even at +0.80R MFE)");
  log("     Losing trades rescued from full loss : " + affectedTrades_Lever1 + " trades");
  log("     Gross loss R eliminated              : +" + savedLossR_Lever1.toFixed(2) + "R");
  log("     Original Portfolio Net R             : " + netR.toFixed(2) + "R");
  log("     New Portfolio Net R                  : " + simulatedNetR_Lever1.toFixed(2) + "R (+" + ((simulatedNetR_Lever1 - netR) / netR * 100).toFixed(1) + "% improvement!)\n");

  // Lever 2: Veto Breakout Candles with Severe Rejection Wick (WBR > 0.65 for Mage)
  let simulatedNetR_Lever2 = 0;
  let filteredWins_Lever2 = 0;
  let filteredLosses_Lever2 = 0;

  for (const t of enrichedTrades) {
    if (t.bot === "MAGE" && t.actionCandleWbr > 0.65) {
      if (t.rMultiple > 0) filteredWins_Lever2++;
      else filteredLosses_Lever2++;
      continue;
    }
    simulatedNetR_Lever2 += t.rMultiple;
  }

  log("  LEVER 2: MAGE BREAKOUT WICK VETO (Reject entry if action candle WBR > 0.65)");
  log("     Trades filtered                      : " + (filteredWins_Lever2 + filteredLosses_Lever2) + " (" + filteredLosses_Lever2 + " losses eliminated, " + filteredWins_Lever2 + " wins sacrificed)");
  log("     Net R delta                          : " + (simulatedNetR_Lever2 - netR >= 0 ? "+" : "") + (simulatedNetR_Lever2 - netR).toFixed(2) + "R");
  log("     New Portfolio Net R                  : " + simulatedNetR_Lever2.toFixed(2) + "R\n");

  // Lever 3: Volatility Corridor (0.35 <= OR/ATR <= 1.35)
  let simulatedNetR_Lever3 = 0;
  let filteredWins_Lever3 = 0;
  let filteredLosses_Lever3 = 0;

  for (const t of enrichedTrades) {
    if (t.orAtrRatio > 0 && (t.orAtrRatio < 0.35 || t.orAtrRatio > 1.35)) {
      if (t.rMultiple > 0) filteredWins_Lever3++;
      else filteredLosses_Lever3++;
      continue;
    }
    simulatedNetR_Lever3 += t.rMultiple;
  }

  log("  LEVER 3: VOLATILITY CORRIDOR GATE (Trade only when 0.35 <= OR/ATR <= 1.35)");
  log("     Trades filtered                      : " + (filteredWins_Lever3 + filteredLosses_Lever3) + " (" + filteredLosses_Lever3 + " losses eliminated, " + filteredWins_Lever3 + " wins sacrificed)");
  log("     Net R delta                          : " + (simulatedNetR_Lever3 - netR >= 0 ? "+" : "") + (simulatedNetR_Lever3 - netR).toFixed(2) + "R");
  log("     New Portfolio Net R                  : " + simulatedNetR_Lever3.toFixed(2) + "R\n");

  // Combined Levers 1 + 2
  let simulatedNetR_Combined = 0;
  for (const t of enrichedTrades) {
    if (t.bot === "MAGE" && t.actionCandleWbr > 0.65) continue;
    if (t.rMultiple < 0 && t.mfeR >= 0.80) {
      // Saved by BE lock
    } else {
      simulatedNetR_Combined += t.rMultiple;
    }
  }

  log("  COMBINED LEVERS (Adaptive BE Lock @ +0.8R + Mage WBR Filter):");
  log("     Original Portfolio Net R             : " + netR.toFixed(2) + "R");
  log("     Enhanced Portfolio Net R             : " + simulatedNetR_Combined.toFixed(2) + "R (+" + ((simulatedNetR_Combined - netR) / netR * 100).toFixed(1) + "% improvement!)\n");

  fs.writeFileSync(OUTPUT_REPORT, lines.join("\n"), "utf-8");
  log("Report successfully written to: " + OUTPUT_REPORT);
}

main().catch((e) => {
  console.error("Fatal error during analysis:", e);
  process.exit(1);
});
