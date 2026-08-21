import db, { incrementSessionLoss, addBotLog } from "../core/db.js";
import {
  getSharedConnection,
  getSymbolSpec,
  clearSharedConnection,
} from "../trading/broker/metaApiHandler.js";
import { shouldForceCloseForNews } from "../news/newsStore.js";
import { decrypt, isEncrypted } from "../core/crypto.js";
import { closeTrade, logToDiary } from "./tradeUtils.js";
import { globalTradeGate } from "../utils/GlobalTradeGate.js";
import { PairConfigManager } from "../trading/config/PairConfig.js";

// A map to track internal state of positions we're managing
// positionId -> { entryTime, brokeEven }
const positionState = new Map<
  any,
  Map<string, { entryTime: number; brokeEven: boolean; session: string }>
>();
const profileLocks = new Set<number>();

export function deleteProfileTradeState(profileId: number) {
  positionState.delete(profileId);
  profileLocks.delete(profileId);
  lastPollTimes.delete(profileId);
  emptyProfileState.delete(profileId);
  globalTradeGate.clearProfile(profileId);
}

const lastPollTimes = new Map<number, number>();
const emptyProfileState = new Map<number, boolean>();
const ghostTradeTracker = new Map<string, number>();

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let attempt = 0;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "numeric",
    minute: "numeric",
  });
  const [h, m] = formatter.format(new Date()).split(":").map(Number);

  // Extend retry window to 30 retries (~15 mins) during rollover window (16:55 to 17:05)
  const isRolloverWindow = (h === 16 && m >= 55) || (h === 17 && m <= 5);
  const effectiveMaxRetries = isRolloverWindow ? 30 : maxRetries;

  while (attempt < effectiveMaxRetries) {
    try {
      return await operation();
    } catch (e: any) {
      attempt++;
      const isStopsError =
        e.message.includes("Invalid Stops") ||
        e.message.includes("Invalid stops") ||
        e.message.includes("INVALID_STOPS");
      if (attempt >= effectiveMaxRetries || isStopsError) {
        throw e;
      }
      // Cap individual backoff step at 30 seconds (30000ms)
      const backoff = Math.min(30000, Math.pow(2, attempt) * 500);
      console.warn(
        `[TradeManager] Operation failed (${e.message}), retrying (attempt ${attempt}/${effectiveMaxRetries}) in ${backoff}ms...`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error("Unreachable");
}

export async function monitorOpenTrades(currentSession: string) {
  const activeProfiles = (await db
    .prepare(
      `SELECT tp.id, u.metaapi_token, tp.metaapi_account_id,
              EXISTS (SELECT 1 FROM bot_trade_states WHERE profile_id = tp.id AND status = 'OPEN') as has_bot_trade
     FROM trading_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE (tp.automation_active = 1 
        OR tp.ai_sniper_active = 1 
        OR EXISTS (SELECT 1 FROM bot_trade_states WHERE profile_id = tp.id AND status = 'OPEN'))
       AND u.metaapi_token IS NOT NULL 
       AND tp.metaapi_account_id IS NOT NULL
       AND u.metaapi_token != 'dummy_token'
       AND tp.metaapi_account_id != 'dummy_acc'`,
    )
    .all()) as any[];

  if (activeProfiles.length === 0) return;

  const now = Date.now();

  // Process profiles in chunks of 10 to prevent DB connection pool exhaustion (max: 50)
  // and MetaAPI rate limit bursts.
  const chunkSize = 10;
  for (let i = 0; i < activeProfiles.length; i += chunkSize) {
    const chunk = activeProfiles.slice(i, i + chunkSize);
    
    await Promise.allSettled(
      chunk.map(async (profile) => {
        if (profileLocks.has(profile.id)) return;

        const hasBotTrade = profile.has_bot_trade === 1;
        const lastPoll = lastPollTimes.get(profile.id) || 0;
        const isEmpty = emptyProfileState.get(profile.id) ?? true;

        // Deterministic jitter between 50s and 70s based on profile ID
        // This permanently breaks any synchronized thundering herds.
        const jitterMs = (profile.id % 20) * 1000;
        const throttleMs = 50000 + jitterMs;

        // Adaptive Polling Throttle: If no bot trades and it was empty last time, poll based on jittered interval
        if (!hasBotTrade && isEmpty && (now - lastPoll < throttleMs)) {
          return;
        }
        
        profileLocks.add(profile.id);
        lastPollTimes.set(profile.id, now);

        try {
          const customMap = profile.broker_symbol_map ? JSON.parse(profile.broker_symbol_map) : {};
          let rawToken: string;
        try {
          rawToken = isEncrypted(profile.metaapi_token)
            ? decrypt(profile.metaapi_token)
            : profile.metaapi_token;
        } catch (e: any) {
          return;
        }

        const connection = await getSharedConnection(
          rawToken,
          profile.metaapi_account_id,
          true,
        );
        let allPositions = await connection.getPositions();
        emptyProfileState.set(profile.id, allPositions.length === 0);


        const openDbTrades = (await db
          .prepare(
            "SELECT meta_order_id, initial_risk_pips, manages_own_trailing, bot_id FROM bot_trade_states WHERE profile_id = ? AND status = ?",
          )
          .all(profile.id, "OPEN")) as any[];
        const botOrderIds = new Set(openDbTrades.map((t) => String(t.meta_order_id)));
        const dbTradeMap = new Map(
          openDbTrades.map((t) => [String(t.meta_order_id), t]),
        );
        const positions = allPositions.filter(
          (p: any) =>
            botOrderIds.has(String(p.id)) ||
            p.clientId === "AI_SNIPER_TP1" ||
            p.clientId === "AI_SNIPER_TP2" ||
            p.clientId?.startsWith("AI_SNIPER"),
        );

        for (const pos of positions) {
          if (!positionState.has(profile.id)) {
            positionState.set(profile.id, new Map());
          }
          const profileState = positionState.get(profile.id)!;

          // Initialize local tracking state if new position
          if (!profileState.has(pos.id)) {
            // Use MetaAPI pos.time for real open time
            const realOpenTime = pos.time
              ? new Date(pos.time).getTime()
              : Date.now();
            profileState.set(pos.id, {
              entryTime: realOpenTime,
              brokeEven: false,
              session: currentSession,
            });
          }

          const state = profileState.get(pos.id)!;
          const spec = getSymbolSpec(pos.symbol);

          // MetaAPI returns profit in account currency.
          // We can approximate pip profit using price difference.
          const diff =
            pos.type === "POSITION_TYPE_BUY"
              ? pos.currentPrice - pos.openPrice
              : pos.openPrice - pos.currentPrice;

          const floatingPips = diff / spec.pipSize;

          // ── 0. Naked Trade Safeguard (Emergency 50-pip SL) ────────────────────
          if (!pos.stopLoss) {
            console.warn(
              `[TradeManager] 🚨 NAKED TRADE DETECTED: Position ${pos.id} on ${pos.symbol} has no Stop Loss! Applying 50-pip emergency SL.`,
            );
            const emergencyPips = 50 * spec.pipSize;
            const emSlPrice =
              pos.type === "POSITION_TYPE_BUY"
                ? pos.currentPrice - emergencyPips
                : pos.currentPrice + emergencyPips;
            const brokerDigits = getSymbolSpec(pos.symbol).digits || 5;
            const emSlPriceFinal = parseFloat(emSlPrice.toFixed(brokerDigits));
            pos.stopLoss = emSlPriceFinal; // Optimistic update so trail doesn't spam
            (async () => {
              try {
                await withRetry(() =>
                  connection.modifyPosition(
                    pos.id,
                    emSlPriceFinal,
                    pos.takeProfit,
                  ),
                );
                await db
                  .prepare(
                    "UPDATE bot_trade_states SET sl_price = ? WHERE meta_order_id = ?",
                  )
                  .run(emSlPriceFinal, pos.id);
              } catch (e: any) {
                console.error(
                  `[TradeManager] Failed to apply emergency SL for naked position ${pos.id}:`,
                  e.message,
                );
              }
            })();
          }

          // ── 1. Trailing Stop Engine & Partials Disabled in TradeManager ───────────
          // Canonical Rule (AGENTS.md): All trailing stops, break-even, and trade lifecycle 
          // management are exclusively handled inside LiveOrchestrator.ts on every M1 tick.
          // TradeManager must NEVER execute partial closes or modify SL/TP.

          const now = new Date();

          // ── 3. High-Impact News Sweeper (Force Close 5 minutes prior) ─────────────────────────
          if (shouldForceCloseForNews(pos.symbol, now)) {
            console.log(
              `[TradeManager] 🚨 HIGH IMPACT NEWS WARNING: Force closing active trade ${pos.symbol} (${pos.id}) to protect capital.`,
            );
            try {
              await connection.closePosition(pos.id);
              globalTradeGate.release(profile.id, pos.id);
              pos._closedInNews = true;
              continue;
            } catch (err: any) {
              console.error(
                `[TradeManager] Failed to force close position ${pos.id} for News Warning:`,
                err.message,
              );
            }
          }

          // ── 3.5. Timeout Sweeper (forceCloseHours safety check) ─────────────────────────
          const dbTrade = dbTradeMap.get(String(pos.id));
          if (dbTrade && dbTrade.open_time) {
            const openMs = Number(dbTrade.open_time);
            if (openMs > 0) {
              const baseSymbol = PairConfigManager.getBaseSymbol(pos.symbol);
              const isSage = (dbTrade.bot_id || "").toUpperCase() === "SAGE";
              const cfgs = isSage ? PairConfigManager.getSageConfigs(baseSymbol) : PairConfigManager.getMageConfigs(baseSymbol);
              const fcHours = cfgs?.[0]?.forceCloseHours;
              if (fcHours && fcHours > 0 && now.getTime() - openMs >= fcHours * 3600 * 1000) {
                console.log(
                  `[TradeManager] ⏱️ TIMEOUT CLOSE: Force closing ${dbTrade.bot_id} ${pos.symbol} (${pos.id}) - reached ${fcHours}h max duration.`,
                );
                try {
                  await connection.closePosition(pos.id);
                  await db.prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ?").run(dbTrade.id);
                  globalTradeGate.release(profile.id, pos.id);
                  pos._closedInNews = true;
                  continue;
                } catch (err: any) {
                  console.error(`[TradeManager] Failed to timeout close position ${pos.id}:`, err.message);
                }
              }
            }
          }

          // ── 4. Lockout Tracking (Stop Loss hit) ─────────────────────────
          // In MetaAPI, if a position is closed, it won't appear in getPositions().
          // So how do we know if it hit SL?
          // We need to check closed positions or deals.
        }

        // Check for positions that disappeared (closed)
        const currentPosIds = new Set(
          positions
            .filter((p: any) => !p._closedInDeathZone && !p._closedInNews)
            .map((p: any) => p.id),
        );

        // ── RECONCILE ORPHAN PLACING TRADES (Ghost Trade Prevention) ────────────────
        const stuckPlacingTrades = (await db
          .prepare(
            "SELECT * FROM bot_trade_states WHERE profile_id = ? AND status = 'PLACING' AND created_at < NOW() - INTERVAL '2 minutes'",
          )
          .all(profile.id)) as any[];
        if (stuckPlacingTrades.length > 0) {
          for (const stuck of stuckPlacingTrades) {
            if (!stuck.client_id) continue;

            const matchedPos = allPositions.find(
              (p: any) => p.clientId === stuck.client_id || (stuck.meta_order_id && String(p.id) === String(stuck.meta_order_id)),
            );
            if (matchedPos) {
              console.log(
                `[TradeManager] 🛡️ Rescued orphaned PLACING position ${stuck.client_id}. Setting to OPEN.`,
              );
              await db
                .prepare(
                  "UPDATE bot_trade_states SET status = 'OPEN', meta_order_id = ? WHERE id = ?",
                )
                .run(matchedPos.id, stuck.id);
              currentPosIds.add(matchedPos.id);
            } else {
              // Check active pending limit orders on broker before declaring failed
              let matchedOrderOnBroker = false;
              try {
                const pendingOrders = await connection.getOrders();
                const matchedPending = (pendingOrders || []).find(
                  (o: any) => o.clientId === stuck.client_id || (stuck.meta_order_id && String(o.id) === String(stuck.meta_order_id)),
                );
                if (matchedPending) {
                  matchedOrderOnBroker = true;
                  console.log(
                    `[TradeManager] ⏳ Trade ${stuck.client_id} is an active pending limit order (${matchedPending.id}) on broker. Retaining.`,
                  );
                  if (!stuck.meta_order_id) {
                    await db.prepare("UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?").run(matchedPending.id, stuck.id);
                  }
                }
              } catch (_) {}

              if (matchedOrderOnBroker) continue;

              // Check history orders just in case it closed already
              try {
                const fallbackTime = stuck.created_at ? (Number.isFinite(Number(stuck.created_at)) ? Number(stuck.created_at) : new Date(stuck.created_at).getTime()) : Date.now();
                const startTimeMs = Math.min(Date.now() - 24 * 60 * 60 * 1000, (isNaN(fallbackTime) ? Date.now() : fallbackTime) - 24 * 60 * 60 * 1000);
                const rawHistoryOrders = await connection.getHistoryOrdersByTimeRange(
                  new Date(startTimeMs),
                  new Date(),
                );
                const historyOrders = Array.isArray(rawHistoryOrders)
                  ? rawHistoryOrders
                  : (rawHistoryOrders as any)?.historyOrders || (rawHistoryOrders as any)?.items || [];
                const matchedOrder = historyOrders.find(
                  (o: any) => o.clientId === stuck.client_id || (stuck.meta_order_id && String(o.id) === String(stuck.meta_order_id)),
                );
                if (matchedOrder) {
                  console.log(
                    `[TradeManager] 🛡️ Rescued orphaned PLACING trade ${stuck.client_id} from history. Setting to OPEN.`,
                  );
                  const posId = matchedOrder.positionId || matchedOrder.id;
                  await db
                    .prepare(
                      "UPDATE bot_trade_states SET status = 'OPEN', meta_order_id = ? WHERE id = ?",
                    )
                    .run(posId, stuck.id);
                  currentPosIds.add(posId);
                } else {
                  console.log(
                    `[TradeManager] ⚠️ Marking stuck PLACING trade ${stuck.client_id} as FAILED (Not found on broker).`,
                  );
                  await db
                    .prepare(
                      "UPDATE bot_trade_states SET status = 'FAILED' WHERE id = ?",
                    )
                    .run(stuck.id);
                }
              } catch (err) {
                console.error(
                  `[TradeManager] Failed to fetch history orders to reconcile PLACING trade:`,
                  err,
                );
              }
            }
          }
        }

        // ── RECONCILE PENDING_VERIFICATION TRADES (Broker Maintenance/Outage Recovery) ──
        const pendingVerificationTrades = (await db
          .prepare(
            "SELECT * FROM bot_trade_states WHERE profile_id = ? AND status = 'PENDING_VERIFICATION'",
          )
          .all(profile.id)) as any[];
        if (pendingVerificationTrades.length > 0) {
          for (const pending of pendingVerificationTrades) {
            if (!pending.client_id) continue;

            const matchedPos = allPositions.find(
              (p: any) =>
                p.clientId === pending.client_id ||
                String(p.id) === String(pending.meta_order_id),
            );
            if (matchedPos) {
              console.log(
                `[TradeManager] 🛡️ Reconciled PENDING_VERIFICATION position ${pending.client_id}. Setting to OPEN.`,
              );
              await db
                .prepare(
                  "UPDATE bot_trade_states SET status = 'OPEN', meta_order_id = ? WHERE id = ?",
                )
                .run(matchedPos.id, pending.id);
              currentPosIds.add(matchedPos.id);
            } else {
              // Check active pending limit orders on broker before declaring failed
              let matchedOrderOnBroker = false;
              try {
                const pendingOrders = await connection.getOrders();
                const matchedPending = (pendingOrders || []).find(
                  (o: any) =>
                    o.clientId === pending.client_id ||
                    (pending.meta_order_id && String(o.id) === String(pending.meta_order_id)),
                );
                if (matchedPending) {
                  matchedOrderOnBroker = true;
                  console.log(
                    `[TradeManager] ⏳ PENDING_VERIFICATION trade ${pending.client_id} is an active pending limit order (${matchedPending.id}) on broker. Retaining.`,
                  );
                  if (!pending.meta_order_id) {
                    await db.prepare("UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?").run(matchedPending.id, pending.id);
                  }
                }
              } catch (_) {}

              if (matchedOrderOnBroker) continue;

              // Check history orders just in case it closed already
              try {
                const fallbackTime = pending.created_at ? (Number.isFinite(Number(pending.created_at)) ? Number(pending.created_at) : new Date(pending.created_at).getTime()) : Date.now();
                const startTimeMs = Math.min(Date.now() - 24 * 60 * 60 * 1000, (isNaN(fallbackTime) ? Date.now() : fallbackTime) - 24 * 60 * 60 * 1000);
                const rawHistoryOrders = await connection.getHistoryOrdersByTimeRange(
                  new Date(startTimeMs),
                  new Date(),
                );
                const historyOrders = Array.isArray(rawHistoryOrders)
                  ? rawHistoryOrders
                  : (rawHistoryOrders as any)?.historyOrders || (rawHistoryOrders as any)?.items || [];
                const matchedOrder = historyOrders.find(
                  (o: any) =>
                    o.clientId === pending.client_id ||
                    o.id === pending.meta_order_id ||
                    o.positionId === pending.meta_order_id,
                );
                if (matchedOrder) {
                  console.log(
                    `[TradeManager] 🛡️ Reconciled PENDING_VERIFICATION trade ${pending.client_id} from history. Setting to OPEN.`,
                  );
                  const posId = matchedOrder.positionId || matchedOrder.id;
                  await db
                    .prepare(
                      "UPDATE bot_trade_states SET status = 'OPEN', meta_order_id = ? WHERE id = ?",
                    )
                    .run(posId, pending.id);
                  currentPosIds.add(posId);
                } else {
                  // If it's been in PENDING_VERIFICATION for more than 5 minutes and not found on broker, mark as FAILED
                  const createdTime = pending.created_at
                    ? (Number.isFinite(Number(pending.created_at)) ? Number(pending.created_at) : new Date(pending.created_at).getTime())
                    : Date.now();
                  if (Date.now() - (isNaN(createdTime) ? Date.now() : createdTime) > 5 * 60 * 1000) {
                    console.log(
                      `[TradeManager] ⚠️ Marking stuck PENDING_VERIFICATION trade ${pending.client_id} as FAILED (Not found on broker after 5 minutes).`,
                    );
                    await db
                      .prepare(
                        "UPDATE bot_trade_states SET status = 'FAILED' WHERE id = ?",
                      )
                      .run(pending.id);
                  }
                }
              } catch (err) {
                console.error(
                  `[TradeManager] Failed to fetch history orders to reconcile PENDING_VERIFICATION trade:`,
                  err,
                );
              }
            }
          }
        }

        // ── RECONCILE DB & LOG TO DIARY ─────────────────────
        const openReconcileTrades = (await db
          .prepare(
            "SELECT * FROM bot_trade_states WHERE profile_id = ? AND status = 'OPEN'",
          )
          .all(profile.id)) as any[];

        for (const dbTrade of openReconcileTrades) {
          const id = String(dbTrade.meta_order_id);
          if (!currentPosIds.has(id)) {
            // Position closed! Was it a loss? Query the deal history
            try {
              // Check deals directly first
              const historyResponse = await connection.getDealsByPosition(id).catch(() => null);
              const deals = Array.isArray(historyResponse) ? historyResponse : (historyResponse?.deals || []);
              const closingDeal = deals.find(
                (d: any) =>
                  d.entryType === "DEAL_ENTRY_OUT" ||
                  d.entryType === "DEAL_ENTRY_INOUT",
              );

              // If no closing deal, it might be a cancelled limit order or a ghost trade.
              // Check History Orders to guarantee the trade is truly closed
              let matchedHistoryOrder = null;
              if (!closingDeal) {
                const fallbackTime = Number(dbTrade.open_time || 0) > 0 ? Number(dbTrade.open_time) : (dbTrade.created_at ? new Date(dbTrade.created_at).getTime() : Date.now());
                const startTimeMs = Math.min(Date.now() - 30 * 24 * 60 * 60 * 1000, fallbackTime - 30 * 24 * 60 * 60 * 1000);
                const rawHistoryOrders = await connection.getHistoryOrdersByTimeRange(
                  new Date(startTimeMs),
                  new Date(),
                ).catch(() => []);
                const historyOrders = Array.isArray(rawHistoryOrders)
                  ? rawHistoryOrders
                  : (rawHistoryOrders as any)?.historyOrders || (rawHistoryOrders as any)?.items || [];
                matchedHistoryOrder = historyOrders.find(
                  (o: any) => o.positionId === id || o.id === id,
                );

                if (!matchedHistoryOrder && !closingDeal) {
                  const ghostKey = `${profile.id}_${id}`;
                  const ghostCount = (ghostTradeTracker.get(ghostKey) || 0) + 1;
                  ghostTradeTracker.set(ghostKey, ghostCount);

                  // Allow up to 12 cycles (~2 minutes) of grace period for broker deals to populate
                  if (ghostCount <= 12) {
                    console.warn(
                      `[TradeManager] 👻 GHOST TRADE DETECTED! Position ${id} vanished from getPositions() but isn't in historyOrders or deals! (Attempt ${ghostCount}/12 - Delaying DB close...)`,
                    );
                    continue; // Do not close in DB yet!
                  } else {
                    console.warn(
                      `[TradeManager] 🧹 GHOST TRADE TIMEOUT: Position ${id} on Profile ${profile.id} never appeared in broker history after 12 checks. Cleaning DB record to CLOSED.`,
                    );
                    ghostTradeTracker.delete(ghostKey);
                    await closeTrade(id, "CLOSED");
                    continue;
                  }
                }
              }

              // Reset ghost counter if trade successfully matched
              ghostTradeTracker.delete(`${profile.id}_${id}`);

              const profileState = positionState.get(profile.id);
              const state = profileState?.get(id);
              const spec = getSymbolSpec(dbTrade.broker_symbol);

              if (closingDeal) {
                if (closingDeal.profit < 0) {
                  const sessionStr = state ? state.session : currentSession;
                  console.log(
                    `[TradeManager] Profile ${profile.id} Position ${id} (${dbTrade.broker_symbol}) closed in LOSS. Updating Lockout Rule for session ${sessionStr}.`,
                  );
                  await incrementSessionLoss(
                    profile.id,
                    dbTrade.broker_symbol,
                    sessionStr,
                    dbTrade.bot_id || "seer",
                  );

                  // --- CATASTROPHIC SLIPPAGE KILLSWITCH ---
                  const realizedLossPips =
                    Math.abs(closingDeal.price - dbTrade.entry_price) /
                    spec.pipSize;
                  const plannedLossPips = dbTrade.initial_risk_pips || 20;
                  const riskRatio = realizedLossPips / plannedLossPips;

                  if (riskRatio >= 2.0) {
                    console.error(
                      `[TradeManager] 💀 CATASTROPHIC SLIPPAGE DETECTED on ${dbTrade.broker_symbol}! Realized: ${realizedLossPips.toFixed(1)} pips, Planned: ${plannedLossPips} pips (Ratio: ${riskRatio.toFixed(2)}x)`,
                    );

                    // Deactivate automation
                    await db
                      .prepare(
                        "UPDATE trading_profiles SET automation_active = 0, ai_sniper_active = 0 WHERE id = ?",
                      )
                      .run(profile.id);
                    await addBotLog(
                      profile.id,
                      dbTrade.bot_id || "SYSTEM",
                      dbTrade.broker_symbol,
                      "CATASTROPHIC_SLIPPAGE_HALT",
                      `CATASTROPHIC SLIPPAGE KILLSWITCH: Realized loss was ${riskRatio.toFixed(1)}x the planned risk on ${dbTrade.broker_symbol}. Automation halted.`,
                    );

                    // Broadcast to socket
                    const { getIO } = await import("../core/socket.js");
                    const io = getIO();
                    if (io) {
                      io.to(`profile_${profile.id}`).emit(
                        "slippage_killswitch:alert",
                        {
                          profileId: profile.id,
                          symbol: dbTrade.broker_symbol,
                          riskRatio,
                          message: `CATASTROPHIC SLIPPAGE KILLSWITCH: Realized loss was ${riskRatio.toFixed(1)}x the planned risk on ${dbTrade.broker_symbol}. Automation halted.`,
                        },
                      );
                    }
                  }
                }

                const pips =
                  dbTrade.direction === "BUY"
                    ? (closingDeal.price - dbTrade.entry_price) / spec.pipSize
                    : (dbTrade.entry_price - closingDeal.price) / spec.pipSize;

                const status = closingDeal.profit >= 0 ? "WON" : "LOST";

                await logToDiary(
                  dbTrade.user_id,
                  profile.id,
                  dbTrade.bot_id,
                  dbTrade.broker_symbol,
                  dbTrade.direction,
                  dbTrade.entry_price,
                  closingDeal.price,
                  dbTrade.lots,
                  pips,
                  closingDeal.profit,
                  status,
                  dbTrade.open_time,
                );
                const visionBots = [
                  "discretionary_trader",
                  "sage",
                  "seer",
                  "reaper",
                  "MAGE",
                  "mage",
                ];
                const actionPrefix = visionBots.includes(dbTrade.bot_id)
                  ? "[DiscretionaryTrader] "
                  : "";
                addBotLog(
                  profile.id,
                  dbTrade.bot_id || "SYSTEM",
                  dbTrade.broker_symbol,
                  `${actionPrefix}TRADE_CLOSED`,
                  `Closed in ${status} for ${pips.toFixed(1)} pips (${closingDeal.profit >= 0 ? "+" : ""}${closingDeal.profit.toFixed(2)})`,
                );
              }

              // Mark as closed after successful logging
              await closeTrade(id, "CLOSED");
              console.log(
                `[TradeManager] Reconciled DB state to CLOSED for missing MetaAPI position ${id}`,
              );

              // ── Notify Orchestrators if this was an AI trade ──
              const visionBots = [
                "discretionary_trader",
                "sage",
                "SAGE",
                "seer",
                "SEER",
                "reaper",
                "MAGE",
                "mage",
              ];

              const pnlPips = closingDeal
                ? dbTrade.direction === "BUY"
                  ? (closingDeal.price - dbTrade.entry_price) / spec.pipSize
                  : (dbTrade.entry_price - closingDeal.price) / spec.pipSize
                : 0;

              if (dbTrade.bot_id && visionBots.includes(dbTrade.bot_id)) {
                try {
                  const { LiveOrchestrator } =
                    await import("../trading/index.js");
                  const orch = LiveOrchestrator.getInstance(profile.id.toString());
                  if (orch) {
                    orch.onTradeClosed(dbTrade.broker_symbol, pnlPips, id);
                    orch.clearActiveTrade(id);
                  }
                } catch (orchErr: any) {
                  console.warn(
                    `[TradeManager] Could not notify DiscretionaryTrader orchestrator for ${id}:`,
                    orchErr.message,
                  );
                }
                // Release the global gate slot
                globalTradeGate.release(profile.id, id);
              } else {
                // For any other bots/manual, just release the gate slot
                globalTradeGate.release(profile.id, id);
              }

              if (positionState.has(profile.id)) {
                positionState.get(profile.id)!.delete(id);
              }
            } catch (e: any) {
              console.error(
                `[TradeManager] CRITICAL: Could not fetch deal history for closed pos ${id}. Retaining as OPEN to retry later so session loss limits are not bypassed. Error: ${e.message}`,
              );
              // DO NOT CLOSE IT! Let the next loop retry it.
            }
          }
        }
      } catch (err: any) {
        if (!err.message.includes("Fast fail")) {
          console.error(
            `[TradeManager Profile ${profile.id}] Error:`,
            err.message,
          );
        }
      } finally {
        profileLocks.delete(profile.id);
      }
    })
  );
  }
}

export async function cleanClosedTrades() {
  try {
    const info = await db.prepare("DELETE FROM bot_trade_states WHERE status = 'CLOSED' OR status = 'FAILED'").run();
    if (info && info.changes > 0) {
      console.log(`[Database Janitor] Swept ${info.changes} closed/failed trades from bot_trade_states.`);
    }
  } catch (err: any) {
    console.error(`[Database Janitor] Error cleaning closed trades: ${err.message}`);
  }
}


