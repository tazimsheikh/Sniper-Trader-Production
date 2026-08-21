/**
 * candleDb.ts
 *
 * Local SQLite store for M5 candle cache.
 * This keeps bulk candle data OFF Supabase (cross-cloud, high latency)
 * and on the local VM disk where reads/writes are sub-millisecond.
 *
 * Financial data (trades, profiles) stays in Supabase via db.ts.
 */

import BetterSqlite3 from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "candles.db");

// Ensure data/ directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Open synchronous SQLite connection (better-sqlite3 is synchronous by design)
let candleDb: BetterSqlite3.Database;

try {
  candleDb = new BetterSqlite3(DB_PATH, { fileMustExist: false });
  // WAL mode: dramatically faster concurrent writes, safe for single-process use
  candleDb.pragma("journal_mode = WAL");
  candleDb.pragma("synchronous = NORMAL");
  candleDb.pragma("cache_size = -64000"); // 64MB page cache

  // Create the table if it doesn't exist
  candleDb.exec(`
    CREATE TABLE IF NOT EXISTS m5_candles_cache (
      profile_id INTEGER NOT NULL,
      symbol    TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open      REAL NOT NULL,
      high      REAL NOT NULL,
      low       REAL NOT NULL,
      close     REAL NOT NULL,
      tick_volume INTEGER DEFAULT 1,
      PRIMARY KEY (profile_id, symbol, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_m5_prof_sym_ts
      ON m5_candles_cache (profile_id, symbol, timestamp DESC);
  `);

  logger.info(`[CandleDB] ✅ Local SQLite candle cache ready at ${DB_PATH}`);
} catch (err: any) {
  logger.error(`[CandleDB] FATAL: Could not open local SQLite DB: ${err.message}`);
  process.exit(1);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Load all cached M5 candles for a symbol within the last `days` days.
 * Returns candles in ascending timestamp order.
 */
export function loadCachedM5CandlesLocal(profileId: string | number, symbol: string, days = 30): any[] {
  try {
    const cutoffTs = Date.now() - days * 86400 * 1000;
    const rows = candleDb
      .prepare(
        "SELECT symbol, timestamp, open, high, low, close, tick_volume FROM m5_candles_cache WHERE profile_id = ? AND symbol = ? AND timestamp >= ? ORDER BY timestamp ASC"
      )
      .all(Number(profileId), symbol, cutoffTs) as any[];

    return rows.map((r) => ({
      time: new Date(Number(r.timestamp)).toISOString(),
      timestamp: Number(r.timestamp),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      tickVolume: Number(r.tick_volume || 1),
    }));
  } catch (e: any) {
    logger.warn(`[CandleDB] Could not load cached candles for ${symbol}: ${e.message}`);
    return [];
  }
}

/**
 * Bulk-save M5 candles for a symbol to the local SQLite cache.
 * Uses a prepared transaction for maximum throughput (~50k rows/sec).
 */
export function saveM5CandlesToCacheLocal(profileId: string | number, symbol: string, candles: any[]): void {
  if (!candles || candles.length === 0) return;
  try {
    const insert = candleDb.prepare(
      "INSERT OR IGNORE INTO m5_candles_cache (profile_id, symbol, timestamp, open, high, low, close, tick_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    // Wrap all inserts in a single transaction — this is what makes SQLite fast
    const insertMany = candleDb.transaction((rows: any[]) => {
      for (const c of rows) {
        const ts = typeof c.timestamp === "number" ? c.timestamp : new Date(c.time).getTime();
        insert.run(Number(profileId), symbol, ts, c.open, c.high, c.low, c.close, c.tickVolume || 1);
      }
    });

    insertMany(candles);
  } catch (e: any) {
    logger.warn(`[CandleDB] Error persisting M5 candles for ${symbol}: ${e.message}`);
  }
}

/**
 * Delete candles older than `daysToRetain` days to keep the DB lean.
 */
export function pruneOldM5CandlesLocal(daysToRetain = 60): void {
  try {
    const cutoffTs = Date.now() - daysToRetain * 86400 * 1000;
    const result = candleDb
      .prepare("DELETE FROM m5_candles_cache WHERE timestamp < ?")
      .run(cutoffTs);
    if (result.changes > 0) {
      logger.info(`[CandleDB] 🧹 Pruned ${result.changes} old candle rows`);
    }
  } catch (e: any) {
    // Non-fatal
  }
}

export default candleDb;
