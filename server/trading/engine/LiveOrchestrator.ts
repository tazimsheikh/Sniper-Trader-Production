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
import { VisionEvaluator } from "../ai/VisionEvaluator.js";
import {
  MAGE_PAIR_CONFIG,
  SAGE_PAIR_CONFIG,
  SEER_PAIR_CONFIG,

  PairConfigManager,
} from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";
import { globalTradeGate as globalTradeGateOrig } from "../../utils/GlobalTradeGate.js";
const globalTradeGate: any = new Proxy({}, {
  get(_target, prop) {
    const target = (global as any).__SIM_TRADE_GATE__ || globalTradeGateOrig;
    const val = (target as any)[prop];
    return typeof val === "function" ? val.bind(target) : val;
  }
});
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



export function updateOrchestratorIndicators(state: any, c: any) {
  if (!state.atrArr) state.atrArr = [];
  if (!state.emaArr) state.emaArr = [];

  const alpha = 2 / (20 + 1);
  let ema = null;
  if (state.m5Buffer.length === 1) {
    ema = c.close;
  } else if (state.emaArr.length > 0) {
    const prevEma = state.emaArr[state.emaArr.length - 1];
    if (prevEma !== null && prevEma !== undefined) {
      ema = (c.close - prevEma) * alpha + prevEma;
    } else {
      ema = c.close;
    }
  }
  state.emaArr.push(ema);

  if (state.m5Buffer.length <= 14) {
    state.atrArr.push(0);
  } else if (state.m5Buffer.length === 15) {
    let sum = 0;
    for (let i = 1; i <= 14; i++) {
      const currC = state.m5Buffer[i];
      const prevC = state.m5Buffer[i - 1];
      sum += Math.max(
        currC.high - currC.low,
        Math.abs(currC.high - prevC.close),
        Math.abs(currC.low - prevC.close)
      );
    }
    state.atrArr.push(sum / 14);
  } else {
    const prevAtr = state.atrArr[state.atrArr.length - 1];
    const prevC = state.m5Buffer[state.m5Buffer.length - 2];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevC.close),
      Math.abs(c.low - prevC.close)
    );
    state.atrArr.push((prevAtr * 13 + tr) / 14);
  }

  if (state.m5Buffer.length > 50e3) {
    state.m5Buffer.shift();
    if (state.emaArr.length > 0) state.emaArr.shift();
    if (state.atrArr.length > 0) state.atrArr.shift();
  }
}

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
  cachedBrokerMetrics: any = null;
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
  public cachedProfileTime: number = 0;

  async getProfileData() {
    if (this.cachedProfile && Date.now() - this.cachedProfileTime < 15000) {
      return this.cachedProfile;
    }
    return await this.refreshProfileCache();
  }

  async refreshProfileCache() {
    try {
      const row = await db
        .prepare(
          "SELECT t.risk_multiplier, COALESCE(t.metaapi_token, u.metaapi_token) as metaapi_token, t.metaapi_account_id, t.dwcb_enabled, t.dwcb_peak_balance, t.base_risk_balance, t.broker_symbol_map, t.institutional_enabled, t.institutional_daily_start_balance, t.institutional_daily_date, t.institutional_peak_balance, t.institutional_daily_cap, t.institutional_peak_to_draw, t.automation_active, t.ai_sniper_active FROM trading_profiles t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?",
        )
        .get(this.profileId);
      if (row) {
        this.cachedProfile = row;
        this.cachedProfileTime = Date.now();
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
            const mapCandles = (c: any): any => {
              const openMs = c.timestamp !== undefined ? c.timestamp : new Date(c.time).getTime();
              const estDate = getFixedEstDate(new Date(openMs));
              const yyyy = estDate.getUTCFullYear();
              const mm = String(estDate.getUTCMonth() + 1).padStart(2, "0");
              const dd = String(estDate.getUTCDate()).padStart(2, "0");
              return {
                timestamp: openMs,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                tickVolume: c.tickVolume || 1,
                dateStr: `${yyyy}-${mm}-${dd}`,
                estHour: estDate.getUTCHours(),
                estMinute: estDate.getUTCMinutes(),
              };
            };
            const mapped = rawM5
              .map(mapCandles)
              .sort((a: any, b: any) => a.timestamp - b.timestamp);

            const matchingPairs = Array.from(this.states.keys()).filter((k) => PairConfigManager.getBaseSymbol(k) === symbol || k === symbol);
            for (const sp of matchingPairs) {
              const state = this.states.get(sp);
              if (state) {
                state.m5Buffer = mapped.map((c: any) => ({ ...c }));
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
                magic: pos.magic,
                botId: detectedBotId,
                direction,
                entryPrice: pos.openPrice,
                intendedEntryPrice: pos.intendedEntryPrice || pos.openPrice,
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
          const mapCandles = (c: any) => {
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
          };
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
            state.atrArr = [];
            state.m5Buffer = [];
            state.dailyTracker = new DailyContextTracker();

            for (let i = 0; i < mapped.length; i++) {
              const c = mapped[i];
              state.dailyTracker.processCandle(c);
              state.m5Buffer.push(c);
              state.lastEstHour = c.estHour ?? -1;
              updateOrchestratorIndicators(state, c);

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
      const mapCandles = (c: any) => {
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
      };
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
        updateOrchestratorIndicators(state, c);
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
            
            // Cleanly settle Sage & Mage state slots so stale limit orders do not leak into future ticks
            if (trade.clientId) {
              if (state.sageStates && state.sageStates[trade.clientId]) {
                state.sageStates[trade.clientId].limitOrderId = null;
                state.sageStates[trade.clientId].fired = false;
                state.sageStates[trade.clientId].fired_fill_check = false;
              }
              if (state.orbStates && state.orbStates[trade.clientId]) {
                state.orbStates[trade.clientId].limitOrderId = null;
              }
            }

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
            // NOTE: We intentionally do NOT sync slPrice/tpPrice here when Virtual SL mode
            // is active — the internal trailing SL must be preserved for hit detection.
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
      (((this as any).__CUSTOM_SAGE_CONFIGS__?.length > 0) || PairConfigManager.getSageConfigs(sessionPair)?.length > 0)
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
      (((this as any).__CUSTOM_MAGE_CONFIGS__?.length > 0) || PairConfigManager.getMageConfigs(sessionPair)?.length > 0)
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
    updateOrchestratorIndicators(state, c);
    
    // Minimum 1 candle needed (not 14) — the old guard of 14 blocked MageEngine for
    // 70 minutes on forex pairs whose warmup failed due to missing broker symbol mapping.
    // 1 candle is sufficient: EMA warm-up happens naturally over time.
    if (state.m5Buffer.length < 1) return;
    if (
      this.activeBots.has("mage") &&
      (((this as any).__CUSTOM_MAGE_CONFIGS__?.length > 0) || PairConfigManager.getMageConfigs(state.config.pair)?.length > 0) &&
      PairConfigManager.isOrbEnabled(state.config.pair)
    ) {
      await runMageBot(this, state.config.pair, state, c).catch((e) =>
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
        await evaluateSeerTrailingOnTick(this, state.config.pair, state).catch((e) =>
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
    if (!this.activeBots.has(botId)) return;
    await runPreFlightFilter(this, symbol, state, prevDay, setupType).catch((e) =>
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


