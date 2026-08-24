// ─────────────────────────────────────────────────────────────────────────────
// THE_WITCH SHARED INDICATOR LIBRARY
// Pure, stateless functions used by all three strategy heads.
// All functions take a closes/highs/lows array and an index i,
// so the caller controls which candle window is being evaluated.
// ─────────────────────────────────────────────────────────────────────────────

import { BollingerBands } from "../config/types.js";

import { OHLCVTick } from "../config/types.js";
// ─────────────────────────────────────────────────────────────────────────────
// EMA — Exponential Moving Average (streaming)
// ─────────────────────────────────────────────────────────────────────────────
export function computeEma(
  candles: OHLCVTick[],
  period: number,
  endIdx: number,
): number {
  const len = endIdx + 1;
  if (len < period) return candles[len - 1].close;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let j = 0; j < period; j++) ema += candles[j].close;
  ema /= period;
  for (let j = period; j <= endIdx; j++)
    ema = candles[j].close * k + ema * (1 - k);
  return ema;
}

const emaCache = new WeakMap<OHLCVTick[], Record<number, Float64Array>>();

// Pre-compute EMA for ALL indices, returns array indexed by candle position.
export function buildEmaArray(
  candles: OHLCVTick[],
  period: number,
): Float64Array {
  let cache = emaCache.get(candles);
  if (!cache) {
    cache = {};
    emaCache.set(candles, cache);
  }
  if (cache[period] && cache[period].length === candles.length) return cache[period];

  const result = new Float64Array(candles.length);
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += candles[j].close;
      ema = sum / (i + 1);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += candles[j].close;
      ema = sum / period;
    } else {
      ema = candles[i].close * k + ema * (1 - k);
    }
    result[i] = ema;
  }
  cache[period] = result;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// ATR — Average True Range (Wilder's smoothing)
// ─────────────────────────────────────────────────────────────────────────────
const atrCache = new WeakMap<OHLCVTick[], Record<number, Float64Array>>();

export function buildAtrArray(
  candles: OHLCVTick[],
  period: number = 14,
): Float64Array {
  let cache = atrCache.get(candles);
  if (!cache) {
    cache = {};
    atrCache.set(candles, cache);
  }
  if (cache[period] && cache[period].length === candles.length) return cache[period];

  const result = new Float64Array(candles.length);
  if (candles.length === 0) return result;

  // Seed
  let atr = 0;
  const seedCount = Math.min(period, candles.length - 1);
  if (seedCount <= 0) return result;

  for (let i = 1; i <= seedCount; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    atr += tr;
    result[i] = atr / i; // Fill early entries with partial ATR
  }
  atr = atr / seedCount;

  for (let i = seedCount + 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    atr = (atr * (period - 1) + tr) / period;
    result[i] = atr;
  }
  cache[period] = result;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// RSI — Relative Strength Index (Wilder's smoothing)
// ─────────────────────────────────────────────────────────────────────────────
const rsiCache = new WeakMap<OHLCVTick[], Record<number, Float64Array>>();

export function buildRsiArray(
  candles: OHLCVTick[],
  period: number = 14,
): Float64Array {
  let cache = rsiCache.get(candles);
  if (!cache) {
    cache = {};
    rsiCache.set(candles, cache);
  }
  if (cache[period] && cache[period].length === candles.length) return cache[period];

  const result = new Float64Array(candles.length).fill(50);
  if (candles.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) result[period] = 100;
  else result[period] = 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) result[i] = 100;
    else result[i] = 100 - 100 / (1 + avgGain / avgLoss);
  }
  cache[period] = result;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bollinger Bands
// ─────────────────────────────────────────────────────────────────────────────

export function buildBollingerArray(
  candles: OHLCVTick[],
  period: number = 20,
  mult: number = 2,
): BollingerBands[] {
  const result: BollingerBands[] = candles.map(() => ({
    upper: 0,
    lower: 0,
    middle: 0,
    width: 0,
    stdDev: 0,
  }));

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = candles[j].close - mean;
      sqSum += diff * diff;
    }
    const stdDev = Math.sqrt(sqSum / period);
    const upper = mean + mult * stdDev;
    const lower = mean - mult * stdDev;
    const width = mean > 0 ? (upper - lower) / mean : 0;

    result[i] = { upper, lower, middle: mean, width, stdDev };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// BBW Percentile — where is today's BBW relative to the last N bars?
// Returns a 0–100 percentile. <5 = extreme compression.
// ─────────────────────────────────────────────────────────────────────────────
export function buildBbwPercentileArray(
  bbArray: BollingerBands[],
  lookback: number = 252 * 78, // ~1 year of 5m bars
): Float64Array {
  const result = new Float64Array(bbArray.length).fill(50);

  for (let i = lookback; i < bbArray.length; i++) {
    const current = bbArray[i].width;
    const window = bbArray.slice(i - lookback, i);
    let rank = 0;
    for (const b of window) {
      if (b.width < current) rank++;
    }
    result[i] = (rank / lookback) * 100;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// VWAP — Volume Weighted Average Price (daily reset)
// Returns array of vwap values per candle. Resets at day boundary.
// ─────────────────────────────────────────────────────────────────────────────
export function buildVwapArray(candles: OHLCVTick[]): Float64Array {
  const result = new Float64Array(candles.length);
  let cumulativePV = 0;
  let cumulativeVol = 0;
  let lastDayStr = "";

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i] as any;
    // Day boundary: use timestamp if available, else fall back to index-based daily estimate
    const ts = c.timestamp || c.time || 0;
    const dayStr = ts
      ? new Date(ts).toISOString().slice(0, 10)
      : `day-${Math.floor(i / 1440)}`;

    if (dayStr !== lastDayStr) {
      // New day — reset accumulation
      cumulativePV = 0;
      cumulativeVol = 0;
      lastDayStr = dayStr;
    }

    const typ = (c.high + c.low + c.close) / 3;
    const vol = c.tickVolume || 1;
    cumulativePV += typ * vol;
    cumulativeVol += vol;
    result[i] = cumulativeVol > 0 ? cumulativePV / cumulativeVol : c.close;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Volume spike — is current candle volume above threshold × recent average?
// ─────────────────────────────────────────────────────────────────────────────
export function isVolumeSpike(
  candles: OHLCVTick[],
  idx: number,
  lookback: number = 10,
  threshold: number = 1.5,
): boolean {
  if (idx < lookback) return false;
  let volSum = 0;
  let bodySum = 0;

  for (let j = idx - lookback; j < idx; j++) {
    volSum += candles[j].tickVolume || 1;
    bodySum += Math.abs(candles[j].close - candles[j].open);
  }

  const avgVol = volSum / lookback;
  const avgBody = bodySum / lookback;

  const currentVol = candles[idx].volume ?? candles[idx].tickVolume ?? 1;
  const currentBody = Math.abs(candles[idx].close - candles[idx].open);

  // A true institutional volume spike must be accompanied by SOME price body expansion (at least half the average)
  // If volume spikes but the candle is a tiny doji, it's broker spread manipulation.
  return currentVol > avgVol * threshold && currentBody >= avgBody * 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// RSI Divergence — price makes new extreme but RSI doesn't (simple version)
// Returns true if bearish divergence (for session sweep sell signals)
// or bullish divergence (for session sweep buy signals)
// ─────────────────────────────────────────────────────────────────────────────
export function hasBullishRsiDivergence(
  candles: OHLCVTick[],
  rsiArr: Float64Array,
  idx: number,
  lookback: number = 20,
): boolean {
  if (idx < lookback) return false;
  let priceMin = candles[idx].low;
  let rsiAtMin = rsiArr[idx];
  let earlierPriceMin = Infinity;
  let earlierRsiAtMin = 50;

  for (let j = idx - lookback; j < idx - 3; j++) {
    if (candles[j].low < earlierPriceMin) {
      earlierPriceMin = candles[j].low;
      earlierRsiAtMin = rsiArr[j];
    }
  }
  // Price makes lower low but RSI makes higher low → bullish divergence
  return priceMin < earlierPriceMin && rsiAtMin > earlierRsiAtMin;
}

export function hasBearishRsiDivergence(
  candles: OHLCVTick[],
  rsiArr: Float64Array,
  idx: number,
  lookback: number = 20,
): boolean {
  if (idx < lookback) return false;
  let priceMax = candles[idx].high;
  let rsiAtMax = rsiArr[idx];
  let earlierPriceMax = -Infinity;
  let earlierRsiAtMax = 50;

  for (let j = idx - lookback; j < idx - 3; j++) {
    if (candles[j].high > earlierPriceMax) {
      earlierPriceMax = candles[j].high;
      earlierRsiAtMax = rsiArr[j];
    }
  }
  // Price makes higher high but RSI makes lower high → bearish divergence
  return priceMax > earlierPriceMax && rsiAtMax < earlierRsiAtMax;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Filter Logic
// ─────────────────────────────────────────────────────────────────────────────
export type SessionFilter =
  "ALL_DAY" | "ASIA" | "LONDON" | "LONDON_NY_OVERLAP" | "NEW_YORK";

export function isWithinSession(
  estHour: number,
  filter: SessionFilter | undefined,
): boolean {
  if (!filter || filter === "ALL_DAY") return true;
  if (filter === "ASIA") return estHour >= 18 || estHour < 2; // 6 PM to 2 AM EST
  if (filter === "LONDON") return estHour >= 2 && estHour < 8; // 2 AM to 8 AM EST
  if (filter === "LONDON_NY_OVERLAP") return estHour >= 8 && estHour < 12; // 8 AM to 12 PM EST
  if (filter === "NEW_YORK") return estHour >= 8 && estHour < 17; // 8 AM to 5 PM EST
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADX — Average Directional Index (Wilder's Smoothing)
// ─────────────────────────────────────────────────────────────────────────────
const adxCache = new WeakMap<OHLCVTick[], Record<number, Float64Array>>();

export function buildAdxArray(
  candles: OHLCVTick[],
  period: number = 14,
): Float64Array {
  let cache = adxCache.get(candles);
  if (!cache) {
    cache = {};
    adxCache.set(candles, cache);
  }
  if (cache[period] && cache[period].length === candles.length) return cache[period];

  const result = new Float64Array(candles.length).fill(0);
  if (candles.length <= period * 2) return result;

  const trArr = new Float64Array(candles.length).fill(0);
  const pDmArr = new Float64Array(candles.length).fill(0);
  const mDmArr = new Float64Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    trArr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );

    const upMove = c.high - prev.high;
    const downMove = prev.low - c.low;

    if (upMove > downMove && upMove > 0) pDmArr[i] = upMove;
    if (downMove > upMove && downMove > 0) mDmArr[i] = downMove;
  }

  let trSmooth = 0,
    pDmSmooth = 0,
    mDmSmooth = 0;
  for (let i = 1; i <= period; i++) {
    trSmooth += trArr[i];
    pDmSmooth += pDmArr[i];
    mDmSmooth += mDmArr[i];
  }

  const dxArr = new Float64Array(candles.length).fill(0);
  if (trSmooth > 0) {
    const pDi = 100 * (pDmSmooth / trSmooth);
    const mDi = 100 * (mDmSmooth / trSmooth);
    dxArr[period] =
      pDi + mDi === 0 ? 0 : (100 * Math.abs(pDi - mDi)) / (pDi + mDi);
  }

  for (let i = period + 1; i < candles.length; i++) {
    trSmooth = trSmooth - trSmooth / period + trArr[i];
    pDmSmooth = pDmSmooth - pDmSmooth / period + pDmArr[i];
    mDmSmooth = mDmSmooth - mDmSmooth / period + mDmArr[i];

    if (trSmooth > 0) {
      const pDi = 100 * (pDmSmooth / trSmooth);
      const mDi = 100 * (mDmSmooth / trSmooth);
      dxArr[i] =
        pDi + mDi === 0 ? 0 : (100 * Math.abs(pDi - mDi)) / (pDi + mDi);
    }
  }

  let adxSum = 0;
  for (let i = period + 1; i <= period * 2; i++) {
    adxSum += dxArr[i];
  }
  let adx = adxSum / period;
  result[period * 2] = adx;

  for (let i = period * 2 + 1; i < candles.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]) / period;
    result[i] = adx;
  }

  cache[period] = result;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTITUTIONAL: HURST EXPONENT (Rescaled Range Approximation)
// H < 0.5: Mean Reverting. H > 0.5: Trending. H = 0.5: Random Walk.
// ─────────────────────────────────────────────────────────────────────────────
const hurstCache = new WeakMap<OHLCVTick[], Record<number, Float64Array>>();

export function buildHurstArray(
  candles: OHLCVTick[],
  period: number = 100,
): Float64Array {
  let cache = hurstCache.get(candles);
  if (!cache) {
    cache = {};
    hurstCache.set(candles, cache);
  }
  if (cache[period] && cache[period].length === candles.length) return cache[period];

  const result = new Float64Array(candles.length).fill(0.5);
  for (let i = period; i < candles.length; i++) {
    let mean = 0;
    for (let j = i - period; j < i; j++) {
      mean += candles[j].close;
    }
    mean /= period;

    let sumSq = 0;
    let Y = 0;
    let maxZ = -Infinity;
    let minZ = Infinity;

    for (let j = i - period; j < i; j++) {
      const dev = candles[j].close - mean;
      sumSq += dev * dev;
      Y += dev;
      if (Y > maxZ) maxZ = Y;
      if (Y < minZ) minZ = Y;
    }

    const R = maxZ - minZ;
    const S = Math.sqrt(sumSq / period);

    if (S === 0 || R === 0) continue;

    // Log(R/S) / Log(T) approximation
    const hurst = Math.log(R / S) / Math.log(period);
    result[i] = hurst;
  }
  cache[period] = result;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTITUTIONAL: LOG-RETURN Z-SCORE
// Identifies >3 sigma anomalies in rolling return distribution
// ─────────────────────────────────────────────────────────────────────────────
const zScoreCache = new WeakMap<OHLCVTick[], Record<number, Float64Array>>();

export function buildLogReturnZScoreArray(
  candles: OHLCVTick[],
  period: number = 50,
): Float64Array {
  let cache = zScoreCache.get(candles);
  if (!cache) {
    cache = {};
    zScoreCache.set(candles, cache);
  }
  if (cache[period] && cache[period].length === candles.length) return cache[period];

  const result = new Float64Array(candles.length).fill(0);
  const logReturns = new Float64Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && curr > 0) {
      logReturns[i] = Math.log(curr / prev);
    }
  }

  for (let i = period; i < candles.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += logReturns[j];
    mean /= period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = logReturns[j] - mean;
      sqSum += diff * diff;
    }
    const std = Math.sqrt(sqSum / period);

    if (std > 0) {
      result[i] = (logReturns[i] - mean) / std;
    }
  }

  cache[period] = result;
  return result;
}
