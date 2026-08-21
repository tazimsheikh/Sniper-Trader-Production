var __defProp = Object.defineProperty;
var __name = (target, value) =>
  __defProp(target, "name", { value, configurable: true });

import { logger, ProfileLogger, registerProfileName, profileContext } from "../../utils/logger.js";
import dbModule from "../../core/db.js";
import { addBotLog as dbAddBotLog } from "../../core/db.js";
import {
  loadCachedM5CandlesLocal,
  saveM5CandlesToCacheLocal,
  pruneOldM5CandlesLocal,
} from "../../core/candleDb.js";
const db: any = new Proxy({}, {
  get(_target, prop) {
    const activeDb = (global as any).__SIM_DB__ || dbModule;
    return activeDb[prop];
  }
});
const addBotLog = (...args: any[]) => (((global as any).__SIM_DB__ && typeof (global as any).__SIM_DB__.addBotLog === 'function') ? (global as any).__SIM_DB__.addBotLog : dbAddBotLog)(...args);
import { getIO as socketGetIO } from "../../core/socket.js";
const getIO = global.__SIM_SOCKET__ ? global.__SIM_SOCKET__.getIO : socketGetIO;
import { getSharedConnection as getSharedConnectionOrig, getSharedAccount as getSharedAccountOrig, getSymbolSpec as getSymbolSpecOrig, safeDecryptAccountId as safeDecryptAccountIdOrig, getBrokerSymbol as getBrokerSymbolOrig, clearSharedConnection as clearSharedConnectionOrig } from "../broker/metaApiHandler.js";
const getSharedConnection = global.__SIM_METAAPI__ ? global.__SIM_METAAPI__.getSharedConnection : getSharedConnectionOrig;
const getSharedAccount = global.__SIM_METAAPI__ ? global.__SIM_METAAPI__.getSharedAccount : getSharedAccountOrig;
const getSymbolSpec = global.__SIM_METAAPI__ ? global.__SIM_METAAPI__.getSymbolSpec : getSymbolSpecOrig;
const safeDecryptAccountId = global.__SIM_METAAPI__ ? global.__SIM_METAAPI__.safeDecryptAccountId : safeDecryptAccountIdOrig;
const getBrokerSymbol = global.__SIM_METAAPI__ ? global.__SIM_METAAPI__.getBrokerSymbol : getBrokerSymbolOrig;
const clearSharedConnection = global.__SIM_METAAPI__ ? global.__SIM_METAAPI__.clearSharedConnection : clearSharedConnectionOrig;
import { DailyContextTracker } from "../market/DailyContextTracker.js";
import { PromptVault } from "../ai/PromptVault.js";
import { VisionEvaluator } from "../ai/VisionEvaluator.js";
import { renderChart, getChartWindow } from "../ai/ChartRenderer.js";
import {
  MAGE_PAIR_CONFIG,
  SAGE_PAIR_CONFIG,
  SEER_PAIR_CONFIG,

  PairConfigManager,
} from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";
import { globalTradeGate as globalTradeGateOrig } from "../../utils/GlobalTradeGate.js";
const globalTradeGate = global.__SIM_TRADE_GATE__ || globalTradeGateOrig;
import {
  runMageBot,
  placeMageLimitOrder,
  evaluateMageTrailingOnTick,
  cancelMagePendingOnNews,
  checkMageLimitFill,
} from "./MageEngine.js";
import {
  runSeerBot,
  runPreFlightFilter,
  evaluateSeerTrailingOnTick,
} from "./SeerEngine.js";
import {
  runSageBot,
  placeSageLimitOrder,
  evaluateSageTrailingOnTick,
  checkSageLimitFill,
  cancelSagePendingOnNews,
} from "./SageEngine.js";

import { isTradeAllowed } from "../market/MathFilters.js";
import { enqueueMetaApiRequest as enqueueMetaApiRequestOrig } from "../../utils/MetaApiQueue.js";
const enqueueMetaApiRequest = global.__SIM_QUEUE__ ? global.__SIM_QUEUE__.enqueueMetaApiRequest : enqueueMetaApiRequestOrig;
import { isNewsBlackout as isNewsBlackoutOrig } from "../../news/newsStore.js";
const isNewsBlackout = global.__SIM_NEWS__ ? global.__SIM_NEWS__.isNewsBlackout : isNewsBlackoutOrig;
const FOREX_PAIRS = new Set([
  "EURUSD",
  "EURJPY",
  "EURAUD",
  "GBPUSD",
  "GBPJPY",
  "GBPAUD",
  "GBPCAD",
  "USDJPY",
  "AUDJPY",
  "EURNZD",
  "GBPNZD",
]);
export function getFixedEstDate(date = new Date()) {
  if ((global as any).__SIM_TIME_PROVIDER__) {
    return (global as any).__SIM_TIME_PROVIDER__(date);
  }

  // Explicitly calculate New York time (EST/EDT) to avoid ICU timezone data bugs on Linux VMs.
  // US DST starts: Second Sunday in March at 2:00 AM EST.
  // US DST ends: First Sunday in November at 2:00 AM EDT.
  
  const y = date.getUTCFullYear();
  
  // Find Second Sunday in March
  const marchFirst = new Date(Date.UTC(y, 2, 1));
  const daysToFirstSunday = (7 - marchFirst.getUTCDay()) % 7;
  const secondSundayMarch = new Date(Date.UTC(y, 2, 1 + daysToFirstSunday + 7, 7, 0, 0)); // 2:00 AM EST = 7:00 AM UTC
  
  // Find First Sunday in November
  const novFirst = new Date(Date.UTC(y, 10, 1));
  const daysToFirstSunNov = (7 - novFirst.getUTCDay()) % 7;
  const firstSundayNov = new Date(Date.UTC(y, 10, 1 + daysToFirstSunNov, 6, 0, 0)); // 2:00 AM EDT = 6:00 AM UTC
  
  const t = date.getTime();
  const isDST = t >= secondSundayMarch.getTime() && t < firstSundayNov.getTime();
  
  const offsetHours = isDST ? -4 : -5;
  
  // We want to return a Date object where getUTCHours() returns the NY local hour.
  // So we ADD the offset to the UTC time.
  return new Date(t + offsetHours * 60 * 60 * 1000);
}
__name(getFixedEstDate, "getFixedEstDate");
const _allPairKeys = new Set([
  ...Object.keys(MAGE_PAIR_CONFIG),
  ...Object.keys(SAGE_PAIR_CONFIG || {}),
  ...Object.keys(SEER_PAIR_CONFIG || {}),

]);
export const DISCRETIONARY_TRADER_PAIRS = Array.from(_allPairKeys).map((pair) => {
  return { pair, ...(PairConfigManager.getRepresentativeConfig(pair) || {}) };
});
export function isConnectionError(err) {
  const msg = (err.message || "").toUpperCase();
  return (
    msg.includes("OFFLINE") ||
    msg.includes("TIMEOUT") ||
    msg.includes("CONNECTION") ||
    msg.includes("DISCONNECT") ||
    msg.includes("NETWORK") ||
    msg.includes("SOCKET") ||
    msg.includes("RATE LIMIT") ||
    msg.includes("TOO MANY REQUESTS") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}
__name(isConnectionError, "isConnectionError");
export class LiveOrchestrator {
  static instances = new Map<string, LiveOrchestrator>();
  pendingPromises: Promise<any>[] = [];
  running: boolean;
  warmedUp: boolean;
  activeBots: Set<string>;
  botRisks: any;
  states: Map<string, any>;
  apiLockouts: Map<string, any>;
  lastChatterMs: Map<string, number>;
  recentEyeFeed: any[];
  profileId: string;
  token: string;
  accountId: string;
  customMap: any;
  evaluator: any;
  loggerInited?: boolean;
  cachedEquity: number = 0;
  plog: ProfileLogger;
  pendingHydration: Set<string>;

  constructor(profileId, token, accountId) {
    this.running = false;
    this.warmedUp = false;
    this.activeBots = new Set();
    this.botRisks = {};
    this.states = new Map();
    this.apiLockouts = new Map();
    this.lastChatterMs = new Map();
    this.recentEyeFeed = [];
    this.profileId = profileId;
    this.plog = new ProfileLogger(Number(profileId)); // temporary — name updated in start()
    this.token = token;
    this.accountId = safeDecryptAccountId(accountId);
    this.customMap = null;
    this.pendingHydration = new Set<string>();
    this.evaluator = new VisionEvaluator(
      process.env.GOOGLE_GENAI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GEMINI_API_KEY ||
        "",
    );
    
    DISCRETIONARY_TRADER_PAIRS.forEach((cfg) => {
      this.states.set(cfg.pair, {
        config: { ...cfg, pair: cfg.pair, risk: cfg.risk },
        botConfigs: new Map([
          ["seer", { enabled: true, risk: 1 }],
          ["mage", { enabled: true, risk: 1 }],
          ["sage", { enabled: true, risk: 1 }],
        ]),
        m5Buffer: [],
        dailyTracker: new DailyContextTracker(),
        isEvaluating: false,
        m1AccumOpen: 0,
        m1AccumHigh: 0,
        m1AccumLow: 0,
        m1AccumClose: 0,
        m1AccumVol: 0,
        m1AccumCount: 0,
        m1PeriodStart: 0,
        lastEstHour: -1,
        emaArr: [],
        riskPct: 1,
        lastProcessedM1Timestamp: 0,
        lastEvaluatedM5Start: 0,
        activeTrades: [],
        sessionHigh: -Infinity,
        sessionLow: Infinity,
      });
    });

    // Janitor interval: Prune SQLite M5 candle cache daily to prevent infinite growth
    if (!(global as any).isSimulator) {
      setInterval(() => {
        this.pruneOldM5Candles(60).catch((err: any) => {
          logger.error(`[DiscretionaryTrader] 🧹 Daily prune error: ${err.message}`);
        });
      }, 24 * 60 * 60 * 1000);
    }
  }
  static {
    __name(this, "LiveOrchestrator");
  }
  getBotIdForSetup(setupType: string) {
    const s = setupType.toUpperCase();
    if (s.startsWith("MAGE")) return "mage";
    if (s.startsWith("SAGE")) return "sage";

    return "seer";
  }
  addEyeFeedEvent(event) {
    event.timestamp = new Date().toISOString();
    this.recentEyeFeed.unshift(event);
    if (this.recentEyeFeed.length > 100) this.recentEyeFeed.pop();
    const io = getIO();
    if (io) {
      io.to(`profile_${this.profileId}`).emit(
        "discretionary_trader:eye_feed",
        event,
      );
    }
  }

  public cachedProfile: any = null;

  async getProfileData() {
    if (this.cachedProfile) return this.cachedProfile;
    return await this.refreshProfileCache();
  }

  async refreshProfileCache() {
    try {
      const row = await db
        .prepare(
          "SELECT t.risk_multiplier, COALESCE(t.metaapi_token, u.metaapi_token) as metaapi_token, t.metaapi_account_id, t.dwcb_enabled, t.dwcb_peak_balance, t.base_risk_balance, t.broker_symbol_map, t.institutional_enabled, t.institutional_daily_start_balance, t.institutional_daily_date, t.institutional_peak_balance, t.institutional_daily_cap, t.institutional_peak_to_draw FROM trading_profiles t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?",
        )
        .get(this.profileId);
      if (row) {
        this.cachedProfile = row;
      }
    } catch (e: any) {
      logger.error(`[LiveOrchestrator] Error refreshing profile data for P#${this.profileId}: ${e.message}`);
    }
    return this.cachedProfile;
  }

  static {
    this.instances = new Map();
  }

  static getInstance(profileId: any) {
    return LiveOrchestrator.instances.get(profileId.toString()) || null;
  }

  static create(profileId: any, token: string, accountId: string) {
    const idStr = profileId.toString();
    let existing = LiveOrchestrator.instances.get(idStr);
    if (existing) existing.stop();
    const newOrch = new LiveOrchestrator(idStr, token, accountId);
    LiveOrchestrator.instances.set(idStr, newOrch);
    return newOrch;
  }

  /**
   * ⚡ Sub-Millisecond Reactive In-Memory Lead Trade Broadcast to all peer orchestrators
   */
  static broadcastLeadTrade(leadTrade: any) {
    if (!leadTrade) return;
    for (const [profId, orch] of LiveOrchestrator.instances.entries()) {
      if (String(profId) === String(leadTrade.leadProfileId)) continue;
      if (!orch || !orch.isRunning()) continue;
      orch.handleIncomingLeadTrade(leadTrade).catch((err: any) => {
        logger.error(`[LiveOrchestrator][P#${profId}] Error in reactive catch-up: ${err.message}`, err);
      });
    }
  }

  async handleIncomingLeadTrade(leadTrade: any) {
    if (!this.running) return;
    const botType = (leadTrade.botType || "").toUpperCase();
    const symbol = leadTrade.symbol || leadTrade.pair;
    const session = leadTrade.session || "default";

    // 1. Mage Reactive Catch-Up
    if (botType === "MAGE") {
      const matchingPairs = Array.from(this.states.keys()).filter(
        (k) => PairConfigManager.getBaseSymbol(k) === symbol,
      );
      for (const sessionPair of matchingPairs) {
        const state = this.states.get(sessionPair);
        if (!state) continue;
        const configs = PairConfigManager.getMageConfigs(sessionPair) || [];
        for (const cfg of configs) {
          const sig = cfg.signature || "default";
          if (cfg.session && cfg.session !== session && session !== "default") continue;
          const os = state.orbStates ? state.orbStates[sig] : null;
          if (!os || os.fired || os.limitOrderId || os.mageTradeTakenToday) continue;
          if (state.activeTrades && state.activeTrades.some((t: any) => t.clientId === sig)) continue;

          const lastCandle = state.m5Buffer && state.m5Buffer.length > 0 
            ? state.m5Buffer[state.m5Buffer.length - 1] 
            : { timestamp: Date.now(), close: leadTrade.entryPrice, high: leadTrade.entryPrice, low: leadTrade.entryPrice, open: leadTrade.entryPrice };

          const isBuy = leadTrade.direction === "BUY";
          const optCfg = PairConfigManager.getRepresentativeConfig(symbol);
          const pipSize = cfg?.pipSize || optCfg?.pipSize || this.getPipValue(symbol);
          const spreadPts = (optCfg && optCfg.spread !== undefined) ? optCfg.spread * pipSize : 0;
          const currentPrice = isBuy ? lastCandle.close + spreadPts : lastCandle.close;
          const proximityThreshold = Math.max(2.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.10 * Math.abs(leadTrade.entryPrice - leadTrade.slPrice));
          const distFromLead = isBuy ? (currentPrice - leadTrade.entryPrice) : (leadTrade.entryPrice - currentPrice);
          const totalTpDist = Math.abs(leadTrade.tpPrice - leadTrade.entryPrice);
          const pctTowardsTp = distFromLead > 0 ? (distFromLead / (totalTpDist || 1)) : 0;
          const hitSl = isBuy ? (currentPrice <= leadTrade.slPrice) : (currentPrice >= leadTrade.slPrice);

          if (!hitSl && pctTowardsTp < 0.10 && distFromLead <= proximityThreshold) {
            logger.info(
              `[MageEngine][P#${this.profileId}] ⚡ Instant Reactive Catch-Up triggered for ${symbol} ${leadTrade.direction} (Lead from P#${leadTrade.leadProfileId} at ${leadTrade.entryPrice}, Live: ${currentPrice})`,
            );
            os.breakoutDir = leadTrade.direction;
            os.limitPrice = leadTrade.entryPrice;
            os.slPrice = leadTrade.slPrice;
            os.tpPrice = leadTrade.tpPrice;
            os.visionApproved = true;
            await placeMageLimitOrder(this, symbol, state, lastCandle, sig, cfg, "mage");
          }
        }
      }
    }

    // 2. Sage Reactive Catch-Up
    if (botType === "SAGE") {
      const matchingPairs = Array.from(this.states.keys()).filter(
        (k) => PairConfigManager.getBaseSymbol(k) === symbol,
      );
      for (const sessionPair of matchingPairs) {
        const state = this.states.get(sessionPair);
        if (!state) continue;
        const configs = PairConfigManager.getSageConfigs(sessionPair) || [];
        for (const cfg of configs) {
          const sig = cfg.signature || "default";
          if (cfg.session && cfg.session !== session && session !== "default") continue;
          const ss = state.sageStates ? state.sageStates[sig] : null;
          if (!ss || ss.limitOrderId || (state.sageTradeTakenToday && state.sageTradeTakenToday[sig])) continue;
          if (state.activeTrades && state.activeTrades.some((t: any) => t.clientId === sig)) continue;

          const lastCandle = state.m5Buffer && state.m5Buffer.length > 0 
            ? state.m5Buffer[state.m5Buffer.length - 1] 
            : { timestamp: Date.now(), close: leadTrade.entryPrice, high: leadTrade.entryPrice, low: leadTrade.entryPrice, open: leadTrade.entryPrice };

          const isBuy = leadTrade.direction === "BUY";
          const optCfg = PairConfigManager.getRepresentativeConfig(sessionPair);
          const pipSize = cfg?.pipSize || optCfg?.pipSize || this.getPipValue(symbol);
          const currentPrice = lastCandle.close;
          const proximityThreshold = Math.max(2.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.10 * Math.abs(leadTrade.entryPrice - leadTrade.slPrice));
          const distFromLead = isBuy ? (currentPrice - leadTrade.entryPrice) : (leadTrade.entryPrice - currentPrice);
          const totalTpDist = Math.abs(leadTrade.tpPrice - leadTrade.entryPrice);
          const pctTowardsTp = distFromLead > 0 ? (distFromLead / (totalTpDist || 1)) : 0;
          const hitSl = isBuy ? (currentPrice <= leadTrade.slPrice) : (currentPrice >= leadTrade.slPrice);

          if (!hitSl && pctTowardsTp < 0.10 && distFromLead <= proximityThreshold) {
            logger.info(
              `[SageEngine][P#${this.profileId}] ⚡ Instant Reactive Catch-Up triggered for ${symbol} ${leadTrade.direction} (Lead from P#${leadTrade.leadProfileId} at ${leadTrade.entryPrice}, Live: ${currentPrice})`,
            );
            ss.direction = leadTrade.direction;
            ss.limitPrice = leadTrade.entryPrice;
            ss.slPrice = leadTrade.slPrice;
            ss.tpPrice = leadTrade.tpPrice;
            ss.fired = true;
            await placeSageLimitOrder(this, sessionPair, state, cfg, sig, lastCandle, "sage");
          }
        }
      }
    }
  }
  async start() {
    this.running = true;
    logger.info(`[DiscretionaryTrader] \u{1F52E} Orchestrator manually started. Profile: ${this.profileId}`,);
    try {
      const dbModule: any = await import("../../core/db.js");
      const db2 = dbModule.default || dbModule;
      const profile = await db2
        .prepare("SELECT bot_risks FROM trading_profiles WHERE id = ?")
        .get(this.profileId);
      if (profile) {
        try {
          this.botRisks = JSON.parse(profile.bot_risks || "{}");
        } catch (e) {}
      }
      const configs = await db2
        .prepare("SELECT * FROM profile_pair_configs WHERE profile_id = ?")
        .all(this.profileId);
      for (const row of configs) {
        const state = this.states.get(row.pair);
        if (state) {
          state.riskPct = row.discretionary_trader_risk ?? 1;
          if (row.seer_enabled !== void 0)
            state.botConfigs.set("seer", {
              enabled: row.seer_enabled === 1,
              risk: row.seer_risk ?? 1,
            });
          if (row.mage_enabled !== void 0)
            state.botConfigs.set("mage", {
              enabled: row.mage_enabled === 1,
              risk: row.mage_risk ?? 1,
            });
          if (row.sage_enabled !== void 0)
            state.botConfigs.set("sage", {
              enabled: row.sage_enabled === 1,
              risk: row.sage_risk ?? 1,
            });

        }
      }
    } catch (err) {
      logger.error("[DiscretionaryTrader] Failed to load pair configs:", err);
    }

    // ── Register profile name for clean log output ─────────────────
    try {
      const profRow = await db.prepare("SELECT profile_name FROM trading_profiles WHERE id = ?").get(this.profileId) as any;
      if (profRow?.profile_name) {
        registerProfileName(Number(this.profileId), profRow.profile_name);
        this.plog = new ProfileLogger(Number(this.profileId));
        this.plog.info(`🚀 LiveOrchestrator starting for account: ${profRow.profile_name}`);
      }
    } catch (_) {}

    try {
      const conn = await Promise.race([
        getSharedConnection(this.token, this.accountId),
        new Promise((_, r) => setTimeout(() => r(new Error("getSharedConnection timeout (15s)")), 15000)),
      ]) as any;
      const accInfo = await Promise.race([
        conn.getAccountInformation(),
        new Promise((_, r) => setTimeout(() => r(new Error("getAccountInformation timeout (10s)")), 10000)),
      ]) as any;
      if (accInfo && accInfo.equity > 0) {
        this.cachedEquity = accInfo.equity;
        this.plog.info(`💰 Primed account equity: $${this.cachedEquity.toFixed(2)} (Balance: $${accInfo.balance.toFixed(2)})`);
        logger.info(`[DiscretionaryTrader] 💰 Primed account equity: $${this.cachedEquity.toFixed(2)}`);
      }
    } catch (e: any) {
      this.plog.warn(`⚠️ Could not prime initial account equity: ${e.message}`);
    }
    try {
      const dbModule: any = await import("../../core/db.js");
      const db2 = dbModule.default || dbModule;
      const pidNum = Number(this.profileId);
      const openTrades = await db2
        .prepare(
          "SELECT * FROM bot_trade_states WHERE (profile_id = ? OR profile_id = ?) AND status IN ('OPEN', 'PLACING', 'PENDING_VERIFICATION') AND bot_id NOT LIKE 'THE_WITCH%'",
        )
        .all(this.profileId, pidNum);
      this.plog.info(`🔍 Startup DB Trade Check: Found ${openTrades.length} DB trades in open/placing status.`);

      // Load broker symbol alias map (e.g. { "GER40": "DX40", "US30": "US30" })
      // Used as fallback when broker_symbol stored in DB doesn't match internal pair keys.
      let customMap: Record<string, string> = {};
      try {
        const profileRow = await db2.prepare("SELECT broker_symbol_map FROM trading_profiles WHERE id = ?").get(this.profileId);
        if (profileRow?.broker_symbol_map) customMap = JSON.parse(profileRow.broker_symbol_map);
      } catch (_e) {}

      // ── GHOST PURGE: Cross-reference DB open rows against live broker positions ──
      // Any trade that is OPEN in the DB but no longer exists on the broker
      // (i.e. closed via SL/TP while we were offline) must be marked CLOSED now.
      // Without this, every restart resurrects zombie trades indefinitely.
      let liveBrokerPositionIds = new Set<string>();
      try {
        const conn = await Promise.race([
          getSharedConnection(this.token, this.accountId),
          new Promise((_, r) => setTimeout(() => r(new Error("getSharedConnection timeout (15s)")), 15000)),
        ]) as any;
        const livePositions = await Promise.race([
          conn.getPositions(),
          new Promise((_, r) => setTimeout(() => r(new Error("getPositions timeout (10s)")), 10000)),
        ]) as any[];
        for (const p of livePositions) {
          liveBrokerPositionIds.add(String(p.id));
        }
        this.plog.info(`🔍 Ghost Purge: ${livePositions.length} live broker positions fetched.`);
      } catch (ghostPurgeErr: any) {
        this.plog.warn(`⚠️ Ghost Purge broker fetch failed (non-fatal): ${ghostPurgeErr.message}. All DB open trades will be re-attached.`);
      }

      for (const t of openTrades) {
        // Skip PLACING rows with no broker order ID — orphan scanner handles these
        if (!t.meta_order_id) {
          this.plog.warn(`⚠️ Skipping zombie PLACING row ${t.id} (${t.broker_symbol}) — meta_order_id is null. Orphan scanner will recover.`);
          continue;
        }

        // Ghost Purge: if the broker has no live position with this ID, it was closed while we were offline
        if (liveBrokerPositionIds.size > 0 && !liveBrokerPositionIds.has(String(t.meta_order_id))) {
          this.plog.warn(`👻 Ghost trade: DB row ${t.id} (${t.broker_symbol} ${t.direction}) absent from broker. Marking CLOSED.`);
          try {
            await db2.prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ? AND status != 'CLOSED'").run(t.id);
          } catch (dbCloseErr: any) {
            this.plog.error(`Failed to mark ghost trade ${t.id} CLOSED: ${dbCloseErr.message}`);
          }
          try { globalTradeGate.release(this.profileId, t.meta_order_id); } catch (_) {}
          continue; // Skip re-attaching this ghost to memory
        }

        const symbol = t.broker_symbol;
        
        // Reverse customMap lookup to get original session pairs
        let baseSymbol = PairConfigManager.getBaseSymbol(symbol);
        if (customMap) {
          for (const [k, v] of Object.entries(customMap)) {
            if (v === symbol) {
              baseSymbol = PairConfigManager.getBaseSymbol(k);
              logger.info(`[DiscretionaryTrader] 🗺️ Alias resolved: broker symbol "${symbol}" -> internal base "${baseSymbol}" via customMap`);
              break;
            }
          }
        }

        let matchingPairs = Array.from(this.states.keys()).filter(
          (k) => PairConfigManager.getBaseSymbol(k) === baseSymbol || k === symbol,
        );
        if (matchingPairs.length === 0) {
          matchingPairs = [symbol];
        }

        for (const sp of matchingPairs) {
          let state = this.states.get(sp);
          if (!state) {
            const config = PairConfigManager.getRepresentativeConfig(sp);
            if (config) {
              state = { pair: sp, config, orbBuilt: false, m5Buffer: [], activeTrades: [], sageActiveSetups: [] };
              this.states.set(sp, state);
            } else {
              continue;
            }
          }
          if (!state.activeTrades) state.activeTrades = [];
          if (!state.activeTrades.some((at: any) => String(at.metaOrderId) === String(t.meta_order_id))) {
            state.activeTrades.push({
              dbId: t.id,
              metaOrderId: t.meta_order_id,
              clientId: t.client_id,
              botId: t.bot_id,
              direction: t.direction,
              entryPrice: t.entry_price,
              slPrice: t.sl_price,
              originalSl: t.original_sl || t.sl_price,
              tpPrice: t.tp_price,
              riskPips: t.initial_risk_pips,
              highestPrice: t.highest_price || t.entry_price,
              lowestPrice: t.lowest_price || t.entry_price,
              isTrailing: t.sl_price !== t.entry_price,
              volume: t.lots || 0,
              hasTakenPartial: t.t1_hit === 1,
              unconfirmedSwingLow: null,
              unconfirmedSwingHigh: null,
              lastSwingHigh: null,
              lastSwingLow: null,
              lastConfirmedSL: t.sl_price,
              secondLastConfirmedSL: t.sl_price,
              lastConfirmedSH: t.sl_price,
              secondLastConfirmedSH: t.sl_price,
              openTime: t.open_time
                ? (Number.isFinite(Number(t.open_time)) ? Number(t.open_time) : new Date(t.open_time).getTime())
                : Date.now(),
            });
          }
        }

        globalTradeGate.register(
          this.profileId,
          t.meta_order_id,
          symbol,
          t.direction,
          "DISC",
        );

        // Register active open trade as lead trade in GlobalTradeGate for cross-account catch-up
        try {
          const openMs = t.open_time
            ? (Number.isFinite(Number(t.open_time)) ? Number(t.open_time) : new Date(t.open_time).getTime())
            : Date.now();
          const estDate = getFixedEstDate(new Date(openMs));
          const dateStr = estDate.toISOString().split("T")[0];
          globalTradeGate.registerSessionDirection({
            botId: t.bot_id.toUpperCase(),
            symbol: baseSymbol,
            session: "default",
            dateStr: dateStr,
            direction: t.direction,
            leadProfileId: this.profileId,
            entryPrice: t.entry_price,
            slPrice: t.sl_price,
            tpPrice: t.tp_price,
            timestamp: openMs,
          });
        } catch (_rgErr) {}

        this.plog.info(`🔄 Re-attached ${t.bot_id} ${t.direction} ${symbol} (order: ${t.meta_order_id})`);
      }
    } catch (err: any) {
      this.plog.error(`❌ Failed to re-attach open trades from DB: ${err.message}`);
      logger.error("[DiscretionaryTrader] Failed to re-attach open trades:", err.message);
    }
    await this.warmup();
    this.warmedUp = true;

    // ── Background Hydration Worker ─────────────────────────────
    // Polling interval to attempt re-hydration of any pairs that failed during cold start warmup
    setInterval(async () => {
      if (this.pendingHydration.size === 0) return;
      this.plog.info(`🔄 Background Hydration Worker: Retrying ${this.pendingHydration.size} missing pairs...`);
      
      for (const symbol of Array.from(this.pendingHydration)) {
        try {
          const dbCandles = await this.loadCachedM5Candles(symbol, 30);
          let rawM5 = dbCandles;
          
          if (rawM5.length === 0) {
            let fetchStartTime: Date | undefined = undefined;
            const MAX_CANDLES = 8640;
            const CHUNK_SIZE = 1000;
            
            while (rawM5.length < MAX_CANDLES) {
              const fetchCount = Math.min(CHUNK_SIZE, MAX_CANDLES - rawM5.length);
              const chunk: any[] = await this.fetchCandlesWithRetry(symbol, fetchStartTime, fetchCount);
              
              if (!chunk || chunk.length === 0) break;
              chunk.sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());

              const newCandles = chunk.filter((c: any) => {
                const ts = new Date(c.time).getTime();
                return !rawM5.some((existing) => existing.timestamp === ts);
              });
              if (newCandles.length === 0) break;

              rawM5 = [...newCandles, ...rawM5];
              const oldestTime = new Date(rawM5[0].time).getTime();
              const nowMs = Date.now();
              const targetCutoff = nowMs - 30 * 86400 * 1000;
              if (oldestTime <= targetCutoff) break;
              fetchStartTime = new Date(oldestTime - 1);
            }
            if (rawM5.length > 0) {
              await this.saveM5CandlesToCache(symbol, rawM5);
            }
          }
          
          if (rawM5.length > 0) {
            const matchingPairs = Array.from(this.states.keys()).filter((k) => PairConfigManager.getBaseSymbol(k) === symbol || k === symbol);
            for (const sp of matchingPairs) {
              const state = this.states.get(sp);
              if (state) {
                state.m5Buffer = rawM5.map(c => ({ ...c }));
                this.warmupORBStatesForPair(sp);
              }
            }
            this.pendingHydration.delete(symbol);
            this.plog.info(`✅ Background Hydration successful for ${symbol}. Removing from pending queue.`);
          }
        } catch (e: any) {
          this.plog.warn(`⚠️ Background Hydration attempt failed for ${symbol}: ${e.message}`);
        }
      }
    }, 5 * 60 * 1000); // Retry every 5 minutes

    // ── Orphan Position Scanner ──────────────────────────────────
    try {
      const conn = await getSharedConnection(this.token, this.accountId);
      const allPositions = await enqueueMetaApiRequest(
        async () => (await getSharedConnection(this.token, this.accountId)).getPositions(),
        `OrphanScan:startup`,
      );
      this.plog.info(`🌐 Broker Position Scan: ${allPositions.length} live positions found.`);

      const db2 = (await import("../../core/db.js")).default;
      const pidNum = Number(this.profileId);
      const knownOrderIds = new Set(
        ((await db2.prepare("SELECT meta_order_id FROM bot_trade_states WHERE (profile_id = ? OR profile_id = ?) AND status IN ('OPEN', 'PLACING', 'PENDING_VERIFICATION')").all(this.profileId, pidNum)) || [])
          .map((r) => String(r.meta_order_id))
      );

      // Get all pairs we manage
      const managedSymbols = new Set(
        Array.from(this.states.keys()).map((sp) => PairConfigManager.getBaseSymbol(sp))
      );

      for (const pos of allPositions) {
        this.plog.verbose(`📊 Broker pos: ${pos.symbol} ${pos.type} Entry=${pos.openPrice} SL=${pos.sl ?? pos.stopLoss} Lots=${pos.volume}`);
        // Skip if already tracked in DB
        if (knownOrderIds.has(String(pos.id))) {
          this.plog.verbose(`ℹ️ Position ${pos.id} (${pos.symbol}) already tracked in DB.`);
          continue;
        }

        // Try to determine which bot placed this by inspecting clientId prefix, magic number, or pair config
        let detectedBotId = "";
        let isKnownBotTrade = false;
        if (pos.clientId) {
          const cid = (pos.clientId || "").toUpperCase();
          if (cid.startsWith("S_") || cid.includes("SAGE")) { detectedBotId = "SAGE"; isKnownBotTrade = true; }
          else if (cid.startsWith("M_") || cid.includes("MAGE")) { detectedBotId = "MAGE"; isKnownBotTrade = true; }

          else if (cid.startsWith("SRC_") || cid.includes("SEER")) { detectedBotId = "SEER"; isKnownBotTrade = true; }
        }

        const posBaseSymbol = PairConfigManager.getBaseSymbol(pos.symbol);

        // This is an orphaned position — reconstruct and insert it

        
        // If it's a known bot trade but doesn't map cleanly via pos.symbol (e.g., DX40 instead of GER40),
        // we should try to figure out which session pair it belongs to via customMap.
        const profile = await db2.prepare("SELECT broker_symbol_map FROM trading_profiles WHERE id = ?").get(this.profileId);
        let customMap: any = null;
        try { if (profile?.broker_symbol_map) customMap = JSON.parse(profile.broker_symbol_map); } catch(e) {}
        
        let matchingPairs = Array.from(this.states.keys()).filter(
          (k) => PairConfigManager.getBaseSymbol(k) === posBaseSymbol || k === pos.symbol
        );
        
        // Fallback for custom mapped symbols (e.g., DX40 -> GER40)
        if (matchingPairs.length === 0 && customMap) {
          for (const sp of this.states.keys()) {
            const internalBase = PairConfigManager.getBaseSymbol(sp);
            if (customMap[internalBase] === pos.symbol) {
              matchingPairs.push(sp);
            }
          }
        }
        
        // If we still can't find a matching pair, just use the broker symbol
        if (matchingPairs.length === 0) {
          matchingPairs = [pos.symbol];
        }

        const direction = pos.type === "POSITION_TYPE_BUY" ? "BUY" : "SELL";

        if (!detectedBotId) {
          const sageCfgs = PairConfigManager.getSageConfigs(pos.symbol) || PairConfigManager.getSageConfigs(matchingPairs[0]);
          const mageCfgs = PairConfigManager.getMageConfigs(pos.symbol) || PairConfigManager.getMageConfigs(matchingPairs[0]);
          const seerCfgs = PairConfigManager.getSeerConfigs(pos.symbol) || PairConfigManager.getSeerConfigs(matchingPairs[0]);

          if (sageCfgs?.length > 0 && mageCfgs?.length === 0) detectedBotId = "SAGE";
          else if (mageCfgs?.length > 0 && sageCfgs?.length === 0) detectedBotId = "MAGE";
          else if (seerCfgs?.length > 0 && mageCfgs?.length === 0 && sageCfgs?.length === 0) detectedBotId = "SEER";
          else detectedBotId = "SAGE";
        }

        const tp = await db2.prepare("SELECT user_id FROM trading_profiles WHERE id = ?").get(this.profileId);
        const actualUserId = tp ? tp.user_id : 0;

        const baseSym = PairConfigManager.getBaseSymbol(pos.symbol);
        const estPipSize = getDynamicPipSize(pos.symbol);
        const actualPosSL = pos.sl !== undefined ? pos.sl : pos.stopLoss;
        const slDist = actualPosSL ? Math.abs(pos.openPrice - actualPosSL) / estPipSize : 20;
        const openTimeVal = pos.time ? new Date(pos.time).getTime() : Date.now();

        try {
          const result = await db2.prepare(`
            INSERT INTO bot_trade_states
              (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, original_sl, tp_price,
               lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, initial_risk_pips, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'OPEN')
          `).run(
            actualUserId,
            this.profileId,
            detectedBotId,
            pos.symbol,
            direction,
            pos.openPrice,
            actualPosSL || pos.openPrice,
            actualPosSL || pos.openPrice,
            pos.takeProfit || null,
            pos.volume,
            openTimeVal,
            pos.id,
            pos.openPrice,
            pos.openPrice,
            slDist,
          );

          const dbId = result.lastInsertRowid;

          // Re-attach to in-memory state
          for (const sp of matchingPairs) {
            let state = this.states.get(sp);
            if (!state) {
              const config = PairConfigManager.getRepresentativeConfig(sp);
              if (config) {
                state = { pair: sp, config, orbBuilt: false, m5Buffer: [], activeTrades: [], sageActiveSetups: [] };
                this.states.set(sp, state);
              } else {
                continue;
              }
            }
            if (!state.activeTrades) state.activeTrades = [];
            // Only attach if not already present
            if (!state.activeTrades.find((t) => String(t.metaOrderId) === String(pos.id))) {
              state.activeTrades.push({
                dbId,
                metaOrderId: pos.id,
                clientId: pos.clientId || null,
                botId: detectedBotId,
                direction,
                entryPrice: pos.openPrice,
                slPrice: actualPosSL || pos.openPrice,
                originalSl: actualPosSL || pos.openPrice,
                tpPrice: pos.takeProfit || null,
                riskPips: slDist,
                highestPrice: pos.openPrice,
                lowestPrice: pos.openPrice,
                isTrailing: false,
                volume: pos.volume,
                hasTakenPartial: false,
                unconfirmedSwingLow: null,
                unconfirmedSwingHigh: null,
                lastSwingHigh: null,
                lastSwingLow: null,
                lastConfirmedSL: actualPosSL || pos.openPrice,
                secondLastConfirmedSL: actualPosSL || pos.openPrice,
                lastConfirmedSH: pos.openPrice,
                secondLastConfirmedSH: pos.openPrice,
                openTime: pos.time ? new Date(pos.time).getTime() : Date.now(),
              });
            }
          }

          globalTradeGate.register(this.profileId, pos.id, pos.symbol, direction, "DISC");
          logger.warn(`[DiscretionaryTrader] 🆘 ORPHAN POSITION RECOVERED: ${pos.symbol} ${direction} @ ${pos.openPrice} (MetaOrderId: ${pos.id}) → assigned to ${detectedBotId}`);
          addBotLog(
            this.profileId,
            detectedBotId.toLowerCase(),
            pos.symbol,
            "ORPHAN_RECOVERED",
            `Server restart detected orphaned ${direction} position @ ${pos.openPrice} (MetaOrderId: ${pos.id}). Reattached to ${detectedBotId} management.`
          );
        } catch (insertErr) {
          logger.error(`[DiscretionaryTrader] ❌ Failed to recover orphan position ${pos.id}:`, insertErr.message);
        }
      }
    } catch (orphanErr) {
      logger.error(`[DiscretionaryTrader] ⚠️ Orphan position scan failed (non-fatal):`, orphanErr.message);
    }
    // ── End Orphan Position Scanner ──────────────────────────────

    // ── Pending Order Recovery Scanner ───────────────────────────
    try {
      const conn = await getSharedConnection(this.token, this.accountId);
      const allOrders = await enqueueMetaApiRequest(
        async () => (await getSharedConnection(this.token, this.accountId)).getOrders(),
        `PendingScan:startup`,
      );

      for (const order of allOrders) {
        if (!order.clientId) continue;
        const cid = order.clientId.toUpperCase();
        
        // Match Mage orders (format: MAGE_signature_<timestamp>)
        if (cid.startsWith("MAGE_")) {
          // Strip timestamp suffix if present to get the base signature
          const sig = order.clientId.replace(/_\d+$/, "");
          const baseSymbol = PairConfigManager.getBaseSymbol(order.symbol);
          
          const matchingPair = Array.from(this.states.keys()).find(
            (k) => PairConfigManager.getBaseSymbol(k) === baseSymbol
          );
          if (matchingPair) {
            const state = this.states.get(matchingPair);
            if (state) {
              if (!state.orbStates) state.orbStates = {};
              if (!state.orbStates[sig]) {
                state.orbStates[sig] = {
                  limitOrderId: order.id,
                  limitPrice: order.openPrice || order.limitPrice,
                  slPrice: order.stopLoss,
                  tpPrice: order.takeProfit,
                  fired: false,
                  limitPlacedAt: order.time ? new Date(order.time).getTime() : Date.now(),
                  tradeTakenDate: null,
                  mageTradeTakenToday: false,
                };
                logger.info(`[DiscretionaryTrader] 🔄 Re-attached pending MAGE limit order ${order.id} on ${matchingPair} (sig: ${sig})`);
              }
            }
          }
        }
        
        // Match Sage orders (format: SAGE_signature)
        if (cid.startsWith("SAGE_")) {
          const sig = order.clientId;
          const baseSymbol = PairConfigManager.getBaseSymbol(order.symbol);
          
          const matchingPair = Array.from(this.states.keys()).find(
            (k) => PairConfigManager.getBaseSymbol(k) === baseSymbol
          );
          if (matchingPair) {
            const state = this.states.get(matchingPair);
            if (state) {
              if (!state.sageStates) state.sageStates = {};
              if (!state.sageStates[sig]) {
                state.sageStates[sig] = {
                  limitOrderId: order.id,
                  limitPrice: order.openPrice || order.limitPrice,
                  slPrice: order.stopLoss,
                  tpPrice: order.takeProfit,
                  fired: false,
                  fired_fill_check: false,
                  limitPlacedAt: order.time ? new Date(order.time).getTime() : Date.now(),
                  sessionActive: true,
                  orBuilt: true,
                };
                logger.info(`[DiscretionaryTrader] 🔄 Re-attached pending SAGE limit order ${order.id} on ${matchingPair} (sig: ${sig})`);
              }
            }
          }
        }
      }
    } catch (pendingErr: any) {
      logger.error(`[DiscretionaryTrader] ⚠️ Pending order scan failed (non-fatal):`, pendingErr.message);
    }
    // ── End Pending Order Recovery Scanner ───────────────────────

    this.broadcastStatus();
  }
  onTradeClosed(pair, pnlPips, metaOrderId) {
    let basePair = pair
      .split(".")[0]
      .replace(/[^A-Z0-9]/g, "")
      .trim()
      .toUpperCase();
    if (basePair.length > 6) {
      const matched = DISCRETIONARY_TRADER_PAIRS.find((p) =>
        basePair.startsWith(p.pair),
      );
      if (matched) {
        basePair = matched.pair;
      }
    }
    const matchingPairs = Array.from(this.states.keys()).filter(
      (k) => PairConfigManager.getBaseSymbol(k) === basePair,
    );
    let broadcast = false;
    for (const sp of matchingPairs) {
      const state = this.states.get(sp);
      if (state) {
        if (state.activeTrade && String(state.activeTrade.metaOrderId) === String(metaOrderId)) {
          delete state.activeTrade;
          broadcast = true;
        }
        if (state.activeTrades && state.activeTrades.length > 0) {
          const initialCount = state.activeTrades.length;
          state.activeTrades = state.activeTrades.filter(t => String(t.metaOrderId) !== String(metaOrderId));
          if (state.activeTrades.length < initialCount) {
            logger.info(`[DiscretionaryTrader] 🧹 Clearing active trade ${metaOrderId} for ${sp} (Closed for ${pnlPips.toFixed(1)} pips).`,);
            broadcast = true;
          }
        }
      }
    }
    if (broadcast) this.broadcastStatus();
  }

  async loadCachedM5Candles(symbol: string, days: number = 30): Promise<any[]> {
    // Fast path: read from local SQLite (sub-ms, no network hop)
    return loadCachedM5CandlesLocal(this.profileId, symbol, days);
  }

  async saveM5CandlesToCache(symbol: string, candles: any[]): Promise<void> {
    // Write to local SQLite — single transaction, no network cost
    saveM5CandlesToCacheLocal(this.profileId, symbol, candles);
  }

  async pruneOldM5Candles(daysToRetain: number = 60): Promise<void> {
    // Synchronous local SQLite prune — no Supabase call needed
    pruneOldM5CandlesLocal(daysToRetain);
  }

  async fetchCandlesWithRetry(brokerSym: string, fetchStartTime: Date | undefined, fetchCount: number, maxRetries = 3): Promise<any[]> {
    const account = await getSharedAccount(this.token, this.accountId);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const chunk: any[] = await Promise.race([
          account.getHistoricalCandles(brokerSym, "5m", fetchStartTime, fetchCount),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("MetaApi getHistoricalCandles timeout (30s)")), 3e4)
          ),
        ]) as any[];
        return chunk;
      } catch (err: any) {
        if (attempt === maxRetries) throw err;
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        logger.warn(`[DiscretionaryTrader] Hydration timeout for ${brokerSym}. Retrying attempt ${attempt + 1}/${maxRetries} in ${Math.round(delayMs / 1000)}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return [];
  }

  async warmup() {
    logger.info(`[DiscretionaryTrader] ⏳ Starting 30-Day Hydration Sequence (DB Cache + Delta MetaApi)...`);
    try {
      await this.getProfileData();
      await this.pruneOldM5Candles(60);
      const account = await getSharedAccount(this.token, this.accountId);
      
      if (!this.customMap || Object.keys(this.customMap).length === 0) {
        const profile = await db.prepare("SELECT broker_symbol_map FROM trading_profiles WHERE id = ?").get(this.profileId);
        if (!profile) {
          logger.info(`[LiveOrchestrator] ℹ️ Profile ${this.profileId} no longer exists in database. Aborting warmup.`);
          return;
        }
        let loadedMap: Record<string, string> = {};
        try { if (profile && profile.broker_symbol_map) loadedMap = JSON.parse(profile.broker_symbol_map); } catch(e) {}
        
        if (Object.keys(loadedMap).length === 0 && !(global as any).isSimulator) {
          logger.info(`[LiveOrchestrator] 🔍 Profile ${this.profileId} has empty symbol map. Auto-discovering broker symbols...`);
          try {
            const { discoverBrokerSymbols } = await import("../../utils/discoverSymbols.js");
            loadedMap = await discoverBrokerSymbols(Number(this.profileId), this.token, this.accountId);
          } catch (e: any) {
            logger.warn(`[LiveOrchestrator] Auto symbol discovery skipped/failed for profile ${this.profileId}: ${e.message}`);
          }
        }
        this.customMap = loadedMap;
      }
      
      // ── Parallelised warmup: all pairs hydrate simultaneously ──────────────
      await Promise.all(
        DISCRETIONARY_TRADER_PAIRS.map(async (cfg) => {
          const sessionPair = cfg.pair;
          const symbol = PairConfigManager.getBaseSymbol(sessionPair);
          const brokerSym = this.customMap[symbol] || symbol;

          const state = this.states.get(sessionPair);
          if (!state) return;
          const mapCandles = __name((c) => {
            const d = new Date(c.time);
            const estDate = getFixedEstDate(d);
            const yyyy = estDate.getUTCFullYear();
            const mm = String(estDate.getUTCMonth() + 1).padStart(2, "0");
            const dd = String(estDate.getUTCDate()).padStart(2, "0");
            return {
              timestamp: d.getTime(),
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              tickVolume: c.tickVolume || 1,
              dateStr: `${yyyy}-${mm}-${dd}`,
              estHour: estDate.getUTCHours(),
              estMinute: estDate.getUTCMinutes(),
            };
          }, "mapCandles");
          try {
            // 1. Load 30 days of cached M5 candles from local SQLite (instant, no network)
            const dbCandles = await this.loadCachedM5Candles(symbol, 30);
            let rawM5: any[] = [];
            const nowMs = Date.now();
            const targetCutoff = nowMs - 30 * 86400 * 1000;

            if (dbCandles.length > 0) {
              const latestCachedTs = dbCandles[dbCandles.length - 1].timestamp;
              const msGap = nowMs - latestCachedTs;
              logger.info(`[DiscretionaryTrader] 💾 Loaded ${dbCandles.length} M5 candles from local DB cache for ${symbol} (0 MetaApi calls).`);
              rawM5 = [...dbCandles];

              // If gap is more than 5 minutes, fetch missing delta candles from MetaApi
              if (msGap > 5 * 60 * 1000) {
                const expectedMissing = Math.ceil(msGap / (5 * 60 * 1000));
                const fetchCount = Math.min(1000, Math.max(10, Math.ceil(expectedMissing * 1.10)));
                const deltaCandles: any[] = await this.fetchCandlesWithRetry(brokerSym, new Date(latestCachedTs + 1), fetchCount);
                if (deltaCandles && deltaCandles.length > 0) {
                  logger.info(`[DiscretionaryTrader] ⚡ Fetched ${deltaCandles.length} missing gap candles from MetaApi for ${symbol}. Saving to local cache...`);
                  await this.saveM5CandlesToCache(symbol, deltaCandles);
                  for (const dc of deltaCandles) {
                    const dcTs = new Date(dc.time).getTime();
                    if (!rawM5.some((existing) => existing.timestamp === dcTs)) {
                      rawM5.push({
                        time: dc.time,
                        timestamp: dcTs,
                        open: dc.open,
                        high: dc.high,
                        low: dc.low,
                        close: dc.close,
                        tickVolume: dc.tickVolume || 1,
                      });
                    }
                  }
                }
              }
            } else {
              // Cold start: DB cache is empty. Fetch 30 days from MetaApi once to seed local cache.
              logger.info(`[DiscretionaryTrader] ❄️ Cold start for ${symbol}: Fetching 30 days of M5 candles from MetaApi...`);
              let fetchStartTime: Date | undefined = undefined;
              const MAX_CANDLES = 8640;
              const CHUNK_SIZE = 1000;
              let fetchedChunks = 0;

              while (rawM5.length < MAX_CANDLES) {
                const fetchCount = Math.min(CHUNK_SIZE, MAX_CANDLES - rawM5.length);
                const chunk: any[] = await this.fetchCandlesWithRetry(brokerSym, fetchStartTime, fetchCount);

                if (!chunk || chunk.length === 0) break;
                fetchedChunks++;
                chunk.sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());

                const newCandles = chunk.filter((c: any) => {
                  const ts = new Date(c.time).getTime();
                  return !rawM5.some((existing) => existing.timestamp === ts);
                });
                if (newCandles.length === 0) break;

                rawM5 = [...newCandles, ...rawM5];
                const oldestTime = new Date(rawM5[0].time).getTime();
                if (oldestTime <= targetCutoff) break;
                fetchStartTime = new Date(oldestTime - 1);
              }

              if (rawM5.length > 0) {
                logger.info(`[DiscretionaryTrader] 💾 Persisting ${rawM5.length} backfilled M5 candles to local cache for ${symbol} (${fetchedChunks} MetaApi calls).`);
                await this.saveM5CandlesToCache(symbol, rawM5);
              }
            }

            const mapped: any[] = rawM5
              .map(mapCandles)
              .sort((a: any, b: any) => a.timestamp - b.timestamp);
            const alpha = 2 / (20 + 1);
            let prevEma = mapped[0]?.close || null;
            state.emaArr = [];
            state.m5Buffer = [];
            state.dailyTracker = new DailyContextTracker();

            for (let i = 0; i < mapped.length; i++) {
              const c = mapped[i];
              state.dailyTracker.processCandle(c);
              state.m5Buffer.push(c);
              state.lastEstHour = c.estHour ?? -1;
              if (i === 0) {
                state.emaArr.push(prevEma);
              } else {
                const ema = (c.close - prevEma) * alpha + prevEma;
                state.emaArr.push(ema);
                prevEma = ema;
              }

              if (PairConfigManager.isOrbEnabled(symbol)) {
                if (!state.orbState) {
                  state.orbState = {
                    orHigh: -Infinity,
                    orLow: Infinity,
                    orBuilt: false,
                    breakoutDir: null,
                    limitPrice: 0,
                    slPrice: 0,
                    tpPrice: 0,
                    limitOrderId: null,
                    visionApproved: false,
                    fired: false,
                    currentDateStr: "",
                  };
                }
                const os = state.orbState;
                const dateStr = c.dateStr;
                if (os.currentDateStr !== dateStr) {
                  os.orHigh = -Infinity;
                  os.orLow = Infinity;
                  os.orBuilt = false;
                  os.breakoutDir = null;
                  os.limitPrice = 0;
                  os.slPrice = 0;
                  os.tpPrice = 0;
                  os.limitOrderId = null;
                  os.visionApproved = false;
                  os.fired = false;
                  os.currentDateStr = dateStr;
                }
                const orbTime = PairConfigManager.getOrbTime(symbol);
                const startMins = orbTime.hour * 60 + orbTime.min;
                const currentMins = c.estHour * 60 + c.estMinute;
                if (currentMins >= startMins && currentMins < startMins + 15) {
                  os.orHigh = Math.max(os.orHigh, c.high);
                  os.orLow = Math.min(os.orLow, c.low);
                } else if (currentMins >= startMins + 15 && !os.orBuilt) {
                  os.orBuilt = true;
                }
              }

              if (state.m5Buffer.length > 50e3) {
                state.m5Buffer.shift();
                if (state.emaArr.length > 0) state.emaArr.shift();
              }
            }
            this.warmupORBStatesForPair(sessionPair);
            await this.warmupSeerStateForPair(sessionPair);
          } catch (e: any) {
            const today = new Date();
            const isWeekend = today.getDay() === 0 || today.getDay() === 6;
            if (isWeekend) {
              logger.warn(`[DiscretionaryTrader] [Weekend Warning] Hydration failed/timed out for ${symbol} (Normal broker downtime on Saturday/Sunday): ${e.message}`);
            } else {
              logger.error(`[DiscretionaryTrader] Hydration failed for ${symbol}:`, e.message);
              this.pendingHydration.add(symbol);
            }
          }
        })
      );
      logger.info(`[DiscretionaryTrader] 🔮 Seer Hydration Completed. Daily Context Tracker primed.`);
      logger.info(`[DiscretionaryTrader] 🔮 Mage Hydration Completed. Session ORB mathematically reconstructed.`);
      logger.info(`[DiscretionaryTrader] 🔮 Sage Hydration Completed. Reversal state context primed.`);
      logger.info(`[DiscretionaryTrader] 🔮 Black Swan Hydration Completed. Ultra-consistency setups primed.`);
    } catch (e) {
      logger.error(`[DiscretionaryTrader] ⚠️ Master Hydration failed: ${e.message}`);
    }
  }

  async warmupSeerStateForPair(sessionPair: string) {
    const symbol = PairConfigManager.getBaseSymbol(sessionPair);
    const state = this.states.get(sessionPair);
    if (!state) return;

    const seerConfigs = PairConfigManager.getSeerConfigs(sessionPair) || [];
    if (seerConfigs.length === 0) return;

    // Seer session resets at 17:00 EST
    const nowEst = getFixedEstDate();
    const sessionStart = getFixedEstDate();
    sessionStart.setUTCHours(17, 0, 0, 0);

    if (nowEst.getUTCHours() < 17) {
      // If currently before 17:00, the session started yesterday at 17:00
      sessionStart.setUTCDate(sessionStart.getUTCDate() - 1);
    }

    let seerTradeTaken = false;
    try {
      const existingSeerTrade = await db.prepare(
        "SELECT id, status, open_time FROM bot_trade_states WHERE (profile_id = ? OR profile_id = ?) AND (broker_symbol = ? OR broker_symbol LIKE ? || '%') AND bot_id = 'SEER' AND status NOT IN ('FAILED', 'CANCELLED') AND open_time >= ?"
      ).get(this.profileId, Number(this.profileId), symbol, symbol, sessionStart.getTime());
      
      if (existingSeerTrade) {
        seerTradeTaken = true;
        this.plog.verbose(`🔒 Seer lockout on ${symbol}: DB trade #${existingSeerTrade.id} already ${existingSeerTrade.status}.`);
      }
    } catch (e) {}

    state.seerTradeTakenToday = seerTradeTaken;
    if (seerTradeTaken) {
      logger.warn(`[DiscretionaryTrader] 🔒 Lockout activated for Seer ${symbol}: Trade already executed today in DB.`);
    } else {
      logger.info(`[DiscretionaryTrader] 🔓 Seer session active for ${symbol}: No trade executed yet today since 17:00 EST.`);
    }
  }

  async warmupORBStatesForPair(sessionPair: string) {
    const symbol = PairConfigManager.getBaseSymbol(sessionPair);
    const state = this.states.get(sessionPair);
    if (!state || !state.m5Buffer || state.m5Buffer.length === 0) return;

    const mageConfigs = PairConfigManager.getMageConfigs(sessionPair) || [];
    const sageConfigs = PairConfigManager.getSageConfigs(sessionPair) || [];


    const pipSize = this.getPipValue(symbol);

    if (!state.orbStates) state.orbStates = {};
    if (!state.sageStates) state.sageStates = {};

    const nowEst = getFixedEstDate();

    const allMageConfigs = [
      ...mageConfigs.map(c => ({ config: c, botId: "mage" }))
    ];

    for (const item of allMageConfigs) {
      const config = item.config;
      const sig = config.signature || "default";

      const windowStart = getFixedEstDate();
      windowStart.setUTCHours(config.orbStartHour, config.orbStartMin, 0, 0);
      const isBeforeTodaySession = nowEst.getTime() < windowStart.getTime();
      if (isBeforeTodaySession) {
        windowStart.setUTCDate(windowStart.getUTCDate() - 1);
      }
      const windowEnd = new Date(windowStart.getTime() + config.orbMinutes * 60 * 1000);

      const yyyy = windowStart.getUTCFullYear();
      const mm = String(windowStart.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(windowStart.getUTCDate()).padStart(2, "0");
      const sessionDateStr = `${yyyy}-${mm}-${dd}`;
      const startMins = config.orbStartHour * 60 + config.orbStartMin;
      const endMins = startMins + config.orbMinutes;

      const orbCandles = state.m5Buffer.filter((c: any) => {
        if (c.dateStr !== sessionDateStr) return false;
        const cMins = c.estHour * 60 + c.estMinute;
        return cMins >= startMins && cMins <= endMins;
      });

      if (orbCandles.length > 0) {
        let maxHigh = -Infinity;
        let minLow = Infinity;
        for (const c of orbCandles) {
          if (c.high > maxHigh) maxHigh = c.high;
          if (c.low < minLow) minLow = c.low;
        }

        if (!state.orbStates[sig]) {
          state.orbStates[sig] = {
            orHigh: 0,
            orLow: 0,
            orBuilt: false,
            wasBuildingORB: false,
            limitPrice: 0,
            slPrice: 0,
            tpPrice: 0,
            breakoutDir: null,
            limitOrderId: null,
            fired: false,
            currentDateStr: "",
            currentOrbDateStr: "",
            tradeTakenOnOrbDay: undefined,
          };
        }

        const os = state.orbStates[sig];
        os.orHigh = maxHigh;
        os.orLow = minLow;
        os.currentDateStr = sessionDateStr;
        os.currentOrbDateStr = sessionDateStr;

        logger.info(`[DiscretionaryTrader] 🔮 ORB reconstructed for ${symbol} (${sig}): High: ${maxHigh.toFixed(5)}, Low: ${minLow.toFixed(5)}, Date: ${sessionDateStr}`);
        this.addEyeFeedEvent({
          type: "EVAL_RESULT",
          bot_id: item.botId,
          data: {
            symbol,
            decision: "SCANNING",
            setupType: "ORB Breakout",
            reasoning: `Historical ORB Reconstructed (High: ${maxHigh.toFixed(5)}, Low: ${minLow.toFixed(5)})`,
          },
        });

        if (isBeforeTodaySession) {
          // Current time is before today's session start — do NOT lock out today's upcoming session!
          os.orBuilt = false;
          os.wasBuildingORB = false;
          os.fired = false;
          os.mageTradeTakenToday = false;
          os.tradeTakenOnOrbDay = undefined;
          logger.info(`[DiscretionaryTrader] 🔓 Upcoming session today for ${symbol} (${sig}): Resetting lockout state for fresh ORB creation.`);
        } else if (nowEst.getTime() >= windowEnd.getTime()) {
          os.orBuilt = true;
          os.wasBuildingORB = false;
          logger.info(`[DiscretionaryTrader] ✅ ORB window built historically for ${symbol} (${sig}). Gating live evaluations.`);

          const fcHours = config.forceCloseHours || 4;
          const isPastForceClose = nowEst.getTime() >= windowEnd.getTime() + fcHours * 3600000;
          
          let tradeTaken = false;
          try {
            const existingTrade = await db.prepare(
              "SELECT id, status, open_time FROM bot_trade_states WHERE (profile_id = ? OR profile_id = ?) AND (broker_symbol = ? OR broker_symbol LIKE ? || '%') AND status NOT IN ('FAILED', 'CANCELLED') AND open_time >= ?"
            ).get(this.profileId, Number(this.profileId), symbol, symbol, windowStart.getTime());
            if (existingTrade) {
              tradeTaken = true;
              this.plog.verbose(`🔒 Mage lockout on ${symbol} (${sig}): DB trade #${existingTrade.id} already ${existingTrade.status}.`);
            }
          } catch (e) {}

          os.mageTradeTakenToday = tradeTaken;
          os.tradeTakenOnOrbDay = tradeTaken ? sessionDateStr : undefined;

          if (tradeTaken) {
            os.fired = true;
            logger.warn(`[DiscretionaryTrader] 🔒 Lockout activated for ${symbol} (${sig}): Trade already executed today in DB.`);
          } else if (isPastForceClose) {
            os.fired = true;
            logger.warn(`[DiscretionaryTrader] 🔒 Lockout activated for ${symbol} (${sig}): Current time is past force close window limit.`);
          } else {
            os.fired = false;
            logger.info(`[DiscretionaryTrader] 🔓 ORB session active for ${symbol} (${sig}): No trade executed yet today. Live evaluation enabled for current price.`);
          }
        } else {
          os.orBuilt = false;
          os.wasBuildingORB = true;
          logger.info(`[DiscretionaryTrader] ⏳ Reconstructed partial ORB for ${symbol} (${sig}). Currently building: High: ${maxHigh.toFixed(5)}, Low: ${minLow.toFixed(5)}`);
        }
      }
    }

    const allSageConfigs = [
      ...sageConfigs.map(c => ({ config: c, botId: "sage" }))
    ];

    for (const item of allSageConfigs) {
      const config = item.config;
      const sig = config.signature || "default";

      const windowStart = getFixedEstDate();
      windowStart.setUTCHours(config.orbStartHour, config.orbStartMin, 0, 0);
      const isBeforeTodaySession = nowEst.getTime() < windowStart.getTime();
      if (isBeforeTodaySession) {
        windowStart.setUTCDate(windowStart.getUTCDate() - 1);
      }
      const windowEnd = new Date(windowStart.getTime() + config.orbMinutes * 60 * 1000);

      const yyyy = windowStart.getUTCFullYear();
      const mm = String(windowStart.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(windowStart.getUTCDate()).padStart(2, "0");
      const sessionDateStr = `${yyyy}-${mm}-${dd}`;
      const startMins = config.orbStartHour * 60 + config.orbStartMin;
      const endMins = startMins + config.orbMinutes;

      const orbCandles = state.m5Buffer.filter((c: any) => {
        if (c.dateStr !== sessionDateStr) return false;
        const cMins = c.estHour * 60 + c.estMinute;
        return cMins >= startMins && cMins <= endMins;
      });

      if (orbCandles.length > 0) {
        let maxHigh = -Infinity;
        let minLow = Infinity;
        for (const c of orbCandles) {
          if (c.high > maxHigh) maxHigh = c.high;
          if (c.low < minLow) minLow = c.low;
        }

        if (!state.sageStates[sig]) {
          state.sageStates[sig] = {
            sessionHigh: -Infinity,
            sessionLow: Infinity,
            orHigh: 0,
            orLow: 0,
            orBuilt: false,
            wasBuildingORB: false,
            sessionActive: false,
            limitPrice: 0,
            slPrice: 0,
            tpPrice: 0,
            limitOrderId: null,
            fired: false,
            currentDateStr: "",
            currentOrbDateStr: "",
            direction: null,
          };
        }

        const ss = state.sageStates[sig];
        ss.orHigh = maxHigh;
        ss.orLow = minLow;
        ss.sessionHigh = maxHigh;
        ss.sessionLow = minLow;
        ss.currentDateStr = sessionDateStr;
        ss.currentOrbDateStr = sessionDateStr;

        logger.info(`[DiscretionaryTrader] 🔮 Reconstructed Sage ORB for ${symbol} (${sig}): High: ${maxHigh.toFixed(5)}, Low: ${minLow.toFixed(5)}, Date: ${sessionDateStr}`);

        if (isBeforeTodaySession) {
          // Current time is before today's session start — do NOT lock out today's upcoming session!
          ss.orBuilt = false;
          ss.wasBuildingORB = false;
          ss.fired = false;
          if (!state.sageTradeTakenToday) state.sageTradeTakenToday = {};
          state.sageTradeTakenToday[sig] = false;
          logger.info(`[DiscretionaryTrader] 🔓 Upcoming Sage session today for ${symbol} (${sig}): Resetting lockout state for fresh ORB creation.`);
        } else if (nowEst.getTime() >= windowEnd.getTime()) {
          ss.orBuilt = true;
          ss.wasBuildingORB = false;
          logger.info(`[DiscretionaryTrader] ✅ Sage ORB window built historically for ${symbol} (${sig}).`);

          // Sage session sweep window is always 4 hours (240 mins) after ORB (AGENTS.md canonical rule)
          const sageSweepMins = 240;
          const isPastActionWindow = nowEst.getTime() >= windowEnd.getTime() + sageSweepMins * 60000;
          
          let sageTradeTaken = false;
          try {
            const existingSageTrade = await db.prepare(
              "SELECT id, status, open_time FROM bot_trade_states WHERE (profile_id = ? OR profile_id = ?) AND (broker_symbol = ? OR broker_symbol LIKE ? || '%') AND status NOT IN ('FAILED', 'CANCELLED') AND open_time >= ?"
            ).get(this.profileId, Number(this.profileId), symbol, symbol, windowStart.getTime());
            if (existingSageTrade) {
              sageTradeTaken = true;
              this.plog.verbose(`🔒 Sage lockout on ${symbol} (${sig}): DB trade #${existingSageTrade.id} already ${existingSageTrade.status}.`);
            }
          } catch (e) {}

          if (!state.sageTradeTakenToday) state.sageTradeTakenToday = {};
          state.sageTradeTakenToday[sig] = sageTradeTaken;

          if (sageTradeTaken) {
            ss.fired = true;
            logger.warn(`[DiscretionaryTrader] 🔒 Lockout activated for Sage ${symbol} (${sig}): Trade already executed today in DB.`);
          } else if (isPastActionWindow) {
            ss.fired = true;
            logger.warn(`[DiscretionaryTrader] 🔒 Lockout activated for Sage ${symbol} (${sig}): Past 4-hour Sage sweep window limit.`);
          } else {
            ss.fired = false;
            logger.info(`[DiscretionaryTrader] 🔓 Sage session active for ${symbol} (${sig}): No trade executed yet today. Live evaluation enabled for current price.`);
          }
        } else {
          ss.orBuilt = false;
          ss.wasBuildingORB = true;
          logger.info(`[DiscretionaryTrader] ⏳ Reconstructed partial Sage ORB for ${symbol} (${sig}). Currently building: High: ${maxHigh.toFixed(5)}, Low: ${minLow.toFixed(5)}`);
        }
      }
    }
  }

  async fillHistoryGaps(sessionPair) {
    const symbol = PairConfigManager.getBaseSymbol(sessionPair);
    const state = this.states.get(sessionPair);
    if (!state) return;

    let lastTimestamp = Date.now() - 24 * 60 * 60 * 1000;
    if (state.m5Buffer && state.m5Buffer.length > 0) {
      const lastCandle = state.m5Buffer[state.m5Buffer.length - 1];
      lastTimestamp = lastCandle.timestamp;
      const nowMs = Date.now();
      const gapMs = nowMs - lastTimestamp;
      if (gapMs < 5 * 60 * 1e3) {
        return;
      }
    }
    logger.info(`[DiscretionaryTrader] 🔍 Gap detected for ${symbol}. Last candle: ${new Date(lastTimestamp).toISOString()}. Filling history...`,);
    try {
      const { getSharedAccount: getSharedAccount2 } =
        await import("../broker/metaApiHandler.js").then((s) => {
          const e = "default";
          return s[e] && typeof s[e] == "object" && "__esModule" in s[e]
            ? s[e]
            : s;
        });
      const account = await getSharedAccount2(this.token, this.accountId);
      
      if (!this.customMap) {
        const profile = await db.prepare("SELECT broker_symbol_map FROM trading_profiles WHERE id = ?").get(this.profileId);
        this.customMap = profile && profile.broker_symbol_map ? JSON.parse(profile.broker_symbol_map) : {};
      }
      const brokerSym = this.customMap[symbol] || symbol;

      const startTime = new Date(lastTimestamp + 5 * 60 * 1e3);
      const nowMs = Date.now();
      const msGap = Math.max(0, nowMs - startTime.getTime());
      const expectedMissing = Math.ceil(msGap / (5 * 60 * 1000));
      const bufferedCount = Math.min(1000, Math.max(10, Math.ceil(expectedMissing * 1.10)));

      const rawM5 = await account.getHistoricalCandles(
        brokerSym,
        "5m",
        startTime,
        bufferedCount,
      );
      if (!rawM5 || rawM5.length === 0) {
        logger.info(`[DiscretionaryTrader] No historical candles found for gap period on ${symbol}.`,);
        return;
      }
      logger.info(`[DiscretionaryTrader] Found ${rawM5.length} gap candles for ${symbol}. Hydrating...`,);
      await this.saveM5CandlesToCache(symbol, rawM5);
      const mapCandles = __name((c) => {
        const d = new Date(c.time);
        const estDate = getFixedEstDate(d);
        const yyyy = estDate.getUTCFullYear();
        const mm = String(estDate.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(estDate.getUTCDate()).padStart(2, "0");
        return {
          timestamp: d.getTime(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          tickVolume: c.tickVolume || 1,
          dateStr: `${yyyy}-${mm}-${dd}`,
          estHour: estDate.getUTCHours(),
          estMinute: estDate.getUTCMinutes(),
        };
      }, "mapCandles");
      const mapped = rawM5
        .map(mapCandles)
        .sort((a, b) => a.timestamp - b.timestamp);
      const alpha = 2 / (20 + 1);
      for (const c of mapped) {
        if (
          state.m5Buffer.some((existing) => existing.timestamp === c.timestamp)
        ) {
          continue;
        }
        state.dailyTracker.processCandle(c);
        state.m5Buffer.push(c);
        state.lastEstHour = c.estHour ?? -1;
        let prevEma = state.emaArr[state.emaArr.length - 1];
        if (prevEma === void 0 || prevEma === null) {
          prevEma = c.close;
        }
        const ema = (c.close - prevEma) * alpha + prevEma;
        state.emaArr.push(ema);
        if (state.m5Buffer.length > 50e3) {
          state.m5Buffer.shift();
          if (state.emaArr.length > 0) state.emaArr.shift();
        }
      }
      logger.info(`[DiscretionaryTrader] ✅ Gap hydration complete for ${symbol}. Current buffer size: ${state.m5Buffer.length}`,);
    } catch (err) {
      const today = new Date();
      const isWeekend = today.getDay() === 0 || today.getDay() === 6;
      if (isWeekend) {
        logger.warn(`[DiscretionaryTrader] [Weekend Warning] Gap hydration failed/timed out for ${symbol} (Normal broker downtime on Saturday/Sunday): ${err.message}`);
      } else {
        logger.error(`[DiscretionaryTrader] ❌ Gap hydration failed for ${symbol}:`, err.message);
      }
    }
  }
  toggleBot(botId, active) {
    if (active) {
      this.activeBots.add(botId);
    } else {
      this.activeBots.delete(botId);
    }
  }
  isRunning() {
    return this.running;
  }
  getPipValue(pair) {
    if (
      pair === "NAS100" ||
      pair.includes("US30") ||
      pair.includes("GER40") ||
      pair.includes("ETH")
    )
      return 1;
    if (pair.includes("JPY")) return 6.7;
    if (pair.includes("CHF")) return 11.2;
    if (pair.includes("CAD")) return 7.3;
    if (pair.includes("AUD")) return 6.5;
    if (pair.includes("NZD")) return 6.1;
    if (pair === "EURGBP") return 12.7;
    return 10;
  }
  stop() {
    this.running = false;
    logger.info(`[DiscretionaryTrader] \u{1F52E} Stopped for profile ${this.profileId}`,);
    this.broadcastStatus();
  }
  async destroy() {
    this.stop();
    try {
      const { TickFeed } = await import("./TickFeed.js").then((s) => {
        const e = "default";
        return s[e] && typeof s[e] == "object" && "__esModule" in s[e]
          ? s[e]
          : s;
      });
      const feed = TickFeed.getInstance(this.profileId);
      if (feed) feed.stop();
    } catch (e) {}
    LiveOrchestrator.instances.delete(this.profileId);
    logger.info(`[DiscretionaryTrader] Instance destroyed for profile ${this.profileId}`,);
  }
  togglePair(pair, enabled, botId) {
    const safeBotId = botId || "seer";
    const state = this.states.get(pair);
    if (state) {
      const current = state.botConfigs.get(safeBotId);
      if (current) current.enabled = enabled;
      else state.botConfigs.set(safeBotId, { enabled, risk: state.riskPct });
    }
    logger.info(`[DiscretionaryTrader] Toggle pair ${pair} to ${enabled} for bot ${safeBotId}`,);
    this.broadcastStatus(safeBotId);
  }
  setPairRisk(pair, riskPct, botId) {
    const safeBotId = botId || "seer";
    const state = this.states.get(pair);
    if (state) {
      const current = state.botConfigs.get(safeBotId);
      if (current) current.risk = riskPct;
      else state.botConfigs.set(safeBotId, { enabled: true, risk: riskPct });
      if (safeBotId === "seer") state.riskPct = riskPct;
    }
    logger.info(`[DiscretionaryTrader] Set pair risk ${pair} to ${riskPct}% for bot ${safeBotId}`,);
    this.broadcastStatus(safeBotId);
  }
  force1PercentRisk() {
    for (const state of this.states.values()) {
      state.riskPct = 1;
    }
    this.broadcastStatus();
  }
  setBotRisk(botId, riskPct) {
    const safeBotId = botId || "seer";
    this.botRisks[safeBotId] = riskPct;
    for (const state of this.states.values()) {
      const current = state.botConfigs.get(safeBotId);
      if (current) current.risk = riskPct;
      else state.botConfigs.set(safeBotId, { enabled: true, risk: riskPct });
      if (safeBotId === "seer") state.riskPct = riskPct;
    }
    logger.info(`[DiscretionaryTrader] Set global risk to ${riskPct}% for bot ${safeBotId}`,);
    this.broadcastStatus(safeBotId);
  }
  getStatus(botId) {
    const pairBiases = {};
    const safeBotId = botId || "seer";
    const now = new Date();
    const estDate = getFixedEstDate(now);
    const liveEstHour = estDate.getUTCHours();
    const liveEstMin = estDate.getUTCMinutes();
    for (const [symbol, state] of this.states.entries()) {
      const prevDay = state.dailyTracker?.getPreviousDayContext();
      let bias = "NONE";
      if (prevDay?.isFirstRedDay) bias = "FRD";
      else if (prevDay?.isFirstGreenDay) bias = "FGD";
      else if (prevDay?.isDay3BreakoutLongs) bias = "DAY3_LONG";
      else if (prevDay?.isDay3BreakoutShorts) bias = "DAY3_SHORT";
      else if (prevDay?.isInsideDay) bias = "INSIDE_DAY";
      else if (prevDay?.isTrendingLong) bias = "LHF_LONG";
      else if (prevDay?.isTrendingShort) bias = "LHF_SHORT";
      else if (prevDay?.isPumpDay) bias = "PUMP (Day 1)";
      else if (prevDay?.isDumpDay) bias = "DUMP (Day 1)";
      
      // Prevent Seer's Stacy Burke logic from bleeding into Sage/Mage UIs
      if (safeBotId !== "seer") {
        bias = "NONE";
      }
      const h = liveEstHour;
      const inLondon = h >= 2 && h < 5;
      const inNY = h >= 8 && h < 11;
      const inAsia = h >= 20 && h < 23;
      const inWindow = inLondon || inNY || inAsia;
      let windowName = "None";
      if (inLondon) windowName = "London";
      if (inNY) windowName = "New York";
      if (inAsia) windowName = "Asian";
      pairBiases[symbol] = {
        bias,
        inWindow,
        windowName,
        estHour: liveEstHour,
        estMin: liveEstMin,
        riskPct: state.riskPct,
      };
    }
    let visiblePairs = Array.from(this.states.keys()).filter((p) => {
      if (safeBotId === "mage") return PairConfigManager.getMageConfigs(p)?.length > 0;
      if (safeBotId === "sage") return PairConfigManager.getSageConfigs(p)?.length > 0;
      if (safeBotId === "seer") return PairConfigManager.getSeerConfigs(p)?.length > 0;

      return true;
    });
    return {
      botId: safeBotId,
      running: this.running,
      activeBots: Array.from(this.activeBots),
      pairs: visiblePairs,
      pairStates: Object.fromEntries(
        Array.from(this.states.entries())
          .filter(([p]) => visiblePairs.includes(p))
          .map(([p, s]) => {
            const filteredActiveTrades = (s.activeTrades || []).filter((t: any) => {
              const bId = (t.botId || "").toLowerCase();
              if (safeBotId === "mage") return bId === "mage" || bId === "orb" || bId.startsWith("m_");
              if (safeBotId === "sage") return bId === "sage" || bId === "reversal" || bId.startsWith("s_");
              if (safeBotId === "seer") return bId === "seer" || bId === "discretionary_trader" || bId.startsWith("seer_");
              return bId === safeBotId;
            });

            const hasLimit =
              safeBotId === "mage"
                ? (s.orbStates && Object.values(s.orbStates).some((os: any) => os.limitOrderId && !os.fired))
                : safeBotId === "sage"
                ? (s.reversalStates && Object.values(s.reversalStates).some((rs: any) => rs.limitOrderId && !rs.fired))
                : false;

            return [
              p,
              {
                enabled: s.botConfigs.get(safeBotId)?.enabled !== false,
                riskPct: s.botConfigs.get(safeBotId)?.risk || s.riskPct,
                hasActiveTrade: filteredActiveTrades.length > 0,
                activeTradesList: filteredActiveTrades,
                hasLimitOrder: hasLimit,
              },
            ];
          }),
      ),
      pairBiases,
      botRisks: this.botRisks,
      recentEyeFeed: this.recentEyeFeed,
      lastUpdated: new Date().toISOString(),
    };
  }
  clearActiveTrade(metaOrderId) {
    for (const [sp, state] of this.states.entries()) {
      if (state) {
        if (state.activeTrade && String(state.activeTrade.metaOrderId) === String(metaOrderId)) {
          delete state.activeTrade;
        }
        if (state.activeTrades && state.activeTrades.length > 0) {
          const initialCount = state.activeTrades.length;
          state.activeTrades = state.activeTrades.filter(t => String(t.metaOrderId) !== String(metaOrderId));
          if (state.activeTrades.length < initialCount) {
            try {
              logger.info(`[DiscretionaryTrader] 🗑️ Cleared ghost trade ${metaOrderId} for ${sp} from Orchestrator memory.`);
            } catch(e) {}
          }
        }
      }
    }
  }

  onBrokerPositionClosed(metaOrderId: string) {
    let found = false;
    for (const [sp, state] of this.states.entries()) {
      if (state) {
        if (state.activeTrade && String(state.activeTrade.metaOrderId) === String(metaOrderId)) {
          delete state.activeTrade;
          found = true;
        }
        if (state.activeTrades) {
          const idx = state.activeTrades.findIndex((t: any) => String(t.metaOrderId) === String(metaOrderId));
          if (idx !== -1) {
            const trade = state.activeTrades[idx];
            state.activeTrades.splice(idx, 1);
            found = true;
            logger.info(`[DiscretionaryTrader] 🧹 Broker closed position ${metaOrderId} on ${sp}. Removing from active tracking.`);
            // Mark CLOSED in DB — fire-and-forget, non-blocking
            if (trade.dbId) {
              try {
                db.prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ? AND status != 'CLOSED'").run(trade.dbId);
              } catch (e: any) {
                logger.error(`[DiscretionaryTrader] Failed to mark trade ${metaOrderId} as CLOSED in DB:`, e.message);
              }
            }
            // Release the GlobalTradeGate slot so the bot can take new trades
            try {
              globalTradeGate.release(this.profileId, metaOrderId);
            } catch (_) {}
          }
        }
      }
    }
    if (found) this.broadcastStatus();
  }

  broadcastStatus(botId?: string) {
    const io = getIO();
    if (io) {
      if (botId) {
        io.to(`profile_${this.profileId}`).emit(
          "discretionary_trader:status",
          this.getStatus(botId),
        );
      } else {
        for (const b of ["mage", "sage", "seer"]) {
          io.to(`profile_${this.profileId}`).emit(
            "discretionary_trader:status",
            this.getStatus(b),
          );
        }
      }
    }
  }

  handlePositionUpdate(pos) {
    if (!this.running || !this.warmedUp) return;
    const symbol = pos.symbol;
    const matchingPairs = Array.from(this.states.keys()).filter(
      (k) => PairConfigManager.getBaseSymbol(k) === symbol,
    );
    for (const sp of matchingPairs) {
      const state = this.states.get(sp);
      if (state && state.activeTrades) {
        const trade = state.activeTrades.find(t => String(t.metaOrderId) === String(pos.id));
        if (trade) {
          // Position matches our active trade, check if sl/tp differs significantly (i.e. >1 pip mismatch)
          const pipSize = state.config.pair.includes("BTC") ? 10 :
                          state.config.pair.includes("ETH") ? 1 :
                          state.config.pair.includes("JPY") ? 0.01 :
                          state.config.tickSize === 1e-4 ? 1e-4 : state.config.tickSize * 10;
          
          const posSL = pos.sl !== undefined ? pos.sl : pos.stopLoss;
          const posTP = pos.tp !== undefined ? pos.tp : pos.takeProfit;
          const slDiff = Math.abs(posSL - trade.slPrice);
          const tpDiff = Math.abs(posTP - trade.tpPrice);
          
          const isTradeManagerEmergencySl = Math.abs(Math.abs(posSL - trade.entryPrice) - 50 * pipSize) < (pipSize * 2) || posSL === 0;

          // If difference is more than 0.5 pips, consider it a manual modification by the user
          if (slDiff > pipSize * 0.5 || tpDiff > pipSize * 0.5) {
            if (isTradeManagerEmergencySl && slDiff > pipSize * 0.5) {
              if (!trade.isVirtualSlMode) {
                try {
                  logger.warn(`[DiscretionaryTrader] 🛡️ TradeManager emergency SL detected for trade ${pos.id}. Broker stripped last SL. Engaging Virtual SL Fallback Mode.`);
                } catch(e) {}
                trade.isVirtualSlMode = true;
              }
              // Do NOT detach, and do NOT overwrite trade.slPrice (keep our tight internal trailing SL)
            } else {
              if (!trade.manuallyModified) {
                try {
                  logger.warn(`[DiscretionaryTrader] ✋ Manual modification detected on ${sp} for trade ${pos.id}. Detaching trailing bot logic.`);
                } catch(e) {}
                trade.manuallyModified = true;
              }
              // Sync internal state to the manual modification so UI shows actual
              trade.slPrice = posSL;
              trade.tpPrice = posTP;
            }
            trade.slPrice = posSL;
            trade.tpPrice = posTP;
          }
        }
      }
    }
  }

  async onM1Tick(symbol, open, high, low, close, vol, timestampMs) {
    if (!this.running || !this.warmedUp) return;
    return profileContext.run(Number(this.profileId) || 0, async () => {
      try {
        const matchingPairs = Array.from(this.states.keys()).filter(
          (k) => PairConfigManager.getBaseSymbol(k) === symbol,
        );
        if (matchingPairs.length === 0) return;
    
        for (const sessionPair of matchingPairs) {
          const state = this.states.get(sessionPair);
          if (!state) continue;
          await this._processTickForState(
            sessionPair,
            symbol,
            state,
            open,
            high,
            low,
            close,
            vol,
            timestampMs,
          );
        }
      } catch (err) {
        if (!this.loggerInited) {
          this.loggerInited = true;
          logger.info(`LiveOrchestrator (Sim/Live) Started. WarmedUp: ${this.warmedUp}`);
        }
        logger.error(`[CRITICAL] Orchestrator Engine crashed on tick for ${symbol}. Tick Data: O:${open} H:${high} L:${low} C:${close}. Error: ${err.message}`, err);
      }
    });
  }

  async _processTickForState(
    sessionPair,
    symbol,
    state,
    open,
    high,
    low,
    close,
    vol,
    timestampMs,
  ) {
    if (!this.running || !this.warmedUp) return;
    if (
      state.lastProcessedM1Timestamp !== void 0 &&
      timestampMs <= state.lastProcessedM1Timestamp
    ) {
      return;
    }
    state.lastProcessedM1Timestamp = timestampMs;
    if (!this.warmedUp) return;

    const currentM5Start =
      Math.floor(timestampMs / (5 * 60 * 1e3)) * (5 * 60 * 1e3);
    const d = new Date(timestampMs);
    const estDate = getFixedEstDate(d);
    const estHour = estDate.getUTCHours();
    
    if (state.lastEvaluatedM5Start === void 0 || currentM5Start > state.lastEvaluatedM5Start) {
      state.lastEstHour = estHour;
      if (!this.apiLockouts.has(symbol) || Date.now() >= this.apiLockouts.get(symbol)) {
        const periodMs = 5 * 60 * 1e3;
        if (state.m1PeriodStart === 0) {
          // Initialize accumulator on the very first tick received after startup,
          // regardless of whether it lands exactly on a 5-min boundary.
          // Previously this required timestampMs === currentM5Start (almost impossible mid-session),
          // which caused the M5 buffer to NEVER receive new live candles after a restart.
          state.m1PeriodStart = currentM5Start;
          state.m1AccumOpen = open;
          state.m1AccumHigh = high;
          state.m1AccumLow = low;
          state.m1AccumClose = close;
          state.m1AccumVol = vol;
          state.m1AccumCount = 1;
        } else if (currentM5Start > state.m1PeriodStart) {
          const m5Candle = {
            open: state.m1AccumOpen,
            high: state.m1AccumHigh,
            low: state.m1AccumLow,
            close: state.m1AccumClose,
            tickVolume: state.m1AccumVol,
            timestamp: state.m1PeriodStart,
            dateStr: new Date(state.m1PeriodStart).toISOString(),
            estHour: getFixedEstDate(new Date(state.m1PeriodStart)).getUTCHours(),
            estMin: getFixedEstDate(new Date(state.m1PeriodStart)).getUTCMinutes(),
          };
          await this.onM5Close(symbol, state, m5Candle);
          state.m1PeriodStart = currentM5Start;
          state.m1AccumOpen = open;
          state.m1AccumHigh = high;
          state.m1AccumLow = low;
          state.m1AccumClose = close;
          state.m1AccumVol = vol;
          state.m1AccumCount = 1;
        } else {
          state.m1AccumHigh = Math.max(state.m1AccumHigh, high);
          state.m1AccumLow = Math.min(state.m1AccumLow, low);
          state.m1AccumClose = close;
          state.m1AccumVol += vol;
          state.m1AccumCount++;
        }
      }
    }

    const sageEstDate = getFixedEstDate(new Date(timestampMs));
    const m1Candle = {
      open,
      high,
      low,
      close,
      volume: vol,
      timestamp: timestampMs,
      dateStr: new Date(timestampMs).toISOString(),
      estHour: sageEstDate.getUTCHours(),
      estMin: sageEstDate.getUTCMinutes(),
    };

    if (state.activeTrades) {
      for (const trade of state.activeTrades) {
        if (trade.isVirtualSlMode) {
          const isHit = trade.direction === "BUY" ? (close <= trade.slPrice) : (close >= trade.slPrice);
          if (isHit) {
            import('../../utils/logger.js').then(({ logger }) => {
              logger.warn(`[DiscretionaryTrader] 💥 Virtual SL Hit for trade ${trade.metaOrderId} at ${close}! Closing market position.`);
            }).catch(() => {});
            try {
              import('../../trading/broker/metaApiHandler.js').then(({ getSharedConnection }) => {
                 getSharedConnection(this.token, this.accountId).then(conn => {
                     conn.closePosition(trade.metaOrderId).catch(() => {});
                 });
              });
              this.clearActiveTrade(trade.metaOrderId);
            } catch(e) {}
          }
        }
      }
    }

    // ── Watermark Persistence (every 5 minutes per trade) ────────────────────────
    // Persists trade.highestPrice & trade.lowestPrice to the DB so server restarts
    // don't lose the high-water mark, which would cause the trailing engine to
    // clamp the SL aggressively against the current price on the first tick.
    if (state.activeTrades) {
      const WATERMARK_PERSIST_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
      for (const trade of state.activeTrades) {
        if (trade.isVirtualSlMode) continue; // Virtual mode trades don't need this
        const now = Date.now();
        if (!trade._lastWatermarkPersistAt || now - trade._lastWatermarkPersistAt >= WATERMARK_PERSIST_INTERVAL_MS) {
          const newHighest = trade.direction === "BUY"
            ? Math.max(trade.highestPrice || trade.entryPrice, high)
            : (trade.highestPrice || trade.entryPrice);
          const newLowest = trade.direction === "SELL"
            ? Math.min(trade.lowestPrice || trade.entryPrice, low)
            : (trade.lowestPrice || trade.entryPrice);
          trade.highestPrice = newHighest;
          trade.lowestPrice = newLowest;
          trade._lastWatermarkPersistAt = now;
          // Fire-and-forget async DB write — does NOT block the tick loop
          db.prepare(
            "UPDATE bot_trade_states SET highest_price = ?, lowest_price = ? WHERE id = ?"
          ).run(newHighest, newLowest, trade.dbId).catch?.(() => {});
        }
      }
    }

    if (
      this.activeBots.has("sage") &&
      PairConfigManager.getSageConfigs(sessionPair)?.length > 0
    ) {
      await cancelSagePendingOnNews(this, sessionPair, state, m1Candle).catch((e) =>
        logger.error(`Sage cancel on news error on ${sessionPair}:`, e),
      );
      await runSageBot(this, sessionPair, state, m1Candle).catch((e) =>
        logger.error(`Sage error on ${sessionPair}:`, e),
      );
      await checkSageLimitFill(this, sessionPair, state, m1Candle).catch((e) =>
        logger.error(`Sage limit fill error on ${sessionPair}:`, e),
      );
      await evaluateSageTrailingOnTick(this, sessionPair, state, m1Candle).catch(
        (e) => logger.error(`Sage trailing error on ${sessionPair}:`, e),
      );
    }

    if (
      this.activeBots.has("mage") &&
      PairConfigManager.getMageConfigs(sessionPair)?.length > 0
    ) {
      await cancelMagePendingOnNews(this, sessionPair, state, m1Candle).catch((e) =>
        logger.error(`Mage cancel on news error on ${sessionPair}:`, e),
      );
      await checkMageLimitFill(this, sessionPair, state, m1Candle).catch((e) =>
        logger.error(`Mage limit fill error on ${sessionPair}:`, e),
      );
      await evaluateMageTrailingOnTick(this, sessionPair, state, m1Candle).catch(
        (e) => logger.error(`[DiscretionaryTrader] Error evaluating Mage trailing SL for ${sessionPair}:`, e),
      );
    }




  }

  async onM5Close(symbol, state, c) {
    const sessionPair = state.config.pair;
    if (state.orbStates) {
      for (const sig of Object.keys(state.orbStates)) {
        const os = state.orbStates[sig];
        if (
          os &&
          os.limitOrderId &&
          (!state.activeTrades || !state.activeTrades.find(t => t.clientId === sig))
        ) {
          try {
            const conn = await getSharedConnection(this.token, this.accountId);
            const positions = await enqueueMetaApiRequest(
              async () =>
                (
                  await getSharedConnection(this.token, this.accountId)
                ).getPositions(),
              `Positions:${symbol}`,
            );
            const dirType =
              os.breakoutDir === "BUY"
                ? "POSITION_TYPE_BUY"
                : "POSITION_TYPE_SELL";
            const pos = positions.find(
              (p) => p.symbol === symbol && p.type === dirType && (p.clientId === sig || p.clientId?.startsWith("MAGE") || p.clientId?.startsWith("M_")),
            );
            if (pos) {
              const mageConfigs = PairConfigManager.getMageConfigs(sessionPair);
              const config = mageConfigs.find(c => c.signature === sig) || mageConfigs[0] || state.config;
              const pipSize = getDynamicPipSize(symbol);
          const riskPips =
            Math.abs(pos.openPrice - os.slPrice) / pipSize;
          const tp = await db
            .prepare("SELECT user_id FROM trading_profiles WHERE id = ?")
            .get(this.profileId);
          const actualUserId = tp ? tp.user_id : 0;
          const insertTrade = await db.prepare(`
            INSERT INTO bot_trade_states
              (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, original_sl, tp_price,
               lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, initial_risk_pips, status)
            VALUES (?, ?, 'MAGE', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'OPEN')
          `);
          const openTimeVal = pos.time
            ? new Date(pos.time).getTime()
            : Date.now();
          const runResult = await insertTrade.run(
            actualUserId,
            this.profileId,
            symbol,
            os.breakoutDir,
            pos.openPrice,
            os.slPrice,
            os.slPrice,
            os.tpPrice,
            pos.volume,
            openTimeVal,
            pos.id,
            pos.openPrice,
            pos.openPrice,
            riskPips,
          );
          const dbId = runResult.lastInsertRowid;
          
          if (!state.activeTrades) state.activeTrades = [];
          
          state.activeTrades.push({
            dbId,
            metaOrderId: pos.id,
            clientId: sig,
            botId: "MAGE",
            direction: os.breakoutDir,
            entryPrice: pos.openPrice,
            slPrice: os.slPrice,
            originalSl: os.slPrice,
            tpPrice: os.tpPrice,
            riskPips,
            highestPrice: pos.openPrice,
            lowestPrice: pos.openPrice,
            isTrailing: false,
            volume: pos.volume,
            hasTakenPartial: false,
            unconfirmedSwingLow: null,
            unconfirmedSwingHigh: null,
            lastSwingHigh: null,
            lastSwingLow: null,
            openTime: openTimeVal,
          });
          os.limitOrderId = null;
          
          globalTradeGate.register(
            this.profileId,
            pos.id,
            symbol,
            os.breakoutDir,
            "DISC",
          );
          logger.info(`[DiscretionaryTrader] \u2705 Mage Limit Filled on ${symbol} (Config: ${sig}) at ${pos.openPrice}`,);
          this.broadcastStatus("mage");
        }
      } catch (e) {
        logger.error(`[DiscretionaryTrader] Error checking Mage limit for ${sig}:`, e);
      }
    }
  }
}
    if (
      state.lastEvaluatedM5Start !== void 0 &&
      c.timestamp <= state.lastEvaluatedM5Start
    ) {
      return;
    }
    state.lastEvaluatedM5Start = c.timestamp;
    state.m5Buffer.push(c);
    state.dailyTracker.processCandle(c);
    this.saveM5CandlesToCache(symbol, [c]).catch(() => {});
    const alpha = 2 / (20 + 1);
    let ema = null;
    if (state.m5Buffer.length === 1) {
      ema = c.close;
    } else if (state.emaArr.length > 0) {
      const prevEma = state.emaArr[state.emaArr.length - 1];
      if (prevEma !== null) {
        ema = (c.close - prevEma) * alpha + prevEma;
      }
    }
    state.emaArr.push(ema);
    // Minimum 1 candle needed (not 14) — the old guard of 14 blocked MageEngine for
    // 70 minutes on forex pairs whose warmup failed due to missing broker symbol mapping.
    // 1 candle is sufficient: EMA warm-up happens naturally over time.
    if (state.m5Buffer.length < 1) return;
    if (state.m5Buffer.length > 50e3) {
      state.m5Buffer.shift();
      state.emaArr.shift();
    }
    if (
      this.activeBots.has("mage") &&
      PairConfigManager.getMageConfigs(state.config.pair)?.length > 0 &&
      PairConfigManager.isOrbEnabled(state.config.pair)
    ) {
      runMageBot(this, state.config.pair, state, c).catch((e) =>
        logger.error(`[DiscretionaryTrader] Mage ORB error on ${state.config.pair}:`,
          e,),
      );
    }

    if (state.m5Buffer.length >= 5) {
      if (
        state.activeTrade &&
        (state.activeTrade.botId === "SEER" ||
         state.activeTrade.botId === "seer")
      ) {
        evaluateSeerTrailingOnTick(this, state.config.pair, state).catch((e) =>
          logger.error(`[DiscretionaryTrader] Error evaluating structural SL for ${state.config.pair}:`,
            e,),
        );
      }
    }
    const prevDay = state.dailyTracker.getPreviousDayContext();
    if (!prevDay) return;
    let setupType = null;
    if (prevDay.isFirstRedDay) setupType = "FRD";
    else if (prevDay.isFirstGreenDay) setupType = "FGD";
    else if (prevDay.isDay3BreakoutLongs) setupType = "DAY3_LONG";
    else if (prevDay.isDay3BreakoutShorts) setupType = "DAY3_SHORT";
    else if (prevDay.isInsideDay) setupType = "INSIDE_DAY";
    else if (prevDay.isTrendingLong) setupType = "LHF_LONG";
    else if (prevDay.isTrendingShort) setupType = "LHF_SHORT";
    if (!setupType) return;

    const now = Date.now();
    const botId = this.getBotIdForSetup(setupType);
    const lastChatter = this.lastChatterMs.get(botId) || 0;
    if (now - lastChatter > 15 * 60 * 1e3) {
      this.lastChatterMs.set(botId, now);
      this.broadcastIdleChatter(symbol, setupType, botId);
    }
    runPreFlightFilter(this, symbol, state, prevDay, setupType).catch((e) =>
      logger.error(`[DiscretionaryTrader] Eval error on ${symbol}:`, e),
    );
  }
  broadcastIdleChatter(symbol, setupType, botId) {
    if (!this.activeBots.has(botId)) return;
    let botName = "The DiscretionaryTrader";
    if (botId === "seer") botName = "The Seer";
    if (botId === "mage") botName = "The Mage";
    if (botId === "sage") botName = "The Sage";
    let msg = `${botName} is observing structure.`;
    if (botId === "mage") {
      const msgs = [
        `${botName} is studying the 9:30 AM range. The market does not give its secrets easily.`,
        `${botName} is watching the Opening Range. Waiting for the institutional breakout...`,
        `${botName} notes the range boundaries. Patience is key before the storm.`,
      ];
      msg = msgs[Math.floor(Math.random() * msgs.length)];
    } else if (botId === "seer") {
      if (setupType === "FRD")
        msg = `${botName} is tracking First Red Day liquidity traps below the PDH.`;
      if (setupType === "FGD")
        msg = `${botName} is hunting First Green Day mean-reversions at the PDL.`;
      if (setupType === "DAY3_LONG")
        msg = `${botName} is sensing exhaustion after 3 days of selling.`;
      if (setupType === "DAY3_SHORT")
        msg = `${botName} is anticipating a reversal after 3 days of buying.`;
      if (setupType === "INSIDE_DAY")
        msg = `${botName} is analyzing the tightening equilibrium of an Inside Day.`;
      if (setupType === "LHF_LONG")
        msg = `${botName} is preparing for trend continuation into new highs.`;
      if (setupType === "LHF_SHORT")
        msg = `${botName} is stalking the next leg down in the macro trend.`;
    } else if (botId === "sage") {
      const msgs = [
        `${botName} is monitoring extreme price deviations.`,
        `${botName} is hunting for exhaustion reversals.`,
        `${botName} is waiting for structural failure at the extremes.`,
      ];
      msg = msgs[Math.floor(Math.random() * msgs.length)];
    }
    this.addEyeFeedEvent({ type: "IDLE", symbol, message: msg, bot_id: botId });
  }
}

if (globalTradeGate && typeof (globalTradeGate as any).onLeadTrade === "function") {
  (globalTradeGate as any).onLeadTrade((leadTrade: any) => {
    LiveOrchestrator.broadcastLeadTrade(leadTrade);
  });
}


//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJtYXBwaW5ncyI6ImtIQUVBLE9BQU8sSUFBTSxjQUFpQixjQUM5QixPQUFTLFVBQWEsa0JBQ3RCLE9BQVMsb0JBQXFCLGlCQUFrQixjQUFlLHFCQUFzQixvQkFBdUIsMEJBQzVHLE9BQVMsd0JBQTJCLG1DQUVwQyxPQUFTLGdCQUFtQix1QkFDNUIsT0FBUyxvQkFBdUIsMkJBQ2hDLE9BQVMsWUFBYSxtQkFBc0IseUJBQzVDLE9BQVMsWUFBNkMsc0JBQXlCLDBCQUMvRSxPQUFTLG9CQUF1QixpQ0FDaEMsT0FBUyxtQkFBc0IsMkJBQy9CLE9BQVMsMEJBQTZCLDhCQUN0QyxPQUFTLG1CQUFzQixxQkFFL0IsTUFBTSxZQUFjLElBQUksSUFBSSxDQUMxQixTQUFVLFNBQVUsU0FDcEIsU0FBVSxTQUFVLFNBQVUsU0FDOUIsU0FBVSxTQUFVLFNBQVUsUUFDaEMsQ0FBQyxFQUVNLFNBQVMsZ0JBQWdCLEtBQWEsSUFBSSxLQUFjLENBQzdELE1BQU0sb0JBQXNCLElBQzVCLE1BQU0sbUJBQXFCLEtBQUssa0JBQWtCLEVBQ2xELE1BQU0sU0FBVyxtQkFBcUIscUJBQXVCLEdBQUssSUFDbEUsT0FBTyxJQUFJLEtBQUssS0FBSyxRQUFRLEVBQUksT0FBTyxDQUMxQyxDQUxnQiwwQ0FZVCxNQUFNLDJCQUEyQyxPQUFPLFFBQVEsV0FBVyxFQUFFLElBQUksQ0FBQyxDQUFDLEtBQU0sR0FBRyxLQUFPLENBQUUsS0FBTSxHQUFHLEdBQUksRUFBRSxFQUUzSCxTQUFTLGtCQUFrQixJQUFtQixDQUM1QyxNQUFNLEtBQU8sSUFBSSxTQUFXLElBQUksWUFBWSxFQUM1QyxPQUFPLElBQUksU0FBUyxTQUFTLEdBQUssSUFBSSxTQUFTLFNBQVMsR0FBSyxJQUFJLFNBQVMsWUFBWSxHQUMvRSxJQUFJLFNBQVMsWUFBWSxHQUFLLElBQUksU0FBUyxTQUFTLEdBQUssSUFBSSxTQUFTLFFBQVEsR0FDOUUsSUFBSSxTQUFTLFlBQVksR0FBSyxJQUFJLFNBQVMsbUJBQW1CLEdBQzlELElBQUksU0FBUyxLQUFLLEdBQUssSUFBSSxTQUFTLEtBQUssR0FBSyxJQUFJLFNBQVMsS0FBSyxDQUN6RSxDQU5TLDhDQThFRixNQUFNLGdCQUFpQixDQTZCNUIsWUFBWSxVQUFtQixNQUFlLFVBQW1CLENBekJqRSxLQUFRLFFBQVUsTUFDbEIsS0FBUSxTQUFXLE1BQ25CLEtBQU8sV0FBYSxJQUFJLElBQ3hCLEtBQVEsT0FBUyxJQUFJLElBRXJCLEtBQVEsWUFBYyxJQUFJLElBRTFCLEtBQVEsY0FBZ0IsSUFBSSxJQUM1QixLQUFRLGNBQXVCLENBQUMsRUFrQjlCLEtBQUssVUFBWSxVQUNqQixLQUFLLE1BQVEsTUFDYixLQUFLLFVBQVkscUJBQXFCLFNBQVMsRUFDL0MsS0FBSyxVQUFZLElBQUksZ0JBQWdCLFFBQVEsSUFBSSxzQkFBd0IsUUFBUSxJQUFJLGdCQUFrQixRQUFRLElBQUksZ0JBQWtCLEVBQUUsRUFFdkksMkJBQTJCLFFBQVEsS0FBTyxDQUN4QyxLQUFLLE9BQU8sSUFBSSxJQUFJLEtBQU0sQ0FDeEIsT0FBUSxDQUFFLEdBQUcsWUFBWSxJQUFJLElBQUksRUFBRyxLQUFNLElBQUksS0FBTSxLQUFNLElBQUksSUFBSyxFQUNqRSxXQUFZLElBQUksSUFBZ0QsQ0FDOUQsQ0FBQyxPQUFRLENBQUUsUUFBUyxLQUFNLEtBQU0sRUFBSyxDQUFDLEVBQ3RDLENBQUMsT0FBUSxDQUFFLFFBQVMsS0FBTSxLQUFNLEVBQUssQ0FBQyxDQUN4QyxDQUFDLEVBQ0gsU0FBVSxDQUFDLEVBQ1gsYUFBYyxJQUFJLG9CQUNsQixhQUFjLE1BQ2QsWUFBYSxFQUFHLFlBQWEsRUFBRyxXQUFZLEVBQUcsYUFBYyxFQUFHLFdBQVksRUFBRyxhQUFjLEVBQUcsY0FBZSxFQUMvRyxZQUFhLEdBQ2IsT0FBUSxDQUFDLEVBQ1QsUUFBUyxHQUNULHlCQUEwQixFQUMxQixxQkFBc0IsQ0FDeEIsQ0FBQyxDQUNILENBQUMsQ0FDSCxDQXZLRixNQWtIOEIsaUNBY3BCLGlCQUFpQixVQUEyQixDQUNsRCxNQUFPLE1BQ1QsQ0FFUSxnQkFBZ0IsTUFBWSxDQUNsQyxNQUFNLFVBQVksSUFBSSxLQUFLLEVBQUUsWUFBWSxFQUN6QyxLQUFLLGNBQWMsUUFBUSxLQUFLLEVBQ2hDLEdBQUksS0FBSyxjQUFjLE9BQVMsSUFBSyxLQUFLLGNBQWMsSUFBSSxFQUM1RCxNQUFNLEdBQUssTUFBTSxFQUNqQixHQUFJLEdBQUksQ0FDTixHQUFHLEdBQUcsV0FBVyxLQUFLLFNBQVMsRUFBRSxFQUFFLEtBQUssZ0NBQWlDLEtBQUssQ0FDaEYsQ0FDRixDQTZCQSxZQUFlLFVBQVksSUFBSSxJQUUvQixPQUFPLFlBQVksVUFBNEMsQ0FDN0QsT0FBTyxpQkFBaUIsVUFBVSxJQUFJLFNBQVMsR0FBSyxJQUN0RCxDQUVBLE9BQU8sT0FBTyxVQUFtQixNQUFlLFVBQXFDLENBQ25GLElBQUksU0FBVyxpQkFBaUIsVUFBVSxJQUFJLFNBQVMsRUFDdkQsR0FBSSxTQUFVLFNBQVMsS0FBSyxFQUM1QixNQUFNLFFBQVUsSUFBSSxpQkFBaUIsVUFBVyxNQUFPLFNBQVMsRUFDaEUsaUJBQWlCLFVBQVUsSUFBSSxVQUFXLE9BQU8sRUFDakQsT0FBTyxPQUNULENBRUEsTUFBTSxPQUFRLENBQ1osS0FBSyxRQUFVLEtBQ2YsUUFBUSxJQUFJLDJFQUFvRSxLQUFLLFNBQVMsRUFBRSxFQUtoRyxHQUFJLENBQ0YsTUFBTUEsS0FBTSxLQUFNLFFBQU8sYUFBYSwrRkFBRyxRQUN6QyxNQUFNLFFBQVUsTUFBTUEsSUFBRyxRQUFRLHlEQUF5RCxFQUFFLElBQUksS0FBSyxTQUFTLEVBQzlHLFVBQVcsT0FBTyxRQUFTLENBQ3pCLE1BQU0sTUFBUSxLQUFLLE9BQU8sSUFBSSxJQUFJLElBQUksRUFDdEMsR0FBSSxNQUFPLENBQ1QsTUFBTSxRQUFVLElBQUksMkJBQTZCLEdBRWpELEdBQUksSUFBSSxlQUFpQixPQUFXLE1BQU0sV0FBVyxJQUFJLE9BQVEsQ0FBRSxRQUFTLElBQUksZUFBaUIsRUFBRyxLQUFNLElBQUksV0FBYSxFQUFLLENBQUMsRUFDakksR0FBSSxJQUFJLGVBQWlCLE9BQVcsTUFBTSxXQUFXLElBQUksT0FBUSxDQUFFLFFBQVMsSUFBSSxlQUFpQixFQUFHLEtBQU0sSUFBSSxXQUFhLEVBQUssQ0FBQyxDQUNuSSxDQUNGLENBQ0YsT0FBUyxJQUFLLENBQ1osUUFBUSxNQUFNLHFEQUFzRCxHQUFHLENBQ3pFLENBR0EsR0FBSSxDQUNGLE1BQU1BLEtBQU0sS0FBTSxRQUFPLGFBQWEsK0ZBQUcsUUFDekMsTUFBTSxXQUFhLE1BQU1BLElBQUcsUUFBUSwwR0FBMEcsRUFBRSxJQUFJLEtBQUssU0FBUyxFQUNsSyxVQUFXLEtBQUssV0FBWSxDQUMxQixNQUFNLE9BQVMsRUFBRSxjQUNqQixNQUFNLE1BQVEsS0FBSyxPQUFPLElBQUksTUFBTSxFQUNwQyxHQUFJLENBQUMsTUFBTyxTQUVaLE1BQU0sWUFBYyxDQUNsQixLQUFNLEVBQUUsR0FDUixZQUFhLEVBQUUsY0FDZixNQUFPLEVBQUUsT0FDVCxVQUFXLEVBQUUsVUFDYixXQUFZLEVBQUUsWUFDZCxRQUFTLEVBQUUsU0FDWCxXQUFZLEVBQUUsU0FDZCxRQUFTLEVBQUUsU0FDWCxTQUFVLEVBQUUsa0JBQ1osYUFBYyxFQUFFLGVBQWlCLEVBQUUsWUFDbkMsWUFBYSxFQUFFLGNBQWdCLEVBQUUsWUFDakMsV0FBWSxFQUFFLFdBQWEsRUFBRSxZQUM3QixPQUFRLEVBQUUsTUFBUSxFQUNsQixnQkFBaUIsRUFBRSxTQUFXLEVBQzlCLG9CQUFxQixLQUNyQixxQkFBc0IsS0FDdEIsY0FBZSxLQUNmLGFBQWMsS0FDZCxnQkFBaUIsRUFBRSxTQUNuQixzQkFBdUIsRUFBRSxTQUN6QixnQkFBaUIsRUFBRSxTQUNuQixzQkFBdUIsRUFBRSxTQUN6QixTQUFVLEVBQUUsVUFBWSxJQUFJLEtBQUssRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFJLEtBQUssSUFBSSxDQUNyRSxFQUVBLGdCQUFnQixTQUFTLEtBQUssVUFBVyxFQUFFLGNBQWUsT0FBUSxFQUFFLFVBQTZCLE1BQU0sRUFDdkcsUUFBUSxJQUFJLHdEQUFpRCxFQUFFLGFBQWEsT0FBTyxNQUFNLEVBQUUsQ0FDN0YsQ0FDRixPQUFTLElBQVUsQ0FDakIsUUFBUSxLQUFLLHlEQUEwRCxJQUFJLE9BQU8sQ0FDcEYsQ0FFQSxNQUFNLEtBQUssT0FBTyxFQUNsQixLQUFLLFNBQVcsS0FDaEIsS0FBSyxnQkFBZ0IsQ0FDdkIsQ0FFTyxjQUFjLEtBQWMsUUFBaUIsQ0FDbEQsSUFBSSxTQUFXLEtBQUssTUFBTSxHQUFHLEVBQUUsQ0FBQyxFQUFFLFFBQVEsYUFBYyxFQUFFLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFDL0UsR0FBSSxTQUFTLE9BQVMsRUFBRyxDQUN2QixNQUFNLFFBQVUsMkJBQTJCLEtBQUssR0FBSyxTQUFTLFdBQVcsRUFBRSxJQUFJLENBQUMsRUFDaEYsR0FBSSxRQUFTLENBQ1gsU0FBVyxRQUFRLElBQ3JCLENBQ0YsQ0FDQSxNQUFNLE1BQVEsS0FBSyxPQUFPLElBQUksUUFBUSxFQUN0QyxHQUFJLE9BQVMsTUFBTSxZQUFhLENBQzlCLFFBQVEsSUFBSSw2REFBc0QsUUFBUSxnQkFBZ0IsUUFBUSxRQUFRLENBQUMsQ0FBQywrQkFBK0IsRUFDM0ksT0FBTyxNQUFNLFlBQ2IsS0FBSyxnQkFBZ0IsQ0FDdkIsQ0FDRixDQUVBLE1BQWMsUUFBUyxDQUNyQixRQUFRLElBQUksb0ZBQStFLDJCQUEyQixNQUFNLFNBQVMsRUFDckksR0FBSSxDQUNGLE1BQU0sUUFBVSxNQUFNLGlCQUFpQixLQUFLLE1BQU8sS0FBSyxTQUFTLEVBRWpFLFVBQVcsT0FBTywyQkFBNEIsQ0FDNUMsTUFBTSxPQUFTLElBQUksS0FDbkIsTUFBTSxNQUFRLEtBQUssT0FBTyxJQUFJLE1BQU0sRUFDcEMsR0FBSSxDQUFDLE1BQU8sU0FFWixNQUFNLFdBQWEsT0FBQyxHQUFXLENBQzdCLE1BQU0sRUFBSSxJQUFJLEtBQUssRUFBRSxJQUFJLEVBQ3pCLE1BQU0sUUFBVSxnQkFBZ0IsQ0FBQyxFQUNqQyxNQUFPLENBQ0wsVUFBVyxFQUFFLFFBQVEsRUFDckIsS0FBTSxFQUFFLEtBQ1IsS0FBTSxFQUFFLEtBQ1IsSUFBSyxFQUFFLElBQ1AsTUFBTyxFQUFFLE1BQ1QsV0FBWSxFQUFFLFlBQWMsRUFDNUIsUUFBUyxFQUFFLFlBQVksRUFBRSxNQUFNLEVBQUcsRUFBRSxFQUNwQyxRQUFTLFFBQVEsU0FBUyxFQUMxQixVQUFXLFFBQVEsV0FBVyxDQUNoQyxDQUNGLEVBZG1CLGNBZ0JuQixHQUFJLENBR0YsTUFBTSxHQUFLLE1BQU0sUUFBUSxLQUFLLENBQzVCLFFBQVEscUJBQXFCLE9BQVEsS0FBTSxPQUFXLEdBQUksRUFDMUQsSUFBSSxRQUFlLENBQUMsRUFBRyxTQUFXLFdBQVcsSUFBTSxPQUFPLElBQUksTUFBTSw0Q0FBNEMsQ0FBQyxFQUFHLEdBQUssQ0FBQyxDQUM1SCxDQUFDLEVBQ0QsTUFBTSxPQUFTLEdBQUcsSUFBSSxVQUFVLEVBQUUsS0FBSyxDQUFDLEVBQU8sSUFBVyxFQUFFLFVBQVksRUFBRSxTQUFTLEVBRW5GLE1BQU0sTUFBUSxHQUFLLEdBQUssR0FDeEIsSUFBSSxRQUFVLE9BQU8sQ0FBQyxHQUFHLE9BQVMsS0FDbEMsTUFBTSxPQUFTLENBQUMsRUFFaEIsUUFBUyxFQUFJLEVBQUcsRUFBSSxPQUFPLE9BQVEsSUFBSyxDQUN0QyxNQUFNLEVBQUksT0FBTyxDQUFDLEVBQ2xCLE1BQU0sYUFBYSxjQUFjLENBQUMsRUFDbEMsTUFBTSxTQUFTLEtBQUssQ0FBQyxFQUNyQixNQUFNLFlBQWMsRUFBRSxTQUFXLEdBRWpDLEdBQUksSUFBTSxFQUFHLENBQ1gsTUFBTSxPQUFPLEtBQUssT0FBTyxDQUMzQixLQUFPLENBQ0wsTUFBTSxLQUFPLEVBQUUsTUFBUSxTQUFXLE1BQVEsUUFDMUMsTUFBTSxPQUFPLEtBQUssR0FBRyxFQUNyQixRQUFVLEdBQ1osQ0FFQSxHQUFJLE1BQU0sU0FBUyxPQUFTLElBQU0sQ0FDaEMsTUFBTSxTQUFTLE1BQU0sRUFDckIsR0FBSSxNQUFNLE9BQU8sT0FBUyxFQUFHLE1BQU0sT0FBTyxNQUFNLENBQ2xELENBQ0YsQ0FDRixPQUFTLEVBQVEsQ0FDZixRQUFRLEtBQUssOENBQThDLE1BQU0sSUFBSyxFQUFFLE9BQU8sQ0FDakYsQ0FDRixDQUNBLFFBQVEsSUFBSSxvRkFBNkUsQ0FDM0YsT0FBUyxFQUFRLENBQ2YsUUFBUSxLQUFLLCtEQUFxRCxFQUFFLE9BQU8sRUFBRSxDQUMvRSxDQUNGLENBRUEsTUFBYSxnQkFBZ0IsT0FBZ0IsQ0FDM0MsTUFBTSxNQUFRLEtBQUssT0FBTyxJQUFJLE1BQU0sRUFDcEMsR0FBSSxDQUFDLE9BQVMsTUFBTSxTQUFTLFNBQVcsRUFBRyxPQUUzQyxNQUFNLFdBQWEsTUFBTSxTQUFTLE1BQU0sU0FBUyxPQUFTLENBQUMsRUFDM0QsTUFBTSxjQUFnQixXQUFXLFVBQ2pDLE1BQU0sTUFBUSxLQUFLLElBQUksRUFDdkIsTUFBTSxNQUFRLE1BQVEsY0FHdEIsR0FBSSxNQUFRLEVBQUksR0FBSyxJQUFNLENBQ3pCLE1BQ0YsQ0FFQSxRQUFRLElBQUksb0RBQTZDLE1BQU0sa0JBQWtCLElBQUksS0FBSyxhQUFhLEVBQUUsWUFBWSxDQUFDLHNCQUFzQixFQUU1SSxHQUFJLENBQ0YsS0FBTSxDQUFFLGlCQUFBQyxpQkFBaUIsRUFBSSxLQUFNLFFBQU8seUJBQXlCLDhGQUNuRSxNQUFNLFFBQVUsTUFBTUEsa0JBQWlCLEtBQUssTUFBTyxLQUFLLFNBQVMsRUFHakUsTUFBTSxVQUFZLElBQUksS0FBSyxjQUFnQixFQUFJLEdBQUssR0FBSSxFQUN4RCxNQUFNLE1BQVEsTUFBTSxRQUFRLHFCQUFxQixPQUFRLEtBQU0sVUFBVyxHQUFJLEVBRTlFLEdBQUksQ0FBQyxPQUFTLE1BQU0sU0FBVyxFQUFHLENBQ2hDLFFBQVEsSUFBSSx1RUFBdUUsTUFBTSxHQUFHLEVBQzVGLE1BQ0YsQ0FFQSxRQUFRLElBQUksK0JBQStCLE1BQU0sTUFBTSxvQkFBb0IsTUFBTSxnQkFBZ0IsRUFFakcsTUFBTSxXQUFhLE9BQUMsR0FBVyxDQUM3QixNQUFNLEVBQUksSUFBSSxLQUFLLEVBQUUsSUFBSSxFQUN6QixNQUFNLFFBQVUsZ0JBQWdCLENBQUMsRUFDakMsTUFBTyxDQUNMLFVBQVcsRUFBRSxRQUFRLEVBQ3JCLEtBQU0sRUFBRSxLQUNSLEtBQU0sRUFBRSxLQUNSLElBQUssRUFBRSxJQUNQLE1BQU8sRUFBRSxNQUNULFdBQVksRUFBRSxZQUFjLEVBQzVCLFFBQVMsRUFBRSxZQUFZLEVBQUUsTUFBTSxFQUFHLEVBQUUsRUFDcEMsUUFBUyxRQUFRLFNBQVMsRUFDMUIsVUFBVyxRQUFRLFdBQVcsQ0FDaEMsQ0FDRixFQWRtQixjQWdCbkIsTUFBTSxPQUFTLE1BQU0sSUFBSSxVQUFVLEVBQUUsS0FBSyxDQUFDLEVBQVEsSUFBVyxFQUFFLFVBQVksRUFBRSxTQUFTLEVBRXZGLE1BQU0sTUFBUSxHQUFLLEdBQUssR0FFeEIsVUFBVyxLQUFLLE9BQVEsQ0FFdEIsR0FBSSxNQUFNLFNBQVMsS0FBSyxVQUFZLFNBQVMsWUFBYyxFQUFFLFNBQVMsRUFBRyxDQUN2RSxRQUNGLENBRUEsTUFBTSxhQUFhLGNBQWMsQ0FBQyxFQUNsQyxNQUFNLFNBQVMsS0FBSyxDQUFDLEVBQ3JCLE1BQU0sWUFBYyxFQUFFLFNBQVcsR0FHakMsSUFBSSxRQUFVLE1BQU0sT0FBTyxNQUFNLE9BQU8sT0FBUyxDQUFDLEVBQ2xELEdBQUksVUFBWSxRQUFhLFVBQVksS0FBTSxDQUM3QyxRQUFVLEVBQUUsS0FDZCxDQUNBLE1BQU0sS0FBTyxFQUFFLE1BQVEsU0FBVyxNQUFRLFFBQzFDLE1BQU0sT0FBTyxLQUFLLEdBQUcsRUFFckIsR0FBSSxNQUFNLFNBQVMsT0FBUyxJQUFNLENBQ2hDLE1BQU0sU0FBUyxNQUFNLEVBQ3JCLEdBQUksTUFBTSxPQUFPLE9BQVMsRUFBRyxNQUFNLE9BQU8sTUFBTSxDQUNsRCxDQUNGLENBRUEsUUFBUSxJQUFJLDJEQUFzRCxNQUFNLDBCQUEwQixNQUFNLFNBQVMsTUFBTSxFQUFFLENBQzNILE9BQVMsSUFBVSxDQUNqQixRQUFRLE1BQU0seURBQW9ELE1BQU0sSUFBSyxJQUFJLE9BQU8sQ0FDMUYsQ0FDRixDQUVPLFVBQVUsTUFBZSxPQUFpQixDQUMvQyxHQUFJLE9BQVEsQ0FDVixLQUFLLFdBQVcsSUFBSSxLQUFLLENBQzNCLEtBQU8sQ0FDTCxLQUFLLFdBQVcsT0FBTyxLQUFLLENBQzlCLENBQ0YsQ0FFQSxXQUFxQixDQUNuQixPQUFPLEtBQUssT0FDZCxDQUVRLFlBQVksS0FBc0IsQ0FDeEMsR0FBSSxPQUFTLFVBQVksS0FBSyxTQUFTLE1BQU0sR0FBSyxLQUFLLFNBQVMsT0FBTyxHQUFLLEtBQUssU0FBUyxLQUFLLEVBQUcsTUFBTyxHQUN6RyxHQUFJLEtBQUssU0FBUyxLQUFLLEVBQUcsTUFBTyxLQUNqQyxHQUFJLEtBQUssU0FBUyxLQUFLLEVBQUcsTUFBTyxNQUNqQyxHQUFJLEtBQUssU0FBUyxLQUFLLEVBQUcsTUFBTyxLQUNqQyxHQUFJLEtBQUssU0FBUyxLQUFLLEVBQUcsTUFBTyxLQUNqQyxHQUFJLEtBQUssU0FBUyxLQUFLLEVBQUcsTUFBTyxLQUNqQyxHQUFJLE9BQVMsU0FBVSxNQUFPLE1BQzlCLE1BQU8sR0FDVCxDQUVBLE1BQU8sQ0FDTCxLQUFLLFFBQVUsTUFDZixRQUFRLElBQUksdURBQWdELEtBQUssU0FBUyxFQUFFLEVBQzVFLEtBQUssZ0JBQWdCLENBQ3ZCLENBRUEsTUFBTSxTQUFVLENBQ2QsS0FBSyxLQUFLLEVBQ1YsR0FBSSxDQUNGLEtBQU0sQ0FBRSxRQUFTLEVBQUksS0FBTSxRQUFPLGVBQWUsOEZBQ2pELE1BQU0sS0FBTyxTQUFTLFlBQVksS0FBSyxTQUFTLEVBQ2hELEdBQUksS0FBTSxLQUFLLEtBQUssQ0FDdEIsT0FBUyxFQUFHLENBQUMsQ0FDYixpQkFBaUIsVUFBVSxPQUFPLEtBQUssU0FBUyxFQUNoRCxRQUFRLElBQUksd0RBQXdELEtBQUssU0FBUyxFQUFFLENBQ3RGLENBRUEsV0FBVyxLQUFjLFFBQWtCLE1BQWdCLENBQ3pELE1BQU0sVUFBWSxPQUFTLE9BQzNCLE1BQU0sTUFBUSxLQUFLLE9BQU8sSUFBSSxJQUFJLEVBQ2xDLEdBQUksTUFBTyxDQUNULE1BQU0sUUFBVSxNQUFNLFdBQVcsSUFBSSxTQUFTLEVBQzlDLEdBQUksUUFBUyxRQUFRLFFBQVUsYUFDMUIsTUFBTSxXQUFXLElBQUksVUFBVyxDQUFFLFFBQVMsS0FBTSxNQUFNLE9BQVEsQ0FBQyxDQUN2RSxDQUNBLFFBQVEsSUFBSSxxQ0FBcUMsSUFBSSxPQUFPLE9BQU8sWUFBWSxTQUFTLEVBQUUsRUFDMUYsS0FBSyxnQkFBZ0IsU0FBUyxDQUNoQyxDQUVBLFlBQVksS0FBYyxRQUFpQixNQUFnQixDQUN6RCxNQUFNLFVBQVksT0FBUyxPQUMzQixNQUFNLE1BQVEsS0FBSyxPQUFPLElBQUksSUFBSSxFQUNsQyxHQUFJLE1BQU8sQ0FDVCxNQUFNLFFBQVUsTUFBTSxXQUFXLElBQUksU0FBUyxFQUM5QyxHQUFJLFFBQVMsUUFBUSxLQUFPLGFBQ3ZCLE1BQU0sV0FBVyxJQUFJLFVBQVcsQ0FBRSxRQUFTLEtBQU0sS0FBTSxPQUFRLENBQUMsRUFFckUsR0FBSSxZQUFjLE9BQVEsTUFBTSxRQUFVLE9BQzVDLENBQ0EsUUFBUSxJQUFJLHVDQUF1QyxJQUFJLE9BQU8sT0FBTyxhQUFhLFNBQVMsRUFBRSxFQUM3RixLQUFLLGdCQUFnQixTQUFTLENBQ2hDLENBR0EsbUJBQW9CLENBQ2xCLFVBQVcsU0FBUyxLQUFLLE9BQU8sT0FBTyxFQUFHLENBQ3hDLE1BQU0sUUFBVSxDQUNsQixDQUNBLEtBQUssZ0JBQWdCLENBQ3ZCLENBRU8sVUFBVSxNQUFzRSxDQUNyRixNQUFNLFdBQWtDLENBQUMsRUFDekMsTUFBTSxVQUFZLE9BQVMsT0FNM0IsTUFBTSxJQUFNLElBQUksS0FDZCxNQUFNLFFBQVUsZ0JBQWdCLEdBQUcsRUFDbkMsTUFBTSxZQUFjLFFBQVEsU0FBUyxFQUNyQyxNQUFNLFdBQWMsUUFBUSxXQUFXLEVBRXpDLFNBQVcsQ0FBQyxPQUFRLEtBQUssSUFBSyxLQUFLLE9BQU8sUUFBUSxFQUFHLENBQ25ELE1BQU0sUUFBVSxNQUFNLGNBQWMsc0JBQXNCLEVBQzFELElBQUksS0FBTyxPQUNYLEdBQUksU0FBUyxjQUFlLEtBQU8sY0FDMUIsU0FBUyxnQkFBaUIsS0FBTyxjQUNqQyxTQUFTLG9CQUFxQixLQUFPLG9CQUNyQyxTQUFTLHFCQUFzQixLQUFPLHFCQUN0QyxTQUFTLFlBQWEsS0FBTyxxQkFDN0IsU0FBUyxlQUFnQixLQUFPLG1CQUNoQyxTQUFTLGdCQUFpQixLQUFPLG9CQUNqQyxTQUFTLFVBQVcsS0FBTyx1QkFDM0IsU0FBUyxVQUFXLEtBQU8sZUFNcEMsTUFBTSxFQUFJLFlBQ1YsTUFBTSxTQUFXLEdBQUssR0FBSyxFQUFJLEVBQzdCLE1BQU0sS0FBVyxHQUFLLEdBQUssRUFBSSxHQUMvQixNQUFNLE9BQVcsR0FBSyxJQUFNLEVBQUksR0FDbEMsTUFBTSxTQUFXLFVBQVksTUFBUSxPQUNyQyxJQUFJLFdBQWEsT0FDakIsR0FBSSxTQUFVLFdBQWEsU0FDM0IsR0FBSSxLQUFVLFdBQWEsV0FDM0IsR0FBSSxPQUFVLFdBQWEsUUFFM0IsV0FBVyxNQUFNLEVBQUksQ0FBRSxLQUFNLFNBQVUsV0FBWSxRQUFTLFlBQWEsT0FBUSxXQUFZLFFBQVMsTUFBTSxPQUFRLENBQ3RILENBRUEsTUFBTSxvQkFBc0IsQ0FBQyxTQUFVLFNBQVUsU0FBVSxTQUFVLFNBQVUsU0FBVSxTQUFVLFNBQVUsU0FBVSxlQUFnQixhQUFjLGNBQWUsZUFBZ0IsUUFBUSxFQUM1TCxJQUFJLGFBQWUsTUFBTSxLQUFLLEtBQUssT0FBTyxLQUFLLENBQUMsRUFJaEQsR0FBSSxZQUFjLE9BQVEsQ0FDeEIsYUFBZSxhQUFhLE9BQU8sR0FBSyxvQkFBb0IsU0FBUyxDQUFDLENBQUMsQ0FDekUsQ0FFQSxNQUFPLENBQ0wsUUFBUyxLQUFLLFFBQ2QsV0FBWSxNQUFNLEtBQUssS0FBSyxVQUFVLEVBQ3RDLE1BQU8sYUFDUCxXQUFZLE9BQU8sWUFDakIsTUFBTSxLQUFLLEtBQUssT0FBTyxRQUFRLENBQUMsRUFDN0IsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFNLGFBQWEsU0FBUyxDQUFDLENBQUMsRUFDeEMsSUFBSSxDQUFDLENBQUMsRUFBRyxDQUFDLElBQU0sQ0FDakIsRUFDQSxDQUNFLFFBQVMsRUFBRSxXQUFXLElBQUksU0FBUyxHQUFHLFVBQVksTUFDbEQsUUFBUyxFQUFFLFdBQVcsSUFBSSxTQUFTLEdBQUcsTUFBUSxFQUFFLFFBQ2hELGVBQWdCLENBQUMsQ0FBQyxFQUFFLFlBQ3BCLGNBQWUsRUFBRSxVQUFZLEVBQUUsU0FBUyxjQUFnQixDQUFDLEVBQUUsYUFBZSxDQUFDLEVBQUUsU0FBUyxNQUFRLEtBQU8sS0FDdkcsQ0FDRixDQUFDLENBQ0gsRUFDQSxXQUNBLGNBQWUsS0FBSyxjQUNwQixZQUFhLElBQUksS0FBSyxFQUFFLFlBQVksQ0FDdEMsQ0FDRixDQUdBLGdCQUFnQixNQUFnQixDQUM5QixNQUFNLEdBQUssTUFBTSxFQUNqQixHQUFJLEdBQUksQ0FDTixHQUFHLEdBQUcsV0FBVyxLQUFLLFNBQVMsRUFBRSxFQUFFLEtBQUssOEJBQStCLEtBQUssVUFBVSxLQUFLLENBQUMsQ0FDOUYsQ0FDRixDQUdBLE1BQU0sU0FBUyxPQUFnQixLQUFjLEtBQWMsSUFBYSxNQUFlLElBQWEsWUFBcUIsQ0FDdkgsR0FBSSxDQUFDLEtBQUssU0FBVyxDQUFDLEtBQUssU0FBVSxPQUNyQyxNQUFNLE1BQVEsS0FBSyxPQUFPLElBQUksTUFBTSxFQUNwQyxHQUFJLENBQUMsTUFBTyxPQUVaLEdBQUksTUFBTSwyQkFBNkIsUUFBYSxhQUFlLE1BQU0seUJBQTBCLENBQ2pHLE1BQ0YsQ0FDQSxNQUFNLHlCQUEyQixZQUdqQyxHQUFJLE1BQU0sVUFBWSxNQUFNLFNBQVMsY0FBZ0IsQ0FBQyxNQUFNLGFBQWUsQ0FBQyxNQUFNLFNBQVMsTUFBTyxDQUNoRyxHQUFJLENBQ0YsTUFBTSxLQUFPLE1BQU0sb0JBQW9CLEtBQUssTUFBTyxLQUFLLFNBQVMsRUFDakUsTUFBTSxVQUFhLE1BQU0sc0JBQXNCLElBQU0sS0FBSyxhQUFhLEVBQUcsYUFBYSxNQUFNLEVBQUUsRUFDL0YsTUFBTSxRQUFVLE1BQU0sU0FBUyxjQUFnQixNQUFRLG9CQUFzQixxQkFDN0UsTUFBTSxJQUFNLFVBQVUsS0FBTSxHQUFXLEVBQUUsU0FBVyxRQUFVLEVBQUUsT0FBUyxPQUFPLEVBQ2hGLEdBQUksSUFBSyxDQUNQLE1BQU0sUUFBVSxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssRUFBSSxHQUFPLE1BQU0sT0FBTyxLQUFLLFNBQVMsS0FBSyxFQUFJLEVBQU8sTUFBTSxPQUFPLEtBQUssU0FBUyxLQUFLLEVBQUksSUFBUSxNQUFNLE9BQU8sV0FBYSxLQUFTLEtBQVMsTUFBTSxPQUFPLFNBQVcsR0FDdE4sTUFBTSxTQUFXLEtBQUssSUFBSSxJQUFJLFVBQVksTUFBTSxTQUFTLE9BQU8sRUFBSSxRQUVwRSxNQUFNLEdBQUssTUFBTSxHQUFHLFFBQVEsbURBQW1ELEVBQUUsSUFBSSxLQUFLLFNBQVMsRUFDbkcsTUFBTSxhQUFlLEdBQUssR0FBRyxRQUFVLEVBQ3ZDLE1BQU0sWUFBYyxNQUFNLEdBQUcsUUFBUTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsV0FLcEMsRUFDRCxNQUFNLFlBQWMsSUFBSSxLQUFPLElBQUksS0FBSyxJQUFJLElBQUksRUFBRSxZQUFZLEVBQUksSUFBSSxLQUFLLEVBQUUsWUFBWSxFQUN6RixNQUFNLFVBQVksTUFBTSxZQUFZLElBQ2xDLGFBQ0EsS0FBSyxVQUNMLE9BQ0EsTUFBTSxTQUFTLFlBQ2YsSUFBSSxVQUNKLE1BQU0sU0FBUyxRQUNmLE1BQU0sU0FBUyxRQUNmLElBQUksT0FDSixZQUNBLElBQUksR0FDSixJQUFJLFVBQ0osSUFBSSxVQUNKLFFBQ0YsRUFDQSxNQUFNLEtBQU8sVUFBVSxnQkFFdkIsTUFBTSxZQUFjLENBQ2xCLEtBQ0EsWUFBYSxJQUFJLEdBQ2pCLE1BQU8sT0FDUCxVQUFXLE1BQU0sU0FBUyxZQUMxQixXQUFZLElBQUksVUFDaEIsUUFBUyxNQUFNLFNBQVMsUUFDeEIsV0FBWSxNQUFNLFNBQVMsUUFDM0IsUUFBUyxNQUFNLFNBQVMsUUFDeEIsU0FDQSxhQUFjLElBQUksVUFDbEIsWUFBYSxJQUFJLFVBQ2pCLFdBQVksTUFDWixPQUFRLElBQUksT0FDWixnQkFBaUIsTUFDakIsb0JBQXFCLEtBQ3JCLHFCQUFzQixLQUN0QixjQUFlLEtBQ2YsYUFBYyxLQUNkLGdCQUFpQixNQUFNLFNBQVMsUUFDaEMsc0JBQXVCLE1BQU0sU0FBUyxRQUN0QyxnQkFBaUIsTUFBTSxTQUFTLFFBQ2hDLHNCQUF1QixNQUFNLFNBQVMsUUFDdEMsU0FBVSxJQUFJLEtBQU8sSUFBSSxLQUFLLElBQUksSUFBSSxFQUFFLFFBQVEsRUFBSSxLQUFLLElBQUksQ0FDL0QsRUFFQSxNQUFNLFNBQVMsTUFBUSxLQUN2QixnQkFBZ0IsU0FBUyxLQUFLLFVBQVcsSUFBSSxHQUFJLE9BQVEsTUFBTSxTQUFTLFlBQStCLE1BQU0sRUFDN0csUUFBUSxJQUFJLDBEQUFtRCxNQUFNLDRDQUE0QyxDQUNuSCxDQUNGLE9BQVMsSUFBVSxDQUNqQixRQUFRLE1BQU0saUVBQWlFLE1BQU0sSUFBSyxJQUFJLE9BQU8sQ0FDdkcsQ0FDRixDQUVBLE1BQU0sZUFBaUIsS0FBSyxNQUFNLGFBQWUsRUFBSSxHQUFLLElBQUssR0FBSyxFQUFJLEdBQUssS0FDN0UsR0FBSSxNQUFNLHVCQUF5QixRQUFhLGdCQUFrQixNQUFNLHFCQUFzQixDQUM1RixNQUNGLENBR0EsTUFBTSxFQUFJLElBQUksS0FBSyxXQUFXLEVBQzlCLE1BQU0sUUFBVSxnQkFBZ0IsQ0FBQyxFQUNqQyxNQUFNLFFBQVUsUUFBUSxTQUFTLEVBR2pDLE1BQU0sWUFBYyxRQUVwQixHQUFJLENBQUMsS0FBSyxTQUFXLENBQUMsS0FBSyxTQUFVLE9BQ3JDLEdBQUksS0FBSyxZQUFZLElBQUksTUFBTSxHQUFLLEtBQUssSUFBSSxFQUFJLEtBQUssWUFBWSxJQUFJLE1BQU0sRUFBSSxPQUVoRixNQUFNLEVBQXNCLENBQzFCLEtBQU0sS0FBTSxJQUFLLE1BQU8sV0FBWSxJQUNwQyxVQUFXLFlBQ1gsUUFBUyxFQUFFLFlBQVksRUFDdkIsUUFDQSxPQUFRLFFBQVEsV0FBVyxDQUM3QixFQUtBLE1BQU0sU0FBVyxFQUFJLEdBQUssSUFFMUIsR0FBSSxNQUFNLGdCQUFrQixFQUFHLENBQzdCLE1BQU0sY0FBZ0IsZUFDdEIsTUFBTSxZQUFjLEtBQ3BCLE1BQU0sWUFBYyxLQUNwQixNQUFNLFdBQWEsSUFDbkIsTUFBTSxhQUFlLE1BQ3JCLE1BQU0sV0FBYSxJQUNuQixNQUFNLGFBQWUsQ0FDdkIsU0FBVyxlQUFpQixNQUFNLGNBQWUsQ0FFL0MsTUFBTSxTQUE2QixDQUNqQyxLQUFNLE1BQU0sWUFDWixLQUFNLE1BQU0sWUFDWixJQUFLLE1BQU0sV0FDWCxNQUFPLE1BQU0sYUFDYixXQUFZLE1BQU0sV0FDbEIsVUFBVyxNQUFNLGNBQ2pCLFFBQVMsSUFBSSxLQUFLLE1BQU0sYUFBYSxFQUFFLFlBQVksRUFDbkQsUUFBUyxnQkFBZ0IsSUFBSSxLQUFLLE1BQU0sYUFBYSxDQUFDLEVBQUUsU0FBUyxFQUNqRSxPQUFRLGdCQUFnQixJQUFJLEtBQUssTUFBTSxhQUFhLENBQUMsRUFBRSxXQUFXLENBQ3BFLEVBRUEsS0FBSyxVQUFVLE9BQVEsTUFBTyxRQUFRLEVBR3RDLE1BQU0sY0FBZ0IsZUFDdEIsTUFBTSxZQUFjLEtBQ3BCLE1BQU0sWUFBYyxLQUNwQixNQUFNLFdBQWEsSUFDbkIsTUFBTSxhQUFlLE1BQ3JCLE1BQU0sV0FBYSxJQUNuQixNQUFNLGFBQWUsQ0FDdkIsS0FBTyxDQUVMLE1BQU0sWUFBYyxLQUFLLElBQUksTUFBTSxZQUFhLElBQUksRUFDcEQsTUFBTSxXQUFhLEtBQUssSUFBSSxNQUFNLFdBQVksR0FBRyxFQUNqRCxNQUFNLGFBQWUsTUFDckIsTUFBTSxZQUFjLElBQ3BCLE1BQU0sY0FDUixDQUNGLENBRUEsTUFBYyxXQUFXLE9BQWdCLE1BQWtCLEVBQXFCLENBQzlFLEdBQUksQ0FBQyxNQUFNLFNBQVUsQ0FDbkIsTUFBTSxTQUFXLENBQ2YsT0FBUSxVQUNSLE1BQU8sU0FDUCxRQUFTLE1BQ1QsWUFBYSxLQUNiLFdBQVksRUFDWixRQUFTLEVBQ1QsUUFBUyxFQUNULGFBQWMsS0FDZCxlQUFnQixNQUNoQixNQUFPLE1BQ1AsZUFBZ0IsRUFDbEIsQ0FDRixDQUVBLE1BQU0sUUFBVSxnQkFBZ0IsSUFBSSxLQUFLLEVBQUUsU0FBUyxDQUFDLEVBQ3JELE1BQU0sUUFBVSxRQUFRLFNBQVMsRUFDakMsTUFBTSxPQUFTLFFBQVEsV0FBVyxFQUNsQyxNQUFNLFFBQVUsUUFBUSxZQUFZLEVBQUUsTUFBTSxFQUFHLEVBQUUsRUFFakQsTUFBTSxHQUFLLE1BQU0sU0FFakIsR0FBSSxHQUFHLGlCQUFtQixRQUFTLENBRWpDLEdBQUcsT0FBUyxVQUNaLEdBQUcsTUFBUSxTQUNYLEdBQUcsUUFBVSxNQUNiLEdBQUcsWUFBYyxLQUNqQixHQUFHLFdBQWEsRUFDaEIsR0FBRyxRQUFVLEVBQ2IsR0FBRyxRQUFVLEVBQ2IsR0FBRyxhQUFlLEtBQ2xCLEdBQUcsZUFBaUIsTUFDcEIsR0FBRyxNQUFRLE1BQ1gsR0FBRyxlQUFpQixPQUN0QixDQUVBLEdBQUksR0FBRyxPQUFTLEdBQUcsYUFBYyxPQUdqQyxHQUFJLENBQUMsZUFBZSxDQUFFLEtBQU0sT0FBUSxVQUFXLE1BQU8sVUFBVyxFQUFFLFNBQVUsQ0FBQyxFQUFHLENBQy9FLE1BQ0YsQ0FFQSxNQUFNLFFBQVUsa0JBQWtCLFdBQVcsTUFBTSxFQUNuRCxNQUFNLFVBQVksUUFBUSxLQUFPLEdBQUssUUFBUSxJQUM5QyxNQUFNLFlBQWMsUUFBVSxHQUFLLE9BR25DLEdBQUksYUFBZSxXQUFhLFlBQWMsVUFBWSxHQUFJLENBQzVELEdBQUcsT0FBUyxLQUFLLElBQUksR0FBRyxPQUFRLEVBQUUsSUFBSSxFQUN0QyxHQUFHLE1BQVEsS0FBSyxJQUFJLEdBQUcsTUFBTyxFQUFFLEdBQUcsRUFDbkMsTUFDRixDQUVBLEdBQUksY0FBZ0IsVUFBWSxJQUFNLENBQUMsR0FBRyxRQUFTLENBQ2hELEdBQUcsUUFBVSxLQUNiLEtBQUssZ0JBQWdCLENBQUUsS0FBTSxjQUFlLE9BQVEsT0FBUSxLQUFNLENBQUUsT0FBUSxTQUFVLFdBQVksT0FBUSxvQkFBb0IsR0FBRyxPQUFPLFFBQVEsQ0FBQyxDQUFDLFVBQVUsR0FBRyxNQUFNLFFBQVEsQ0FBQyxDQUFDLEdBQUksQ0FBQyxDQUFDLENBQ3hMLENBRUEsR0FBSSxDQUFDLEdBQUcsU0FBVyxHQUFHLFNBQVcsVUFBVyxPQUU1QyxNQUFNLFFBQVUsTUFBTSxPQUFPLEtBQUssU0FBUyxLQUFLLEVBQUksR0FBTyxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssRUFBSSxFQUFPLE1BQU0sT0FBTyxLQUFLLFNBQVMsS0FBSyxFQUFJLElBQVEsTUFBTSxPQUFPLFdBQWEsS0FBUyxLQUFTLE1BQU0sT0FBTyxTQUFXLEdBQ3ROLE1BQU0sYUFBZSxHQUFHLE9BQVMsR0FBRyxPQUFTLFFBRTdDLE1BQU0saUJBQW1CLE9BQU8sTUFBTSxHQUFHLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQ2pFLE1BQU0sUUFBVSxZQUFZLElBQUksZ0JBQWdCLEVBRWhELE1BQU0sVUFBWSxNQUFNLE9BQU8sV0FBYSxHQUM1QyxHQUFJLFNBQVksWUFBYyxHQUFNLFVBQVcsT0FHL0MsR0FBSSxhQUFlLFVBQVksSUFBSyxDQUNqQyxHQUFHLE1BQVEsS0FDWCxNQUNILENBR0EsR0FBSSxDQUFDLEdBQUcsYUFBZSxhQUFlLFVBQVcsQ0FDL0MsTUFBTSxXQUFhLE1BQU0sT0FBTyxRQUFVLEdBQUssUUFFL0MsTUFBTSxhQUFlLFFBQVcsRUFBRSxNQUFRLEdBQUcsT0FBVyxFQUFFLE1BQVEsR0FBRyxPQUFTLFVBQzlFLE1BQU0sY0FBZ0IsUUFBVyxFQUFFLE1BQVEsR0FBRyxNQUFVLEVBQUUsS0FBTyxHQUFHLE1BRXBFLEdBQUksY0FBZ0IsY0FBZSxDQUNqQyxNQUFNLFVBQVksYUFBZSxNQUFRLE9BQ3pDLEdBQUcsWUFBYyxVQUNqQixLQUFLLGdCQUFnQixDQUFFLEtBQU0sY0FBZSxPQUFRLE9BQVEsS0FBTSxDQUFFLE9BQVEsU0FBVSxHQUFHLFNBQVMsWUFBYSxPQUFRLDZCQUE4QixDQUFDLENBQUMsRUFFdkosTUFBTSxRQUFVLEtBQUssSUFBSSxHQUFHLE9BQVMsR0FBRyxLQUFLLEVBQzdDLE1BQU0sWUFBYyxNQUFNLE9BQU8saUJBQW1CLE9BQVksTUFBTSxPQUFPLGVBQWtCLFFBQVcsT0FBTyxZQUFZLEVBQUUsU0FBUyxLQUFLLEVBQUksR0FBTyxFQUFRLElBQ2hLLElBQUksU0FBVyxFQUVmLEdBQUksUUFBUyxDQUNYLFNBQVcsR0FBSyxPQUNsQixDQUVBLE1BQU0sV0FBYSxZQUFjLE1BQVEsR0FBRyxPQUFVLFFBQVUsWUFBZSxHQUFHLE1BQVMsUUFBVSxZQUNyRyxHQUFHLFdBQWEsV0FDaEIsR0FBRyxRQUFVLFlBQWMsTUFBUSxHQUFHLE1BQVEsU0FBVyxHQUFHLE9BQVMsVUFBWSxTQUVqRixNQUFNLEtBQU8sS0FBSyxJQUFJLFdBQWEsR0FBRyxPQUFPLEVBQzdDLEdBQUcsUUFBVSxZQUFjLE1BQVEsV0FBYSxHQUFLLEtBQU8sV0FBYSxHQUFLLEtBRzlFLEtBQUssd0JBQXdCLE9BQVEsTUFBTyxDQUFDLEVBQUUsTUFBTSxHQUFLLFFBQVEsTUFBTSxDQUFDLENBQUMsQ0FDNUUsQ0FDRixDQUNGLENBRUEsTUFBYyx3QkFBd0IsT0FBZ0IsTUFBa0IsRUFBcUIsQ0FDM0YsTUFBTSxHQUFLLE1BQU0sU0FDakIsR0FBSSxDQUFDLElBQU0sQ0FBQyxHQUFHLGFBQWUsR0FBRyxnQkFBa0IsR0FBRyxNQUFPLE9BRTdELFFBQVEsSUFBSSx3REFBaUQsTUFBTSxnREFBZ0QsRUFHbkgsR0FBRyxlQUFpQixLQUVwQixNQUFNLEtBQUssb0JBQW9CLE9BQVEsS0FBSyxDQUM5QyxDQUVBLE1BQWMsb0JBQW9CLE9BQWdCLE1BQWtCLENBQ2xFLE1BQU0sR0FBSyxNQUFNLFNBQ2pCLEdBQUksQ0FBQyxJQUFNLENBQUMsR0FBRyxnQkFBa0IsR0FBRyxPQUFTLEdBQUcsYUFBYyxPQUU5RCxNQUFNLE1BQVEsT0FDZCxHQUFJLE1BQU0sV0FBVyxJQUFJLEtBQUssR0FBRyxVQUFZLE1BQU8sQ0FDbEQsUUFBUSxJQUFJLDBEQUFnRCxNQUFNLHdCQUF3QixLQUFLLEVBQUUsRUFDakcsTUFDRixDQUNBLE1BQU0sVUFBWSxlQUFlLE9BQVEsSUFBSSxJQUFNLEVBQ25ELEdBQUksVUFBVSxRQUFTLENBQ3JCLFFBQVEsSUFBSSxxRkFBMkUsTUFBTSxLQUFLLFVBQVUsTUFBTSxFQUFFLEVBQ3BILE1BQ0YsQ0FFQSxHQUFJLENBQ0YsTUFBTSxRQUFVLE1BQU0sR0FBRyxRQUFRLDhGQUE4RixFQUFFLElBQUksS0FBSyxTQUFTLEVBQ25KLEdBQUksQ0FBQyxRQUFTLE9BRWQsS0FBTSxDQUFFLFlBQWEsT0FBUSxFQUFJLEtBQU0sUUFBTyxpQkFBaUIsOEZBQy9ELE1BQU0sTUFBUSxZQUFZLFFBQVEsYUFBYSxFQUFJLFFBQVEsUUFBUSxhQUFhLEVBQUksUUFBUSxjQUM1RixNQUFNLFVBQVkscUJBQXFCLFFBQVEsa0JBQWtCLEVBRWpFLE1BQU0sS0FBTyxNQUFNLG9CQUFvQixNQUFPLFNBQVMsRUFDdkQsTUFBTSxhQUFlLE1BQU0sZ0JBQWdCLEtBQU0sTUFBTSxFQUN2RCxNQUFNLEtBQU8sTUFBTSxjQUFjLFlBQVksRUFDN0MsTUFBTSxTQUFXLEtBRWpCLE1BQU0sUUFBVSxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssRUFBSSxHQUFPLE1BQU0sT0FBTyxLQUFLLFNBQVMsS0FBSyxFQUFJLEVBQU8sTUFBTSxPQUFPLFdBQWEsS0FBUyxLQUFTLE1BQU0sT0FBTyxTQUFXLEdBRTFLLE1BQU0sTUFBUSxNQUFNLEtBQUssZUFBZSxZQUFZLEVBQ3BELE1BQU0sbUJBQXFCLE1BQU0sSUFBTSxNQUFNLEtBQU8sUUFFcEQsTUFBTSxVQUFZLE1BQU0sT0FBTyxnQkFBa0IsR0FDakQsR0FBSSxrQkFBb0IsVUFBVyxDQUMvQixRQUFRLEtBQUssNkRBQXdELE1BQU0sb0JBQW9CLGtCQUFrQixRQUFRLENBQUMsQ0FBQyx1QkFBdUIsU0FBUywwQkFBMEIsRUFDckwsTUFDSixDQUVBLE1BQU0sT0FBUyxLQUFLLElBQUksR0FBRyxXQUFhLEdBQUcsT0FBTyxFQUFJLFFBRXRELE1BQU0sWUFBZSxNQUFNLHNCQUFzQixJQUFNLEtBQUssc0JBQXNCLEVBQUcsZUFBZSxNQUFNLEVBQUUsRUFDNUcsR0FBSSxDQUFDLFlBQWEsT0FDbEIsTUFBTSxRQUFVLFlBQVksUUFDNUIsTUFBTSxPQUFTLFlBQVksT0FDM0IsTUFBTSxpQkFBbUIsS0FBSyxJQUFJLFFBQVMsTUFBTSxFQUVqRCxJQUFJLGVBQWlCLEVBRXJCLE1BQU0sWUFBYyxNQUFNLEdBQUcsUUFBUSxxRkFBcUYsRUFBRSxJQUFJLEtBQUssU0FBUyxFQUU5SSxHQUFJLGFBQWUsWUFBWSxvQkFBc0IsRUFBRyxDQUN0RCxNQUFNLFlBQWMsWUFBWSx3QkFBMEIsaUJBQzFELEdBQUksaUJBQW1CLFlBQWEsQ0FFbEMsTUFBTSxHQUFHLFFBQVEscUVBQXFFLEVBQUUsSUFBSSxpQkFBa0IsS0FBSyxTQUFTLENBQzlILEtBQU8sQ0FDTCxNQUFNLFVBQVksWUFBYyxrQkFBb0IsWUFDcEQsTUFBTSxVQUFZLEtBQUssSUFBSSxFQUFHLEtBQUssSUFBSSxTQUFVLEdBQUksQ0FBQyxFQUN0RCxlQUFpQixLQUFLLElBQUksRUFBRyxFQUFJLEtBQUssSUFBSSxVQUFZLElBQU0sQ0FBQyxDQUFDLEVBQzlELFFBQVEsSUFBSSxpRUFBcUQsWUFBWSxRQUFRLENBQUMsQ0FBQyxXQUFXLGlCQUFpQixRQUFRLENBQUMsQ0FBQyxTQUFTLFNBQVMsS0FBSyxRQUFRLENBQUMsQ0FBQyxpQkFBaUIsZUFBZSxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQzdNLENBQ0YsQ0FFQSxHQUFJLGFBQWUsWUFBWSxvQkFBc0IsR0FBSyxnQkFBa0IsRUFBRyxDQUM3RSxRQUFRLEtBQUsscUZBQThFLFlBQVksd0JBQXdCLEVBQy9ILEtBQUssZ0JBQWdCLENBQUUsS0FBTSxjQUFlLE9BQVEsT0FBUSxLQUFNLENBQUUsT0FBUSxTQUFVLFVBQVcsT0FBUSx5QkFBMEIsQ0FBQyxDQUFDLEVBQ3JJLE1BQ0YsQ0FFQSxNQUFNLFdBQWEsbUJBQXFCLE1BQU0sU0FBVyxHQUFPLEtBQU8sZUFDdkUsTUFBTSxhQUFlLFVBQVUsY0FBZ0IsSUFDL0MsSUFBSSxlQUFpQixHQUNyQixHQUFJLE9BQU8sU0FBUyxLQUFLLEVBQUcsZUFBaUIsSUFBTyxHQUFHLFdBQ3ZELE1BQU0sUUFBVSxZQUFjLE9BQVMsZ0JBQ3ZDLElBQUksU0FBVyxLQUFLLElBQUksSUFBTSxLQUFLLElBQUksV0FBVyxRQUFRLFFBQVEsQ0FBQyxDQUFDLEVBQUcsRUFBSSxDQUFDLEVBQzVFLE1BQU0sT0FBUyxVQUFVLFdBQWEsSUFDdEMsTUFBTSxRQUFVLFVBQVUsWUFBYyxJQUN4QyxTQUFXLEtBQUssTUFBTSxTQUFXLE9BQU8sRUFBSSxRQUM1QyxHQUFJLFNBQVcsT0FBUSxTQUFXLE9BQ2xDLFNBQVcsV0FBVyxTQUFTLFFBQVEsQ0FBQyxDQUFDLEVBRXpDLE1BQU0sU0FBVyxRQUFRLE1BQU0sSUFBSSxLQUFLLElBQUksQ0FBQyxHQUFHLFVBQVUsRUFBRyxFQUFFLEVBRS9ELElBQUksWUFDSixNQUFNLE9BQVMsVUFBVSxRQUFVLEVBQ25DLE1BQU0sRUFBSSxXQUFXLEdBQUcsV0FBVyxRQUFRLE1BQU0sQ0FBQyxFQUNsRCxNQUFNLEdBQUssV0FBVyxHQUFHLFFBQVEsUUFBUSxNQUFNLENBQUMsRUFDaEQsTUFBTSxHQUFLLFdBQVcsR0FBRyxRQUFRLFFBQVEsTUFBTSxDQUFDLEVBRWhELEdBQUksR0FBRyxjQUFnQixNQUFPLENBQzVCLFlBQWMsTUFBTSxzQkFBc0IsSUFBTSxLQUFLLG9CQUFvQixhQUFjLFNBQVUsRUFBRyxHQUFJLEdBQUksQ0FBRSxRQUFTLENBQUMsRUFBRyxZQUFZLE1BQU0sRUFBRSxDQUNqSixLQUFPLENBQ0wsWUFBYyxNQUFNLHNCQUFzQixJQUFNLEtBQUsscUJBQXFCLGFBQWMsU0FBVSxFQUFHLEdBQUksR0FBSSxDQUFFLFFBQVMsQ0FBQyxFQUFHLGFBQWEsTUFBTSxFQUFFLENBQ25KLENBRUEsR0FBRyxhQUFlLFlBQVksUUFDOUIsS0FBSyxnQkFBZ0IsQ0FBRSxLQUFNLGNBQWUsT0FBUSxPQUFRLEtBQU0sQ0FBRSxPQUFRLFNBQVUsZUFBZ0IsT0FBUSxHQUFHLEdBQUcsV0FBVyxNQUFNLENBQUMsWUFBWSxRQUFRLEVBQUcsQ0FBQyxDQUFDLEVBQy9KLFFBQVEsSUFBSSwyQ0FBMkMsR0FBRyxXQUFXLFFBQVEsTUFBTSxPQUFPLENBQUMsY0FBYyxHQUFHLFlBQVksRUFBRSxDQUM1SCxPQUFTLEVBQVEsQ0FDZixRQUFRLE1BQU0sb0RBQW9ELE1BQU0sSUFBSyxFQUFFLE9BQU8sRUFDdEYsR0FBRyxNQUFRLElBQ2IsQ0FDRixDQUVBLE1BQWMsVUFBVSxPQUFnQixNQUFrQixFQUFxQixDQUM3RSxHQUFJLE1BQU0sdUJBQXlCLFFBQWEsRUFBRSxXQUFhLE1BQU0scUJBQXNCLENBQ3pGLE1BQ0YsQ0FDQSxNQUFNLHFCQUF1QixFQUFFLFVBQy9CLE1BQU0sU0FBUyxLQUFLLENBQUMsRUFDckIsTUFBTSxhQUFhLGNBQWMsQ0FBQyxFQUdsQyxNQUFNLE1BQVEsR0FBSyxHQUFLLEdBQ3hCLElBQUksSUFBTSxLQUNWLEdBQUksTUFBTSxTQUFTLFNBQVcsRUFBRyxDQUMvQixJQUFNLEVBQUUsS0FDVixTQUFXLE1BQU0sT0FBTyxPQUFTLEVBQUcsQ0FDbEMsTUFBTSxRQUFVLE1BQU0sT0FBTyxNQUFNLE9BQU8sT0FBUyxDQUFDLEVBQ3BELEdBQUksVUFBWSxLQUFNLENBQ3BCLEtBQU8sRUFBRSxNQUFRLFNBQVcsTUFBUSxPQUN0QyxDQUNGLENBQ0EsTUFBTSxPQUFPLEtBQUssR0FBRyxFQUVyQixHQUFJLE1BQU0sU0FBUyxPQUFTLEdBQUksT0FHaEMsR0FBSSxNQUFNLFNBQVMsT0FBUyxJQUFNLENBQ2hDLE1BQU0sU0FBUyxNQUFNLEVBQ3JCLE1BQU0sT0FBTyxNQUFNLENBQ3JCLENBR0EsR0FBSSxLQUFLLFdBQVcsSUFBSSxNQUFNLEdBQUssa0JBQWtCLGFBQWEsTUFBTSxFQUFHLENBQ3pFLEtBQUssV0FBVyxPQUFRLE1BQU8sQ0FBQyxFQUFFLE1BQU0sR0FBSyxRQUFRLE1BQU0sMkNBQTJDLE1BQU0sSUFBSyxDQUFDLENBQUMsQ0FFckgsQ0FFQSxHQUFJLE1BQU0sYUFBZSxNQUFNLFNBQVMsUUFBVSxFQUFHLENBQ25ELEtBQUssK0JBQStCLE9BQVEsS0FBSyxFQUFFLE1BQU0sR0FBSyxRQUFRLE1BQU0sNERBQTRELE1BQU0sSUFBSyxDQUFDLENBQUMsQ0FDdkosQ0FHQSxNQUFNLFFBQVUsTUFBTSxhQUFhLHNCQUFzQixFQUN6RCxHQUFJLENBQUMsUUFBUyxPQUVkLElBQUksVUFBMkIsS0FDL0IsR0FBSSxRQUFRLGNBQWUsVUFBWSxjQUM5QixRQUFRLGdCQUFpQixVQUFZLGNBQ3JDLFFBQVEsb0JBQXFCLFVBQVksb0JBQ3pDLFFBQVEscUJBQXNCLFVBQVkscUJBQzFDLFFBQVEsWUFBYSxVQUFZLHFCQUNqQyxRQUFRLGVBQWdCLFVBQVksbUJBQ3BDLFFBQVEsZ0JBQWlCLFVBQVksWUFFOUMsR0FBSSxDQUFDLFVBQVcsT0FJaEIsSUFBSyxZQUFjLE9BQVMsWUFBYyxTQUFXLE9BQU8sU0FBUyxRQUFRLEdBQUssT0FBTyxTQUFTLFFBQVEsR0FBSSxPQUU5RyxHQUFJLFlBQWMsY0FBZ0IsT0FBTyxTQUFTLFFBQVEsRUFBRyxPQUU3RCxHQUFJLE9BQU8sU0FBUyxRQUFRLElBQU0sWUFBYyxhQUFlLFlBQWMsT0FBUyxZQUFjLGNBQWdCLFlBQWMsYUFBYyxPQUNoSixHQUFJLE9BQU8sU0FBUyxRQUFRLElBQU0sWUFBYyxPQUFTLFlBQWMsY0FBZ0IsWUFBYyxhQUFjLE9BRW5ILE1BQU0sSUFBTSxLQUFLLElBQUksRUFDckIsTUFBTSxNQUFRLEtBQUssaUJBQWlCLFNBQVMsRUFDN0MsTUFBTSxZQUFjLEtBQUssY0FBYyxJQUFJLEtBQUssR0FBSyxFQUNyRCxHQUFJLElBQU0sWUFBYyxHQUFLLEdBQUssSUFBTSxDQUN0QyxLQUFLLGNBQWMsSUFBSSxNQUFPLEdBQUcsRUFDakMsS0FBSyxxQkFBcUIsT0FBUSxVQUFXLEtBQUssQ0FDcEQsQ0FHQSxLQUFLLG1CQUFtQixPQUFRLE1BQU8sUUFBUyxTQUFTLEVBQUUsTUFBTSxHQUFLLFFBQVEsTUFBTSx1Q0FBdUMsTUFBTSxJQUFLLENBQUMsQ0FBQyxDQUMxSSxDQUVRLHFCQUFxQixPQUFnQixVQUFtQixNQUFlLENBQzdFLEdBQUksQ0FBQyxLQUFLLFdBQVcsSUFBSSxLQUFLLEVBQUcsT0FFakMsSUFBSSxRQUFVLDBCQUNkLEdBQUksUUFBVSxPQUFRLFFBQVUsV0FDaEMsR0FBSSxRQUFVLE9BQVEsUUFBVSxXQUVoQyxJQUFJLElBQU0sR0FBRyxPQUFPLDJCQUNwQixHQUFJLFFBQVUsT0FBUSxDQUNuQixNQUFNLEtBQU8sQ0FDWCxHQUFHLE9BQU8sK0VBQ1YsR0FBRyxPQUFPLDRFQUNWLEdBQUcsT0FBTyxnRUFDWixFQUNBLElBQU0sS0FBSyxLQUFLLE1BQU0sS0FBSyxPQUFPLEVBQUksS0FBSyxNQUFNLENBQUMsQ0FDckQsS0FBTyxDQUNKLEdBQUksWUFBYyxNQUFPLElBQU0sR0FBRyxPQUFPLDREQUN6QyxHQUFJLFlBQWMsTUFBTyxJQUFNLEdBQUcsT0FBTywwREFDekMsR0FBSSxZQUFjLFlBQWEsSUFBTSxHQUFHLE9BQU8sa0RBQy9DLEdBQUksWUFBYyxhQUFjLElBQU0sR0FBRyxPQUFPLHNEQUNoRCxHQUFJLFlBQWMsYUFBYyxJQUFNLEdBQUcsT0FBTyw2REFDaEQsR0FBSSxZQUFjLFdBQVksSUFBTSxHQUFHLE9BQU8sdURBQzlDLEdBQUksWUFBYyxZQUFhLElBQU0sR0FBRyxPQUFPLG9EQUNsRCxDQUVBLEtBQUssZ0JBQWdCLENBQ25CLEtBQU0sT0FDTixPQUNBLFFBQVMsSUFDVCxPQUFRLEtBQ1YsQ0FBQyxDQUNILENBRUEsTUFBYywrQkFBK0IsT0FBZ0IsTUFBa0IsQ0FDN0UsTUFBTSxNQUFRLE1BQU0sWUFDcEIsR0FBSSxDQUFDLE1BQU8sT0FHWixHQUFJLE1BQU0sUUFBVSxPQUFRLENBQzFCLE1BQU0sU0FBVyxNQUFNLFNBQ3ZCLEdBQUksVUFBWSxLQUFLLElBQUksRUFBSSxVQUFZLEVBQUksR0FBSyxHQUFLLElBQU0sQ0FDM0QsUUFBUSxJQUFJLDBFQUFtRSxNQUFNLGtCQUFrQixFQUN2RyxHQUFJLENBQ0YsTUFBTSxLQUFPLE1BQU0sb0JBQW9CLEtBQUssTUFBTyxLQUFLLFNBQVMsRUFDakUsTUFBTSxzQkFBc0IsSUFBTSxLQUFLLGNBQWMsTUFBTSxXQUFXLEVBQUcsWUFBWSxNQUFNLEVBQUUsRUFDN0YsTUFBTSxHQUFHLFFBQVEsNERBQTRELEVBQUUsSUFBSSxNQUFNLElBQUksRUFDN0YsVUFBVSxLQUFLLFVBQVcsT0FBUSxPQUFRLHNCQUF1QixZQUFZLE1BQU0sV0FBVyw4QkFBOEIsRUFDNUgsZ0JBQWdCLFFBQVEsS0FBSyxVQUFXLE1BQU0sV0FBVyxFQUN6RCxPQUFPLE1BQU0sWUFDYixNQUNGLE9BQVMsU0FBZSxDQUN0QixRQUFRLE1BQU0sb0VBQStELE1BQU0sV0FBVyxzQkFBdUIsU0FBUyxPQUFPLENBQ3ZJLENBQ0YsQ0FDRixDQUVBLE1BQU0sSUFBTSxNQUFNLFNBQVMsT0FDM0IsR0FBSSxJQUFNLEVBQUcsT0FFYixNQUFNLEdBQUssTUFBTSxTQUFTLElBQU0sQ0FBQyxFQUNqQyxNQUFNLEdBQUssTUFBTSxTQUFTLElBQU0sQ0FBQyxFQUNqQyxNQUFNLEdBQUssTUFBTSxTQUFTLElBQU0sQ0FBQyxFQUNqQyxNQUFNLEdBQUssTUFBTSxTQUFTLElBQU0sQ0FBQyxFQUNqQyxNQUFNLEdBQUssTUFBTSxTQUFTLElBQU0sQ0FBQyxFQUVqQyxJQUFJLGVBQWlCLE1BQ3JCLElBQUksTUFBUSxNQUFNLFFBQ2xCLE1BQU0sU0FBVyxNQUFNLE9BQU8sU0FDOUIsTUFBTSxVQUFZLE1BQU0sT0FBTyxRQUFVLEVBR3pDLEdBQUksTUFBTSxRQUFVLE9BQVEsQ0FDMUIsTUFBTUMsU0FBVSxjQUFjLE1BQU0sRUFBRSxRQUN0QyxNQUFNLE1BQVEsTUFBTSxZQUFjLE1BR2xDLE1BQU0sV0FBYSxNQUFNLFlBQWMsTUFBTSxRQUM3QyxNQUFNLFNBQVcsTUFBTSxVQUFhLEtBQUssSUFBSSxNQUFNLFdBQWEsVUFBVSxFQUFJQSxTQUU5RSxNQUFNLGVBQWlCLE1BQVEsR0FBRyxLQUFPLEdBQUcsSUFHNUMsTUFBTSxhQUFlLE9BQVMsZUFBaUIsTUFBTSxZQUFjQSxVQUFXLE1BQU0sV0FBYSxnQkFBa0JBLFNBQ25ILE1BQU0sU0FBVyxhQUFlLFNBRWhDLElBQUksaUJBQW1CLE1BQ3ZCLElBQUksVUFBWSxNQUFNLFFBRXRCLEdBQUksTUFBTyxDQUNULEdBQUksVUFBWSxJQUFPLE1BQU0sUUFBVSxNQUFNLFdBQVksQ0FDdEQsVUFBWSxNQUFNLFdBQ2xCLGlCQUFtQixJQUN0QixDQUNBLEdBQUksVUFBWSxFQUFLLENBQ2xCLE1BQU0sV0FBYSxlQUFrQixHQUFNLFNBQVdBLFNBQ3RELEdBQUksV0FBYSxNQUFNLFNBQVcsV0FBYSxVQUFXLENBQ3RELFVBQVksV0FDWixpQkFBbUIsSUFDdkIsQ0FDSCxDQUNGLEtBQU8sQ0FDTCxHQUFJLFVBQVksSUFBTyxNQUFNLFFBQVUsTUFBTSxXQUFZLENBQ3RELFVBQVksTUFBTSxXQUNsQixpQkFBbUIsSUFDdEIsQ0FDQSxHQUFJLFVBQVksRUFBSyxDQUVsQixNQUFNLFdBQWEsZUFBa0IsR0FBTSxTQUFXQSxTQUFZLFVBQVlBLFNBQzlFLEdBQUksV0FBYSxNQUFNLFNBQVcsV0FBYSxVQUFXLENBQ3RELFVBQVksV0FDWixpQkFBbUIsSUFDdkIsQ0FDSCxDQUNGLENBRUEsR0FBSSxpQkFBa0IsQ0FDcEIsTUFBTSxRQUFVLFVBQ2hCLEdBQUksQ0FDRixNQUFNLGFBQWUsT0FBTyxTQUFTLEtBQUssRUFBSSxFQUFLLE9BQU8sU0FBUyxLQUFLLEdBQUssT0FBTyxTQUFTLEtBQUssRUFBSSxFQUFJLEVBQzFHLE1BQU0sS0FBTyxNQUFNLG9CQUFvQixLQUFLLE1BQU8sS0FBSyxTQUFTLEVBQ2pFLE1BQU0sc0JBQXNCLElBQU0sS0FBSyxlQUFlLE1BQU0sWUFBYSxXQUFXLFVBQVUsUUFBUSxZQUFZLENBQUMsRUFBRyxNQUFNLE9BQU8sRUFBRyxhQUFhLE1BQU0sRUFBRSxFQUMzSixNQUFNRixLQUFNLEtBQU0sUUFBTyxhQUFhLCtGQUFHLFFBQ3pDLE1BQU1BLElBQUcsUUFBUSxrRUFBa0UsRUFBRSxJQUFJLFVBQVcsTUFBTSxXQUFXLEVBQ3JILFFBQVEsSUFBSSxxRUFBeUQsTUFBTSxrQkFBa0IsVUFBVSxRQUFRLFlBQVksQ0FBQyxFQUFFLENBQ2hJLE9BQVMsRUFBUSxDQUNmLFFBQVEsTUFBTSwyRUFBaUUsTUFBTSxJQUFLLEVBQUUsT0FBTyxDQUNyRyxDQUNGLENBQ0EsTUFDRixDQU1BLE1BQU0sUUFBVSxPQUFPLFNBQVMsS0FBSyxFQUFJLEdBQU8sT0FBTyxTQUFTLEtBQUssRUFBSSxFQUFNLE9BQU8sU0FBUyxLQUFLLEVBQUssU0FBVyxHQUNuRyxPQUFPLFNBQVMsS0FBSyxFQUFLLFNBQVcsR0FDckMsT0FBTyxTQUFTLEtBQUssRUFBSyxTQUFXLEdBQU8sU0FBVyxHQUl4RSxHQUFJLENBQUMsTUFBTSxnQkFBaUIsQ0FDMUIsTUFBTSxNQUFRLE1BQU0sWUFBYyxNQUNsQyxNQUFNLFdBQWEsT0FBUyxHQUFHLE1BQVEsTUFBTSxZQUFjLFNBQVcsTUFBTSxXQUFhLEdBQUcsT0FBUyxRQUNyRyxNQUFNLFFBQVUsV0FBYSxNQUFNLFNBRW5DLEdBQUksU0FBVyxJQUFLLENBQ2xCLE1BQU0sZ0JBQWtCLEtBRXhCLElBQUksS0FBTyxFQUNYLElBQUksV0FBYSxFQUNqQixHQUFJLENBQ0YsTUFBTSxLQUFPLE1BQU0sb0JBQW9CLEtBQUssTUFBTyxLQUFLLFNBQVMsRUFDakUsTUFBTSxJQUFNLE1BQU0sS0FBSyxZQUFZLE1BQU0sV0FBVyxFQUNwRCxHQUFJLElBQUssQ0FDUCxLQUFPLElBQUksTUFBUSxFQUNuQixXQUFhLElBQUksWUFBYyxDQUNqQyxDQUNGLE9BQVMsRUFBUSxDQUNmLFFBQVEsS0FBSyxrREFBa0QsTUFBTSxXQUFXLDRCQUE2QixFQUFFLE9BQU8sQ0FDeEgsQ0FDQSxNQUFNLFVBQVksS0FBTyxXQUN6QixJQUFJLGNBQWdCLEVBQ3BCLEdBQUksVUFBWSxFQUFHLENBQ2pCLE1BQU0sS0FBTyxjQUFjLE1BQU0sRUFDakMsTUFBTSxTQUFXLFNBQVcsTUFBTSxPQUFTLEtBQUssZ0JBQ2hELGNBQWdCLEtBQUssSUFBSSxTQUFTLEVBQUksUUFDeEMsQ0FDQSxNQUFNLFVBQVksRUFBTSxlQUFpQixRQUN6QyxJQUFJLFFBQVUsTUFBUSxNQUFNLFdBQWEsU0FBVyxNQUFNLFdBQWEsU0FFdkUsSUFBSSxPQUFTLE1BQ2IsR0FBSSxPQUFTLE1BQU0sUUFBVSxRQUFTLE9BQVMsYUFDdEMsQ0FBQyxPQUFTLE1BQU0sUUFBVSxRQUFTLE9BQVMsS0FFckQsR0FBSSxDQUNGLE1BQU0sS0FBTyxNQUFNLG9CQUFvQixLQUFLLE1BQU8sS0FBSyxTQUFTLEVBQ2pFLE1BQU0sYUFBZSxPQUFPLFNBQVMsS0FBSyxFQUFJLEVBQUssT0FBTyxTQUFTLEtBQUssR0FBSyxPQUFPLFNBQVMsS0FBSyxFQUFJLEVBQUksRUFFMUcsR0FBSSxNQUFNLFFBQVUsSUFBTSxDQUN4QixNQUFNLFdBQWEsS0FBSyxNQUFPLE1BQU0sT0FBUyxFQUFLLEdBQUcsRUFBSSxJQUMxRCxHQUFJLFlBQWMsSUFBTSxDQUl0QixNQUFNLGNBQWdCLE1BQU0sc0JBQXNCLElBQU0sS0FBSyx1QkFBdUIsTUFBTSxZQUFhLFdBQVksQ0FBQyxDQUFDLEVBQUcsZ0JBQWdCLE1BQU0sRUFBRSxFQUNoSixHQUFJLGVBQWUsWUFBYyxjQUFjLGFBQWUsTUFBTSxZQUFhLENBQy9FLE1BQU0sVUFBWSxjQUFjLFdBQ2hDLFFBQVEsSUFBSSxzQ0FBNEIsTUFBTSwyQkFBMkIsTUFBTSxXQUFXLGdCQUFXLFNBQVMsaUJBQWlCLEVBRS9ILE1BQU0sVUFBWSxNQUFNLFlBQ3hCLE1BQU0sWUFBYyxVQUVwQixNQUFNLEtBQU8sS0FBTSxRQUFPLGFBQWEsK0ZBQUcsUUFDMUMsTUFBTSxJQUFJLFFBQVEsdUVBQXVFLEVBQUUsSUFBSSxVQUFXLFNBQVMsQ0FDckgsQ0FDQSxRQUFRLElBQUksbUNBQTRCLE1BQU0scUNBQXFDLFVBQVUsUUFBUSxDQUN2RyxDQUNGLEtBQU8sQ0FDSixRQUFRLElBQUkseUNBQTZCLE1BQU0scUJBQXFCLE1BQU0sTUFBTSw0Q0FBNEMsQ0FDL0gsQ0FFQSxHQUFJLE9BQVEsQ0FDVixNQUFNLFFBQVUsUUFDaEIsTUFBTSxnQkFBa0IsUUFDeEIsTUFBTSxzQkFBd0IsUUFDOUIsTUFBTSxnQkFBa0IsUUFDeEIsTUFBTSxzQkFBd0IsUUFDOUIsTUFBUSxRQUVSLE1BQU0sc0JBQXNCLElBQU0sS0FBSyxlQUFlLE1BQU0sWUFBYSxXQUFXLFFBQVEsUUFBUSxZQUFZLENBQUMsRUFBRyxNQUFNLE9BQU8sRUFBRyxhQUFhLE1BQU0sRUFBRSxFQUN6SixNQUFNQSxLQUFNLEtBQU0sUUFBTyxhQUFhLCtGQUFHLFFBQ3pDLE1BQU1BLElBQUcsUUFBUSw4RUFBOEUsRUFBRSxJQUFJLFFBQVMsTUFBTSxXQUFXLEVBQy9ILFFBQVEsSUFBSSx5Q0FBNkIsTUFBTSw0Q0FBNEMsUUFBUSxRQUFRLFlBQVksQ0FBQyxJQUFJLENBQzlILEtBQU8sQ0FDTCxNQUFNQSxLQUFNLEtBQU0sUUFBTyxhQUFhLCtGQUFHLFFBQ3pDLE1BQU1BLElBQUcsUUFBUSxnRUFBZ0UsRUFBRSxJQUFJLE1BQU0sV0FBVyxDQUMxRyxDQUNGLE9BQVMsRUFBUSxDQUNmLFFBQVEsTUFBTSw2RUFBd0UsTUFBTSxJQUFLLEVBQUUsT0FBTyxDQUM1RyxDQUNGLENBQ0YsQ0FFQSxHQUFJLE1BQU0sWUFBYyxNQUFPLENBQzdCLEdBQUksR0FBRyxJQUFNLEdBQUcsS0FBTyxHQUFHLElBQU0sR0FBRyxLQUFPLEdBQUcsSUFBTSxHQUFHLEtBQU8sR0FBRyxJQUFNLEdBQUcsSUFBSyxDQUM1RSxNQUFNLG9CQUFzQixHQUFHLEdBQ2pDLENBQ0EsR0FBSSxHQUFHLEtBQU8sR0FBRyxNQUFRLEdBQUcsS0FBTyxHQUFHLE1BQVEsR0FBRyxLQUFPLEdBQUcsTUFBUSxHQUFHLEtBQU8sR0FBRyxLQUFNLENBQ3BGLE1BQU0sY0FBZ0IsR0FBRyxJQUMzQixDQUNBLEdBQUksTUFBTSxnQkFBa0IsTUFBUSxNQUFNLHNCQUF3QixLQUFNLENBQ3RFLEdBQUksR0FBRyxNQUFRLE1BQU0sY0FBZSxDQUNsQyxHQUFJLE1BQU0sc0JBQXdCLE1BQU0sZ0JBQWlCLENBQ3ZELE1BQU0sc0JBQXdCLE1BQU0sZ0JBQ3BDLE1BQU0sZ0JBQWtCLE1BQU0sb0JBQzlCLEdBQUksTUFBTSxzQkFBd0IsTUFBTSxRQUFTLENBQy9DLE1BQVEsTUFBTSxzQkFBd0IsUUFDdEMsZUFBaUIsSUFDbkIsQ0FDRixDQUNGLENBQ0YsQ0FDRixTQUFXLE1BQU0sWUFBYyxPQUFRLENBQ3JDLEdBQUksR0FBRyxLQUFPLEdBQUcsTUFBUSxHQUFHLEtBQU8sR0FBRyxNQUFRLEdBQUcsS0FBTyxHQUFHLE1BQVEsR0FBRyxLQUFPLEdBQUcsS0FBTSxDQUNwRixNQUFNLHFCQUF1QixHQUFHLElBQ2xDLENBQ0EsR0FBSSxHQUFHLElBQU0sR0FBRyxLQUFPLEdBQUcsSUFBTSxHQUFHLEtBQU8sR0FBRyxJQUFNLEdBQUcsS0FBTyxHQUFHLElBQU0sR0FBRyxJQUFLLENBQzVFLE1BQU0sYUFBZSxHQUFHLEdBQzFCLENBQ0EsR0FBSSxNQUFNLGVBQWlCLE1BQVEsTUFBTSx1QkFBeUIsS0FBTSxDQUN0RSxHQUFJLEdBQUcsTUFBUSxNQUFNLGFBQWMsQ0FDakMsR0FBSSxNQUFNLHVCQUF5QixNQUFNLGdCQUFpQixDQUN4RCxNQUFNLHNCQUF3QixNQUFNLGdCQUNwQyxNQUFNLGdCQUFrQixNQUFNLHFCQUM5QixHQUFJLE1BQU0sc0JBQXdCLE1BQU0sUUFBUyxDQUMvQyxNQUFRLE1BQU0sc0JBQXlCLFVBQVksUUFBVyxRQUM5RCxlQUFpQixJQUNuQixDQUNGLENBQ0YsQ0FDRixDQUNGLENBRUEsR0FBSSxlQUFnQixDQUNqQixNQUFNLFFBQVUsTUFDaEIsR0FBSSxDQUNBLE1BQU0sYUFBZSxPQUFPLFNBQVMsS0FBSyxFQUFJLEVBQUssT0FBTyxTQUFTLEtBQUssR0FBSyxPQUFPLFNBQVMsS0FBSyxFQUFJLEVBQUksRUFDMUcsTUFBTSxLQUFPLE1BQU0sb0JBQW9CLEtBQUssTUFBTyxLQUFLLFNBQVMsRUFDakUsTUFBTSxzQkFBc0IsSUFBTSxLQUFLLGVBQWUsTUFBTSxZQUFhLFdBQVcsTUFBTSxRQUFRLFlBQVksQ0FBQyxFQUFHLE1BQU0sT0FBTyxFQUFHLGFBQWEsTUFBTSxFQUFFLEVBQ3ZKLE1BQU1BLEtBQU0sS0FBTSxRQUFPLGFBQWEsK0ZBQUcsUUFDekMsTUFBTUEsSUFBRyxRQUFRLGtFQUFrRSxFQUFFLElBQUksTUFBTyxNQUFNLFdBQVcsRUFDakgsUUFBUSxJQUFJLHlDQUE2QixNQUFNLG1EQUFtRCxNQUFNLFFBQVEsWUFBWSxDQUFDLEVBQUUsQ0FDbkksT0FBUyxFQUFRLENBQ2IsUUFBUSxNQUFNLG9FQUErRCxNQUFNLElBQUssRUFBRSxPQUFPLENBQ3JHLENBQ0gsQ0FDRixDQUVBLE1BQWMsbUJBQW1CLE9BQWdCLE1BQWtCLFFBQWMsVUFBbUIsQ0FDbEcsUUFBUSxJQUFJLHlDQUF5QyxNQUFNLG1CQUFtQixTQUFTLEVBQUUsRUFDekYsTUFBTSxNQUFRLEtBQUssaUJBQWlCLFNBQVMsRUFDN0MsR0FBSSxDQUFDLEtBQUssV0FBVyxJQUFJLEtBQUssRUFBRyxDQUFFLFFBQVEsSUFBSSxvQ0FBcUMsS0FBSyxFQUFHLE1BQVEsQ0FDcEcsR0FBSSxNQUFNLFlBQWEsQ0FBRSxRQUFRLElBQUksNEJBQTRCLEVBQUcsTUFBUSxDQUM1RSxNQUFNLEVBQUksTUFBTSxTQUFTLE1BQU0sU0FBUyxPQUFTLENBQUMsRUFDbEQsR0FBSSxDQUFDLEVBQUcsQ0FBRSxRQUFRLElBQUksNkJBQTZCLEVBQUcsTUFBUSxDQUU5RCxNQUFNLFVBQVksZUFBZSxDQUFFLEtBQU0sT0FBUSxVQUFXLFVBQVcsRUFBRSxTQUFVLENBQUMsRUFDcEYsUUFBUSxJQUFJLG9DQUFvQyxTQUFTLEVBQUUsRUFDM0QsR0FBSSxDQUFDLFVBQVcsQ0FDZCxNQUNGLENBRUEsTUFBTSxNQUFRLE1BQU0sU0FBUyxNQUFNLFNBQVMsT0FBUyxDQUFDLEVBRXRELElBQUksWUFBYyxNQUNsQixJQUFJLGtCQUFvQixHQUV4QixNQUFNLFNBQVcsTUFBTSxPQUFPLFNBQzlCLE1BQU0sUUFBVSxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssRUFBSSxHQUFPLE1BQU0sT0FBTyxLQUFLLFNBQVMsS0FBSyxFQUFJLEVBQU0sU0FBVyxHQUNoSCxNQUFNLE1BQVEsTUFBTSxPQUFPLE1BQU0sT0FBTyxPQUFTLENBQUMsR0FBSyxFQUV2RCxJQUFJLFlBQWMsTUFBTSxPQUFPLFlBQy9CLEdBQUksY0FBZ0IsT0FBVyxDQUM3QixZQUFjLEVBQ2QsR0FBSSxPQUFPLFNBQVMsS0FBSyxFQUFHLFlBQWMsV0FDakMsT0FBTyxTQUFTLEtBQUssRUFBRyxZQUFjLFdBQ3RDLE9BQU8sU0FBUyxNQUFNLEdBQUssT0FBTyxTQUFTLE9BQU8sRUFBRyxZQUFjLFdBQ25FLE9BQU8sU0FBUyxLQUFLLEVBQUcsWUFBYyxZQUN0QyxPQUFPLFNBQVMsS0FBSyxFQUFHLFlBQWMsVUFDdEMsT0FBTyxTQUFTLEtBQUssR0FBSyxPQUFPLFNBQVMsS0FBSyxHQUFLLE9BQU8sU0FBUyxLQUFLLEdBQUssT0FBTyxTQUFTLEtBQUssRUFBRyxZQUFjLENBQy9ILENBRUEsTUFBTSxXQUFhLEtBQUssSUFBSSxFQUFFLEtBQU8sRUFBRSxHQUFHLEVBQUksUUFDOUMsTUFBTSxVQUFZLEtBQUssSUFBSSxFQUFFLE1BQVEsRUFBRSxJQUFJLEVBQUksUUFDL0MsTUFBTSxlQUFpQixFQUFFLEtBQU8sS0FBSyxJQUFJLEVBQUUsS0FBTSxFQUFFLEtBQUssR0FBSyxRQUM3RCxNQUFNLGVBQWlCLEtBQUssSUFBSSxFQUFFLEtBQU0sRUFBRSxLQUFLLEVBQUksRUFBRSxLQUFPLFFBRzVELE1BQU0sbUJBQXFCLEVBQUUsTUFBUSxFQUFFLE1BQVEsTUFBTSxNQUFRLE1BQU0sTUFBUSxFQUFFLE1BQVEsTUFBTSxPQUFTLEVBQUUsT0FBUyxNQUFNLE1BQVEsV0FBYSxZQUMxSSxNQUFNLG1CQUFxQixFQUFFLE1BQVEsRUFBRSxNQUFRLE1BQU0sTUFBUSxNQUFNLE1BQVEsRUFBRSxNQUFRLE1BQU0sT0FBUyxFQUFFLE9BQVMsTUFBTSxNQUFRLFdBQWEsWUFHMUksTUFBTSxvQkFBc0IsTUFBTSxPQUFPLHFCQUF1QixJQUNoRSxNQUFNLGFBQWUsZUFBaUIsVUFBWSxxQkFBdUIsZUFBaUIsYUFBZSxlQUFpQixLQUFLLElBQUksRUFBSyxTQUFTLEVBQ2pKLE1BQU0sYUFBZSxlQUFpQixVQUFZLHFCQUF1QixlQUFpQixhQUFlLGVBQWlCLEtBQUssSUFBSSxFQUFLLFNBQVMsRUFFakosTUFBTSxpQkFBbUIsb0JBQXNCLGFBQy9DLE1BQU0saUJBQW1CLG9CQUFzQixhQUUvQyxNQUFNLGNBQWdCLEdBQUssUUFFM0IsR0FBSSxZQUFjLE9BQVMsWUFBYyxZQUFhLENBQ3BELEdBQUksaUJBQWtCLENBQ3BCLGtCQUFvQixPQUNwQixHQUFJLFlBQWMsWUFBYSxDQUM1QixNQUFNLFdBQWEsTUFBTSxhQUFhLGdCQUFnQixFQUN0RCxNQUFNLFNBQVcsV0FBYSxXQUFXLEtBQU8sRUFDaEQsR0FBSSxNQUFNLE1BQVEsU0FBVyxlQUFpQixFQUFFLE1BQVEsU0FBVyxjQUFlLFlBQWMsSUFDbkcsS0FBTyxDQUNKLEdBQUksRUFBRSxLQUFRLFFBQVEsTUFBUSxRQUFRLEtBQU8sUUFBUSxLQUFPLEdBQU0sWUFBYyxJQUNuRixDQUNGLENBRUEsR0FBSSxZQUFjLE9BQVMsaUJBQWtCLENBQzNDLGtCQUFvQixNQUNwQixHQUFJLEVBQUUsSUFBTyxRQUFRLEtBQU8sUUFBUSxLQUFPLFFBQVEsS0FBTyxHQUFNLFlBQWMsSUFDaEYsQ0FDRixTQUFXLFlBQWMsT0FBUyxZQUFjLGFBQWMsQ0FDNUQsR0FBSSxpQkFBa0IsQ0FDcEIsa0JBQW9CLE1BQ3BCLEdBQUksWUFBYyxhQUFjLENBQzdCLE1BQU0sV0FBYSxNQUFNLGFBQWEsZ0JBQWdCLEVBQ3RELE1BQU0sUUFBVSxXQUFhLFdBQVcsSUFBTSxTQUM5QyxHQUFJLE1BQU0sS0FBTyxRQUFVLGVBQWlCLEVBQUUsS0FBTyxRQUFVLGNBQWUsWUFBYyxJQUMvRixLQUFPLENBQ0osR0FBSSxFQUFFLElBQU8sUUFBUSxLQUFPLFFBQVEsS0FBTyxRQUFRLEtBQU8sR0FBTSxZQUFjLElBQ2pGLENBQ0YsQ0FFQSxHQUFJLFlBQWMsT0FBUyxpQkFBa0IsQ0FDM0Msa0JBQW9CLE9BQ3BCLEdBQUksRUFBRSxLQUFRLFFBQVEsTUFBUSxRQUFRLEtBQU8sUUFBUSxLQUFPLEdBQU0sWUFBYyxJQUNsRixDQUNGLFNBQVcsWUFBYyxhQUFjLENBQ3JDLEdBQUksaUJBQWtCLENBQ3BCLEdBQUksTUFBTSxLQUFPLFFBQVEsTUFBUSxFQUFFLEtBQU8sUUFBUSxLQUFNLENBQ3JELFlBQWMsS0FDZCxrQkFBb0IsTUFDdkIsQ0FDRixTQUFXLGlCQUFrQixDQUMzQixHQUFJLE1BQU0sSUFBTSxRQUFRLEtBQU8sRUFBRSxJQUFNLFFBQVEsSUFBSyxDQUNqRCxZQUFjLEtBQ2Qsa0JBQW9CLEtBQ3ZCLENBQ0YsQ0FDRixTQUFXLFlBQWMsV0FBWSxDQUNuQyxrQkFBb0IsTUFDcEIsR0FBSSxrQkFBb0IsRUFBRSxLQUFPLE9BQVMsRUFBRSxNQUFRLE1BQU8sQ0FDdkQsWUFBYyxJQUNsQixDQUNGLFNBQVcsWUFBYyxZQUFhLENBQ3BDLGtCQUFvQixPQUNwQixHQUFJLGtCQUFvQixFQUFFLE1BQVEsT0FBUyxFQUFFLE1BQVEsTUFBTyxDQUN4RCxZQUFjLElBQ2xCLENBQ0YsQ0FFQSxHQUFJLENBQUMsWUFBYSxPQUdsQixNQUFNLEtBQU8sRUFBRSxRQUNmLE1BQU0sT0FBVyxNQUFRLElBQU0sS0FBTyxHQUN0QyxNQUFNLFNBQVcsTUFBUSxHQUFNLEtBQU8sRUFDdEMsTUFBTSxLQUFXLE1BQVEsR0FBTSxLQUFPLEdBRXRDLElBQUksU0FBVyxNQUNmLFVBQVcsV0FBVyxNQUFNLE9BQU8sVUFBWSxDQUFDLEVBQUcsQ0FDakQsR0FBSSxVQUFZLFFBQVUsT0FBUSxTQUFXLEtBQzdDLEdBQUksVUFBWSxVQUFZLFNBQVUsU0FBVyxLQUNqRCxHQUFJLFVBQVksTUFBUSxLQUFNLFNBQVcsSUFDM0MsQ0FFQSxHQUFJLENBQUMsU0FBVSxPQUVmLEdBQUksS0FBSyxXQUFXLE9BQVMsRUFBRyxPQUNoQyxHQUFJLE1BQU0sYUFBYyxPQUd4QixNQUFNLFVBQVksZ0JBQWdCLFNBQVMsS0FBSyxVQUFXLE9BQVEsa0JBQXFDLE1BQU0sRUFDOUcsR0FBSSxDQUFDLFVBQVUsU0FBVSxDQUN2QixNQUNGLENBRUEsTUFBTSxhQUFlLEtBQ3JCLGdCQUFnQixtQkFBbUIsS0FBSyxVQUFXLE1BQU0sRUFDekQsR0FBSSxDQUNGLE1BQU0sR0FBSyxNQUFNLEVBQ2pCLEdBQUksR0FBSSxDQUNOLEdBQUcsR0FBRyxXQUFXLEtBQUssU0FBUyxFQUFFLEVBQUUsS0FBSyxrQ0FBbUMsQ0FDekUsT0FDQSxVQUNBLEtBQU0sRUFBRSxPQUNWLENBQUMsQ0FDSCxDQUVBLFFBQVEsSUFBSSx5REFBa0QsTUFBTSxJQUFJLFNBQVMsMkJBQTJCLEVBRTVHLE1BQU0sYUFBZSxNQUFNLGFBQWEsYUFDeEMsTUFBTUcsU0FBVSxhQUFhLE9BQVMsRUFBSSxhQUFhLGFBQWEsT0FBUyxDQUFDLEVBQUksS0FDbEYsTUFBTSxLQUFPLGFBQWEsT0FBUyxFQUFJLGFBQWEsYUFBYSxPQUFTLENBQUMsRUFBSSxLQUMvRSxNQUFNLFdBQWEsTUFBTSxhQUFhLGdCQUFnQixFQU10RCxNQUFNQyxNQUFPLEVBQUUsUUFDZixNQUFNLFNBQVdBLE9BQVEsR0FBS0EsTUFBTyxFQUNyQyxNQUFNLEtBQU9BLE9BQVEsR0FBS0EsTUFBTyxHQUNqQyxNQUFNLE9BQVNBLE9BQVEsR0FDdkIsTUFBTSxXQUFhLFNBQVcsY0FBZ0IsS0FBTyxnQkFBa0IsT0FBUyxZQUFjLFlBRTlGLEtBQU0sQ0FBRSxRQUFTLGNBQWUsUUFBUyxFQUFJLGVBQWUsTUFBTSxTQUFVLE1BQU0sU0FBUyxPQUFTLEVBQUcsRUFBRSxFQUN6RyxNQUFNLFdBQWEsTUFBTSxPQUFPLE1BQU0sU0FBVSxNQUFNLFNBQVMsTUFBTSxFQUVyRSxNQUFNLG1CQUFxQixjQUFjLFVBQVUsSUFBTSxDQUN2RCxHQUFJLFNBQVUsT0FBTyxHQUFHLFNBQVcsRUFDbkMsR0FBSSxLQUFNLE9BQU8sR0FBRyxTQUFXLEVBQy9CLEdBQUksT0FBUSxPQUFPLEdBQUcsU0FBVyxHQUNqQyxNQUFPLE1BQ1QsQ0FBQyxFQUVELE1BQU0sVUFBWSxZQUFZLENBQzVCLFFBQVMsY0FDVCxVQUFXLE1BQU0sS0FBSyxVQUFVLEVBQ2hDLFlBQWFELFNBQVVBLFNBQVEsS0FBTyxFQUN0QyxXQUFZQSxTQUFVQSxTQUFRLElBQU0sRUFDcEMsZUFBZ0IsV0FBYSxXQUFXLEtBQU8sRUFDL0MsY0FBZSxXQUFhLFdBQVcsSUFBTSxFQUM3QyxVQUNBLEtBQU0sT0FDTixZQUFhLFdBQ2IsZ0JBQWlCLG1CQUNqQixjQUFlLGNBQWMsT0FBUyxDQUN4QyxDQUFDLEVBRUQsTUFBTUQsU0FBVSxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssRUFBSSxHQUFPLE1BQU0sT0FBTyxLQUFLLFNBQVMsS0FBSyxFQUFJLEVBQU0sTUFBTSxPQUFPLFNBQVcsR0FDN0gsTUFBTSxhQUFlLEVBQUUsTUFDdkIsTUFBTSxrQkFBb0JDLFNBQVUsS0FBSyxJQUFJQSxTQUFRLEtBQU8sWUFBWSxFQUFJRCxTQUFVLEVBQ3RGLE1BQU0sa0JBQW9CQyxTQUFVLEtBQUssSUFBSSxhQUFlQSxTQUFRLEdBQUcsRUFBSUQsU0FBVSxFQUNyRixNQUFNLDBCQUE0QixXQUFhLEtBQUssSUFBSSxXQUFXLEtBQU8sWUFBWSxFQUFJQSxTQUFVLEVBQ3BHLE1BQU0seUJBQTJCLFdBQWEsS0FBSyxJQUFJLGFBQWUsV0FBVyxHQUFHLEVBQUlBLFNBQVUsRUFFbEcsSUFBSSxlQUFpQixVQUNyQixHQUFJQyxXQUFZQSxTQUFRLGlCQUFtQkEsU0FBUSxlQUFnQixlQUFpQixpQkFDcEYsR0FBSUEsV0FBWUEsU0FBUSxnQkFBa0JBLFNBQVEsaUJBQWtCLGVBQWlCLGlCQUVyRixNQUFNLHFCQUF1QixZQUFZLGtCQUFrQixPQUFRLFNBQVMsRUFFNUUsTUFBTSxPQUFTLE1BQU0sS0FBSyxVQUFVLFNBQVMsVUFBVyxDQUN0RCxLQUFNLE9BQ04sVUFDQSxZQUFhLFdBQ2IsY0FBZSxFQUFFLFFBQ2pCLFlBQWFBLFNBQVVBLFNBQVEsS0FBTyxFQUN0QyxXQUFZQSxTQUFVQSxTQUFRLElBQU0sRUFDcEMsZUFBZ0IsV0FBYSxXQUFXLEtBQU8sRUFDL0MsY0FBZSxXQUFhLFdBQVcsSUFBTSxFQUM3QyxhQUFjLE1BQU0sT0FBTyxNQUFNLE9BQU8sT0FBUyxDQUFDLEdBQUssRUFDdkQsU0FBVSxNQUFNLE9BQU8sU0FDdkIsYUFDQSxlQUNBLGtCQUNBLGtCQUNBLDBCQUNBLHdCQUNGLEVBQUcsb0JBQW9CLEVBRXZCLFFBQVEsSUFBSSw4Q0FBdUMsTUFBTSxLQUFLLE9BQU8sUUFBUSxLQUFLLE9BQU8sVUFBVSxJQUFJLEVBRXZHLEdBQUksR0FBSSxDQUNOLEdBQUcsR0FBRyxXQUFXLEtBQUssU0FBUyxFQUFFLEVBQUUsS0FBSyxtQ0FBb0MsQ0FDMUUsT0FDQSxVQUNBLFNBQVUsT0FBTyxTQUNqQixXQUFZLE9BQU8sVUFDckIsQ0FBQyxDQUNILENBRUEsTUFBTUUsT0FBUSxLQUFLLGlCQUFpQixTQUFTLEVBRzdDLEdBQUksT0FBTyxXQUFhLFdBQVksQ0FDaEMsSUFBSSxVQUFZLE9BQ2hCLEdBQUksWUFBYyxPQUFTLFlBQWMsY0FBZ0IsWUFBYyxXQUFZLFVBQVksTUFDL0YsR0FBSSxZQUFjLE9BQVMsWUFBYyxhQUFlLFlBQWMsWUFBYSxVQUFZLE9BRS9GLE1BQU0sSUFBTSxVQUFVLFNBQVMsY0FBYyxPQUFPLFdBQWEsb0JBQW9CLEdBQ3JGLFVBQVUsS0FBSyxVQUFXQSxPQUFPLE9BQVEsc0JBQXNCLFNBQVMsR0FBSSxHQUFHLEVBR2pGLEtBQUssWUFBWSxJQUFJLE9BQVEsS0FBSyxJQUFJLEVBQUksR0FBSyxHQUFNLEVBQ3JELFFBQVEsSUFBSSxtQ0FBNEIsTUFBTSxnREFBZ0QsRUFFNUYsS0FBSyxnQkFBZ0IsQ0FDbkIsS0FBTSxjQUNOLE9BQVFBLE9BQ1IsS0FBTSxDQUFFLE9BQVEsU0FBVSxZQUFZLFNBQVMsR0FBSSxPQUFRLE9BQU8sU0FBVSxDQUM5RSxDQUFDLEVBQ0gsTUFDRixDQU9BLEdBQUksT0FBTyxXQUFhLGtCQUFtQixDQUN2QyxRQUFRLEtBQUssZ0VBQXlELE1BQU0sY0FBYyxpQkFBaUIsUUFBUSxTQUFTLGlCQUFpQixPQUFPLFFBQVEscUJBQXFCLEVBQ2pMLE9BQU8sU0FBVyxXQUNsQixVQUFVLEtBQUssVUFBV0EsT0FBTyxPQUFRLHlCQUEwQixZQUFZLGlCQUFpQixvQkFBb0IsT0FBTyxRQUFRLGtCQUFrQixFQUNySixLQUFLLGdCQUFnQixDQUNqQixLQUFNLGNBQ04sT0FBUSxLQUFLLGlCQUFpQixTQUFTLEVBQ3ZDLEtBQU0sQ0FBRSxPQUFRLFNBQVUsd0JBQXlCLE9BQVEsWUFBWSxpQkFBaUIsRUFBRyxDQUMvRixDQUFDLEVBQ0QsTUFDSixDQUVBLEdBQUssT0FBTyxXQUFhLE9BQVMsT0FBTyxXQUFhLE9BQVMsQ0FHN0QsTUFBTUMsVUFBVyxNQUFNLE9BQU8sU0FDOUIsTUFBTUosU0FBVSxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssRUFBSSxHQUFPLE1BQU0sT0FBTyxLQUFLLFNBQVMsS0FBSyxFQUFJLEVBQU1JLFVBQVcsR0FDaEgsTUFBTSxFQUFJLEVBQUUsTUFHWixNQUFNLFdBQWEsTUFBTSxPQUFPLEtBQUssU0FBUyxLQUFLLEdBQUssTUFBTSxPQUFPLEtBQUssU0FBUyxLQUFLLEdBQUssTUFBTSxPQUFPLEtBQUssU0FBUyxNQUFNLEdBQUssTUFBTSxPQUFPLEtBQUssU0FBUyxPQUFPLEdBQUssTUFBTSxPQUFPLEtBQUssU0FBUyxRQUFRLEdBQUssTUFBTSxPQUFPLEtBQUssU0FBUyxRQUFRLEdBQUssTUFBTSxPQUFPLEtBQUssU0FBUyxRQUFRLEdBQUssTUFBTSxPQUFPLEtBQUssU0FBUyxRQUFRLEVBRXJVLElBQUksV0FBYSxXQUFhLEdBQUssSUFBTUosU0FDekMsR0FBSSxNQUFNLE9BQU8sWUFBYyxPQUFXLFVBQVksTUFBTSxPQUFPLFVBQVlBLFNBRS9FLElBQUksUUFBVSxHQUNkLEdBQUksTUFBTSxPQUFPLEtBQUssU0FBUyxLQUFLLEVBQUcsUUFBVSxZQUN4QyxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssRUFBRyxRQUFVLElBQ3RELEdBQUksTUFBTSxPQUFPLEtBQUssU0FBUyxLQUFLLEVBQUcsUUFBVSxZQUN4QyxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssR0FBSyxNQUFNLE9BQU8sS0FBSyxTQUFTLE1BQU0sR0FBSyxNQUFNLE9BQU8sS0FBSyxTQUFTLE9BQU8sRUFBRyxRQUFVLElBRW5JLElBQUksVUFBWSxRQUFVQSxTQUMxQixHQUFJLE1BQU0sT0FBTyxZQUFjLE9BQVcsVUFBWSxNQUFNLE9BQU8sVUFBWUEsU0FFL0UsTUFBTSxTQUFXLFdBQWEsV0FBVyxLQUFPLEVBQUksVUFDcEQsTUFBTSxRQUFVLFdBQWEsV0FBVyxJQUFNLEVBQUksVUFDbEQsTUFBTSxNQUFRQyxTQUFVQSxTQUFRLEtBQU8sRUFBSSxVQUMzQyxNQUFNLEtBQU9BLFNBQVVBLFNBQVEsSUFBTSxFQUFJLFVBQ3pDLE1BQU0sT0FBUyxLQUFPLEtBQUssS0FBTyxFQUFJLFVBQ3RDLE1BQU0sTUFBUSxLQUFPLEtBQUssSUFBTSxFQUFJLFVBSXBDLE1BQU0sU0FBVyxLQUFLLElBQUksRUFBRSxLQUFNLE1BQU0sSUFBSSxFQUM1QyxNQUFNLFFBQVUsS0FBSyxJQUFJLEVBQUUsSUFBSyxNQUFNLEdBQUcsRUFDekMsSUFBSSxhQUFlLE9BQU8sV0FBYSxPQUFVLFNBQVksTUFBTSxPQUFPLE9BQVNELFNBQVksR0FBS0EsU0FBYSxRQUFXLEdBQUtBLFNBR2pJLElBQUksV0FBYSxXQUFhLEdBQUssSUFBTUEsU0FDekMsR0FBSSxNQUFNLE9BQU8sWUFBYyxPQUFXLFVBQVksTUFBTSxPQUFPLFVBQVlBLFNBRS9FLElBQUksZUFBaUIsV0FBYSxJQUFNLElBQU1BLFNBQzlDLEdBQUksTUFBTSxPQUFPLGdCQUFrQixPQUFXLGNBQWdCLE1BQU0sT0FBTyxjQUFnQkEsU0FFM0YsSUFBSSxXQUFhLFdBQWEsSUFBTSxJQUFNQSxTQUMxQyxHQUFJLE1BQU0sT0FBTyxZQUFjLE9BQVcsVUFBWSxNQUFNLE9BQU8sVUFBWUEsU0FDL0UsSUFBSSxhQUFlLEVBRW5CLEdBQUksT0FBTyxXQUFhLE9BQVEsQ0FDOUIsR0FBSSxFQUFJLE9BQVMsVUFBVyxhQUFlLEtBQUssSUFBSSxNQUFPLEVBQUksU0FBUyxVQUMvRCxFQUFJLE1BQVEsVUFBVyxhQUFlLEtBQUssSUFBSSxLQUFNLEVBQUksU0FBUyxPQUN0RSxhQUFlLEVBQUksYUFDMUIsS0FBTyxDQUNMLEdBQUksT0FBUyxHQUFLLFVBQVcsYUFBZSxLQUFLLElBQUksT0FBUSxFQUFJLFNBQVMsVUFDakUsTUFBUSxHQUFLLFVBQVcsYUFBZSxLQUFLLElBQUksTUFBTyxFQUFJLFNBQVMsT0FDeEUsYUFBZSxFQUFJLGFBQzFCLENBRUEsTUFBTSxpQkFBbUIsS0FBSyxJQUFJLEVBQUksWUFBWSxFQUNsRCxNQUFNLFVBQVksVUFBWUEsU0FFOUIsR0FBSSxpQkFBbUIsVUFBVyxDQUNoQyxRQUFRLEtBQUssc0RBQStDLE1BQU0saUNBQWlDLGlCQUFtQkEsVUFBUyxRQUFRLENBQUMsQ0FBQyxvQkFBb0IsU0FBUyxRQUFRLEVBQzlLLE9BQU8sU0FBVyxXQUNsQixNQUNGLENBRUEsR0FBSSxPQUFPLFdBQWEsT0FBUSxDQUM5QixHQUFJLGFBQWUsRUFBSSxVQUFXLGFBQWUsRUFBSSxTQUN2RCxLQUFPLENBQ0wsR0FBSSxhQUFlLEVBQUksVUFBVyxhQUFlLEVBQUksU0FDdkQsQ0FHQSxNQUFNLGlCQUFtQixLQUFLLElBQUksRUFBSSxZQUFZLEVBQUlBLFNBRXRELE9BQU8sU0FBVyxhQUNsQixPQUFPLFdBQWEsYUFDcEIsT0FBTyxTQUFXLGlCQUVsQixNQUFNLFFBQVUsTUFBTSxHQUFHLFFBQVEsa0pBQWtKLEVBQUUsSUFBSSxLQUFLLFNBQVMsRUFFdk0sR0FBSSxDQUFDLFNBQVcsQ0FBQyxRQUFRLGtCQUFtQixDQUMxQyxRQUFRLElBQUksMERBQW1ELE1BQU0scUNBQXFDLEtBQUssU0FBUyxFQUFFLENBQzVILEtBQU8sQ0FDTCxJQUFJLGFBQWUsT0FDbkIsSUFBSSxLQUEyQixPQUMvQixHQUFJLENBRUYsTUFBTSxhQUFlLGdCQUFnQixJQUFJLElBQU0sRUFDL0MsTUFBTSxVQUFZLGFBQWEsU0FBUyxFQUN4QyxNQUFNLFVBQVksYUFBYSxXQUFXLEVBQzFDLEdBQUssWUFBYyxJQUFNLFdBQWEsSUFBUSxZQUFjLElBQU0sVUFBWSxHQUFLLENBQ2pGLFFBQVEsS0FBSyxnQ0FBMkIsTUFBTSxtRUFBOEQsRUFDNUcsVUFBVSxLQUFLLFVBQVdHLE9BQU8sT0FBUSxnQkFBaUIsOEJBQThCLEVBQ3hGLE1BQ0YsQ0FFQSxLQUFNLENBQUUsWUFBYSxPQUFRLEVBQUksS0FBTSxRQUFPLGlCQUFpQiw4RkFDL0QsTUFBTSxNQUFRLFlBQVksUUFBUSxhQUFhLEVBQUksUUFBUSxRQUFRLGFBQWEsRUFBSSxRQUFRLGNBQzVGLE1BQU0sVUFBWSxxQkFBcUIsUUFBUSxrQkFBa0IsRUFDakUsTUFBTSxLQUFPLE1BQU0sb0JBQW9CLE1BQU8sU0FBUyxFQUN2RCxhQUFlLE1BQU0sZ0JBQWdCLEtBQU0sTUFBTSxFQUNqRCxNQUFNLFlBQWUsTUFBTSxzQkFBc0IsSUFBTSxLQUFLLHNCQUFzQixFQUFHLGVBQWUsTUFBTSxFQUFFLEVBRzVHLEdBQUksYUFBZSxZQUFZLGNBQWdCLFFBQWEsWUFBWSxZQUFjLElBQUssQ0FDekYsUUFBUSxLQUFLLGdDQUEyQixZQUFZLHlDQUFvQyxZQUFZLFlBQVksUUFBUSxDQUFDLENBQUMsS0FBSyxFQUMvSCxVQUFVLEtBQUssVUFBV0EsT0FBTyxhQUFjLGdCQUFpQixxQkFBcUIsWUFBWSxZQUFZLFFBQVEsQ0FBQyxDQUFDLEtBQUssRUFDNUgsTUFDRixDQUtBLE1BQU0sV0FBYSxNQUFNLEtBQUssZUFBZSxZQUFZLEVBQ3pELE1BQU0sV0FBYSxPQUFPLFdBQWEsTUFBUSxXQUFXLElBQU0sV0FBVyxJQUMzRSxNQUFNLEtBQU8sY0FBYyxZQUFZLEVBQ3ZDLE1BQU0sYUFBZSxLQUFLLElBQUksV0FBYSxDQUFDLEVBQUksS0FBSyxRQUVyRCxHQUFJLGFBQWUsRUFBSyxDQUN0QixRQUFRLEtBQUssZ0NBQTJCLFlBQVkscUNBQWdDLGFBQWEsUUFBUSxDQUFDLENBQUMsdUNBQXVDLEVBQ2xKLFVBQVUsS0FBSyxVQUFXQSxPQUFPLGFBQWMsZ0JBQWlCLDRDQUE0QyxhQUFhLFFBQVEsQ0FBQyxDQUFDLFNBQVMsRUFDNUksS0FBSyxZQUFZLElBQUksT0FBUSxLQUFLLElBQUksRUFBSSxFQUFJLEdBQU0sRUFDcEQsTUFDRixDQUVBLE1BQU0sUUFBVSxZQUFZLFFBQzVCLE1BQU0sT0FBUyxZQUFZLE9BQzNCLE1BQU0sZUFBa0IsTUFBTSxPQUFlLGdCQUFrQixLQUFLLFlBQVksTUFBTSxFQUd0RixNQUFNLGFBQWUsS0FBSyxJQUFJLFdBQWEsT0FBTyxRQUFRLEVBQUksS0FBSyxRQUduRSxNQUFNLGlCQUFtQixLQUFLLElBQUksUUFBUyxNQUFNLEVBR2pELElBQUksZUFBaUIsRUFDckIsR0FBSSxRQUFRLGVBQWlCLEVBQUcsQ0FDOUIsTUFBTSxZQUFjLFFBQVEsbUJBQXFCLGlCQUNqRCxHQUFJLGlCQUFtQixZQUFhLENBRWxDLE1BQU0sR0FBRyxRQUFRLGdFQUFnRSxFQUFFLElBQUksaUJBQWtCLEtBQUssU0FBUyxDQUN6SCxLQUFPLENBQ0wsTUFBTSxVQUFZLFlBQWMsa0JBQW9CLFlBQ3BELE1BQU0sVUFBWSxLQUFLLElBQUksRUFBRyxLQUFLLElBQUksU0FBVSxHQUFJLENBQUMsRUFDdEQsZUFBaUIsS0FBSyxJQUFJLEVBQUcsRUFBSSxLQUFLLElBQUksVUFBWSxJQUFNLENBQUMsQ0FBQyxFQUM5RCxRQUFRLElBQUksNERBQWdELFlBQVksUUFBUSxDQUFDLENBQUMsV0FBVyxpQkFBaUIsUUFBUSxDQUFDLENBQUMsU0FBUyxTQUFTLEtBQUssUUFBUSxDQUFDLENBQUMsaUJBQWlCLGVBQWUsUUFBUSxDQUFDLENBQUMsR0FBRyxDQUN4TSxDQUNGLENBRUEsR0FBSSxRQUFRLGVBQWlCLEdBQUssZ0JBQWtCLEVBQUcsQ0FDckQsUUFBUSxLQUFLLGdGQUF5RSxZQUFZLGtCQUFrQixFQUNwSCxVQUFVLEtBQUssVUFBV0EsT0FBTyxhQUFjLGdCQUFpQiw0Q0FBNEMsRUFDNUcsTUFDRixDQUVBLE1BQU0sY0FBZ0Isa0JBQW9CLE1BQU0sUUFBVSxLQUFPLGVBQ2pFLE1BQU0sUUFBVSxlQUFpQixhQUFlLGdCQUNoRCxJQUFJLFNBQVcsS0FBSyxJQUFJLElBQU0sS0FBSyxJQUFJLFdBQVcsUUFBUSxRQUFRLENBQUMsQ0FBQyxFQUFHLEVBQUksQ0FBQyxFQUM1RSxNQUFNLFFBQVcsTUFBYyxZQUFjLElBQzdDLE1BQU0sT0FBVSxNQUFjLFdBQWEsSUFHM0MsU0FBVyxLQUFLLE1BQU0sU0FBVyxPQUFPLEVBQUksUUFHNUMsR0FBSSxTQUFXLE9BQVEsQ0FDckIsU0FBVyxNQUNiLENBRUEsU0FBVyxXQUFXLFNBQVMsUUFBUSxDQUFDLENBQUMsRUFFekMsUUFBUSxJQUFJLGdEQUFzQyxPQUFPLFFBQVEsT0FBTyxZQUFZLFlBQVksUUFBUSxlQUFlLGFBQWEsUUFBUSxDQUFDLENBQUMsRUFBRSxFQUdoSixNQUFNLFNBQVcsT0FBTyxLQUFLLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLENBQUMsR0FHdkQsR0FBSSxDQUNGLE1BQU0sR0FBSyxNQUFNLEdBQUcsUUFBUSxtREFBbUQsRUFBRSxJQUFJLEtBQUssU0FBUyxFQUNuRyxNQUFNLGFBQWUsR0FBSyxHQUFHLFFBQVUsRUFFdkMsTUFBTSxZQUFjLE1BQU0sR0FBRyxRQUFRO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxlQUtwQyxFQUVELE1BQVEsTUFBTSxZQUFZLElBQ3hCLGFBQWMsS0FBSyxVQUFXLEtBQUssaUJBQWlCLFNBQVMsRUFBRyxhQUNoRSxPQUFPLFNBQVUsV0FBWSxPQUFPLFNBQVUsT0FBTyxXQUFZLFNBQ2pFLElBQUksS0FBSyxFQUFFLFlBQVksRUFBRyxXQUFZLFdBQVksYUFBYyxRQUNsRSxHQUFHLGVBQ0wsT0FBUyxNQUFZLENBQ25CLFFBQVEsTUFBTSx5RUFBb0UsWUFBWSxJQUFLLE1BQU0sT0FBTyxFQUNoSCxNQUFNLEtBQ1IsQ0FFQSxNQUFNLGVBQWlCLGFBQU9FLE1BQWMsU0FBbUIsQ0FDN0QsTUFBTSxHQUFHLFFBQVEsNERBQTRELEVBQUUsSUFBSUEsS0FBSSxFQUN2RixNQUFNLEdBQUssTUFBTSxHQUFHLFFBQVEsbURBQW1ELEVBQUUsSUFBSSxLQUFLLFNBQVMsRUFDbkcsR0FBSSxHQUFJLENBQ04sTUFBTSxHQUFHLFFBQVE7QUFBQTtBQUFBO0FBQUE7QUFBQSxpQkFJaEIsRUFBRSxJQUNELEdBQUcsUUFBUyxLQUFLLFVBQVcsS0FBSyxpQkFBaUIsU0FBUyxFQUFHLGFBQWMsT0FBTyxTQUNuRixFQUFHLEVBQUcsU0FBVSxFQUFHLEVBQUcsU0FBVSxLQUFLLElBQUksRUFBRyxLQUFLLElBQUksQ0FDdkQsQ0FDRixDQUNGLEVBYnVCLGtCQWdCdkIsSUFBSSxZQUNKLEdBQUksQ0FDRixNQUFNLE9BQVUsTUFBYyxRQUFVLEVBQ3hDLE1BQU0sUUFBVSxPQUFPLFNBQVcsV0FBVyxPQUFPLFNBQVMsUUFBUSxNQUFNLENBQUMsRUFBSSxPQUNoRixNQUFNLFFBQVUsT0FBTyxXQUFhLFdBQVcsT0FBTyxXQUFXLFFBQVEsTUFBTSxDQUFDLEVBQUksT0FFcEYsR0FBSSxPQUFPLFdBQWEsTUFBTyxDQUM3QixZQUFjLE1BQU0sc0JBQXNCLElBQU0sS0FBSyxxQkFBcUIsYUFBYyxTQUFVLFFBQVMsUUFBUyxDQUFFLFFBQVMsQ0FBQyxFQUFHLGFBQWEsTUFBTSxFQUFFLENBQzFKLFNBQVcsT0FBTyxXQUFhLE9BQVEsQ0FDckMsWUFBYyxNQUFNLHNCQUFzQixJQUFNLEtBQUssc0JBQXNCLGFBQWMsU0FBVSxRQUFTLFFBQVMsQ0FBRSxRQUFTLENBQUMsRUFBRyxjQUFjLE1BQU0sRUFBRSxDQUM1SixDQUNGLE9BQVMsSUFBVSxDQUNqQixHQUFJLElBQUksUUFBUSxTQUFTLGVBQWUsRUFBRyxDQUN6QyxRQUFRLEtBQUssc0RBQXNELFlBQVksNENBQTRDLEVBQzNILE1BQU1MLFNBQVUsTUFBTSxPQUFPLEtBQUssU0FBUyxLQUFLLEVBQUksR0FBTyxNQUFNLE9BQU8sS0FBSyxTQUFTLEtBQUssRUFBSSxFQUFPLE1BQU0sT0FBTyxLQUFLLFNBQVMsS0FBSyxFQUFJLElBQVEsTUFBTSxPQUFPLFdBQWEsS0FBUyxLQUFTLE1BQU0sT0FBTyxTQUFXLEdBQ3ROLE1BQU0sV0FBYSxHQUFLQSxTQUN4QixNQUFNLE9BQVUsTUFBYyxRQUFVLEVBQ3hDLE1BQU0sUUFBVSxPQUFPLFdBQWEsV0FBVyxPQUFPLFdBQVcsUUFBUSxNQUFNLENBQUMsRUFBSSxPQUVwRixHQUFJLE9BQU8sV0FBYSxNQUFPLENBQzdCLE9BQU8sU0FBVyxhQUFhLE9BQU8sVUFBWSxHQUFLLFlBQVksUUFBUSxNQUFNLENBQUMsRUFDbEYsWUFBYyxNQUFNLHNCQUFzQixJQUFNLEtBQUsscUJBQXFCLGFBQWMsU0FBVSxPQUFPLFNBQVUsUUFBUyxDQUFFLFFBQVMsQ0FBQyxFQUFHLGFBQWEsTUFBTSxFQUFFLENBQ2xLLEtBQU8sQ0FDTCxPQUFPLFNBQVcsYUFBYSxPQUFPLFVBQVksR0FBSyxZQUFZLFFBQVEsTUFBTSxDQUFDLEVBQ2xGLFlBQWMsTUFBTSxzQkFBc0IsSUFBTSxLQUFLLHNCQUFzQixhQUFjLFNBQVUsT0FBTyxTQUFVLFFBQVMsQ0FBRSxRQUFTLENBQUMsRUFBRyxjQUFjLE1BQU0sRUFBRSxDQUNwSyxDQUNGLFNBQVcsa0JBQWtCLEdBQUcsRUFBRyxDQUNqQyxNQUFNLEdBQ1IsS0FBTyxDQUNMLE1BQU0sZUFBZSxLQUFNLElBQUksT0FBTyxFQUN0QyxNQUFNLEdBQ1IsQ0FDRixDQUVBLEdBQUksQ0FBQyxhQUFhLFFBQVMsQ0FDekIsTUFBTSxlQUFlLEtBQU0sWUFBWSxFQUN2QyxNQUFNLElBQUksTUFBTSxrQ0FBa0MsQ0FDcEQsQ0FJQSxJQUFJLFdBQWEsU0FDakIsR0FBSSxDQUNGLE1BQU0sTUFBUSxZQUFZLFlBQWMsWUFBWSxRQUNwRCxHQUFJLE1BQU8sQ0FDVCxNQUFNLFVBQVksTUFBTSxLQUFLLFlBQVksS0FBSyxFQUM5QyxHQUFJLFdBQWEsT0FBTyxVQUFVLFNBQVcsU0FBVSxDQUNyRCxXQUFhLFVBQVUsT0FDdkIsUUFBUSxJQUFJLHVFQUF1RSxVQUFVLFFBQVEsQ0FDdkcsQ0FDRixDQUNGLE9BQVMsT0FBYSxDQUNwQixRQUFRLEtBQUssa0RBQWtELFlBQVksWUFBYyxZQUFZLE9BQU8seURBQTBELE9BQU8sT0FBTyxDQUN0TCxDQUdBLE1BQU0sR0FBRyxRQUFRLHVGQUF1RixFQUFFLElBQUksWUFBWSxRQUFTLFdBQVksSUFBSSxFQUVuSixNQUFNLFlBQWMsQ0FDbEIsS0FDQSxZQUFhLFlBQVksUUFDekIsTUFBTyxLQUFLLGlCQUFpQixTQUFTLEVBQ3RDLFVBQVcsT0FBTyxTQUNsQixXQUFZLFdBQ1osUUFBUyxPQUFPLFNBQ2hCLFdBQVksT0FBTyxTQUNuQixRQUFTLE9BQU8sV0FDaEIsU0FBVSxhQUNWLGFBQWMsV0FDZCxZQUFhLFdBQ2IsV0FBWSxNQUNaLE9BQVEsV0FDUixnQkFBaUIsTUFDakIsb0JBQXFCLEtBQ3JCLHFCQUFzQixLQUN0QixjQUFlLEtBQ2YsYUFBYyxLQUNkLGdCQUFpQixPQUFPLFNBQ3hCLHNCQUF1QixPQUFPLFNBQzlCLGdCQUFpQixPQUFPLFNBQ3hCLHNCQUF1QixPQUFPLFNBQzlCLFNBQVUsS0FBSyxJQUFJLENBQ3JCLEVBRUEsZ0JBQWdCLFNBQVMsS0FBSyxVQUFXLFlBQVksUUFBUyxhQUFjLE9BQU8sU0FBNEIsTUFBTSxFQUNySCxRQUFRLElBQUksc0NBQWlDLFlBQVksT0FBTyw0QkFBNEIsWUFBWSxHQUFHLENBQzdHLE9BQVMsUUFBYyxDQUNyQixHQUFJLGtCQUFrQixPQUFPLEVBQUcsQ0FDOUIsUUFBUSxLQUFLLHFFQUFxRSxZQUFZLEtBQUssUUFBUSxPQUFPLHlCQUF5QixJQUFJLDJCQUEyQixFQUMxSyxNQUFNLEdBQUcsUUFBUSwwRUFBMEUsRUFBRSxJQUFJLElBQUksRUFDckcsVUFBVSxLQUFLLFVBQVdHLE9BQU8sYUFBYyxvQkFBcUIscUJBQXFCLFFBQVEsT0FBTyxnQ0FBZ0MsQ0FDMUksS0FBTyxDQUNMLFFBQVEsTUFBTSxxREFBZ0QsWUFBWSxJQUFLLFFBQVEsT0FBTyxDQUNoRyxDQUNGLENBQ0YsQ0FDRixDQUVGLE9BQVMsRUFBUSxDQUNmLFFBQVEsTUFBTSw4Q0FBMEMsRUFBRSxPQUFPLENBQ25FLFFBQUUsQ0FDQSxNQUFNLGFBQWUsTUFDckIsZ0JBQWdCLG9CQUFvQixLQUFLLFVBQVcsTUFBTSxDQUM1RCxDQUNGLENBQ0YiLCJuYW1lcyI6WyJkYiIsImdldFNoYXJlZEFjY291bnQiLCJwaXBTaXplIiwicHJldkRheSIsImVzdEgiLCJib3RJZCIsInRpY2tTaXplIiwiZGJJZCJdLCJpZ25vcmVMaXN0IjpbXSwic291cmNlcyI6WyJFOlxcQW50aWdyYXYgcHJvamVjdHNcXFNuaXBlci1UcmFkaW5nLUFuYWx5c3QtLS1ieS1UYXppbS1TaGVpa2hcXHNlcnZlclxcZGlzY3JldGlvbmFyeV90cmFkZXJcXGVuZ2luZVxcTGl2ZU9yY2hlc3RyYXRvci50cyJdLCJzb3VyY2VzQ29udGVudCI6W251bGxdfQ==
