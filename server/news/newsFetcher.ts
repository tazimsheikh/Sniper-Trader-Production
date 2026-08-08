import { CalendarEvent } from "./newsStore.js";
import { Scraper } from "forexfactory-scraper";

/**
 * Fetches the economic calendar directly from Forex Factory using the
 * open-source forexfactory-scraper package. This bypasses the need for
 * any API keys or paid subscriptions (like FMP or Finnhub).
 */
export async function fetchLiveEconomicCalendar(): Promise<CalendarEvent[]> {
  try {
    // The scraper automatically fetches this week's data.
    const scraper = new Scraper();
    const rawEvents = await scraper.scrapeCalendar();
    if (!Array.isArray(rawEvents)) return [];

    const mappedEvents: CalendarEvent[] = [];
    const targetCurrencies = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"];

    for (const event of rawEvents) {
      // Forex Factory uses 'High', 'Medium', 'Low', 'Non-Economic'. 
      // We only want High to mimic Red Folders.
      if (event.impact !== "High") continue;
      
      const currency = event.currency?.toUpperCase();
      if (!currency || !targetCurrencies.includes(currency)) continue;
      
      // The scraper returns a full Date object under `date`. 
      // We convert it to strict ISO-8601 UTC string.
      const dateStr = new Date(event.date).toISOString();
      
      mappedEvents.push({
        title: String(event.event),
        country: currency, // The system maps 'country' to the currency code
        date: dateStr,
        impact: "High", // Normalize all Red folders to 'High'
        forecast: String(event.forecast || ""),
        previous: String(event.previous || ""),
        actual: String(event.actual || "")
      });
    }

    // Secondary pass to tag 'Very High' for extreme systemic events (NFP, FOMC, CPI)
    for (const ev of mappedEvents) {
      const titleLower = ev.title.toLowerCase();
      if (
        titleLower.includes("non-farm employment") ||
        titleLower.includes("non farm") ||
        titleLower.includes("fomc") ||
        titleLower.includes("fed interest rate") ||
        titleLower.includes("cpi") ||
        titleLower.includes("consumer price index")
      ) {
        ev.impact = "Very High";
      }
    }

    return mappedEvents;
  } catch (err: any) {
    console.error("[NewsFetcher] Failed to fetch economic calendar from ForexFactory:", err.message);
  }

  return [];
}
