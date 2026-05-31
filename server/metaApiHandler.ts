// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;

import db, { getSessionLosses } from './db';
import { decrypt, isEncrypted } from './crypto.js';
import { broadcastTradeOpened } from './socket.js';
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
  'EURUSD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'GBPUSD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'AUDUSD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'NZDUSD': { pipSize: 0.0001, pipValuePerLot: 10 },
  'USDCAD': { pipSize: 0.0001, pipValuePerLot: 7.3 }, 
  'USDCHF': { pipSize: 0.0001, pipValuePerLot: 11.2 }, 
  'USDJPY': { pipSize: 0.01,   pipValuePerLot: 6.7 }, 
  'GBPJPY': { pipSize: 0.01,   pipValuePerLot: 6.7 },
  'EURJPY': { pipSize: 0.01,   pipValuePerLot: 6.7 },
  'AUDJPY': { pipSize: 0.01,   pipValuePerLot: 6.7 },
  'CHFJPY': { pipSize: 0.01,   pipValuePerLot: 6.7 },
  'EURAUD': { pipSize: 0.0001, pipValuePerLot: 6.5 },
  'EURCAD': { pipSize: 0.0001, pipValuePerLot: 7.3 },
  'EURCHF': { pipSize: 0.0001, pipValuePerLot: 11.2 },
  'EURNZD': { pipSize: 0.0001, pipValuePerLot: 6.1 },
  'GBPAUD': { pipSize: 0.0001, pipValuePerLot: 6.5 },
  'GBPCAD': { pipSize: 0.0001, pipValuePerLot: 7.3 },
  'GBPCHF': { pipSize: 0.0001, pipValuePerLot: 11.2 },
  'GBPNZD': { pipSize: 0.0001, pipValuePerLot: 6.1 },
  'EURGBP': { pipSize: 0.0001, pipValuePerLot: 12.7 },
  'AUDCHF': { pipSize: 0.0001, pipValuePerLot: 11.2 },
  'AUDCAD': { pipSize: 0.0001, pipValuePerLot: 7.3 },
  'XAUUSD': { pipSize: 0.01,   pipValuePerLot: 10 },
  'NAS100': { pipSize: 1,      pipValuePerLot: 1 },
  'USTEC':  { pipSize: 1,      pipValuePerLot: 1 },
  'XTIUSD': { pipSize: 0.01,   pipValuePerLot: 10 },
};
const DEFAULT_SPEC: SymbolSpec = { pipSize: 0.0001, pipValuePerLot: 10 };

export function getSymbolSpec(brokerSymbol: string): SymbolSpec {
  const spec = SYMBOL_SPECS[brokerSymbol];
  if (!spec) {
    throw new Error(`CRITICAL: Unrecognized broker symbol '${brokerSymbol}'. Refusing to trade to prevent lot-sizing fallback catastrophe.`);
  }
  return spec;
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

export function clearApiCacheForToken(token: string) {
  const cacheKey = createHash('sha256').update(token).digest('hex');
  if (apiCache.has(cacheKey)) {
    apiCache.delete(cacheKey);
    console.log(`[MetaAPI] Cleared SDK instance from cache for updated token.`);
  }
  // Clear connection caches completely to force full reconnects
  connectionCache.clear();
  accountCache.clear();
  streamingConnectionCache.clear();
  console.log(`[MetaAPI] Cleared all connection caches due to token update.`);
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
    accountPromise.catch(() => {});
    
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
    accountPromise.catch(() => {});
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

export function getMetaApiConnectionState(token: string, accountId: string): 'offline' | 'syncing' | 'connected' {
  if (!token || !accountId) return 'offline';
  accountId = safeDecryptAccountId(accountId);
  const key = createHash('sha256').update(token + accountId).digest('hex');
  if (connectionCache.has(key)) return 'connected';
  if (isConnecting.has(key)) return 'syncing';
  return 'offline';
}

export async function getSharedConnection(token: string, accountId: string, background = false): Promise<any> {
  accountId = safeDecryptAccountId(accountId);
  const key = createHash('sha256').update(token + accountId).digest('hex');
  
  if (connectionCache.has(key)) {
    const cached = connectionCache.get(key);
    try {
      const waitPromise = cached.waitSynchronized();
      waitPromise.catch(() => {});
      await Promise.race([
        waitPromise,
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
          } else {
            // Force deploy to wake up sleeping instances just in case
            account.deploy().catch(() => {});
            await account.waitConnected();
          }
          const connection = account.getRPCConnection();
          await connection.connect();
          
          const waitPromise = connection.waitSynchronized();
          waitPromise.catch(() => {});
          await Promise.race([
            waitPromise,
            new Promise((_, r) => setTimeout(() => r(new Error('180s timeout')), 180000))
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

export function clearAllSharedConnections() {
  console.log(`[MetaAPI] 🧹 Sweeping and closing ALL shared connections due to global token update...`);
  
  for (const conn of connectionCache.values()) {
    try { if (typeof conn.close === 'function') conn.close(); } catch(e) {}
  }
  for (const conn of streamingConnectionCache.values()) {
    try { if (typeof conn.close === 'function') conn.close(); } catch(e) {}
  }

  connectionCache.clear();
  streamingConnectionCache.clear();
  accountCache.clear();
  isConnecting.clear();
  isStreamingConnecting.clear();
  console.log(`[MetaAPI] 🧹 Sweep complete. Caches cleared.`);
}

const streamingConnectionCache = new Map<string, any>();
const isStreamingConnecting = new Set<string>();

const ALL_BROKER_SYMBOLS = [
  'GBPJPY', 'AUDJPY', 'CHFJPY', 'GBPCAD',
  'GBPUSD', 'EURCAD', 'EURAUD', 'EURUSD', 'EURJPY',
  'GBPCHF', 'USDJPY', 'AUDUSD', 'EURCHF',
  'GBPAUD', 'USDCHF', 'USDCAD', 'NZDUSD'
];

export async function getSharedStreamingConnection(token: string, accountId: string, background = false): Promise<any> {
  accountId = safeDecryptAccountId(accountId);
  const key = createHash('sha256').update(token + accountId).digest('hex');
  
  if (streamingConnectionCache.has(key)) {
    const cached = streamingConnectionCache.get(key);
    try {
      const waitPromise = cached.waitSynchronized();
      waitPromise.catch(() => {});
      await Promise.race([
        waitPromise,
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
          } else {
            // Force deploy to wake up sleeping instances
            account.deploy().catch(() => {});
            await account.waitConnected();
          }
          const connection = account.getStreamingConnection();
          await connection.connect();
          const waitPromise = connection.waitSynchronized();
          waitPromise.catch(() => {});
          await Promise.race([
            waitPromise,
            new Promise((_, r) => setTimeout(() => r(new Error('180s timeout')), 180000))
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
  const profile = await db.prepare(
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
    const losses = await getSessionLosses(profile.id, brokerSymbol, signal.timingGate);
    if (losses >= 1) {
      console.warn(`[MetaAPI Profile ${profile.id}] Lockout active for ${brokerSymbol}. Max losses reached for session ${signal.timingGate}. Skipping trade.`);
      return;
    }

    // ── FIX: Guard null token ─────────────────────────────────────────────
    if (!profile.metaapi_token || !profile.metaapi_account_id) {
      console.warn(`[MetaAPI Profile ${profile.id}] No token or account ID configured — skipping.`);
      return;
    }

    // ── FIX: Decrypt token before use and validate no dummy values ──
    try {
      rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
      const decryptedAccountId = isEncrypted(profile.metaapi_account_id) ? decrypt(profile.metaapi_account_id) : profile.metaapi_account_id;
      if (rawToken === 'dummy_token' || decryptedAccountId === 'dummy_acc') {
        return; // Silently skip profiles that have not fully connected yet
      }
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
    if (stopLossDistPips <= 0) {
      throw new Error(`CRITICAL: Stop Loss distance is ${stopLossDistPips}. Aborting trade to prevent Infinity Lot Size bug.`);
    }
    if (!balance || isNaN(balance) || balance <= 0) {
      throw new Error(`CRITICAL: Invalid account balance (${balance}). Aborting trade.`);
    }

    const chosenRiskPct = forceRiskPct || (profile.risk_multiplier > 0 ? profile.risk_multiplier : 5);
    const riskAmount = balance * (chosenRiskPct / 100);

    // ── DYNAMIC LOT SIZING CALCULATION ──
    let dynamicPipValuePerLot = spec.pipValuePerLot; // Fallback to hardcoded
    try {
      if (process.env.SIMULATION_MODE !== 'true') {
        const connection = await getSharedConnection(rawToken, profile.metaapi_account_id, false);
        const metaSpec = await connection.getSymbolSpecification(brokerSymbol);
        if (metaSpec && metaSpec.tickSize && metaSpec.tickValue) {
           // Calculate the exact account currency value of 1 full PIP for 1.0 standard Lot
           const ticksPerPip = spec.pipSize / metaSpec.tickSize;
           dynamicPipValuePerLot = ticksPerPip * metaSpec.tickValue;
           console.log(`[MetaAPI] ${brokerSymbol} Dynamic Pip Value: $${dynamicPipValuePerLot.toFixed(2)} (TickSize: ${metaSpec.tickSize}, TickValue: ${metaSpec.tickValue})`);
        }
      }
    } catch(e: any) {
      console.warn(`[MetaAPI] Failed to fetch dynamic symbol spec for ${brokerSymbol}, falling back to hardcoded pipValue: ${spec.pipValuePerLot}`);
    }

    const lotSize = (riskAmount / stopLossDistPips) / dynamicPipValuePerLot;

    if (isNaN(lotSize) || !isFinite(lotSize)) {
      throw new Error(`CRITICAL: Lot size calculation resulted in ${lotSize}. Aborting trade.`);
    }

    // Dual Trade Logic (TP1 & TP2)
    const halfLotSize = quantizeLots(lotSize / 2);
    if (halfLotSize < 0.01) {
       console.warn(`[MetaAPI Profile ${profile.id}] Lot size too small for dual trades (${lotSize}). Skipping.`);
       return;
    }

    const slDistance = stopLossDistPips * spec.pipSize;
    const tp1Distance = (takeProfitDistPips * 0.5) * spec.pipSize;
    const tp2Distance = takeProfitDistPips * spec.pipSize; // Full TP

    let orderResult1, orderResult2;
    
    const authorizingBot = activeBots.find(b => b.includes(lowerBrokerSymbol)) || 'sniper-system-ai';
    const botId = authorizingBot;
    const openTime = Date.now();

    // DB-first write to prevent orphaned broker trades on crash
    const insertTrade = await db.prepare(`
      INSERT INTO bot_trade_states
        (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, tp_price,
         lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'OPEN')
    `);

    let entryPrice = signal.direction === 'BUY' ? quote.ask : quote.bid;
    let slPrice = signal.direction === 'BUY' ? (entryPrice - slDistance) : (entryPrice + slDistance);
    let tp1Price = signal.direction === 'BUY' ? (entryPrice + tp1Distance) : (entryPrice - tp1Distance);
    let tp2Price = signal.direction === 'BUY' ? (entryPrice + tp2Distance) : (entryPrice - tp2Distance);

    slPrice = parseFloat(slPrice.toFixed(5));
    tp1Price = parseFloat(tp1Price.toFixed(5));
    tp2Price = parseFloat(tp2Price.toFixed(5));

    const tp1DbId = (await insertTrade.run(profile.user_id, profile.id, botId, brokerSymbol, signal.direction, entryPrice, slPrice, tp1Price, halfLotSize, openTime, 'PENDING_TP1', entryPrice, entryPrice)).lastInsertRowid;
    const tp2DbId = (await insertTrade.run(profile.user_id, profile.id, botId, brokerSymbol, signal.direction, entryPrice, slPrice, tp2Price, halfLotSize, openTime, 'PENDING_TP2', entryPrice, entryPrice)).lastInsertRowid;

    try {
      if (process.env.SIMULATION_MODE === 'true') {
        orderResult1 = { orderId: `SIM_${Date.now()}_TP1` };
        orderResult2 = { orderId: `SIM_${Date.now()}_TP2` };
      } else {
        const connection = await getSharedConnection(rawToken, profile.metaapi_account_id, false);
        if (signal.direction === 'BUY') {
          console.log(`[MetaAPI Profile ${profile.id}] BUY TP1 @ ${quote.ask} | SL: ${slPrice} | TP1: ${tp1Price} | Lots: ${halfLotSize}`);
          try {
            orderResult1 = await connection.createMarketBuyOrder(brokerSymbol, halfLotSize, slPrice, tp1Price);
            if (orderResult1?.orderId) {
                await db.prepare(`UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`).run(orderResult1.orderId, tp1DbId);
                broadcastTradeOpened(profile.id, { botId, brokerSymbol, direction: signal.direction, orderId: orderResult1.orderId, type: 'TP1' });
            }
          } catch (e1: any) {
            throw new Error(`TP1 Execution Failed: ${e1.message}`);
          }
          
          console.log(`[MetaAPI Profile ${profile.id}] BUY TP2 @ ${quote.ask} | SL: ${slPrice} | TP2: ${tp2Price} | Lots: ${halfLotSize}`);
          try {
            orderResult2 = await connection.createMarketBuyOrder(brokerSymbol, halfLotSize, slPrice, tp2Price);
            if (orderResult2?.orderId) {
                await db.prepare(`UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`).run(orderResult2.orderId, tp2DbId);
                broadcastTradeOpened(profile.id, { botId, brokerSymbol, direction: signal.direction, orderId: orderResult2.orderId, type: 'TP2' });
            }
          } catch (e2: any) {
            console.error(`[MetaAPI Profile ${profile.id}] ⚠️ TP2 Failed! TP1 succeeded. We will retain TP1 so the trade engine can manage it safely.`);
            throw new Error(`TP2 Execution Failed (TP1 retained): ${e2.message}`);
          }
        } else {
          console.log(`[MetaAPI Profile ${profile.id}] SELL TP1 @ ${quote.bid} | SL: ${slPrice} | TP1: ${tp1Price} | Lots: ${halfLotSize}`);
          try {
            orderResult1 = await connection.createMarketSellOrder(brokerSymbol, halfLotSize, slPrice, tp1Price);
            if (orderResult1?.orderId) {
                await db.prepare(`UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`).run(orderResult1.orderId, tp1DbId);
                broadcastTradeOpened(profile.id, { botId, brokerSymbol, direction: signal.direction, orderId: orderResult1.orderId, type: 'TP1' });
            }
          } catch (e1: any) {
            throw new Error(`TP1 Execution Failed: ${e1.message}`);
          }
          
          console.log(`[MetaAPI Profile ${profile.id}] SELL TP2 @ ${quote.bid} | SL: ${slPrice} | TP2: ${tp2Price} | Lots: ${halfLotSize}`);
          try {
            orderResult2 = await connection.createMarketSellOrder(brokerSymbol, halfLotSize, slPrice, tp2Price);
            if (orderResult2?.orderId) {
                await db.prepare(`UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`).run(orderResult2.orderId, tp2DbId);
                broadcastTradeOpened(profile.id, { botId, brokerSymbol, direction: signal.direction, orderId: orderResult2.orderId, type: 'TP2' });
            }
          } catch (e2: any) {
            console.error(`[MetaAPI Profile ${profile.id}] ⚠️ TP2 Failed! TP1 succeeded. We will retain TP1 so the trade engine can manage it safely.`);
            throw new Error(`TP2 Execution Failed (TP1 retained): ${e2.message}`);
          }
        }
      }

      console.log(`[MetaAPI Profile ${profile.id}] ✅ Dual Orders placed: TP1(${orderResult1?.orderId}), TP2(${orderResult2?.orderId})`);

    } catch (err: any) {
      // ONLY delete from DB if they do not have an order ID (they failed to reach MetaAPI)
      if (!orderResult1?.orderId) await db.prepare(`DELETE FROM bot_trade_states WHERE id = ?`).run(tp1DbId);
      if (!orderResult2?.orderId) await db.prepare(`DELETE FROM bot_trade_states WHERE id = ?`).run(tp2DbId);
      throw err;
    }
  } catch (err: any) {
    console.error(`[MetaAPI Profile ${profile.id}] ❌ Trade failed:`, err.message);
    if (rawToken) clearSharedConnection(rawToken, profile.metaapi_account_id);
  }
}


export async function getProfileTradeHistory(profileId: number, daysBack: number = 30, resetTimeStr?: string) {
  const profile = await db.prepare('SELECT tp.user_id, u.metaapi_token, tp.metaapi_account_id FROM trading_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.id = ?').get(profileId) as any;
  if (!profile || !profile.metaapi_token || !profile.metaapi_account_id) return null;

  let rawToken = profile.metaapi_token;
  try {
    try {
      rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
    } catch(e) {}
    
    // Fast fail connection wait (increase race timeout to 5s to be safe)
    const connPromise = getSharedConnection(rawToken, profile.metaapi_account_id, false);
    connPromise.catch(() => {});
    const connection = await Promise.race([
      connPromise,
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
