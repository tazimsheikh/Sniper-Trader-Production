import { fetchLiveEconomicCalendar } from "./newsFetcher.js";

export interface CalendarEvent {
  title: string;
  country: string;
  date: string; // ISO string
  impact: "High" | "Very High";
  forecast: string;
  previous: string;
  actual: string;
}

let cachedEvents: CalendarEvent[] = [];
let isFetching = false;
let lastSuccessfulFetchDate: string = ""; // 'YYYY-MM-DD'
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function setCachedEventsForTesting(events: CalendarEvent[]) {
  cachedEvents = events;
}

const RETRY_INTERVAL_MS = 5 * 60 * 1000; // Retry every 5 minutes on failure
const GUARDIAN_INTERVAL_MS = 30 * 60 * 1000; // Guardian check every 30 minutes

function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWS IMPACT KNOWLEDGE BASE
// Research-backed: which events are systemic (halt ALL pairs), which are direct
// (halt only the affected currency's pairs), and how long to block.
//
// Tiers:
//   CRITICAL  → Systemic. Halts all pairs. Wide windows. (NFP, FOMC, US CPI)
//   HIGH      → Direct. Halts only the currency's pairs. Medium windows.
//   MODERATE  → Direct. Halts only the currency's pairs. Narrow windows.
// ─────────────────────────────────────────────────────────────────────────────

// All pairs the system trades — used for "ALL" (systemic) events
const ALL_TRADED_PAIRS = new Set([
  "AUDJPY",
  "AUDUSD",
  "CADJPY",
  "CHFJPY",
  "EURAUD",
  "EURCAD",
  "EURJPY",
  "EURUSD",
  "GBPAUD",
  "GBPCAD",
  "GBPJPY",
  "GBPUSD",
  "GER40",
  "NAS100",
  "NZDUSD",
  "US30",
  "USDCAD",
  "USDCHF",
  "USDJPY",
  "XAUUSD"
]);

interface NewsRule {
  keywords: string[]; // Keywords to match against event title (case-insensitive)
  tier: "CRITICAL" | "HIGH" | "MODERATE";
  systemic: boolean; // true = blocks ALL pairs, false = blocks only affected currency pairs
  affectedCurrencies: string[]; // Currencies whose pairs get blocked (used when systemic=false)
  minutesBefore: number; // Block window before event
  minutesAfter: number; // Block window after event
}

const NEWS_RULES: NewsRule[] = [
  // ── TIER 1: CRITICAL — SYSTEMIC EVENTS ────────────────────────────────────
  // These halt ALL pairs due to global USD dominance and risk-off cascade.
  // Professional standard: 15–30 min before, 15–30 min after.
  {
    keywords: ["non-farm", "nonfarm", "nfp", "non farm payroll"],
    tier: "CRITICAL",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 20,
    minutesAfter: 20,
  },
  {
    keywords: [
      "fomc",
      "federal reserve",
      "fed rate",
      "federal funds rate",
      "fomc statement",
      "fomc minutes",
    ],
    tier: "CRITICAL",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 20,
    minutesAfter: 30,
  },
  {
    keywords: [
      "fomc press conference",
      "fed press conference",
      "powell",
      "fed chair",
    ],
    tier: "CRITICAL",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 5,
    minutesAfter: 30,
  },
  {
    // US CPI — Directly moves USD, Gold, and NAS100, then ripples to all pairs
    keywords: ["cpi", "consumer price index", "core cpi", "core inflation"],
    tier: "CRITICAL",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 15,
    minutesAfter: 15,
    // NOTE: Only applies when country === 'USD'. Non-USD CPI handled by HIGH rules below.
  },

  // ── TIER 2: HIGH — CENTRAL BANK RATE DECISIONS (Direct) ──────────────────
  // These primarily move the specific currency's pairs but can have spillover.
  // Professional standard: 10–15 min before, 15–20 min after.
  {
    keywords: [
      "ecb rate",
      "ecb decision",
      "european central bank",
      "ecb monetary",
      "ecb policy",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["EUR"],
    minutesBefore: 15,
    minutesAfter: 20,
  },
  {
    keywords: ["ecb press conference", "lagarde"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["EUR"],
    minutesBefore: 5,
    minutesAfter: 20,
  },
  {
    keywords: [
      "boe rate",
      "boe decision",
      "bank of england",
      "mpc rate",
      "boe monetary",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["GBP"],
    minutesBefore: 15,
    minutesAfter: 20,
  },
  {
    keywords: ["boe press conference", "bailey"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["GBP"],
    minutesBefore: 5,
    minutesAfter: 20,
  },
  {
    // BOJ carries global risk-off risk via carry trade unwinding — affects ALL JPY pairs
    keywords: [
      "boj rate",
      "boj decision",
      "bank of japan",
      "boj monetary",
      "boj policy",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["JPY"],
    minutesBefore: 15,
    minutesAfter: 25,
  },
  {
    keywords: [
      "rba rate",
      "rba decision",
      "reserve bank of australia",
      "rba monetary",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["AUD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    keywords: ["boc rate", "boc decision", "bank of canada", "boc monetary"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["CAD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    keywords: [
      "rbnz rate",
      "rbnz decision",
      "reserve bank of new zealand",
      "rbnz monetary",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["NZD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    keywords: ["snb rate", "snb decision", "swiss national bank"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["CHF"],
    minutesBefore: 10,
    minutesAfter: 15,
  },

  // ── TIER 2: HIGH — MAJOR DATA RELEASES ────────────────────────────────────
  {
    // UK CPI — direct GBP impact
    keywords: ["uk cpi", "uk consumer price", "uk inflation", "gb cpi"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["GBP"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // Eurozone CPI — direct EUR impact
    keywords: [
      "euro cpi",
      "eurozone cpi",
      "euro area cpi",
      "eurozone inflation",
      "eu cpi",
      "euro inflation",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["EUR"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // AUS CPI — direct AUD impact; China proxy effect
    keywords: ["australia cpi", "australia inflation", "aus cpi"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["AUD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // Canada CPI
    keywords: ["canada cpi", "canada inflation", "cad cpi", "canadian cpi"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["CAD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // NZ CPI
    keywords: ["new zealand cpi", "nz cpi", "nzd cpi", "nz inflation"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["NZD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // Japan CPI
    keywords: [
      "japan cpi",
      "jpy cpi",
      "tokyo cpi",
      "japan inflation",
      "japan consumer price",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["JPY"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // AUS Employment — major AUD mover (Reserve Bank is data-dependent)
    keywords: [
      "australia employment",
      "australia jobs",
      "australia unemployment",
      "aus employment",
      "aus jobs",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["AUD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // Canada Employment
    keywords: [
      "canada employment",
      "canada jobs",
      "canada unemployment",
      "canadian employment",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["CAD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // NZ Employment
    keywords: [
      "new zealand employment",
      "nz employment",
      "nz jobs",
      "nz unemployment",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["NZD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // UK GDP
    keywords: ["uk gdp", "uk gross domestic", "gb gdp", "united kingdom gdp"],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["GBP"],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // US GDP — large USD mover, systemic like CPI
    keywords: ["us gdp", "gdp q", "gross domestic product"],
    tier: "HIGH",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 10,
    minutesAfter: 15,
  },
  {
    // US Retail Sales
    keywords: ["retail sales", "core retail sales"],
    tier: "HIGH",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 10,
    minutesAfter: 10,
  },
  {
    // US PPI
    keywords: ["ppi", "producer price index", "producer prices"],
    tier: "HIGH",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 10,
    minutesAfter: 10,
  },
  {
    // China PMI — affects AUD, NZD through commodity/risk sentiment channel
    keywords: [
      "china pmi",
      "caixin pmi",
      "china manufacturing pmi",
      "china services pmi",
    ],
    tier: "HIGH",
    systemic: false,
    affectedCurrencies: ["AUD", "NZD"],
    minutesBefore: 10,
    minutesAfter: 15,
  },

  // ── TIER 3: MODERATE — SECONDARY DATA ────────────────────────────────────
  // Lower volatility, shorter windows, pair-specific only.
  {
    keywords: ["ism manufacturing", "ism services", "ism pmi", "us ism"],
    tier: "MODERATE",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 5,
    minutesAfter: 10,
  },
  {
    keywords: ["adp employment", "adp nonfarm", "adp non-farm"],
    tier: "MODERATE",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 5,
    minutesAfter: 10,
  },
  {
    keywords: ["initial jobless", "jobless claims", "unemployment claims"],
    tier: "MODERATE",
    systemic: true,
    affectedCurrencies: [],
    minutesBefore: 5,
    minutesAfter: 5,
  },
  {
    // Oil inventories / OPEC affects CAD pairs (Canada = major oil exporter)
    keywords: ["crude oil inventories", "eia crude", "opec", "oil production"],
    tier: "MODERATE",
    systemic: false,
    affectedCurrencies: ["CAD"],
    minutesBefore: 5,
    minutesAfter: 10,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING ENGINE
// Match a CalendarEvent to a rule, respecting the "systemic USD-only" override
// for CRITICAL events where the news source currency matters.
// ─────────────────────────────────────────────────────────────────────────────

function findMatchingRule(event: CalendarEvent): NewsRule | null {
  const titleLower = event.title.toLowerCase();

  for (const rule of NEWS_RULES) {
    const keywordMatch = rule.keywords.some((kw) => titleLower.includes(kw));
    if (!keywordMatch) continue;

    // Special case: CPI is CRITICAL only when it's the USD (US) release.
    // Non-USD CPI (e.g., EU CPI) will be caught by the EUR-specific HIGH rules below.
    // If this is the CRITICAL CPI rule, only apply it to USD events.
    if (
      rule.tier === "CRITICAL" &&
      rule.keywords.includes("cpi") &&
      event.country !== "USD"
    ) {
      continue;
    }

    return rule;
  }
  return null;
}

/**
 * Get the set of pairs that should be blocked for a given event.
 * Systemic events block ALL traded pairs.
 * Direct events block only pairs that contain the affected currencies.
 */
function getBlockedPairs(rule: NewsRule): Set<string> {
  if (rule.systemic) {
    return ALL_TRADED_PAIRS;
  }

  const blocked = new Set<string>();
  for (const pair of ALL_TRADED_PAIRS) {
    for (const currency of rule.affectedCurrencies) {
      if (pair.includes(currency)) {
        blocked.add(pair);
        break;
      }
    }
  }
  return blocked;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE FETCH / CACHE INFRASTRUCTURE (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCalendar(reason: string): Promise<void> {
  if (isFetching) return;
  isFetching = true;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  try {
    console.log(
      `[NewsStore] Fetching economic calendar... (reason: ${reason})`,
    );
    const data = await fetchLiveEconomicCalendar();
    if (Array.isArray(data) && data.length > 0) {
      cachedEvents = data;
      lastSuccessfulFetchDate = todayUTC();
      console.log(
        `[NewsStore] ✅ Fetched and cached ${data.length} economic events. Date: ${lastSuccessfulFetchDate}`,
      );
    } else {
      throw new Error("Gemini returned empty calendar data.");
    }
  } catch (err: any) {
    console.warn(
      `[NewsStore] ❌ Calendar fetch failed: ${err.message}. Retrying in ${RETRY_INTERVAL_MS / 60000} minutes...`,
    );
    retryTimer = setTimeout(() => {
      fetchCalendar("retry after failure");
    }, RETRY_INTERVAL_MS);
  } finally {
    isFetching = false;
  }
}

function getMsUntilNextPreFetch(): number {
  const now = new Date();
  // Get current time in EST
  const estFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const parts = estFmt.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')!.value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  const second = parseInt(parts.find(p => p.type === 'second')!.value, 10);
  
  const currentEstTotalMinutes = (hour === 24 ? 0 : hour) * 60 + minute + (second / 60);

  // Target EST times in minutes from midnight
  const targets = [
    1 * 60 + 30,  // 01:30 EST (London Pre-fetch)
    7 * 60 + 30,  // 07:30 EST (NY Pre-fetch)
    18 * 60 + 30  // 18:30 EST (Asia Pre-fetch)
  ];

  let nextTarget = targets.find(t => t > currentEstTotalMinutes);
  let minutesToAdd = 0;
  
  if (nextTarget !== undefined) {
    minutesToAdd = nextTarget - currentEstTotalMinutes;
  } else {
    // Next target is tomorrow's first target
    minutesToAdd = (24 * 60 - currentEstTotalMinutes) + targets[0];
  }

  return minutesToAdd * 60 * 1000;
}

function startScheduler(): void {
  const scheduleNext = () => {
    const msUntilNext = getMsUntilNextPreFetch();
    console.log(`[NewsStore] ⏰ Next Pre-Session Fetch scheduled in ${Math.round(msUntilNext / 60000)} minutes.`);
    setTimeout(async () => {
      await fetchCalendar("3x Daily Pre-Session Fetch");
      scheduleNext();
    }, msUntilNext);
  };
  scheduleNext();
}

export async function initNewsStore(): Promise<void> {
  await fetchCalendar("server startup");
  startScheduler();
}

export async function getCalendarData(
  forceRefresh: boolean = false,
): Promise<CalendarEvent[]> {
  if (forceRefresh || cachedEvents.length === 0) {
    await fetchCalendar(
      forceRefresh ? "manual force-refresh" : "cache was empty",
    );
  }
  return cachedEvents;
}

export function getSyntheticCalendarFallback(): any[] {
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — SMART BLACKOUT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Halt Window: Checks if trading should be blocked for the given pair right now.
 *
 * LOGIC:
 * - Only CRITICAL and HIGH events trigger a block (MODERATE only for CRITICAL tier).
 * - Systemic events (NFP, FOMC, US CPI) block ALL pairs.
 * - Direct events only block pairs that contain the affected currency.
 * - Window is asymmetric: minutesBefore before event, minutesAfter after event.
 * - If no events are loaded, returns false (never blindly block trading).
 */
export function isNewsBlackout(
  brokerSymbol: string,
  now: Date = new Date(),
): {
  blocked: boolean;
  reason?: string;
  tier?: string;
} {
  if (!cachedEvents || cachedEvents.length === 0) return { blocked: false };

  const nowMs = now.getTime();
  const normalizedSymbol = brokerSymbol
    .toUpperCase()
    .replace("XAUUSD", "XAUUSD")
    .replace("NAS100", "NAS100");

  for (const event of cachedEvents) {
    if (event.impact !== "High" && event.impact !== "Very High") continue;

    const rule = findMatchingRule(event);
    if (!rule) continue;

    // MODERATE events: only block for CRITICAL-tagged events from the newsAgent
    // (i.e. Very High impact). Standard "High" moderate events are skipped.
    if (rule.tier === "MODERATE" && event.impact !== "Very High") continue;

    // Check if this pair is in the blocked set for this rule
    const blockedPairs = getBlockedPairs(rule);
    if (!blockedPairs.has(normalizedSymbol)) continue;

    // Check timing window (asymmetric: different before vs after)
    const eventMs = new Date(event.date).getTime();
    const msBeforeEvent = eventMs - nowMs;
    const msAfterEvent = nowMs - eventMs;
    const msWindowBefore = rule.minutesBefore * 60 * 1000;
    const msWindowAfter = rule.minutesAfter * 60 * 1000;

    if (msBeforeEvent >= 0 && msBeforeEvent <= msWindowBefore) {
      return {
        blocked: true,
        reason: `${event.title} in ${Math.ceil(msBeforeEvent / 60000)} min`,
        tier: rule.tier,
      };
    }
    if (msAfterEvent >= 0 && msAfterEvent <= msWindowAfter) {
      return {
        blocked: true,
        reason: `${event.title} released ${Math.ceil(msAfterEvent / 60000)} min ago`,
        tier: rule.tier,
      };
    }
  }
  return { blocked: false };
}

/**
 * Force Close Window: Returns true if a CRITICAL or HIGH event is <= 5 minutes away
 * and the given pair is affected. This is used to close open trades before the event.
 */
export function shouldForceCloseForNews(
  brokerSymbol: string,
  now: Date = new Date(),
): boolean {
  if (!cachedEvents || cachedEvents.length === 0) return false;

  const nowMs = now.getTime();
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const normalizedSymbol = brokerSymbol.toUpperCase();

  for (const event of cachedEvents) {
    if (event.impact !== "High" && event.impact !== "Very High") continue;

    const rule = findMatchingRule(event);
    if (!rule) continue;
    if (rule.tier === "MODERATE") continue; // Don't force-close for minor events

    const blockedPairs = getBlockedPairs(rule);
    if (!blockedPairs.has(normalizedSymbol)) continue;

    const eventMs = new Date(event.date).getTime();
    const timeDiff = eventMs - nowMs;
    if (timeDiff > 0 && timeDiff <= FIVE_MIN_MS) {
      return true;
    }
  }
  return false;
}

/**
 * Get upcoming news events affecting a specific pair in the next N hours.
 * Used for dashboard display.
 */
export function getUpcomingNewsForPair(
  brokerSymbol: string,
  hoursAhead: number = 4,
): Array<{
  title: string;
  time: string;
  minutesAway: number;
  tier: string;
  impact: string;
}> {
  if (!cachedEvents || cachedEvents.length === 0) return [];

  const now = new Date();
  const nowMs = now.getTime();
  const windowMs = hoursAhead * 60 * 60 * 1000;
  const normalizedSymbol = brokerSymbol.toUpperCase();
  const upcoming: Array<{
    title: string;
    time: string;
    minutesAway: number;
    tier: string;
    impact: string;
  }> = [];

  for (const event of cachedEvents) {
    if (event.impact !== "High" && event.impact !== "Very High") continue;

    const rule = findMatchingRule(event);
    if (!rule) continue;

    const blockedPairs = getBlockedPairs(rule);
    if (!blockedPairs.has(normalizedSymbol)) continue;

    const eventMs = new Date(event.date).getTime();
    const timeDiff = eventMs - nowMs;
    if (timeDiff > 0 && timeDiff <= windowMs) {
      upcoming.push({
        title: event.title,
        time: new Date(event.date).toISOString(),
        minutesAway: Math.round(timeDiff / 60000),
        tier: rule.tier,
        impact: event.impact,
      });
    }
  }

  return upcoming.sort((a, b) => a.minutesAway - b.minutesAway);
}
