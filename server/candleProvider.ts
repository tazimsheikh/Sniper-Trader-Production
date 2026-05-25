/**
 * candleProvider.ts
 *
 * Abstraction layer for market data.  Two implementations:
 *   • YahooProvider  — free, no auth, used for anonymous users & fallback
 *   • MetaApiProvider — broker-direct data once a user authenticates
 *
 * The rest of the engine (marketStore.ts) calls getCandleProvider() and
 * receives a unified interface regardless of which source is active.
 */

// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;

import yahooFinance2 from 'yahoo-finance2';
import { createHash } from 'crypto';
import db from './db';
import { decrypt, isEncrypted } from './crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OHLCVCandle {
  date: string;   // ISO-8601 date string "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface LiveQuote {
  symbol: string;       // Broker symbol e.g. "EURUSD"
  bid: number;
  ask: number;
  price: number;        // mid / regularMarketPrice
  time: Date;
}

export interface CandleProvider {
  /** Source identifier shown in UI */
  source: 'yahoo' | 'metaapi';

  /** Fetch N days of daily OHLCV candles (used for HOD/LOD/signalDay) */
  getDailyCandles(yahooSymbol: string, brokerSymbol: string, days: number): Promise<OHLCVCandle[]>;

  /** Fetch the last `minutes` 1-minute candles (used for trap detection) */
  getMinuteCandles(yahooSymbol: string, brokerSymbol: string, minutes: number): Promise<OHLCVCandle[]>;

  /** Get live bid/ask for a single symbol */
  getLiveQuote(yahooSymbol: string, brokerSymbol: string): Promise<LiveQuote>;

  /** Get live bid/ask for a batch of symbols (efficient) */
  getLiveQuoteBatch(symbols: Array<{ yahoo: string; broker: string }>): Promise<LiveQuote[]>;
}

// ── Yahoo symbol → broker symbol map (mirrors metaApiHandler.ts) ──────────────
const BROKER_SYMBOL_MAP: Record<string, string> = {
  'GC=F':     'XAUUSD',
  'NQ=F':     'USTEC',
  'CL=F':     'XTIUSD',
  'EURUSD=X': 'EURUSD',
  'GBPUSD=X': 'GBPUSD',
  'USDJPY=X': 'USDJPY',
  'AUDUSD=X': 'AUDUSD',
  'USDCAD=X': 'USDCAD',
  'NZDUSD=X': 'NZDUSD',
  'USDCHF=X': 'USDCHF',
  'GBPJPY=X': 'GBPJPY',
  'EURGBP=X': 'EURGBP',
  'EURJPY=X': 'EURJPY',
  'AUDJPY=X': 'AUDJPY',
  'EURAUD=X': 'EURAUD',
  'GBPAUD=X': 'GBPAUD',
  'CHFJPY=X': 'CHFJPY',
  'AUDCAD=X': 'AUDCAD',
  'EURCAD=X': 'EURCAD',
  'NZDJPY=X': 'NZDJPY',
  'GBPCAD=X': 'GBPCAD',
};

export function toBrokerSymbol(yahooSymbol: string): string {
  return BROKER_SYMBOL_MAP[yahooSymbol] ?? yahooSymbol.replace('=X', '').replace('=F', '');
}

// ── Yahoo Finance Provider ────────────────────────────────────────────────────

const YFClass = typeof yahooFinance2 === 'function' ? yahooFinance2 : (yahooFinance2 as any).default;
const yf = new YFClass();

export const YahooProvider: CandleProvider = {
  source: 'yahoo',

  async getDailyCandles(yahooSymbol, _broker, days) {
    const period1 = new Date();
    period1.setDate(period1.getDate() - days);
    const quotes = await yf.historical(yahooSymbol, {
      period1: period1.toISOString().split('T')[0],
      period2: new Date().toISOString().split('T')[0],
      interval: '1d',
    });
    if (!quotes || quotes.length === 0) return [];
    return quotes.map((q: any) => ({
      date: new Date(q.date).toISOString().split('T')[0],
      open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume,
    }));
  },

  async getMinuteCandles(yahooSymbol, _broker, minutes) {
    const chart = await yf.chart(yahooSymbol, { interval: '1m', range: '1d' });
    const all: any[] = chart?.quotes || [];
    const slice = all.slice(-Math.max(minutes + 1, 30)); // always get at least 30
    return slice
      .filter((c: any) => c.open && c.close)
      .map((c: any) => ({
        date: new Date(c.date).toISOString(),
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      }));
  },

  async getLiveQuote(yahooSymbol, _broker) {
    const q = await yf.quote(yahooSymbol) as any;
    const price = q.regularMarketPrice ?? 0;
    return {
      symbol: yahooSymbol,
      bid: q.bid ?? price,
      ask: q.ask ?? price,
      price,
      time: new Date(),
    };
  },

  async getLiveQuoteBatch(symbols) {
    const yahooSymbols = symbols.map(s => s.yahoo);
    const quotes = await yf.quote(yahooSymbols) as any;
    const arr: any[] = Array.isArray(quotes) ? quotes : [quotes];
    return arr
      .filter(Boolean)
      .map((q: any) => {
        const price = q.regularMarketPrice ?? 0;
        return {
          symbol: q.symbol,
          bid: q.bid ?? price,
          ask: q.ask ?? price,
          price,
          time: new Date(),
        };
      });
  },
};

// ── MetaAPI Provider ──────────────────────────────────────────────────────────

/** Per-token MetaAPI SDK instance cache (keyed by SHA-256 hash) */
const apiCache = new Map<string, any>();
const connectionCache = new Map<string, any>();

function getApiInstance(token: string): any {
  const key = createHash('sha256').update(token).digest('hex');
  if (!apiCache.has(key)) apiCache.set(key, new MetaApi(token));
  return apiCache.get(key);
}

const SYNC_TIMEOUT_MS = 30_000;

async function getConnection(token: string, accountId: string): Promise<any> {
  const key = createHash('sha256').update(token + accountId).digest('hex');
  if (connectionCache.has(key)) {
    const cached = connectionCache.get(key);
    // Return cached if it appears healthy
    try {
      await Promise.race([
        cached.waitSynchronized(),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5_000)),
      ]);
      return cached;
    } catch {
      connectionCache.delete(key); // Stale — reconnect
    }
  }

  const api = getApiInstance(token);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  if (account.state !== 'DEPLOYED') {
    await account.deploy();
    await account.waitConnected();
  }
  const connection = account.getRPCConnection();
  await connection.connect();
  await Promise.race([
    connection.waitSynchronized(),
    new Promise((_, r) =>
      setTimeout(() => r(new Error(`Sync timeout after ${SYNC_TIMEOUT_MS / 1000}s`)), SYNC_TIMEOUT_MS)
    ),
  ]);

  connectionCache.set(key, connection);
  return connection;
}

/**
 * MetaAPI timeframe strings accepted by the SDK
 *   PERIOD_M1 | PERIOD_M5 | PERIOD_M15 | PERIOD_H1 | PERIOD_D1
 */
function buildMetaApiProvider(token: string, accountId: string): CandleProvider {
  return {
    source: 'metaapi',

    async getDailyCandles(_yahoo, broker, days) {
      try {
        const connection = await getConnection(token, accountId);
        const startTime = new Date();
        startTime.setDate(startTime.getDate() - days);
        const candles: any[] = await connection.getHistoricalCandles(broker, 'PERIOD_D1', startTime, days + 2);
        return candles
          .filter((c: any) => c.open && c.close)
          .map((c: any) => ({
            date: new Date(c.time).toISOString().split('T')[0],
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.tickVolume,
          }));
      } catch (err: any) {
        console.warn(`[MetaApiProvider] Daily candles failed for ${broker}, falling back to Yahoo:`, err.message);
        return YahooProvider.getDailyCandles(_yahoo, broker, days);
      }
    },

    async getMinuteCandles(_yahoo, broker, minutes) {
      try {
        const connection = await getConnection(token, accountId);
        const startTime = new Date();
        startTime.setMinutes(startTime.getMinutes() - minutes - 5);
        const candles: any[] = await connection.getHistoricalCandles(broker, 'PERIOD_M1', startTime, minutes + 10);
        return candles
          .filter((c: any) => c.open && c.close)
          .map((c: any) => ({
            date: new Date(c.time).toISOString(),
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.tickVolume,
          }));
      } catch (err: any) {
        console.warn(`[MetaApiProvider] Minute candles failed for ${broker}, falling back to Yahoo:`, err.message);
        return YahooProvider.getMinuteCandles(_yahoo, broker, minutes);
      }
    },

    async getLiveQuote(_yahoo, broker) {
      try {
        const connection = await getConnection(token, accountId);
        const q = await connection.getSymbolPrice(broker);
        return {
          symbol: broker,
          bid: q.bid,
          ask: q.ask,
          price: (q.bid + q.ask) / 2,
          time: q.time ?? new Date(),
        };
      } catch (err: any) {
        console.warn(`[MetaApiProvider] Live quote failed for ${broker}, falling back to Yahoo:`, err.message);
        return YahooProvider.getLiveQuote(_yahoo, broker);
      }
    },

    async getLiveQuoteBatch(symbols) {
      // MetaAPI doesn't have a native batch endpoint; fan out in parallel then fall back per symbol
      const results = await Promise.allSettled(
        symbols.map(s => this.getLiveQuote(s.yahoo, s.broker))
      );
      return results
        .filter((r): r is PromiseFulfilledResult<LiveQuote> => r.status === 'fulfilled')
        .map(r => r.value);
    },
  };
}

// ── Provider registry & selection ─────────────────────────────────────────────

/**
 * Returns the best available CandleProvider for the global engine.
 *
 * Strategy: if ANY user has a valid MetaAPI token + account ID, use their
 * credentials for the shared market-data feed (the data itself is public
 * pricing, not account-specific). Falls back to Yahoo if no user is configured.
 *
 * This is called once at startup and again if user credentials change.
 */
export function getGlobalCandleProvider(): CandleProvider {
  try {
    const user = db.prepare(
      `SELECT metaapi_token, metaapi_account_id
       FROM users
       WHERE automation_active = 1
         AND metaapi_token IS NOT NULL
         AND metaapi_account_id IS NOT NULL
       LIMIT 1`
    ).get() as any;

    if (user?.metaapi_token && user?.metaapi_account_id) {
      let rawToken: string;
      try {
        rawToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
      } catch {
        return YahooProvider; // Decryption failed — fall back
      }
      console.log('[CandleProvider] ✅ MetaAPI data source selected (authenticated user found).');
      return buildMetaApiProvider(rawToken, user.metaapi_account_id);
    }
  } catch (err: any) {
    console.warn('[CandleProvider] DB lookup failed, defaulting to Yahoo:', err.message);
  }

  console.log('[CandleProvider] 📡 Yahoo Finance data source selected (no authenticated user).');
  return YahooProvider;
}

/**
 * Exported singleton — refreshed by marketStore on each full re-init cycle.
 * marketStore.ts calls refreshGlobalProvider() after user settings change.
 */
let _globalProvider: CandleProvider = YahooProvider;

export function refreshGlobalProvider(): CandleProvider {
  _globalProvider = getGlobalCandleProvider();
  return _globalProvider;
}

export function globalProvider(): CandleProvider {
  return _globalProvider;
}
