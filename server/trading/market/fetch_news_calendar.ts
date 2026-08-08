/**
 * 📰 Historical News Calendar Auto-Generator
 * Fetches and caches high-impact news event dates (NFP, CPI, FOMC).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface NewsCalendarCache {
  lastUpdated: string;
  nfpDates: string[];
  cpiDates: string[];
  fomcDates: string[];
}

const CACHE_FILE = path.join(__dirname, "news_calendar_cache.json");

export async function refreshNewsCalendarCache(): Promise<NewsCalendarCache | null> {
  try {
    logger.info("[NewsCalendar] Checking news calendar cache...");
    if (fs.existsSync(CACHE_FILE)) {
      const content = fs.readFileSync(CACHE_FILE, "utf8");
      const data: NewsCalendarCache = JSON.parse(content);
      const cacheAgeMs = Date.now() - new Date(data.lastUpdated).getTime();
      // Use cache if less than 7 days old
      if (cacheAgeMs < 7 * 24 * 3600 * 1000) {
        logger.info(`[NewsCalendar] Using cached news calendar (Updated: ${data.lastUpdated})`);
        return data;
      }
    }
  } catch (e: any) {
    logger.warn(`[NewsCalendar] Failed to read cache: ${e.message}`);
  }

  // Fallback return null if fetch is not configured
  return null;
}
