// ============================================================
// GLOBAL TRADE GATE
// ============================================================
import { logger } from "./logger.js";
// Single source of truth for cross-system trade rules.
// Both TheWitch and DiscretionaryTrader check here before
// placing any trade, ensuring these rules hold system-wide:
//
//   1. Max 50 concurrent open trades total (across all bots)
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

export const MAX_CONCURRENT_TRADES = 50;

import { TraderType, ActiveEntry, TradeDirection, SessionLeadTrade } from "../trading/config/types.js";
import { PairConfigManager } from "../trading/config/PairConfig.js";

class GlobalTradeGate {
  // profileId → Map<tradeId, ActiveEntry>
  private activeTrades = new Map<number, Map<string, ActiveEntry>>();
  // profileId → Set of pairs currently being evaluated by DISC (AI in-flight)
  private discEvaluating = new Map<number, Set<string>>();
  // profileId → Promise<void> for mutex locking
  private locks = new Map<number, Promise<void>>();
  // Canonical Session Direction Locks & Lead Trades: Key -> SessionLeadTrade
  private sessionDirectionLocks = new Map<string, SessionLeadTrade>();

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
    if ((global as any).isSimulator || process.env.SIMULATION_MODE === "true") {
      return { approved: true };
    }

    const active = this.getProfileMap(profileId);

    // Rule 1: Max Concurrent
    if (active.size >= MAX_CONCURRENT_TRADES) {
      return {
        approved: false,
        reason: `Global limit reached: ${MAX_CONCURRENT_TRADES} trades open.`,
      };
    }

    // Rule 2: Discretionary priority
    if (traderType === "ALGO") {
      const evaluating = this.getEvalSet(profileId);
      if (evaluating.has(pair)) {
        return {
          approved: false,
          reason: `Disc Trader is evaluating ${pair}. ALGO blocked.`,
        };
      }

      // Check for ALREADY active trades on this exact pair
      // This prevents 11 identical configurations from launching 11 concurrent duplicated trades
      for (const [id, entry] of active.entries()) {
        if (entry.pair === pair) {
          return {
            approved: false,
            reason: `Duplicate Engine Execution: Pair ${pair} already has an active trade (ID: ${id}, Bot: ${entry.traderType}). Concurrent overlapping executions are strictly blocked.`,
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
    let resolveLock!: () => void;
    const newLock = new Promise<void>((r) => {
      resolveLock = r;
    });

    const previousLock = this.locks.get(profileId) || Promise.resolve();
    this.locks.set(profileId, previousLock.then(() => newLock).catch(() => newLock));

    await previousLock;

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
      if (this.locks.get(profileId) === newLock) {
        this.locks.delete(profileId);
      }
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

  /**
   * Enforces that all accounts take the same canonical breakout direction per session.
   * If a strategy triggers a BUY breakout for GER40 in London session on 2026-08-17,
   * any subsequent SELL breakout attempt in that same session will be blocked across all accounts.
   */
  checkSessionDirection(
    botId: string,
    pair: string,
    session: string,
    dateStr: string,
    direction: TradeDirection,
  ): { approved: boolean; reason?: string } {
    const cleanPair = PairConfigManager.getBaseSymbol(pair).toUpperCase();
    const sessionKey = `${botId.toUpperCase()}_${cleanPair}_${session || 'default'}_${dateStr}`;
    const existing = this.sessionDirectionLocks.get(sessionKey);
    if (existing) {
      if (existing.direction !== direction) {
        return {
          approved: false,
          reason: `Session Direction Consensus: ${botId.toUpperCase()} on ${cleanPair} already established ${existing.direction} for session ${session || 'default'} on ${dateStr}. Opposite ${direction} blocked to prevent cross-account whipsaw divergence.`,
        };
      }
    }
    return { approved: true };
  }

  private onLeadTradeListeners: Array<(leadTrade: SessionLeadTrade) => void> = [];

  /**
   * Registers a callback listener for reactive in-memory lead trade broadcasts.
   */
  onLeadTrade(listener: (leadTrade: SessionLeadTrade) => void) {
    this.onLeadTradeListeners.push(listener);
  }

  /**
   * Locks the canonical session direction and registers the lead trade for cross-account catch-up.
   */
  registerSessionDirection(leadTrade: SessionLeadTrade) {
    const cleanPair = PairConfigManager.getBaseSymbol(leadTrade.symbol).toUpperCase();
    const cleanBot = leadTrade.botId.toUpperCase();
    const sessionKey = `${cleanBot}_${cleanPair}_${leadTrade.session || 'default'}_${leadTrade.dateStr}`;
    if (!this.sessionDirectionLocks.has(sessionKey)) {
      this.sessionDirectionLocks.set(sessionKey, leadTrade);
      // Also store pair-level fallback key
      this.sessionDirectionLocks.set(`${cleanBot}_${cleanPair}`, leadTrade);
      logger.info(
        `[GlobalTradeGate] 🔒 Locked canonical session direction: ${cleanBot} ${cleanPair} ${leadTrade.direction} for ${leadTrade.session || 'default'} on ${leadTrade.dateStr} (Lead Profile: #${leadTrade.leadProfileId})`,
      );

      // ⚡ Sub-Millisecond Reactive Broadcast to all peer orchestrators
      for (const listener of this.onLeadTradeListeners) {
        try {
          listener(leadTrade);
        } catch (e: any) {
          logger.error(`[GlobalTradeGate] Error in lead trade listener: ${e.message}`);
        }
      }
    }
  }

  /**
   * Retrieves the active lead trade for cross-account reconciliation and catch-up.
   */
  getActiveLeadTrade(
    botId: string,
    pair: string,
    session?: string,
    dateStr?: string,
  ): SessionLeadTrade | undefined {
    const cleanPair = PairConfigManager.getBaseSymbol(pair).toUpperCase();
    const cleanBot = botId.toUpperCase();
    
    // 1. Exact session key match
    if (session && dateStr) {
      const sessionKey = `${cleanBot}_${cleanPair}_${session}_${dateStr}`;
      const direct = this.sessionDirectionLocks.get(sessionKey);
      if (direct) return direct;
    }

    // 2. Pair-level active trade fallback (covers cross-day holds & restarts, session-gated)
    const pairFallback = this.sessionDirectionLocks.get(`${cleanBot}_${cleanPair}`);
    if (pairFallback && (!session || pairFallback.session === session)) return pairFallback;

    // 3. Scan all active locks starting with bot and pair (session-gated)
    for (const [key, lock] of this.sessionDirectionLocks.entries()) {
      if (key.startsWith(`${cleanBot}_${cleanPair}`) && (!session || lock.session === session)) {
        return lock;
      }
    }

    return undefined;
  }

  /**
   * Updates an existing lead trade to mark it as filled, synchronizing price across peers.
   */
  markLeadTradeFilled(
    botId: string,
    pair: string,
    session?: string,
    dateStr?: string,
    fillPrice?: number,
  ) {
    const cleanPair = PairConfigManager.getBaseSymbol(pair).toUpperCase();
    const cleanBot = botId.toUpperCase();
    const trade = this.getActiveLeadTrade(cleanBot, cleanPair, session, dateStr);
    if (trade) {
      trade.isFilled = true;
      if (fillPrice && fillPrice > 0) {
        trade.entryPrice = fillPrice;
      }
      logger.info(
        `[GlobalTradeGate] 🟢 Marked lead trade as FILLED for ${cleanBot} ${cleanPair} at ${fillPrice || trade.entryPrice}`,
      );
    }
  }

  /**
   * Periodic cleanup of session direction locks older than 24 hours.
   */
  clearOldSessionLocks(olderThanHours = 24) {
    const now = Date.now();
    const cutoffMs = olderThanHours * 60 * 60 * 1000;
    for (const [key, lock] of this.sessionDirectionLocks.entries()) {
      if (now - lock.timestamp > cutoffMs) {
        this.sessionDirectionLocks.delete(key);
      }
    }
  }
}

// Singleton — shared across the entire Node.js process
export const globalTradeGate = new GlobalTradeGate();
