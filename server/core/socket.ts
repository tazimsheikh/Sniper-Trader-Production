import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { decrypt, isEncrypted } from "./crypto.js";
import { getSharedConnection } from "../trading/broker/metaApiHandler.js";
import { processAndCacheBrokerMetrics, getCachedBrokerMetrics } from "../utils/BrokerMetricsEngine.js";

let io: SocketIOServer | null = null;
const algoBalanceIntervals = new Map<number, NodeJS.Timeout>();
const discBalanceIntervals = new Map<number, NodeJS.Timeout>();

export async function pollBrokerMetricsForProfile(profileId: number, tokenToUse: string, metaapiAccountId: string) {
  try {
    const conn = await getSharedConnection(tokenToUse, metaapiAccountId);
    if (conn) {
      const updated = await conn.getAccountInformation();
      if (updated) {
        const metrics = await processAndCacheBrokerMetrics(profileId, updated);
        const { LiveOrchestrator } = await import("../trading/index.js");
        const currentOrch = LiveOrchestrator.getInstance(profileId);
        if (currentOrch) {
          currentOrch.cachedBrokerMetrics = metrics;
          currentOrch.cachedEquity = updated.equity;
        }

        io?.to(`profile_${profileId}`).emit(
          "discretionary_trader:broker_metrics_update",
          metrics
        );
        io?.to(`profile_${profileId}`).emit(
          "discretionary_trader:balance_update",
          {
            balance: updated.balance,
            equity: updated.equity,
            currency: updated.currency,
          }
        );
      }
    }
  } catch (e) {
    // Ignore balance fetch errors
  }
}

export function startProfileBalanceInterval(profileId: number, tokenToUse: string, metaapiAccountId: string) {
  if (discBalanceIntervals.has(profileId)) return;
  pollBrokerMetricsForProfile(profileId, tokenToUse, metaapiAccountId).catch(() => {});
  const interval = setInterval(async () => {
    const { LiveOrchestrator } = await import("../trading/index.js");
    const currentOrch = LiveOrchestrator.getInstance(profileId);
    if (!currentOrch || !currentOrch.isRunning()) {
      clearInterval(interval);
      discBalanceIntervals.delete(profileId);
      return;
    }
    await pollBrokerMetricsForProfile(profileId, tokenToUse, metaapiAccountId);
  }, 5000);
  discBalanceIntervals.set(profileId, interval);
}

export function initSocket(server: HttpServer) {
  io = new SocketIOServer(server, {
    cors: {
      // The frontend is served by the same Express instance, so same-origin connections
      // are always valid. FRONTEND_URL can optionally restrict to a specific domain.
      // NEVER default to `false` — that silently blocks all WebSocket connections.
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const cookieStr = socket.request.headers.cookie || "";
      const cookies = cookieStr
        .split(";")
        .map((v) => {
          const idx = v.indexOf("=");
          return idx !== -1 ? [v.slice(0, idx), v.slice(idx + 1)] : [v];
        })
        .reduce(
          (acc, v) => {
            if (v.length > 1) {
              acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(
                v[1].trim(),
              );
            }
            return acc;
          },
          {} as Record<string, string>,
        );

      const token = cookies.auth_token;
      if (!token) return next(new Error("Authentication error"));

      jwt.verify(token, process.env.JWT_SECRET as string, (err, decoded) => {
        if (err) return next(new Error("Authentication error"));
        (socket as any).user = decoded;
        next();
      });
    } catch (e) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    const verifyProfileOwnership = async (
      socket: any,
      profileId: number,
    ): Promise<boolean> => {
      if (!socket.user || !socket.user.id || !profileId) return false;
      
      // ✅ Promise Caching layer to prevent concurrent [SLOW QUERY] spam 
      if (!socket.verifiedProfiles) socket.verifiedProfiles = new Map<number, Promise<boolean>>();
      if (socket.verifiedProfiles.has(profileId)) {
        return socket.verifiedProfiles.get(profileId);
      }

      const verificationPromise = (async () => {
        try {
          const db2 = (await import("./db.js")).default;
          const profile = await db2
            .prepare("SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?")
            .get(profileId, socket.user.id);
          
          return !!profile;
        } catch (err: any) {
          console.error(`[Socket] verifyProfileOwnership DB error for profile ${profileId}:`, err.message);
          return false;
        }
      })();

      socket.verifiedProfiles.set(profileId, verificationPromise);
      return verificationPromise;
    };

    const pendingBotRisks = new Map<number, Promise<any>>();
    const pendingPairConfigs = new Map<number, Promise<any[]>>();

    async function getCachedBotRisks(profileId: number) {
      if (pendingBotRisks.has(profileId)) return pendingBotRisks.get(profileId);
      const promise = (async () => {
        const db2 = (await import("./db.js")).default;
        return await db2.prepare("SELECT bot_risks FROM trading_profiles WHERE id = ?").get(profileId);
      })();
      pendingBotRisks.set(profileId, promise);
      promise.finally(() => pendingBotRisks.delete(profileId));
      return promise;
    }

    async function getCachedPairConfigs(profileId: number) {
      if (pendingPairConfigs.has(profileId)) return pendingPairConfigs.get(profileId);
      const promise = (async () => {
        const db2 = (await import("./db.js")).default;
        return await db2.prepare("SELECT * FROM profile_pair_configs WHERE profile_id = ?").all(profileId);
      })();
      pendingPairConfigs.set(profileId, promise);
      promise.finally(() => pendingPairConfigs.delete(profileId));
      return promise;
    }

    // Example: Rooms for profile-specific events
    socket.on("join_profile", async (profileId: string) => {
      const isOwner = await verifyProfileOwnership(socket, parseInt(profileId));
      if (!isOwner) return;
      if (!(socket as any).joinedProfiles) {
        (socket as any).joinedProfiles = new Set<number>();
      } else {
        // Leave any previously joined profile rooms to prevent balance and trade bleeding
        for (const oldProfileId of (socket as any).joinedProfiles) {
          socket.leave(`profile_${oldProfileId}`);
        }
        (socket as any).joinedProfiles.clear();
      }

      socket.join(`profile_${profileId}`);
      (socket as any).joinedProfiles.add(parseInt(profileId));

      // ── INSTANT STATE SYNC for reconnecting/mobile clients ─────────────────
      // When a new browser or mobile device connects, replay the current running
      // state immediately so it doesn't have to wait for the next broadcast.
      try {
        const numId = parseInt(profileId);
        const { LiveOrchestrator } =
          await import("../trading/index.js");
        const discOrch = LiveOrchestrator.getInstance(numId);
        if (discOrch) {
          // Broadcast once per active bot so each dashboard gets its correct view
          const bots =
            discOrch.activeBots.size > 0
              ? Array.from(discOrch.activeBots)
              : ["seductress"];
          for (const b of bots) {
            socket.emit("discretionary_trader:status", discOrch.getStatus(b));
          }
        } else {
          // Bot is offline — still send persisted bot_risks so UI slider is correct
          const profileRow = (await getCachedBotRisks(numId)) as any;
          const botRisks = (() => {
            try {
              return JSON.parse(profileRow?.bot_risks || "{}");
            } catch {
              return {};
            }
          })();
          
          // Reconstruct offline pair states
          const { DISCRETIONARY_TRADER_PAIRS } = await import("../trading/engine/LiveOrchestrator.js");
          const { PairConfigManager } = await import("../trading/config/PairConfig.js");
          const dbRows = await getCachedPairConfigs(numId);
          const configMap = new Map();
          for (const r of dbRows) configMap.set(r.pair, r);

          let safeBotId = "seer"; // Default for join_profile
          let pairs = DISCRETIONARY_TRADER_PAIRS.map((cfg: any) => cfg.pair);
          
          if (safeBotId === "mage") {
            pairs = pairs.filter((p: string) => PairConfigManager.getMageConfigs(p)?.length > 0);
          } else if (safeBotId === "sage") {
             pairs = pairs.filter((p: string) => PairConfigManager.getSageConfigs(p)?.length > 0);
          } else if (safeBotId === "seer") {
             pairs = pairs.filter((p: string) => PairConfigManager.getSeerConfigs(p)?.length > 0);
          }

          const pairStates: Record<string, any> = {};
          pairs.forEach((p: string) => {
            const row = configMap.get(p);
            let enabled = true; // default
            if (row) {
              if (safeBotId === "mage") enabled = row.mage_enabled !== 0;
              else if (safeBotId === "sage") enabled = row.sage_enabled !== 0;
              else if (safeBotId === "seer") enabled = row.seer_enabled !== 0;
            }
            pairStates[p] = {
              enabled,
              riskPct: botRisks[safeBotId] || 1,
              hasActiveTrade: false,
              hasLimitOrder: false,
              activeTradesList: []
            };
          });

          socket.emit("discretionary_trader:status", {
            botId: safeBotId,
            running: false,
            pairs,
            pairStates,
            activeBots: [],
            botRisks,
            lastUpdated: new Date().toISOString(),
          });
        }
      } catch (e: any) {
        // Non-fatal — client will receive status on next broadcast
      }
    });

    // ── DISCRETIONARY_TRADER LIVE ORCHESTRATOR EVENTS ────────────────────────────────────
    socket.on(
      "discretionary_trader:toggle_bot",
      async (data: { profileId: number; botId: string; active: boolean }) => {
        try {
          if (
            !data?.profileId ||
            !(await verifyProfileOwnership(socket, data.profileId))
          ) {
            socket.emit("discretionary_trader:error", {
              message: "Unauthorized",
            });
            return;
          }

          const { LiveOrchestrator } =
            await import("../trading/index.js");
          const { TickFeed } = await import("../trading/index.js");
          const db2 = (await import("./db.js")).default;

          let orch = LiveOrchestrator.getInstance(data.profileId);
          let feed = TickFeed.getInstance(data.profileId);

          if (data.active) {
            if (!orch) {
              const profile = (await db2
                .prepare(
                  `SELECT tp.id, u.metaapi_token, tp.metaapi_account_id
               FROM trading_profiles tp
               JOIN users u ON u.id = tp.user_id
               WHERE tp.id = ?`,
                )
                .get(data.profileId)) as any;
              if (!profile) {
                socket.emit("discretionary_trader:error", {
                  message: "Profile not found",
                });
                return;
              }

              // 🛡️ FIX: Re-check if orchestrator was created concurrently while we were fetching DB
              orch = LiveOrchestrator.getInstance(data.profileId);

              const { decrypt, isEncrypted } = await import("./crypto.js");
              const { getSharedConnection } = await import("../trading/broker/metaApiHandler.js");
              const tokenToUse = isEncrypted(profile.metaapi_token)
                ? decrypt(profile.metaapi_token)
                : profile.metaapi_token;

              if (!orch) {

                orch = await LiveOrchestrator.create(
                  data.profileId,
                  tokenToUse,
                  profile.metaapi_account_id,
                );
                orch.toggleBot(data.botId, true);
                // 🛡️ FIX: await start() so hydration fully completes before TickFeed begins
                // subscribing. This prevents the race condition where daily pairs get
                // subscribed before the warmup gate (warmedUp=true) is set.
                await orch.start();
              } else {
                orch.toggleBot(data.botId, true);
              }

              feed = TickFeed.create(
                data.profileId,
                tokenToUse,
                profile.metaapi_account_id,
              );
              feed.start().catch((err) => {
                console.error("[Socket] TickFeed failed to start:", err);
                socket.emit("discretionary_trader:error", {
                  message: `Failed to connect to MetaAPI: ${err.message}`,
                });
                if (orch) orch.stop();
                if (feed) feed.stop();
              });

              startProfileBalanceInterval(data.profileId, tokenToUse, profile.metaapi_account_id);

              // ✅ Emit started so frontend re-syncs with full DB-loaded state
              io?.to(`profile_${data.profileId}`).emit(
                "discretionary_trader:started",
                { botId: data.botId },
              );
              // Broadcast correct per-bot status (pass botId so enabled states are bot-specific)
              io?.to(`profile_${data.profileId}`).emit(
                "discretionary_trader:status",
                orch.getStatus(data.botId),
              );
            } else {
              orch.toggleBot(data.botId, true);
            }
            // ✅ Persist active bots to DB so Docker restarts can auto-resume
            {
              const currentBots = Array.from(orch.activeBots);
              const hasSeer = currentBots.includes("seer");
              await db2.prepare(
                "UPDATE trading_profiles SET active_bots = ?, ai_sniper_active = ? WHERE id = ?"
              ).run(JSON.stringify(currentBots), hasSeer ? 1 : 0, data.profileId);
            }
            io?.to(`profile_${data.profileId}`).emit(
              "discretionary_trader:status",
              orch.getStatus(data.botId),
            );
          } else {
            if (orch) {
              orch.toggleBot(data.botId, false);
              // ✅ Persist updated (smaller) active_bots list to DB
              {
                const currentBots = Array.from(orch.activeBots);
                const hasSeer = currentBots.includes("seer");
                await db2.prepare(
                  "UPDATE trading_profiles SET active_bots = ?, ai_sniper_active = ? WHERE id = ?"
                ).run(JSON.stringify(currentBots), hasSeer ? 1 : 0, data.profileId);
              }
              if (orch.activeBots.size === 0) {
                orch.stop();
                if (feed) feed.stop();

                const interval = discBalanceIntervals.get(data.profileId);
                if (interval) {
                  clearInterval(interval);
                  discBalanceIntervals.delete(data.profileId);
                }

                io?.to(`profile_${data.profileId}`).emit(
                  "discretionary_trader:stopped",
                  { message: "DiscretionaryTrader stopped" },
                );
              }
              io?.to(`profile_${data.profileId}`).emit(
                "discretionary_trader:status",
                orch.getStatus(data.botId),
              );
            }
          }
        } catch (err: any) {
          console.error("[Socket] discretionary_trader:toggle_bot error:", err);
          socket.emit("discretionary_trader:error", {
            message: err.message || "Failed to toggle bot",
          });
          const { LiveOrchestrator } =
            await import("../trading/index.js");
          const orch = LiveOrchestrator.getInstance(data.profileId);
          io?.to(`profile_${data.profileId}`).emit(
            "discretionary_trader:status",
            orch ? orch.getStatus(data.botId) : { activeBots: [], botId: data.botId },
          );
        }
      },
    );

    socket.on(
      "discretionary_trader:get_status",
      async (data: { profileId: number; botId?: string }) => {
        if (!(await verifyProfileOwnership(socket, data.profileId))) return;
        const { LiveOrchestrator } =
          await import("../trading/index.js");
        const orch = LiveOrchestrator.getInstance(data.profileId);
        if (orch) {
          orch.broadcastStatus(data.botId);
        }
        const cachedMetrics = getCachedBrokerMetrics(data.profileId);
        if (cachedMetrics) {
          socket.emit("discretionary_trader:broker_metrics_update", cachedMetrics);
        }
        if (!orch) {
          // Bot is offline — still send persisted bot_risks so UI slider is correct
          const profileRow = (await getCachedBotRisks(data.profileId)) as any;
          const botRisks = (() => {
            try {
              return JSON.parse(profileRow?.bot_risks || "{}");
            } catch {
              return {};
            }
          })();
          
          // Reconstruct offline pair states
          const { DISCRETIONARY_TRADER_PAIRS } = await import("../trading/engine/LiveOrchestrator.js");
          const { PairConfigManager } = await import("../trading/config/PairConfig.js");
          const dbRows = await getCachedPairConfigs(data.profileId);
          const configMap = new Map();
          for (const r of dbRows) configMap.set(r.pair, r);

          const safeBotId = data.botId || "seer";
          let pairs = DISCRETIONARY_TRADER_PAIRS.map((cfg: any) => cfg.pair);
          
          if (safeBotId === "mage") {
            pairs = pairs.filter((p: string) => PairConfigManager.getMageConfigs(p)?.length > 0);
          } else if (safeBotId === "sage") {
             pairs = pairs.filter((p: string) => PairConfigManager.getSageConfigs(p)?.length > 0);
          } else if (safeBotId === "seer") {
             pairs = pairs.filter((p: string) => PairConfigManager.getSeerConfigs(p)?.length > 0);
          }

          const pairStates: Record<string, any> = {};
          pairs.forEach((p: string) => {
            const row = configMap.get(p);
            let enabled = true; // default
            if (row) {
              if (safeBotId === "mage") enabled = row.mage_enabled !== 0;
              else if (safeBotId === "sage") enabled = row.sage_enabled !== 0;
              else if (safeBotId === "seer") enabled = row.seer_enabled !== 0;
            }
            pairStates[p] = {
              enabled,
              riskPct: botRisks[safeBotId] || 1,
              hasActiveTrade: false,
              hasLimitOrder: false,
              activeTradesList: []
            };
          });

          socket.emit("discretionary_trader:status", {
            botId: safeBotId,
            running: false,
            pairs,
            pairStates,
            activeBots: [],
            botRisks,
            lastUpdated: new Date().toISOString(),
          });
        }
      },
    );

    // ── DiscretionaryTrader Per-pair Configs ──────────────────────────────────────────
    socket.on(
      "discretionary_trader:toggle_pair",
      async (data: {
        pair: string;
        enabled: boolean;
        profileId: number;
        botId?: string;
      }) => {
        if (
          !data?.profileId ||
          !(await verifyProfileOwnership(socket, data.profileId))
        )
          return;
        try {
          const { LiveOrchestrator } =
            await import("../trading/index.js");
          const botCol =
            data.botId === "sage"
              ? "sage_enabled"
              : data.botId === "seer"
                ? "seer_enabled"
                : data.botId === "mage"
                  ? "mage_enabled"
                  : "discretionary_trader_enabled";

          const orch = LiveOrchestrator.getInstance(data.profileId);
          if (orch) orch.togglePair(data.pair, data.enabled, data.botId);

          const db2 = (await import("./db.js")).default;
          // On INSERT: all bot columns default to 1 (enabled). Only the specific botCol is set.
          // ON CONFLICT: only update the specific bot column — never touch the other bots' states.
          await db2
            .prepare(
              `
            INSERT INTO profile_pair_configs
              (profile_id, pair, discretionary_trader_enabled, seer_enabled, mage_enabled, sage_enabled)
            VALUES (?, ?, 1, 1, 1, 1)
            ON CONFLICT(profile_id, pair) DO UPDATE SET ${botCol} = ?
          `,
            )
            .run(data.profileId, data.pair, data.enabled ? 1 : 0);
        } catch (err: any) {
          socket.emit("discretionary_trader:error", {
            message: `Toggle failed: ${err.message}`,
          });
        }
      },
    );

    // ── DiscretionaryTrader Per-pair Risk Config ──────────────────────────────
    socket.on(
      "discretionary_trader:set_pair_risk",
      async (data: {
        pair: string;
        riskPct: number;
        profileId: number;
        botId?: string;
      }) => {
        if (
          !data?.profileId ||
          !(await verifyProfileOwnership(socket, data.profileId))
        )
          return;
        try {
          const { LiveOrchestrator } =
            await import("../trading/index.js");
          const botRiskCol =
            data.botId === "sage"
              ? "sage_risk"
              : data.botId === "seer"
                ? "seer_risk"
                : data.botId === "mage"
                  ? "mage_risk"
                  : "discretionary_trader_risk";

          const orch = LiveOrchestrator.getInstance(data.profileId);
          if (orch) orch.setPairRisk(data.pair, data.riskPct, data.botId);

          const db2 = (await import("./db.js")).default;
          await db2
            .prepare(
              `
            INSERT INTO profile_pair_configs
              (profile_id, pair, discretionary_trader_enabled, seer_enabled, mage_enabled, sage_enabled, ${botRiskCol})
            VALUES (?, ?, 1, 1, 1, 1, ?)
            ON CONFLICT(profile_id, pair) DO UPDATE SET ${botRiskCol} = ?
          `,
            )
            .run(data.profileId, data.pair, data.riskPct, data.riskPct);
        } catch (err: any) {
          socket.emit("discretionary_trader:error", {
            message: `Set pair risk failed: ${err.message}`,
          });
        }
      },
    );

    // ── Global Bot Risk (replaces per-pair risk) ──────────────────────────────
    // Payload: { profileId, botId: 'seer'|'mage', riskPct: number }
    socket.on(
      "discretionary_trader:set_bot_risk",
      async (data: { profileId: number; botId: string; riskPct: number }) => {
        if (
          !data?.profileId ||
          !(await verifyProfileOwnership(socket, data.profileId))
        )
          return;
        try {
          const { LiveOrchestrator } =
            await import("../trading/index.js");
          const db2 = (await import("./db.js")).default;

          const orch = LiveOrchestrator.getInstance(data.profileId);
          if (orch) orch.setBotRisk(data.botId, data.riskPct);

          // Persist bot-level risk into the bot_risks JSON column on trading_profiles
          const row = (await getCachedBotRisks(data.profileId)) as any;
          const existing = (() => {
            try {
              return JSON.parse(row?.bot_risks || "{}");
            } catch {
              return {};
            }
          })();
          existing[data.botId] = data.riskPct;
          await db2
            .prepare("UPDATE trading_profiles SET bot_risks = ? WHERE id = ?")
            .run(JSON.stringify(existing), data.profileId);

          // Confirm back to the room
          const orchNow = LiveOrchestrator.getInstance(data.profileId);
          if (orchNow)
            io?.to(`profile_${data.profileId}`).emit(
              "discretionary_trader:status",
              orchNow.getStatus(data.botId),
            );
        } catch (err: any) {
          socket.emit("discretionary_trader:error", {
            message: `Risk update failed: ${err.message}`,
          });
        }
      },
    );

    socket.on("ping", () => {
      socket.emit("pong");
    });

    socket.on("disconnect", () => {
      if ((socket as any).joinedProfiles) {
        for (const pId of (socket as any).joinedProfiles) {
          const roomName = `profile_${pId}`;
          const roomClients = io?.sockets.adapter.rooms.get(roomName);
          if (!roomClients || roomClients.size === 0) {
            const discInterval = discBalanceIntervals.get(pId);
            if (discInterval) {
              clearInterval(discInterval);
              discBalanceIntervals.delete(pId);
            }
          }
        }
      }
    });
  });

  return io;
}

// ── AUTO-RESUME on server restart ─────────────────────────────────────────────
// Reads `active_bots` from the DB and restarts the LiveOrchestrator + TickFeed
// for every profile that had bots running when the server last shut down.
// This means Docker restarts no longer need manual UI intervention.
export async function resumePersistedBots(): Promise<void> {
  try {
    const db2 = (await import("./db.js")).default;
    const { LiveOrchestrator } = await import("../trading/index.js");
    const { TickFeed } = await import("../trading/index.js");
    const { decrypt, isEncrypted } = await import("./crypto.js");

    const { registerProfileName } = await import("../utils/logger.js");

    // Fetch all profiles that have persisted active bots, including all
    // institutional filter state so it can be restored immediately on resume.
    const profiles = await db2
      .prepare(
        `SELECT tp.id, tp.profile_name, tp.active_bots,
                u.metaapi_token, tp.metaapi_account_id,
                tp.risk_multiplier, tp.base_risk_balance, tp.broker_symbol_map,
                tp.dwcb_enabled, tp.dwcb_peak_balance,
                tp.institutional_enabled,
                tp.institutional_daily_cap,
                tp.institutional_peak_to_draw,
                tp.institutional_daily_start_balance,
                tp.institutional_daily_date,
                tp.institutional_peak_balance
         FROM trading_profiles tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.active_bots IS NOT NULL AND tp.active_bots != '[]'`
      )
      .all();

    if (!profiles || profiles.length === 0) {
      console.log("[AutoResume] No persisted active bots found. Starting fresh.");
      return;
    }

    await Promise.allSettled(
      (profiles as any[]).map(async (profile) => {
        if (profile.profile_name) {
          registerProfileName(Number(profile.id), profile.profile_name);
        }
        let activeBots: string[] = [];
        try {
          activeBots = JSON.parse(profile.active_bots || "[]");
        } catch {
          activeBots = [];
        }
        if (activeBots.length === 0) return;

        console.log(`[AutoResume] 🔄 Resuming bots [${activeBots.join(", ")}] for profile ${profile.profile_name || profile.id}...`);

        try {
          const tokenToUse = isEncrypted(profile.metaapi_token)
            ? decrypt(profile.metaapi_token)
            : profile.metaapi_token;

          const orch = await LiveOrchestrator.create(
            profile.id,
            tokenToUse,
            profile.metaapi_account_id,
          );

          // ─── INSTITUTIONAL STATE RESTORATION ───────────────────────────────
          // Seed the orchestrator's cachedProfile with the full DB institutional
          // state so engines don't cold-start without daily cap / peak balance
          // context. Without this, the first trade after a restart would reset
          // the daily start balance to the current equity (losing the day's P&L
          // reference), or silently bypass the peak-to-draw guard.
          orch.cachedProfile = {
            risk_multiplier: profile.risk_multiplier,
            base_risk_balance: profile.base_risk_balance,
            broker_symbol_map: profile.broker_symbol_map,
            dwcb_enabled: profile.dwcb_enabled,
            dwcb_peak_balance: profile.dwcb_peak_balance,
            institutional_enabled: profile.institutional_enabled,
            institutional_daily_cap: profile.institutional_daily_cap,
            institutional_peak_to_draw: profile.institutional_peak_to_draw,
            institutional_daily_start_balance: profile.institutional_daily_start_balance,
            institutional_daily_date: profile.institutional_daily_date,
            institutional_peak_balance: profile.institutional_peak_balance,
            // token / account fields needed by engine helpers
            metaapi_token: profile.metaapi_token,
            metaapi_account_id: profile.metaapi_account_id,
          };

          console.log(
            `[AutoResume] 🏦 Institutional state restored for profile ${profile.id}:` +
            ` enabled=${profile.institutional_enabled}` +
            ` dailyCap=${profile.institutional_daily_cap}%` +
            ` peakToDraw=${profile.institutional_peak_to_draw}%` +
            ` dailyStart=$${profile.institutional_daily_start_balance}` +
            ` dailyDate=${profile.institutional_daily_date}` +
            ` instPeak=$${profile.institutional_peak_balance}`
          );

          // Re-enable each persisted bot
          for (const botId of activeBots) {
            orch.toggleBot(botId, true);
          }

          await orch.start();

          const feed = TickFeed.create(profile.id, tokenToUse, profile.metaapi_account_id);
          feed.start().catch((err: any) => {
            console.error(`[AutoResume] TickFeed failed for profile ${profile.id}:`, err.message);
            orch.stop();
            feed.stop();
          });

          startProfileBalanceInterval(Number(profile.id), tokenToUse, profile.metaapi_account_id);

          // ─── FLIP automation_active = 1 ────────────────────────────────────
          // Reflects the true running state in the DB/UI. This was previously
          // stale-false after restarts because the resume path never wrote it.
          await db2
            .prepare("UPDATE trading_profiles SET automation_active = 1 WHERE id = ?")
            .run(profile.id);

          console.log(`[AutoResume] ✅ Profile ${profile.id} bots [${activeBots.join(", ")}] resumed successfully.`);
        } catch (err: any) {
          console.error(`[AutoResume] ❌ Failed to resume profile ${profile.id}:`, err.message);
        }
      })
    );
  } catch (err: any) {
    console.error("[AutoResume] Fatal error during bot resumption:", err.message);
  }
}


export function getIO(): SocketIOServer | null {
  if (!io) {
    if (
      process.env.SIMULATION_MODE === "true" ||
      process.env.NODE_ENV === "test" ||
      (global as any).isSimulator === true
    )
      return null;
    throw new Error(
      "Socket.io has not been initialized. Call initSocket first.",
    );
  }
  return io;
}

// Helper functions for easy broadcasting
export function broadcastTradeOpened(profileId: number, trade: any) {
  if (!io) return;
  io.to(`profile_${profileId}`).emit("trade_opened", trade);
}

export function broadcastTradeClosed(profileId: number, trade: any) {
  if (!io) return;
  io.to(`profile_${profileId}`).emit("trade_closed", trade);
}

export function broadcastEngineStatus(status: any) {
  if (!io) return;
  io.emit("engine_status_update", status);
}

export function broadcastNewsUpdate(news: any) {
  if (!io) return;
  io.emit("news_update", news);
}

