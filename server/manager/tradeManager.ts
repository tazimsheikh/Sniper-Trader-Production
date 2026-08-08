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
  globalTradeGate.clearProfile(profileId);
}

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
      `SELECT tp.id, u.metaapi_token, tp.metaapi_account_id 
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

  await Promise.allSettled(
    activeProfiles.map(async (profile) => {
      if (profileLocks.has(profile.id)) return;
      profileLocks.add(profile.id);

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

        // --- MARGIN DEFENDER EMERGENCY ACTIONS ---
        try {
          const accountInfo = await connection.getAccountInformation();
          if (accountInfo.marginLevel && accountInfo.marginLevel < 150) {
            console.warn(
              `[TradeManager] 🚨 MARGIN DEFENDER TRIGGERED: Profile ${profile.id} margin level is ${accountInfo.marginLevel.toFixed(1)}%!`,
            );

            // Disable automation
            await db
              .prepare(
                "UPDATE trading_profiles SET automation_active = 0, ai_sniper_active = 0 WHERE id = ?",
              )
              .run(profile.id);
            await addBotLog(
              profile.id,
              "SYSTEM",
              "ALL",
              "MARGIN_CALL_HALT",
              `MARGIN DEFENDER ACTIVE: Margin level fell to ${accountInfo.marginLevel.toFixed(1)}%. Automation disabled.`,
            );

            // Broadcast to UI
            const { getIO } = await import("../core/socket.js");
            const io = getIO();
            if (io) {
              io.to(`profile_${profile.id}`).emit("margin_defender:alert", {
                profileId: profile.id,
                marginLevel: accountInfo.marginLevel,
                message: `Emergency halt: Margin level is ${accountInfo.marginLevel.toFixed(1)}%. Automation disabled.`,
              });
            }

            // If drops below 110%, close the largest losing trade first to free up margin
            if (accountInfo.marginLevel < 110 && allPositions.length > 0) {
              console.error(
                `[TradeManager] 💀 MARGIN CRITICAL (< 110%). Initiating structured liquidation to free margin.`,
              );

              // Sort positions by floating profit ascending (largest loss first)
              const sortedPositions = [...allPositions].sort(
                (a: any, b: any) => (a.profit || 0) - (b.profit || 0),
              );
              const targetPos = sortedPositions[0]; // Largest loss

              console.log(
                `[TradeManager] Force closing largest losing position ${targetPos.symbol} (${targetPos.id}) profit: ${targetPos.profit}`,
              );
              await connection.closePosition(targetPos.id);

              await addBotLog(
                profile.id,
                targetPos.bot_id || "SYSTEM",
                targetPos.symbol,
                "MARGIN_LIQUIDATION_CLOSE",
                `MARGIN DEFENDER LIQUIDATION: Closed ${targetPos.symbol} (${targetPos.id}) to free margin. Profit: ${targetPos.profit}`,
              );

              // Filter it out of local array so we don't process it further in this tick
              allPositions = allPositions.filter(
                (p: any) => p.id !== targetPos.id,
              );
            }
          }
        } catch (marginErr: any) {
          console.error(
            `[TradeManager] Error in Margin Defender checks:`,
            marginErr.message,
          );
        }

        const openDbTrades = (await db
          .prepare(
            "SELECT meta_order_id, initial_risk_pips, manages_own_trailing, bot_id FROM bot_trade_states WHERE profile_id = ? AND status = ?",
          )
          .all(profile.id, "OPEN")) as any[];
        const botOrderIds = new Set(openDbTrades.map((t) => t.meta_order_id));
        const dbTradeMap = new Map(
          openDbTrades.map((t) => [t.meta_order_id, t]),
        );
        const positions = allPositions.filter(
          (p: any) =>
            botOrderIds.has(p.id) ||
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

          // ── 1. Institutional Trailing Stop Engine (1.5R Activation, 1.0R Trail) ───────────
          const dbTrade = dbTradeMap.get(pos.id);

          // 🛡️ DYNAMIC TRAILING OWNERSHIP CHECK:
          // If manages_own_trailing is 1 (Mage, Sage, Seer, Black Swan, etc.), tradeManager MUST NOT apply trailing stops.
          // Structural trailing is handled internally in LiveOrchestrator.
          if (dbTrade?.manages_own_trailing === 1) {
            // Do nothing. Structural trailing is handled in LiveOrchestrator.
          } else {
            let initialRiskPips = dbTrade?.initial_risk_pips || 20; // Fallback to 20 pips if missing
            if (initialRiskPips <= 0) initialRiskPips = 20;

            const profitR = floatingPips / initialRiskPips;

            if (profitR >= 1.5) {
              // ── PARTIAL PROFIT TRIGGER (50% Volume at 1.5R) ──
              if (dbTrade && dbTrade.t1_hit !== 1) {
                // Set DB flag FIRST to prevent duplicate partials on rapid ticks or broker timeouts
                await db
                  .prepare(
                    "UPDATE bot_trade_states SET t1_hit = 1 WHERE meta_order_id = ?",
                  )
                  .run(pos.id);
                dbTrade.t1_hit = 1; // Update local state

                if (pos.volume >= 0.02) {
                  const halfVolume = Math.floor((pos.volume / 2) * 100) / 100;
                  if (halfVolume >= 0.01) {
                    try {
                      const partialResult =
                        (await connection.closePositionPartially(
                          pos.id,
                          halfVolume,
                          {},
                        )) as any;
                      console.log(
                        `[TradeManager] 💰 ${pos.symbol} hit 1.5R! Took partial profit of ${halfVolume} lots.`,
                      );
                      if (
                        partialResult?.positionId &&
                        partialResult.positionId !== pos.id
                      ) {
                        console.log(
                          `[TradeManager] 🔄 Position split detected. Updating DB meta_order_id from ${pos.id} to ${partialResult.positionId}`,
                        );
                        await db
                          .prepare(
                            "UPDATE bot_trade_states SET meta_order_id = ? WHERE meta_order_id = ?",
                          )
                          .run(partialResult.positionId, pos.id);
                        pos.id = partialResult.positionId; // Update local reference for trailing
                      }
                    } catch (e: any) {
                      console.error(
                        `[TradeManager] ❌ Failed to take partial profit for ${pos.symbol}:`,
                        e.message,
                      );
                    }
                  }
                } else {
                  console.log(
                    `[TradeManager] 🛡️ ${pos.symbol} hit 1.5R! Volume ${pos.volume} is too small to split. Leaving as single trade.`,
                  );
                }

                // Move SL to Break-Even + 2 pips, adjusted for swap fee and commissions
                const totalFees = (pos.swap || 0) + (pos.commission || 0);
                let feeOffsetPips = 0;
                if (totalFees < 0) {
                  const pipValue =
                    spec.pipSize * (pos.volume * spec.pipValuePerLot);
                  feeOffsetPips = Math.abs(totalFees) / pipValue;
                }
                const adjustedBeOffset = (2.0 + feeOffsetPips) * spec.pipSize;
                const bePrice =
                  pos.type === "POSITION_TYPE_BUY"
                    ? pos.openPrice + adjustedBeOffset
                    : pos.openPrice - adjustedBeOffset;

                let moveSl = false;
                if (
                  pos.type === "POSITION_TYPE_BUY" &&
                  (!pos.stopLoss || pos.stopLoss < bePrice)
                )
                  moveSl = true;
                if (
                  pos.type === "POSITION_TYPE_SELL" &&
                  (!pos.stopLoss || pos.stopLoss > bePrice)
                )
                  moveSl = true;

                if (moveSl) {
                  const brokerDigits = getSymbolSpec(pos.symbol).digits || 5;
                  const bePriceFinal = parseFloat(
                    bePrice.toFixed(brokerDigits),
                  );
                  pos.stopLoss = bePriceFinal; // Optimistic update
                  (async () => {
                    try {
                      await withRetry(() =>
                        connection.modifyPosition(
                          pos.id,
                          bePriceFinal,
                          pos.takeProfit,
                        ),
                      );
                      console.log(
                        `[TradeManager] 🛡️ ${pos.symbol} hit 1.5R! SL moved to BE+2 (${bePriceFinal}).`,
                      );
                    } catch (e: any) {
                      console.error(
                        `[TradeManager] ❌ Failed to move SL to BE+2 for ${pos.symbol}:`,
                        e.message,
                      );
                    }
                  })();
                }
              }

              // ── MATHEMATICAL TRAILING STOP (After 1.5R) ──
              const trailDistance = initialRiskPips * 1.0 * spec.pipSize;
              const newSlPrice =
                pos.type === "POSITION_TYPE_BUY"
                  ? pos.currentPrice - trailDistance
                  : pos.currentPrice + trailDistance;

              let shouldMoveSl = false;
              const minTrailStep = 2 * spec.pipSize; // Only update broker if SL improves by at least 2 pips to prevent spam
              if (!pos.stopLoss) {
                shouldMoveSl = true;
              } else if (
                pos.type === "POSITION_TYPE_BUY" &&
                newSlPrice >= pos.stopLoss + minTrailStep
              ) {
                shouldMoveSl = true;
              } else if (
                pos.type === "POSITION_TYPE_SELL" &&
                newSlPrice <= pos.stopLoss - minTrailStep
              ) {
                shouldMoveSl = true;
              }

              if (shouldMoveSl && dbTrade?.t1_hit === 1) {
                // Only trail AFTER BE+2 has been locked
                console.log(
                  `[TradeManager] ${pos.symbol} +${floatingPips.toFixed(1)} pips. Trailing SL to lock profit.`,
                );
                const brokerDigits = getSymbolSpec(pos.symbol).digits || 5;
                const newSlPriceFinal = parseFloat(
                  newSlPrice.toFixed(brokerDigits),
                );
                pos.stopLoss = newSlPriceFinal; // Optimistic update
                state.brokeEven = true;
                (async () => {
                  try {
                    await withRetry(() =>
                      connection.modifyPosition(
                        pos.id,
                        newSlPriceFinal,
                        pos.takeProfit,
                      ),
                    );
                    await db
                      .prepare(
                        "UPDATE bot_trade_states SET sl_price = ? WHERE meta_order_id = ?",
                      )
                      .run(newSlPriceFinal, pos.id);
                  } catch (e: any) {
                    console.error(
                      `[TradeManager] ❌ Failed to trail SL for ${pos.symbol}:`,
                      e.message,
                    );
                  }
                })();
              }
            }
          }

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

          // ── 3. Lockout Tracking (Stop Loss hit) ─────────────────────────
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
              (p: any) => p.clientId === stuck.client_id,
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
              // Check history orders just in case it closed already
              try {
                const rawHistoryOrders = await connection.getHistoryOrdersByTimeRange(
                  new Date(Date.now() - 24 * 60 * 60 * 1000),
                  new Date(),
                );
                const historyOrders = Array.isArray(rawHistoryOrders)
                  ? rawHistoryOrders
                  : (rawHistoryOrders as any)?.historyOrders || (rawHistoryOrders as any)?.items || [];
                const matchedOrder = historyOrders.find(
                  (o: any) => o.clientId === stuck.client_id,
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
                p.id === pending.meta_order_id,
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
              // Check history orders just in case it closed already
              try {
                const rawHistoryOrders = await connection.getHistoryOrdersByTimeRange(
                  new Date(Date.now() - 24 * 60 * 60 * 1000),
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
                    ? new Date(pending.created_at).getTime()
                    : Date.now();
                  if (Date.now() - createdTime > 5 * 60 * 1000) {
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
          const id = dbTrade.meta_order_id;
          if (!currentPosIds.has(id)) {
            // Position closed! Was it a loss? Query the deal history
            try {
              // Check History Orders to guarantee the trade is truly closed (Ghost Trade prevention)
              const rawHistoryOrders = await connection.getHistoryOrdersByTimeRange(
                new Date(Date.now() - 24 * 60 * 60 * 1000),
                new Date(),
              );
              const historyOrders = Array.isArray(rawHistoryOrders)
                ? rawHistoryOrders
                : (rawHistoryOrders as any)?.historyOrders || (rawHistoryOrders as any)?.items || [];
              const matchedHistoryOrder = historyOrders.find(
                (o: any) => o.positionId === id || o.id === id,
              );

              if (!matchedHistoryOrder) {
                console.warn(
                  `[TradeManager] 👻 GHOST TRADE DETECTED! Position ${id} vanished from getPositions() but isn't in historyOrders! Delaying DB close...`,
                );
                continue; // Do not close in DB yet!
              }

              const historyResponse = await connection.getDealsByPosition(id);
              const deals = historyResponse?.deals || [];
              const closingDeal = deals.find(
                (d: any) =>
                  d.entryType === "DEAL_ENTRY_OUT" ||
                  d.entryType === "DEAL_ENTRY_INOUT",
              );

              if (closingDeal) {
                const profileState = positionState.get(profile.id);
                const state = profileState?.get(id);

                const spec = getSymbolSpec(dbTrade.broker_symbol);

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

              const spec = getSymbolSpec(dbTrade.broker_symbol);
              const pnlPips = closingDeal
                ? dbTrade.direction === "BUY"
                  ? (closingDeal.price - dbTrade.entry_price) / spec.pipSize
                  : (dbTrade.entry_price - closingDeal.price) / spec.pipSize
                : 0;

              if (dbTrade.bot_id && visionBots.includes(dbTrade.bot_id)) {
                try {
                  const { LiveOrchestrator } =
                    await import("../trading/index.js");
                  const orch = LiveOrchestrator.getInstance(profile.id);
                  if (orch) orch.onTradeClosed(dbTrade.broker_symbol, pnlPips, id);
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
    }),
  );
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


