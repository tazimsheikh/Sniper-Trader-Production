// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;

import db, { getSessionLosses } from './db';
import { decrypt, isEncrypted } from './crypto';
import { TrapSignal } from '../src/types';
import { SimulationProvider } from './simulationProvider';

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
      // If it times out, we accept it as valid for now and let the background worker try syncing
      console.warn(`[MetaAPI] Verification timed out (2s). Assuming valid for background sync.`);
      return true;
    }
    throw new Error(`MetaAPI Connection Failed: ${err.message}`);
  }
}

export async function verifyMetaApiToken(token: string): Promise<boolean> {
  try {
    const api = getApiInstance(token);
    const accountsPromise = api.metatraderAccountApi.getAccountsWithClassicPagination();
    await Promise.race([
      accountsPromise,
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))
    ]);
    return true; // Token is valid, whether it timed out or successfully returned
  } catch (err: any) {
    if (err.message === 'timeout') {
      console.warn(`[MetaAPI] Token verification timed out. Assuming valid.`);
      return true;
    }
    if (
      err.status === 401 || 
      err.status === 403 || 
      err.name === 'UnauthorizedError' ||
      err.name === 'MethodAccessError' ||
      err.message?.includes('auth') || 
      err.message?.includes('token') ||
      err.message?.includes('access token')
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

export function isMetaApiConnecting(): boolean {
  return isConnecting.size > 0;
}

export async function getSharedConnection(token: string, accountId: string, background = false): Promise<any> {
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
  const key = createHash('sha256').update(token + accountId).digest('hex');
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
export async function executeTradeForUsers(
  signal: TrapSignal,
  stopLossDistPips: number,
  takeProfitDistPips: number,
  forceRiskPct?: number
) {
  const profiles = db.prepare(
    `SELECT tp.id, tp.user_id, u.metaapi_token, tp.metaapi_account_id, tp.risk_multiplier 
     FROM trading_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.automation_active = 1 
       AND u.metaapi_token IS NOT NULL 
       AND tp.metaapi_account_id IS NOT NULL 
       ${process.env.SIMULATION_MODE === 'true' ? 'AND tp.id = 999' : `AND u.metaapi_token != 'dummy_token' AND tp.metaapi_account_id != 'dummy_acc'`}`
  ).all() as any[];

  if (profiles.length === 0) return;

  console.log(`[MetaAPI] Signal ${signal.id} | ${signal.direction} ${signal.symbol} | Executing for ${profiles.length} profile(s)`);

  const brokerSymbol = BROKER_SYMBOL_MAP[signal.symbol] ?? signal.symbol.replace('=X', '').replace('=F', '');
  const spec = getSymbolSpec(brokerSymbol);

  // Base risk from actual signal grade: grade 5 = 5%, grade 1 = 1%
  let baseRiskPct = forceRiskPct ?? signal.grade;
  if (signal.isHolyGrailConfluence) {
    baseRiskPct = 10;
  }

  const promises = activeProfiles.map(async (profile) => {
    try {
      // ── LOCKOUT RULE: Max 1 losing trade per session ──────────────────────
      const losses = getSessionLosses(profile.id, signal.timingGate);
      if (losses >= 1) {
        console.warn(`[MetaAPI Profile ${profile.id}] Lockout active. Max losses reached for session ${signal.timingGate}. Skipping trade.`);
        return;
      }

      // ── FIX: Guard null token ─────────────────────────────────────────────
      if (!profile.metaapi_token) {
        console.warn(`[MetaAPI Profile ${profile.id}] No token configured — skipping.`);
        return;
      }
      if (!profile.metaapi_account_id) {
        console.warn(`[MetaAPI Profile ${profile.id}] No account ID configured — skipping.`);
        return;
      }

      // ── FIX: Decrypt token before use ─────────────────────────────────────
      let rawToken: string;
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

      // Dual Trade Logic (TP1 & TP2)
      const halfLotSize = quantizeLots(lotSize / 2);
      if (halfLotSize < 0.01) {
         console.warn(`[MetaAPI Profile ${profile.id}] Lot size too small for dual trades (${lotSize}). Skipping.`);
         return;
      }

      const slDistance = stopLossDistPips * spec.pipSize;
      const tp1Distance = 50 * spec.pipSize;
      const tp2Distance = 100 * spec.pipSize; // Geometric expansion

      let orderResult1, orderResult2;
      
      if (process.env.SIMULATION_MODE === 'true') {
        orderResult1 = { orderId: `SIM_${Date.now()}_TP1` };
        orderResult2 = { orderId: `SIM_${Date.now()}_TP2` };
      } else {
        const connection = await getSharedConnection(rawToken, profile.metaapi_account_id, false);
        if (signal.direction === 'BUY') {
          const slPrice = parseFloat((quote.ask - slDistance).toFixed(5));
          const tp1Price = parseFloat((quote.ask + tp1Distance).toFixed(5));
          const tp2Price = parseFloat((quote.ask + tp2Distance).toFixed(5));
          
          console.log(`[MetaAPI Profile ${profile.id}] BUY TP1 @ ${quote.ask} | SL: ${slPrice} | TP1: ${tp1Price} | Lots: ${halfLotSize}`);
          orderResult1 = await connection.createMarketBuyOrder(brokerSymbol, halfLotSize, slPrice, tp1Price, { clientId: 'AI_SNIPER_TP1' });
          
          console.log(`[MetaAPI Profile ${profile.id}] BUY TP2 @ ${quote.ask} | SL: ${slPrice} | TP2: ${tp2Price} | Lots: ${halfLotSize}`);
          orderResult2 = await connection.createMarketBuyOrder(brokerSymbol, halfLotSize, slPrice, tp2Price, { clientId: 'AI_SNIPER_TP2' });
        } else {
          const slPrice = parseFloat((quote.bid + slDistance).toFixed(5));
          const tp1Price = parseFloat((quote.bid - tp1Distance).toFixed(5));
          const tp2Price = parseFloat((quote.bid - tp2Distance).toFixed(5));
          
          console.log(`[MetaAPI Profile ${profile.id}] SELL TP1 @ ${quote.bid} | SL: ${slPrice} | TP1: ${tp1Price} | Lots: ${halfLotSize}`);
          orderResult1 = await connection.createMarketSellOrder(brokerSymbol, halfLotSize, slPrice, tp1Price, { clientId: 'AI_SNIPER_TP1' });
          
          console.log(`[MetaAPI Profile ${profile.id}] SELL TP2 @ ${quote.bid} | SL: ${slPrice} | TP2: ${tp2Price} | Lots: ${halfLotSize}`);
          orderResult2 = await connection.createMarketSellOrder(brokerSymbol, halfLotSize, slPrice, tp2Price, { clientId: 'AI_SNIPER_TP2' });
        }
      }

      console.log(`[MetaAPI Profile ${profile.id}] ✅ Dual Orders placed: TP1(${orderResult1?.orderId}), TP2(${orderResult2?.orderId})`);

      // 3. Register Trades in Database for botManager tick management
      const botId = 'sniper-system-ai';
      const openTime = Date.now();
      
      const insertTrade = db.prepare(`
        INSERT INTO bot_trade_states
          (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, tp_price,
           lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
      `);

      if (orderResult1?.orderId) {
        insertTrade.run(
          profile.user_id, profile.id, botId, brokerSymbol, signal.direction,
          signal.direction === 'BUY' ? quote.ask : quote.bid, 
          signal.direction === 'BUY' ? (quote.ask - slDistance) : (quote.bid + slDistance), 
          signal.direction === 'BUY' ? (quote.ask + tp1Distance) : (quote.bid - tp1Distance),
          halfLotSize, openTime, orderResult1.orderId, 0,
          signal.direction === 'BUY' ? quote.ask : quote.bid,
          signal.direction === 'BUY' ? quote.ask : quote.bid
        );
      }

      if (orderResult2?.orderId) {
        insertTrade.run(
          profile.user_id, profile.id, botId, brokerSymbol, signal.direction,
          signal.direction === 'BUY' ? quote.ask : quote.bid, 
          signal.direction === 'BUY' ? (quote.ask - slDistance) : (quote.bid + slDistance), 
          signal.direction === 'BUY' ? (quote.ask + tp2Distance) : (quote.bid - tp2Distance),
          halfLotSize, openTime, orderResult2.orderId, 0,
          signal.direction === 'BUY' ? quote.ask : quote.bid,
          signal.direction === 'BUY' ? quote.ask : quote.bid
        );
      }

    } catch (err: any) {
      console.error(`[MetaAPI Profile ${profile.id}] ❌ Trade failed:`, err.message);
      clearSharedConnection(rawToken, profile.metaapi_account_id);
    }
  });

  await Promise.allSettled(promises);
}


export async function getProfileTradeHistory(profileId: number, daysBack: number = 30, resetTimeStr?: string) {
  const profile = db.prepare('SELECT tp.user_id, u.metaapi_token, tp.metaapi_account_id FROM trading_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.id = ?').get(profileId) as any;
  if (!profile || !profile.metaapi_token || !profile.metaapi_account_id) return null;

  try {
    let rawToken = profile.metaapi_token;
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
