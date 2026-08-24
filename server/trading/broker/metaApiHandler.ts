// @ts-ignore
import MetaApiPkg from "metaapi.cloud-sdk/esm-node";
const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;

import db, { getSessionLosses, addBotLog } from "../../core/db.js";
import { decrypt, isEncrypted } from "../../core/crypto.js";
import { broadcastTradeOpened } from "../../core/socket.js";
import { TrapSignal } from "../config/types.js";
// import { SimulationProvider } from './simulationProvider';
import { isNewsBlackout } from "../../news/newsStore.js";

// --- MetaApi Log Suppressor ---
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

let lastDropLoggedAt = 0;

function isMetaApiNoise(msg: string): boolean {
  return (
    msg.includes("clientStickySocket") ||
    msg.includes("scheduling process connection") ||
    msg.includes("canceling process connection") ||
    msg.includes("reconnecting socket") ||
    msg.includes("Connecting MetaApi websocket client") ||
    msg.includes("agiliumtrade.ai") ||
    msg.includes("xhr poll error") ||
    msg.includes("failed to connect Error") ||
    msg.includes("MetaApi websocket client closed") ||
    msg.includes("Transport.onError") ||
    msg.includes("TransportError") ||
    msg.includes("metaapi.cloud-sdk") ||
    msg.includes("backup-new-york") ||
    /^\s*at\s+/.test(msg)
  );
}

console.log = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? (a.stack || a.message) : String(a))).join(" ");
  if (isMetaApiNoise(msg)) {
    return;
  }
  originalConsoleLog(...args);
};

console.error = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? (a.stack || a.message) : String(a))).join(" ");
  if (isMetaApiNoise(msg)) {
    // Rate-limit the 1-liner so it doesn't log every 500ms during rapid retries
    const now = Date.now();
    if (now - lastDropLoggedAt > 15000) {
      lastDropLoggedAt = now;
      originalConsoleError(`[MetaAPI] ⚠️ Connection dropped (xhr poll error). Reconnecting in background...`);
    }
    return;
  }
  originalConsoleError(...args);
};
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;
const originalStderrWrite = process.stderr.write.bind(process.stderr);
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

console.warn = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? (a.stack || a.message) : String(a))).join(" ");
  if (isMetaApiNoise(msg)) return;
  originalConsoleWarn(...args);
};
console.info = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? (a.stack || a.message) : String(a))).join(" ");
  if (isMetaApiNoise(msg)) return;
  originalConsoleInfo(...args);
};
console.debug = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? (a.stack || a.message) : String(a))).join(" ");
  if (isMetaApiNoise(msg)) return;
  originalConsoleDebug(...args);
};

(process.stderr as any).write = function(chunk: any, encoding?: any, cb?: any) {
  const msg = chunk ? chunk.toString() : "";
  if (isMetaApiNoise(msg)) {
    const now = Date.now();
    if (now - lastDropLoggedAt > 15000) {
      lastDropLoggedAt = now;
      originalConsoleError(`[MetaAPI] ⚠️ Connection dropped (xhr poll error). Reconnecting in background...`);
    }
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  }
  return originalStderrWrite(chunk, encoding, cb);
};

(process.stdout as any).write = function(chunk: any, encoding?: any, cb?: any) {
  const msg = chunk ? chunk.toString() : "";
  if (isMetaApiNoise(msg)) {
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  }
  return originalStdoutWrite(chunk, encoding, cb);
};
// ------------------------------

const SimulationProvider = {
  getLiveQuote: async (symbol: string, brokerSymbol: string) => {
    return { bid: 1.0, ask: 1.0, time: new Date() };
  },
  getSymbolPrice: async (sym: string) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.getSymbolPrice(sym) || {
      bid: 100,
      ask: 100,
    },
  getAccountInformation: async () =>
    (global as any).__SIM_MOCK_ACCOUNT__?.getAccountInformation() || {
      balance: 100000,
      equity: 100000,
      margin: 0,
      freeMargin: 100000,
    },
  getSymbolSpecification: async (sym: string) => {
    return {
      tickSize: 0.00001,
      tickValue: 1,
      contractSize: 100000,
      minVolume: 0.01,
      maxVolume: 100,
      volumeStep: 0.01
    };
  },
  modifyPosition: async (id: string, arg2: any, arg3?: any) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.modifyPosition(
      id,
      typeof arg2 === "object" ? arg2.stopLoss : arg2,
      typeof arg2 === "object" ? arg2.takeProfit : arg3,
    ),
  closePosition: async (id: string) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.closePosition(id),
  closePositionPartially: async (id: string, vol: number) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.closePositionPartially(id, vol, {}),
  createMarketBuyOrder: async (sym: string, lots: number, sl: number, tp: number) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.createMarketBuyOrder(sym, lots, sl, tp),
  createMarketSellOrder: async (sym: string, lots: number, sl: number, tp: number) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.createMarketSellOrder(sym, lots, sl, tp),
  createLimitBuyOrder: async (sym: string, lots: number, price: number, sl: number, tp: number) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.createLimitBuyOrder(sym, lots, price, sl, tp),
  createLimitSellOrder: async (sym: string, lots: number, price: number, sl: number, tp: number) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.createLimitSellOrder(sym, lots, price, sl, tp),
  createStopBuyOrder: async (sym: string, lots: number, price: number, sl: number, tp: number, opts?: any) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.createStopBuyOrder(sym, lots, price, sl, tp, opts),
  createStopSellOrder: async (sym: string, lots: number, price: number, sl: number, tp: number, opts?: any) =>
    (global as any).__SIM_MOCK_ACCOUNT__?.createStopSellOrder(sym, lots, price, sl, tp, opts),
  createLimitOrder: async (
    _accId: string,
    sym: string,
    type: string,
    lots: number,
    price: number,
    opts: { stopLoss: number; takeProfit: number; clientId?: string; botId?: string },
  ) => {
    console.log(`[SimulationProvider] createLimitOrder received opts:`, opts);
    if (type === "ORDER_TYPE_BUY_LIMIT") {
      return (global as any).__SIM_MOCK_ACCOUNT__?.createLimitBuyOrder(
        sym,
        lots,
        price,
        opts.stopLoss,
        opts.takeProfit,
        { clientId: opts.clientId }
      );
    } else {
      return (global as any).__SIM_MOCK_ACCOUNT__?.createLimitSellOrder(
        sym,
        lots,
        price,
        opts.stopLoss,
        opts.takeProfit,
        { clientId: opts.clientId }
      );
    }
  },
  getPositions: async () => [],
};

// ── Broker symbol map ─────────────────────────────────────────────────────────
export const BROKER_SYMBOL_MAP: Record<string, string> = {
  // Legacy
  "GC=F": "XAUUSD",
  "NQ=F": "USTEC",
  "CL=F": "XTIUSD",
  "EURUSD=X": "EURUSD",
  "GBPUSD=X": "GBPUSD",
  "USDJPY=X": "USDJPY",
  "AUDUSD=X": "AUDUSD",
  "USDCAD=X": "USDCAD",
  "GBPJPY=X": "GBPJPY",
  // The 5ers Indices Mapping
  "NAS100.Daily": "NAS100",
  "GER40.Daily": "GER40",
  "US30.Daily": "US30",

  "JPN225.Daily": "JPN225",
  "BTCUSD.Daily": "BTCUSD",
  "ETHUSD.Daily": "ETHUSD",
  "SPX500.Daily": "SPX500",
  "DAX40": "GER40",
  "US500": "SPX500",
};

// ── Pip specification (single source of truth — must match marketStore.ts ASSET_MAP) ──
interface SymbolSpec {
  pipSize: number;            // Price units per 1 pip
  pipValuePerLot: number;     // USD per pip for 1.0 standard lot
  digits: number;             // Broker price decimal places (used for toFixed() on ALL MetaApi price fields)
  tickSize?: number;
}

import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";

// ── Dynamic broker spec cache ────────────────────────────────────────────────────────────
// Caches live broker contractSize/tickSize/tickValue to avoid repeated API calls
// Key: `${token_hash}:${brokerSymbol}`
const liveSpecCache = new Map<
  string,
  {
    pipValuePerLot: number;
    tickSize: number;
    contractSize: number;
    minVolume: number;
    maxVolume: number;
    volumeStep: number;
    digits: number;
    fetchedAt: number;
  }
>();
const SPEC_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function getFallbackPipValue(brokerSymbol: string): number {
  const cleanSymbol = brokerSymbol.replace(".Daily", "").toUpperCase();
  
  // Indices & Crypto: GER40, DAX40, DE40, UK100, SPX500, NAS100, US30, BTC, ETH
  if (cleanSymbol.includes('GER40') || cleanSymbol.includes('DAX40') || cleanSymbol.includes('DE40') || cleanSymbol.includes('UK100') || cleanSymbol.includes('SPX500') || cleanSymbol.includes('BTC') || cleanSymbol.includes('ETH') || cleanSymbol.includes('NAS') || cleanSymbol.includes('US30')) {
    return 1.0;
  }
  // Asian Index (JPN225 = ~0.70 USD per point)
  if (cleanSymbol.includes('JPN225')) {
    return 0.70;
  }

  // Commodities (XAUUSD Gold, XTIUSD Crude Oil = $10.00 per 1.0 lot per pip)
  if (cleanSymbol.includes('XAU') || cleanSymbol.includes('XTI')) {
    return 10.0;
  }

  // Forex JPY / Minor Crosses
  if (cleanSymbol.includes('JPY') || cleanSymbol.includes('AUD') || cleanSymbol.includes('NZD') || cleanSymbol.includes('CAD') || cleanSymbol.includes('CHF')) {
    return 6.5;
  }

  // Forex Majors (EURUSD, GBPUSD, etc.)
  return 10.0;
}

export function getSymbolSpec(brokerSymbol: string): { pipSize: number, pipValuePerLot: number, digits: number, tickSize: number } {
  if (!brokerSymbol || typeof brokerSymbol !== "string") {
    return { pipSize: 0.0001, pipValuePerLot: 10, digits: 5, tickSize: 0.00001 };
  }
  const cleanSymbol = brokerSymbol
    .replace(".Daily", "")
    .replace(/_[0-9]+$/, "")
    .replace("=X", "")
    .replace("=F", "");
  
  // 1. Try to fetch from live broker cache first (most accurate for digits and tickSize)
  for (const [key, cached] of liveSpecCache.entries()) {
    if (key.endsWith(`:${brokerSymbol}`) || key.endsWith(`:${cleanSymbol}`)) {
       return {
         pipSize: OPTIMIZER_CONFIG[cleanSymbol]?.pipSize ?? 0.0001,
         pipValuePerLot: cached.pipValuePerLot,
         digits: cached.digits,
         tickSize: cached.tickSize,
       };
    }
  }

  // 2. Lookup OPTIMIZER_CONFIG or dynamic asset class fallback
  const optConfig = OPTIMIZER_CONFIG[cleanSymbol];
  let digits = 5;
  let tickSize = 0.00001;
  let pipSize = 0.0001;

  if (optConfig) {
    tickSize = optConfig.tickSize ?? 0.00001;
    const tickStr = tickSize.toString();
    digits = tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
    pipSize = optConfig.pipSize ?? 0.0001;
  } else {
    // Dynamic asset class fallback digits
    if (cleanSymbol.includes("JPY")) {
      digits = 3;
      tickSize = 0.001;
      pipSize = 0.01;
    } else if (cleanSymbol.includes("XAU") || cleanSymbol.includes("GOLD") || cleanSymbol.includes("XTI") || cleanSymbol.includes("OIL") || cleanSymbol.includes("BTC") || cleanSymbol.includes("ETH")) {
      digits = 2;
      tickSize = 0.01;
      pipSize = cleanSymbol.includes("XAU") || cleanSymbol.includes("GOLD") ? 0.1 : 0.01;
    } else if (cleanSymbol.includes("US30") || cleanSymbol.includes("NAS") || cleanSymbol.includes("GER40") || cleanSymbol.includes("DAX40") || cleanSymbol.includes("DE40") || cleanSymbol.includes("SPX") || cleanSymbol.includes("JPN225")) {
      digits = 2;
      tickSize = 0.1;
      pipSize = 1.0;
    } else {
      digits = 5;
      tickSize = 0.00001;
      pipSize = 0.0001;
    }
  }
  
  const pipValuePerLot = getFallbackPipValue(cleanSymbol);

  return {
    pipSize,
    pipValuePerLot,
    digits,
    tickSize,
  };
}

/**
 * Canonical price rounding utility — the SINGLE source of truth for all MetaApi price fields.
 *
 * ALL price values sent to MetaApi (entry, SL, TP, trailing-SL modifications) MUST be
 * routed through this function. Failure to do so causes hard "Validation failed" rejections
 * from the broker for assets with strict decimal limits (BTCUSD=2dp, XAUUSD=2dp, etc.).
 *
 * Usage:
 *   const pEntry = roundPrice(rawEntry, brokerSymbol);
 *   const pSl    = roundPrice(rawSl,    brokerSymbol);
 *   const pTp    = roundPrice(rawTp,    brokerSymbol);
 *
 * @param price  Raw floating-point price (potentially many decimals from arithmetic)
 * @param brokerSymbol  The broker symbol string (e.g. 'BTCUSD', 'XAUUSD', 'EURUSD')
 * @returns  Number rounded to the exact decimal precision the broker enforces
 */
export function roundPrice(price: number, brokerSymbol: string): number {
  if (!Number.isFinite(price)) return 0;
  const spec = getSymbolSpec(brokerSymbol);
  return Number(price.toFixed(spec.digits));
}

export function isBrokerPriceOrStopsError(err: any): boolean {
  if (!err) return false;
  const msg = ((err.message || "") + " " + (err.details ? JSON.stringify(err.details) : "") + " " + (err.stringifiedDetails || "")).toLowerCase();
  return (
    msg.includes("invalid price") ||
    msg.includes("invalid stops") ||
    msg.includes("invalid_stops") ||
    msg.includes("invalid_price") ||
    msg.includes("retcode_invalid") ||
    msg.includes("validation failed") ||
    msg.includes("10015") || // TRADE_RETCODE_INVALID_PRICE
    msg.includes("10016") || // TRADE_RETCODE_INVALID_STOPS
    msg.includes("10014") || // TRADE_RETCODE_INVALID_VOLUME
    msg.includes("10013") || // TRADE_RETCODE_INVALID
    msg.includes("10006") || // TRADE_RETCODE_REJECT
    msg.includes("freeze level") ||
    msg.includes("stops level") ||
    msg.includes("off quotes") ||
    msg.includes("price changed") ||
    msg.includes("invalid expiration")
  );
}

export function calculateStopsLevelSafePrices(
  direction: "BUY" | "SELL",
  currentPrice: number,
  rawSl: number,
  rawTp: number,
  stopsLevelPoints: number = 0,
  tickSize: number = 0.00001,
  digits: number = 5,
  isFallback: boolean = false
): { pSl: number; pTp: number } {
  const extraBuffer = isFallback ? tickSize * 25 : 0;
  const minStopDist = Math.max((stopsLevelPoints + 10) * tickSize + extraBuffer, tickSize * 10 + extraBuffer);
  let finalSl = Number.isFinite(rawSl) ? rawSl : (direction === "BUY" ? currentPrice - minStopDist : currentPrice + minStopDist);
  let finalTp = Number.isFinite(rawTp) ? rawTp : 0;

  if (direction === "BUY") {
    if (currentPrice - finalSl < minStopDist) {
      finalSl = currentPrice - minStopDist;
    }
    if (finalTp > 0 && finalTp - currentPrice < minStopDist) {
      finalTp = currentPrice + minStopDist;
    }
  } else {
    if (finalSl - currentPrice < minStopDist) {
      finalSl = currentPrice + minStopDist;
    }
    if (finalTp > 0 && currentPrice - finalTp < minStopDist) {
      finalTp = currentPrice - minStopDist;
    }
  }

  return {
    pSl: Number.isFinite(finalSl) && finalSl > 0 ? Number(finalSl.toFixed(digits)) : 0,
    pTp: Number.isFinite(finalTp) && finalTp > 0 ? Number(finalTp.toFixed(digits)) : 0,
  };
}

import { createHash } from "crypto";

// ── MetaAPI SDK instance cache (reuse connections, avoid repeated handshakes) ─
const apiCache = new Map<string, any>();

function getApiInstance(token: string): any {
  // Cache by token hash (already decrypted at this point)
  const cacheKey = createHash("sha256").update(token).digest("hex");
  if (!apiCache.has(cacheKey)) {
    apiCache.set(cacheKey, new MetaApi(token));
  }
  return apiCache.get(cacheKey);
}

export function clearApiCacheForToken(token: string) {
  const cacheKey = createHash("sha256").update(token).digest("hex");
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
 * Rounds a raw lot-size float to the nearest broker volStep, eliminates IEEE 754
 * floating-point residuals, and enforces broker min/max volume constraints.
 *
 * Examples:
 *   quantizeLots(0.156, 0.01, 0.01, 100)  → 0.15
 *   quantizeLots(0.14000000000000001, 0.01) → 0.14   (no trailing garbage)
 *   quantizeLots(0.004, 0.01)              → 0.01   (floor to minimum)
 *   quantizeLots(7.89, 0.01, 0.01, 5)     → 5.00   (capped at max)
 */
export function quantizeLots(
  raw: number,
  volStep: number = 0.01,
  minVol: number = 0.01,
  maxVol: number = 100,
): number {
  // Step 1 — floor to nearest volumeStep (immune to IEEE 754 drift)
  const steps = Math.floor(raw / volStep + 1e-9);
  const stepped = steps * volStep;
  // Step 2 — enforce broker [minVol, maxVol] range
  const clamped = Math.min(Math.max(stepped, minVol), maxVol);
  // Step 3 — round to avoid trailing garbage without forcing 2 decimal places
  return Math.round(clamped * 1e8) / 1e8;
}



/**
 * getLiveBrokerSpec — queries the LIVE broker via MetaAPI for the exact
 * contractSize, tickSize, tickValue for a given symbol, and derives pipValuePerLot.
 * This makes the system 100% broker-agnostic — no hardcoded contract sizes needed.
 *
 * Falls back to OPTIMIZER_CONFIG on any error.
 */
export async function getLiveBrokerSpec(
  brokerSymbol: string,
  token: string,
  accountId: string,
): Promise<{
  pipValuePerLot: number;
  tickSize: number;
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  digits: number;
  fetchedAt?: number;
}> {
  const cacheKey = `${createHash("sha256").update(token).digest("hex").slice(0, 8)}:${brokerSymbol}`;
  const cached = liveSpecCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < SPEC_CACHE_TTL_MS) {
    return cached;
  }

  const cleanSymbol = brokerSymbol.replace(".Daily", "");
  const optPipSize = getDynamicPipSize(cleanSymbol);

  try {
    const conn = await getSharedConnection(token, accountId, false);
    const metaSpec = await conn.getSymbolSpecification(brokerSymbol);

    if (metaSpec && metaSpec.tickSize > 0 && metaSpec.tickValue > 0) {
      // Derive pipValuePerLot from live broker data:
      // pipValuePerLot = (pipSize / tickSize) * tickValue
      const ticksPerPip = optPipSize / metaSpec.tickSize;
      const livePipValuePerLot = ticksPerPip * metaSpec.tickValue;

      const result = {
        pipValuePerLot: livePipValuePerLot,
        tickSize: metaSpec.tickSize,
        contractSize: metaSpec.contractSize || 100000,
        minVolume: metaSpec.minVolume || 0.01,
        maxVolume: metaSpec.maxVolume || 100,
        volumeStep: metaSpec.volumeStep || 0.01,
        digits: metaSpec.digits || Math.max(0, -Math.floor(Math.log10(metaSpec.tickSize))),
        fetchedAt: Date.now(),
      };

      liveSpecCache.set(cacheKey, result);
      console.log(
        `[MetaAPI] 🔍 Live spec for ${brokerSymbol}: pipValue=$${livePipValuePerLot.toFixed(4)}/lot | tickSize=${metaSpec.tickSize} | contractSize=${result.contractSize} | volStep=${result.volumeStep}`,
      );
      return result;
    }
  } catch (e: any) {
    console.warn(
      `[MetaAPI] ⚠️ Failed to fetch live spec for ${brokerSymbol}: ${e.message}. Falling back to hardcoded.`,
    );
  }

  // Fallback to static spec
  const fallbackPipValue = getFallbackPipValue(brokerSymbol);

  return {
    pipValuePerLot: fallbackPipValue,
    tickSize: optPipSize, // best approximation
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    digits: Math.max(0, -Math.floor(Math.log10(optPipSize)) + 1),
    fetchedAt: 0, // mark as stale so next call will re-fetch
  };
}

// ── Verify Connection Hook ───────────────────────────────────────────────────

export async function verifyMetaApiConnection(
  token: string,
  accountId: string,
): Promise<boolean> {
  accountId = safeDecryptAccountId(accountId);
  try {
    const api = getApiInstance(token);
    const accountPromise = api.metatraderAccountApi.getAccount(accountId);
    accountPromise.catch(() => {});

    // Fast-fail timeout to prevent the UI from hanging on save
    const account = await Promise.race([
      accountPromise,
      new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 2000)),
    ]);

    if (!account) throw new Error("Account not found");
    return true;
  } catch (err: any) {
    if (err.message === "timeout") {
      console.warn(`[MetaAPI] Verification timed out (2s). Returning false.`);
      return false;
    }
    throw new Error(`MetaAPI Connection Failed: ${err.message}`);
  }
}

export async function verifyMetaApiAccount(
  token: string,
  accountId: string,
): Promise<boolean> {
  try {
    const api = getApiInstance(token);
    const accountPromise = api.metatraderAccountApi.getAccount(accountId);
    accountPromise.catch(() => {});
    const account = (await Promise.race([
      accountPromise,
      new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 5000)),
    ])) as any;

    if (account && account.id === accountId) {
      return true;
    }
    return false;
  } catch (err: any) {
    if (err.message === "timeout") {
      console.warn(
        `[MetaAPI] Account verification timed out. Assuming valid for now.`,
      );
      return true;
    }
    if (
      err.status === 401 ||
      err.status === 403 ||
      err.status === 404 ||
      err.name === "NotFoundError" ||
      err.name === "UnauthorizedError" ||
      err.name === "MethodAccessError" ||
      err.message?.includes("auth") ||
      err.message?.includes("token") ||
      err.message?.includes("access token") ||
      err.message?.includes("not found")
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

export function getMetaApiConnectionState(
  token: string,
  accountId: string,
): "offline" | "syncing" | "connected" {
  if (!token || !accountId) return "offline";
  accountId = safeDecryptAccountId(accountId);
  const key = createHash("sha256")
    .update(token + accountId)
    .digest("hex");
  if (connectionCache.has(key)) return "connected";
  if (isConnecting.has(key)) return "syncing";
  return "offline";
}

export async function getLiveAccountBalance(
  token: string,
  accountId: string,
): Promise<number | null> {
  if (!token || !accountId) return null;
  try {
    const connection = await getSharedConnection(token, accountId, true);
    if (!connection) return null;
    const accountInfo = await connection.getAccountInformation();
    return accountInfo?.balance || null;
  } catch (err: any) {
    console.error(`[MetaAPI] getLiveAccountBalance failed:`, err.message);
    return null;
  }
}


export async function getSharedConnection(
  token: string,
  accountId: string,
  background = false,
): Promise<any> {
  if ((global as any).isSimulator) return SimulationProvider;
  accountId = safeDecryptAccountId(accountId);
  const key = createHash("sha256")
    .update(token + accountId)
    .digest("hex");

  if (connectionCache.has(key)) {
    const cached = connectionCache.get(key);
    try {
      const waitPromise = cached.waitSynchronized();
      waitPromise.catch(() => {});
      await Promise.race([
        waitPromise,
        new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 2500)),
      ]);
    } catch {
      // Don't delete the cache; MetaAPI auto-reconnects in the background.
      // Deleting the cache causes memory leaks and API spam.
    }
    if (onMetaApiConnected) onMetaApiConnected();
    return cached;
  }

  if (background) {
    if (!isConnecting.has(key)) {
      isConnecting.add(key);
      (async () => {
        try {
          // Suppress the spammy log to keep console clean
          // console.log(`[MetaAPI] Starting background synchronization for ${accountId}...`);
          const api = getApiInstance(token);
          const account = await api.metatraderAccountApi.getAccount(accountId);
          accountCache.set(key, account);
          if (account.state !== "DEPLOYED") {
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
            new Promise((_, r) =>
              setTimeout(() => r(new Error("180s timeout")), 180000),
            ),
          ]);
          // Suppress the spammy success log
          // console.log(`[MetaAPI] ✅ Background sync complete for ${accountId}.`);
          connectionCache.set(key, connection);
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
    if (account.state !== "DEPLOYED") {
      await account.deploy();
      try {
        const waitConn = account.waitConnected();
        waitConn.catch(() => {});
        await Promise.race([
          waitConn,
          new Promise((_, r) => setTimeout(() => r(new Error("waitConnected timeout (15s)")), 15000)),
        ]);
      } catch (e: any) {
        console.warn(`[MetaAPI] waitConnected warning for ${accountId}: ${e.message}`);
      }
    }
    const connection = account.getRPCConnection();
    await connection.connect();
    try {
      const waitPromise = connection.waitSynchronized();
      waitPromise.catch(() => {});
      await Promise.race([
        waitPromise,
        new Promise((_, r) =>
          setTimeout(() => r(new Error("RPC waitSynchronized timeout (15s)")), 15000),
        ),
      ]);
    } catch (syncErr: any) {
      console.warn(`[MetaAPI] ⚠️ RPC waitSynchronized for ${accountId} timed out: ${syncErr.message}. Connection cached, continuing in background.`);
    }
    connectionCache.set(key, connection);
    return connection;
  }
}

export function clearAllSharedConnections() {
  console.log(
    `[MetaAPI] 🧹 Sweeping and closing ALL shared connections due to global token update...`,
  );

  for (const conn of connectionCache.values()) {
    try {
      if (typeof conn.close === "function") conn.close();
    } catch (e) {}
  }
  for (const conn of streamingConnectionCache.values()) {
    try {
      if (typeof conn.close === "function") conn.close();
    } catch (e) {}
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
  "GBPJPY",
  "AUDJPY",
  "CHFJPY",
  "GBPCAD",
  "GBPUSD",
  "EURCAD",
  "EURAUD",
  "EURUSD",
  "EURJPY",
  "GBPCHF",
  "USDJPY",
  "AUDUSD",
  "EURCHF",
  "GBPAUD",
  "USDCHF",
  "USDCAD",
  "NZDUSD",
  "NAS100",
  "GER40",
  "US30",
  "US500",
  "JPN225",
  "BTCUSD",
  "ETHUSD",
  "DAX40",
];

export async function getSharedStreamingConnection(
  token: string,
  accountId: string,
  background = false,
): Promise<any> {
  accountId = safeDecryptAccountId(accountId);
  const key = createHash("sha256")
    .update(token + accountId)
    .digest("hex");

  if (streamingConnectionCache.has(key)) {
    const cached = streamingConnectionCache.get(key);
    try {
      const waitPromise = cached.waitSynchronized();
      waitPromise.catch(() => {});
      await Promise.race([
        waitPromise,
        new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 8000)),
      ]);
      if (onMetaApiConnected) onMetaApiConnected();
      return cached;
    } catch {
      console.warn(`[MetaAPI] waitSynchronized timeout on cached conn. Proceeding without delete.`);
    }
  }

  if (background) {
    if (!isStreamingConnecting.has(key)) {
      isStreamingConnecting.add(key);
      (async () => {
        try {
          console.log(
            `[MetaAPI] Starting background streaming synchronization for ${accountId}...`,
          );
          const api = getApiInstance(token);
          const account = await api.metatraderAccountApi.getAccount(accountId);
          if (account.state !== "DEPLOYED") {
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
            new Promise((_, r) =>
              setTimeout(() => r(new Error("180s timeout")), 180000),
            ),
          ]);

          // Subscribe to all symbols for streaming market data
          for (const s of ALL_BROKER_SYMBOLS) {
            try {
              await connection.subscribeToMarketData(s);
            } catch (err: any) {
              if (err.message?.includes("account is not connected") || err.message?.includes("TimeoutError")) {
                console.warn(`[MetaAPI] Aborting subscriptions for ${accountId} — account is not connected to broker.`);
                break; // Short-circuit to prevent 28x timeout spam
              } else if (!err.message?.includes("symbol does not exist")) {
                console.warn(`[MetaAPI] Failed to subscribe to ${s}:`, err.message);
              }
            }
          }

          streamingConnectionCache.set(key, connection);
          console.log(
            `[MetaAPI] ✅ Background streaming sync complete for ${accountId}.`,
          );
          if (onMetaApiConnected) onMetaApiConnected();
        } catch (err: any) {
          console.warn(
            `[MetaAPI] ⚠️ Background streaming sync failed:`,
            err.message,
          );
        } finally {
          isStreamingConnecting.delete(key);
        }
      })();
    }
    throw new Error(
      `Fast fail: Background streaming sync running for ${accountId}`,
    );
  } else {
    const api = getApiInstance(token);
    const account = await api.metatraderAccountApi.getAccount(accountId);
    if (account.state !== "DEPLOYED") {
      await account.deploy();
      try {
        const waitConn = account.waitConnected();
        waitConn.catch(() => {});
        await Promise.race([
          waitConn,
          new Promise((_, r) => setTimeout(() => r(new Error("waitConnected timeout (15s)")), 15000)),
        ]);
      } catch (e: any) {
        console.warn(`[MetaAPI] waitConnected warning for streaming ${accountId}: ${e.message}`);
      }
    }
    const connection = account.getStreamingConnection();
    await connection.connect();
    try {
      const waitPromise = connection.waitSynchronized();
      waitPromise.catch(() => {});
      await Promise.race([
        waitPromise,
        new Promise((_, r) =>
          setTimeout(() => r(new Error("Streaming waitSynchronized timeout (15s)")), 15000),
        ),
      ]);
    } catch (syncErr: any) {
      console.warn(`[MetaAPI] ⚠️ Streaming waitSynchronized for ${accountId} timed out: ${syncErr.message}. Connection cached, continuing in background.`);
    }

    // Subscribe to all symbols for streaming market data
    for (const s of ALL_BROKER_SYMBOLS) {
      try {
        await connection.subscribeToMarketData(s);
      } catch (err: any) {
        if (err.message?.includes("account is not connected") || err.message?.includes("TimeoutError")) {
          console.warn(`[MetaAPI] Aborting subscriptions for ${accountId} — account is not connected to broker.`);
          break; // Short-circuit to prevent 28x timeout spam
        } else if (!err.message?.includes("symbol does not exist")) {
          console.warn(`[MetaAPI] Failed to subscribe to ${s}:`, err.message);
        }
      }
    }

    streamingConnectionCache.set(key, connection);
    if (onMetaApiConnected) onMetaApiConnected();
    return connection;
  }
}

export async function getSharedAccount(
  token: string,
  accountId: string,
): Promise<any> {
  const key = createHash("sha256")
    .update(token + accountId)
    .digest("hex");
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
  const key = createHash("sha256")
    .update(token + accountId)
    .digest("hex");

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

export async function clearSharedConnectionForProfile(profileId: string | number) {
  if (!profileId || profileId === "global") return;
  try {
    const row = await db
      .prepare(
        "SELECT u.metaapi_token, tp.metaapi_account_id FROM trading_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.id = ?"
      )
      .get(profileId);
    if (row && row.metaapi_token && row.metaapi_account_id) {
      const rawToken = isEncrypted(row.metaapi_token) ? decrypt(row.metaapi_token) : row.metaapi_token;
      clearSharedConnection(rawToken, row.metaapi_account_id);
      console.log(`[MetaAPI] 🧹 Profile-scoped connection reset for Profile ${profileId}`);
    }
  } catch (e: any) {
    console.error(`[MetaAPI] Error clearing shared connection for profile ${profileId}:`, e?.message);
  }
}

// ── Main trade execution entry point ──────────────────────────────────────────
export async function executeTradeForProfile(
  profileId: number,
  signal: TrapSignal,
  stopLossDistPips: number,
  takeProfitDistPips: number,
  forceRiskPct?: number,
) {
  const profile = (await db
    .prepare(
      `SELECT tp.id, tp.user_id, u.metaapi_token, tp.metaapi_account_id, tp.risk_multiplier, tp.active_bots, tp.institutional_enabled
     FROM trading_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.id = ?
       AND tp.automation_active = 1 
       AND u.metaapi_token IS NOT NULL 
       AND tp.metaapi_account_id IS NOT NULL 
       ${process.env.SIMULATION_MODE === "true" ? "" : `AND u.metaapi_token != 'dummy_token' AND tp.metaapi_account_id != 'dummy_acc'`}`,
    )
    .get(profileId)) as any;

  if (!profile) return;

  console.log(
    `[MetaAPI] Signal ${signal.id} | ${signal.direction} ${signal.symbol} | Executing for profile ${profile.id}`,
  );

  const brokerSymbol =
    BROKER_SYMBOL_MAP[signal.symbol] ??
    signal.symbol.replace("=X", "").replace("=F", "");
  const spec = getSymbolSpec(brokerSymbol);

  // 🛡️ NEWS BLACKOUT WINDOW: Block new trades +/- 5 mins of High Impact News
  const newsCheck = isNewsBlackout(brokerSymbol, new Date());
  if (newsCheck.blocked) {
    console.log(
      `[MetaAPI] ⛔ TRADE REJECTED — News Blackout Window active for ${brokerSymbol}: ${newsCheck.reason || ''}`,
    );
    addBotLog(profileId, 'SYSTEM', brokerSymbol, 'Trade Rejected', `News Blackout Window active for ${brokerSymbol}. ${newsCheck.reason || ''}`);
    return;
  }

  let rawToken: string = "";
  try {
    // ── AUTHORIZATION CHECK: User must have the pair toggled ON ──────────────
    let activeBots: string[] = [];
    try {
      activeBots = JSON.parse(profile.active_bots || "[]");
    } catch (e) {
      activeBots = [];
    }

    const lowerBrokerSymbol = brokerSymbol.toLowerCase();
    const isAuthorized =
      activeBots.includes("sniper-system-ai") ||
      activeBots.some((botId) => botId.includes(lowerBrokerSymbol));

    if (!isAuthorized) {
      console.log(
        `[MetaAPI Profile ${profile.id}] Trade rejected: ${brokerSymbol} is not authorized by active bots.`,
      );
      addBotLog(profileId, 'SYSTEM', brokerSymbol, 'Trade Rejected', `Trade on ${brokerSymbol} rejected. Not authorized by active bots configurations.`);
      return;
    }

    // ── LOCKOUT RULE: Max 1 losing trade per session ──────────────────────
    if (profile.institutional_enabled === 1) {
      const losses = await getSessionLosses(
        profile.id,
        brokerSymbol,
        signal.timingGate,
      );
      if (losses >= 1) {
        console.warn(
          `[MetaAPI Profile ${profile.id}] Institutional Lockout active for ${brokerSymbol}. Max losses reached for session ${signal.timingGate}. Skipping trade.`,
        );
        addBotLog(profileId, 'SYSTEM', brokerSymbol, 'Trade Rejected', `Institutional Lockout active. Max losses reached for session ${signal.timingGate}.`);
        return;
      }
    }

    // ── FIX: Guard null token ─────────────────────────────────────────────
    if (!profile.metaapi_token || !profile.metaapi_account_id) {
      console.warn(
        `[MetaAPI Profile ${profile.id}] No token or account ID configured — skipping.`,
      );
      return;
    }

    // ── FIX: Decrypt token before use and validate no dummy values ──
    try {
      rawToken = isEncrypted(profile.metaapi_token)
        ? decrypt(profile.metaapi_token)
        : profile.metaapi_token;
      const decryptedAccountId = isEncrypted(profile.metaapi_account_id)
        ? decrypt(profile.metaapi_account_id)
        : profile.metaapi_account_id;
      if (rawToken === "dummy_token" || decryptedAccountId === "dummy_acc") {
        return; // Silently skip profiles that have not fully connected yet
      }
    } catch (e: any) {
      console.error(
        `[MetaAPI Profile ${profile.id}] Token decryption failed — skipping:`,
        e.message,
      );
      return;
    }

    // ── FIX: Use cached SDK instance ───────────────────────────────────────
    let balance: number = 0;
    let quote: any = null;

    if (process.env.SIMULATION_MODE === "true") {
      balance = 100.0; // Simulate $100 account
      const liveQuote = await SimulationProvider.getLiveQuote("", brokerSymbol);
      quote = { bid: liveQuote.bid, ask: liveQuote.ask, time: liveQuote.time };
    } else {
      const connection = await getSharedConnection(
        rawToken,
        profile.metaapi_account_id,
        false,
      );
      const accountInfo = await connection.getAccountInformation();
      balance = accountInfo.balance;

      // @ts-ignore
      quote = await connection.getSymbolPrice(brokerSymbol);
      const quoteAgeMs = Date.now() - (quote?.time?.getTime?.() ?? 0);
      if (quoteAgeMs > 10_000) {
        throw new Error(
          `Stale quote for ${brokerSymbol}: ${quoteAgeMs}ms old. Trade aborted.`,
        );
      }
    }

    // 🛡️ SPREAD TOLERANCE CHECK
    const spread = (quote.ask - quote.bid) / spec.pipSize;
    const isGoldOrIndex =
      brokerSymbol.includes("XAU") ||
      brokerSymbol.includes("NAS") ||
      brokerSymbol.includes("USTEC");
    const isMinor =
      brokerSymbol.includes("JPY") ||
      brokerSymbol.includes("AUD") ||
      brokerSymbol.includes("NZD") ||
      brokerSymbol.includes("CAD") ||
      brokerSymbol.includes("CHF");
    const maxSpreadAllowed = isGoldOrIndex ? 25 : isMinor ? 5 : 3;

    if (spread > maxSpreadAllowed) {
      console.warn(
        `[MetaAPI Profile ${profile.id}] ⛔ TRADE REJECTED — Spread is dangerously high (${spread.toFixed(1)} > ${maxSpreadAllowed} pips)`,
      );
      addBotLog(profileId, 'SYSTEM', brokerSymbol, 'Trade Rejected', `Spread is dangerously high (${spread.toFixed(1)} > ${maxSpreadAllowed} pips). Trade blocked.`);
      return;
    }

    // Calculate Lot Size based directly on user's chosen risk percentage (profile.risk_multiplier)
    // Ensure it has a sensible fallback (e.g. 5%) if missing
    if (stopLossDistPips <= 0) {
      addBotLog(profileId, 'SYSTEM', brokerSymbol, 'Trade Aborted', `Stop Loss distance is ${stopLossDistPips}. Aborting trade to prevent Infinity Lot Size bug.`);
      throw new Error(
        `CRITICAL: Stop Loss distance is ${stopLossDistPips}. Aborting trade to prevent Infinity Lot Size bug.`,
      );
    }
    if (!balance || isNaN(balance) || balance <= 0) {
      addBotLog(profileId, 'SYSTEM', brokerSymbol, 'Trade Aborted', `Invalid account balance (${balance}). Aborting trade.`);
      throw new Error(
        `CRITICAL: Invalid account balance (${balance}). Aborting trade.`,
      );
    }

    const chosenRiskPct =
      forceRiskPct ||
      (profile.risk_multiplier > 0 ? profile.risk_multiplier : 5);
    const riskAmount = balance * (chosenRiskPct / 100);

    // ── DYNAMIC LOT SIZING CALCULATION ──
    let dynamicPipValuePerLot = spec.pipValuePerLot; // Fallback to hardcoded
    try {
      if (process.env.SIMULATION_MODE !== "true") {
        const connection = await getSharedConnection(
          rawToken,
          profile.metaapi_account_id,
          false,
        );
        const metaSpec = await connection.getSymbolSpecification(brokerSymbol);
        if (metaSpec && metaSpec.tickSize && metaSpec.tickValue) {
          // Calculate the exact account currency value of 1 full PIP for 1.0 standard Lot
          const ticksPerPip = spec.pipSize / metaSpec.tickSize;
          dynamicPipValuePerLot = ticksPerPip * metaSpec.tickValue;
          console.log(
            `[MetaAPI] ${brokerSymbol} Dynamic Pip Value: $${dynamicPipValuePerLot.toFixed(2)} (TickSize: ${metaSpec.tickSize}, TickValue: ${metaSpec.tickValue})`,
          );
        }
      }
    } catch (e: any) {
      console.warn(
        `[MetaAPI] Failed to fetch dynamic symbol spec for ${brokerSymbol}, falling back to hardcoded pipValue: ${spec.pipValuePerLot}`,
      );
    }

    const lotSize = riskAmount / stopLossDistPips / dynamicPipValuePerLot;

    if (isNaN(lotSize) || !isFinite(lotSize)) {
      throw new Error(
        `CRITICAL: Lot size calculation resulted in ${lotSize}. Aborting trade.`,
      );
    }

    // Dual Trade Logic (TP1 & TP2)
    const halfLotSize = quantizeLots(lotSize / 2);
    if (halfLotSize < 0.01) {
      console.warn(
        `[MetaAPI Profile ${profile.id}] Lot size too small for dual trades (${lotSize}). Skipping.`,
      );
      return;
    }

    const slDistance = stopLossDistPips * spec.pipSize;
    const tp1Distance = takeProfitDistPips * 0.5 * spec.pipSize;
    const tp2Distance = takeProfitDistPips * spec.pipSize; // Full TP

    let orderResult1, orderResult2;

    const authorizingBot =
      activeBots.find((b) => b.includes(lowerBrokerSymbol)) ||
      "sniper-system-ai";
    const botId = authorizingBot;
    const openTime = Date.now();

    // DB-first write to prevent orphaned broker trades on crash
    const insertTrade = await db.prepare(`
      INSERT INTO bot_trade_states
        (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, tp_price,
         lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, status, manages_own_trailing)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'OPEN', 1)
    `);

    let entryPrice = signal.direction === "BUY" ? quote.ask : quote.bid;
    let slPrice =
      signal.direction === "BUY"
        ? entryPrice - slDistance
        : entryPrice + slDistance;
    let tp1Price =
      signal.direction === "BUY"
        ? entryPrice + tp1Distance
        : entryPrice - tp1Distance;
    let tp2Price =
      signal.direction === "BUY"
        ? entryPrice + tp2Distance
        : entryPrice - tp2Distance;

    // Round prices to exact broker decimal precision via canonical SYMBOL_SPECS.digits
    // This prevents MetaApi 'Validation failed' for BTCUSD (2dp), XAUUSD (2dp), JPY pairs (3dp)
    slPrice  = roundPrice(slPrice,  brokerSymbol);
    tp1Price = roundPrice(tp1Price, brokerSymbol);
    tp2Price = roundPrice(tp2Price, brokerSymbol);
    const tp1Res = await insertTrade.run(
      profile.user_id,
      profile.id,
      botId,
      brokerSymbol,
      signal.direction,
      entryPrice,
      slPrice,
      tp1Price,
      halfLotSize,
      openTime,
      "PENDING_TP1",
      entryPrice,
      entryPrice,
    );
    const tp1DbId = tp1Res
      ? (tp1Res as unknown as { lastInsertRowid: number }).lastInsertRowid
      : 0;

    const tp2Res = await insertTrade.run(
      profile.user_id,
      profile.id,
      botId,
      brokerSymbol,
      signal.direction,
      entryPrice,
      slPrice,
      tp2Price,
      halfLotSize,
      openTime,
      "PENDING_TP2",
      entryPrice,
      entryPrice,
    );
    const tp2DbId = tp2Res
      ? (tp2Res as unknown as { lastInsertRowid: number }).lastInsertRowid
      : 0;

    try {
      if (process.env.SIMULATION_MODE === "true") {
        orderResult1 = { orderId: `SIM_${Date.now()}_TP1` };
        orderResult2 = { orderId: `SIM_${Date.now()}_TP2` };
      } else {
        const connection = await getSharedConnection(
          rawToken,
          profile.metaapi_account_id,
          false,
        );
        if (signal.direction === "BUY") {
          console.log(
            `[MetaAPI Profile ${profile.id}] BUY TP1 @ ${quote.ask} | SL: ${slPrice} | TP1: ${tp1Price} | Lots: ${halfLotSize}`,
          );
          try {
            orderResult1 = await connection.createMarketBuyOrder(
              brokerSymbol,
              halfLotSize,
              slPrice,
              tp1Price,
            );
            if (orderResult1?.orderId) {
              await db
                .prepare(
                  `UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`,
                )
                .run(orderResult1.orderId, tp1DbId);
              broadcastTradeOpened(profile.id, {
                botId,
                brokerSymbol,
                direction: signal.direction,
                orderId: orderResult1.orderId,
                type: "TP1",
              });
            }
          } catch (e1: any) {
            throw new Error(`TP1 Execution Failed: ${e1.message}`);
          }

          console.log(
            `[MetaAPI Profile ${profile.id}] BUY TP2 @ ${quote.ask} | SL: ${slPrice} | TP2: ${tp2Price} | Lots: ${halfLotSize}`,
          );
          try {
            orderResult2 = await connection.createMarketBuyOrder(
              brokerSymbol,
              halfLotSize,
              slPrice,
              tp2Price,
            );
            if (orderResult2?.orderId) {
              await db
                .prepare(
                  `UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`,
                )
                .run(orderResult2.orderId, tp2DbId);
              broadcastTradeOpened(profile.id, {
                botId,
                brokerSymbol,
                direction: signal.direction,
                orderId: orderResult2.orderId,
                type: "TP2",
              });
            }
          } catch (e2: any) {
            console.error(
              `[MetaAPI Profile ${profile.id}] ⚠️ TP2 Failed! TP1 succeeded. We will retain TP1 so the trade engine can manage it safely.`,
            );
            throw new Error(
              `TP2 Execution Failed (TP1 retained): ${e2.message}`,
            );
          }
        } else {
          console.log(
            `[MetaAPI Profile ${profile.id}] SELL TP1 @ ${quote.bid} | SL: ${slPrice} | TP1: ${tp1Price} | Lots: ${halfLotSize}`,
          );
          try {
            orderResult1 = await connection.createMarketSellOrder(
              brokerSymbol,
              halfLotSize,
              slPrice,
              tp1Price,
            );
            if (orderResult1?.orderId) {
              await db
                .prepare(
                  `UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`,
                )
                .run(orderResult1.orderId, tp1DbId);
              broadcastTradeOpened(profile.id, {
                botId,
                brokerSymbol,
                direction: signal.direction,
                orderId: orderResult1.orderId,
                type: "TP1",
              });
            }
          } catch (e1: any) {
            throw new Error(`TP1 Execution Failed: ${e1.message}`);
          }

          console.log(
            `[MetaAPI Profile ${profile.id}] SELL TP2 @ ${quote.bid} | SL: ${slPrice} | TP2: ${tp2Price} | Lots: ${halfLotSize}`,
          );
          try {
            orderResult2 = await connection.createMarketSellOrder(
              brokerSymbol,
              halfLotSize,
              slPrice,
              tp2Price,
            );
            if (orderResult2?.orderId) {
              await db
                .prepare(
                  `UPDATE bot_trade_states SET meta_order_id = ? WHERE id = ?`,
                )
                .run(orderResult2.orderId, tp2DbId);
              broadcastTradeOpened(profile.id, {
                botId,
                brokerSymbol,
                direction: signal.direction,
                orderId: orderResult2.orderId,
                type: "TP2",
              });
            }
          } catch (e2: any) {
            console.error(
              `[MetaAPI Profile ${profile.id}] ⚠️ TP2 Failed! TP1 succeeded. We will retain TP1 so the trade engine can manage it safely.`,
            );
            throw new Error(
              `TP2 Execution Failed (TP1 retained): ${e2.message}`,
            );
          }
        }
      }

      console.log(
        `[MetaAPI Profile ${profile.id}] ✅ Dual Orders placed: TP1(${orderResult1?.orderId}), TP2(${orderResult2?.orderId})`,
      );
      addBotLog(profileId, botId, brokerSymbol, 'Trade Placed', `Placed ${signal.direction} on ${brokerSymbol} - ${lotSize.toFixed(2)} Lots @ ${entryPrice.toFixed(5)} (SL: ${slPrice.toFixed(5)}, TP1: ${tp1Price.toFixed(5)}, TP2: ${tp2Price.toFixed(5)})`);
    } catch (err: any) {
      // ONLY delete from DB if they do not have an order ID (they failed to reach MetaAPI)
      if (!orderResult1?.orderId)
        await db
          .prepare(`DELETE FROM bot_trade_states WHERE id = ?`)
          .run(tp1DbId);
      if (!orderResult2?.orderId)
        await db
          .prepare(`DELETE FROM bot_trade_states WHERE id = ?`)
          .run(tp2DbId);

      addBotLog(profileId, botId, brokerSymbol, 'Trade Failed', `Failed to place ${signal.direction} on ${brokerSymbol}: ${err.message}`);
      throw err;
    }
  } catch (err: any) {
    console.error(
      `[MetaAPI Profile ${profile.id}] ❌ Trade failed:`,
      err.message,
    );
    if (rawToken) clearSharedConnection(rawToken, profile.metaapi_account_id);
  }
}

export async function getProfileTradeHistory(
  profileId: number,
  daysBack: number = 30,
  resetTimeStr?: string,
) {
  const profile = (await db
    .prepare(
      "SELECT tp.user_id, u.metaapi_token, tp.metaapi_account_id FROM trading_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.id = ?",
    )
    .get(profileId)) as any;
  if (!profile || !profile.metaapi_token || !profile.metaapi_account_id)
    return null;

  let rawToken = profile.metaapi_token;
  try {
    try {
      rawToken = isEncrypted(profile.metaapi_token)
        ? decrypt(profile.metaapi_token)
        : profile.metaapi_token;
    } catch (e) {}

    // Fast fail connection wait (increase race timeout to 5s to be safe)
    const connPromise = getSharedConnection(
      rawToken,
      profile.metaapi_account_id,
      false,
    );
    connPromise.catch(() => {});
    const connection = await Promise.race([
      connPromise,
      new Promise<any>((_, r) =>
        setTimeout(() => r(new Error("timeout")), 5000),
      ),
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

    const rawDeals = (await connection.getDealsByTimeRange(start, now)) as any;
    const deals = Array.isArray(rawDeals) ? rawDeals : (rawDeals?.deals || []);
    if (!deals || !Array.isArray(deals) || deals.length === 0) return [];

    const positions = new Map<string, any>();

    for (const deal of deals) {
      if (!deal.positionId) continue;

      if (!positions.has(deal.positionId)) {
        let botId = "manual";
        const rawSig = deal.clientId || deal.brokerComment || deal.comment || "";
        if (rawSig.startsWith("M_") || rawSig.toLowerCase().includes("mage")) botId = "mage";
        else if (rawSig.startsWith("S_") || rawSig.toLowerCase().includes("sage")) botId = "sage";
        else if (rawSig.startsWith("SEER") || rawSig.toLowerCase().includes("seer") || rawSig.includes("discretionary_trader")) botId = "seer";

        positions.set(deal.positionId, {
          id: deal.positionId,
          user_id: profile.user_id,
          profile_id: profileId,
          bot_id: botId,
          broker_symbol: deal.symbol,
          raw_sig: rawSig,
          direction:
            deal.type === "DEAL_TYPE_BUY"
              ? deal.entryType === "DEAL_ENTRY_IN"
                ? "BUY"
                : "SELL"
              : deal.entryType === "DEAL_ENTRY_IN"
                ? "SELL"
                : "BUY",
          entry_price: 0,
          exit_price: 0,
          lots: deal.volume || 0,
          pips: 0,
          profit: 0,
          status: "OPEN",
          open_time: 0,
          close_time: null,
        });
      }

      const pos = positions.get(deal.positionId);

      const dealSig = deal.clientId || deal.brokerComment || deal.comment || "";
      if ((!pos.bot_id || pos.bot_id === "manual") && dealSig) {
        if (dealSig.startsWith("M_") || dealSig.toLowerCase().includes("mage")) pos.bot_id = "mage";
        else if (dealSig.startsWith("S_") || dealSig.toLowerCase().includes("sage")) pos.bot_id = "sage";
        else if (dealSig.startsWith("SEER") || dealSig.toLowerCase().includes("seer") || dealSig.includes("discretionary_trader")) pos.bot_id = "seer";
      }

      if (deal.entryType === "DEAL_ENTRY_IN") {
        pos.entry_price = deal.price;
        pos.open_time = new Date(deal.time).getTime();
        pos.direction = deal.type === "DEAL_TYPE_BUY" ? "BUY" : "SELL";
        if (deal.volume) pos.lots = deal.volume;
      } else if (
        deal.entryType === "DEAL_ENTRY_OUT" ||
        deal.entryType === "DEAL_ENTRY_INOUT"
      ) {
        pos.exit_price = deal.price;
        pos.close_time = new Date(deal.time).getTime();
        pos.profit +=
          (deal.profit || 0) + (deal.commission || 0) + (deal.swap || 0);
        pos.status = "CLOSED";
      }
    }

    const closedTrades = Array.from(positions.values()).filter(
      (p) => p.status === "CLOSED",
    );

    for (const trade of closedTrades) {
      const spec = getSymbolSpec(trade.broker_symbol);
      const pipSize = spec.pipSize || 0.0001;
      const diff =
        trade.direction === "BUY"
          ? trade.exit_price - trade.entry_price
          : trade.entry_price - trade.exit_price;
      trade.pips = parseFloat((diff / pipSize).toFixed(1));
      trade.profit = parseFloat(trade.profit.toFixed(2));
      trade.status = trade.profit >= 0 ? "CLOSED_WIN" : "CLOSED_LOSS";
    }

    // Asynchronously sync to trade_diary table efficiently in background
    (async () => {
      try {
        const existingRows = (await db
          .prepare(
            "SELECT open_time, bot_id, broker_symbol FROM trade_diary WHERE profile_id = ?"
          )
          .all(profileId)) as any[];
        const existingSet = new Set(
          (existingRows || []).map(
            (r: any) => `${r.bot_id}_${r.broker_symbol}_${r.open_time}`
          )
        );

        for (const trade of closedTrades) {
          const key = `${trade.bot_id}_${trade.broker_symbol}_${trade.open_time}`;
          if (!existingSet.has(key)) {
            existingSet.add(key);
            await db
              .prepare(
                `INSERT INTO trade_diary
                  (user_id, profile_id, bot_id, broker_symbol, direction,
                   entry_price, exit_price, lots, pips, profit, status, open_time, close_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                trade.user_id,
                trade.profile_id,
                trade.bot_id,
                trade.broker_symbol,
                trade.direction,
                trade.entry_price,
                trade.exit_price,
                trade.lots,
                trade.pips,
                trade.profit,
                trade.status,
                trade.open_time,
                trade.close_time || Date.now()
              );
          }
        }
      } catch (_) {}
    })().catch(() => {});

    return closedTrades.sort((a, b) => b.close_time - a.close_time);
  } catch (err: any) {
    console.error("Error in getProfileTradeHistory:", err);
    return [];
  }
}

export async function getBrokerSymbol(
  symbol: string,
  customMap?: Record<string, string> | null,
): Promise<string> {
  // 1. Direct check in custom map
  if (customMap && customMap[symbol]) {
    return customMap[symbol];
  }
  
  // 2. Check if there's a hardcoded alias (e.g. GER40.Daily -> GER40)
  const baseAlias = BROKER_SYMBOL_MAP[symbol];
  
  // 3. If we found a base alias, check if THAT alias is in the custom map
  if (baseAlias && customMap && customMap[baseAlias]) {
    return customMap[baseAlias];
  }
  
  // 4. Return the base alias if found, otherwise strip yahoo suffixes
  return baseAlias ?? symbol.replace("=X", "").replace("=F", "");
}

export function getCachedStreamingConnectionSync(
  token: string,
  accountId: string,
): unknown {
  const key = createHash("sha256")
    .update(token + safeDecryptAccountId(accountId))
    .digest("hex");
  return streamingConnectionCache.get(key) || null;
}

export function forceRebootMetaApi(token: string, accountId: string): void {
  const key = createHash("sha256")
    .update(token + safeDecryptAccountId(accountId))
    .digest("hex");
  if (streamingConnectionCache.has(key)) {
    console.log(`[MetaAPI] Force rebooting connection for ${key}`);
    const conn = streamingConnectionCache.get(key);
    // Best effort closing
    try {
      if (conn && conn.close) conn.close();
    } catch (e) {}
    streamingConnectionCache.delete(key);
  }
}

export async function discoverBrokerSymbols(profileId: number, token: string, accountId: string) {
  try {
    const conn = await getSharedConnection(token, accountId, false);
    console.log(`[AutoDiscover] Fetching all symbols for profile ${profileId}...`);
    const symbolsRaw = await conn.getSymbols();
    console.log(`[AutoDiscover] Fetched ${symbolsRaw.length} symbols.`);
    const symbols = symbolsRaw.map(s => typeof s === 'string' ? s : s.symbol);
    
    const INDICES = [
      { base: "GER40", pattern: /^(GER|DAX|DE)[34]0/i },
      { base: "US30", pattern: /^(US|DJ|WS|DOW)[34]0/i },
      { base: "NAS100", pattern: /^(NAS|US100|USTEC|NDX|NQ)/i },
      { base: "SPX500", pattern: /^(US500|SP500|SPX|S&P)/i },
      { base: "JPN225", pattern: /^(JPN|JP|NIKKEI)225/i },
    ];
    
    const newMap: Record<string, string> = {};
    
    for (const { base, pattern } of INDICES) {
      const matches = symbols.filter(s => pattern.test(s));
      if (matches.length === 0) continue;
      
      matches.sort((a, b) => {
        const aHasSuffix = a.includes('.');
        const bHasSuffix = b.includes('.');
        if (aHasSuffix && !bHasSuffix) return 1;
        if (!aHasSuffix && bHasSuffix) return -1;
        return a.length - b.length;
      });
      
      const bestMatch = matches[0];
      newMap[base] = bestMatch;
      console.log(`[AutoDiscover] Mapped ${base} -> ${bestMatch} (out of ${matches.join(', ')})`);
    }
    
    if (Object.keys(newMap).length > 0) {
      const row = await db.prepare("SELECT broker_symbol_map FROM trading_profiles WHERE id = $1").get(profileId);
      const existingMap = row && row.broker_symbol_map ? JSON.parse(row.broker_symbol_map) : {};
      const mergedMap = { ...existingMap, ...newMap };
      await db.prepare("UPDATE trading_profiles SET broker_symbol_map = $1 WHERE id = $2").run(JSON.stringify(mergedMap), profileId);
      console.log(`[AutoDiscover] Updated database for profile ${profileId}.`);
    }
    return newMap;
  } catch(e: any) {
    console.error(`[AutoDiscover] Failed: ${e.message}`);
    throw e;
  }
}


