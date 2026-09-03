import dbModule from "../core/db.js";
import { getFixedEstDate } from "../trading/engine/LiveOrchestrator.js";
import { getProfileTradeHistory } from "../trading/broker/metaApiHandler.js";
import { logger } from "./logger.js";

const db: any = new Proxy({}, {
  get(_target, prop) {
    const activeDb = (global as any).__SIM_DB__ || dbModule;
    return activeDb[prop];
  }
});

export interface BrokerMetrics {
  profileId: number;
  balance: number;
  equity: number;
  currency: string;
  dailyStartBalance: number;
  dailyPnlDollars: number;
  dailyPnlPct: number;
  peakBalance: number;
  drawdownPct: number;
  circuitBreakerActive: boolean;
  circuitBreakerReason: string;
  institutionalEnabled: boolean;
  institutionalDailyCap: number;
  institutionalPeakToDraw: number;
  timestamp: number;
}

export function calculateBrokerTradingDayStr(date: Date = new Date()): string {
  const estDate = getFixedEstDate(date);
  const tradingDayDate = new Date(estDate.getTime() + 7 * 60 * 60 * 1000);
  return tradingDayDate.toISOString().split("T")[0];
}

const metricsCache = new Map<number, BrokerMetrics>();
const tradeHistoryCache = new Map<number, { timestamp: number; totalClosedPnl: number; tradesCount: number }>();

export async function processAndCacheBrokerMetrics(
  profileId: number,
  accInfo: { balance: number; equity: number; currency?: string }
): Promise<BrokerMetrics> {
  const pid = Number(profileId);
  const liveBalance = Number(accInfo.balance) || 0;
  const liveEquity = Number(accInfo.equity) || liveBalance;
  const currency = accInfo.currency || "USD";

  const profile = await db.prepare(
    `SELECT institutional_enabled, institutional_daily_cap, institutional_peak_to_draw,
            institutional_daily_start_balance, institutional_daily_date, institutional_peak_balance
     FROM trading_profiles WHERE id = ?`
  ).get(pid);

  const isInstEnabled = profile?.institutional_enabled === 1;
  const dailyCap = Number(profile?.institutional_daily_cap) || 2.5;
  const peakToDraw = Number(profile?.institutional_peak_to_draw) || 5.5;

  const todayTradingDayStr = calculateBrokerTradingDayStr(new Date());

  // 1. Calculate today's closed deals PnL from MT5 broker history
  let totalClosedPnlToday = 0;
  const nowMs = Date.now();
  const cachedHistory = tradeHistoryCache.get(pid);
  
  if (cachedHistory && nowMs - cachedHistory.timestamp < 10000) {
    totalClosedPnlToday = cachedHistory.totalClosedPnl;
  } else {
    try {
      const liveHistory = await getProfileTradeHistory(pid, 2);
      if (liveHistory && Array.isArray(liveHistory)) {
        const todayTrades = liveHistory.filter((t: any) => {
          if (!t.close_time) return false;
          const closeDate = new Date(t.close_time);
          const estClose = getFixedEstDate(closeDate);
          const closeTradingDay = new Date(estClose.getTime() + 7 * 60 * 60 * 1000).toISOString().split("T")[0];
          return closeTradingDay === todayTradingDayStr;
        });
        totalClosedPnlToday = todayTrades.reduce((sum: number, t: any) => sum + (t.profit || 0), 0);
        tradeHistoryCache.set(pid, {
          timestamp: nowMs,
          totalClosedPnl: totalClosedPnlToday,
          tradesCount: todayTrades.length
        });
      }
    } catch (e: any) {
      if (cachedHistory) totalClosedPnlToday = cachedHistory.totalClosedPnl;
    }
  }

  // 2. Exact start-of-day equity: Current Balance minus all deals closed today
  const dailyStartBal = liveBalance - totalClosedPnlToday;

  // 3. Unrealized floating PnL on active open positions
  const floatingPnl = liveEquity - liveBalance;

  // 4. Exact Total Live Daily PnL ($ and %)
  const dailyPnlDollars = totalClosedPnlToday + floatingPnl;
  const dailyPnlPct = dailyStartBal > 0 ? (dailyPnlDollars / dailyStartBal) * 100 : 0;

  // 5. Peak Balance and Drawdown Calculation
  let peakBal = Number(profile?.institutional_peak_balance) || dailyStartBal;
  if (liveEquity > peakBal) {
    peakBal = liveEquity;
    try {
      await db.prepare(
        `UPDATE trading_profiles SET institutional_peak_balance = ?, institutional_daily_start_balance = ?, institutional_daily_date = ? WHERE id = ?`
      ).run(peakBal, dailyStartBal, todayTradingDayStr, pid);
    } catch (e: any) {
      logger.error(`[BrokerMetricsEngine] Failed to update peak balance for profile ${pid}: ${e.message}`);
    }
  } else if (profile?.institutional_daily_date !== todayTradingDayStr || profile?.institutional_daily_start_balance !== dailyStartBal) {
    try {
      await db.prepare(
        `UPDATE trading_profiles SET institutional_daily_start_balance = ?, institutional_daily_date = ? WHERE id = ?`
      ).run(dailyStartBal, todayTradingDayStr, pid);
    } catch (e: any) {}
  }

  // Calculate peak-to-equity drawdown (%)
  const drawdownPct = peakBal > 0 ? ((peakBal - liveEquity) / peakBal) * 100 : 0;

  // Evaluate Circuit Breakers
  const isDailyCapBreached = isInstEnabled && dailyPnlPct <= -dailyCap;
  const isPeakDrawBreached = isInstEnabled && drawdownPct >= peakToDraw;

  const circuitBreakerActive = isDailyCapBreached || isPeakDrawBreached;
  let circuitBreakerReason = "";
  if (isDailyCapBreached) {
    circuitBreakerReason = `Daily Loss Limit (-${dailyCap.toFixed(1)}%) Breached (Current: ${dailyPnlPct.toFixed(2)}%)`;
  } else if (isPeakDrawBreached) {
    circuitBreakerReason = `Max Drawdown (-${peakToDraw.toFixed(1)}%) Breached (Current: ${drawdownPct.toFixed(2)}%)`;
  }

  const metrics: BrokerMetrics = {
    profileId: pid,
    balance: liveBalance,
    equity: liveEquity,
    currency,
    dailyStartBalance: Number(dailyStartBal.toFixed(2)),
    dailyPnlDollars: Number(dailyPnlDollars.toFixed(2)),
    dailyPnlPct: Number(dailyPnlPct.toFixed(2)),
    peakBalance: Number(peakBal.toFixed(2)),
    drawdownPct: Number(drawdownPct.toFixed(2)),
    circuitBreakerActive,
    circuitBreakerReason,
    institutionalEnabled: isInstEnabled,
    institutionalDailyCap: dailyCap,
    institutionalPeakToDraw: peakToDraw,
    timestamp: Date.now()
  };

  metricsCache.set(pid, metrics);
  return metrics;
}

export function getCachedBrokerMetrics(profileId: number): BrokerMetrics | null {
  return metricsCache.get(Number(profileId)) || null;
}
