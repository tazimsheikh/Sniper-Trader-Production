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
import OldIsGold from './bots/oldIsGold.js';

import EurusdLondonFade from './bots/eurusdLondonFade.js';
import AudusdAsiaFade from './bots/audusdAsiaFade.js';
import NzdusdAsiaFade from './bots/nzdusdAsiaFade.js';
import UsdcadNyFade from './bots/usdcadNyFade.js';
import UsdchfLondonFade from './bots/usdchfLondonFade.js';
import UsdjpyTokyoFade from './bots/usdjpyTokyoFade.js';
import GbpusdLondonFade from './bots/gbpusdLondonFade.js';
import AudjpyNyFade from './bots/audjpyNyFade.js';
import ChfjpyNyFade from './bots/chfjpyNyFade.js';
import EuraudNyFade from './bots/euraudNyFade.js';
import EurcadNyFade from './bots/eurcadNyFade.js';
import EurchfLondonFade from './bots/eurchfLondonFade.js';
import EurjpyNyFade from './bots/eurjpyNyFade.js';
import GbpaudNyFade from './bots/gbpaudNyFade.js';
import GbpcadNyFade from './bots/gbpcadNyFade.js';
import GbpchfLondonFade from './bots/gbpchfLondonFade.js';
import GbpjpyNyFade from './bots/gbpjpyNyFade.js';


// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
// @ts-ignore
const MetaApi = MetaApiPkg.default ?? MetaApiPkg;

// ── Bot Registry ─────────────────────────────────────────────────────────────
// Add new bots here and they automatically appear in the UI and engine.
export const BOT_REGISTRY: Record<string, TradingBot> = {
  'old-is-gold': OldIsGold,

  'eurusd-london-fade': EurusdLondonFade,
  'audusd-asia-fade': AudusdAsiaFade,
  'nzdusd-asia-fade': NzdusdAsiaFade,
  'usdcad-ny-fade': UsdcadNyFade,
  'usdchf-london-fade': UsdchfLondonFade,
  'usdjpy-tokyo-fade': UsdjpyTokyoFade,
  'gbpusd-london-fade': GbpusdLondonFade,
  'audjpy-ny-fade': AudjpyNyFade,
  'chfjpy-ny-fade': ChfjpyNyFade,
  'euraud-ny-fade': EuraudNyFade,
  'eurcad-ny-fade': EurcadNyFade,
  'eurchf-london-fade': EurchfLondonFade,
  'eurjpy-ny-fade': EurjpyNyFade,
  'gbpaud-ny-fade': GbpaudNyFade,
  'gbpcad-ny-fade': GbpcadNyFade,
  'gbpchf-london-fade': GbpchfLondonFade,
  'gbpjpy-ny-fade': GbpjpyNyFade,

};

export const ALL_BOT_CONFIGS: BotConfig[] = Object.values(BOT_REGISTRY).map(b => b.config);

// ── Symbol Specs ──────────────────────────────────────────────────────────────
const SYMBOL_SPECS: Record<string, { pipSize: number; pipValuePerLot: number }> = {
  'XAUUSD': { pipSize: 0.01,   pipValuePerLot: 10 },
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

// ── MetaAPI Connection Cache ───────────────────────────────────────────────────
const apiCache = new Map<string, any>();

async function getConnection(rawToken: string, accountId: string): Promise<any> {
  const cacheKey = `${rawToken.slice(0, 16)}-${accountId}`;
  if (!apiCache.has(cacheKey)) {
    apiCache.set(cacheKey, new MetaApi(rawToken));
  }
  const api = apiCache.get(cacheKey);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  if (account.state !== 'DEPLOYED') {
    await account.deploy();
    await account.waitConnected();
  }
  const conn = account.getRPCConnection();
  await conn.connect();
  await Promise.race([
    conn.waitSynchronized(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 30000)),
  ]);
  return conn;
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getActiveBots(user: any): string[] {
  try {
    const bots = JSON.parse(user.active_bots || '[]');
    return Array.isArray(bots) ? bots : [];
  } catch { return []; }
}

function getOpenTradeForBot(userId: number, botId: string, brokerSymbol: string): BotTradeState | null {
  const row = db.prepare(
    `SELECT * FROM bot_trade_states WHERE user_id = ? AND bot_id = ? AND broker_symbol = ? AND status = 'OPEN' LIMIT 1`
  ).get(userId, botId, brokerSymbol) as any;
  if (!row) return null;
  return {
    botId: row.bot_id,
    userId: row.user_id,
    brokerSymbol: row.broker_symbol,
    direction: row.direction,
    entryPrice: row.entry_price,
    slPrice: row.sl_price,
    tpPrice: row.tp_price,
    lots: row.lots,
    openTime: row.open_time,
    metaOrderId: row.meta_order_id,
    t1Hit: row.t1_hit === 1,
    highestPrice: row.highest_price,
    lowestPrice: row.lowest_price,
  };
}

function saveTradeState(userId: number, state: BotTradeState, orderId?: string) {
  db.prepare(`
    INSERT INTO bot_trade_states
      (user_id, bot_id, broker_symbol, direction, entry_price, sl_price, tp_price,
       lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
  `).run(
    userId, state.botId, state.brokerSymbol, state.direction,
    state.entryPrice, state.slPrice, state.tpPrice, state.lots,
    state.openTime, orderId || null, 0,
    state.highestPrice, state.lowestPrice
  );
}

function closeTrade(userId: number, botId: string, brokerSymbol: string, reason: string) {
  db.prepare(
    `UPDATE bot_trade_states SET status = ? WHERE user_id = ? AND bot_id = ? AND broker_symbol = ? AND status = 'OPEN'`
  ).run(reason, userId, botId, brokerSymbol);
}

function logToDiary(userId: number, botId: string, brokerSymbol: string, direction: string, entryPrice: number, exitPrice: number, lots: number, pips: number, profit: number, status: string, openTime: number) {
  db.prepare(`
    INSERT INTO trade_diary
      (user_id, bot_id, broker_symbol, direction, entry_price, exit_price, lots, pips, profit, status, open_time, close_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, botId, brokerSymbol, direction, entryPrice, exitPrice, lots, pips, profit, status, openTime, Date.now());
}

function updateTradeSl(userId: number, botId: string, brokerSymbol: string, newSl: number) {
  db.prepare(
    `UPDATE bot_trade_states SET sl_price = ? WHERE user_id = ? AND bot_id = ? AND broker_symbol = ? AND status = 'OPEN'`
  ).run(newSl, userId, botId, brokerSymbol);
}

function markT1Hit(userId: number, botId: string, brokerSymbol: string, newSl: number) {
  db.prepare(
    `UPDATE bot_trade_states SET t1_hit = 1, sl_price = ? WHERE user_id = ? AND bot_id = ? AND broker_symbol = ? AND status = 'OPEN'`
  ).run(newSl, userId, botId, brokerSymbol);
}

function updateHighLow(userId: number, botId: string, brokerSymbol: string, highest: number, lowest: number) {
  db.prepare(
    `UPDATE bot_trade_states SET highest_price = ?, lowest_price = ? WHERE user_id = ? AND bot_id = ? AND broker_symbol = ? AND status = 'OPEN'`
  ).run(highest, lowest, userId, botId, brokerSymbol);
}

// ── Main Tick Function ────────────────────────────────────────────────────────
// Called every 30 seconds from the server's polling loop.
export async function botManagerTick(
  marketDataProvider: () => Record<string, { currentPrice: number; bid?: number; ask?: number; pipSize: number; recentDailyCandles: any[] }>
) {
  const now = new Date();

  // Get all users with automation active
  const users = db.prepare(
    `SELECT id, metaapi_token, metaapi_account_id, risk_multiplier, active_bots
     FROM users
     WHERE automation_active = 1
       AND metaapi_token IS NOT NULL
       AND metaapi_account_id IS NOT NULL`
  ).all() as any[];

  if (users.length === 0) return;

  const marketData = marketDataProvider();

  for (const user of users) {
    const activeBotIds = getActiveBots(user);
    if (activeBotIds.length === 0) continue;

    // Decrypt token once per user
    let rawToken: string;
    try {
      rawToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    } catch (e: any) {
      console.error(`[BotManager User ${user.id}] Token decrypt failed:`, e.message);
      continue;
    }

    for (const botId of activeBotIds) {
      const bot = BOT_REGISTRY[botId];
      if (!bot) continue;

      // Process each symbol the bot trades
      for (const brokerSymbol of bot.config.symbols) {
        // Find the matching yahoo key for this broker symbol
        const yahooKey = Object.entries({ 'GC=F': 'XAUUSD', 'NQ=F': 'USTEC', 'EURUSD=X': 'EURUSD', 'GBPUSD=X': 'GBPUSD', 'USDJPY=X': 'USDJPY', 'AUDUSD=X': 'AUDUSD', 'USDCAD=X': 'USDCAD', 'AUDJPY=X': 'AUDJPY', 'CHFJPY=X': 'CHFJPY', 'EURAUD=X': 'EURAUD', 'EURCAD=X': 'EURCAD', 'EURCHF=X': 'EURCHF', 'EURJPY=X': 'EURJPY', 'GBPAUD=X': 'GBPAUD', 'GBPCAD=X': 'GBPCAD', 'GBPCHF=X': 'GBPCHF', 'GBPJPY=X': 'GBPJPY' })
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

        // ── MANAGE EXISTING OPEN TRADE ────────────────────────────────────────
        const openTrade = getOpenTradeForBot(user.id, botId, brokerSymbol);
        if (openTrade) {
          // Update highest/lowest
          const newHighest = Math.max(openTrade.highestPrice, context.currentPrice);
          const newLowest  = Math.min(openTrade.lowestPrice,  context.currentPrice);
          updateHighLow(user.id, botId, brokerSymbol, newHighest, newLowest);
          openTrade.highestPrice = newHighest;
          openTrade.lowestPrice  = newLowest;

          let action = await bot.manageTrade(openTrade, context);

          // 🛡️ UNIVERSAL EOD CLOSURE OVERRIDE 🛡️
          // To perfectly align with the backtester's mathematical simulation,
          // ALL trades must be flattened by EOD. We close at 23:55 UTC to avoid 
          // the brutal midnight spread-widening and swap fees.
          if (context.now.getUTCHours() === 23 && context.now.getUTCMinutes() >= 55) {
            action = { action: 'CLOSE', reason: 'EOD_CLOSE' };
          }

          if (action.action === 'CLOSE') {
            try {
              const conn = await getConnection(rawToken, user.metaapi_account_id);
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
              closeTrade(user.id, botId, brokerSymbol, 'CLOSED');
              
              const spec = SYMBOL_SPECS[brokerSymbol] || { pipSize: 0.01, pipValuePerLot: 10 };
              const exitPrice = context.currentPrice;
              const pips = openTrade.direction === 'BUY' 
                ? (exitPrice - openTrade.entryPrice) / spec.pipSize 
                : (openTrade.entryPrice - exitPrice) / spec.pipSize;
              const profit = pips * spec.pipValuePerLot * openTrade.lots;
              const status = pips >= 0 ? 'WON' : 'LOST';
              
              logToDiary(user.id, botId, brokerSymbol, openTrade.direction, openTrade.entryPrice, exitPrice, openTrade.lots, pips, profit, status, openTrade.openTime);

              console.log(`[BotManager] [${botId}] User ${user.id} trade CLOSED: ${action.reason}`);
            } catch (e: any) {
              console.error(`[BotManager] Close failed for User ${user.id}:`, e.message);
            }
          } else if (action.action === 'MODIFY_SL') {
            try {
              const conn = await getConnection(rawToken, user.metaapi_account_id);
              if (openTrade.metaOrderId) {
                await conn.modifyPosition(openTrade.metaOrderId, action.newSlPrice, openTrade.tpPrice);
              }
              updateTradeSl(user.id, botId, brokerSymbol, action.newSlPrice);
              console.log(`[BotManager] [${botId}] User ${user.id} SL moved to ${action.newSlPrice}`);
            } catch (e: any) {
              console.error(`[BotManager] ModifySL failed for User ${user.id}:`, e.message);
            }
          } else if (action.action === 'PARTIAL_CLOSE') {
            try {
              const conn = await getConnection(rawToken, user.metaapi_account_id);
              if (openTrade.metaOrderId) {
                const closeVolume = Math.round(openTrade.lots * (action.closePercent / 100) * 100) / 100;
                await conn.closePositionPartially(openTrade.metaOrderId, closeVolume, {});
                await conn.modifyPosition(openTrade.metaOrderId, action.newSlPrice, openTrade.tpPrice);
              }
              markT1Hit(user.id, botId, brokerSymbol, action.newSlPrice);
              console.log(`[BotManager] [${botId}] User ${user.id} T1 hit — partial close, SL → BE`);
            } catch (e: any) {
              console.error(`[BotManager] PartialClose failed for User ${user.id}:`, e.message);
            }
          }

          continue; // Don't look for new signals while trade is open
        }

        // ── GENERATE NEW SIGNAL ───────────────────────────────────────────────
        const signal = await bot.generateSignal(context);
        if (!signal.shouldTrade || !signal.direction || !signal.suggestedSlPips) continue;

        const spec = SYMBOL_SPECS[brokerSymbol];
        if (!spec) continue;

        try {
          const conn = await getConnection(rawToken, user.metaapi_account_id);
          const accountInfo = await conn.getAccountInformation();
          const balance: number = accountInfo.balance;

          // Risk: bot's base risk
          const riskPct = bot.config.riskPct;
          const riskAmount = balance * (riskPct / 100);
          let lots = riskAmount / (signal.suggestedSlPips * spec.pipValuePerLot);
          lots = Math.max(0.01, Math.min(10, Math.round(lots * 100) / 100));

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
            botId, userId: user.id, brokerSymbol,
            direction: signal.direction,
            entryPrice, slPrice, tpPrice, lots,
            openTime: Date.now(),
            metaOrderId: orderId,
            t1Hit: false,
            highestPrice: entryPrice,
            lowestPrice: entryPrice,
          };
          saveTradeState(user.id, newState, orderId);

          console.log(
            `[BotManager] ✅ [${botId}] User ${user.id} | ${signal.direction} ${brokerSymbol} ` +
            `| ${lots} lots | SL: ${slPrice} | TP: ${tpPrice} | Reason: ${signal.reason}`
          );
        } catch (e: any) {
          console.error(`[BotManager] Trade entry failed for User ${user.id} Bot ${botId}:`, e.message);
        }
      }
    }
  }
}

// ── Bot toggle API helpers ────────────────────────────────────────────────────
export function getUserActiveBots(userId: number): string[] {
  const row = db.prepare('SELECT active_bots FROM users WHERE id = ?').get(userId) as any;
  return JSON.parse(row?.active_bots || '[]');
}

export function setUserActiveBots(userId: number, botIds: string[]) {
  // Only allow known bots
  const validIds = botIds.filter(id => BOT_REGISTRY[id]);
  db.prepare('UPDATE users SET active_bots = ? WHERE id = ?').run(
    JSON.stringify(validIds), userId
  );
}
