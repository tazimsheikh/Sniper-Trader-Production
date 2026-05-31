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
import { getSharedConnection, getSharedAccount, clearSharedConnection, getSharedStreamingConnection } from './metaApiHandler';

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
  source: 'yahoo' | 'metaapi' | 'simulation';

  /** Fetch N days of daily OHLCV candles (used for HOD/LOD/signalDay) */
  getDailyCandles(yahooSymbol: string, brokerSymbol: string, days: number): Promise<OHLCVCandle[]>;

  /** Fetch the last `minutes` 1-minute candles (used for trap detection) */
  getMinuteCandles(yahooSymbol: string, brokerSymbol: string, minutes: number): Promise<OHLCVCandle[]>;

  /** Fetch the last `count` 5-minute candles (used for engine EMAs and Coil Box) */
  get5MinuteCandles(yahooSymbol: string, brokerSymbol: string, count: number): Promise<OHLCVCandle[]>;

  /** Fetch the last `count` 15-minute candles (used for 3-push and BOS detection) */
  get15MinuteCandles(yahooSymbol: string, brokerSymbol: string, count: number): Promise<OHLCVCandle[]>;

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
const yf = new YFClass({ suppressNotices: ['ripHistorical'] });

export const YahooProvider: CandleProvider = {
  source: 'yahoo',

  async getDailyCandles(yahooSymbol, _broker, days) {
    try {
      const period1 = new Date();
      period1.setDate(period1.getDate() - days - 2);
      
      const chart = await yf.chart(yahooSymbol, { 
        interval: '1d', 
        period1: period1.toISOString().split('T')[0],
        period2: new Date().toISOString().split('T')[0]
      });
      const quotes: any[] = chart?.quotes || [];
      if (quotes.length === 0) return [];
      
      return quotes
        .filter((q: any) => q.open !== null && q.close !== null)
        .map((q: any) => ({
          date: new Date(q.date).toISOString().split('T')[0],
          open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume,
        }));
    } catch (e: any) {
      console.warn(`[YahooProvider] Daily candles failed for ${yahooSymbol}:`, e.message);
      return [];
    }
  },

  async getMinuteCandles(yahooSymbol, _broker, minutes) {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 2);
    const chart = await yf.chart(yahooSymbol, { interval: '1m', period1: period1.toISOString().split('T')[0] });
    const all: any[] = chart?.quotes || [];
    const slice = all.slice(-Math.max(minutes + 1, 30)); // always get at least 30
    return slice
      .filter((c: any, i: number, arr: any[]) => c.open && c.close && c.isClosed !== false && (c.isClosed || i < arr.length - 1))
      .map((c: any) => ({
        date: new Date(c.date).toISOString(),
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      }));
  },

  async get5MinuteCandles(yahooSymbol, _broker, count) {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 5);
    const chart = await yf.chart(yahooSymbol, { interval: '5m', period1: period1.toISOString().split('T')[0] });
    const all: any[] = chart?.quotes || [];
    const slice = all.slice(-Math.max(count + 1, 200));
    return slice
      .filter((c: any, i: number, arr: any[]) => c.open && c.close && c.isClosed !== false && (c.isClosed || i < arr.length - 1))
      .map((c: any) => ({
        date: new Date(c.date).toISOString(),
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      }));
  },

  async get15MinuteCandles(yahooSymbol, _broker, count) {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 7);
    const chart = await yf.chart(yahooSymbol, { interval: '15m', period1: period1.toISOString().split('T')[0] });
    const all: any[] = chart?.quotes || [];
    const slice = all.slice(-Math.max(count + 1, 30));
    return slice
      .filter((c: any, i: number, arr: any[]) => c.open && c.close && c.isClosed !== false && (c.isClosed || i < arr.length - 1))
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
    if (!symbols || symbols.length === 0) return [];
    const yahooSymbols = symbols.map(s => s.yahoo).filter(Boolean);
    if (yahooSymbols.length === 0) return [];
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

export let metaApiSyncStatus: 'offline' | 'syncing' | 'connected' = 'offline';

export function getMetaApiSyncStatus() {
  return metaApiSyncStatus;
}

async function getConnection(token: string, accountId: string): Promise<any> {
  try {
    const conn = await getSharedConnection(token, accountId, true);
    metaApiSyncStatus = 'connected';
    return conn;
  } catch (err: any) {
    if (err.message.includes('Fast fail')) {
      metaApiSyncStatus = 'syncing';
    } else {
      metaApiSyncStatus = 'offline';
    }
    throw err;
  }
}

/**
 * MetaAPI timeframe strings accepted by the SDK
 *   PERIOD_M1 | PERIOD_M5 | PERIOD_M15 | PERIOD_H1 | PERIOD_D1
 */
function buildMetaApiProvider(profile: {token: string, accountId: string}): CandleProvider {
  return {
    source: 'metaapi',

    async getDailyCandles(_yahoo, broker, days) {
      try {
        await getConnection(profile.token, profile.accountId);
        const account = await getSharedAccount(profile.token, profile.accountId);
        const candles: any[] = await account.getHistoricalCandles(broker, '1d', undefined, days + 2);
        return candles
          .filter((c: any) => c.open && c.close && c.isClosed !== false)
          .map((c: any) => ({
            date: new Date(c.time).toISOString().split('T')[0],
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.tickVolume,
          }));
      } catch (err: any) {
        console.warn(`[MetaApiProvider] Daily candles failed for ${broker} on account ${profile.accountId}:`, err.message);
        if (err.message.includes('Fast fail')) {
           return YahooProvider.getDailyCandles(_yahoo, broker, days);
        }
        if (err.message.includes('connect') || err.message.includes('disconnect') || err.message.includes('token') || err.message.includes('auth')) {
          clearSharedConnection(profile.token, profile.accountId);
        }
      }
      metaApiSyncStatus = 'offline';
      return YahooProvider.getDailyCandles(_yahoo, broker, days);
    },

    async getMinuteCandles(_yahoo, broker, minutes) {
      try {
        await getConnection(profile.token, profile.accountId);
        const account = await getSharedAccount(profile.token, profile.accountId);
        const candles: any[] = await account.getHistoricalCandles(broker, '1m', undefined, minutes + 10);
        return candles
          .filter((c: any, i: number, arr: any[]) => c.open && c.close && c.isClosed !== false && (c.isClosed || i < arr.length - 1))
          .map((c: any) => ({
            date: new Date(c.time).toISOString(),
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.tickVolume,
          }));
      } catch (err: any) {
        console.warn(`[MetaApiProvider] 1m candles failed for ${broker} on account ${profile.accountId}:`, err.message);
        if (err.message.includes('Fast fail')) {
           return YahooProvider.getMinuteCandles(_yahoo, broker, minutes);
        }
        if (err.message.includes('connect') || err.message.includes('disconnect') || err.message.includes('token') || err.message.includes('auth')) {
          clearSharedConnection(profile.token, profile.accountId);
        }
      }
      metaApiSyncStatus = 'offline';
      return YahooProvider.getMinuteCandles(_yahoo, broker, minutes);
    },

    async get5MinuteCandles(_yahoo, broker, count) {
      try {
        await getConnection(profile.token, profile.accountId);
        const account = await getSharedAccount(profile.token, profile.accountId);
        const candles: any[] = await account.getHistoricalCandles(broker, '5m', undefined, count + 10);
        return candles
          .filter((c: any, i: number, arr: any[]) => c.open && c.close && c.isClosed !== false && (c.isClosed || i < arr.length - 1))
          .map((c: any) => ({
            date: new Date(c.time).toISOString(),
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.tickVolume,
          }));
      } catch (err: any) {
        console.warn(`[MetaApiProvider] 5m candles failed for ${broker} on account ${profile.accountId}:`, err.message);
        if (err.message.includes('Fast fail')) {
           return YahooProvider.get5MinuteCandles(_yahoo, broker, count);
        }
        if (err.message.includes('connect') || err.message.includes('disconnect') || err.message.includes('token') || err.message.includes('auth')) {
          clearSharedConnection(profile.token, profile.accountId);
        }
      }
      metaApiSyncStatus = 'offline';
      return YahooProvider.get5MinuteCandles(_yahoo, broker, count);
    },

    async get15MinuteCandles(_yahoo, broker, count) {
      try {
        await getConnection(profile.token, profile.accountId);
        const account = await getSharedAccount(profile.token, profile.accountId);
        const candles: any[] = await account.getHistoricalCandles(broker, '15m', undefined, count + 10);
        return candles
          .filter((c: any, i: number, arr: any[]) => c.open && c.close && c.isClosed !== false && (c.isClosed || i < arr.length - 1))
          .map((c: any) => ({
            date: new Date(c.time).toISOString(),
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.tickVolume,
          }));
      } catch (err: any) {
        console.warn(`[MetaApiProvider] 15m candles failed for ${broker} on account ${profile.accountId}:`, err.message);
        if (err.message.includes('Fast fail')) {
           return YahooProvider.get15MinuteCandles(_yahoo, broker, count);
        }
        if (err.message.includes('connect') || err.message.includes('disconnect') || err.message.includes('token') || err.message.includes('auth')) {
          clearSharedConnection(profile.token, profile.accountId);
        }
      }
      metaApiSyncStatus = 'offline';
      return YahooProvider.get15MinuteCandles(_yahoo, broker, count);
    },

    async getLiveQuote(_yahoo, broker) {
      try {
        let connection: any;
        try {
          connection = await getSharedStreamingConnection(profile.token, profile.accountId, true);
          metaApiSyncStatus = 'connected';
        } catch (e: any) {
          if (e.message.includes('Fast fail')) {
            metaApiSyncStatus = 'syncing';
          }
          throw e;
        }

        const q = connection.terminalState.price(broker);
        if (q && q.bid && q.ask) {
          return {
            symbol: broker,
            bid: q.bid,
            ask: q.ask,
            price: (q.bid + q.ask) / 2,
            time: q.time ?? new Date(),
          };
        }

        const rpcConn = await getConnection(profile.token, profile.accountId);
        const rpcQ = await rpcConn.getSymbolPrice(broker);
        return {
          symbol: broker,
          bid: rpcQ.bid,
          ask: rpcQ.ask,
          price: (rpcQ.bid + rpcQ.ask) / 2,
          time: rpcQ.time ?? new Date(),
        };
      } catch (err: any) {
        console.warn(`[MetaApiProvider] Live quote failed for ${broker} on account ${profile.accountId}:`, err.message);
        if (err.message.includes('Fast fail')) {
           return YahooProvider.getLiveQuote(_yahoo, broker);
        }
        if (err.message.includes('connect') || err.message.includes('disconnect') || err.message.includes('token') || err.message.includes('auth')) {
          clearSharedConnection(profile.token, profile.accountId);
        }
      }
      metaApiSyncStatus = 'offline';
      return YahooProvider.getLiveQuote(_yahoo, broker);
    },

    async getLiveQuoteBatch(symbols) {
      try {
        await getSharedStreamingConnection(profile.token, profile.accountId, true);
        metaApiSyncStatus = 'connected';

        const results = await Promise.allSettled(
          symbols.map(s => this.getLiveQuote(s.yahoo, s.broker))
        );
        const validQuotes: LiveQuote[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === 'fulfilled') {
            validQuotes.push(r.value);
          } else {
            console.warn(`[MetaApiProvider] Batch quote failed for ${symbols[i].broker}, falling back to Yahoo.`);
            try {
              validQuotes.push(await YahooProvider.getLiveQuote(symbols[i].yahoo, symbols[i].broker));
            } catch (e) {
              // Ignore if Yahoo also fails
            }
          }
        }
        return validQuotes;
      } catch (err: any) {
        if (err.message.includes('Fast fail')) {
          metaApiSyncStatus = 'syncing';
          return YahooProvider.getLiveQuoteBatch(symbols);
        }
      }
      metaApiSyncStatus = 'offline';
      return YahooProvider.getLiveQuoteBatch(symbols);
    },
  };
}

// ── Provider registry & selection ─────────────────────────────────────────────

/**
 * Gets a dedicated CandleProvider for a specific profile.
 * Falls back to Yahoo if the profile is invalid or has no token.
 */
import { SimulationProvider } from './simulationProvider';

let getProviderForProfilePromise: Promise<any> | null = null;
export async function getProviderForProfile(profileId: number): Promise<CandleProvider> {
  if (process.env.SIMULATION_MODE === 'true') {
    return SimulationProvider;
  }

  try {
    const db = (await import('./db')).default;
    const profile = await db.prepare(
      `SELECT u.metaapi_token, u.metaapi_account_id as user_account_id, tp.metaapi_account_id
       FROM trading_profiles tp
       JOIN users u ON u.id = tp.user_id
       WHERE tp.id = ?`
    ).get(profileId) as any;

    const activeAccountId = profile?.metaapi_account_id || profile?.user_account_id;

    if (profile && profile.metaapi_token && activeAccountId && profile.metaapi_token !== 'dummy_token' && activeAccountId !== 'dummy_acc') {
      try {
        const rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
        const rawAccountId = isEncrypted(activeAccountId) ? decrypt(activeAccountId) : activeAccountId;
        return buildMetaApiProvider({ token: rawToken, accountId: rawAccountId });
      } catch {
        // Decryption failed — skip this profile
      }
    }
  } catch (err: any) {
    console.warn(`[CandleProvider] DB lookup failed for profile ${profileId}, defaulting to Yahoo:`, err.message);
  }

  return YahooProvider;
}
