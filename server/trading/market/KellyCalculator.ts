import dbModule from "../../core/db.js";
import { logger } from "../../utils/logger.js";

const db = (global as any).__SIM_DB__ || dbModule;

/**
 * Calculates the Half-Kelly multiplier based on the last 30 closed trades for a given bot/symbol.
 * Half-Kelly formula: f* = (p * b - q) / b / 2
 * Where:
 *   p = rolling win rate
 *   b = avg win R / avg loss R
 *   q = 1 - p
 *
 * Multiplier is clamped between 0.25x (downside protection) and 1.5x (upside bound).
 */
export async function getDynamicKellyMultiplier(
  profileId: number | string,
  botId: string,
  symbol: string
): Promise<number> {
  try {
    const rows = await db
      .prepare(
        `SELECT profit, pips FROM trade_diary 
         WHERE profile_id = ? AND bot_id = ? AND broker_symbol = ? 
         ORDER BY close_time DESC LIMIT 30`
      )
      .all(profileId, botId, symbol);

    if (!rows || rows.length < 15) {
      // Not enough sample size to calculate Kelly reliably; return neutral multiplier 1.0
      return 1.0;
    }

    let winsCount = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;
    let lossesCount = 0;

    for (const r of rows) {
      if (r.profit > 0) {
        winsCount++;
        totalWinPnl += r.profit;
      } else if (r.profit < 0) {
        lossesCount++;
        totalLossPnl += Math.abs(r.profit);
      }
    }

    const p = winsCount / rows.length;
    const q = 1 - p;

    if (winsCount === 0 || lossesCount === 0) {
      return 1.0;
    }

    const avgWin = totalWinPnl / winsCount;
    const avgLoss = totalLossPnl / lossesCount;
    const b = avgWin / (avgLoss || 1);

    const kellyFull = (p * b - q) / b;
    const halfKelly = kellyFull / 2.0;

    // Base neutral multiplier is 1.0; clamp Kelly factor between 0.25 and 1.5
    const finalMultiplier = Math.max(0.25, Math.min(1.5, halfKelly));
    return Number(finalMultiplier.toFixed(2));
  } catch (err: any) {
    logger.warn(`[KellyCalculator] Error computing Kelly for ${botId}/${symbol}: ${err.message}`);
    return 1.0;
  }
}
