import { isNewsForceClose } from "../../market/historicalNews.js";
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
    
    m1Typed.isEOD_standard[i] = 0;
    
    if (i > 0) {
      const prevH = m1Rows[i - 1].estHour;
      m1Typed.isSessionReset[i] = ((prevH < 15 && h >= 15) || (prevH > h && h >= 15) || (h === 15 && m === 0)) ? 1 : 0;
      m1Typed.isMidnightExpiry[i] = (prevH > h && h < 15) ? 1 : 0;
    }
    
    const dateStr = getFixedEstDate(new Date(r.timestamp)).toISOString().split('T')[0];
    m1Typed.isNewsForceClose[i] = isNewsForceClose(dateStr, h, m) ? 1 : 0;
  }
  return m1Typed;
}
