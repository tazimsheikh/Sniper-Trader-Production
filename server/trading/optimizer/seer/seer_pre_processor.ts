import { GrandmasterOptimizerState, M1TypedArrays, TriggerEvent } from "../../config/types.js";
import { IndependentSynthesisComponent, evaluateComponent } from "../grandmaster/GrandmasterMetrics.js";
import { rankPercentile } from "../grandmaster/utils/GrandmasterMath.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { PairConfig, PairConfigManager } from "../../config/PairConfig.js";
import { runSeerMathBacktest, clearSeerBacktestCache } from "../../backtester/SeerMathBacktester.js";
import { buildEmaArray } from "../../market/Indicators.js";
import { aggregateCandles } from "../../market/CandleAggregator.js";
import { loadCsv, getLatestDate } from "../../backtester/loadCsv.js";
import { isNewsForceClose } from "../../market/historicalNews.js";
import { isEODSession } from "../../market/MathFilters.js";
import paramsToConfig from "../grandmaster/utils/seer_params_parser.js";
import * as fs from "fs";
import * as path from "path";

interface SymbolCandleCache {
  m1Rows: any[];
  m1Typed: M1TypedArrays;
  m5Candles: any[];
  emaArr?: Float64Array;
  isForex: boolean;
  pipSize: number;
  spreadPts: number;
  startDate: string;
  endDate: string;
}

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
  const isForex = PairConfigManager.isForex(symbol);

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

    const h = r.estHour;
    const m = r.minute;
    m1Typed.estHour[i] = h;
    m1Typed.minute[i] = m;

    m1Typed.isEOD_standard[i] = isEODSession(h, m) ? 1 : 0;
    if (i > 0) {
      const prevH = m1Rows[i - 1].estHour;
      m1Typed.isSessionReset[i] = ((prevH < 17 && h >= 17) || (prevH > h && h >= 17) || (h === 17 && m === 0)) ? 1 : 0;
      m1Typed.isMidnightExpiry[i] = (prevH > h && h < 17) ? 1 : 0;
    }

    const dateStr = new Date(r.timestamp).toISOString().split("T")[0];
    m1Typed.isNewsForceClose[i] = isNewsForceClose(dateStr, h, m) ? 1 : 0;
  }

  const m5Candles = aggregateCandles(m1Rows, 5);
  const emaArr = buildEmaArray(m5Candles, 20);

  const cacheEntry: SymbolCandleCache = {
    m1Rows,
    m1Typed,
    m5Candles,
    emaArr,
    isForex,
    pipSize,
    spreadPts,
    startDate,
    endDate,
  };

  symbolCandleDataCache.set(symbol, cacheEntry);
  return cacheEntry;
}

export function deduplicateConfigs(
  validComponents: IndependentSynthesisComponent[],
  botType: string,
  minTrades: number,
): IndependentSynthesisComponent[] {
  let pool = validComponents.filter((c) => {
    const threeYrR = c.threeYearNetR !== undefined ? c.threeYearNetR : c.totalTotalR;
    const threeYrTrades = c.threeYearTrades !== undefined ? c.threeYearTrades : c.totalTrades;
    const threeYrWR = c.threeYearWinRate !== undefined ? c.threeYearWinRate : (c.winRate || 0);
    const dd = c.threeYearMaxDrawdown || c.monteCarloDrawdown99 || c.maxDrawdown || 1;
    const marRatio = dd > 0 ? threeYrR / dd : threeYrR;
    const expectancy = threeYrTrades > 0 ? threeYrR / threeYrTrades : 0;
    const calmar = (c.threeYearMaxDrawdown || c.maxDrawdown || 0) > 0 ? threeYrR / (c.threeYearMaxDrawdown || c.maxDrawdown || 1) : threeYrR;

    if (threeYrR < 1.0 || threeYrTrades < 3 || expectancy < 0.01) {
      return false;
    }

    if (c.threeYearProfitFactor && c.threeYearProfitFactor < 1.15) {
      return false;
    }

    if (c.regimeConsistency !== undefined && c.regimeConsistency < 20.0) {
      return false;
    }

    const effectiveOneYearWR = c.recentSixMonthWinRate !== undefined ? c.recentSixMonthWinRate : threeYrWR;
    if (effectiveOneYearWR < 15.0) {
      return false;
    }

    return (
      c.botType === botType &&
      c.totalTrades >= 3 &&
      c.totalTotalR >= 1.0
    );
  });

  if (pool.length === 0) return [];

  const MAX_MC_DD_ALLOWED = 32.0;
  pool = pool.filter((c) => {
    const mcDd = c.monteCarloDrawdown99 ?? 0;
    if (mcDd > MAX_MC_DD_ALLOWED) {
      return false;
    }
    return true;
  });

  const MIN_HEDGE_SCORE = 0.05;
  pool = pool.filter((c) => {
    if (c.hedgeScore < MIN_HEDGE_SCORE) {
      return false;
    }
    return true;
  });

  const sortedAll = [...pool].sort((a, b) =>
    (b.hedgeScore - a.hedgeScore) ||
    (a.symbol || "").localeCompare(b.symbol || "") ||
    (a.setup || "").localeCompare(b.setup || "")
  );

  // Return all passing Seer candidates without consensus clamping to maximize Seer pool
  return sortedAll;
}

export async function preProcessData(
  symbol: string,
  seerData: GrandmasterOptimizerState[],
  globalDates: string[],
  minTrades: number,
  skipAudit: boolean = false
): Promise<{ normalList: IndependentSynthesisComponent[]; rawValidCount: number }> {
  for (const state of seerData) {
    if (!state) continue;
    state.dailyRArray = new Float64Array(globalDates.length);
    for (let i = 0; i < globalDates.length; i++) {
      state.dailyRArray[i] = (state.dailyNetR && state.dailyNetR[globalDates[i]]) || 0;
    }
  }

  let validComponents: IndependentSynthesisComponent[] = [];
  const seenSetups = new Set<string>();

  const processRawState = (state: any, botType: "Seer") => {
    if (!state || !state.setup) return;
    const setupStr = state.setup.trim();
    const setupKey = `${symbol}_${botType}_${setupStr}`;
    if (seenSetups.has(setupKey)) return;
    seenSetups.add(setupKey);

    const oosVal = state.oosNetR !== undefined ? state.oosNetR : state.totalNetR;
    if ((oosVal || 0) <= 0) return;
    if (state.totalNetR !== undefined && state.totalNetR <= 0) return;

    const evaluated = evaluateComponent(state as any, symbol, botType, globalDates, false);
    if (evaluated) {
      validComponents.push(evaluated);
    } else {
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
      });
    }
  };

  for (const s of seerData) processRawState(s, "Seer");

  const rawValidCount = validComponents.length;

  // Pre-filter: take top 20 candidates sorted by totalTotalR to ensure deep candidate coverage
  validComponents.sort((a, b) => b.totalTotalR - a.totalTotalR);
  const candidatesToAudit = validComponents.slice(0, 20);

  if (skipAudit || candidatesToAudit.length === 0) {
    const normalList = deduplicateConfigs(validComponents, "Seer", minTrades);
    return { normalList, rawValidCount };
  }

  const auditedComponents: IndependentSynthesisComponent[] = [];

  for (const comp of candidatesToAudit) {
    try {
      const config = paramsToConfig(comp.setup, symbol);
      const res = await runSeerMathBacktest(symbol, undefined, undefined, true, {}, [config], false);
      if (!res || res.trades < 3 || res.totalNetR <= 0) continue;

      const records = res.records || [];
      const traded = records.filter((r: any) => r.outcome !== 'SKIPPED' && r.outcome !== 'NO_TRADE');
      if (traded.length < 3) continue;

      const dailyNetR: Record<string, number> = {};
      let peak = 0, runningR = 0, maxDD = 0;
      const yearlyNetR: Record<string, number> = {};
      const halfYearNetR: Record<string, number> = {};

      for (const r of traded) {
        const val = r.rMultiple || 0;
        const d = (r as any).date || ((r as any).timestamp ? new Date((r as any).timestamp).toISOString().split('T')[0] : null);
        if (d) {
          dailyNetR[d] = (dailyNetR[d] || 0) + val;
          const y = d.substring(0, 4);
          yearlyNetR[y] = (yearlyNetR[y] || 0) + val;
          const m = parseInt(d.substring(5, 7), 10);
          const halfKey = `${y}-H${m <= 6 ? 1 : 2}`;
          halfYearNetR[halfKey] = (halfYearNetR[halfKey] || 0) + val;
        }
        runningR += val;
        if (runningR > peak) peak = runningR;
        const dd = peak - runningR;
        if (dd > maxDD) maxDD = dd;
      }

      if (res.totalNetR <= 0 || traded.length < 3) continue;

      const totalHalfYears = Object.keys(halfYearNetR).length;
      const profitableHalfYears = Object.values(halfYearNetR).filter(v => v > 0).length;
      const regimeConsistency = totalHalfYears > 0 ? (profitableHalfYears / totalHalfYears) * 100 : 0;

      const grossProfit = Object.values(dailyNetR).filter(r => r > 0).reduce((a, b) => a + b, 0);
      const grossLoss = Math.abs(Object.values(dailyNetR).filter(r => r < 0).reduce((a, b) => a + b, 0));
      const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 999 : 1.0) : grossProfit / grossLoss;

      const auditedDailyR = new Float64Array(globalDates.length);
      for (let i = 0; i < globalDates.length; i++) {
        auditedDailyR[i] = dailyNetR[globalDates[i]] || 0;
      }

      comp.threeYearNetR = res.totalNetR;
      comp.threeYearTrades = traded.length;
      comp.threeYearWinRate = res.winRate;
      comp.threeYearProfitFactor = profitFactor;
      comp.threeYearMaxDrawdown = maxDD;
      comp.totalTotalR = res.totalNetR;
      comp.totalTrades = traded.length;
      comp.winRate = res.winRate;
      comp.profitFactor = profitFactor;
      comp.maxDrawdown = maxDD;
      comp.dailyReturns = dailyNetR;
      comp.dailyRArray = auditedDailyR;
      comp.regimeConsistency = regimeConsistency;

      const calmar = maxDD > 0 ? res.totalNetR / maxDD : res.totalNetR;
      const sortino = comp.sortinoRatio || 1.0;
      comp.hedgeScore = (calmar * 0.4) + (profitFactor * 0.3) + ((regimeConsistency / 100) * 0.3);

      auditedComponents.push(comp);
    } catch (e: any) {
      console.error(`  [SeerAudit Error] ${symbol}:`, e.message);
    }
  }

  clearSeerBacktestCache(symbol);

  // Return only audited components that pass criteria (or validComponents if skipAudit explicitly requested)
  const normalList = deduplicateConfigs(skipAudit ? validComponents : auditedComponents, "Seer", minTrades);
  return { normalList, rawValidCount };
}
