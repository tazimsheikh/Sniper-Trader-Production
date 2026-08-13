import path from "path";
import fs from "fs";
import { loadCsv } from "./loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { buildEmaArray } from "../market/Indicators.js";
import { DailyContextTracker } from "../market/DailyContextTracker.js";
import {
  MAGE_PAIR_CONFIG,
  SAGE_PAIR_CONFIG,
  PairConfigManager,
} from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { TradeRecord, TradeOutcome, M1TypedArrays } from "../config/types.js";
import { isNewsForceClose } from "../market/historicalNews.js";
import { isEODSession } from "../market/MathFilters.js";
import { preComputeTriggers, evaluateExits } from "./math_core/SageMathCore.js";

const backtestCache = new Map<
  string,
  { m5Candles: any[]; emaArr: any; m1Rows: any[] }
>();

export async function runSageMathBacktest(
  pair: string,
  startDate?: string,
  endDate?: string,
  ignoreFilters: boolean = false,
  overrideParams: any = {},
  overrideConfigs?: any[],
  enableTrace: boolean = false,
) {
  for (const key of backtestCache.keys()) {
    if (!key.startsWith(pair)) {
      backtestCache.delete(key);
    }
  }

  const normalizedPair = pair.split("_")[0].split(".")[0].trim().toUpperCase();
  const isCrypto = pair.includes("BTC") || pair.includes("ETH");
  const isIndex =
    pair.includes("NAS") ||
    pair.includes("US30") ||
    pair.includes("GER40") ||
    pair.includes("XTIUSD") ||
    pair.includes(".Daily") ||
    pair.includes("SPX500") ||
    pair.includes("JPN225");
  const isForex = !isCrypto && !isIndex;
  const sageConfigs = overrideConfigs || PairConfigManager.getSageConfigs(pair);
  if (!sageConfigs || sageConfigs.length === 0) throw new Error(`Unknown pair: ${pair}`);

  const baseConfig = sageConfigs[0];
  const config = {
    ...baseConfig,
    ...overrideParams,
  };

  const requiredSageProps = [
    "orbStartHour",
    "orbStartMin",
    "orbMinutes",
    "actionMinutes",
    "sweepPips",
    "forceCloseHours",
    "trailingSlTrigger",
    "trailingSlStep",
    "entryPenetrationPct",
    "exitMode",
    "minSlDist",
    "maxSlDist",
    "maxSweepMultiplier",
    "requireCloseInside",
  ];
  for (const prop of requiredSageProps) {
    if ((config as any)[prop] === undefined) {
      console.warn(`[STRICT MODE BYPASS] Missing '${prop}' for ${pair}. Falling back to defaults.`);
      (config as any)[prop] = 0;
    }
  }

  // Optional filter fields � correct defaults when not set by optimizer
  if ((config as any).htfAlignmentRequired === undefined) (config as any).htfAlignmentRequired = false;
  // maxBodyPips left undefined when absent � SageMathCore guards with !== undefined check

  const baseSymbol = pair.replace(".Daily", "");
  const optConfig = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[baseSymbol];
  if (!optConfig) throw new Error(`No OPTIMIZER_CONFIG found for ${pair}`);

  const { tickSize, pipSize, spread } = optConfig;
  const spreadPts = spread * pipSize;
  const session = pair.split("_")[1];

  const cacheKey = `${pair}_${spread}_${startDate || ""}_${endDate || ""}`;
  let m5Candles: any[];
  let emaArr: any;
  let m1Rows: any[];

  if (backtestCache.has(cacheKey)) {
    const cached = backtestCache.get(cacheKey)!;
    m5Candles = cached.m5Candles;
    emaArr = cached.emaArr;
    m1Rows = cached.m1Rows;
  } else {
    const basePrefix = pair.split("_")[0].split(".")[0];
    const csvFiles = fs
      .readdirSync(path.join(process.cwd(), "data", "csv"))
      .filter((f) => f.startsWith(basePrefix) && f.endsWith(".csv"));
    if (!csvFiles.length)
      throw new Error(`No CSV data found for ${pair} (prefix: ${basePrefix})`);

    console.log(`🔱 Sage Math Backtest — ${pair}`);
    console.log(`📁 Loading: ${csvFiles[0]}`);
    const startD = startDate
      ? new Date(new Date(startDate).getTime() - 15 * 24 * 60 * 60 * 1000)
      : undefined;
    const endD = endDate
      ? new Date(new Date(endDate).getTime() + 86400000 - 1)
      : undefined;
    m1Rows = await loadCsv(
      path.join(process.cwd(), "data", "csv", csvFiles[0]),
      spread,
      startD,
      endD,
    );
    m5Candles = aggregateCandles(m1Rows, 5);
    emaArr = buildEmaArray(m5Candles, 20);

    backtestCache.set(cacheKey, { m5Candles, emaArr, m1Rows });
  }

  let globalStartIdx = 0;
  let globalEndIdx = m1Rows.length - 1;
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() - 86400000 * 15 : 0; // 15 days warmup
    const end = endDate ? new Date(endDate).getTime() + 86400000 : Infinity;
    globalStartIdx = m1Rows.findIndex((c) => c.timestamp >= start);
    if (globalStartIdx === -1) globalStartIdx = 0;

    globalEndIdx = m1Rows.length - 1;
    while (globalEndIdx >= 0 && m1Rows[globalEndIdx].timestamp >= end)
      globalEndIdx--;

    console.log(
      `📅 Date range: ${startDate || "start"} → ${endDate || "end"} (Trading starts at index ${globalStartIdx})`,
    );
  }

  console.log(`🕯️  ${m1Rows.length.toLocaleString()} M1 ticks loaded`);

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
      m1Typed.isSessionReset[i] = ((prevH < 17 && r.estHour >= 17) || (prevH > r.estHour && r.estHour >= 17) || (r.estHour === 17 && r.minute === 0)) ? 1 : 0;
      m1Typed.isMidnightExpiry[i] = (prevH > r.estHour && r.estHour < 17) ? 1 : 0;
    }
    const dStr = new Date(r.timestamp).toISOString().split("T")[0];
    m1Typed.isEOD_standard[i] = isEODSession(r.estHour, r.minute) ? 1 : 0;
    m1Typed.isEOD_standard[i] = isEODSession(r.estHour, r.minute) ? 1 : 0;
    m1Typed.isNewsForceClose[i] = isNewsForceClose(dStr, r.estHour, r.minute) ? 1 : 0;
  }

  const allRecords: TradeRecord[] = [];

  for (const loopConfig of sageConfigs) {
    const config = {
      ...loopConfig,
      ...overrideParams,
    };

    const sessionName = pair.split("_")[1] || config.session || "asia";

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
      config.sweepPips,
      config.actionMinutes,
      config.maxSweepMultiplier,
      config.requireCloseInside
    );

    const evalRes = evaluateExits(
      m1Typed,
      m5Candles,
      triggers,
      pair,
      config,
      sessionName,
      isForex,
      0
    );

    const sig = config.signature || "default";
    const mappedRecords = (evalRes.tradeRecords || []).map((tr: any) => {
      return {
        timestamp: tr.timestamp,
        date: new Date(tr.timestamp).toISOString().split("T")[0],
        pair,
        setupType: "SAGE_REVERSAL",
        sessionName: "NYSE ORB",
        decision: "TRADE",
        confidence: 1.0,
        setupQuality: 100,
        reasoning: "Sage Reversal Triggered",
        entry: tr.entryPrice ?? 0,
        stopLoss: tr.slPrice ?? 0,
        takeProfit: tr.tpPrice ?? 0,
        riskPips: tr.risk / pipSize,
        outcome: tr.outcome as TradeOutcome,
        pips: (tr.rMultiple !== null && tr.rMultiple !== undefined) ? tr.rMultiple * (tr.risk / pipSize) : null,
        rMultiple: tr.rMultiple,
        exitPrice: tr.exitPrice,
        clientId: sig,
        botId: `SAGE_${sig}`,
        orHigh: tr.orHigh,
        orLow: tr.orLow,
        entryTimeMs: tr.entryTimeMs,
        trailLog: tr.trailLog,
        openTime: tr.timestamp || tr.entryTimeMs || (tr.date ? new Date(tr.date).getTime() : 0),
        closeTime: tr.exitTimeMs || tr.closeTimeMs || (tr.timestamp ? tr.timestamp + 3600000 : 0),
      } as any;
    });

    for (const rec of mappedRecords) {
      allRecords.push(rec);
    }
  }

  allRecords.sort((a, b) => a.openTime - b.openTime);

  const startMs = startDate ? new Date(startDate).getTime() : null;
  const endMs = endDate ? new Date(endDate).getTime() + 86400000 : null;
  const filteredRecords = allRecords.filter((r) => {
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
  console.log(`📈  SAGE MATH BACKTEST RESULTS: ${pair}`);
  console.log(`📅  ${startDate || "ALL"} to ${endDate || "ALL"}`);
  console.log(`   Trades skipped (NO_TRADE): ${skipped}`);
  console.log(`   Trades taken: ${tradedRecords.length}`);
  console.log(`[MB T2 RETURN] returning ${filteredRecords.length} records. First date: ${filteredRecords.length > 0 ? filteredRecords[0].date : 'none'}`);
  return {
    records: filteredRecords,
    m5Candles,
    wins,
    losses,
    netPips,
    winRate,
    skipped,
    totalTrades: tradedRecords.length,
    netR: tradedRecords.reduce((sum, r) => sum + (r.R || 0), 0),
  };
}
