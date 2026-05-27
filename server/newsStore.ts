import { fetchLiveEconomicCalendar, fetchEventResult } from './newsAgent';

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
let isFetching = false;

// Poll interval for fetching actuals
let pollInterval: NodeJS.Timeout | null = null;

export async function getCalendarData(): Promise<CalendarEvent[]> {
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const now = Date.now();
  
  // Return cache if valid
  if (cachedEvents.length > 0 && (now - lastFetchTime < TWELVE_HOURS)) {
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
      
      // Start the actuals polling loop if not running
      if (!pollInterval) {
        pollInterval = setInterval(checkPendingActuals, 60000); // Check every minute
      }
    }
  } catch (err) {
    console.warn('[NewsStore] Failed to fetch calendar:', err);
  } finally {
    isFetching = false;
  }
  
  return cachedEvents;
}

export function getSyntheticCalendarFallback(): any[] {
  // Return empty array to rely strictly on the AI fetching or graceful degradation
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

/**
 * Background loop that checks if a HIGH/MEDIUM event passed and lacks an 'actual'.
 * If so, and it's been at least 5 minutes since the event, fetches the result.
 */
async function checkPendingActuals() {
  const nowMs = Date.now();
  const FIVE_MIN_MS = 5 * 60 * 1000;
  
  for (const event of cachedEvents) {
    if (!event.actual || event.actual.trim() === '') {
      if (event.impact === 'High' || event.impact === 'Medium') {
        const eventTime = new Date(event.date).getTime();
        
        // If the event happened more than 5 minutes ago, try to fetch actuals
        if (nowMs > (eventTime + FIVE_MIN_MS) && nowMs < (eventTime + 4 * 60 * 60 * 1000)) {
          // Only attempt if we haven't already marked it as pending or tried recently.
          // To prevent spamming Gemini every minute, we'll use a hack: set actual to 'Fetching...'
          event.actual = 'Fetching...';
          
          try {
            console.log(`[NewsStore] Fetching post-release actuals for ${event.title} (${event.country})...`);
            const result = await fetchEventResult(event.title, event.country, event.date);
            if (result && result.actual) {
              event.actual = result.actual;
              event.deviation = result.deviation;
              console.log(`[NewsStore] Updated ${event.title} Actual: ${event.actual}`);
            } else {
              // If not found, reset to empty so it tries again in a minute (with risk of spam, so let's delay it)
              // We'll set it back to empty after 10 minutes to retry, or leave as 'Fetching...'
              setTimeout(() => {
                if (event.actual === 'Fetching...') event.actual = '';
              }, 10 * 60 * 1000);
            }
          } catch (e) {
            console.error(`[NewsStore] Error fetching actuals:`, e);
            event.actual = '';
          }
        }
      }
    }
  }
}
