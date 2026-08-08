import { AggregatedCandle } from "../config/types.js";
import { aggregateCandles } from "./CandleAggregator.js";
import { logger } from "../../utils/logger.js";


export interface HTFPrecomputedData {
  h1IndexMap: Int32Array;
  ema50: Float64Array;
}

export class HTFContextTracker {
  public static precomputeHTFData(m5Candles: AggregatedCandle[]): HTFPrecomputedData {
    const h1Candles = aggregateCandles(m5Candles as any, 60);
    const closes = new Float64Array(h1Candles.length);
    for (let i = 0; i < h1Candles.length; i++) {
      closes[i] = h1Candles[i].close;
    }
    const ema50 = this.calculateEmaTyped(closes, 50);

    const h1IndexMap = new Int32Array(m5Candles.length);
    let h1Idx = 0;
    for (let i = 0; i < m5Candles.length; i++) {
      const ts = m5Candles[i].timestamp;
      while (h1Idx + 1 < h1Candles.length && h1Candles[h1Idx + 1].timestamp <= ts) {
        h1Idx++;
      }
      h1IndexMap[i] = Math.max(0, h1Idx - 1);
    }

    return { h1IndexMap, ema50 };
  }

  public static isTrendParabolicFast(
    htfData: HTFPrecomputedData,
    m5Index: number,
    direction: "BUY" | "SELL",
    maxSlopePips: number,
    pipSize: number,
  ): boolean {
    const h1Idx = htfData.h1IndexMap[m5Index];
    if (h1Idx < 54) return false;

    const currentEma50 = htfData.ema50[h1Idx];
    const prevEma50 = htfData.ema50[h1Idx - 3];
    if (!currentEma50 || !prevEma50) return false;

    const slope = (currentEma50 - prevEma50) / 3 / pipSize;

    if (direction === "BUY") {
      if (slope < -maxSlopePips) return true;
    } else if (direction === "SELL") {
      if (slope > maxSlopePips) return true;
    }
    return false;
  }

  /**
   * Helper to compute the H1 50 EMA and its steepness from an array of M5 candles.
   * Calculates the steepness (in pips per hour) of the 50 EMA over the last few hours.
   */
  public static isTrendParabolic(
    m5Buffer: AggregatedCandle[],
    direction: "BUY" | "SELL",
    maxSlopePips: number,
    pipSize: number,
  ): boolean {
    if (m5Buffer.length < 500) {
      return false;
    } // Not enough data for 50 H1 candles

    // 1. Aggregate to H1 candles
    const h1Candles = aggregateCandles(m5Buffer as any, 60);
    if (h1Candles.length < 56) {
      return false;
    }

    // 2. Compute 50 EMA using completed H1 candles only
    const completedCloses = h1Candles.slice(0, -1).map((c) => c.close);
    const ema50 = this.calculateEma(completedCloses, 50);

    const len = ema50.length;
    const currentEma50 = ema50[len - 1];
    const prevEma50 = ema50[len - 4]; // 3 hours ago

    if (!currentEma50 || !prevEma50) return false;

    // Calculate slope in pips per hour (change over 3 hours / 3)
    const slope = (currentEma50 - prevEma50) / 3 / pipSize;

    // Directional Parabolic Check
    if (direction === "BUY") {
      if (slope < -maxSlopePips) {
        return true; // Parabolic downside, don't catch the falling knife
      }
    } else if (direction === "SELL") {
      if (slope > maxSlopePips) {
        return true; // Parabolic upside, don't step in front of the train
      }
    }

    return false;
  }

  private static calculateEmaTyped(prices: Float64Array, period: number): Float64Array {
    const k = 2 / (period + 1);
    const emaArray = new Float64Array(prices.length);
    let ema = prices[0];
    emaArray[0] = ema;

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] - ema) * k + ema;
      emaArray[i] = ema;
    }
    return emaArray;
  }

  private static calculateEma(prices: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const emaArray = new Array(prices.length).fill(0);
    let ema = prices[0];
    emaArray[0] = ema;

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] - ema) * k + ema;
      emaArray[i] = ema;
    }
    return emaArray;
  }
}

