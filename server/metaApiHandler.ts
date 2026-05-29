// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;

import db, { getSessionLosses } from './db';
import { decrypt, isEncrypted } from './crypto';
import { TrapSignal } from '../src/types';
import { SimulationProvider } from './simulationProvider';
import { isNewsBlackout } from './newsStore.js';

// ── Broker symbol map ─────────────────────────────────────────────────────────
const BROKER_SYMBOL_MAP: Record<string, string> = {
  'GC=F':     'XAUUSD',
  'NQ=F':     'USTEC',
  'CL=F':     'XTIUSD',
  'EURUSD=X': 'EURUSD',
  'GBPUSD=X': 'GBPUSD',
  'USDJPY=X': 'USDJPY',
  'AUDUSD=X': 'AUDUSD',
  'USDCAD=X': 'USDCAD',
  'GBPJPY=X': 'GBPJPY',
};

// ── Pip specification (single source of truth — must match marketStore.ts ASSET_MAP) ──
interface SymbolSpec {
  pipSize: number;         // Price units per 1 pip
  pipValuePerLot: number;  // USD per pip for 1.0 standard lot
  // NOTE: USTEC/NAS100 pipValuePerLot varies by broker contract spec.
  // Verify your broker's contract size before going live.
}

export const SYMBOL_SPECS: Record<string, SymbolSpec> = {
  'XAUUSD': { pipSize: 0.01,   pipValuePerLot: 10  }, // Gold: 1 lot = 100 oz, $0.01/pip = $10
  'EURUSD': { pipSize: 0.0001, pipValuePerLot: 10  },
  'GBPUSD': { pipSize: 0.0001, pipValuePerLot: 10  },
  'AUDUSD': { pipSize: 0.0001, pipValuePerLot: 10  },
  'USDCAD': { pipSize: 0.0001, pipValuePerLot: 10  },
  'USDJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 }, // Approx — varies with JPY rate
  'GBPJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 },
  'USTEC':  { pipSize: 1.0,    pipValuePerLot: 10  }, // ⚠️ Confirm with your broker's contract spec
  'XTIUSD': { pipSize: 0.01,   pipValuePerLot: 10  },
};
const DEFAULT_SPEC: SymbolSpec = { pipSize: 0.0001, pipValuePerLot: 10 };

export function getSymbolSpec(brokerSymbol: string): SymbolSpec {
  return SYMBOL_SPECS[brokerSymbol] ?? DEFAULT_SPEC;
}

import { createHash } from 'crypto';

// ── MetaAPI SDK instance cache (reuse connections, avoid repeated handshakes) ─
const apiCache = new Map<string, any>();

function getApiInstance(token: string): any {
  // Cache by token hash (already decrypted at this point)
  const cacheKey = createHash('sha256').update(token).digest('hex');
  if (!apiCache.has(cacheKey)) {
    apiCache.set(cacheKey, new MetaApi(token));
  }
  return apiCache.get(cacheKey);
}

// ── Lot-size quantiser ───────────────────────────────────────────────────────
/**
 * Rounds a raw lot-size float to the nearest 0.01 lot (micro-lot step),
 * clamps to [0.01, 5.0], and eliminates IEEE 754 floating-point residuals
 * by routing through toFixed(2) before converting back to a number.
 *
 * Examples:
 *   quantizeLots(0.156)              → 0.16
 *   quantizeLots(0.14000000000000001) → 0.14   (no trailing garbage)
 *   quantizeLots(0.004)              → 0.01   (floor to minimum)
 *   quantizeLots(7.89)               → 5.00   (capped at safety max)
 */
function quantizeLots(raw: number): number {
  // Step 1 — round to 2 decimal places via string (immune to IEEE 754 drift)
  const rounded = parseFloat(raw.toFixed(2));
  // Step 2 — enforce [0.01, 5.0] range
  const clamped = Math.min(Math.max(rounded, 0.01), 5.0);
  // Step 3 — one final toFixed pass to guarantee the broker sees "0.14" not "0.14000000000000001"
  return parseFloat(clamped.toFixed(2));
}

// ── Verify Connection Hook ───────────────────────────────────────────────────

export async function verifyMetaApiConnection(token: string, accountId: string): Promise<boolean> {
  accountId = safeDecryptAccountId(accountId);
  try {
    const api = getApiInstance(token);
    const accountPromise = api.metatraderAccountApi.getAccount(accountId);
    
    // Fast-fail timeout to prevent the UI from hanging on save
    const account = await Promise.race([
      accountPromise,
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2000))
    ]);
    
    if (!account) throw new Error("Account not found");
    return true;
  } catch (err: any) {
    if (err.message === 'timeout') {
      console.warn(`[MetaAPI] Verification timed out (2s). Returning false.`);
      return false;
    }
    throw new Error(`MetaAPI Connection Failed: ${err.message}`);
  }
}

export async function verifyMetaApiAccount(token: string, accountId: string): Promise<boolean> {
  try {
    const api = getApiInstance(token);
    const accountPromise = api.metatraderAccountApi.getAccount(accountId);
    const account = await Promise.race([
      accountPromise,
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))
    ]) as any;

    if (account && account.id === accountId) {
      return true;
    }
    return false;
  } catch (err: any) {
    if (err.message === 'timeout') {
      console.warn(`[MetaAPI] Account verification timed out. Assuming valid for now.`);
      return true;
    }
    if (
      err.status === 401 || 
      err.status === 403 || 
      err.status === 404 || 
      err.name === 'NotFoundError' || 
      err.name === 'UnauthorizedError' ||
      err.name === 'MethodAccessError' ||
      err.message?.includes('auth') || 
      err.message?.includes('token') ||
      err.message?.includes('access token') ||
      err.message?.includes('not found')
    ) {
      return false; // Invalid token
    }
    return true; // Valid but maybe API is unreachable temporarily
  }
}

const connectionCache = new Map<string, any>();
const accountCache = new Map<string, any>();
const isConnecting = new Set<string>();

let onMetaApiConnected: (() => void) | null = null;
export function setMetaApiConnectedCallback(cb: () => void) {
  onMetaApiConnected = cb;
}

export function safeDecryptAccountId(accountId: string): string {
  if (!accountId) return accountId;
  try {
    return isEncrypted(accountId) ? decrypt(accountId) : accountId;
  } catch (e: any) {
    console.error(`[Decrypt Error] Failed to decrypt accountId: ${e.message}`);
    return accountId;
  }
}

export function isMetaApiConnecting(): boolean {
  return isConnecting.size > 0;
}

export async function getSharedConnection(token: string, accountId: string, background = false): Promise<any> {
  accountId = safeDecryptAccountId(accountId);
  const key = createHash('sha256').update(token + accountId).digest('hex');
  
  if (connectionCache.has(key)) {
    const cached = connectionCache.get(key);
    try {
      await Promise.race([
        cached.waitSynchronized(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 1000)),
      ]);
      if (onMetaApiConnected) onMetaApiConnected();
      return cached;
    } catch {
      connectionCache.delete(key);
    }
  }

  if (background) {
    if (!isConnecting.has(key)) {
      isConnecting.add(key);
      (async () => {
        try {
          console.log(`[MetaAPI] Starting background synchronization for ${accountId}...`);
          const api = getApiInstance(token);
          const account = await api.metatraderAccountApi.getAccount(accountId);
          accountCache.set(key, account);
          if (account.state !== 'DEPLOYED') {
            await account.deploy();
            await account.waitConnected();
          }
          const connection = account.getRPCConnection();
          await connection.connect();
          
          await Promise.race([
            connection.waitSynchronized(),
            new Promise((_, r) => setTimeout(() => r(new Error('30s timeout')), 30000))
          ]);
          connectionCache.set(key, connection);
          console.log(`[MetaAPI] ✅ Background sync complete for ${accountId}.`);
          if (onMetaApiConnected) onMetaApiConnected();
        } catch (err: any) {
          console.warn(`[MetaAPI] ⚠️ Background sync failed:`, err.message);
        } finally {
          isConnecting.delete(key);
        }
      })();
    }
    throw new Error(`Fast fail: Background sync running for ${accountId}`);
  } else {
    const api = getApiInstance(token);
    const account = await api.metatraderAccountApi.getAccount(accountId);
    accountCache.set(key, account);
    if (account.state !== 'DEPLOYED') {
      await account.deploy();
      await account.waitConnected();
    }
    const connection = account.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized();
    connectionCache.set(key, connection);
    return connection;
  }
}

const streamingConnectionCache = new Map<string, any>();
const isStreamingConnecting = new Set<string>();

const ALL_BROKER_SYMBOLS = [
  'USTEC', 'XAUUSD', 'XTIUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
  'NZDUSD', 'USDCHF', 'GBPJPY', 'EURGBP', 'EURJPY', 'AUDJPY', 'EURAUD',
  'GBPAUD', 'CHFJPY', 'AUDCAD', 'EURCAD', 'NZDJPY', 'GBPCAD'
];

export async function getSharedStreamingConnection(token: string, accountId: string, background = false): Promise<any> {
  accountId = safeDecryptAccountId(accountId);
  const key = createHash('sha256').update(token + accountId).digest('hex');
  
  if (streamingConnectionCache.has(key)) {
    const cached = streamingConnectionCache.get(key);
    try {
      await Promise.race([
        cached.waitSynchronized(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 1000)),
      ]);
      if (onMetaApiConnected) onMetaApiConnected();
      return cached;
    } catch {
      streamingConnectionCache.delete(key);
    }
  }

  if (background) {
    if (!isStreamingConnecting.has(key)) {
      isStreamingConnecting.add(key);
      (async () => {
        try {
          console.log(`[MetaAPI] Starting background streaming synchronization for ${accountId}...`);
          const api = getApiInstance(token);
          const account = await api.metatraderAccountApi.getAccount(accountId);
          if (account.state !== 'DEPLOYED') {
            await account.deploy();
            await account.waitConnected();
          }
          const connection = account.getStreamingConnection();
          await connection.connect();
          await Promise.race([
            connection.waitSynchronized(),
            new Promise((_, r) => setTimeout(() => r(new Error('30s timeout')), 30000))
          ]);
          
          // Subscribe to all symbols for streaming market data
          for (const s of ALL_BROKER_SYMBOLS) {
            try {
              await connection.subscribeToMarketData(s);
            } catch (err: any) {
              console.warn(`[MetaAPI] Failed to subscribe to ${s}:`, err.message);
            }
          }
          
          streamingConnectionCache.set(key, connection);
          console.log(`[MetaAPI] ✅ Background streaming sync complete for ${accountId}.`);
          if (onMetaApiConnected) onMetaApiConnected();
        } catch (err: any) {
          console.warn(`[MetaAPI] ⚠️ Background streaming sync failed:`, err.message);
        } finally {
          isStreamingConnecting.delete(key);
        }
      })();
    }
    throw new Error(`Fast fail: Background streaming sync running for ${accountId}`);
  } else {
    const api = getApiInstance(token);
    const account = await api.metatraderAccountApi.getAccount(accountId);
    if (account.state !== 'DEPLOYED') {
      await account.deploy();
      await account.waitConnected();
    }
    const connection = account.getStreamingConnection();
    await connection.connect();
    await connection.waitSynchronized();
    
    // Subscribe to all symbols for streaming market data
    for (const s of ALL_BROKER_SYMBOLS) {
      try {
        await connection.subscribeToMarketData(s);
      } catch (err: any) {
        console.warn(`[MetaAPI] Failed to subscribe to ${s}:`, err.message);
      }
    }
    
    streamingConnectionCache.set(key, connection);
    if (onMetaApiConnected) onMetaApiConnected();
    return connection;
  }
}

export async function getSharedAccount(token: string, accountId: string): Promise<any> {
  const key = createHash('sha256').update(token + accountId).digest('hex');
  if (accountCache.has(key)) {
    return accountCache.get(key);
  }
  const api = getApiInstance(token);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  accountCache.set(key, account);
  return account;
}

export function clearSharedConnection(token: string, accountId: string) {
  accountId = safeDecryptAccountId(accountId);
  const key = createHash('sha256').update(token + accountId).digest('hex');
  
  const conn = connectionCache.get(key);
  if (conn) {
    try {
      conn.close();
    } catch {}
  }
  connectionCache.delete(key);
  accountCache.delete(key);
  
  const streamConn = streamingConnectionCache.get(key);
  if (streamConn) {
    try {
      streamConn.close();
    } catch {}
    streamingConnectionCache.delete(key);
  }
}

// ── Main trade execution entry point ──────────────────────────────────────────
export async function executeTradeForProfile(
  profileId: number,
  signal: TrapSignal,
  stopLossDistPips: number,
  takeProfitDistPips: number,
  forceRiskPct?: number
) {
  const profile = db.prepare(
    `SELECT tp.id, tp.user_id, u.metaapi_token, tp.metaapi_account_id, tp.risk_multiplier, tp.active_bots
     FROM trading_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.id = ?
       AND tp.automation_active = 1 
       AND u.metaapi_token IS NOT NULL 
       AND tp.metaapi_account_id IS NOT NULL 
       ${process.env.SIMULATION_MODE === 'true' ? '' : `AND u.metaapi_token != 'dummy_token' AND tp.metaapi_account_id != 'dummy_acc'`}`
  ).get(profileId) as any;

  if (!profile) return;

  console.log(`[MetaAPI] Signal ${signal.id} | ${signal.direction} ${signal.symbol} | Executing for profile ${profile.id}`);

  const brokerSymbol = BROKER_SYMBOL_MAP[signal.symbol] ?? signal.symbol.replace('=X', '').replace('=F', '');
  const spec = getSymbolSpec(brokerSymbol);

  // 🛡️ NEWS BLACKOUT WINDOW: Block new trades +/- 5 mins of High Impact News
  if (isNewsBlackout(brokerSymbol, new Date())) {
    console.log(`[MetaAPI] ⛔ TRADE REJECTED — News Blackout Window active for ${brokerSymbol}`);
    return;
  }

  let rawToken: string = '';
  try {
    // ── AUTHORIZATION CHECK: User must have the pair toggled ON ──────────────
    let activeBots: string[] = [];
    try { activeBots = JSON.parse(profile.active_bots || '[]'); } catch (e) { activeBots = []; }
    
    const lowerBrokerSymbol = brokerSymbol.toLowerCase();
    const isAuthorized = activeBots.includes('sniper-system-ai') || 
                         activeBots.some(botId => botId.includes(lowerBrokerSymbol));
                         
    if (!isAuthorized) {
      console.log(`[MetaAPI Profile ${profile.id}] Trade rejected: ${brokerSymbol} is not authorized by active bots.`);
      return;
    }

    // ── LOCKOUT RULE: Max 1 losing trade per session ──────────────────────
    const losses = getSessionLosses(profile.id, signal.timingGate);
    if (losses >= 1) {
      console.warn(`[MetaAPI Profile ${profile.id}] Lockout active. Max losses reached for session ${signal.timingGate}. Skipping trade.`);
      return;
    }

    // ── FIX: Guard null token ─────────────────────────────────────────────
    if (!profile.metaapi_token || !profile.metaapi_account_id) {
      console.warn(`[MetaAPI Profile ${profile.id}] No token or account ID configured — skipping.`);
      return;
    }

    // ── FIX: Decrypt token before use ─────────────────────────────────────
    try {
      rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
    } catch (e: any) {
      console.error(`[MetaAPI Profile ${profile.id}] Token decryption failed — skipping:`, e.message);
      return;
    }

    // ── FIX: Use cached SDK instance ───────────────────────────────────────
    let balance: number = 0;
    let quote: any = null;

    if (process.env.SIMULATION_MODE === 'true') {
       balance = 100.0; // Simulate $100 account
       const liveQuote = await SimulationProvider.getLiveQuote('', brokerSymbol);
       quote = { bid: liveQuote.bid, ask: liveQuote.ask, time: liveQuote.time };
    } else {
       const connection = await getSharedConnection(rawToken, profile.metaapi_account_id, false);
       const accountInfo = await connection.getAccountInformation();
       balance = accountInfo.balance;

       // @ts-ignore
       quote = await connection.getSymbolPrice(brokerSymbol);
       const quoteAgeMs = Date.now() - (quote?.time?.getTime?.() ?? 0);
       if (quoteAgeMs > 10_000) {
         throw new Error(`Stale quote for ${brokerSymbol}: ${quoteAgeMs}ms old. Trade aborted.`);
       }
    }

    // 🛡️ SPREAD TOLERANCE CHECK
    const spread = (quote.ask - quote.bid) / spec.pipSize;
    const isGoldOrIndex = brokerSymbol.includes('XAU') || brokerSymbol.includes('NAS') || brokerSymbol.includes('USTEC');
    const isMinor = brokerSymbol.includes('JPY') || brokerSymbol.includes('AUD') || brokerSymbol.includes('NZD') || brokerSymbol.includes('CAD') || brokerSymbol.includes('CHF');
    const maxSpreadAllowed = isGoldOrIndex ? 25 : (isMinor ? 5 : 3);
    
    if (spread > maxSpreadAllowed) {
       console.warn(`[MetaAPI Profile ${profile.id}] ⛔ TRADE REJECTED — Spread is dangerously high (${spread.toFixed(1)} > ${maxSpreadAllowed} pips)`);
       return;
    }

    // Calculate Lot Size based directly on user's chosen risk percentage (profile.risk_multiplier)
    // Ensure it has a sensible fallback (e.g. 5%) if missing
    const chosenRiskPct = profile.risk_multiplier > 0 ? profile.risk_multiplier : 5;
    const riskAmount = balance * (chosenRiskPct / 100);
    const lotSize = (riskAmount / stopLossDistPips) / spec.pipValuePerLot;

    const slDistance = stopLossDistPips * spec.pipSize;
    const tpDistance = takeProfitDistPips * spec.pipSize;

    let orderResult;
    
    const authorizingBot = activeBots.find(b => b.includes(lowerBrokerSymbol)) || 'sniper-system-ai';
    const botId = authorizingBot;
    const openTime = Date.now();

    const insertTrade = db.prepare(`
      INSERT INTO bot_trade_states
        (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, tp_price,
         lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'OPEN')
    `);

    let entryPrice = signal.direction === 'BUY' ? quote.ask : quote.bid;
    let slPrice = signal.direction === 'BUY' ? (entryPrice - slDistance) : (entryPrice + slDistance);
    let tpPrice = signal.direction === 'BUY' ? (entryPrice + tpDistance) : (entryPrice - tpDistance);

    slPrice = parseFloat(slPrice.toFixed(5));
    tpPrice = parseFloat(tpPrice.toFixed(5));

    const dbId = insertTrade.run(profile.user_id, profile.id, botId, brokerSymbol, signal.direction, entryPrice, slPrice, tpPrice, lotSize, openTime, 'PENDING', entryPrice, entryPrice).lastInsertRowid;

    try {
      if (process.env.SIMULATION_MODE === 'true') {
        orderResult = { orderId: `SIM_${Date.now()}` };
      } else {
        const connection = await getSharedConnection(rawToken, profile.metaapi_account_id, false);
        if (signal.direction === 'BUY') {
          console.log(`[MetaAPI Profile ${profile.id}] BUY @ ${quote.ask} | SL: ${slPrice} | TP: ${tpPrice} | Lots: ${lotSize}`);
          orderResult = await connection.createMarketBuyOrder(brokerSymbol, lotSize, slPrice, tpPrice, { clientId: 'AI_SNIPER' });
        } else {
          console.log(`[MetaAPI Profile ${profile.id}] SELL @ ${quote.bid} | SL: ${slPrice} | TP: ${tpPrice} | Lots: ${lotSize}`);
          orderResult = await connection.createMarketSellOrder(brokerSymbol, lotSize, slPrice, tpPrice, { clientId: 'AI_SNIPER' });
        }
      }

      console.log(`[MetaAPI Profile ${profile.id}] ✅ Order placed: (${orderResult?.orderId})`);

      if (orderResult?.orderId) {
        db.prepare(`UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`).run(orderResult.orderId, dbId);
      }
    } catch (err: any) {
      db.prepare(`DELETE FROM bot_trade_states WHERE id = ?`).run(dbId);
      throw err;
    }
  } catch (err: any) {
    console.error(`[MetaAPI Profile ${profile.id}] ❌ Trade failed:`, err.message);
    if (rawToken) clearSharedConnection(rawToken, profile.metaapi_account_id);
  }
}


export async function getProfileTradeHistory(profileId: number, daysBack: number = 30, resetTimeStr?: string) {
  const profile = db.prepare('SELECT tp.user_id, u.metaapi_token, tp.metaapi_account_id FROM trading_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.id = ?').get(profileId) as any;
  if (!profile || !profile.metaapi_token || !profile.metaapi_account_id) return null;

  let rawToken = profile.metaapi_token;
  try {
    try {
      rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
    } catch(e) {}
    
    // Fast fail connection wait (increase race timeout to 5s to be safe)
    const connection = await Promise.race([
      getSharedConnection(rawToken, profile.metaapi_account_id, false),
      new Promise<any>((_, r) => setTimeout(() => r(new Error('timeout')), 5000))
    ]);

    const now = new Date();
    let start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    
    // 🛡️ DIARY RESET FILTER 🛡️
    // If the user has reset their diary, cap the lookback to the exact reset second.
    if (resetTimeStr) {
      const resetDate = new Date(resetTimeStr);
      if (resetDate.getTime() > start.getTime()) {
        start = resetDate;
      }
    }

    const deals = await connection.getDealsByTimeRange(start, now) as any[];
    if (!deals || !Array.isArray(deals)) return [];

    const positions = new Map<string, any>();

    for (const deal of deals) {
      if (!deal.positionId) continue;
      
      if (!positions.has(deal.positionId)) {
        positions.set(deal.positionId, {
          id: deal.positionId,
          user_id: profile.user_id,
          profile_id: profileId,
          bot_id: (deal.comment || '').replace(/[\[\]]/g, ''),
          broker_symbol: deal.symbol,
          direction: deal.type === 'DEAL_TYPE_BUY' ? (deal.entryType === 'DEAL_ENTRY_IN' ? 'BUY' : 'SELL') : (deal.entryType === 'DEAL_ENTRY_IN' ? 'SELL' : 'BUY'),
          entry_price: 0,
          exit_price: 0,
          lots: deal.volume,
          pips: 0,
          profit: 0,
          status: 'OPEN',
          open_time: 0,
          close_time: null
        });
      }

      const pos = positions.get(deal.positionId);
      
      if (deal.entryType === 'DEAL_ENTRY_IN') {
        pos.entry_price = deal.price;
        pos.open_time = new Date(deal.time).getTime();
        pos.direction = deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL';
      } else if (deal.entryType === 'DEAL_ENTRY_OUT' || deal.entryType === 'DEAL_ENTRY_INOUT') {
        pos.exit_price = deal.price;
        pos.close_time = new Date(deal.time).getTime();
        pos.profit += (deal.profit || 0) + (deal.commission || 0) + (deal.swap || 0);
        pos.status = 'CLOSED';
      }
    }

    const closedTrades = Array.from(positions.values()).filter(p => p.status === 'CLOSED');
    
    for (const trade of closedTrades) {
      const spec = getSymbolSpec(trade.broker_symbol);
      const diff = trade.direction === 'BUY' ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price;
      trade.pips = parseFloat((diff / spec.pipSize).toFixed(1));
      trade.profit = parseFloat(trade.profit.toFixed(2));
    }

    return closedTrades.sort((a, b) => b.close_time - a.close_time);
  } catch (err: any) {
    console.error('[getProfileTradeHistory] Error:', err.message);
    clearSharedConnection(rawToken, profile.metaapi_account_id);
    return null;
  }
}
