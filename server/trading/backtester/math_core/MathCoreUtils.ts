// ── Epsilon-aware floating-point comparison helpers ──
// IEEE 754 float math produces values like 1.2503000000000002 instead of 1.2503.
// These helpers prevent fractional SL hits and trade misses from sub-nano jitter.
export const PRICE_EPSILON = 1e-9;
export const gte = (a: number, b: number): boolean => (a - b) >= -PRICE_EPSILON;
export const lte = (a: number, b: number): boolean => (b - a) >= -PRICE_EPSILON;

import { isNewsForceClose } from "../../market/historicalNews.js";
import { isEODSession } from "../../market/MathFilters.js";
export function getFixedEstDate(date = new Date()): Date {
  if ((global as any).__SIM_TIME_PROVIDER__) {
    return (global as any).__SIM_TIME_PROVIDER__(date);
  }
  const y = date.getUTCFullYear();
  const marchFirst = new Date(Date.UTC(y, 2, 1));
  const daysToFirstSunday = (7 - marchFirst.getUTCDay()) % 7;
  const secondSundayMarch = new Date(Date.UTC(y, 2, 1 + daysToFirstSunday + 7, 7, 0, 0));
  const novFirst = new Date(Date.UTC(y, 10, 1));
  const daysToFirstSunNov = (7 - novFirst.getUTCDay()) % 7;
  const firstSundayNov = new Date(Date.UTC(y, 10, 1 + daysToFirstSunNov, 6, 0, 0));
  const t = date.getTime();
  const isDST = t >= secondSundayMarch.getTime() && t < firstSundayNov.getTime();
  const offsetHours = isDST ? -4 : -5;
  return new Date(t + offsetHours * 60 * 60 * 1000);
}

export function buildM1TypedArrays(m1Rows: any[], NFP_DATES: Set<string>, CPI_DATES: Set<string>, FOMC_DATES: Set<string>): any {
  const m1Length = m1Rows.length;
  const m1Typed = {
    open: new Float64Array(m1Length),
    high: new Float64Array(m1Length),
    low: new Float64Array(m1Length),
    close: new Float64Array(m1Length),
    timestamp: new Float64Array(m1Length),
    estHour: new Int32Array(m1Length),
    minute: new Int32Array(m1Length),
    isEOD_standard: new Uint8Array(m1Length),
    isSessionReset: new Uint8Array(m1Length),
    isMidnightExpiry: new Uint8Array(m1Length),
    isNewsForceClose: new Uint8Array(m1Length),
    length: m1Length,
  };
  for (let i = 0; i < m1Length; i++) {
    const r = m1Rows[i];
    m1Typed.open[i] = r.open;
    m1Typed.high[i] = r.high;
    m1Typed.low[i] = r.low;
    m1Typed.close[i] = r.close;
    m1Typed.timestamp[i] = r.timestamp;
    
    const h = r.estHour;
    const m = r.minute;
    m1Typed.estHour[i] = h;
    m1Typed.minute[i] = m;
    
    const isWeekendGap = i + 1 < m1Length && (m1Rows[i + 1].timestamp - r.timestamp > 24 * 3600 * 1000);
    m1Typed.isEOD_standard[i] = (isEODSession(h, m) || isWeekendGap) ? 1 : 0;
    
    if (i > 0) {
      const prevH = m1Rows[i - 1].estHour;
      m1Typed.isSessionReset[i] = ((prevH < 17 && h >= 17) || (prevH > h && h >= 17) || (h === 17 && m === 0)) ? 1 : 0;
      m1Typed.isMidnightExpiry[i] = (prevH > h && h < 17) ? 1 : 0;
    }
    
    const dateStr = getFixedEstDate(new Date(r.timestamp)).toISOString().split('T')[0];
    m1Typed.isNewsForceClose[i] = isNewsForceClose(dateStr, h, m) ? 1 : 0;
  }
  return m1Typed;
}
