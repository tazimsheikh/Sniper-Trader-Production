// ─────────────────────────────────────────────────────────────────────────────
// CANDLE AGGREGATOR
// Converts M1 tick rows (same format as Darwin.ts reads) into higher timeframes.
// All outputs are arrays of OHLCV candles with attached timestamps.
// ─────────────────────────────────────────────────────────────────────────────
import { AggregatedCandle } from "../config/types.js";

/** Minutes per timeframe */
export type Timeframe = 5 | 15 | 30 | 60 | 240;

/**
 * Aggregate M1 rows (from Darwin CSV reader) into the target timeframe.
 * Input rows must be sorted chronologically.
 */
export function aggregateCandles(
  m1Rows: Array<{
    dateStr: string;
    hour: number;
    minute: number;
    utcMonth: number;
    open: number;
    high: number;
    low: number;
    close: number;
    tickVol: number;
    spread?: number;
    timestamp?: number;
    estHour?: number;
  }>,
  tf: Timeframe,
): AggregatedCandle[] {
  const result: AggregatedCandle[] = [];
  let current: AggregatedCandle | null = null;
  let currentBlock = -1;

  let i = 0;
  for (const row of m1Rows) {
    if (!row) continue;
    let ts: number | undefined = row.timestamp;
    if (ts === undefined && (row as any).time) {
      ts = new Date((row as any).time).getTime();
    }
    if (ts === undefined && row.dateStr && typeof row.dateStr === "string") {
      const parts = row.dateStr.split("-");
      if (parts.length >= 3) {
        ts = Date.UTC(
          parseInt(parts[0]),
          parseInt(parts[1]) - 1,
          parseInt(parts[2]),
          row.hour || 0,
          row.minute || 0,
        );
      }
    }
    if (ts === undefined || isNaN(ts)) continue;

    const block = Math.floor(ts / (tf * 60_000));

    if (block !== currentBlock || !current) {
      if (current) result.push(current);

      let estHour: number;
      if (row.estHour !== undefined) {
        estHour = row.estHour;
      } else {
        // Use Intl.DateTimeFormat for DST-aware EST conversion.
        // The hardcoded -7 offset was wrong during the 2-3 week window each March and
        // November when US and EU DST transitions are misaligned (gap is 6h, not 7h).
        const rowDate = new Date(ts);
        const nyHourStr = rowDate.toLocaleString("en-US", {
          hour: "numeric",
          hour12: false,
          timeZone: "America/New_York",
        });
        estHour = parseInt(nyHourStr, 10);
        if (isNaN(estHour) || estHour === 24) estHour = 0;
        if (estHour < 0) estHour += 24;
      }

      current = {
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.tickVol || 0,
        tickVolume: row.tickVol,
        timestamp: ts,
        dateStr: row.dateStr,
        estHour,
        estMin: row.minute,
        maxSpread: row.spread || 0,
        m1StartIndex: i,
        m1Count: 1,
        isPartial: false,
      };
      currentBlock = block;
    } else {
      if (row.high > current.high) current.high = row.high;
      if (row.low < current.low) current.low = row.low;
      current.close = row.close;
      if (row.tickVol) {
        current.volume += row.tickVol;
        if (current.tickVolume) current.tickVolume += row.tickVol;
      }
      if (row.spread && row.spread > (current.maxSpread || 0)) {
        current.maxSpread = row.spread;
      }
      current.m1Count = (current.m1Count || 0) + 1;
    }
    if (current && (current.m1Count || 0) < tf) {
      current.isPartial = true;
    }
    i++;
  }
  if (current) {
    if ((current.m1Count || 0) < tf) current.isPartial = true;
    result.push(current);
  }
  return result;
}

/**
 * Build a sliding map from M5 candle index → matching M15/H1/H4 candle index.
 * Useful for fast lookups during backtesting without re-searching arrays.
 */
export function buildTimeframeIndex(
  baseCandles: AggregatedCandle[],
  htfCandles: AggregatedCandle[],
  baseDurationMs: number,
  htfDurationMs: number,
): Int32Array {
  const idx = new Int32Array(baseCandles.length).fill(-1);
  let htfPointer = 0;

  for (let i = 0; i < baseCandles.length; i++) {
    const baseCloseTime = baseCandles[i].timestamp + baseDurationMs;

    // Advance htfPointer to the last HTF candle that COMPLETED at or before the base close
    while (
      htfPointer + 1 < htfCandles.length &&
      htfCandles[htfPointer + 1].timestamp + htfDurationMs <= baseCloseTime
    ) {
      htfPointer++;
    }

    // Ensure the current htfPointer is actually valid (it might not have finished yet)
    if (
      htfCandles[htfPointer] &&
      htfCandles[htfPointer].timestamp + htfDurationMs <= baseCloseTime
    ) {
      idx[i] = htfPointer;
    } else {
      idx[i] = -1; // No completed HTF candle available yet
    }
  }
  return idx;
}
