import { GrandmasterOptimizerState } from "../../config/types.js";
import { IndependentSynthesisComponent, evaluateComponent } from "./GrandmasterMetrics.js";
import { rankPercentile } from "./utils/GrandmasterMath.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { runMathBacktest as runMageMathBacktest, clearMageBacktestCache } from "../../backtester/MageMathBacktester.js";
import { runSageMathBacktest, clearSageBacktestCache } from "../../backtester/SageMathBacktester.js";
import * as fs from "fs";
import * as path from "path";
import { getLatestDate } from "../../backtester/loadCsv.js";

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
  const sym = symbol.toUpperCase();
  const setupLower = setupStr.toLowerCase();
  
  // Energy (Crude Oil) requires NY session liquidity; ban London 2 AM dead zone
  if (sym.includes("XTI")) {
    if (!setupLower.startsWith("ny")) return false;
  }
  // European indices (GER40) require European/London session
  if (sym.includes("GER40") || sym.includes("DE40")) {
    if (!setupLower.startsWith("london")) return false;
  }
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
  regimeConsistency: number;
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

      // Must be profitable over the 3-year macroeconomic cycle
      if (threeYrR <= 0 || threeYrTrades < 20 || threeYrWR < 22.0) {
        return false;
      }

      // Multi-Regime Half-Year Consistency Gate (Must be profitable in >= 50% of half-year regimes)
      if (c.regimeConsistency !== undefined && c.regimeConsistency < 50.0) {
        return false;
      }

      return (
        c.botType === botType &&
        c.totalTrades >= 3 && // Absolute floor for OOS slice
        c.totalTotalR >= 1.0 &&
        ((c.sharpeRatio || 0) >= 0.3 || c.totalTotalR >= 5.0) &&
        (c.recentSixMonthTrades || 0) >= 1 &&         // MUST have traded in last 6 months
        ((c.recentMomentumR || 0) >= 3.0 || (c.recentTwoMonthR || 0) >= 2.0)  // MUST be profitable recently
      );
    }
  );
  if (pool.length === 0) return [];

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

  for (const mState of mageData) {
    if (!mState) continue;
    const result = evaluateComponent(mState as any, symbol, "Mage", globalDates, false);
    if (result) validComponents.push(result);
  }
  for (const sState of sageData) {
    if (!sState) continue;
    const result = evaluateComponent(sState as any, symbol, "Sage", globalDates, false);
    if (result) validComponents.push(result);
  }

  // ── 1. ZERO-COST PRE-FILTER GATE (Eliminate doomed setups in 0.0001ms before running backtest) ──
  const minAllowedSl = PAIR_MIN_SL_FLOOR[symbol] || PAIR_MIN_SL_FLOOR[symbol.replace('.Daily', '')] || 2.0;
  
  validComponents = validComponents.filter((p) => {
    // A. Asset-session whitelist
    if (!isSessionValidForAsset(p.symbol, p.setup)) return false;
    
    // B. Min SL Volatility floor
    const minSlMatch = p.setup.match(/MinSL([\d\.]+)/i);
    const minSlVal = minSlMatch ? parseFloat(minSlMatch[1]) : 999;
    if (minSlVal < minAllowedSl) return false;

    // C. Basic dump health (must have positive Net R and at least 3 trades in dump)
    if (p.totalTotalR <= 0 || p.totalTrades < 3) return false;

    return true;
  });

  // ── 2. ACTIVE 3-YEAR CSV AUDIT HARD GATE (With Smart Memoization Cache) ──
  if (!skipAudit && validComponents.length > 0) {
    const cache = loadAuditCache();
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
      const cacheKey = `${p.botType}_${p.symbol}_${p.setup}_${startDate}_${endDate}`;
      let auditResult: AuditCacheEntry | null = cache[cacheKey] || null;

      if (!auditResult) {
        try {
          const cfg = parseSetupToConfig(p.setup, p.symbol, p.botType === "Sage");
          const res = p.botType === "Sage"
            ? await runSageMathBacktest(p.symbol, startDate, endDate, false, {}, [cfg])
            : await runMageMathBacktest(p.symbol, startDate, endDate, false, undefined, undefined, null, [cfg]);
          
          const records: any[] = res.records || (Array.isArray(res) ? res : []);
          const traded = records.filter(r => r.outcome !== 'SKIPPED');
          
          if (traded.length > 0) {
            const wins = traded.filter(r => (r.rMultiple || r.pips || 0) > 0).length;
            const totalNetR = traded.reduce((sum, r) => sum + (r.rMultiple || 0), 0);
            const trades = traded.length;
            const winRate = (wins / trades) * 100;

            // ── Multi-Regime Half-Year Calculation ──
            const halfYears: Record<string, number> = {};
            for (const r of traded) {
              const d = r.exitTime || r.entryTime || r.date || r.time;
              if (!d) continue;
              const dStr = typeof d === "string" ? d : (d.toISOString ? d.toISOString() : String(d));
              const year = dStr.substring(0, 4);
              const month = parseInt(dStr.substring(5, 7), 10);
              if (!isNaN(month)) {
                const half = month <= 6 ? "H1" : "H2";
                const key = `${year}_${half}`;
                halfYears[key] = (halfYears[key] || 0) + (r.rMultiple || 0);
              }
            }
            const halfKeys = Object.keys(halfYears);
            const posHalves = halfKeys.filter(k => halfYears[k] > 0).length;
            const consistency = halfKeys.length > 0 ? (posHalves / halfKeys.length) * 100 : 0;

            auditResult = {
              threeYearNetR: totalNetR,
              threeYearTrades: trades,
              threeYearWinRate: winRate,
              regimeConsistency: consistency,
            };
            cache[cacheKey] = auditResult;
            cacheDirty = true;
          } else {
            auditResult = {
              threeYearNetR: 0,
              threeYearTrades: 0,
              threeYearWinRate: 0,
              regimeConsistency: 0,
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
        p.winRate = auditResult.threeYearWinRate;
        p.regimeConsistency = auditResult.regimeConsistency;

        // ── Active 3-Year Rejection Gate ──
        if (
          p.threeYearNetR <= 0 ||
          p.threeYearTrades < 20 ||
          p.threeYearWinRate < 22.0 ||
          (p.regimeConsistency !== undefined && p.regimeConsistency < 50.0)
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

      p.hedgeScore = sharpeRank * recoveryRank * pfRank * spreadBoost;
    }
  }

  validComponents.sort((a, b) => b.hedgeScore - a.hedgeScore);

  const mages = getEliteComponents(validComponents, "Mage", minTrades);
  const sages = getEliteComponents(validComponents, "Sage", minTrades);
  const normalList = [...mages, ...sages];

  // Release memory for this symbol's cached M1/M5 tick arrays
  clearMageBacktestCache(symbol);
  clearSageBacktestCache(symbol);

  return { normalList, rawValidCount: validComponents.length };
}

