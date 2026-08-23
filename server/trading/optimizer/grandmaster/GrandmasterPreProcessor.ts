import { GrandmasterOptimizerState, M1TypedArrays, TriggerEvent } from "../../config/types.js";
import { IndependentSynthesisComponent, evaluateComponent } from "./GrandmasterMetrics.js";
import { rankPercentile } from "./utils/GrandmasterMath.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { preComputeTriggers as preComputeMageTriggers, evaluateExits as evaluateMageExits } from "../../backtester/math_core/MageMathCore.js";
import { preComputeTriggers as preComputeSageTriggers, evaluateExits as evaluateSageExits } from "../../backtester/math_core/SageMathCore.js";
import { aggregateCandles } from "../../market/CandleAggregator.js";
import { loadCsv, getLatestDate } from "../../backtester/loadCsv.js";
import { isNewsForceClose } from "../../market/historicalNews.js";
import { isEODSession } from "../../market/MathFilters.js";
import { getFixedEstDate } from "../../backtester/math_core/MathCoreUtils.js";
import * as fs from "fs";
import * as path from "path";

interface SymbolCandleCache {
  m1Rows: any[];
  m1Typed: M1TypedArrays;
  m5Candles: any[];
  isForex: boolean;
  pipSize: number;
  spreadPts: number;
  startDate: string;
  endDate: string;
}

const symbolCandleDataCache = new Map<string, SymbolCandleCache>();

async function getOrLoadSymbolCandleData(symbol: string): Promise<SymbolCandleCache | null> {
  const baseSymbol = symbol.split(".")[0].split("_")[0];
  if (symbolCandleDataCache.has(symbol)) {
    return symbolCandleDataCache.get(symbol)!;
  }

  const csvDir = path.join(process.cwd(), "data", "csv");
  const csvFiles = fs.readdirSync(csvDir).filter((f) => f.startsWith(baseSymbol) && f.endsWith(".csv"));
  if (csvFiles.length === 0) return null;

  const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
  const endDate = latestDate.toISOString().substring(0, 10);
  const sd = new Date(latestDate.getTime());
  sd.setFullYear(sd.getFullYear() - 3);
  const startDate = sd.toISOString().substring(0, 10);

  const optConfig = OPTIMIZER_CONFIG[symbol] || OPTIMIZER_CONFIG[baseSymbol];
  const spread = optConfig ? optConfig.spread : 2.0;
  const pipSize = optConfig ? optConfig.pipSize : 0.0001;
  const spreadPts = spread * pipSize;
  const isForex = !symbol.includes("BTC") && !symbol.includes("ETH") && !["US30", "NAS100", "SPX500", "GER40", "UK100", "JPN225"].some(idx => symbol.includes(idx));

  const startD = new Date(new Date(startDate).getTime() - 15 * 24 * 60 * 60 * 1000);
  const endD = new Date(new Date(endDate).getTime() + 86400000 - 1);

  let m1Rows: any[] = [];
  for (const f of csvFiles) {
    m1Rows = m1Rows.concat(await loadCsv(path.join(csvDir, f), spread, startD, endD));
  }

  if (m1Rows.length === 0) return null;

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
      const prevH = m1Rows[i - 1].estHour;
      m1Typed.isSessionReset[i] = ((prevH < 15 && r.estHour >= 15) || (prevH > r.estHour && r.estHour >= 15) || (r.estHour === 15 && r.minute === 0)) ? 1 : 0;
      m1Typed.isMidnightExpiry[i] = (prevH > r.estHour && r.estHour < 15) ? 1 : 0;
    }
    const estDate = getFixedEstDate(new Date(r.timestamp));
    const dStr = estDate.toISOString().split("T")[0];
    m1Typed.isEOD_standard[i] = isEODSession(r.estHour, r.minute) ? 1 : 0;
    m1Typed.isNewsForceClose[i] = isNewsForceClose(dStr, r.estHour, r.minute) ? 1 : 0;
  }

  const m5Candles = aggregateCandles(m1Rows, 5);

  const entry: SymbolCandleCache = {
    m1Rows,
    m1Typed,
    m5Candles,
    isForex,
    pipSize,
    spreadPts,
    startDate,
    endDate,
  };

  symbolCandleDataCache.set(symbol, entry);
  return entry;
}

const mageTriggerCache = new Map<string, TriggerEvent[]>();
function getMageTriggers(
  data: SymbolCandleCache,
  symbol: string,
  session: string,
  cfg: any
): TriggerEvent[] {
  const startH = cfg.orbStartHour ?? 0;
  const startM = cfg.orbStartMin ?? 0;
  const orbMins = cfg.orbMinutes ?? 15;
  const actMins = cfg.actionMinutes ?? 5;
  const key = `${symbol}_${session}_${startH}_${startM}_${orbMins}_${actMins}`;
  if (!mageTriggerCache.has(key)) {
    const triggers = preComputeMageTriggers(
      data.m5Candles,
      data.m1Rows,
      symbol,
      data.spreadPts,
      session,
      data.isForex,
      data.pipSize,
      startH,
      startM,
      orbMins,
      actMins
    );
    mageTriggerCache.set(key, triggers);
  }
  return mageTriggerCache.get(key)!;
}

const sageTriggerCache = new Map<string, TriggerEvent[]>();
function getSageTriggers(
  data: SymbolCandleCache,
  symbol: string,
  session: string,
  cfg: any
): TriggerEvent[] {
  const startH = cfg.orbStartHour ?? 0;
  const startM = cfg.orbStartMin ?? 0;
  const orbMins = cfg.orbMinutes ?? 15;
  const actMins = cfg.actionMinutes ?? 5;
  const sweepPips = cfg.sweepPips ?? 0;
  const maxSweepMultiplier = cfg.maxSweepMultiplier ?? 3;
  const requireCloseInside = !!cfg.requireCloseInside;
  const htfAlignmentRequired = !!cfg.htfAlignmentRequired;
  const maxH1EmaSlope = cfg.maxH1EmaSlope ?? 30;
  const minWbr = cfg.minWbr ?? 1.5;
  const requireCloseLocationHalf = !!cfg.requireCloseLocationHalf;
  const useHtfSarFilter = !!cfg.useHtfSarFilter;

  const key = `${symbol}_${session}_${startH}_${startM}_${orbMins}_${actMins}_${sweepPips}_${maxSweepMultiplier}_${requireCloseInside}_${htfAlignmentRequired}_${maxH1EmaSlope}_${minWbr}_${requireCloseLocationHalf}_${useHtfSarFilter}`;
  if (!sageTriggerCache.has(key)) {
    const triggers = preComputeSageTriggers(
      data.m5Candles,
      data.m1Rows,
      symbol,
      data.spreadPts,
      session,
      data.isForex,
      data.pipSize,
      startH,
      startM,
      orbMins,
      sweepPips,
      actMins,
      maxSweepMultiplier,
      requireCloseInside,
      htfAlignmentRequired,
      maxH1EmaSlope,
      minWbr,
      requireCloseLocationHalf,
      useHtfSarFilter
    );
    sageTriggerCache.set(key, triggers);
  }
  return sageTriggerCache.get(key)!;
}

export function getMinAllowedSl(symbol: string): number {
  const baseSym = symbol.split('.')[0].toUpperCase();
  const config = OPTIMIZER_CONFIG[baseSym];
  const spread = config ? config.spread : 2.0;
  return Math.max(2.0, 2.5 * spread);
}

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

  // Resolve compound exit modes (e.g. ExitADTEL_AGGRESSIVE, ExitOPPOSITE_BOUNDARY)
  let exitModeStr = findStr("Exit") ?? "TRAILING";
  const exitTokenIdx = parts.findIndex(p => p.startsWith("Exit"));
  if (exitTokenIdx >= 0 && exitTokenIdx + 1 < parts.length) {
    const nextToken = parts[exitTokenIdx + 1];
    if (["AGGRESSIVE", "MODERATE", "CONSERVATIVE", "BOUNDARY"].includes(nextToken)) {
      exitModeStr += `_${nextToken}`;
    }
  }

  if (isSage) {
    const sweep = findNum("Sweep") ?? 0;
    const maxSwp = findNum("MaxSwp") ?? 3;
    const reqCls = findStr("ReqCls") === "true";
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
      orbPullbackPct: parsedPct / 100,
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

export function isSessionValidForAsset(symbol: string, setupStr: string): boolean {
  // All asset session alignments unblocked
  return true;
}

export const PAIR_MIN_SL_FLOOR: Record<string, number> = {
  'EURUSD': 5.0, 'GBPUSD': 5.0,
  'USDCHF': 8.0, 'USDCAD': 8.0, 'AUDUSD': 8.0, 'NZDUSD': 8.0,
  'USDJPY': 15.0, 'EURJPY': 15.0, 'GBPJPY': 15.0,
  'AUDJPY': 15.0, 'CADJPY': 15.0, 'CHFJPY': 15.0,
  'EURAUD': 15.0, 'EURNZD': 15.0, 'GBPAUD': 15.0,
  'GBPNZD': 15.0, 'EURCAD': 15.0, 'GBPCAD': 15.0,
  'GER40': 25.0, 'GER40.Daily': 25.0,
  'US30': 25.0, 'US30.Daily': 25.0,
  'NAS100': 15.0, 'NAS100.Daily': 15.0,
  'SPX500': 15.0, 'SPX500.Daily': 15.0,
  'JPN225': 15.0, 'JPN225.Daily': 15.0,
  'XAUUSD': 30.0, 'XTIUSD': 50.0,
  'BTCUSD': 15.0, 'BTCUSD.Daily': 15.0,
  'ETHUSD': 15.0, 'ETHUSD.Daily': 15.0,
};

interface AuditCacheEntry {
  threeYearNetR: number;
  threeYearTrades: number;
  threeYearWinRate: number;
  oneYearWinRate?: number;
  regimeConsistency: number;
  threeYearMaxDrawdown?: number;
  threeYearProfitFactor?: number;
  hasConsecutivePriorYearLoss?: boolean;
  hasLosingMonthInLast6?: boolean;
  dailyReturns?: Record<string, number>;
  monthlyNetR?: Record<string, number>;
}

const CACHE_DIR = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "grandmaster_audit_cache.json");

let memoryCache: Record<string, AuditCacheEntry> | null = null;
let cacheDirty = false;

export function loadAuditCache(): Record<string, AuditCacheEntry> {
  if (memoryCache) return memoryCache;
  if (!fs.existsSync(CACHE_DIR)) {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
  }
  if (fs.existsSync(CACHE_FILE)) {
    try {
      memoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      return memoryCache!;
    } catch {}
  }
  memoryCache = {};
  return memoryCache;
}

export function flushAuditCache(): void {
  if (!cacheDirty || !memoryCache) return;
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(memoryCache, null, 2), "utf-8");
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    fs.renameSync(tmp, CACHE_FILE);
    cacheDirty = false;
  } catch (e) {}
}

export function getEliteComponents(
  validComponents: IndependentSynthesisComponent[],
  botType: string,
  minTrades: number,
): IndependentSynthesisComponent[] {
  let pool = validComponents.filter(
    (c) => {
      // Statistical & 3-Year CSV Audit Gate
      const threeYrR = c.threeYearNetR !== undefined ? c.threeYearNetR : c.totalTotalR;
      const threeYrTrades = c.threeYearTrades !== undefined ? c.threeYearTrades : c.totalTrades;
      const threeYrWR = c.threeYearWinRate !== undefined ? c.threeYearWinRate : (c.winRate || 0);
      const expectancy = threeYrTrades > 0 ? threeYrR / threeYrTrades : 0;
      const calmar = (c.threeYearMaxDrawdown || c.maxDrawdown || 0) > 0 ? threeYrR / (c.threeYearMaxDrawdown || c.maxDrawdown || 1) : threeYrR;

      // Must meet Elite 3-Year Institutional Quality Standards
      if (threeYrR < 18.0 || threeYrTrades < 20 || expectancy < 0.08 || calmar < 0.85) {
        return false;
      }

      // Multi-Regime Half-Year Consistency Gate (Must be profitable in >= 40% of half-year regimes)
      if (c.regimeConsistency !== undefined && c.regimeConsistency < 40.0) {
        return false;
      }

      const effectiveOneYearWR = c.recentSixMonthWinRate !== undefined ? c.recentSixMonthWinRate : threeYrWR;
      if (effectiveOneYearWR < 22.0) {
        return false;
      }

      return (
        c.botType === botType &&
        c.totalTrades >= 3 &&
        c.totalTotalR >= 1.0
      );
    }
  );
  if (pool.length === 0) return [];

  // ── Fix 3: Hard Monte Carlo Drawdown Cap ────────────────────────────────────
  // Configs whose 99% MC tail-risk exceeds 10 R are structurally dangerous
  // regardless of historical performance. They passed the 3-year audit gate
  // but carry unacceptable tail risk in adverse sequential draw scenarios.
  const MAX_MC_DD_ALLOWED = 10.0;
  pool = pool.filter(c => {
    const mcDd = c.monteCarloDrawdown99 ?? 0;
    if (mcDd > MAX_MC_DD_ALLOWED) {
      console.log(`  [QUALITY GATE] ❌ Rejected ${c.symbol} (${c.botType}) — MC DD ${mcDd.toFixed(2)}R exceeds ${MAX_MC_DD_ALLOWED}R cap`);
      return false;
    }
    return true;
  });

  // ── Fix 1: Minimum Hedge Score Threshold ─────────────────────────────────────
  // Reject bottom-decile configs. A hedge score below 0.15 means the config
  // ranked in approximately the lowest 10% of all candidates by composite
  // quality (Sharpe × Recovery × ProfitFactor percentile). These configs
  // may survive hard gates but contribute noise rather than alpha.
  const MIN_HEDGE_SCORE = 0.15;
  pool = pool.filter(c => {
    if (c.hedgeScore < MIN_HEDGE_SCORE) {
      console.log(`  [QUALITY GATE] ❌ Rejected ${c.symbol} (${c.botType}) — HedgeScore ${c.hedgeScore.toFixed(4)} below floor ${MIN_HEDGE_SCORE}`);
      return false;
    }
    return true;
  });

  // Sort candidates by robust composite hedgeScore
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
  const seenSetups = new Set<string>();

  const minAllowedSl = PAIR_MIN_SL_FLOOR[symbol] || PAIR_MIN_SL_FLOOR[symbol.replace('.Daily', '')] || 2.0;

  const processRawState = (state: any, botType: "Mage" | "Sage") => {
    if (!state || !state.setup) return;
    const setupStr = state.setup.trim();
    const setupKey = `${symbol}_${botType}_${setupStr}`;
    if (seenSetups.has(setupKey)) return;
    seenSetups.add(setupKey);

    // A. Asset-session whitelist
    if (!isSessionValidForAsset(symbol, setupStr)) return;

    // B. Min SL Volatility floor
    const minSlMatch = setupStr.match(/MinSL([\d\.]+)/i);
    const minSlVal = minSlMatch ? parseFloat(minSlMatch[1]) : 999;
    if (minSlVal < minAllowedSl) return;

    // C. Basic dump health
    if ((state.totalNetR || state.oosNetR || 0) <= 0) return;

    const evaluated = evaluateComponent(state as any, symbol, botType, globalDates, false);
    if (evaluated) {
      validComponents.push(evaluated);
    } else {
      // Fallback: create shell so the 3-Year CSV Audit can evaluate the true full-history performance
      validComponents.push({
        symbol,
        botType,
        setup: setupStr,
        totalTrades: state.trades || 0,
        totalTotalR: state.totalNetR || state.oosNetR || 0,
        maxDrawdown: state.maxDrawdown || 0,
        sharpeRatio: state.sharpeRatio || 1.0,
        sortinoRatio: state.sortinoRatio || 1.0,
        recoveryFactor: state.recoveryFactor || 1.0,
        hedgeScore: 1.0,
        profitFactor: 1.5,
        deflatedSharpeRatio: 1.0,
        dsrProb: 0.5,
        periodReturns: [],
        dailyReturns: state.dailyNetR || {},
        dailyRArray: new Float64Array(globalDates.length),
        winRate: state.winRate || 30.0,
        recentTwoMonthR: 0,
        recentThreeMonthR: 0,
        recentMomentumR: 0,
        recentOneYearR: 0,
        recentQuarterR: 0,
        curvatureBeta2: 0,
        regimeRatio: 1.0,
        omegaRatio: 1.0,
        cvar95: 0,
        sampleConfidence: 1.0,
        threeYearMaxDrawdown: 0,
        threeYearTrades: 0,
        threeYearProfitFactor: 1.5,
        forceCloseHours: 0,
        recentSixMonthTrades: 0,
        recentSixMonthWinRate: 30.0,
        seasonalMultiplier: 1.0,
        wfMultiplier: 1.0,
        stepMean: 0,
        maxStepLoss: 0,
        hasLosingMonth: false,
        hasLosingWeek: false,
        hasLosingDay: false,
        avgWinR: 1.0
      });
    }
  };

  for (const mState of mageData) processRawState(mState, "Mage");
  for (const sState of sageData) processRawState(sState, "Sage");

  // ── 2. ACTIVE 3-YEAR CSV AUDIT HARD GATE (With Smart Memoization Cache & High-Speed Trigger Math) ──
  if (!skipAudit && validComponents.length > 0) {
    const cache = loadAuditCache();
    const candleData = await getOrLoadSymbolCandleData(symbol);
    const startDate = candleData ? candleData.startDate : "2023-08-03";
    const endDate = candleData ? candleData.endDate : "2026-08-03";

    for (let i = validComponents.length - 1; i >= 0; i--) {
      const p = validComponents[i];
      const cacheKey = `${p.botType}_${p.symbol}_${p.setup}_${startDate}_${endDate}`;
      let auditResult: AuditCacheEntry | null = cache[cacheKey] || null;

      if (!auditResult && candleData) {
        try {
          const cfg = parseSetupToConfig(p.setup, p.symbol, p.botType === "Sage");
          const session = cfg.session || "london";
          const res = p.botType === "Sage"
            ? evaluateSageExits(
                candleData.m1Typed,
                candleData.m5Candles,
                getSageTriggers(candleData, p.symbol, session, cfg),
                p.symbol,
                cfg,
                session,
                candleData.isForex
              )
            : evaluateMageExits(
                candleData.m1Typed,
                candleData.m5Candles,
                getMageTriggers(candleData, p.symbol, session, cfg),
                p.symbol,
                cfg,
                session,
                candleData.isForex
              );
          
          const records: any[] = (res as any).records || (res as any).tradeRecords || (Array.isArray(res) ? res : []);
          const traded = records.filter(r => r.outcome !== 'SKIPPED');
          
          if (traded.length > 0) {
            const wins = traded.filter(r => (r.rMultiple || r.pips || 0) > 0).length;
            const totalNetR = traded.reduce((sum, r) => sum + (r.rMultiple || 0), 0);
            const trades = traded.length;
            const winRate = (wins / trades) * 100;

            // ── 1-Year Win Rate Calculation (Last 365 Days) ──
            const oneYearAgoMs = new Date(endDate).getTime() - 365 * 24 * 60 * 60 * 1000;
            const recentOneYearTrades = traded.filter(r => {
              const d = r.exitTime || r.entryTime || r.date || r.time;
              if (!d) return false;
              const tMs = new Date(d).getTime();
              return tMs >= oneYearAgoMs;
            });
            const recentOneYearWins = recentOneYearTrades.filter(r => (r.rMultiple || r.pips || 0) > 0).length;
            const oneYearWinRate = recentOneYearTrades.length > 0 ? (recentOneYearWins / recentOneYearTrades.length) * 100 : winRate;

            // ── Multi-Regime Half-Year & Monthly Breakdown ──
            const halfYears: Record<string, number> = {};
            const monthlyNetR: Record<string, number> = {};
            const dailyReturns: Record<string, number> = {};
            const sourceDailyR: Record<string, number> = (res as any).dailyNetR || {};
            if (Object.keys(sourceDailyR).length > 0) {
              for (const [dateStr, r] of Object.entries(sourceDailyR)) {
                const dayKey = dateStr;
                const year = dateStr.substring(0, 4);
                const month = parseInt(dateStr.substring(5, 7), 10);
                const mKey = dateStr.substring(0, 7);
                monthlyNetR[mKey] = (monthlyNetR[mKey] || 0) + (r as number);
                dailyReturns[dayKey] = (dailyReturns[dayKey] || 0) + (r as number);

                if (!isNaN(month)) {
                  const half = month <= 6 ? "H1" : "H2";
                  const key = `${year}_${half}`;
                  halfYears[key] = (halfYears[key] || 0) + (r as number);
                }
              }
            } else {
              for (const r of traded) {
                const d = r.exitTime || r.entryTime || r.date || r.time;
                if (!d) continue;
                const dStr = typeof d === "string" ? d : (d.toISOString ? d.toISOString() : String(d));
                const dayKey = dStr.substring(0, 10);
                const year = dStr.substring(0, 4);
                const month = parseInt(dStr.substring(5, 7), 10);
                const mKey = dStr.substring(0, 7);
                monthlyNetR[mKey] = (monthlyNetR[mKey] || 0) + (r.rMultiple || 0);
                dailyReturns[dayKey] = (dailyReturns[dayKey] || 0) + (r.rMultiple || 0);

                if (!isNaN(month)) {
                  const half = month <= 6 ? "H1" : "H2";
                  const key = `${year}_${half}`;
                  halfYears[key] = (halfYears[key] || 0) + (r.rMultiple || 0);
                }
              }
            }
            const halfKeys = Object.keys(halfYears);
            const posHalves = halfKeys.filter(k => halfYears[k] > 0).length;
            const consistency = halfKeys.length > 0 ? (posHalves / halfKeys.length) * 100 : 0;

            // ── Consecutive Prior-Year Monthly Loss Hard Gate ──────────────────
            // Reject any config that had negative R in the same calendar month
            // last year (e.g. August 2025) AND in the next month last year (September 2025).
            const endYear = parseInt(endDate.substring(0, 4), 10);
            const endMonth = parseInt(endDate.substring(5, 7), 10);
            const priorYear = endYear - 1;
            const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
            const nextMonthYear = endMonth === 12 ? endYear : priorYear;

            const priorSameMonthKey = `${priorYear}-${String(endMonth).padStart(2, "0")}`;
            const priorNextMonthKey = `${nextMonthYear}-${String(nextMonth).padStart(2, "0")}`;

            const priorSameR = monthlyNetR[priorSameMonthKey] ?? 0;
            const priorNextR = monthlyNetR[priorNextMonthKey] ?? 0;
            const hasConsecutivePriorYearLoss = (priorSameR < 0 || priorNextR < 0);

            // ── Zero Losing Month Hard Gate in Last 6 Months ──────────────────
            // Reject any config that faced a single loss month in the last 6 months
            const last6MonthKeys: string[] = [];
            let curD = new Date(endDate);
            for (let m = 0; m < 6; m++) {
              const yStr = curD.getUTCFullYear();
              const mStr = String(curD.getUTCMonth() + 1).padStart(2, "0");
              last6MonthKeys.push(`${yStr}-${mStr}`);
              curD.setUTCMonth(curD.getUTCMonth() - 1);
            }
            const hasLosingMonthInLast6 = last6MonthKeys.some(mKey => (monthlyNetR[mKey] !== undefined && monthlyNetR[mKey] < -0.01));

            let peak = 0;
            let running = 0;
            let maxDd = 0;
            let grossProfit = 0;
            let grossLoss = 0;
            for (const r of traded) {
              const val = (r.rMultiple || 0);
              running += val;
              if (running > peak) peak = running;
              const dd = peak - running;
              if (dd > maxDd) maxDd = dd;
              if (val > 0) grossProfit += val;
              else if (val < 0) grossLoss += Math.abs(val);
            }
            const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 5.0 : 1.0);

            auditResult = {
              threeYearNetR: totalNetR,
              threeYearTrades: trades,
              threeYearWinRate: winRate,
              oneYearWinRate: oneYearWinRate,
              regimeConsistency: consistency,
              threeYearMaxDrawdown: maxDd,
              threeYearProfitFactor: pf,
              hasConsecutivePriorYearLoss,
              hasLosingMonthInLast6,
              dailyReturns,
              monthlyNetR,
            };
            cache[cacheKey] = auditResult;
            cacheDirty = true;
          } else {
            auditResult = {
              threeYearNetR: 0,
              threeYearTrades: 0,
              threeYearWinRate: 0,
              oneYearWinRate: 0,
              regimeConsistency: 0,
              threeYearMaxDrawdown: 0,
              threeYearProfitFactor: 1.0,
              hasConsecutivePriorYearLoss: false,
              hasLosingMonthInLast6: false,
            };
            cache[cacheKey] = auditResult;
            cacheDirty = true;
          }
        } catch (e) {
          // Backtest failure
        }
      }

      if (auditResult) {
        p.threeYearNetR = auditResult.threeYearNetR;
        p.threeYearTrades = auditResult.threeYearTrades;
        p.threeYearWinRate = auditResult.threeYearWinRate;
        p.threeYearMaxDrawdown = auditResult.threeYearMaxDrawdown ?? 1.0;
        p.maxDrawdown = p.threeYearMaxDrawdown;
        p.threeYearProfitFactor = auditResult.threeYearProfitFactor ?? 1.5;
        p.profitFactor = p.threeYearProfitFactor;
        p.recoveryFactor = p.maxDrawdown > 0 ? p.threeYearNetR / p.maxDrawdown : p.threeYearNetR * 2.0;
        p.recentSixMonthWinRate = auditResult.oneYearWinRate ?? auditResult.threeYearWinRate;
        p.winRate = auditResult.threeYearWinRate;
        p.regimeConsistency = auditResult.regimeConsistency;
        p.hasConsecutivePriorYearLoss = auditResult.hasConsecutivePriorYearLoss;
        p.hasLosingMonthInLast6 = auditResult.hasLosingMonthInLast6;
        if (auditResult.dailyReturns) {
          p.dailyReturns = auditResult.dailyReturns;
        }

        const monthlyR = auditResult.monthlyNetR || {};
        let r2025 = 0;
        let r2026 = 0;
        for (const [mKey, val] of Object.entries(monthlyR)) {
          if (mKey.startsWith("2025")) r2025 += val;
          if (mKey.startsWith("2026")) r2026 += val;
        }
        const expectancy = p.threeYearTrades > 0 ? p.threeYearNetR / p.threeYearTrades : 0;
        const calmar = p.threeYearMaxDrawdown > 0 ? p.threeYearNetR / p.threeYearMaxDrawdown : p.threeYearNetR;
        const effectiveOneYearWR = auditResult.oneYearWinRate ?? auditResult.threeYearWinRate;

        if (
          p.threeYearNetR < 18.0 ||
          p.threeYearTrades < 20 ||
          expectancy < 0.08 ||
          calmar < 0.85 ||
          r2025 < -0.5 ||
          r2026 < -0.5 ||
          effectiveOneYearWR < 22.0 ||
          (p.regimeConsistency !== undefined && p.regimeConsistency < 40.0) ||
          auditResult.hasConsecutivePriorYearLoss ||
          auditResult.hasLosingMonthInLast6
        ) {
          validComponents.splice(i, 1);
          continue;
        }
      } else {
        validComponents.splice(i, 1);
        continue;
      }
    }
  }

  flushAuditCache();

  if (validComponents.length > 0) {
    const allSharpes = validComponents.map((p) => p.sharpeRatio).sort((a, b) => a - b);
    const allRecoveries = validComponents.map((p) => p.recoveryFactor).sort((a, b) => a - b);
    const allPFs = validComponents.map((p) => (p.threeYearProfitFactor || 1)).sort((a, b) => a - b);
    const allOmegas = validComponents.map((p) => (p.omegaRatio || 1)).sort((a, b) => a - b);
    const allDsrs = validComponents.map((p) => (p.dsrProb || 0.5)).sort((a, b) => a - b);

    for (const p of validComponents) {
      // Minimum activity gate: configs with fewer trades than required get score = 0
      // so they sort to the bottom and are excluded by getEliteComponents.
      if ((p.totalTrades || 0) < minTrades) {
        p.hedgeScore = 0;
        continue;
      }

      const sharpeRank = rankPercentile(p.sharpeRatio, allSharpes);
      const recoveryRank = rankPercentile(p.recoveryFactor, allRecoveries);
      const pfRank = rankPercentile(p.threeYearProfitFactor || 1, allPFs);

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

      // ── Convex Ballooning Curvature & Acceleration Objective Function ───────
      // Forces the synthesizer to select setups whose equity curves are accelerating
      // upward (beta2 > 0) with strong recent summer (Q4) growth.
      const beta2 = p.curvatureBeta2 ?? 0;
      const recentQ = p.recentQuarterR ?? 0;
      const threeYrBase = (p.threeYearNetR !== undefined && p.threeYearNetR > 0)
        ? p.threeYearNetR
        : Math.max(p.totalTotalR, 0.01);

      // Curvature exponent: reward positive acceleration (beta2 > 0) and penalize deceleration (beta2 < 0)
      const curvatureRatio = beta2 / (Math.abs(threeYrBase) + 2.0);
      const curvatureMultiplier = Math.exp(Math.max(-1.5, Math.min(2.0, 1.2 * curvatureRatio)));

      // Recent quarter acceleration factor:
      const q4Share = Math.max(0, recentQ) / (Math.abs(threeYrBase) + 1.0);
      const q4Boost = Math.min(3.0, 1.0 + 2.5 * q4Share);

      const balloonMultiplier = curvatureMultiplier * q4Boost;

      p.hedgeScore = sharpeRank * recoveryRank * pfRank * spreadBoost * balloonMultiplier;
    }
  }

  validComponents.sort((a, b) => b.hedgeScore - a.hedgeScore);

  const mages = getEliteComponents(validComponents, "Mage", minTrades);
  const sages = getEliteComponents(validComponents, "Sage", minTrades);
  const normalList = [...mages, ...sages];

  // Release memory for this symbol's cached M1/M5 tick arrays and precomputed triggers
  mageTriggerCache.clear();
  sageTriggerCache.clear();
  symbolCandleDataCache.delete(symbol);

  return { normalList, rawValidCount: validComponents.length };
}

