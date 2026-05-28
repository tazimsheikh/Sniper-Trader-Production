import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { CandleProvider, LiveQuote, OHLCVCandle } from './candleProvider';

const activeMetaUrl = typeof import.meta !== 'undefined' && import.meta.url ? import.meta.url : undefined;
const resolvedFilename = activeMetaUrl ? fileURLToPath(activeMetaUrl) : (typeof __filename !== 'undefined' ? __filename : '');
const resolvedDirname = activeMetaUrl ? path.dirname(resolvedFilename) : (typeof __dirname !== 'undefined' ? __dirname : '');

// Memory-efficient flat TypedArray storage for historical data
interface CsvCandleData {
  timestamps: Float64Array;
  opens: Float32Array;
  highs: Float32Array;
  lows: Float32Array;
  closes: Float32Array;
  length: number;
}

const historicalData: Record<string, CsvCandleData> = {};

// Cursor indices to cache search position for sequential lookups
const cursorIndices: Record<string, number> = {};

// Keep track of the current simulated time
let simulatedTimeMs: number = 0;

export function setSimulatedTime(ms: number) {
  if (ms < simulatedTimeMs) {
    // If simulated time jumps backward, reset search cursors to ensure correctness
    for (const key of Object.keys(cursorIndices)) {
      cursorIndices[key] = 0;
    }
  }
  simulatedTimeMs = ms;
}

// Memory-efficient streaming CSV parser
export async function loadCsvData(symbol: string, fileName: string): Promise<void> {
  const filePath = path.join(resolvedDirname, '..', 'data', fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`[SimulationProvider] Missing CSV for ${symbol}: ${filePath}`);
    return;
  }

  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const timestamps: number[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];

  let isFirstLine = true;

  for await (const line of rl) {
    if (isFirstLine) {
      isFirstLine = false;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Fast-path year filtering before split
    if (!trimmed.startsWith('2025') && !trimmed.startsWith('2026')) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 6) continue;

    const [dateStr, timeStr, open, high, low, close] = parts;
    if (dateStr < '2025.04.15') continue;

    const dateFormatted = dateStr.replace(/\./g, '-');
    const timestamp = new Date(`${dateFormatted}T${timeStr}Z`).getTime();

    timestamps.push(timestamp);
    opens.push(parseFloat(open));
    highs.push(parseFloat(high));
    lows.push(parseFloat(low));
    closes.push(parseFloat(close));
  }

  historicalData[symbol] = {
    timestamps: new Float64Array(timestamps),
    opens: new Float32Array(opens),
    highs: new Float32Array(highs),
    lows: new Float32Array(lows),
    closes: new Float32Array(closes),
    length: timestamps.length
  };

  cursorIndices[symbol] = 0;
  console.log(`[SimulationProvider] Loaded ${timestamps.length} candles for ${symbol}`);
}

// Find index of the candle closest to (but not exceeding) simulatedTimeMs
function getCandleIndexAtTime(symbol: string, targetTimeMs: number): number {
  const data = historicalData[symbol];
  if (!data || data.length === 0) return -1;

  if (cursorIndices[symbol] === undefined) {
    cursorIndices[symbol] = 0;
  }

  let cursor = cursorIndices[symbol];
  if (cursor >= data.length) {
    cursor = data.length - 1;
  }

  // Fast path: Sequential chronological scanning O(1)
  if (data.timestamps[cursor] <= targetTimeMs) {
    while (cursor + 1 < data.length && data.timestamps[cursor + 1] <= targetTimeMs) {
      cursor++;
    }
    cursorIndices[symbol] = cursor;
    return cursor;
  }

  // Fallback: Binary search O(log N) if time jumps or runs backward
  let left = 0;
  let right = data.length - 1;
  let best = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (data.timestamps[mid] <= targetTimeMs) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (best !== -1) {
    cursorIndices[symbol] = best;
  }
  return best;
}

// Fix undefined function error in botManager.ts
export function getSimulationPrice(symbol: string): number {
  const currentIdx = getCandleIndexAtTime(symbol, simulatedTimeMs);
  if (currentIdx === -1) return 0;
  const data = historicalData[symbol];
  return data ? data.closes[currentIdx] : 0;
}

export const SimulationProvider: CandleProvider = {
  source: 'simulation' as any,

  async getDailyCandles(_yahoo: string, broker: string, days: number): Promise<OHLCVCandle[]> {
    const currentIdx = getCandleIndexAtTime(broker, simulatedTimeMs);
    if (currentIdx === -1) return [];

    const data = historicalData[broker];
    if (!data) return [];

    const dailyCandles = new Map<string, OHLCVCandle>();
    const targetMs = simulatedTimeMs - (days + 2) * 24 * 60 * 60 * 1000;

    let i = currentIdx;
    while (i >= 0 && data.timestamps[i] >= targetMs) {
      const timestamp = data.timestamps[i];
      const dateKey = new Date(timestamp).toISOString().split('T')[0];
      
      const open = data.opens[i];
      const high = data.highs[i];
      const low = data.lows[i];
      const close = data.closes[i];

      if (!dailyCandles.has(dateKey)) {
        dailyCandles.set(dateKey, {
          date: dateKey,
          open,
          high,
          low,
          close
        });
      } else {
        const d = dailyCandles.get(dateKey)!;
        d.high = Math.max(d.high, high);
        d.low = Math.min(d.low, low);
        d.open = open; // Walking backward: earlier candle overrides open
      }
      i--;
    }

    return Array.from(dailyCandles.values()).reverse();
  },

  async getMinuteCandles(_yahoo: string, broker: string, minutes: number): Promise<OHLCVCandle[]> {
    const currentIdx = getCandleIndexAtTime(broker, simulatedTimeMs);
    if (currentIdx === -1) return [];

    const data = historicalData[broker];
    if (!data) return [];

    const startIdx = Math.max(0, currentIdx - minutes + 1);
    const result: OHLCVCandle[] = [];

    for (let i = startIdx; i <= currentIdx; i++) {
      result.push({
        date: new Date(data.timestamps[i]).toISOString(),
        open: data.opens[i],
        high: data.highs[i],
        low: data.lows[i],
        close: data.closes[i]
      });
    }

    return result;
  },

  async get15MinuteCandles(_yahoo: string, broker: string, count: number): Promise<OHLCVCandle[]> {
    const currentIdx = getCandleIndexAtTime(broker, simulatedTimeMs);
    if (currentIdx === -1) return [];

    const data = historicalData[broker];
    if (!data) return [];

    const result: OHLCVCandle[] = [];
    
    let i = currentIdx;
    let current15M: OHLCVCandle | null = null;
    let current15MStartMs = 0;

    while (i >= 0 && result.length < count) {
      const ms = data.timestamps[i];
      const d = new Date(ms);
      
      d.setSeconds(0, 0);
      d.setMinutes(Math.floor(d.getMinutes() / 15) * 15);
      const boundaryMs = d.getTime();

      if (!current15M || current15MStartMs !== boundaryMs) {
        if (current15M) {
          result.push(current15M);
          if (result.length >= count) break;
        }
        current15MStartMs = boundaryMs;
        current15M = {
          date: new Date(boundaryMs).toISOString(),
          open: data.opens[i],
          high: data.highs[i],
          low: data.lows[i],
          close: data.closes[i]
        };
      } else {
        current15M.high = Math.max(current15M.high, data.highs[i]);
        current15M.low = Math.min(current15M.low, data.lows[i]);
        current15M.open = data.opens[i];
      }
      i--;
    }
    
    if (current15M && result.length < count) {
      result.push(current15M);
    }

    return result.reverse();
  },

  async getLiveQuote(_yahoo: string, broker: string): Promise<LiveQuote> {
    const currentIdx = getCandleIndexAtTime(broker, simulatedTimeMs);
    if (currentIdx === -1) {
      return {
        symbol: broker,
        bid: 0,
        ask: 0,
        price: 0,
        time: new Date(simulatedTimeMs)
      };
    }
    const data = historicalData[broker];
    const price = data.closes[currentIdx];
    return {
      symbol: broker,
      bid: price,
      ask: price,
      price: price,
      time: new Date(simulatedTimeMs)
    };
  },

  async getLiveQuoteBatch(symbols: Array<{ yahoo: string; broker: string }>): Promise<LiveQuote[]> {
    return Promise.all(symbols.map(s => this.getLiveQuote(s.yahoo, s.broker)));
  }
};
