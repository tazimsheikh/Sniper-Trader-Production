// ─────────────────────────────────────────────────────────────────────────────
// TRADE UTILITIES
//
// Generic trade lifecycle helpers used by tradeManager, auth, and settings.
// Extracted from the legacy botManager.ts during the TheWitch rebrand purge.
// ─────────────────────────────────────────────────────────────────────────────

import db from "../core/db.js";

// ── Close Trade ───────────────────────────────────────────────────────────────
export async function closeTrade(
  metaOrderId: string,
  status: string,
): Promise<void> {
  await db
    .prepare(`UPDATE bot_trade_states SET status = ? WHERE meta_order_id = ?`)
    .run(status, metaOrderId);
}

// ── Log Trade to Diary ────────────────────────────────────────────────────────
export async function logToDiary(
  userId: number,
  profileId: number,
  botId: string,
  symbol: string,
  direction: string,
  entryPrice: number,
  exitPrice: number,
  lots: number,
  pips: number,
  profit: number,
  status: string,
  openTimeInput: any,
): Promise<void> {
  const numericOpenTime =
    typeof openTimeInput === "number" && !isNaN(openTimeInput)
      ? Math.floor(openTimeInput)
      : new Date(openTimeInput || Date.now()).getTime();

  const existing = await db
    .prepare(
      "SELECT id FROM trade_diary WHERE profile_id = ? AND bot_id = ? AND broker_symbol = ? AND open_time = ?",
    )
    .get(profileId, botId, symbol, numericOpenTime);

  if (existing) {
    console.log(
      `[TradeUtils] Trade diary entry already exists for ${botId} on ${symbol}. Skipping duplicate log.`,
    );
    return;
  }

  const closeTime = Date.now();
  await db
    .prepare(
      `
    INSERT INTO trade_diary
      (user_id, profile_id, bot_id, broker_symbol, direction,
       entry_price, exit_price, lots, pips, profit, status, open_time, close_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      userId,
      profileId,
      botId,
      symbol,
      direction,
      entryPrice,
      exitPrice,
      lots,
      pips,
      profit,
      status,
      numericOpenTime,
      closeTime,
    );
}

// ── Safety Status Map (circuit breaker state per profileId) ───────────────────
export interface SafetyStatus {
  circuitBreakerActive: boolean;
  circuitBreakerReason: string;
  drawdownPct: number;
  dailyProfitPct: number;
  blockedPairs: Record<string, boolean>;
}

export const safetyStatusMap = new Map<number, SafetyStatus>();

// ── Profile Bot Instance cleanup ──────────────────────────────────────────────
export function deleteProfileBotInstances(profileId: number): void {
  (async () => {
    try {
      const { LiveOrchestrator } =
        await import("../trading/index.js");
      const discOrch = LiveOrchestrator.getInstance(profileId);
      if (discOrch) {
        await discOrch.destroy();
      }
    } catch (e) {}
  })();
}

// ── Legacy active-bots helpers (stub — returns empty, no-op write) ────────────
export async function getProfileActiveBots(
  _profileId: number,
): Promise<string[]> {
  return [];
}

export async function setProfileActiveBots(
  _profileId: number,
  _bots: string[],
): Promise<void> {
  // no-op
}

// ── Legacy registries (empty — no legacy bots) ────────────────────────────────
export const BOT_REGISTRY: Record<string, any> = {};
export const ALL_BOT_CONFIGS: any[] = [];

// ── Market Structure Algorithms ───────────────────────────────────────────────
export interface SwingPoint {
  index: number;
  type: "HIGH" | "LOW";
  price: number;
  timestamp: string;
}

/**
 * Bill Williams 5-Bar Fractal Algorithm
 * A Swing Low is strictly lower than 2 candles left and right.
 * A Swing High is strictly higher than 2 candles left and right.
 */
export function detectSwingPoints(candles: any[]): SwingPoint[] {
  const swings: SwingPoint[] = [];
  if (!candles || candles.length < 5) return swings;

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];

    // Check Swing High
    if (
      c.high > candles[i - 1].high &&
      c.high > candles[i - 2].high &&
      c.high > candles[i + 1].high &&
      c.high > candles[i + 2].high
    ) {
      swings.push({
        index: i,
        type: "HIGH",
        price: c.high,
        timestamp: c.timestamp || c.time,
      });
    }

    // Check Swing Low
    if (
      c.low < candles[i - 1].low &&
      c.low < candles[i - 2].low &&
      c.low < candles[i + 1].low &&
      c.low < candles[i + 2].low
    ) {
      swings.push({
        index: i,
        type: "LOW",
        price: c.low,
        timestamp: c.timestamp || c.time,
      });
    }
  }
  return swings;
}
