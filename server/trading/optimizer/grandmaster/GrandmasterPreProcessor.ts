import { GrandmasterOptimizerState } from "../../config/types.js";
import { IndependentSynthesisComponent, evaluateComponent } from "./GrandmasterMetrics.js";
import { rankPercentile } from "./utils/GrandmasterMath.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { runMathBacktest as runMageMathBacktest } from "../../backtester/MageMathBacktester.js";
import { runSageMathBacktest } from "../../backtester/SageMathBacktester.js";
import * as fs from "fs";
import * as path from "path";
import { getLatestDate } from "../../backtester/loadCsv.js";

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

    const maxBodyPart = parts.find((p) => p.startsWith("MaxBody"));
    const maxBody =
      maxBodyPart && maxBodyPart !== "MaxBodyNone"
        ? parseFloat(maxBodyPart.replace("MaxBody", ""))
        : undefined;

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
      maxBodyPips: maxBody,
      htfAlignmentRequired: true,
      maxH1EmaSlope: 20,
    };
  } else {
    // Mage
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

export function deduplicateConfigs(
  data: GrandmasterOptimizerState[],
  botType: "Mage" | "Sage",
  maxPerSig: number = 3,
): GrandmasterOptimizerState[] {
  const groups: Record<string, GrandmasterOptimizerState[]> = {};
  for (const config of data) {
    const setupStr = config?.setup || (config as any)?.params || (config as any)?.signature;
    if (!setupStr || typeof setupStr !== "string") continue;
    const parts = setupStr.split("_");
    let session = parts[0];
    if (parts[0] === "NY") session = `NY_${parts[1]}`;

    const fcPart = parts.find((p) => p.startsWith("FC")) || "NoFC";

    let signature = "";
    if (botType === "Sage") {
      const sweepPart = parts.find((p) => p.startsWith("Sweep")) || "NoSweep";
      const exitPart = parts.find((p) => p.startsWith("Exit")) || "NoExit";
      signature = `${session}_${sweepPart}_${exitPart}_${fcPart}`;
    } else {
      const bodyPart = parts.find((p) => p.startsWith("Body")) || "NoBody";
      const bypassPart = parts.find((p) => p.endsWith("%")) || "0%";
      signature = `${session}_${bypassPart}_${bodyPart}_${fcPart}`;
    }

    if (!groups[signature]) groups[signature] = [];
    groups[signature].push(config);
  }

  const result: GrandmasterOptimizerState[] = [];
  for (const group of Object.values(groups)) {
    group.sort((a, b) => {
      const ddA = (a.maxDd !== undefined && a.maxDd > 0) ? a.maxDd : 1.0;
      const ddB = (b.maxDd !== undefined && b.maxDd > 0) ? b.maxDd : 1.0;
      const pfA = a.profitFactor !== undefined ? a.profitFactor : 1.0;
      const pfB = b.profitFactor !== undefined ? b.profitFactor : 1.0;
      const scoreA = (a.totalNetR / ddA) * pfA;
      const scoreB = (b.totalNetR / ddB) * pfB;
      return scoreB - scoreA;
    });
    result.push(...group.slice(0, maxPerSig));
  }
  return result;
}

export function getEliteComponents(
  validComponents: IndependentSynthesisComponent[],
  botType: string,
  minTrades: number,
): IndependentSynthesisComponent[] {
  const PAIR_MIN_SL_FLOOR: Record<string, number> = {
    // Majors — minimum 5 pips (optimizer grid floor)
    'EURUSD': 5.0, 'GBPUSD': 5.0,
    // Minor pairs — minimum 8 pips
    'USDCHF': 8.0, 'USDCAD': 8.0, 'AUDUSD': 8.0, 'NZDUSD': 8.0,
    // JPY crosses — minimum 15 pips (spread trap prevention)
    'USDJPY': 15.0, 'EURJPY': 15.0, 'GBPJPY': 15.0,
    'AUDJPY': 15.0, 'CADJPY': 15.0, 'CHFJPY': 15.0,
    // Volatile crosses — minimum 15 pips
    'EURAUD': 15.0, 'EURNZD': 15.0, 'GBPAUD': 15.0,
    'GBPNZD': 15.0, 'EURCAD': 15.0, 'GBPCAD': 15.0,
    // Indices & Metals — reduced from 20 → 10 pips.
    // US30/NAS100/GER40 spreads are 3-5 pips; a 15-pip SL is geometrically sound.
    // The old 20-pip floor was silently blocking 22R+ tight-stop breakout alphas.
    'GER40': 10.0, 'GER40.Daily': 10.0,
    'US30': 10.0, 'US30.Daily': 10.0,
    'NAS100': 10.0, 'NAS100.Daily': 10.0,
    'SPX500': 10.0, 'SPX500.Daily': 10.0,
    // JPN225 reduced from 30 → 15 pips (spread is ~8 pips)
    'JPN225': 15.0, 'JPN225.Daily': 15.0,
    'XAUUSD': 20.0, 'XTIUSD': 8.0,
    // Crypto — reduced from 20 → 10 pips (BTC spread is ~5-8 pips)
    'BTCUSD': 10.0, 'BTCUSD.Daily': 10.0,
    'ETHUSD': 10.0, 'ETHUSD.Daily': 10.0,
  };


  let pool = validComponents.filter(
    (c) => {
      const minSlMatch = c.setup.match(/MinSL([\d\.]+)/i);
      const minSlVal = minSlMatch ? parseFloat(minSlMatch[1]) : 999;
      const minAllowedSl = PAIR_MIN_SL_FLOOR[c.symbol] || PAIR_MIN_SL_FLOOR[c.symbol.replace('.Daily', '')] || 2.0;
      if (minSlVal < minAllowedSl) {
        return false; // Purge unfillable micro-SL candidate
      }

      return (
        c.botType === botType &&
        c.totalTrades >= 3 && // Absolute floor matches GrandmasterMetrics.ts — sampleSizeFactor handles overfitting
        c.totalTotalR >= 1.0 &&
        ((c.sharpeRatio || 0) >= 0.3 || c.totalTotalR >= 5.0) &&
        (c.recentSixMonthTrades || 0) >= 1 &&
        ((c.recentMomentumR || 0) >= 3.0 || (c.recentTwoMonthR || 0) >= 2.0)
      );
    }
  );
  if (pool.length === 0) return [];

  // Sort candidates by robust composite hedgeScore (which incorporates sortino, recovery, regime, & consistency)
  const sortedAll = [...pool].sort((a, b) => b.hedgeScore - a.hedgeScore);
  return sortedAll;
}

export async function preProcessData(
  symbol: string,
  mageData: GrandmasterOptimizerState[],
  sageData: GrandmasterOptimizerState[],
  globalDates: string[],
  minTrades: number,
  skipAudit: boolean = false
): Promise<{ normalList: IndependentSynthesisComponent[]; rawValidCount: number }> {
  for (const state of mageData) {
    if (!state) continue;
    state.dailyRArray = new Float64Array(globalDates.length);
    for (let i = 0; i < globalDates.length; i++) {
      state.dailyRArray[i] = (state.dailyNetR && state.dailyNetR[globalDates[i]]) || 0;
    }
  }
  for (const state of sageData) {
    if (!state) continue;
    state.dailyRArray = new Float64Array(globalDates.length);
    for (let i = 0; i < globalDates.length; i++) {
      state.dailyRArray[i] = (state.dailyNetR && state.dailyNetR[globalDates[i]]) || 0;
    }
  }

  let validComponents: IndependentSynthesisComponent[] = [];

  let recentCutoffStr = "1970-01-01";
  if (globalDates.length > 0) {
    const lastDate = new Date(globalDates[globalDates.length - 1]);
    const cutoffDate = new Date(lastDate.getTime() - 90 * 24 * 60 * 60 * 1000);
    recentCutoffStr = cutoffDate.toISOString().split("T")[0];
  }

  for (const mState of mageData) {
    let finalSliceR = 0;
    for (let i = 0; i < globalDates.length; i++) {
      if (globalDates[i] >= recentCutoffStr) finalSliceR += mState.dailyRArray[i];
    }
    if (finalSliceR < 0) continue;
    const result = evaluateComponent(mState as any, symbol, "Mage", globalDates, false);
    if (result) validComponents.push(result);
  }
  for (const sState of sageData) {
    let finalSliceR = 0;
    for (let i = 0; i < globalDates.length; i++) {
      if (globalDates[i] >= recentCutoffStr) finalSliceR += sState.dailyRArray[i];
    }
    if (finalSliceR < 0) continue;
    const result = evaluateComponent(sState as any, symbol, "Sage", globalDates, false);
    if (result) validComponents.push(result);
  }

  // Audit exact trade-by-trade win rates using Tier 1 Math Backtester
  if (!skipAudit) {
    let endDate = "2026-08-03";
    let startDate = "2023-08-03";
    try {
      const csvDir = path.join(process.cwd(), "data", "csv");
      const csvFiles = fs.readdirSync(csvDir).filter((f) => f.startsWith(`${symbol.split("_")[0]}`) && f.endsWith(".csv"));
      if (csvFiles.length > 0) {
        const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
        endDate = latestDate.toISOString().substring(0, 10);
        const sd = new Date(latestDate.getTime());
        sd.setFullYear(sd.getFullYear() - 3);
        startDate = sd.toISOString().substring(0, 10);
      }
    } catch (e) {}

    for (let i = validComponents.length - 1; i >= 0; i--) {
      const p = validComponents[i];
      try {
        const cfg = parseSetupToConfig(p.setup, p.symbol, p.botType === "Sage");
        const res = p.botType === "Sage"
          ? await runSageMathBacktest(p.symbol, startDate, endDate, false, {}, [cfg])
          : await runMageMathBacktest(p.symbol, startDate, endDate, false, undefined, undefined, null, [cfg]);
        const records: any[] = res.records || (Array.isArray(res) ? res : []);
        if (records.length > 0) {
          const wins = records.filter(r => (r.rMultiple || r.pips || 0) > 0).length;
          p.winRate = (wins / records.length) * 100;

          // Real-time CSV Audit Safeguard: Check Net R in the last 60 days (June - August)
          const cutoff60Ms = new Date(endDate).getTime() - 60 * 24 * 60 * 60 * 1000;
          let recent60DayR = 0;
          let recent60DayTrades = 0;
          for (const r of records) {
            const tStr = r.exitTime || r.entryTime || r.time || r.date;
            if (tStr) {
              const tradeTime = new Date(tStr).getTime();
              if (tradeTime >= cutoff60Ms) {
                recent60DayR += (r.rMultiple || 0);
                recent60DayTrades++;
              }
            }
          }

          // If candidate lost more than 3.0R in the last 60 days on the actual CSVs, PURGE IT!
          if (recent60DayTrades > 0 && recent60DayR < -3.0) {
            console.log(`[DECAY PURGE] Purging ${p.botType} ${p.symbol} (${p.setup}) - 60d CSV Net R: ${recent60DayR.toFixed(2)}R`);
            validComponents.splice(i, 1);
          }
        }
      } catch (e) {}
    }
  }

  if (validComponents.length > 0) {
    const allSharpes = validComponents.map((p) => p.sharpeRatio).sort((a, b) => a - b);
    const allRecoveries = validComponents.map((p) => p.recoveryFactor).sort((a, b) => a - b);
    const allPFs = validComponents.map((p) => (p.threeYearProfitFactor || 1)).sort((a, b) => a - b);

    for (const p of validComponents) {
      const sharpeRank = rankPercentile(p.sharpeRatio, allSharpes);
      const recoveryRank = rankPercentile(p.recoveryFactor, allRecoveries);
      const pfRank = rankPercentile(p.threeYearProfitFactor || 1, allPFs);

      // Dynamic MetaAPI Spread Boosts:
      // Low Spread (<= 1.3 pips)  -> +60% (AUDUSD, EURUSD, GBPUSD, USDCAD, USDJPY)
      // Tier 2 (1.4 - 1.7 pips)  -> +35%
      // Tier 3 (1.8 - 2.0 pips)  -> +15%
      // Tier 4 (> 2.0 pips)      -> Neutral (1.0) — Math Backtester already prices in spread cost.
      // NOTE: No spread PENALTY tiers. High-spread pairs (GBPJPY, GBPNZD, GBPAUD) already have
      // their spread cost embedded in every backtest trade result. A second penalty here is a
      // double-count that destroys 63R+ configs before they reach clustering.
      const baseSym = p.symbol.split('.')[0].toUpperCase();
      const config = OPTIMIZER_CONFIG[baseSym];
      const spread = config ? config.spread : 2.0;

      let spreadBoost = 1.0;
      if (spread <= 1.3) {
        spreadBoost = 1.60;
      } else if (spread <= 1.7) {
        spreadBoost = 1.35;
      } else if (spread <= 2.0) {
        spreadBoost = 1.15;
      }
      // Spread > 2.0: neutral (1.0) — no double penalty

      p.hedgeScore = sharpeRank * recoveryRank * pfRank * spreadBoost;
    }
  }

  validComponents.sort((a, b) => b.hedgeScore - a.hedgeScore);

  const mages = getEliteComponents(validComponents, "Mage", minTrades);
  const sages = getEliteComponents(validComponents, "Sage", minTrades);

  // --- NORMAL POOL (Mage & Sage high-yield powerhouses) ---
  const normalList = [...mages, ...sages];

  return { normalList, rawValidCount: validComponents.length };
}
