import { GrandmasterOptimizerState, IndependentSynthesisComponent } from "../../config/types.js";
import { evaluateComponent } from "./GrandmasterMetrics.js";
import { rankPercentile } from "./utils/GrandmasterMath.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { validateAnomalyConcentration } from "../core/MonthlyConsistencyValidator.js";
import * as fs from "fs";
import * as path from "path";

export function getRollingMonthKeys(endDateStr: string, count: number): string[] {
  const keys: string[] = [];
  const endD = new Date(endDateStr.length === 7 ? `${endDateStr}-01` : endDateStr);
  let y = endD.getUTCFullYear();
  let m = endD.getUTCMonth();
  for (let i = 0; i < count; i++) {
    const mKey = `${y}-${String(m + 1).padStart(2, "0")}`;
    keys.unshift(mKey);
    m--;
    if (m < 0) {
      m = 11;
      y--;
    }
  }
  return keys;
}

export const PAIR_MIN_SL_FLOOR: Record<string, number> = {
  'EURUSD': 5.0, 'GBPUSD': 5.0,
  'USDCHF': 8.0, 'USDCAD': 8.0, 'AUDUSD': 8.0, 'NZDUSD': 8.0,
  'USDJPY': 15.0, 'EURJPY': 15.0, 'GBPJPY': 15.0,
  'AUDJPY': 30.0, 'CADJPY': 15.0, 'CHFJPY': 15.0,
  'EURAUD': 15.0, 'GBPAUD': 15.0, 'EURCAD': 15.0, 'GBPCAD': 15.0,
  'GER40': 25.0, 'GER40.Daily': 25.0,
  'US30': 25.0, 'US30.Daily': 25.0,
  'NAS100': 15.0, 'NAS100.Daily': 15.0,
  'XAUUSD': 30.0,
};

export function isSessionValidForAsset(symbol: string, setupStr: string): boolean {
  return true;
}

export interface AuditCacheEntry {
  threeYearNetR: number;
  threeYearTrades: number;
  threeYearWinRate: number;
  oneYearWinRate?: number;
  regimeConsistency: number;
  threeYearMaxDrawdown?: number;
  oneYearMaxDrawdown?: number;
  threeYearProfitFactor?: number;
  hasConsecutivePriorYearLoss?: boolean;
  dailyReturns?: Record<string, number>;
  monthlyNetR?: Record<string, number>;
  avgWinR?: number;
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

export function extractSetupSignature(setup: string, botType: string): string {
  const lower = setup.toLowerCase();
  let session = "other";
  if (lower.startsWith("london") || lower.includes("session=london")) session = "london";
  else if (lower.startsWith("asia") || lower.includes("session=asia")) session = "asia";
  else if (lower.startsWith("ny") || lower.startsWith("new_york") || lower.includes("session=ny")) session = "ny";

  let exitMode = "trailing";
  if (lower.includes("exitmidpoint") || lower.includes("exit=midpoint")) exitMode = "midpoint";
  else if (lower.includes("exitopposite_boundary") || lower.includes("exit=opposite_boundary")) exitMode = "boundary";
  else if (lower.includes("exittrailing") || lower.includes("exit=trailing")) exitMode = "trailing";
  else if (lower.includes("exitadtel_moderate") || lower.includes("exit=adtel_moderate")) exitMode = "adtel_moderate";
  else if (lower.includes("exitadtel_conservative") || lower.includes("exit=adtel_conservative")) exitMode = "adtel_conservative";
  else if (lower.includes("exitadtel_aggressive") || lower.includes("exit=adtel_aggressive")) exitMode = "adtel_aggressive";
  else if (lower.includes("exitadtel") || lower.includes("exit=adtel")) exitMode = "adtel_moderate";
  else if (lower.includes("exitfixed_r") || lower.includes("exit=fixed_r")) exitMode = "fixed_r";

  return `${session}_${exitMode}`;
}

export const BANNED_GRANDMASTER_PAIRS = new Set<string>();

/**
 * Next-Gen PreProcessor: Dual-Track Sieve + Fast O(1) Cache Lookup
 */
export async function preProcessData(
  symbol: string,
  mageData: GrandmasterOptimizerState[],
  sageData: GrandmasterOptimizerState[],
  seerDataOrDates: GrandmasterOptimizerState[] | string[],
  datesParam?: string[] | number,
  minTradesParam: number = 3
): Promise<{ normalList: IndependentSynthesisComponent[]; rawValidCount: number }> {
  let seerData: GrandmasterOptimizerState[] = [];
  let globalDates: string[] = [];
  let minTrades = minTradesParam;

  if (Array.isArray(seerDataOrDates) && typeof seerDataOrDates[0] === "string") {
    // Legacy call: (symbol, mageData, sageData, globalDates, minTrades)
    globalDates = seerDataOrDates as string[];
    if (typeof datesParam === "number") minTrades = datesParam;
  } else {
    // Tri-Bot call: (symbol, mageData, sageData, seerData, globalDates, minTrades)
    seerData = (seerDataOrDates as GrandmasterOptimizerState[]) || [];
    globalDates = (datesParam as string[]) || [];
  }

  const cleanSym = symbol.replace(/\.daily$/i, "").toUpperCase();
  const upperSym = symbol.toUpperCase();

  if (BANNED_GRANDMASTER_PAIRS.has(cleanSym)) {
    return { normalList: [], rawValidCount: 0 };
  }

  const cache = loadAuditCache();

  // 1. Build lightning-fast O(1) cache map for this symbol
  const setupCache = new Map<string, any>();
  for (const [k, v] of Object.entries(cache)) {
    const kUpper = k.toUpperCase();
    if (kUpper.includes(`_${cleanSym}_`) || kUpper.includes(`_${upperSym}_`)) {
      const matchSym = kUpper.includes(`_${upperSym}_`) ? upperSym : cleanSym;
      const parts = k.split(new RegExp(`_${matchSym}_`, 'i'));
      if (parts.length === 2) {
        const bot = parts[0];
        const rest = parts[1];
        const last = rest.lastIndexOf('_');
        const secondLast = rest.lastIndexOf('_', last - 1);
        const setup = secondLast > 0 ? rest.substring(0, secondLast) : rest;
        setupCache.set(`${bot}_${setup}`, v);
      }
    }
  }

  const survivingPool: IndependentSynthesisComponent[] = [];
  const seenSetups = new Set<string>();

  const minAllowedSl = Math.max(2.0, (PAIR_MIN_SL_FLOOR[cleanSym] || PAIR_MIN_SL_FLOOR[symbol] || 2.0) * 0.7);

  const processCandidate = (state: any, botType: "Mage" | "Sage" | "Seer") => {
    if (!state || !state.setup) return;
    const setupStr = state.setup.trim();
    const setupKey = `${cleanSym}_${botType}_${setupStr}`;
    if (seenSetups.has(setupKey)) return;
    seenSetups.add(setupKey);

    // Filter invalid exit modes
    if (botType === "Mage") {
      const validMageExit = ["ExitTRAILING", "ExitADTEL_MODERATE", "ExitADTEL_CONSERVATIVE", "ExitADTEL_AGGRESSIVE"].some(em => setupStr.includes(em));
      if (!validMageExit) return;
    } else if (botType === "Sage") {
      if (setupStr.includes("ExitADTEL")) return;
      const validSageExit = ["ExitTRAILING", "ExitMIDPOINT", "ExitOPPOSITE_BOUNDARY"].some(em => setupStr.includes(em));
      if (!validSageExit) return;
    } else if (botType === "Seer") {
      const validSeerExit = ["ExitTRAILING", "ExitFIXED_R"].some(em => setupStr.includes(em));
      if (!validSeerExit) return;
    }

    // Min SL filter
    const minSlMatch = setupStr.match(/MinSL([\d\.]+)/i);
    const minSlVal = minSlMatch ? parseFloat(minSlMatch[1]) : 999;
    if (minSlVal < minAllowedSl) return;

    // Strict Out-of-sample positive check
    const oosVal = state.oosNetR !== undefined ? state.oosNetR : state.totalNetR;
    if ((oosVal || 0) <= 0) return;

    // Check O(1) audit cache with seamless state.dailyNetR fallback
    let cachedEntry = setupCache.get(`${botType}_${setupStr}`);
    if (!cachedEntry && state.dailyNetR && Object.keys(state.dailyNetR).length > 0) {
      const dailyReturns: Record<string, number> = state.dailyNetR;
      const dailyValues = Object.values(dailyReturns);
      const trades = state.threeYearTrades ?? state.trades ?? dailyValues.length;
      const r = state.threeYearNetR ?? state.totalNetR ?? dailyValues.reduce((sum, v) => sum + v, 0);
      const maxDd = Math.max(1.0, state.threeYearMaxDrawdown ?? state.isMaxDd ?? state.maxDd ?? 1.0);
      const winDays = dailyValues.filter(v => v > 0);
      const lossDays = dailyValues.filter(v => v < 0);
      const winRate = state.threeYearWinRate ?? (trades > 0 ? (winDays.length / dailyValues.length) * 100 : 35.0);
      const grossProfit = winDays.reduce((sum, v) => sum + v, 0);
      const grossLoss = Math.abs(lossDays.reduce((sum, v) => sum + v, 0));
      const pf = state.threeYearProfitFactor ?? (grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 3.0 : 1.0));
      const avgWin = winDays.length > 0 ? grossProfit / winDays.length : 1.0;

      cachedEntry = {
        threeYearNetR: r,
        threeYearTrades: trades,
        threeYearWinRate: winRate,
        threeYearMaxDrawdown: maxDd,
        threeYearProfitFactor: pf,
        regimeConsistency: 60.0,
        dailyReturns,
        avgWinR: avgWin,
      };
    }
    if (!cachedEntry) return;

    const r = cachedEntry.threeYearNetR;
    const trades = cachedEntry.threeYearTrades || 0;
    const maxDd = Math.max(1.0, cachedEntry.threeYearMaxDrawdown || 1.0);
    const calmar = maxDd > 0 ? r / maxDd : r;
    const exp = trades > 0 ? r / trades : 0;
    const pf = cachedEntry.threeYearProfitFactor || 1.0;
    const winRate = cachedEntry.threeYearWinRate || 30.0;
    const avgWin = cachedEntry.avgWinR ?? (trades > 0 && winRate > 0 ? (r / (trades * (winRate / 100))) : 1.0);

    // Hard baseline filter: positive return, minimum trades, reasonable loss
    if (r < 2.0 || trades < 5 || exp < 0.02 || maxDd > 20.0 || pf < 1.05) {
      return;
    }

    // Anti-anomaly filter
    if (cachedEntry.dailyReturns && Object.keys(cachedEntry.dailyReturns).length > 0) {
      const anomalyRes = validateAnomalyConcentration(cachedEntry.dailyReturns, 35.0, 70.0, 25.0);
      if (!anomalyRes.isValid) return;
    }

    // ── 1-Year Authoritative Recency & Positivity Quality Gate ──────────
    let oneYearNetR = 0;
    let oneYearTrades = 0;
    let oneYearMaxDd = 0;
    let oneYearPeakR = 0;

    const candidateDaily = cachedEntry.dailyReturns || state.dailyNetR || {};
    const dailyKeys = Object.keys(candidateDaily);

    if (dailyKeys.length > 0) {
      const lastDateStr = globalDates.length > 0 ? globalDates[globalDates.length - 1] : dailyKeys.sort()[dailyKeys.length - 1];
      const cutoffDate = new Date(new Date(lastDateStr).getTime() - 365.25 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      let runningR = 0;
      for (const [d, dayR] of Object.entries(candidateDaily)) {
        if (d >= cutoffDate) {
          const val = dayR as number;
          oneYearNetR += val;
          runningR += val;
          if (runningR > oneYearPeakR) oneYearPeakR = runningR;
          const dd = oneYearPeakR - runningR;
          if (dd > oneYearMaxDd) oneYearMaxDd = dd;

          if (val !== 0) {
            oneYearTrades++;
          }
        }
      }

      // Hard 1-Year Positivity Gate:
      // Reject any decaying setup that fails the 1-year performance floor:
      // Mage/Sage: Net R < 3.0 R, Trades < 4, Max DD > 12.0 R.
      // Seer: Net R < 1.5 R, Trades < 2, Max DD > 12.0 R.
      const minRequired1YrR = botType === "Seer" ? 1.5 : 3.0;
      const minRequired1YrTrades = botType === "Seer" ? 2 : 4;
      if (oneYearNetR < minRequired1YrR || oneYearTrades < minRequired1YrTrades || oneYearMaxDd > 12.0) {
        return;
      }
    }

    // Dual-track classification
    const maxDdCeiling = (botType === "Mage") ? 18.0 : 14.0;
    const isTrackA = (
      r >= 7.0 &&
      calmar >= 1.20 &&
      maxDd <= maxDdCeiling &&
      exp >= 0.035
    );

    const isTrackB = (
      r >= 2.0 &&
      maxDd <= 18.0 &&
      exp >= 0.02
    );

    if (!isTrackA && !isTrackB) return;

    // Create hydrated component
    const dailyReturns = cachedEntry.dailyReturns || state.dailyNetR || {};
    const dailyRArray = new Float64Array(globalDates.length);
    for (let i = 0; i < globalDates.length; i++) {
      dailyRArray[i] = dailyReturns[globalDates[i]] || 0;
    }

    const comp: IndependentSynthesisComponent = {
      symbol,
      botType,
      setup: setupStr,
      totalTrades: trades,
      threeYearTrades: trades,
      totalTotalR: r,
      threeYearNetR: r,
      maxDrawdown: maxDd,
      threeYearMaxDrawdown: maxDd,
      sharpeRatio: state.sharpeRatio || (calmar * 0.8),
      sortinoRatio: state.sortinoRatio || (calmar * 1.0),
      recoveryFactor: calmar,
      hedgeScore: 1.0,
      profitFactor: pf,
      threeYearProfitFactor: pf,
      deflatedSharpeRatio: 1.0,
      dsrProb: 0.5,
      periodReturns: Object.values(dailyReturns),
      dailyReturns,
      dailyRArray,
      winRate,
      threeYearWinRate: winRate,
      recentTwoMonthR: 0,
      recentThreeMonthR: 0,
      recentMomentumR: 0,
      recentOneYearR: oneYearNetR,
      recentQuarterR: 0,
      curvatureBeta2: 0,
      regimeRatio: 1.0,
      omegaRatio: 1.0,
      cvar95: 0,
      sampleConfidence: 1.0,
      forceCloseHours: 0,
      recentSixMonthTrades: 0,
      recentSixMonthWinRate: winRate,
      seasonalMultiplier: 1.0,
      wfMultiplier: 1.0,
      stepMean: 0,
      maxStepLoss: 0,
      hasLosingMonth: false,
      hasLosingWeek: false,
      hasLosingDay: false,
      avgWinR: avgWin
    };

    (comp as any).track = isTrackA ? "TRACK_A" : "TRACK_B";
    survivingPool.push(comp);
  };

  for (const mState of mageData) processCandidate(mState, "Mage");
  for (const sState of sageData) processCandidate(sState, "Sage");
  for (const eState of seerData) processCandidate(eState, "Seer");

  // Composite Hedge Score calculation
  if (survivingPool.length > 0) {
    const allSharpes = survivingPool.map(p => p.sharpeRatio).sort((a, b) => a - b);
    const allRecoveries = survivingPool.map(p => p.recoveryFactor).sort((a, b) => a - b);
    const allPFs = survivingPool.map(p => (p.threeYearProfitFactor || 1)).sort((a, b) => a - b);

    for (const p of survivingPool) {
      const sharpeRank = rankPercentile(p.sharpeRatio, allSharpes);
      const recoveryRank = rankPercentile(p.recoveryFactor, allRecoveries);
      const pfRank = rankPercentile(p.threeYearProfitFactor || 1, allPFs);

      const config = OPTIMIZER_CONFIG[cleanSym];
      const spread = config ? config.spread : 2.0;

      let spreadBoost = 1.0;
      if (spread <= 1.3) spreadBoost = 1.40;
      else if (spread <= 1.7) spreadBoost = 1.25;
      else if (spread <= 2.0) spreadBoost = 1.10;

      const trackBoost = (p as any).track === "TRACK_A" ? 1.35 : 1.0;
      p.hedgeScore = Math.max(0.01, sharpeRank * recoveryRank * pfRank * spreadBoost * trackBoost);
    }
  }

  // Diverse Archetype Selection: allow up to 6 archetypes per symbol per bot
  const getBotArchetypes = (bot: "Mage" | "Sage" | "Seer"): IndependentSynthesisComponent[] => {
    const botPool = survivingPool.filter(c => c.botType === bot);
    botPool.sort((a, b) => (b.hedgeScore - a.hedgeScore) || a.setup.localeCompare(b.setup));

    const groups = new Map<string, IndependentSynthesisComponent[]>();
    for (const comp of botPool) {
      const sig = extractSetupSignature(comp.setup, bot);
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(comp);
    }

    const champions: IndependentSynthesisComponent[] = [];
    for (const [_, cands] of groups.entries()) {
      champions.push(cands[0]);
    }
    champions.sort((a, b) => b.hedgeScore - a.hedgeScore);
    return champions.slice(0, 6); // Up to 6 distinct session archetypes!
  };

  const mageChampions = getBotArchetypes("Mage");
  const sageChampions = getBotArchetypes("Sage");
  const seerChampions = getBotArchetypes("Seer");
  const normalList = [...mageChampions, ...sageChampions, ...seerChampions];

  return { normalList, rawValidCount: survivingPool.length };
}

export const preProcessDataNextGen = preProcessData;
