import { fetchLiveEconomicCalendar } from './newsAgent';

export interface CalendarEvent {
  title: string;
  country: string;
  date: string; // ISO string
  impact: 'High' | 'Medium' | 'Low';
  forecast: string;
  previous: string;
  actual: string;
  deviation?: 'positive' | 'negative' | 'neutral' | null;
}

let cachedEvents: CalendarEvent[] = [];
let lastFetchTime = 0;
let lastErrorTime = 0;
let isFetching = false;

export async function getCalendarData(forceRefresh: boolean = false): Promise<CalendarEvent[]> {
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const FIVE_MINUTES = 5 * 60 * 1000;
  const now = Date.now();
  
  // Return cache if valid
  if (!forceRefresh && cachedEvents.length > 0 && (now - lastFetchTime < TWELVE_HOURS)) {
    return cachedEvents;
  }

  // Prevent spamming API if it recently failed (cooldown)
  if (!forceRefresh && (now - lastErrorTime < FIVE_MINUTES)) {
    return cachedEvents;
  }

  if (isFetching) {
    // Wait slightly or return stale cache if fetching
    if (cachedEvents.length > 0) return cachedEvents;
  }

  isFetching = true;
  try {
    const data = await fetchLiveEconomicCalendar();
    if (Array.isArray(data) && data.length > 0) {
      cachedEvents = data;
      lastFetchTime = now;
      lastErrorTime = 0; // Reset error time on success
      console.log(`[NewsStore] Fetched and cached ${data.length} economic events from Gemini.`);
    } else {
      lastErrorTime = now;
      console.warn('[NewsStore] Fetched data was empty or invalid, applying 5-minute cooldown.');
    }
  } catch (err) {
    console.warn('[NewsStore] Failed to fetch calendar:', err);
    lastErrorTime = now;
  } finally {
    isFetching = false;
  }
  
  return cachedEvents;
}

export function getSyntheticCalendarFallback(): any[] {
  // Return empty array to rely strictly on the API fetching or graceful degradation
  return [];
}

/**
 * Checks if the current time is within +/- 5 minutes of a HIGH impact news event
 * for the currencies involved in the brokerSymbol.
 */
export function isNewsBlackout(brokerSymbol: string, now: Date = new Date()): boolean {
  if (!cachedEvents || cachedEvents.length === 0) return false;
  
  const relevantCurrencies = new Set<string>();
  
  // Extract currencies from symbol (e.g., EURUSD -> EUR, USD)
  if (brokerSymbol.length === 6) {
    relevantCurrencies.add(brokerSymbol.substring(0, 3));
    relevantCurrencies.add(brokerSymbol.substring(3, 6));
  } else if (brokerSymbol.includes('XAU') || brokerSymbol.includes('NAS') || brokerSymbol.includes('USTEC')) {
    relevantCurrencies.add('USD');
  }

  const nowMs = now.getTime();
  const FIVE_MIN_MS = 5 * 60 * 1000;

  for (const event of cachedEvents) {
    if (event.impact === 'High' && relevantCurrencies.has(event.country)) {
      const eventTime = new Date(event.date).getTime();
      if (Math.abs(nowMs - eventTime) <= FIVE_MIN_MS) {
        return true;
      }
    }
  }
  return false;
}
