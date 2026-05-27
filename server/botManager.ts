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
import { decrypt, isEncrypted } from './crypto.js';
import { TradingBot, BotConfig, BotContext, BotTradeState } from './bots/BotInterface.js';
import { MarketData } from '../src/types.js';
import { getSharedConnection, clearSharedConnection, isMetaApiConnecting, setMetaApiConnectedCallback } from './metaApiHandler.js';
import { isNewsBlackout } from './newsStore.js';
import SniperSystemAI from './bots/SniperSystemAI.js';
import AUDJPYNyFade from './bots/audjpyNyFade.js';
import AUDUSDLondonFade from './bots/audusdLondonFade.js';
import CHFJPYNyFade from './bots/chfjpyNyFade.js';
import EURAUDLondonFade from './bots/euraudLondonFade.js';
import EURCADLondonFade from './bots/eurcadLondonFade.js';
import EURCHFLondonFade from './bots/eurchfLondonFade.js';
import EURJPYLondonFade from './bots/eurjpyLondonFade.js';
import GBPAUDNyFade from './bots/gbpaudNyFade.js';
import GBPCADNyFade from './bots/gbpcadNyFade.js';
import GBPCHFLondonFade from './bots/gbpchfLondonFade.js';
import GBPJPYNyFade from './bots/gbpjpyNyFade.js';
import GBPUSDLondonFade from './bots/gbpusdLondonFade.js';
import NZDUSDLondonFade from './bots/nzdusdLondonFade.js';
import USDCADLondonFade from './bots/usdcadLondonFade.js';
import USDCHFNyFade from './bots/usdchfNyFade.js';
import USDJPYNyFade from './bots/usdjpyNyFade.js';
import XAUUSDLondonFade from './bots/xauusdLondonFade.js';


// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
// @ts-ignore
const MetaApi = MetaApiPkg.default ?? MetaApiPkg;

// ── Bot Registry ─────────────────────────────────────────────────────────────
// Add new bots here and they automatically appear in the UI and engine.
export const BOT_REGISTRY: Record<string, TradingBot> = {
  'sniper-system-ai': SniperSystemAI,
  'audjpy-ny-fade': AUDJPYNyFade,
  'audusd-london-fade': AUDUSDLondonFade,
  'chfjpy-ny-fade': CHFJPYNyFade,
  'euraud-london-fade': EURAUDLondonFade,
  'eurcad-london-fade': EURCADLondonFade,
  'eurchf-london-fade': EURCHFLondonFade,
  'eurjpy-london-fade': EURJPYLondonFade,
  'gbpaud-ny-fade': GBPAUDNyFade,
  'gbpcad-ny-fade': GBPCADNyFade,
  'gbpchf-london-fade': GBPCHFLondonFade,
  'gbpjpy-ny-fade': GBPJPYNyFade,
  'gbpusd-london-fade': GBPUSDLondonFade,
  'nzdusd-london-fade': NZDUSDLondonFade,
  'usdcad-london-fade': USDCADLondonFade,
  'usdchf-ny-fade': USDCHFNyFade,
  'usdjpy-ny-fade': USDJPYNyFade,
  'xauusd-london-fade': XAUUSDLondonFade,
};

export const ALL_BOT_CONFIGS: BotConfig[] = Object.values(BOT_REGISTRY).map(b => b.config);

// ── MetaAPI Health Status ─────────────────────────────────────────────────────
export let metaApiExecutionHealth: 'healthy' | 'degraded' | 'offline' = 'offline';
export let metaApiLastConnected: number = Date.now(); // Unix ms timestamp

setMetaApiConnectedCallback(() => {
  metaApiExecutionHealth = 'healthy';
  metaApiLastConnected = Date.now();
});
export let missedSignalCount: number = 0;
export let pendingSignalCount: number = 0;

// ── MetaAPI Trade Lockout Failsafe ────────────────────────────────────────────
// If MetaAPI has not successfully executed a trade/connection in 5+ minutes,
// ALL new trade entry is blocked. Existing open trades are still managed (exits).
// The lockout resets automatically as soon as MetaAPI reconnects successfully.
const METAAPI_OFFLINE_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
export let metaApiOfflineSince: number = Date.now(); // Start locked until first successful connection

export function isMetaApiTradeBlocked(): boolean {
  if (process.env.SIMULATION_MODE === 'true') return false;
  if (metaApiExecutionHealth === 'healthy') return false;
  const offlineMins = (Date.now() - metaApiLastConnected) / 60000;
  return offlineMins > 2; // Block trades if offline for > 2 mins
}

export { isMetaApiConnecting };

// ── Fired-Today Tracking (prevents double-fire in widened 2-min windows) ─────
const firedToday = new Map<string, string>(); // key: `${profileId}-${botId}-${symbol}`, value: date string
let lastFiredResetDate = '';

// ── In-Memory Symbol Lock ───────────────────────────────────────────────────────
// Prevents overlapping trades if multiple botManagerTick loops run concurrently.
const activeTradeLocks = new Set<string>(); // key: `${profileId}-${brokerSymbol}`

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
const SYMBOL_SPECS: Record<string, { pipSize: number; pipValuePerLot: number }> = {
  'XAUUSD': { pipSize: 0.01,   pipValuePerLot: 1 },
  'EURUSD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'GBPUSD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'AUDUSD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'USDCAD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'USDJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 },
  'USTEC':  { pipSize: 1.0,    pipValuePerLot: 10 },
  'AUDJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 },
  'CHFJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 },
  'EURAUD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'EURCAD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'EURCHF': { pipSize: 0.0001, pipValuePerLot: 10 },
  'EURJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 },
  'GBPAUD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'GBPCAD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'GBPCHF': { pipSize: 0.0001, pipValuePerLot: 10 },
  'GBPJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 },
};

export async function getConnection(rawToken: string, accountId: string): Promise<any> {
  if (process.env.SIMULATION_MODE === 'true') {
    return {
      getSymbolPrice: async (symbol: string) => {
        const { getSimulationPrice } = require('./simulationProvider');
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
    metaApiExecutionHealth = 'healthy';
    metaApiLastConnected = Date.now();
    return conn;
  } catch (err: any) {
    if (err.message.includes('Fast fail')) {
      // Background sync is in progress
    } else {
      metaApiExecutionHealth = 'offline';
    }
    throw err;
  }
}

// ── DB Migration ──────────────────────────────────────────────────────────────
// Adds active_bots column and bot_trade_states table if they don't exist.
export function initBotManagerSchema() {
  db.exec(`
    -- Per-user active bot IDs stored as JSON array string
    ALTER TABLE users ADD COLUMN active_bots TEXT DEFAULT '[]';
  `);
  // SQLite will throw if column already exists — that's fine, we swallow it.
  // Use a try/catch in the caller.
}

export function ensureBotSchema() {
  try { initBotManagerSchema(); } catch (_) { /* already migrated */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_trade_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      profile_id INTEGER,
      bot_id TEXT NOT NULL,
      broker_symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      sl_price REAL NOT NULL,
      tp_price REAL NOT NULL,
      lots REAL NOT NULL,
      open_time INTEGER NOT NULL,
      meta_order_id TEXT,
      t1_hit INTEGER DEFAULT 0,
      highest_price REAL NOT NULL,
      lowest_price REAL NOT NULL,
      status TEXT DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS trade_diary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      profile_id INTEGER,
      bot_id TEXT NOT NULL,
      broker_symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      lots REAL NOT NULL,
      pips REAL NOT NULL,
      profit REAL NOT NULL,
      status TEXT NOT NULL,
      open_time INTEGER NOT NULL,
      close_time INTEGER NOT NULL
    );
  `);

  try { db.exec('ALTER TABLE bot_trade_states ADD COLUMN profile_id INTEGER'); } catch (_) {}
  try { db.exec('ALTER TABLE trade_diary ADD COLUMN profile_id INTEGER'); } catch (_) {}

  // Auto-migrate users to have at least a Default Profile
  const usersToMigrate = db.prepare(`
    SELECT * FROM users 
    WHERE id NOT IN (SELECT DISTINCT user_id FROM trading_profiles)
  `).all() as any[];

  for (const user of usersToMigrate) {
    const result = db.prepare(`
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
    db.prepare('UPDATE bot_trade_states SET profile_id = ? WHERE user_id = ? AND profile_id IS NULL').run(defaultProfileId, user.id);
    db.prepare('UPDATE trade_diary SET profile_id = ? WHERE user_id = ? AND profile_id IS NULL').run(defaultProfileId, user.id);
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
function getOpenTradesForBot(profileId: number, botId: string, brokerSymbol: string): BotTradeState[] {
  // First: look for trades owned by THIS bot (for manageTrade purposes)
  const rows = db.prepare(
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
function hasAnyOpenTradeOnSymbol(profileId: number, brokerSymbol: string): boolean {
  const row = db.prepare(
    `SELECT id FROM bot_trade_states WHERE profile_id = ? AND broker_symbol = ? AND status = 'OPEN' LIMIT 1`
  ).get(profileId, brokerSymbol) as any;
  return !!row;
}

export function saveTradeState(state: BotTradeState, orderId?: string) {
  db.prepare(`
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

function closeTrade(metaOrderId: string, reason: string) {
  db.prepare(
    `UPDATE bot_trade_states SET status = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(reason, metaOrderId);
}

function logToDiary(userId: number, profileId: number, botId: string, brokerSymbol: string, direction: string, entryPrice: number, exitPrice: number, lots: number, pips: number, profit: number, status: string, openTime: number) {
  db.prepare(`
    INSERT INTO trade_diary
      (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, exit_price, lots, pips, profit, status, open_time, close_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, profileId, botId, brokerSymbol, direction, entryPrice, exitPrice, lots, pips, profit, status, openTime, Date.now());
}

function updateTradeSl(metaOrderId: string, newSl: number) {
  db.prepare(
    `UPDATE bot_trade_states SET sl_price = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(newSl, metaOrderId);
}

function markT1Hit(metaOrderId: string, newSl: number) {
  db.prepare(
    `UPDATE bot_trade_states SET t1_hit = 1, sl_price = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(newSl, metaOrderId);
}

function updateHighLow(metaOrderId: string, highest: number, lowest: number) {
  db.prepare(
    `UPDATE bot_trade_states SET highest_price = ?, lowest_price = ? WHERE meta_order_id = ? AND status = 'OPEN'`
  ).run(highest, lowest, metaOrderId);
}

// ── Main Tick Function ────────────────────────────────────────────────────────
// Called every 30 seconds from the server's polling loop.
export async function botManagerTick(
  marketDataProvider: () => Record<string, MarketData>
) {
  const now = new Date();
  resetFiredTodayIfNeeded();

  // ── PHASE 0: Process pending signal queue (retries) ──────────────────────
  // Only retry queued signals if MetaAPI is not in lockout
  if (!isMetaApiTradeBlocked()) {
    await processPendingSignals(marketDataProvider);
  } else {
    const offlineMins = Math.floor((Date.now() - metaApiLastConnected) / 60000);
    console.log(`[BotManager] ⛔ MetaAPI offline for ${offlineMins}m — trade execution LOCKED. Pending signals paused.`);
  }

  const isSim = process.env.SIMULATION_MODE === 'true';
  const profiles = db.prepare(
    `SELECT tp.id, tp.user_id, u.metaapi_token, tp.metaapi_account_id, tp.risk_multiplier, tp.active_bots
     FROM trading_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.automation_active = 1
       AND u.metaapi_token IS NOT NULL
       AND tp.metaapi_account_id IS NOT NULL
       ${isSim ? 'AND tp.id = 999' : `AND u.metaapi_token != 'dummy_token' AND tp.metaapi_account_id != 'dummy_acc'`}`
  ).all() as any[];

  if (profiles.length === 0) return;

  const marketData = marketDataProvider();

  for (const profile of profiles) {
    const activeBotIds = getActiveBots(profile);
    if (activeBotIds.length === 0) continue;

    // Decrypt token once per profile
    let rawToken: string;
    try {
      rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
    } catch (e: any) {
      console.error(`[BotManager Profile ${profile.id}] Token decrypt failed:`, e.message);
      continue;
    }

    // Proactively check/maintain connection for active profile to prevent false lockouts
    try {
      await getConnection(rawToken, profile.metaapi_account_id);
    } catch (e: any) {
      if (!e.message.includes('Fast fail')) {
        console.warn(`[BotManager Profile ${profile.id}] Connection check failed:`, e.message);
      }
    }

    const sniperBot = BOT_REGISTRY['sniper-system-ai'];
    if (!sniperBot) continue;

    // Treat active flip switches as authorized pairs for the master bot
    const authorizedSymbols = new Set<string>();
    for (const botId of activeBotIds) {
      const b = BOT_REGISTRY[botId];
      if (b && b.config.id !== 'sniper-system-ai') {
        for (const sym of b.config.symbols) authorizedSymbols.add(sym);
      }
    }
    
    // Explicitly add symbols if they turned on Sniper AI directly (though it's designed to trade authorized ones)
    if (activeBotIds.includes('sniper-system-ai')) {
        for (const sym of sniperBot.config.symbols) authorizedSymbols.add(sym);
    }

    const botId = 'sniper-system-ai';
    const bot = sniperBot;

    // Process each authorized symbol using the master Sniper AI bot
    for (const brokerSymbol of Array.from(authorizedSymbols)) {
        // Find the matching yahoo key for this broker symbol
        // 🛡️ BUG FIX #4: Added NZDUSD=X and USDCHF=X — previously missing, causing those bots to never receive market data
        const yahooKey = Object.entries({ 'GC=F': 'XAUUSD', 'NQ=F': 'USTEC', 'EURUSD=X': 'EURUSD', 'GBPUSD=X': 'GBPUSD', 'USDJPY=X': 'USDJPY', 'AUDUSD=X': 'AUDUSD', 'USDCAD=X': 'USDCAD', 'NZDUSD=X': 'NZDUSD', 'USDCHF=X': 'USDCHF', 'AUDJPY=X': 'AUDJPY', 'CHFJPY=X': 'CHFJPY', 'EURAUD=X': 'EURAUD', 'EURCAD=X': 'EURCAD', 'EURCHF=X': 'EURCHF', 'EURJPY=X': 'EURJPY', 'GBPAUD=X': 'GBPAUD', 'GBPCAD=X': 'GBPCAD', 'GBPCHF=X': 'GBPCHF', 'GBPJPY=X': 'GBPJPY' })
          .find(([_, v]) => v === brokerSymbol)?.[0];
        const market = yahooKey ? marketData[yahooKey] : null;
        if (!market) continue;

        const spread = Math.abs((market.ask || market.currentPrice) - (market.bid || market.currentPrice)) / market.pipSize;

        const context: BotContext = {
          currentPrice: market.currentPrice,
          bid: market.bid || market.currentPrice,
          ask: market.ask || market.currentPrice,
          spread,
          brokerSymbol,
          now,
          recentDailyCandles: market.recentDailyCandles || [],
        };

        // ── MANAGE EXISTING OPEN TRADES ────────────────────────────────────────
        const openTrades = getOpenTradesForBot(profile.id, botId, brokerSymbol);
        for (const openTrade of openTrades) {
          if (!openTrade.metaOrderId) continue;

          // Update highest/lowest
          const newHighest = Math.max(openTrade.highestPrice, context.currentPrice);
          const newLowest  = Math.min(openTrade.lowestPrice,  context.currentPrice);
          updateHighLow(openTrade.metaOrderId, newHighest, newLowest);
          openTrade.highestPrice = newHighest;
          openTrade.lowestPrice  = newLowest;

          let action = await bot.manageTrade(openTrade, context);

          // 🛡️ UNIVERSAL EOD CLOSURE OVERRIDE 🛡️
          if (context.now.getUTCHours() === 23 && context.now.getUTCMinutes() >= 55) {
            action = { action: 'CLOSE', reason: 'EOD_CLOSE' };
          }

          if (action.action === 'CLOSE') {
            try {
              if (process.env.SIMULATION_MODE !== 'true') {
                const conn = await getConnection(rawToken, profile.metaapi_account_id);
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
              closeTrade(openTrade.metaOrderId, 'CLOSED');
              
              const spec = SYMBOL_SPECS[brokerSymbol] || { pipSize: 0.01, pipValuePerLot: 10 };
              const exitPrice = context.currentPrice;
              const pips = openTrade.direction === 'BUY' 
                ? (exitPrice - openTrade.entryPrice) / spec.pipSize 
                : (openTrade.entryPrice - exitPrice) / spec.pipSize;
              const profit = pips * spec.pipValuePerLot * openTrade.lots;
              const status = pips >= 0 ? 'WON' : 'LOST';
              
              logToDiary(profile.user_id, profile.id, botId, brokerSymbol, openTrade.direction, openTrade.entryPrice, exitPrice, openTrade.lots, pips, profit, status, openTrade.openTime);

              console.log(`[BotManager] [${botId}] Profile ${profile.id} trade CLOSED: ${action.reason}`);
            } catch (e: any) {
              console.error(`[BotManager] Close failed for Profile ${profile.id}:`, e.message);
              clearSharedConnection(rawToken, profile.metaapi_account_id);
            }
          } else if (action.action === 'MODIFY_SL') {
            try {
              if (process.env.SIMULATION_MODE !== 'true') {
                const conn = await getConnection(rawToken, profile.metaapi_account_id);
                if (openTrade.metaOrderId) {
                  await conn.modifyPosition(openTrade.metaOrderId, action.newSlPrice, openTrade.tpPrice);
                }
              }
              updateTradeSl(openTrade.metaOrderId, action.newSlPrice);
              console.log(`[BotManager] [${botId}] Profile ${profile.id} SL moved to ${action.newSlPrice}`);
            } catch (e: any) {
              console.error(`[BotManager] ModifySL failed for Profile ${profile.id}:`, e.message);
              clearSharedConnection(rawToken, profile.metaapi_account_id);
            }
          } else if (action.action === 'PARTIAL_CLOSE') {
            try {
              if (process.env.SIMULATION_MODE !== 'true') {
                const conn = await getConnection(rawToken, profile.metaapi_account_id);
                if (openTrade.metaOrderId) {
                  const closeVolume = Math.round(openTrade.lots * (action.closePercent / 100) * 100) / 100;
                  await conn.closePositionPartially(openTrade.metaOrderId, closeVolume, {});
                  await conn.modifyPosition(openTrade.metaOrderId, action.newSlPrice, openTrade.tpPrice);
                }
              }
              markT1Hit(openTrade.metaOrderId, action.newSlPrice);
              console.log(`[BotManager] [${botId}] Profile ${profile.id} T1 hit — partial close, SL → BE`);
            } catch (e: any) {
              console.error(`[BotManager] PartialClose failed for Profile ${profile.id}:`, e.message);
              clearSharedConnection(rawToken, profile.metaapi_account_id);
            }
          }

          continue; // Don't look for new signals while trade is open
        }

        // ── GENERATE NEW SIGNAL ───────────────────────────────────────────────
        // 🛡️ FAILSAFE: Block ALL new trade entries if MetaAPI has been offline for 5+ minutes.
        // Open trade management (exits, SL moves) is intentionally NOT blocked above — 
        // we still exit existing positions even when blocked from opening new ones.
        if (isMetaApiTradeBlocked()) {
          const offlineMins = metaApiLastConnected === 0
            ? 'never connected'
            : `${Math.floor((Date.now() - metaApiLastConnected) / 60000)}m`;
          console.log(`[BotManager] [${botId}] ⛔ NEW TRADE BLOCKED — MetaAPI offline (${offlineMins}). No Yahoo fallback trades allowed.`);
          continue;
        }

        // 🛡️ NEWS BLACKOUT WINDOW: Block new trades +/- 5 mins of High Impact News
        if (isNewsBlackout(brokerSymbol, now)) {
          console.log(`[BotManager] [${botId}] ⛔ NEW TRADE BLOCKED — News Blackout Window active for ${brokerSymbol}`);
          continue;
        }

        // 🛡️ BUG FIX #1: Block signal if ANY other bot already has an open position on this symbol
        if (hasAnyOpenTradeOnSymbol(profile.id, brokerSymbol)) {
          console.log(`[BotManager] [${botId}] Skipping signal — another bot already has an open trade on ${brokerSymbol} for profile ${profile.id}`);
          continue;
        }

        const lockKey = `${profile.id}-${brokerSymbol}`;
        if (activeTradeLocks.has(lockKey)) {
          console.log(`[BotManager] [${botId}] Skipping signal — trade evaluation already in progress for ${brokerSymbol} (preventing race condition)`);
          continue;
        }

        activeTradeLocks.add(lockKey);
        try {
          const signal = await bot.generateSignal(context);
          if (!signal.shouldTrade || !signal.direction || !signal.suggestedSlPips) continue;

          // 🛡️ SPREAD TOLERANCE CHECK 🛡️
          // Reject trade if the broker's live spread is abnormally high (e.g. during/after news).
          const isGoldOrIndex = brokerSymbol.includes('XAU') || brokerSymbol.includes('NAS') || brokerSymbol.includes('USTEC');
          const isMinor = brokerSymbol.includes('JPY') || brokerSymbol.includes('AUD') || brokerSymbol.includes('NZD') || brokerSymbol.includes('CAD') || brokerSymbol.includes('CHF');
          const maxSpreadAllowed = isGoldOrIndex ? 25 : (isMinor ? 5 : 3);
          
          if (context.spread > maxSpreadAllowed) {
            console.log(`[BotManager] [${botId}] ⛔ NEW TRADE REJECTED — Spread is dangerously high (${context.spread.toFixed(1)} > ${maxSpreadAllowed} pips)`);
            continue;
          }

          // 🛡️ STRUCTURAL SL CAPPING 🛡️
          // Cap maximum allowed SL pips to prevent bots from setting excessively wide stops
          // during extreme volatility which ties up too much free margin.
          const maxSl = brokerSymbol.includes('XAU') || brokerSymbol.includes('NAS') ? 250 : 150;
          signal.suggestedSlPips = Math.min(signal.suggestedSlPips, maxSl);

          // 🛡️ FIRED-TODAY GUARD — prevent double-fires in widened 2-min windows
          if (hasFiredToday(profile.id, botId, brokerSymbol)) {
            continue; // Already fired today for this bot/symbol/profile combo
          }

          const spec = SYMBOL_SPECS[brokerSymbol];
          if (!spec) continue;

          try {
            const conn = await getConnection(rawToken, profile.metaapi_account_id);
            const accountInfo = await conn.getAccountInformation();
            const balance: number = accountInfo.balance;

            // 🛡️ DAY 1 & CONFLUENCE RISK OVERRIDE 🛡️
            const isThreeSessionSetup = 
              (market.londonHigh > market.asianHigh || market.londonLow < market.asianLow) && 
              (market.currentPrice > market.londonLow && market.currentPrice < market.londonHigh);
            
            if (market.dayOfWeekCycle === 1 && !isThreeSessionSetup) {
              console.log(`[BotManager] [${botId}] ⛔ NEW TRADE REJECTED — Day 1 without 3-Session setup.`);
              continue;
            }

            // Risk: bot's base risk * profile risk multiplier
            let targetRiskPct = bot.config.riskPct * (profile.risk_multiplier || 1);
            if (market.dayOfWeekCycle === 3 && isThreeSessionSetup) {
              targetRiskPct = 10; // Holy Grail Confluence overrides risk to 10%
              console.log(`[BotManager] [${botId}] 🎯 HOLY GRAIL CONFLUENCE DETECTED — Overriding risk to 10%`);
            }

            let riskAmount = balance * (targetRiskPct / 100);

            // 🛡️ DYNAMIC TRADE REJECTION & MICRO-ACCOUNT AGGRESSION CURVE 🛡️
            const minRiskAmount = 0.01 * signal.suggestedSlPips * spec.pipValuePerLot;
            
            if (minRiskAmount > riskAmount) {
              if (balance < 100) {
                // Micro-Account Aggression Curve: Bending the rules up to 15% to take trades
                const minRiskPct = (minRiskAmount / balance) * 100;
                if (minRiskPct <= 15) {
                  console.log(`[BotManager] [${botId}] Profile ${profile.id} | Micro-Account scaling risk from ${targetRiskPct.toFixed(1)}% to ${minRiskPct.toFixed(1)}% to meet 0.01 lot minimum.`);
                  riskAmount = minRiskAmount; // Override riskAmount to allow the trade at exactly 0.01 lots
                } else {
                  console.log(`[BotManager] [${botId}] Profile ${profile.id} REJECTED: Min risk ($${minRiskAmount.toFixed(2)}) is ${minRiskPct.toFixed(1)}%, exceeding 15% hard ceiling.`);
                  logToDiary(profile.user_id, profile.id, botId, brokerSymbol, signal.direction, 0, 0, 0, 0, 0, 'REJECTED', Date.now());
                  continue;
                }
              } else {
                // Standard strict rejection for normal accounts
                console.log(`[BotManager] [${botId}] Profile ${profile.id} REJECTED: Min 0.01 lot risk ($${minRiskAmount.toFixed(2)}) exceeds allowed target risk ($${riskAmount.toFixed(2)})`);
                logToDiary(profile.user_id, profile.id, botId, brokerSymbol, signal.direction, 0, 0, 0, 0, 0, 'REJECTED', Date.now());
                continue;
              }
            }

            let lots = riskAmount / (signal.suggestedSlPips * spec.pipValuePerLot);
            // Hard cap max lots to 0.1
            lots = Math.max(0.01, Math.min(0.1, Math.round(lots * 100) / 100));

            const quote = await conn.getSymbolPrice(brokerSymbol);
            const slDist = signal.suggestedSlPips * spec.pipSize;
            const tpDist = (signal.suggestedTpPips || signal.suggestedSlPips * 2) * spec.pipSize;

            let orderId: string;
            let entryPrice: number;
            let slPrice: number;
            let tpPrice: number;

            if (signal.direction === 'BUY') {
              entryPrice = quote.ask;
              slPrice    = parseFloat((quote.ask - slDist).toFixed(5));
              tpPrice    = parseFloat((quote.ask + tpDist).toFixed(5));
              const result = await conn.createMarketBuyOrder(brokerSymbol, lots, slPrice, tpPrice, {
                comment: `[${botId}]`,
                slippage: 30,
              });
              orderId = result.orderId;
            } else {
              entryPrice = quote.bid;
              slPrice    = parseFloat((quote.bid + slDist).toFixed(5));
              tpPrice    = parseFloat((quote.bid - tpDist).toFixed(5));
              const result = await conn.createMarketSellOrder(brokerSymbol, lots, slPrice, tpPrice, {
                comment: `[${botId}]`,
                slippage: 30,
              });
              orderId = result.orderId;
            }

            const newState: BotTradeState = {
              botId, userId: profile.user_id, profileId: profile.id, brokerSymbol,
              direction: signal.direction,
              entryPrice, slPrice, tpPrice, lots,
              openTime: Date.now(),
              metaOrderId: orderId,
              t1Hit: false,
              highestPrice: entryPrice,
              lowestPrice: entryPrice,
            };
            saveTradeState(newState, orderId);

            console.log(
              `[BotManager] ✅ [${botId}] Profile ${profile.id} | ${signal.direction} ${brokerSymbol} ` +
              `| ${lots} lots | SL: ${slPrice} | TP: ${tpPrice} | Reason: ${signal.reason}`
            );

            // Mark as fired today to prevent double-fire in widened window
            markFiredToday(profile.id, botId, brokerSymbol);
            metaApiExecutionHealth = 'healthy';
            metaApiLastConnected = Date.now();
          } catch (e: any) {
            console.error(`[BotManager] Trade entry failed for Profile ${profile.id} Bot ${botId}:`, e.message);

            // 🛡️ SIGNAL QUEUE — Queue the signal for retry instead of dropping it
            if (e.message.includes('Fast fail') || e.message.includes('timeout') || e.message.includes('xhr poll')) {
              metaApiExecutionHealth = 'offline';
              clearSharedConnection(rawToken, profile.metaapi_account_id);
              queueSignal(profile.id, profile.user_id, botId, brokerSymbol, signal);
              markFiredToday(profile.id, botId, brokerSymbol); // Don't re-generate while queued
            }
          }
        } finally {
          activeTradeLocks.delete(lockKey);
        }
      }
  }
}

function queueSignal(profileId: number, userId: number, botId: string, brokerSymbol: string, signal: any) {
  const expiresAt = Date.now() + 5 * 60 * 1000;
  db.prepare(`
    INSERT INTO pending_signals
    (profile_id, user_id, bot_id, broker_symbol, direction, suggested_sl_pips, suggested_tp_pips, reason, created_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(
    profileId, userId, botId, brokerSymbol, signal.direction, signal.suggestedSlPips, signal.suggestedTpPips || null, signal.reason || null, Date.now(), expiresAt
  );
  pendingSignalCount++;
}

async function processPendingSignals(marketDataProvider: any) {
  const now = Date.now();
  const expired = db.prepare(`UPDATE pending_signals SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?`).run(now);
  if (expired.changes > 0) {
    missedSignalCount += expired.changes;
    pendingSignalCount = Math.max(0, pendingSignalCount - expired.changes);
  }

  const pending = db.prepare(`SELECT * FROM pending_signals WHERE status = 'PENDING'`).all() as any[];
  if (pending.length === 0) return;

  for (const sig of pending) {
    const profile = db.prepare(`SELECT tp.*, u.metaapi_token FROM trading_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.id = ?`).get(sig.profile_id) as any;
    if (!profile) {
      db.prepare(`UPDATE pending_signals SET status = 'FAILED' WHERE id = ?`).run(sig.id);
      pendingSignalCount = Math.max(0, pendingSignalCount - 1);
      continue;
    }

    let rawToken: string;
    try {
      rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
    } catch (e: any) {
      continue;
    }

    const bot = BOT_REGISTRY[sig.bot_id];
    if (!bot) continue;

    const spec = SYMBOL_SPECS[sig.broker_symbol];
    if (!spec) continue;

    const signalObj = {
       direction: sig.direction,
       suggestedSlPips: sig.suggested_sl_pips,
       suggestedTpPips: sig.suggested_tp_pips,
       reason: sig.reason || 'Delayed Execution'
    };

    try {
      const conn = await getConnection(rawToken, profile.metaapi_account_id);
      const accountInfo = await conn.getAccountInformation();
      const balance: number = accountInfo.balance;

      const targetRiskPct = bot.config.riskPct * (profile.risk_multiplier || 1);
      let riskAmount = balance * (targetRiskPct / 100);

      const minRiskAmount = 0.01 * signalObj.suggestedSlPips * spec.pipValuePerLot;
      
      if (minRiskAmount > riskAmount) {
        if (balance < 100) {
          const minRiskPct = (minRiskAmount / balance) * 100;
          if (minRiskPct <= 15) {
            riskAmount = minRiskAmount;
          } else {
            db.prepare(`UPDATE pending_signals SET status = 'FAILED' WHERE id = ?`).run(sig.id);
            pendingSignalCount = Math.max(0, pendingSignalCount - 1);
            continue;
          }
        } else {
          db.prepare(`UPDATE pending_signals SET status = 'FAILED' WHERE id = ?`).run(sig.id);
          pendingSignalCount = Math.max(0, pendingSignalCount - 1);
          continue;
        }
      }

      let lots = riskAmount / (signalObj.suggestedSlPips * spec.pipValuePerLot);
      // Hard cap max lots to 0.1
      lots = Math.max(0.01, Math.min(0.1, Math.round(lots * 100) / 100));

      const quote = await conn.getSymbolPrice(sig.broker_symbol);
      const slDist = signalObj.suggestedSlPips * spec.pipSize;
      const tpDist = (signalObj.suggestedTpPips || signalObj.suggestedSlPips * 2) * spec.pipSize;

      let orderId: string;
      let entryPrice: number;
      let slPrice: number;
      let tpPrice: number;

      if (signalObj.direction === 'BUY') {
        entryPrice = quote.ask;
        slPrice    = parseFloat((quote.ask - slDist).toFixed(5));
        tpPrice    = parseFloat((quote.ask + tpDist).toFixed(5));
        const result = await conn.createMarketBuyOrder(sig.broker_symbol, lots, slPrice, tpPrice, {
          comment: `[${sig.bot_id}] RETRY`,
          slippage: 30,
        });
        orderId = result.orderId;
      } else {
        entryPrice = quote.bid;
        slPrice    = parseFloat((quote.bid + slDist).toFixed(5));
        tpPrice    = parseFloat((quote.bid - tpDist).toFixed(5));
        const result = await conn.createMarketSellOrder(sig.broker_symbol, lots, slPrice, tpPrice, {
          comment: `[${sig.bot_id}] RETRY`,
          slippage: 30,
        });
        orderId = result.orderId;
      }

      const newState: BotTradeState = {
        botId: sig.bot_id, userId: profile.user_id, profileId: profile.id, brokerSymbol: sig.broker_symbol,
        direction: signalObj.direction,
        entryPrice, slPrice, tpPrice, lots,
        openTime: Date.now(),
        metaOrderId: orderId,
        t1Hit: false,
        highestPrice: entryPrice,
        lowestPrice: entryPrice,
      };
      saveTradeState(newState, orderId);

      db.prepare(`UPDATE pending_signals SET status = 'EXECUTED' WHERE id = ?`).run(sig.id);
      pendingSignalCount = Math.max(0, pendingSignalCount - 1);
      
      console.log(`[BotManager] ✅ [${sig.bot_id}] RETRY Profile ${profile.id} | ${signalObj.direction} ${sig.broker_symbol} `);
      metaApiExecutionHealth = 'healthy';
      metaApiLastConnected = Date.now();
    } catch (e: any) {
      if (e.message.includes('Fast fail') || e.message.includes('timeout') || e.message.includes('xhr poll')) {
          metaApiExecutionHealth = 'offline';
          clearSharedConnection(rawToken, profile.metaapi_account_id);
          // Leave it PENDING until it expires
      } else {
          db.prepare(`UPDATE pending_signals SET status = 'FAILED' WHERE id = ?`).run(sig.id);
          pendingSignalCount = Math.max(0, pendingSignalCount - 1);
          missedSignalCount++;
      }
    }
  }
}

// ── Bot toggle API helpers ────────────────────────────────────────────────────
export function getProfileActiveBots(profileId: number): string[] {
  const row = db.prepare('SELECT active_bots FROM trading_profiles WHERE id = ?').get(profileId) as any;
  return JSON.parse(row?.active_bots || '[]');
}

export function setProfileActiveBots(profileId: number, botIds: string[]) {
  // Only allow known bots
  const validIds = botIds.filter(id => BOT_REGISTRY[id]);
  db.prepare('UPDATE trading_profiles SET active_bots = ? WHERE id = ?').run(
    JSON.stringify(validIds), profileId
  );
}
