// ============================================================
// VISION BACKTESTER (MAGE PURE ORB MATH)
// Strictly mirrors mage_optimizer.ts
// ============================================================
import path from "path";
import fs from "fs";
import { loadCsv } from "./loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { buildEmaArray, buildAtrArray } from "../market/Indicators.js";
import { MAGE_PAIR_CONFIG, PairConfigManager } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { TradeRecord, TradeOutcome, M1TypedArrays } from "../config/types.js";
import { isNewsForceClose } from "../market/historicalNews.js";
import { isEODSession } from "../market/MathFilters.js";
import { preComputeTriggers, evaluateExits } from "./math_core/MageMathCore.js";
import { getFixedEstDate } from "./math_core/MathCoreUtils.js";


const backtestCache = new Map<
  string,
  { m5Candles: any[]; emaArr: any; ema200Arr: any; atrArr: any; m1Rows: any[] }
>();

export function clearMageBacktestCache(pair?: string) {
  if (pair) {
    for (const k of backtestCache.keys()) {
      if (k.startsWith(pair)) backtestCache.delete(k);
    }
  } else {
    backtestCache.clear();
  }
}

export async function runMathBacktest(
  pair: string,
  startDate?: string,
  endDate?: string,
  ignoreFilters: boolean = false,
  minSlOverride?: number,
  maxSlOverride?: number,
  extremeFilter: string | null = null,
  overrideConfigs?: any[],
  enableTrace: boolean = false,
) {
    const isForex = PairConfigManager.isForex(pair);
    const configs = overrideConfigs || PairConfigManager.getMageConfigs(pair);
    if (!configs || configs.length === 0) {
      console.log(`[MB ERROR] No configs found for ${pair}`);
      return { trades: 0, netR: 0, records: [] };
    }

    const baseConfig = configs[0];
    const baseSymbol = pair.replace(".Daily", "");
    const optConfig = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[baseSymbol];
    if (!optConfig) throw new Error(`No OPTIMIZER_CONFIG found for ${pair}`);

    const { tickSize, pipSize, spread } = optConfig;
    const spreadPts = spread * pipSize;
  for (const key of backtestCache.keys()) {
    if (!key.startsWith(pair)) {
      backtestCache.delete(key);
    }
  }

  const cacheKey = `${pair}_${optConfig.spread}_${startDate || ""}_${endDate || ""}`;
  const isCrypto = pair.includes("BTC") || pair.includes("ETH");
  let m5Candles: any[];
  let m1Rows: any[];
  let emaArr: any;
  let ema200Arr: any;
  let atrArr: any;

  const cached = backtestCache.get(cacheKey);

  if (cached) {
    console.log(`[Cache Hit] Using cached m5Candles for ${pair}`);
    m5Candles = cached.m5Candles;
    emaArr = cached.emaArr;
    ema200Arr = cached.ema200Arr;
    atrArr = cached.atrArr;
    m1Rows = cached.m1Rows;
  } else {
    // Load data
    const csvFiles = fs
      .readdirSync(path.join(process.cwd(), "data", "csv"))
      .filter((f) => f.startsWith(pair.split("_")[0]) && f.endsWith(".csv"));
    if (!csvFiles.length) throw new Error(`No CSV data found for ${pair}`);

    console.log(`🔱 Mage Math Backtest — ${pair}`);
    const startD = startDate
      ? new Date(new Date(startDate).getTime() - 30 * 24 * 60 * 60 * 1000)
      : undefined;
    const endD = endDate ? new Date(new Date(endDate).getTime() + 86400000 - 1) : undefined;

    m1Rows = [];
    for (const f of csvFiles) {
      console.log(`📁 Loading: ${f}`);
      m1Rows = m1Rows.concat(
        await loadCsv(
          path.join(process.cwd(), "data", "csv", f),
          spread,
          startD,
          endD,
        ),
      );
    }

    m5Candles = aggregateCandles(m1Rows, 5);
    emaArr = buildEmaArray(m5Candles, 50); // M5 50 EMA
    ema200Arr = buildEmaArray(m5Candles, 200); // M5 200 EMA
    atrArr = buildAtrArray(m5Candles, 14);

    backtestCache.set(cacheKey, {
      m5Candles,
      emaArr,
      ema200Arr,
      atrArr,
      m1Rows,
    });
  }

  let globalStartIdx = 0;
  let globalEndIdx = m5Candles.length - 1;
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() - 86400000 * 30 : 0; // 30 days warmup for ATR convergence
    const end = endDate ? new Date(endDate).getTime() + 86400000 : Infinity;
    globalStartIdx = m5Candles.findIndex((c) => c.timestamp >= start);
    if (globalStartIdx === -1) globalStartIdx = 0;

    globalEndIdx = m5Candles.length - 1;
    while (globalEndIdx >= 0 && m5Candles[globalEndIdx].timestamp >= end)
      globalEndIdx--;

    console.log(
      `📅 Date range: ${startDate || "start"} → ${endDate || "end"} (Trading starts at index ${globalStartIdx})`,
    );
  }

  console.log(`🕯️  ${m5Candles.length.toLocaleString()} M5 candles loaded`);

  const m1Length = m1Rows.length;
  const m1Typed: M1TypedArrays = {
    open: new Float64Array(m1Length),
    high: new Float64Array(m1Length),
    low: new Float64Array(m1Length),
    close: new Float64Array(m1Length),
    timestamp: new Float64Array(m1Length),
    estHour: new Int32Array(m1Length),
    minute: new Int32Array(m1Length),
    isSessionReset: new Uint8Array(m1Length),
    isMidnightExpiry: new Uint8Array(m1Length),
    isEOD_standard: new Uint8Array(m1Length),
    isNewsForceClose: new Uint8Array(m1Length),
    length: m1Length,
  };
  for (let i = 0; i < m1Length; i++) {
    const r = m1Rows[i];
    m1Typed.open[i] = r.open;
    m1Typed.high[i] = r.high;
    m1Typed.low[i] = r.low;
    m1Typed.close[i] = r.close;
    m1Typed.timestamp[i] = r.timestamp;
    m1Typed.estHour[i] = r.estHour;
    m1Typed.minute[i] = r.minute;
    if (i > 0) {
      const prevH = m1Rows[i-1].estHour;
      m1Typed.isSessionReset[i] = ((prevH < 15 && r.estHour >= 15) || (prevH > r.estHour && r.estHour >= 15) || (r.estHour === 15 && r.minute === 0)) ? 1 : 0;
      m1Typed.isMidnightExpiry[i] = (prevH > r.estHour && r.estHour < 15) ? 1 : 0;
    }
    const estDate = getFixedEstDate(new Date(r.timestamp));
    const dStr = estDate.toISOString().split("T")[0];
    m1Typed.isEOD_standard[i] = isEODSession(r.estHour, r.minute) ? 1 : 0;
    m1Typed.isEOD_standard[i] = isEODSession(r.estHour, r.minute) ? 1 : 0;
    m1Typed.isNewsForceClose[i] = isNewsForceClose(dStr, r.estHour, r.minute) ? 1 : 0;
  }

  const allRecords: TradeRecord[] = [];
  let cfgIdx = 0;
  for (const config of configs) {
    const sessionName = config.session || "ny";
    const triggers = preComputeTriggers(
      m5Candles,
      m1Rows,
      pair,
      spreadPts,
      sessionName,
      isForex,
      pipSize,
      config.orbStartHour!,
      config.orbStartMin!,
      config.orbMinutes!,
      config.actionMinutes,
      config.minBodyPips,
      config.minBodyRatio,
      config.minCloseLoc,
      config.htfTrendFilter ?? config.useHtfEma,
      config.useHtfSar ?? config.useHtfSarFilter,
      config
    );
    const startMs = startDate ? new Date(startDate).getTime() : 0;
    const validTriggers = triggers.filter(t => m5Candles[t.m5Index].timestamp >= startMs);

    const evalRes = evaluateExits(
      m1Typed,
      m5Candles,
      validTriggers,
      pair,
      config,
      sessionName,
      isForex,
      0
    );

    const sig = config.signature || `default_${cfgIdx}`;
    for (const r of evalRes.records) {
      r.clientId = sig;
      r.botId = `MAGE_${sig}`;
      r.pair = pair;
      r.setupType = "MAGE_ORB";
      r.sessionName = sessionName;
      r.confidence = 1;
      r.setupQuality = "N/A";
      r.reasoning = "Math Match";
      r.pips = r.rMultiple !== null && r.rMultiple !== undefined ? r.rMultiple * r.riskPips : null;
      if (enableTrace && r.outcome !== "SKIPPED") {
        const dStr = getFixedEstDate(new Date(r.timestamp)).toISOString().split("T")[0];
        const tStr = new Date(r.timestamp).toISOString().substring(11, 19);
        const exitTimeStr = r.exitTimeMs ? new Date(r.exitTimeMs).toISOString().substring(11, 19) : "N/A";
        console.log(`[T1] Date: ${dStr} | EntryTime: ${tStr} | Entry: ${r.entry.toFixed(3)} | SL: ${r.stopLoss.toFixed(3)} | TP: ${r.takeProfit.toFixed(3)} | ExitTime: ${exitTimeStr} | Outcome: ${r.outcome} | R: ${r.rMultiple?.toFixed(2)}`);
      }
    }
    for (const rec of evalRes.records) {
      allRecords.push(rec);
    }
    cfgIdx++;
  }
  
  // Sort chronologically across all configs and filter duplicate trade timestamps
  allRecords.sort((a, b) => a.timestamp - b.timestamp);
  const uniqueRecords: TradeRecord[] = [];
  const seenTimestamps = new Set<string>();
  for (const rec of allRecords) {
    if (rec.outcome === "SKIPPED") continue;
    const key = `${rec.clientId || 'default'}_${rec.timestamp}`;
    if (!seenTimestamps.has(key)) {
      seenTimestamps.add(key);
      uniqueRecords.push(rec);
    }
  }


  const startMs = startDate ? new Date(startDate).getTime() : null;
  const endMs = endDate ? new Date(endDate).getTime() + 86400000 : null;
  const filteredRecords = uniqueRecords.filter((r) => {
    return (!startMs || r.timestamp >= startMs) && (!endMs || r.timestamp <= endMs);
  });

  const tradedRecords = filteredRecords.filter((r) => r.outcome !== "SKIPPED");
  const skipped = filteredRecords.filter((r) => r.outcome === "SKIPPED").length;
  const wins = tradedRecords.filter((r) => (r.pips ?? 0) > 0).length;
  const losses = tradedRecords.filter((r) => (r.pips ?? 0) <= 0).length;
  const netPips = tradedRecords.reduce((sum, r) => sum + (r.pips ?? 0), 0);
  const winRate =
    tradedRecords.length > 0 ? (wins / tradedRecords.length) * 100 : 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📈  MAGE MATH BACKTEST RESULTS: ${pair}`);
  console.log(`📅  ${startDate || "ALL"} to ${endDate || "ALL"}`);
  console.log(`   Trades skipped (NO_TRADE): ${skipped}`);
  console.log(`   Trades taken: ${tradedRecords.length}`);
  return {
    records: filteredRecords,
    m5Candles,
    wins,
    losses,
    netPips,
    winRate,
    skipped,
  };
}
