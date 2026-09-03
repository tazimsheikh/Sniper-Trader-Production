// ─────────────────────────────────────────────────────────────────────────────
// DiscretionaryTrader TICK FEED
//
// Bridges the MetaAPI Streaming Connection → LiveOrchestrator.onM1Tick()
//
// How it works:
//   1. Attaches a SynchronizationListener to the existing shared streaming
//      connection (no second connection needed — reuses the one PatternHunter uses)
//   2. Listens to `onSymbolPriceUpdated` events at tick-level (~1–5 updates/sec)
//   3. Builds M1 candles in-memory from the tick stream
//   4. On each M1 close, calls orchestrator.onM1Tick(symbol, O,H,L,C,V, ts)
//
// Design decisions:
//   • Pure listener — does NOT open trades, zero side-effects on its own
//   • Reuses the streamingConnectionCache from metaApiHandler so there's exactly
//     ONE websocket connection to the broker at all times
//   • Subscribes to ALL DiscretionaryTrader pairs on start, unsubscribes cleanly on stop
//   • Falls back to polling if streaming is unavailable (demo accounts often lack
//     real-time tick feeds — polling M1 from MetaAPI REST works just as well)
// ─────────────────────────────────────────────────────────────────────────────

import { PairConfigManager } from "../config/PairConfig.js";
import { createHash } from "crypto";
import db from "../../core/db.js";
import { logger, profileContext } from "../../utils/logger.js";
import {
  safeDecryptAccountId,
  getSharedStreamingConnection,
  getCachedStreamingConnectionSync,
  getSharedAccount,
  getSharedConnection,
  BROKER_SYMBOL_MAP,
} from "../broker/metaApiHandler.js";
import { LiveOrchestrator, getFixedEstDate } from "./LiveOrchestrator.js";
import { DISCRETIONARY_TRADER_PAIRS as SP } from "../index.js";



const DiscretionaryTrader_PAIRS = [
  "AUDJPY", "AUDUSD", "BTCUSD", "CADJPY", "CHFJPY",
  "ETHUSD", "EURAUD", "EURCAD", "EURJPY", "EURNZD",
  "EURUSD", "GBPAUD", "GBPCAD", "GBPJPY", "GBPNZD",
  "GBPUSD", "GER40", "JPN225", "NAS100", "NZDUSD",
  "SPX500", "US30", "USDCAD", "USDCHF", "USDJPY",
  "XAUUSD", "XTIUSD"
];

// ── In-memory M1 accumulator per symbol ──────────────────────────────────────
import type { M1Acc } from "../config/types.js";

// ── Multiple Feed Instances ────────────────────────────────────────────────────

export class TickFeed {
  public readonly profileId: number;
  private token: string;
  private accountId: string;
  private listener: any = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private m1State = new Map<string, M1Acc>();
  private running = false;
  private baseToBrokerMap = new Map<string, string>();
  private brokerToBaseMap = new Map<string, string>();
  private lastTickTime = Date.now();
  private lastReconnectAttempt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastClosedM1Minute = new Map<string, number>();

  constructor(profileId: number, token: string, accountId: string) {
    this.profileId = profileId;
    this.token = token;
    this.accountId = safeDecryptAccountId(accountId);
  }

  private static instances = new Map<number, TickFeed>();

  static getInstance(profileId: number): TickFeed | null {
    return TickFeed.instances.get(profileId) || null;
  }

  static create(profileId: number, token: string, accountId: string): TickFeed {
    let existing = TickFeed.instances.get(profileId);
    if (existing) existing.stop();
    const newFeed = new TickFeed(profileId, token, accountId);
    TickFeed.instances.set(profileId, newFeed);
    return newFeed;
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  async start() {
    if (this.running) return;
    this.running = true;
    this.lastTickTime = Date.now();
    logger.info(`[TickFeed] 🔱 Starting tick feed for ${DiscretionaryTrader_PAIRS.length} pairs...`,);

    this.startHeartbeatTimer();

    try {
      await this.attachStreamingListener();
    } catch (err: any) {
      logger.warn(`[TickFeed] ⚠️  Streaming unavailable (${err.message}). Falling back to 1-min REST poll.`,);
      this.startPollingFallback();
    }
  }

  // ── Stop ──────────────────────────────────────────────────────────────────
  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.listener) {
      // Remove listener from connection if possible
      try {
        const conn = this.getCachedStreamingConn();
        if (conn && typeof conn.removeSynchronizationListener === "function") {
          conn.removeSynchronizationListener(this.listener);
        }
      } catch (_) {}
      this.listener = null;
    }
    logger.info(`[TickFeed] 🔱 Tick feed for Profile ${this.profileId} stopped.`,);
    if (TickFeed.instances.get(this.profileId) === this) {
      TickFeed.instances.delete(this.profileId);
    }
  }

  // ── Attach streaming listener ─────────────────────────────────────────────
  private async attachStreamingListener() {
    // Try to get a streaming connection (non-background — wait for sync)
    let conn: any;
    try {
      conn = await getSharedStreamingConnection(
        this.token,
        this.accountId,
        false,
      );
    } catch (err: any) {
      // If fast-fail, try waiting briefly then retrying
      if (err.message.includes("Fast fail")) {
        await new Promise((r) => setTimeout(r, 5000));
        conn = await getSharedStreamingConnection(
          this.token,
          this.accountId,
          false,
        );
      } else {
        throw err;
      }
    }

    // Ensure streaming connection is synchronized so terminalState has symbol specifications
    if (conn && !conn.synchronized) {
      try {
        logger.info(`[TickFeed] Streaming connection synchronizing for profile ${this.profileId}...`);
        const waitPromise = conn.waitSynchronized();
        waitPromise.catch(() => {});
        await Promise.race([
          waitPromise,
          new Promise((_, r) => setTimeout(() => r(new Error("waitSynchronized timeout (20s)")), 20000)),
        ]);
      } catch (syncErr: any) {
        logger.warn(`[TickFeed] Initial sync wait ended: ${syncErr.message}. Continuing with symbol resolution.`);
      }
    }

    // ── Use broker_symbol_map from the DB ───────────────────────────
    this.baseToBrokerMap.clear();
    this.brokerToBaseMap.clear();

    let customMap: Record<string, string> = {};
    try {
      const profile = await db
        .prepare("SELECT broker_symbol_map FROM trading_profiles WHERE id = ?")
        .get(this.profileId) as any;
      if (profile && profile.broker_symbol_map) {
        customMap = JSON.parse(profile.broker_symbol_map);
      }
      for (const base of DiscretionaryTrader_PAIRS) {
        const brokerSym = customMap[base] || base;
        this.baseToBrokerMap.set(base, brokerSym);
        this.brokerToBaseMap.set(brokerSym, base);
      }
    } catch (e: any) {
      logger.error(`[TickFeed] Error fetching broker_symbol_map:`, e.message);
      // Fallback: 1-to-1 map
      for (const base of DiscretionaryTrader_PAIRS) {
        this.baseToBrokerMap.set(base, base);
        this.brokerToBaseMap.set(base, base);
      }
    }

    const SUFFIX_CANDIDATES = ['', '.m', '.a', '.ecn', '.pro', '.raw', '.p', 'c', 'x', '_m', '.cash', '.Daily', '.std', '.s', '.stp', '+', '#', '_', '.r', '.i', '-', '.sb', 'm', 'pro', 'raw'];
    const INDEX_ALIASES: Record<string, string[]> = {
      GER40: ["GER40", "DAX40", "DE40", "GER30", "DE30", "GDAXI", "DAX", "DAX30", ".DE40", ".GER40"],
      US30: ["US30", "DJ30", "WS30", "DOW30", "DOWJONES", ".US30"],
      NAS100: ["NAS100", "US100", "USTEC", "NDX", "NDX100", "NQ100", ".NAS100"],
      SPX500: ["SPX500", "US500", "SP500", "SPX", ".SPX500"],
      JPN225: ["JPN225", "JP225", "NIKKEI225", ".JPN225"],
      UK100: ["UK100", "FTSE100", ".UK100"],
      XAUUSD: ["XAUUSD", "GOLD"],
      XTIUSD: ["XTIUSD", "USOIL", "WTI", "OIL"],
      BTCUSD: ["BTCUSD", "BITCOIN"],
      ETHUSD: ["ETHUSD", "ETHEREUM"],
    };

    function getFallbackCandidates(baseSym: string): string[] {
      const clean = PairConfigManager.getBaseSymbol(baseSym);
      const aliases = INDEX_ALIASES[clean] || INDEX_ALIASES[baseSym] || [clean];
      const results: string[] = [];
      for (const alias of aliases) {
        for (const suff of SUFFIX_CANDIDATES) {
          const cand = `${alias}${suff}`;
          if (!results.includes(cand)) results.push(cand);
        }
      }
      return results;
    }

    let mapUpdated = false;
    let cachedBrokerSymbols: string[] = [];

    const getBrokerSymbolsList = async (): Promise<string[]> => {
      if (cachedBrokerSymbols.length > 0) return cachedBrokerSymbols;
      
      // 1. Check local terminalState in-memory specifications (0 CPU credits, instant)
      try {
        const specs = conn?.terminalState?.specifications;
        if (Array.isArray(specs) && specs.length > 0) {
          cachedBrokerSymbols = specs.map((s: any) => s.symbol).filter(Boolean);
          logger.info(`[TickFeed] ✅ Loaded ${cachedBrokerSymbols.length} broker symbols from local terminalState memory.`);
          return cachedBrokerSymbols;
        }
      } catch (err: any) {
        // terminalState not yet filled
      }

      // 2. Query broker getSymbols() once as fallback
      try {
        let symbolsRaw: any[] = [];
        if (typeof (conn as any).getSymbols === 'function') {
          symbolsRaw = await (conn as any).getSymbols();
        } else {
          const rpcConn = await getSharedConnection(this.token, this.accountId, true);
          if (rpcConn && typeof rpcConn.getSymbols === 'function') {
            symbolsRaw = await rpcConn.getSymbols();
          }
        }
        cachedBrokerSymbols = (symbolsRaw || []).map((s: any) => typeof s === 'string' ? s : s.symbol).filter(Boolean);
        if (cachedBrokerSymbols.length > 0) {
          logger.info(`[TickFeed] ✅ Loaded ${cachedBrokerSymbols.length} broker symbols via getSymbols().`);
        }
        return cachedBrokerSymbols;
      } catch (err: any) {
        logger.warn(`[TickFeed] Dynamic getSymbols discovery skipped: ${err.message}`);
        return [];
      }
    };

    const brokerSymbols = await getBrokerSymbolsList();
    const brokerSymbolsSet = new Set<string>(brokerSymbols);

    for (const [base, brokerSym] of this.baseToBrokerMap.entries()) {
      let subscribed = false;
      let targetSym = brokerSym;

      // If we have the broker symbol list and brokerSym doesn't exist in it, resolve match first in-memory
      if (brokerSymbolsSet.size > 0 && !brokerSymbolsSet.has(brokerSym)) {
        const cleanBase = PairConfigManager.getBaseSymbol(base);
        const fallbacks = getFallbackCandidates(base);
        const inMemoryMatch = fallbacks.find((c) => brokerSymbolsSet.has(c));
        if (inMemoryMatch) {
          targetSym = inMemoryMatch;
        } else {
          const patternMap: Record<string, RegExp> = {
            GER40: /^(GER|DAX|DE|GDAXI)[34]?0?/i,
            US30: /^(US|DJ|WS|DOW)[34]?0?/i,
            NAS100: /^(NAS|US100|USTEC|NDX|NQ)/i,
            SPX500: /^(US500|SP500|SPX|S&P)/i,
            JPN225: /^(JPN|JP|NIKKEI)225/i,
            UK100: /^(UK|FTSE)100/i,
            XAUUSD: /^(XAUUSD|GOLD)/i,
            XTIUSD: /^(XTIUSD|USOIL|WTI|OIL)/i,
            BTCUSD: /^(BTCUSD|BITCOIN)/i,
            ETHUSD: /^(ETHUSD|ETHEREUM)/i,
          };
          const pat = patternMap[cleanBase] || patternMap[base] || 
            (cleanBase.length === 6 ? new RegExp(`^${cleanBase}[^a-zA-Z0-9]?.*$`, 'i') : null);
          if (pat) {
            const match = brokerSymbols.find((s: string) => pat.test(s));
            if (match) targetSym = match;
          }
        }
      }

      try {
        await conn.subscribeToMarketData(targetSym);
        logger.info(`[TickFeed] Subscribed to market data for ${targetSym} (base: ${base})`);
        subscribed = true;
        if (targetSym !== brokerSym) {
          this.baseToBrokerMap.set(base, targetSym);
          this.brokerToBaseMap.set(targetSym, base);
          customMap[base] = targetSym;
          mapUpdated = true;
        }
      } catch (e: any) {
        logger.warn(`[TickFeed] Primary subscribeToMarketData failed for ${targetSym} (${base}): ${e.message}`);
      }

      // If initial subscription failed and brokerSymbolsSet was empty, try top 5 fallbacks
      if (!subscribed && brokerSymbolsSet.size === 0) {
        const fallbacks = getFallbackCandidates(base).slice(0, 6);
        for (const candidate of fallbacks) {
          if (candidate === targetSym) continue;
          try {
            await conn.subscribeToMarketData(candidate);
            logger.info(`[TickFeed] ✅ Successfully auto-recovered symbol mapping for ${base} -> ${candidate}`);
            this.baseToBrokerMap.set(base, candidate);
            this.brokerToBaseMap.set(candidate, base);
            customMap[base] = candidate;
            mapUpdated = true;
            subscribed = true;
            break;
          } catch {
            // Try next candidate
          }
        }
      }

      if (!subscribed) {
        logger.error(`[TickFeed] ❌ Subscription failed for ${base} (attempted ${targetSym})`);
      }
    }

    if (mapUpdated) {
      try {
        await db.prepare("UPDATE trading_profiles SET broker_symbol_map = ? WHERE id = ?")
          .run(JSON.stringify(customMap), this.profileId);
        logger.info(`[TickFeed] Persisted updated broker_symbol_map to database for profile ${this.profileId}`);
      } catch (err: any) {
        logger.error(`[TickFeed] Failed to persist updated broker_symbol_map:`, err.message);
      }
    }

    // Build a MetaAPI SynchronizationListener
    const feed = this;
    this.listener = {
      /**
       * Called on every price update (bid/ask tick).
       * We synthesise M1 bars from these ticks.
       */
      onSymbolPriceUpdated(_instanceIndex: string, price: any) {
        profileContext.run(feed.profileId, () => {
          if (!feed.running) return;
          feed.processTick(price);
        });
      },

      onSymbolPricesUpdated(_instanceIndex: string, prices: any[]) {
        profileContext.run(feed.profileId, () => {
          if (!feed.running) return;
          for (const p of prices) {
            feed.processTick(p);
          }
        });
      },

      onDisconnected(_instanceIndex: string) {
        profileContext.run(feed.profileId, () => {
          logger.info("[TickFeed] Streaming disconnected — switching to REST poll fallback.",);
          if (feed.running && !feed.pollTimer) feed.startPollingFallback();
        });
      },

      onConnected(_instanceIndex: string, _replicas: number) {
        profileContext.run(feed.profileId, () => {
          logger.info("[TickFeed] ✅ Streaming reconnected — stopping poll fallback.",);
          if (feed.pollTimer) {
            clearInterval(feed.pollTimer);
            feed.pollTimer = null;
          }

          const orch = LiveOrchestrator.getInstance(feed.profileId);
          if (orch) {
            for (const pair of DiscretionaryTrader_PAIRS) {
              orch.fillHistoryGaps(pair).catch((e) => {
                logger.error(`[TickFeed] Failed to fill gaps for ${pair}:`,
                  e.message,);
              });
            }
          }
        });
      },

      // MetaAPI SDK requires these methods to exist, otherwise it throws TypeErrors when trades happen
      onDealAdded() {},
      onPositionUpdated(_instanceIndex: string, position: any) {
        if (!feed.running) return;
        const orch = LiveOrchestrator.getInstance(feed.profileId);
        if (orch && typeof orch.handlePositionUpdate === 'function') {
          orch.handlePositionUpdate(position);
        }
      },
      onPositionRemoved(_instanceIndex: string, positionId: string) {
        if (!feed.running) return;
        const orch = LiveOrchestrator.getInstance(feed.profileId);
        if (orch && typeof orch.onBrokerPositionClosed === 'function') {
          orch.onBrokerPositionClosed(positionId);
        }
      },
      onHistoryOrderAdded() {},
      onOrderAdded() {},
      onOrderUpdated() {},
      onHistoryOrderUpdated() {},
      onMarginUpdated() {},
      onOrdersReplaced() {},
      onHistoryOrdersReplaced() {},
      onDealsReplaced() {},
      onInformation() {},
      onAccountInformationUpdated(_instanceIndex: string, accInfo: any) {
        if (!feed.running) return;
        const orch = LiveOrchestrator.getInstance(feed.profileId);
        if (orch) {
          orch.cachedEquity = accInfo.equity || accInfo.balance || orch.cachedEquity;
        }
      },

      // Initial synchronization events
      onSynchronizationStarted() {},
      onPositionsSynchronized() {},
      onStreamClosed() {},
      onPendingOrdersSynchronized() {},
      onHistoryOrdersSynchronized() {},
      onDealsSynchronized() {},

      // ── Ignored events ────────────────────────────────────────────────────────
      onSymbolSpecificationsUpdated() {},
      onSymbolSpecificationUpdated() {},
      onBrokerConnectionStatusChanged() {},
      onHealthStatus() {},
      onPositionsUpdated() {},
      onPendingOrdersUpdated() {},
      onPositionsReplaced() {},
      onPendingOrdersReplaced() {},
      onPendingOrderUpdated() {},
      onPendingOrderAdded() {},
      onPendingOrderRemoved() {},
      onPendingOrderCompleted() {},
      onDealUpdated() {},
      onPositionAdded() {},
      onOrderCompleted() {},
    };

    conn.addSynchronizationListener(this.listener);
    this.listenerConn = conn; // C-08 Fix: Store the exact connection we attached to
    logger.info(`[TickFeed] ✅ Streaming listener attached for ${DiscretionaryTrader_PAIRS.length} pairs.`,);
  }

  // ── REST Polling fallback (fires every 60s, fetches last M1 candle) ────────
  private startPollingFallback() {
    if (this.pollTimer) return;
    logger.info("[TickFeed] 📡 REST poll fallback started (60s interval)");

    this.pollTimer = setInterval(() => {
      profileContext.run(this.profileId, async () => {
        if (!this.running) return;
        const orch = LiveOrchestrator.getInstance(this.profileId);
        if (!orch || !orch.isRunning()) return;

      try {
        const conn = await getSharedStreamingConnection(
          this.token,
          this.accountId,
          true,
        ).catch(() => null);
        if (!conn) return;

        // Attempt to get last M1 candle via terminal state
        for (const pair of DiscretionaryTrader_PAIRS) {
          try {
            // terminalState.candles returns the in-memory cached candles
            const candles = conn.terminalState?.candles(pair, "1m") as
              any[] | undefined;
            if (!candles || candles.length === 0) continue;
            const last = candles[candles.length - 1];
            if (!last?.isClosed) continue;

            const ts = new Date(last.time).getTime();
            const periodMs = Math.floor(ts / 60_000) * 60_000;
            const lastClosed = this.lastClosedM1Minute.get(pair) ?? 0;

            if (periodMs > lastClosed) {
              this.lastClosedM1Minute.set(pair, periodMs);
              logger.verbose(`[TickFeed] ${pair} M1 closed (fallback) at ${new Date(periodMs).toISOString()} O:${last.open.toFixed(5)} H:${last.high.toFixed(5)} L:${last.low.toFixed(5)} C:${last.close.toFixed(5)}`);
              await orch.onM1Tick(
                pair,
                last.open,
                last.high,
                last.low,
                last.close,
                last.tickVolume || 1,
                periodMs,
              );
            }
          } catch (_) {}
        }
      } catch (err: any) {
        logger.error("[TickFeed] Poll error:", err.message);
      }
      });
    }, 60_000);
  }

  private getCachedStreamingConn(): any {
    return getCachedStreamingConnectionSync(this.token, this.accountId);
  }

  private processingQueue = new Map<string, Promise<void>>();
  private listenerConn: any = null;
  private isReconnecting = false;

  private processTick(p: any) {
    if (!this.running) return;
    let sym = p.symbol as string;
    
    let baseSym = this.brokerToBaseMap.get(sym);
    if (!baseSym) {
      let cleanSym = sym;
      if (cleanSym.endsWith("=X")) cleanSym = cleanSym.replace("=X", "");
      if (cleanSym === "GC=F") cleanSym = "XAUUSD";
      if (cleanSym === "CL=F") cleanSym = "XTIUSD";
      if (cleanSym === "NQ=F") cleanSym = "NAS100";

      baseSym = cleanSym
        .split(".")[0]
        .split("-")[0]
        .replace(/[^A-Z0-9]/g, "")
        .trim()
        .toUpperCase();
    }
    
    if (!DiscretionaryTrader_PAIRS.includes(baseSym)) return;

    // C-06 Fix: Queue tick processing sequentially per pair to prevent race conditions
    const prev = this.processingQueue.get(baseSym) || Promise.resolve();
    const next = prev
      .then(() => this.doProcessTick(p, baseSym))
      .catch((e) => logger.error(`[TickFeed] Tick queue error:`, e.message));
    this.processingQueue.set(baseSym, next);
  }

  private async doProcessTick(p: any, baseSym: string) {
    const orch = LiveOrchestrator.getInstance(this.profileId);
    if (!orch || !orch.isRunning()) return;

    this.lastTickTime = Date.now();

    const tickTime = p.time ? new Date(p.time).getTime() : Date.now();
    const mid = (p.bid + p.ask) / 2;
    const periodMs = Math.floor(tickTime / 60_000) * 60_000; // Floor to M1

    // Ignore ticks in or before the closed minute window
    const lastClosed = this.lastClosedM1Minute.get(baseSym) ?? 0;
    if (periodMs <= lastClosed) {
      return;
    }

    let acc = this.m1State.get(baseSym);
    if (!acc || periodMs !== acc.periodMs) {
      if (acc && acc.ticks > 0) {
        try {
          if (acc.periodMs > lastClosed) {
            this.lastClosedM1Minute.set(baseSym, acc.periodMs);
            logger.verbose(`[TickFeed] ${baseSym} M1 closed at ${new Date(acc.periodMs).toISOString()} O:${acc.open.toFixed(5)} H:${acc.high.toFixed(5)} L:${acc.low.toFixed(5)} C:${acc.close.toFixed(5)}`);
            await orch.onM1Tick(
              baseSym,
              acc.open,
              acc.high,
              acc.low,
              acc.close,
              acc.vol,
              acc.periodMs, // Use start-of-minute; +59_999 could push x:59 candles into wrong estHour
            );
          }
        } catch (e: any) {
          logger.error(`[TickFeed] onM1Tick error:`, e.message);
        }
      }
      acc = {
        periodMs,
        open: mid,
        high: mid,
        low: mid,
        close: mid,
        vol: 1,
        ticks: 1,
      };
      this.m1State.set(baseSym, acc);
    } else {
      acc.close = mid;
      if (mid > acc.high) acc.high = mid;
      if (mid < acc.low) acc.low = mid;
      acc.vol++;
      acc.ticks++;
    }
  }

  private startHeartbeatTimer() {
    this.heartbeatTimer = setInterval(() => {
      if (!this.running) return;

      const nowMs = Date.now();
      const currentPeriodMs = Math.floor(nowMs / 60_000) * 60_000;

      // ── 1. Staleness Heartbeat Check (Watchdog) ──
      const isMarketOpen = this.isMarketOpen();
      const isStale = nowMs - this.lastTickTime > 60_000;
      if (isStale && isMarketOpen) {
        if (!this.pollTimer) {
          logger.info(`[TickFeed] Staleness watchdog triggered: No ticks for 60s. Forcing REST polling fallback.`,);
          this.startPollingFallback();
        }
        
        // Attempt to reconnect the socket if it's dead, but throttle to once per 60s
        if (nowMs - this.lastReconnectAttempt > 60_000) {
          this.lastReconnectAttempt = nowMs;
          this.reconnectSocket();
        }
      }

      // ── 2. Timer-driven Candle Closing ──
      const orch = LiveOrchestrator.getInstance(this.profileId);
      if (!orch || !orch.isRunning()) return;

      for (const [baseSym, acc] of this.m1State.entries()) {
        if (acc && acc.ticks > 0 && currentPeriodMs > acc.periodMs) {
          try {
            const lastClosed = this.lastClosedM1Minute.get(baseSym) ?? 0;
            if (currentPeriodMs > lastClosed) {
              this.lastClosedM1Minute.set(baseSym, currentPeriodMs);
              logger.verbose(`[TickFeed] ${baseSym} M1 closed (timer) at ${new Date(acc.periodMs).toISOString()} O:${acc.open.toFixed(5)} H:${acc.high.toFixed(5)} L:${acc.low.toFixed(5)} C:${acc.close.toFixed(5)}`);
              orch
                .onM1Tick(
                  baseSym,
                  acc.open,
                  acc.high,
                  acc.low,
                  acc.close,
                  acc.vol,
                  acc.periodMs,
                )
                .catch((e) =>
                  logger.error(`[TickFeed] Timer onM1Tick error for ${baseSym}:`,
                    e.message,),
                );
            }
          } catch (e: any) {
            logger.error(`[TickFeed] Timer-driven close onM1Tick error:`,
              e.message,);
          }
          acc.ticks = 0;
        }
      }
    }, 5000);
  }

  private isMarketOpen(): boolean {
    const est = getFixedEstDate(new Date());
    const day = est.getUTCDay();
    const hour = est.getUTCHours();

    if (day === 6) return false;
    if (day === 5 && hour >= 17) return false;
    if (day === 0 && hour < 17) return false;
    return true;
  }

  private async reconnectSocket() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    logger.info(`[TickFeed] Attempting to reconnect streaming socket...`);
    try {
      if (this.listener && this.listenerConn) {
        if (
          typeof this.listenerConn.removeSynchronizationListener === "function"
        ) {
          this.listenerConn.removeSynchronizationListener(this.listener);
        }
        this.listener = null;
        this.listenerConn = null;
      }
      await this.attachStreamingListener();
    } catch (e: any) {
      logger.error(`[TickFeed] Streaming reconnection failed:`, e.message);
    } finally {
      this.isReconnecting = false;
    }
  }
}
