// ============================================================
// GLOBAL TRADE GATE
// ============================================================
import { logger } from "./logger.js";
// Single source of truth for cross-system trade rules.
// Both TheWitch and DiscretionaryTrader check here before
// placing any trade, ensuring these rules hold system-wide:
//
//   1. Max 10 concurrent open trades total (across all bots)
//   2. Max 2 trades from the same correlated-pair group
//   3. Discretionary Trader has priority over Algo Trader:
//      if Disc has an open OR evaluating trade on a pair,
//      Algo is blocked from that pair entirely.
//
// Usage:
//   import { globalTradeGate } from '../utils/GlobalTradeGate.js';
//   const check = globalTradeGate.canTrade(profileId, pair, direction, 'ALGO');
//   if (!check.approved) { log(check.reason); return; }
//   globalTradeGate.register(profileId, tradeId, pair, direction, 'ALGO');
//   // on close:
//   globalTradeGate.release(profileId, tradeId);
// ============================================================

export const MAX_CONCURRENT_TRADES = 10;

import { TraderType, ActiveEntry } from "../trading/config/types.js";

class GlobalTradeGate {
  // profileId → Map<tradeId, ActiveEntry>
  private activeTrades = new Map<number, Map<string, ActiveEntry>>();
  // profileId → Set of pairs currently being evaluated by DISC (AI in-flight)
  private discEvaluating = new Map<number, Set<string>>();
  // profileId → Promise<void> for mutex locking
  private locks = new Map<number, Promise<void>>();

  private getProfileMap(profileId: number): Map<string, ActiveEntry> {
    if (!this.activeTrades.has(profileId)) {
      this.activeTrades.set(profileId, new Map());
    }
    return this.activeTrades.get(profileId)!;
  }

  private getEvalSet(profileId: number): Set<string> {
    if (!this.discEvaluating.has(profileId)) {
      this.discEvaluating.set(profileId, new Set());
    }
    return this.discEvaluating.get(profileId)!;
  }

  /** Called by DiscretionaryTrader when it starts evaluating a pair (AI call in-flight) */
  markDiscEvaluating(profileId: number, pair: string) {
    this.getEvalSet(profileId).add(pair);
  }

  /** Called by DiscretionaryTrader when evaluation completes (trade placed OR rejected) */
  clearDiscEvaluating(profileId: number, pair: string) {
    this.getEvalSet(profileId).delete(pair);
  }

  /**
   * Check whether a new trade is permitted under the global rules.
   * @param profileId  The profile (account) making the request.
   * @param pair       E.g. 'GBPUSD'
   * @param direction  'BUY' | 'SELL'
   * @param traderType 'ALGO' | 'DISC'
   */
  canTrade(
    profileId: number,
    pair: string,
    direction: "BUY" | "SELL",
    traderType: TraderType,
  ): { approved: boolean; reason?: string } {
    const trades = this.getProfileMap(profileId);
    const evalSet = this.getEvalSet(profileId);

    // 🚫 Rule 1: Global concurrent cap 🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫🚫
    const totalAllocated = trades.size + evalSet.size;
    if (totalAllocated >= MAX_CONCURRENT_TRADES) {
      return {
        approved: false,
        reason: `Global cap: max ${MAX_CONCURRENT_TRADES} concurrent trades/evaluations reached (${trades.size} open, ${evalSet.size} evaluating)`,
      };
    }

    // 🚫 Rule 5: Strict Anti-Hedging (Prop Firm Compliance) 🚫🚫🚫🚫🚫🚫🚫🚫
    for (const [id, t] of trades.entries()) {
      if (t.pair === pair && t.direction !== direction) {
        return {
          approved: false,
          reason: `Anti-Hedging Block: Cannot open ${direction} on ${pair} because trade ${id} is currently ${t.direction}`,
        };
      }
    }

    // 🚫 Rule 6: Currency Exposure Cap (DESIGN-7: Max 3 positions per currency) 🚫
    const MAX_CURRENCY_EXPOSURE = 3;
    const knownCurrencies = ["EUR", "GBP", "USD", "JPY", "AUD", "CAD", "NZD", "CHF"];
    const targetPairClean = pair.replace(".Daily", "").toUpperCase();
    
    for (const curr of knownCurrencies) {
      if (targetPairClean.includes(curr)) {
        let currCount = 0;
        for (const [_, t] of trades.entries()) {
          const activePairClean = t.pair.replace(".Daily", "").toUpperCase();
          if (activePairClean.includes(curr)) {
            currCount++;
          }
        }
        if (currCount >= MAX_CURRENCY_EXPOSURE) {
          return {
            approved: false,
            reason: `Currency Exposure Cap: ${curr} exposure limit (${MAX_CURRENCY_EXPOSURE} active trades) reached`,
          };
        }
      }
    }

    return { approved: true };
  }

  /**
   * Async wrapper to atomically check canTrade, await a broker action, and register the trade.
   * Uses an in-memory mutex per profile to prevent race conditions during concurrent ALGO evaluations.
   */
  async canTradeAndRegister(
    profileId: number,
    tradeId: string,
    pair: string,
    direction: "BUY" | "SELL",
    traderType: TraderType,
    placeOrderFn: () => Promise<void>,
  ): Promise<{ approved: boolean; reason?: string }> {
    // Wait for any in-progress lock for this profile
    while (this.locks.has(profileId)) {
      await this.locks.get(profileId);
    }

    let resolveLock!: () => void;
    this.locks.set(
      profileId,
      new Promise((r) => {
        resolveLock = r;
      }),
    );

    try {
      const check = this.canTrade(profileId, pair, direction, traderType);
      if (!check.approved) {
        return check;
      }

      // Execute the broker order while holding the lock
      await placeOrderFn();

      // If successful, register
      this.register(profileId, tradeId, pair, direction, traderType);
      return { approved: true };
    } finally {
      this.locks.delete(profileId);
      resolveLock();
    }
  }

  /**
   * Register a successfully placed trade with the gate.
   */
  register(
    profileId: number,
    tradeId: string,
    pair: string,
    direction: "BUY" | "SELL",
    traderType: TraderType,
  ) {
    this.getProfileMap(profileId).set(tradeId, { pair, direction, traderType });
    logger.info(
      `[GlobalTradeGate] ✅ Registered ${traderType} trade ${tradeId} on ${pair} ${direction} | Total open: ${this.getProfileMap(profileId).size}`,
    );
  }

  /**
   * Release a trade from the gate when it closes.
   */
  release(profileId: number, tradeId: string) {
    const trades = this.getProfileMap(profileId);
    const entry = trades.get(tradeId);
    if (entry) {
      trades.delete(tradeId);
      logger.info(
        `[GlobalTradeGate] 🔓 Released ${entry.traderType} trade ${tradeId} on ${entry.pair} | Total open: ${trades.size}`,
      );
    }
  }

  /**
   * Hydrate state on startup from the database's OPEN trades.
   * Call this once after DB is loaded.
   */
  hydrate(
    profileId: number,
    openTrades: Array<{
      tradeId: string;
      pair: string;
      direction: "BUY" | "SELL";
      traderType: TraderType;
    }>,
  ) {
    const trades = this.getProfileMap(profileId);
    trades.clear();
    for (const t of openTrades) {
      trades.set(t.tradeId, {
        pair: t.pair,
        direction: t.direction,
        traderType: t.traderType,
      });
    }
    logger.info(
      `[GlobalTradeGate] 💧 Hydrated profile ${profileId} with ${trades.size} open trade(s)`,
    );
  }

  clearProfile(profileId: number) {
    this.activeTrades.delete(profileId);
    this.discEvaluating.delete(profileId);
    logger.info(`[GlobalTradeGate] Purged state for profile ${profileId}`);
  }

  getStatus(profileId: number) {
    const trades = this.getProfileMap(profileId);
    return {
      totalOpen: trades.size,
      maxConcurrent: MAX_CONCURRENT_TRADES,
      maxCorrelated: -1,
      trades: [...trades.entries()].map(([id, t]) => ({ id, ...t })),
    };
  }
}

// Singleton — shared across the entire Node.js process
export const globalTradeGate = new GlobalTradeGate();
