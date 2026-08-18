/**
 * ============================================================
 * TIMEZONE UTILITY — Central timestamp formatter
 * ============================================================
 * All date/time display across the dashboard uses these helpers
 * so that the "Dashboard Timezone" setting in Global Settings
 * is respected everywhere (Bot eye logs, trade diary, analytics,
 * system logs, coven panel, etc.).
 *
 * The selected timezone is stored in localStorage as 'sniper_tz'
 * with values: 'UTC' | 'IST' | 'EST' | 'GMT' | 'JST' | 'AEDT'
 * Default: 'IST'
 * ============================================================
 */

/** Maps the short sniper_tz label to an IANA timezone string. */
export const TZ_MAP: Record<string, string> = {
  UTC:  'UTC',
  IST:  'Asia/Kolkata',
  EST:  'America/New_York',
  GMT:  'Europe/London',
  JST:  'Asia/Tokyo',
  AEDT: 'Australia/Sydney',
};

/** Returns the IANA timezone string from localStorage (default IST). */
export function getIanaTz(): string {
  const key = typeof window !== 'undefined' ? (localStorage.getItem('sniper_tz') || 'IST') : 'IST';
  return TZ_MAP[key] ?? 'Asia/Kolkata';
}

/**
 * Format a timestamp as a date + time string in the user's selected timezone.
 * e.g. "18 Jun 2026, 11:34:05"
 *
 * @param ts - Anything new Date() accepts: ISO string, epoch ms, Date object
 */
export function formatDateTime(ts: string | number | Date | null | undefined): string {
  if (!ts) return 'N/A';
  try {
    let parsedVal: any = ts;
    if (typeof ts === 'string' && /^\d+$/.test(ts)) {
      parsedVal = parseInt(ts, 10);
    }
    const d = new Date(parsedVal);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString('en-GB', {
      timeZone: getIanaTz(),
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }) + ` ${getTzLabel()}`;
  } catch {
    return String(ts);
  }
}

/**
 * Format a timestamp as time only in the user's selected timezone.
 * e.g. "11:34:05 IST"
 */
export function formatTime(ts: string | number | Date): string {
  try {
    let parsedVal: any = ts;
    if (typeof ts === 'string' && /^\d+$/.test(ts)) {
      parsedVal = parseInt(ts, 10);
    }
    return new Date(parsedVal).toLocaleTimeString('en-GB', {
      timeZone: getIanaTz(),
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }) + ` ${getTzLabel()}`;
  } catch {
    return String(ts);
  }
}

/**
 * Format a timestamp as date only in the user's selected timezone.
 * e.g. "18 Jun 2026"
 */
export function formatDate(ts: string | number | Date | null | undefined): string {
  if (!ts) return 'N/A';
  try {
    let parsedVal: any = ts;
    if (typeof ts === 'string' && /^\d+$/.test(ts)) {
      parsedVal = parseInt(ts, 10);
    }
    const d = new Date(parsedVal);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleDateString('en-GB', {
      timeZone: getIanaTz(),
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(ts);
  }
}

/**
 * Returns the current short timezone label e.g. "IST".
 */
export function getTzLabel(): string {
  return typeof window !== 'undefined' ? (localStorage.getItem('sniper_tz') || 'IST') : 'IST';
}

/**
 * Calculates the canonical broker trading day (YYYY-MM-DD) for a given date.
 * Shifts standard New York time by +7 hours to align with the 5:00 PM EST rollover.
 */
export function getBrokerTradingDayStr(date: Date = new Date()): string {
  // 1. Get the EST time string
  const estStr = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  // 2. Parse it back as if it were UTC (the standard timezone hack to do math on local time)
  const estDate = new Date(estStr + " UTC");
  // 3. Add 7 hours so that >= 5:00 PM EST rolls over to the next calendar day
  estDate.setUTCHours(estDate.getUTCHours() + 7);
  // 4. Return YYYY-MM-DD
  return estDate.toISOString().split("T")[0];
}
