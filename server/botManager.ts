// ────────────────────────────────────────────────────────────────────────────
// BOT MANAGER — Orchestrates all trading bots per user.
//
// Architecture:
//  - Each user stores a JSON blob `active_bots` in the DB (e.g. '["old-is-gold","sniper"]')
//  - On every polling cycle (~30s), BotManager.tick() is called.
//  - For each active user, for each active bot:
//      1. Build BotContext from live market data
//      2. Call bot.generateSignal(context) — returns a signal if conditions are met
//      3. If signal → place trade via MetaAPI and save BotTradeState to DB
//      4. For any existing open trade → call bot.manageTrade() → apply TradeAction
// ────────────────────────────────────────────────────────────────────────────

import db from './db.js';
import { evaluateSignalWithAI } from './aiFilter.js';
import { getSimulationPrice } from './simulationProvider.js';
import { decrypt, isEncrypted } from './crypto.js';
import { broadcastTradeClosed, broadcastTradeOpened } from './socket.js';
import { TradingBot, BotConfig, BotContext, BotTradeState } from './bots/BotInterface.js';
import { MarketData } from '../src/types.js';
import { getSharedConnection, clearSharedConnection, isMetaApiConnecting, setMetaApiConnectedCallback, executeTradeForProfile, getSymbolSpec } from './metaApiHandler.js';
import { isNewsBlackout } from './newsStore.js';
import { PAIR_BOTS } from './bots/pairConfigs.js';
import * as socketIoClient from 'socket.io-client';
const io = (socketIoClient as any).io || (socketIoClient as any).default || socketIoClient;
type Socket = any;
import { getProviderForProfile } from './candleProvider.js';

// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
// @ts-ignore
const MetaApi = MetaApiPkg.default ?? MetaApiPkg;

// ── Bot Registry ─────────────────────────────────────────────────────────────
// Add new bots here and they automatically appear in the UI and engine.
export const BOT_REGISTRY: Record<string, TradingBot> = {
  ...PAIR_BOTS
};

const profileBotInstances = new Map<string, TradingBot>();

function getProfileBot(profileId: number, botId: string): TradingBot | undefined {
  const key = `${profileId}-${botId}`;
  if (!profileBotInstances.has(key)) {
    if (BOT_REGISTRY[botId]) {
      const baseBot = BOT_REGISTRY[botId];
      profileBotInstances.set(key, (baseBot as any).clone ? (baseBot as any).clone() : baseBot);
    }
  }
  return profileBotInstances.get(key);
}

export function deleteProfileBotInstances(profileId: number) {
  for (const key of profileBotInstances.keys()) {
    if (key.startsWith(`${profileId}-`)) {
      profileBotInstances.delete(key);
    }
  }
}

export const ALL_BOT_CONFIGS: BotConfig[] = Object.values(BOT_REGISTRY).map(b => b.config);

// ── MetaAPI Health Status ─────────────────────────────────────────────────────
export const metaApiExecutionHealth = new Map<number, 'offline' | 'connected'>();
export const metaApiLastConnected = new Map<number, number>();

export const safetyStatusMap = new Map<number, any>();

// Global callback isn't enough to track per-profile, so we will update status during connection
setMetaApiConnectedCallback(() => {
  // Can't set profile health here easily without context
});

// ── MetaAPI Trade Lockout Failsafe ────────────────────────────────────────────
// If MetaAPI has not successfully executed a trade/connection in 5+ minutes,
// ALL new trade entry is blocked. Existing open trades are still managed (exits).
// The lockout resets automatically as soon as MetaAPI reconnects successfully.
const METAAPI_OFFLINE_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
export let metaApiOfflineSince: number = Date.now(); // Start locked until first successful connection

export function isMetaApiTradeBlocked(profileId: number): boolean {
  if (process.env.SIMULATION_MODE === 'true') return false;
  if (metaApiExecutionHealth.get(profileId) === 'connected') return false;
  const lastConnected = metaApiLastConnected.get(profileId) || 0;
  const offlineMins = (Date.now() - lastConnected) / 60000;
  return offlineMins > 2; // Block trades if offline for > 2 mins
}

export { isMetaApiConnecting };

// ── Fired-Today Tracking (prevents double-fire in widened 2-min windows) ─────
const firedToday = new Map<string, string>(); // key: `${profileId}-${botId}-${symbol}`, value: date string
let lastFiredResetDate = '';

// ── In-Memory Symbol Lock ───────────────────────────────────────────────────────
// Prevents overlapping trades if multiple botManagerTick loops run concurrently.
const activeTradeLocks = new Set<string>(); // key: `${profileId}-${brokerSymbol}`

// ── Fail-Safe Cooldown Tracker ──────────────────────────────────────────────────
// Tracks the exact expiry time of a successful execution to prevent double-firing
// within the same or next candle (10 minutes total).
// key: `${profileId}-${botId}-${symbol}`, value: expiry timestamp ms
const executionCooldowns = new Map<string, number>();

function isCooldownActive(profileId: number, botId: string, symbol: string, nowMs: number): boolean {
  const key = `${profileId}-${botId}-${symbol}`;
  const expiry = executionCooldowns.get(key);
  if (!expiry) return false;
  if (nowMs < expiry) return true;
  executionCooldowns.delete(key); // Cleanup expired
  return false;
}

function setExecutionCooldown(profileId: number, botId: string, symbol: string) {
  const key = `${profileId}-${botId}-${symbol}`;
  // 10 minutes from now (covers remainder of this candle + the entire next candle)
  executionCooldowns.set(key, Date.now() + 10 * 60 * 1000);
}

// Garbage Collector for memory leaks
setInterval(() => {
  const nowMs = Date.now();
  for (const [key, expiry] of executionCooldowns.entries()) {
    if (nowMs > expiry) executionCooldowns.delete(key);
  }
  // Clear unassigned bot instances if needed (profileBotInstances is small enough to persist, but we can clear if we wanted)
}, 60 * 60 * 1000);

function resetFiredTodayIfNeeded() {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastFiredResetDate) {
    firedToday.clear();
    lastFiredResetDate = today;
  }
}

function hasFiredToday(profileId: number, botId: string, symbol: string): boolean {
  return firedToday.has(`${profileId}-${botId}-${symbol}`);
}

function markFiredToday(profileId: number, botId: string, symbol: string) {
  firedToday.set(`${profileId}-${botId}-${symbol}`, new Date().toISOString());
}

// ── EMA State Persistence moved to db.ts ────────────────────────────────────────

// ── Symbol Specs ──────────────────────────────────────────────────────────────
// Now using getSymbolSpec from metaApiHandler.ts to ensure 100% consistency 
// between live execution logic and diary profit/loss calculation.

export async function getConnection(rawToken: string, accountId: string, profileId?: number): Promise<any> {
  if (process.env.SIMULATION_MODE === 'true') {
    return {
      getSymbolPrice: async (symbol: string) => {
        const price = getSimulationPrice(symbol) || 1.0;
        return { bid: price - 0.0001, ask: price + 0.0001 };
      },
      createMarketBuyOrder: async () => ({ orderId: 'sim_' + Date.now() }),
      createMarketSellOrder: async () => ({ orderId: 'sim_' + Date.now() }),
      modifyPosition: async () => ({}),
      closePosition: async () => ({}),
      calculateMargin: async () => ({ margin: 10 })
    };
  }
  try {
    const conn = await getSharedConnection(rawToken, accountId, true);
    if (profileId) {
      metaApiExecutionHealth.set(profileId, 'connected');
      metaApiLastConnected.set(profileId, Date.now());
    }
    return conn;
  } catch (err: any) {
    if (err.message.includes('Fast fail')) {
      // Background sync is in progress
    } else {
      if (profileId) metaApiExecutionHealth.set(profileId, 'offline');
    }
    throw err;
  }
}

// ── DB Migration ──────────────────────────────────────────────────────────────
// Adds active_bots column and bot_trade_states table if they don't exist.
export async function initBotManagerSchema() {
  await db.exec(`
    -- Per-user active bot IDs stored as JSON array string
    ALTER TABLE users ADD COLUMN active_bots TEXT DEFAULT '[]';
  `);
  // SQLite will throw if column already exists — that's fine, we swallow it.
  // Use a try/catch in the caller.
}

export async function ensureBotSchema() {
  try { await initBotManagerSchema(); } catch (_) { /* already migrated */ }

  try { await db.exec('ALTER TABLE bot_trade_states ADD COLUMN profile_id INTEGER'); } catch (_) {}
  try { await db.exec('ALTER TABLE trade_diary ADD COLUMN profile_id INTEGER'); } catch (_) {}
  try { await db.exec('ALTER TABLE trading_profiles ADD COLUMN bot_risks TEXT DEFAULT \'{}\''); } catch (_) {}
  try { await db.exec('ALTER TABLE bot_trade_states ALTER COLUMN open_time TYPE BIGINT'); } catch (_) {}
  try { await db.exec('ALTER TABLE trade_diary ALTER COLUMN open_time TYPE BIGINT'); } catch (_) {}
  try { await db.exec('ALTER TABLE trade_diary ALTER COLUMN close_time TYPE BIGINT'); } catch (_) {}

  // Auto-migrate users to have at least a Default Profile
  const usersToMigrate = await db.prepare(`
    SELECT * FROM users 
    WHERE id NOT IN (SELECT DISTINCT user_id FROM trading_profiles)
  `).all() as any[];

  for (const user of usersToMigrate) {
    const result = await db.prepare(`
      INSERT INTO trading_profiles (
        user_id, profile_name, metaapi_account_id, 
        risk_multiplier, automation_active, ai_sniper_active, 
        active_bots, diary_reset_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id, 'Default Profile', user.metaapi_account_id,
      user.risk_multiplier, user.automation_active, user.ai_sniper_active,
      user.active_bots || '[]', user.diary_reset_time
    );

    const defaultProfileId = result.lastInsertRowid;

    // Migrate existing trades to default profile
    await db.prepare('UPDATE bot_trade_states SET profile_id = ? WHERE user_id = ? AND profile_id IS NULL').run(defaultProfileId, user.id);
    await db.prepare('UPDATE trade_diary SET profile_id = ? WHERE user_id = ? AND profile_id IS NULL').run(defaultProfileId, user.id);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getActiveBots(profile: any): string[] {
  try {
    const bots = JSON.parse(profile.active_bots || '[]');
    return Array.isArray(bots) ? bots : [];
  } catch { return []; }
}

// 🛡️ BUG FIX #1: Check for ANY open trade on this symbol for this profile,
// regardless of which bot opened it. This prevents two bots on the same symbol
// (e.g., gbpusd-london-fade AND gbpusd-ny-fade) from opening opposing positions.
async function getOpenTradesForBot(profileId: number, botId: string, brokerSymbol: string): Promise<BotTradeState[]> {
  // First: look for trades owned by THIS bot (for manageTrade purposes)
  const rows = await db.prepare(
    `SELECT * FROM bot_trade_states WHERE profile_id = ? AND bot_id = ? AND broker_symbol = ? AND status = 'OPEN'`
  ).all(profileId, botId, brokerSymbol) as any[];
  
  return rows.map(ownRow => ({
    botId: ownRow.bot_id,
    userId: ownRow.user_id,
    profileId: ownRow.profile_id,
    brokerSymbol: ownRow.broker_symbol,
    direction: ownRow.direction,
    entryPrice: ownRow.entry_price,
    slPrice: ownRow.sl_price,
    tpPrice: ownRow.tp_price,
    lots: ownRow.lots,
    openTime: ownRow.open_time,
    metaOrderId: ownRow.meta_order_id,
    t1Hit: ownRow.t1_hit === 1,
    highestPrice: ownRow.highest_price,
    lowestPrice: ownRow.lowest_price,
  }));
}

// 🛡️ BUG FIX #1 (signal block): Check if ANY bot already has an open trade on
// this symbol for this profile — used to block new signal entry.
async function hasAnyOpenTradeOnSymbol(profileId: number, brokerSymbol: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT id FROM bot_trade_states WHERE profile_id = ? AND broker_symbol = ? AND status = 'OPEN' LIMIT 1`
  ).get(profileId, brokerSymbol) as any;
  return !!row;
}

export async function saveTradeState(state: BotTradeState, orderId?: string) {
  await db.prepare(`
    INSERT INTO bot_trade_states
      (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, tp_price,
       lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
  `).run(
    state.userId, state.profileId, state.botId, state.brokerSymbol, state.direction,
    state.entryPrice, state.slPrice, state.tpPrice, state.lots,
    state.openTime, orderId || null, 0,
    state.highestPrice, state.lowestPrice
  );
}

export async function closeTrade(metaOrderId: string, reason: string) {
  await db.prepare(`UPDATE bot_trade_states SET status = ? WHERE meta_order_id = ?`).run(reason, metaOrderId);
  
  // Try to find the profileId to broadcast the close event correctly
  try {
    const trade = await db.prepare('SELECT * FROM bot_trade_states WHERE meta_order_id = ?').get(metaOrderId) as any;
    if (trade && trade.profile_id) {
      broadcastTradeClosed(trade.profile_id, trade);
    }
  } catch (e) {
    console.error('Failed to broadcast trade close:', e);
  }
}

export async function logToDiary(userId: number, profileId: number, botId: string, brokerSymbol: string, direction: string, entryPrice: number, exitPrice: number, lots: number, pips: number, profit: number, status: string, openTime: number) {
  await db.prepare(`
    INSERT INTO trade_diary
      (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, exit_price, lots, pips, profit, status, open_time, close_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, profileId, botId, brokerSymbol, direction, entryPrice, exitPrice, lots, pips, profit, status, openTime, Date.now());
}

async function updateTradeEntry(metaOrderId: string, newEntry: number) {
  await db.prepare(
    `UPDATE bot_trade_states SET entry_price = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(newEntry, metaOrderId);
}

async function updateTradeSl(metaOrderId: string, newSl: number) {
  await db.prepare(
    `UPDATE bot_trade_states SET sl_price = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(newSl, metaOrderId);
}

async function updateTradeTp(metaOrderId: string, newTp: number) {
  await db.prepare(
    `UPDATE bot_trade_states SET tp_price = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(newTp, metaOrderId);
}

async function markT1Hit(metaOrderId: string, newSl: number) {
  await db.prepare(
    `UPDATE bot_trade_states SET t1_hit = 1, sl_price = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(newSl, metaOrderId);
}

async function updateHighLow(metaOrderId: string, highest: number, lowest: number) {
  await db.prepare(
    `UPDATE bot_trade_states SET highest_price = ?, lowest_price = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(highest, lowest, metaOrderId);
}

// ── Main Tick Function ────────────────────────────────────────────────────────
// Called every 30 seconds from the server's polling loop.
export async function botManagerTick(
  profileId: number,
  marketDataProvider: () => Record<string, MarketData>
) {
  const now = new Date();
  resetFiredTodayIfNeeded();

  const isSim = process.env.SIMULATION_MODE === 'true';
  const query = isSim ? 
    `SELECT tp.id, tp.user_id, u.metaapi_token, tp.metaapi_account_id, u.metaapi_account_id as user_account_id, tp.risk_multiplier, tp.bot_risks, tp.active_bots, tp.peak_balance, tp.safety_settings, tp.ai_sniper_active
     FROM trading_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.id = ? 
       AND tp.automation_active = 1
       AND u.metaapi_token IS NOT NULL
       AND (tp.metaapi_account_id IS NOT NULL OR u.metaapi_account_id IS NOT NULL)` :
    `SELECT tp.id, tp.user_id, u.metaapi_token, tp.metaapi_account_id, u.metaapi_account_id as user_account_id, tp.risk_multiplier, tp.bot_risks, tp.active_bots, tp.peak_balance, tp.safety_settings, tp.ai_sniper_active
     FROM trading_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.id = ?
       AND tp.automation_active = 1
       AND u.metaapi_token IS NOT NULL
       AND (tp.metaapi_account_id IS NOT NULL OR u.metaapi_account_id IS NOT NULL)
       AND u.metaapi_token != 'dummy_token' AND (tp.metaapi_account_id != 'dummy_acc' OR u.metaapi_account_id != 'dummy_acc')`;

  const profile = await db.prepare(query).get(profileId) as any;
  if (!profile) return;

  const marketData = marketDataProvider();
  const activeBotIds = getActiveBots(profile);
  if (activeBotIds.length === 0) return;

  let botRisks: Record<string, number> = {};
  try {
    botRisks = JSON.parse(profile.bot_risks || '{}');
  } catch (e) {}

  let rawToken: string;
  const activeAccountId = profile.metaapi_account_id || profile.user_account_id;
  try {
    rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
    const decryptedAccountId = isEncrypted(activeAccountId) ? decrypt(activeAccountId) : activeAccountId;
    profile.metaapi_account_id = decryptedAccountId; // override so downstream uses active account
    if (rawToken === 'dummy_token' || decryptedAccountId === 'dummy_acc') {
      return; // Skip profiles silently if they haven't configured their account
    }
  } catch (e: any) {
    console.error(`[BotManager Profile ${profile.id}] Decryption error:`, e.message);
    return;
  }

  let safetySettings = {
    dailyLossLimit: 5,
    maxDrawdownLimit: 20,
    unprofitablePairLookback: 10,
    unprofitablePairMinTrades: 5,
    unprofitablePairMinWinRate: 40,
    unprofitablePairMinProfitPips: 0,
    volatilityFilterEnabled: true,
    volatilityFilterMinAdrPips: 15
  };
  try { if (profile.safety_settings) safetySettings = { ...safetySettings, ...JSON.parse(profile.safety_settings) }; } catch(e) {}

  let circuitBreakerActive = false;
  let circuitBreakerReason = '';
  let drawdownPct = 0;
  let dailyProfitPct = 0;

  const safetyStatus: any = {
    circuitBreakerActive: false,
    circuitBreakerReason: '',
    drawdownPct: 0,
    dailyProfitPct: 0,
    blockedPairs: {}
  };

  // Proactively check/maintain connection for active profile to prevent false lockouts
  try {
    const conn = await getConnection(rawToken, profile.metaapi_account_id, profile.id);
    
    if (conn.getAccountInformation) {
      const accountInfo = await conn.getAccountInformation();
      const balance = accountInfo.balance;
      const equity = accountInfo.equity;
      
      if (balance > profile.peak_balance) {
        await db.prepare('UPDATE trading_profiles SET peak_balance = ? WHERE id = ?').run(balance, profile.id);
        profile.peak_balance = balance;
      }

      const peakBalance = profile.peak_balance > 0 ? profile.peak_balance : balance;
      if (peakBalance > 0) {
        drawdownPct = ((peakBalance - equity) / peakBalance) * 100;
        safetyStatus.drawdownPct = drawdownPct;
        if (drawdownPct > safetySettings.maxDrawdownLimit) {
          circuitBreakerActive = true;
          circuitBreakerReason = `Max Drawdown Limit Exceeded (${drawdownPct.toFixed(2)}% > ${safetySettings.maxDrawdownLimit}%)`;
        }
      }

      const todayStart = new Date();
      todayStart.setUTCHours(0,0,0,0);
      const todayClosedTrades = await db.prepare('SELECT SUM(profit) as total_profit FROM trade_diary WHERE profile_id = ? AND close_time >= ?').get(profile.id, todayStart.getTime()) as any;
      const dailyProfit = todayClosedTrades?.total_profit || 0;
      
      if (balance > 0) {
        dailyProfitPct = (dailyProfit / balance) * 100;
        safetyStatus.dailyProfitPct = dailyProfitPct;
        if (dailyProfit < 0 && Math.abs(dailyProfitPct) > safetySettings.dailyLossLimit) {
          circuitBreakerActive = true;
          circuitBreakerReason = `Daily Loss Limit Exceeded (${Math.abs(dailyProfitPct).toFixed(2)}% > ${safetySettings.dailyLossLimit}%)`;
        }
      }
    }
  } catch (e: any) {
    if (!e.message.includes('Fast fail')) {
      console.warn(`[BotManager Profile ${profile.id}] Connection check failed:`, e.message);
    }
  }

  safetyStatus.circuitBreakerActive = circuitBreakerActive;
  safetyStatus.circuitBreakerReason = circuitBreakerReason;

  const sniperBot = getProfileBot(profile.id, 'sniper-system-ai');
  if (!sniperBot) return;

  // Treat active flip switches as authorized pairs for the master bot
  const authorizedSymbols = new Set<string>();
  for (const botId of activeBotIds) {
    const b = getProfileBot(profile.id, botId);
    if (b && b.config.id !== 'sniper-system-ai') {
      for (const sym of b.config.symbols) authorizedSymbols.add(sym);
    }
  }
  
  // Explicitly add symbols if they turned on Sniper AI directly
  if (activeBotIds.includes('sniper-system-ai')) {
      for (const sym of sniperBot.config.symbols) authorizedSymbols.add(sym);
  }

  // Process each authorized symbol using the active bots
  for (const brokerSymbol of Array.from(authorizedSymbols)) {
    try {
      // Find the matching yahoo key for this broker symbol
      const yahooKey = Object.entries({ 'GC=F': 'XAUUSD', 'NQ=F': 'USTEC', 'EURUSD=X': 'EURUSD', 'GBPUSD=X': 'GBPUSD', 'USDJPY=X': 'USDJPY', 'AUDUSD=X': 'AUDUSD', 'USDCAD=X': 'USDCAD', 'NZDUSD=X': 'NZDUSD', 'USDCHF=X': 'USDCHF', 'AUDJPY=X': 'AUDJPY', 'CHFJPY=X': 'CHFJPY', 'EURAUD=X': 'EURAUD', 'EURCAD=X': 'EURCAD', 'EURCHF=X': 'EURCHF', 'EURJPY=X': 'EURJPY', 'GBPAUD=X': 'GBPAUD', 'GBPCAD=X': 'GBPCAD', 'GBPCHF=X': 'GBPCHF', 'GBPJPY=X': 'GBPJPY' })
        .find(([_, v]) => v === brokerSymbol)?.[0];
      const market = yahooKey ? marketData[yahooKey] : null;
      if (!market || !yahooKey) continue;

      const spread = 0;

      const provider = await getProviderForProfile(profile.id);
      const m5Candles = await provider.get5MinuteCandles(yahooKey, brokerSymbol, 200);

      const context: BotContext = {
        currentPrice: market.currentPrice,
        bid: market.currentPrice,
        ask: market.currentPrice,
        spread,
        brokerSymbol,
        now,
        recentDailyCandles: market.recentDailyCandles || [],
        m5Candles: m5Candles,
        last15MSwingHigh: market.last15MSwingHigh,
        last15MSwingLow: market.last15MSwingLow,
      };

      // ── VOLATILITY / REGIME FILTER ──
      let volatilityBlocked = false;
      let volatilityBlockReason = '';
      if (safetySettings.volatilityFilterEnabled) {
         const candles = context.recentDailyCandles;
         if (candles.length >= 10) {
             let totalRange = 0;
             const last10 = candles.slice(-10);
             for (const c of last10) {
                 totalRange += (c.high - c.low);
             }
             const avgRange = totalRange / 10;
             const spec = getSymbolSpec(brokerSymbol);
             const adrPips = avgRange / spec.pipSize;
             
             if (adrPips < safetySettings.volatilityFilterMinAdrPips) {
                 volatilityBlocked = true;
                 volatilityBlockReason = `ADR ${adrPips.toFixed(1)} pips < ${safetySettings.volatilityFilterMinAdrPips} limit`;
                 safetyStatus.blockedPairs[brokerSymbol] = volatilityBlockReason;
             }
         }
      }

      // ── PAIR PERFORMANCE FILTER ──
      let performanceBlocked = false;
      let performanceBlockReason = '';
      if (!volatilityBlocked) {
        const recentTrades = await db.prepare('SELECT pips, status FROM trade_diary WHERE profile_id = ? AND broker_symbol = ? ORDER BY close_time DESC LIMIT ?').all(profile.id, brokerSymbol, safetySettings.unprofitablePairLookback) as any[];
        if (recentTrades.length >= safetySettings.unprofitablePairMinTrades) {
           let wins = 0;
           let totalPips = 0;
           for (const t of recentTrades) {
               if (t.status === 'WON') wins++;
               totalPips += t.pips;
           }
           const winRate = (wins / recentTrades.length) * 100;
           if (winRate < safetySettings.unprofitablePairMinWinRate) {
               performanceBlocked = true;
               performanceBlockReason = `Win Rate ${winRate.toFixed(1)}% < ${safetySettings.unprofitablePairMinWinRate}% limit`;
               safetyStatus.blockedPairs[brokerSymbol] = performanceBlockReason;
           } else if (totalPips < safetySettings.unprofitablePairMinProfitPips) {
               performanceBlocked = true;
               performanceBlockReason = `Net Profit ${totalPips.toFixed(1)} pips < ${safetySettings.unprofitablePairMinProfitPips} limit`;
               safetyStatus.blockedPairs[brokerSymbol] = performanceBlockReason;
           }
        }
      }



      // ── MANAGE EXISTING OPEN TRADES ────────────────────────────────────────
      const openTrades = []; // We need to fetch for all bots
      for (const botId of activeBotIds) {
        const botTrades = await getOpenTradesForBot(profile.id, botId, brokerSymbol);
        openTrades.push(...botTrades);
      }
      
      for (const openTrade of openTrades) {
        if (!openTrade.metaOrderId) continue;

        // Update highest/lowest
        const newHighest = Math.max(openTrade.highestPrice, context.currentPrice);
        const newLowest  = Math.min(openTrade.lowestPrice,  context.currentPrice);
        await updateHighLow(openTrade.metaOrderId, newHighest, newLowest);
        openTrade.highestPrice = newHighest;
        openTrade.lowestPrice  = newLowest;

        // We use dummy 'sniperBot' to manage trades globally, or we can fetch the original bot
        const originalBot = getProfileBot(profile.id, openTrade.botId);
        let action: any = { action: 'HOLD' };
        if (originalBot) {
           action = await originalBot.manageTrade(openTrade, context);
        }

        // 🛡️ UNIVERSAL EOD CLOSURE OVERRIDE 🛡️
        if (context.now.getUTCHours() === 23 && context.now.getUTCMinutes() >= 55) {
          action = { action: 'CLOSE', reason: 'EOD_CLOSE' };
        }

        if (action.action === 'CLOSE') {
          try {
            if (process.env.SIMULATION_MODE !== 'true') {
              const conn = await getConnection(rawToken, profile.metaapi_account_id, profile.id);
              if (openTrade.metaOrderId) {
                try {
                  await conn.closePosition(openTrade.metaOrderId, {});
                } catch (e: any) {
                  const msg = e.message || '';
                  if (msg.includes('not found') || msg.includes('ValidationException') || msg.includes('NotFound') || msg.includes('position not found')) {
                    console.log(`[BotManager] Position ${openTrade.metaOrderId} already closed on broker server.`);
                  } else {
                    throw e; // Rethrow other errors (e.g. network/connection issues)
                  }
                }
              }
            }
            await closeTrade(openTrade.metaOrderId, 'CLOSED');
            
            const spec = getSymbolSpec(brokerSymbol);
            const exitPrice = context.currentPrice;
            const pips = openTrade.direction === 'BUY' 
              ? (exitPrice - openTrade.entryPrice) / spec.pipSize 
              : (openTrade.entryPrice - exitPrice) / spec.pipSize;
            const profit = pips * spec.pipValuePerLot * openTrade.lots;
            const status = pips >= 0 ? 'WON' : 'LOST';
            
            await logToDiary(profile.user_id, profile.id, openTrade.botId, brokerSymbol, openTrade.direction, openTrade.entryPrice, exitPrice, openTrade.lots, pips, profit, status, openTrade.openTime);

            console.log(`[BotManager] [${openTrade.botId}] Profile ${profile.id} trade CLOSED: ${action.reason}`);
          } catch (e: any) {
            console.error(`[BotManager] Close failed for Profile ${profile.id}:`, e.message);
            clearSharedConnection(rawToken, profile.metaapi_account_id);
          }
        } else if (action.action === 'MODIFY_SL') {
          try {
            if (process.env.SIMULATION_MODE !== 'true') {
              const conn = await getConnection(rawToken, profile.metaapi_account_id, profile.id);
              if (openTrade.metaOrderId) {
                await conn.modifyPosition(openTrade.metaOrderId, action.newSlPrice, openTrade.tpPrice);
              }
            }
            await updateTradeSl(openTrade.metaOrderId, action.newSlPrice);
            console.log(`[BotManager] [${openTrade.botId}] Profile ${profile.id} SL moved to ${action.newSlPrice}`);
          } catch (e: any) {
            console.error(`[BotManager] ModifySL failed for Profile ${profile.id}:`, e.message);
            clearSharedConnection(rawToken, profile.metaapi_account_id);
          }
        } else if (action.action === 'PARTIAL_CLOSE') {
          try {
            if (process.env.SIMULATION_MODE !== 'true') {
              const conn = await getConnection(rawToken, profile.metaapi_account_id, profile.id);
              if (openTrade.metaOrderId) {
                const closeVolume = Math.round(openTrade.lots * (action.closePercent / 100) * 100) / 100;
                await conn.closePositionPartially(openTrade.metaOrderId, closeVolume, {});
                await conn.modifyPosition(openTrade.metaOrderId, action.newSlPrice, openTrade.tpPrice);
              }
            }
            await markT1Hit(openTrade.metaOrderId, action.newSlPrice);
            console.log(`[BotManager] [${openTrade.botId}] Profile ${profile.id} T1 hit — partial close, SL → BE`);
          } catch (e: any) {
            console.error(`[BotManager] PartialClose failed for Profile ${profile.id}:`, e.message);
            clearSharedConnection(rawToken, profile.metaapi_account_id);
          }
        }
      }

      const hasOpenTrades = openTrades.length > 0;
      if (hasOpenTrades) continue; // Don't look for new signals while trade is open

      // ── CHECK NEW SIGNALS ───────────────────────────────────────────────────
      if (!(await hasAnyOpenTradeOnSymbol(profile.id, brokerSymbol))) {
        const lockKey = `${profile.id}-${brokerSymbol}`;
        if (activeTradeLocks.has(lockKey)) {
          console.log(`[BotManager] Symbol ${brokerSymbol} is currently locked for execution for Profile ${profile.id}. Skipping new signals.`);
          continue;
        }

        if (isMetaApiTradeBlocked(profile.id)) {
          console.log(`[BotManager] MetaAPI Trade Blocked active. Skipping new signals for Profile ${profile.id}.`);
          continue;
        }

        if (circuitBreakerActive) {
          console.log(`[BotManager] Circuit Breaker Active for Profile ${profile.id}: ${circuitBreakerReason}. Skipping new signals.`);
          continue;
        }

        if (volatilityBlocked || performanceBlocked) {
          console.log(`[BotManager] Filter blocked ${brokerSymbol} for Profile ${profile.id}`);
          continue;
        }

        for (const botId of activeBotIds) {
          const activeBot = getProfileBot(profile.id, botId);
          if (!activeBot) continue;
          if (!activeBot.config.symbols.includes(brokerSymbol)) continue;

          // Prevent trading if strategy has proven NO EDGE
          if (activeBot.config.tagline === 'Disabled') continue;

          const signal = await activeBot.generateSignal(context);
          if (signal.shouldTrade && signal.direction && signal.suggestedSlPips && signal.suggestedTpPips) {
             console.log(`[BotManager] Valid Signal from ${botId} on ${brokerSymbol}: ${signal.direction}`);
             
             // Convert signal to trap format to reuse executeTradeForProfile
             const newAlert = {
                id: `${brokerSymbol}-${Date.now()}`,
                symbol: yahooKey,
                displayName: brokerSymbol,
                pattern: signal.reason || 'Coil Breakout',
                direction: signal.direction,
                triggerPrice: market.currentPrice,
                levelType: 'HOD',
                keyLevel: market.currentPrice,
                grade: 5,
                timingGate: 'Execution Window',
                timestamp: now.toISOString(),
                details: signal.reason || '',
                suggestedStopLoss: signal.suggestedSlPips,
                suggestedTakeProfit: signal.suggestedTpPips,
                isThreeDaySetup: false,
                isThreeSessionSetup: false,
                isHolyGrailConfluence: false,
                status: 'Trade Now'
             };

             if (isCooldownActive(profile.id, botId, brokerSymbol, now.getTime())) {
               console.log(`[BotManager] Cooldown active for ${botId} on ${brokerSymbol}, skipping signal to prevent double-fire...`);
               continue;
             }

             // Extract custom Conviction Multiplier from the signal if it exists (e.g. from FleetManager)
             let dynamicMultiplier = 1.0;
             if (signal.reason && signal.reason.includes('[RISKx')) {
                 const match = signal.reason.match(/\[RISKx([\d.]+)\]/);
                 if (match && match[1]) {
                     dynamicMultiplier = parseFloat(match[1]);
                 }
             }

             // FIX: Engage cooldown lock BEFORE async evaluation to prevent overlapping bots on this symbol
             // This also allows the AI Filter to run in parallel without blocking the main polling loop for other pairs!
             setExecutionCooldown(profile.id, botId, brokerSymbol);
             
             let specificRisk = botRisks[botId] || profile.risk_multiplier || activeBot.config.riskPct || 5;
             specificRisk = specificRisk * dynamicMultiplier;

             // Run AI evaluation and trade execution asynchronously
             activeTradeLocks.add(lockKey);
             (async () => {
                 try {
                     if (profile.ai_sniper_active === 1) {
                         console.log(`[BotManager] Sending signal to Claude AI Filter for evaluation in background...`);
                         const aiDecision = await evaluateSignalWithAI(newAlert as any, market);
                         if (!aiDecision.approve) {
                             console.log(`[BotManager] AI Filter REJECTED trade for ${botId} on ${brokerSymbol}`);
                             // Engage a small 1-minute cooldown so it doesn't immediately re-spam the AI on the next tick
                             executionCooldowns.set(`${profile.id}-${botId}-${brokerSymbol}`, Date.now() + 60 * 1000);
                             return; // Skip execution
                         } else {
                             console.log(`[BotManager] AI Filter APPROVED trade for ${botId} on ${brokerSymbol}`);
                         }
                     }

                     await executeTradeForProfile(
                         profile.id, 
                         newAlert as any, 
                         signal.suggestedSlPips, 
                         signal.suggestedTpPips, 
                         specificRisk
                     );
                     console.log(`[BotManager] Successfully executed trade for ${botId} on ${brokerSymbol} at ${specificRisk}% risk`);
                 } catch(e: any) {
                     // If execution explicitly fails, clear the cooldown so it can retry organically
                     executionCooldowns.delete(`${profile.id}-${botId}-${brokerSymbol}`);
                     console.error(`[BotManager] Error executing async trade (will organic-retry if still valid):`, e.message);
                 } finally {
                     activeTradeLocks.delete(lockKey);
                 }
             })();

             break; // Execute max 1 trade attempt per symbol per tick
          }
        }
      }
    } catch (symbolError: any) {
      console.error(`[BotManager] Isolated error processing symbol ${brokerSymbol} for Profile ${profile.id}:`, symbolError.message);
      // Skip this symbol and continue to the next one safely
    }
  }

  safetyStatusMap.set(profile.id, safetyStatus);
}

// ── Bot toggle API helpers ────────────────────────────────────────────────────
export async function getProfileActiveBots(profileId: number): Promise<string[]> {
  const row = await db.prepare('SELECT active_bots FROM trading_profiles WHERE id = ?').get(profileId) as any;
  return JSON.parse(row?.active_bots || '[]');
}

export async function setProfileActiveBots(profileId: number, botIds: string[]) {
  // Only allow known bots
  const validIds = botIds.filter(id => BOT_REGISTRY[id]);
  await db.prepare('UPDATE trading_profiles SET active_bots = ? WHERE id = ?').run(
    JSON.stringify(validIds), profileId
  );
}
