import pg from "pg";
const { Pool } = pg;
import dotenv from "dotenv";
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("CRITICAL: DATABASE_URL is not defined in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 100,
  idleTimeoutMillis: 30000, // 30 seconds (prevents cloud proxy terminations)
  connectionTimeoutMillis: 5000,   // fail fast → triggers retry logic sooner
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl:
    process.env.DATABASE_URL.includes("supabase.com") ||
    process.env.DATABASE_URL.includes("neon.tech")
      ? { rejectUnauthorized: false }
      : false,
});

import { logger } from '../utils/logger.js';

// Catch idle client terminations gracefully without crashing the app
pool.on("error", (err) => {
  logger.error(`[DB Pool Warning] Idle client error: ${err.message}`, err);
});

class DbStatement {
  constructor(
    private sql: string,
    private pool: pg.Pool,
  ) {}

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    retries = 5,
    delay = 50,
  ): Promise<T> {
    try {
      const startMs = Date.now();
      const res = await fn();
      const elapsed = Date.now() - startMs;
      if (elapsed > 3500) {
        const cleanSql = this.sql.length > 100 ? `${this.sql.substring(0, 100)}...` : this.sql;
        logger.warn(`[SLOW QUERY] ${elapsed}ms for query: ${cleanSql}`);
      }
      return res;
    } catch (err: any) {
      const isTransient =
        err.code === "40001" ||
        err.code === "40P01" ||
        (err.message &&
          (err.message.includes("SQLITE_BUSY") ||
            err.message.includes("locked")));
      if (isTransient && retries > 0) {
        const backoff = delay * (1.5 + Math.random());
        await new Promise((r) => setTimeout(r, backoff));
        return this.executeWithRetry(fn, retries - 1, delay * 2);
      }
      logger.error(`[DB Error] execution failed. Query: ${this.sql} | Msg: ${err.message}`, err);
      throw err;
    }
  }

  async get(...params: any[]) {
    try {
      const res = await this.executeWithRetry(() =>
        this.pool.query(this.sql, params),
      );
      return res.rows[0];
    } catch (err: any) {
      logger.error(`[DB Error] get() Query: ${this.sql}`, params, err);
      throw err;
    }
  }

  async all(...params: any[]) {
    try {
      const res = await this.executeWithRetry(() =>
        this.pool.query(this.sql, params),
      );
      return res.rows;
    } catch (err: any) {
      logger.error(`[DB Error] all() Query: ${this.sql}`, params, err);
      throw err;
    }
  }

  async run(...params: any[]) {
    let queryStr = this.sql;
    const isInsert = queryStr.trim().toUpperCase().startsWith("INSERT");
    if (isInsert && !queryStr.toUpperCase().includes("RETURNING")) {
      // Very naive append for basic statements to preserve sqlite compatibility
      queryStr += " RETURNING id";
    }

    // SQLite uses ON CONFLICT DO UPDATE SET. Postgres uses ON CONFLICT (cols) DO UPDATE SET.
    // If we have an ON CONFLICT without DO UPDATE or DO NOTHING, it might crash, but our SQL explicitly specifies DO UPDATE.

    try {
      const res = await this.executeWithRetry(() =>
        this.pool.query(queryStr, params),
      );
      return {
        changes: res.rowCount,
        lastInsertRowid:
          isInsert && res.rows.length > 0 ? res.rows[0].id : undefined,
      };
    } catch (err: any) {
      logger.error(`[DB Error] run() Query: ${queryStr}`, params, err);
      throw err;
    }
  }
}

const db = {
  prepare: (sql: string) => {
    if ((global as any).isSimulator)
      return {
        run: async () => ({ changes: 0, lastInsertRowid: 0 }),
        get: async () => ({}),
        all: async () => [],
      };
    // Convert ? to $1, $2, $3...
    let i = 1;
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    return new DbStatement(pgSql, pool);
  },
  exec: async (sql: string) => {
    if ((global as any).isSimulator) return;
    return pool.query(sql);
  },
};

// Initialize schema
export async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      metaapi_token TEXT,
      metaapi_account_id TEXT,
      risk_multiplier INTEGER DEFAULT 5,
      automation_active INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS otps (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      purpose TEXT NOT NULL,
      payload TEXT DEFAULT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='gemini_api_key') THEN
        ALTER TABLE users ADD COLUMN gemini_api_key TEXT DEFAULT NULL;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS trading_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      profile_name TEXT NOT NULL,
      metaapi_token TEXT,
      metaapi_account_id TEXT,
      risk_multiplier INTEGER DEFAULT 5,
      automation_active INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Gracefully add locked_pairs and missing columns if they don't exist
    DO $$
    BEGIN
      -- Migrate risk_multiplier from INTEGER to REAL to preserve decimals
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='risk_multiplier' AND data_type='integer') THEN
        ALTER TABLE trading_profiles ALTER COLUMN risk_multiplier TYPE REAL USING risk_multiplier::real;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='locked_pairs') THEN
        ALTER TABLE trading_profiles ADD COLUMN locked_pairs TEXT DEFAULT '[]';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='ai_sniper_active') THEN
        ALTER TABLE trading_profiles ADD COLUMN ai_sniper_active INTEGER DEFAULT 0;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='diary_reset_time') THEN
        ALTER TABLE trading_profiles ADD COLUMN diary_reset_time TEXT DEFAULT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='bot_risks') THEN
        ALTER TABLE trading_profiles ADD COLUMN bot_risks TEXT DEFAULT '{}';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='dwcb_enabled') THEN
        ALTER TABLE trading_profiles ADD COLUMN dwcb_enabled INTEGER DEFAULT 0;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='dwcb_peak_balance') THEN
        ALTER TABLE trading_profiles ADD COLUMN dwcb_peak_balance REAL DEFAULT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='institutional_enabled') THEN
        ALTER TABLE trading_profiles ADD COLUMN institutional_enabled INTEGER DEFAULT 0;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='institutional_daily_cap') THEN
        ALTER TABLE trading_profiles ADD COLUMN institutional_daily_cap REAL DEFAULT 2.5;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='institutional_peak_to_draw') THEN
        ALTER TABLE trading_profiles ADD COLUMN institutional_peak_to_draw REAL DEFAULT 5.5;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='institutional_daily_start_balance') THEN
        ALTER TABLE trading_profiles ADD COLUMN institutional_daily_start_balance REAL DEFAULT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='institutional_daily_date') THEN
        ALTER TABLE trading_profiles ADD COLUMN institutional_daily_date TEXT DEFAULT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='institutional_peak_balance') THEN
        ALTER TABLE trading_profiles ADD COLUMN institutional_peak_balance REAL DEFAULT NULL;
      END IF;
    END $$;

    -- Base Risk Balance: user-defined fixed capital for lot sizing (non-compounding)
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='base_risk_balance') THEN
        ALTER TABLE trading_profiles ADD COLUMN base_risk_balance REAL DEFAULT NULL;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='broker_symbol_map') THEN
        ALTER TABLE trading_profiles ADD COLUMN broker_symbol_map TEXT DEFAULT '{}';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trading_profiles' AND column_name='active_bots') THEN
        ALTER TABLE trading_profiles ADD COLUMN active_bots TEXT DEFAULT '[]';
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS profile_symbol_lockouts (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES trading_profiles(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL DEFAULT 'seer',
      symbol TEXT NOT NULL,
      session_losses INTEGER DEFAULT 0,
      last_session TEXT DEFAULT NULL,
      UNIQUE(profile_id, symbol, bot_id)
    );

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_symbol_lockouts' AND column_name='bot_id') THEN
        ALTER TABLE profile_symbol_lockouts ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'seer';
        ALTER TABLE profile_symbol_lockouts DROP CONSTRAINT IF EXISTS profile_symbol_lockouts_profile_id_symbol_key;
        ALTER TABLE profile_symbol_lockouts ADD CONSTRAINT profile_symbol_lockouts_unique_bot UNIQUE(profile_id, symbol, bot_id);
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS profile_pair_configs (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES trading_profiles(id) ON DELETE CASCADE,
      pair TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      discretionary_trader_enabled INTEGER DEFAULT 1,
      discretionary_trader_risk REAL DEFAULT NULL,
      sage_enabled INTEGER DEFAULT 1,
      sage_risk REAL DEFAULT NULL,
      seer_enabled INTEGER DEFAULT 1,
      seer_risk REAL DEFAULT NULL,
      mage_enabled INTEGER DEFAULT 1,
      mage_risk REAL DEFAULT NULL,
      UNIQUE(profile_id, pair)
    );

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_pair_configs' AND column_name='discretionary_trader_enabled') THEN
        ALTER TABLE profile_pair_configs ADD COLUMN discretionary_trader_enabled INTEGER DEFAULT 1;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_pair_configs' AND column_name='discretionary_trader_risk') THEN
        ALTER TABLE profile_pair_configs ADD COLUMN discretionary_trader_risk REAL DEFAULT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_pair_configs' AND column_name='sage_enabled') THEN
        ALTER TABLE profile_pair_configs ADD COLUMN sage_enabled INTEGER DEFAULT 1;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_pair_configs' AND column_name='sage_risk') THEN
        ALTER TABLE profile_pair_configs ADD COLUMN sage_risk REAL DEFAULT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_pair_configs' AND column_name='seer_enabled') THEN
        ALTER TABLE profile_pair_configs ADD COLUMN seer_enabled INTEGER DEFAULT 1;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_pair_configs' AND column_name='seer_risk') THEN
        ALTER TABLE profile_pair_configs ADD COLUMN seer_risk REAL DEFAULT NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_pair_configs' AND column_name='mage_enabled') THEN
        ALTER TABLE profile_pair_configs ADD COLUMN mage_enabled INTEGER DEFAULT 1;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profile_pair_configs' AND column_name='mage_risk') THEN
        ALTER TABLE profile_pair_configs ADD COLUMN mage_risk REAL DEFAULT NULL;
      END IF;
    END $$;

    -- Migration: Cleanse legacy 10.0 defaults
    UPDATE profile_pair_configs SET discretionary_trader_risk = NULL WHERE discretionary_trader_risk = 10.0;
    UPDATE profile_pair_configs SET sage_risk = NULL WHERE sage_risk = 10.0;
    UPDATE profile_pair_configs SET seer_risk = NULL WHERE seer_risk = 10.0;
    UPDATE profile_pair_configs SET mage_risk = NULL WHERE mage_risk = 10.0;


    
    CREATE TABLE IF NOT EXISTS bot_trade_states (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      profile_id INTEGER,
      bot_id TEXT NOT NULL,
      broker_symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      sl_price REAL NOT NULL,
      tp_price REAL NOT NULL,
      lots REAL NOT NULL,
      open_time BIGINT NOT NULL,
      meta_order_id TEXT,
      t1_hit INTEGER DEFAULT 0,
      highest_price REAL NOT NULL,
      lowest_price REAL NOT NULL,
      status TEXT DEFAULT 'OPEN',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      close_time BIGINT,
      pnl REAL,
      initial_risk_pips REAL DEFAULT 0,
      manages_own_trailing INTEGER DEFAULT 0
    );

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bot_trade_states' AND column_name='initial_risk_pips') THEN
        ALTER TABLE bot_trade_states ADD COLUMN initial_risk_pips REAL DEFAULT 0;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bot_trade_states' AND column_name='client_id') THEN
        ALTER TABLE bot_trade_states ADD COLUMN client_id TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bot_trade_states' AND column_name='manages_own_trailing') THEN
        ALTER TABLE bot_trade_states ADD COLUMN manages_own_trailing INTEGER DEFAULT 0;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bot_trade_states' AND column_name='open_time' AND data_type LIKE '%timestamp%') THEN
        ALTER TABLE bot_trade_states ALTER COLUMN open_time DROP DEFAULT;
        ALTER TABLE bot_trade_states ALTER COLUMN open_time TYPE BIGINT USING (CASE WHEN open_time IS NULL THEN 0 ELSE (EXTRACT(EPOCH FROM open_time) * 1000)::BIGINT END);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bot_trade_states' AND column_name='close_time' AND data_type LIKE '%timestamp%') THEN
        ALTER TABLE bot_trade_states ALTER COLUMN close_time DROP DEFAULT;
        ALTER TABLE bot_trade_states ALTER COLUMN close_time TYPE BIGINT USING (CASE WHEN close_time IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM close_time) * 1000)::BIGINT END);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trade_diary' AND column_name='open_time' AND data_type LIKE '%timestamp%') THEN
        ALTER TABLE trade_diary ALTER COLUMN open_time DROP DEFAULT;
        ALTER TABLE trade_diary ALTER COLUMN open_time TYPE BIGINT USING (CASE WHEN open_time IS NULL THEN 0 ELSE (EXTRACT(EPOCH FROM open_time) * 1000)::BIGINT END);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trade_diary' AND column_name='close_time' AND data_type LIKE '%timestamp%') THEN
        ALTER TABLE trade_diary ALTER COLUMN close_time DROP DEFAULT;
        ALTER TABLE trade_diary ALTER COLUMN close_time TYPE BIGINT USING (CASE WHEN close_time IS NULL THEN 0 ELSE (EXTRACT(EPOCH FROM close_time) * 1000)::BIGINT END);
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS trade_diary (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      profile_id INTEGER,
      bot_id TEXT NOT NULL,
      broker_symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      lots REAL NOT NULL,
      pips REAL NOT NULL,
      profit REAL NOT NULL,
      status TEXT NOT NULL,
      open_time BIGINT NOT NULL,
      close_time BIGINT NOT NULL
    );


    CREATE TABLE IF NOT EXISTS bot_logs (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER,
      bot_id TEXT DEFAULT 'mage',
      symbol TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bot_logs' AND column_name='bot_id') THEN
        ALTER TABLE bot_logs ADD COLUMN bot_id TEXT DEFAULT 'mage';
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS ai_decisions (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      verdict TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      setup_json TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS m5_candles_cache (
      symbol TEXT NOT NULL,
      timestamp BIGINT NOT NULL,
      open DOUBLE PRECISION NOT NULL,
      high DOUBLE PRECISION NOT NULL,
      low DOUBLE PRECISION NOT NULL,
      close DOUBLE PRECISION NOT NULL,
      tick_volume INT DEFAULT 1,
      PRIMARY KEY (symbol, timestamp)
    );

    -- User preferences (timezone etc.) — persisted server-side so they survive new devices
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='timezone') THEN
        ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'IST';
      END IF;
    END $$;
    -- Indexes for performance on frequently queried foreign keys
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trading_profiles_user_id') THEN
        CREATE INDEX idx_trading_profiles_user_id ON trading_profiles(user_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trade_diary_profile_id') THEN
        CREATE INDEX idx_trade_diary_profile_id ON trade_diary(profile_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_trade_diary_user_id') THEN
        CREATE INDEX idx_trade_diary_user_id ON trade_diary(user_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bot_logs_profile_id') THEN
        CREATE INDEX idx_bot_logs_profile_id ON bot_logs(profile_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bot_trade_states_profile_id') THEN
        CREATE INDEX idx_bot_trade_states_profile_id ON bot_trade_states(profile_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bot_trade_states_profile_status') THEN
        CREATE INDEX idx_bot_trade_states_profile_status ON bot_trade_states(profile_id, status);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_profile_pair_configs_profile_id') THEN
        CREATE INDEX idx_profile_pair_configs_profile_id ON profile_pair_configs(profile_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_m5_candles_sym_ts') THEN
        CREATE INDEX idx_m5_candles_sym_ts ON m5_candles_cache(symbol, timestamp DESC);
      END IF;
    END $$;

  `);
}
// Exported initDb is awaited in server.ts

// ── Trade Management Helpers ─────────────────────────────────────────────────
export async function getSessionLosses(
  profileId: number,
  symbol: string,
  currentSession: string,
  _botId: string = "seer", // kept for signature compatibility but ignored
): Promise<number> {
  const rows = (await db
    .prepare(
      "SELECT session_losses, last_session, bot_id FROM profile_symbol_lockouts WHERE profile_id = ? AND symbol = ?",
    )
    .all(profileId, symbol)) as any[];

  if (!rows || rows.length === 0) return 0;

  let totalLosses = 0;
  for (const row of rows) {
    if (row.last_session !== currentSession) {
      await db
        .prepare(
          "UPDATE profile_symbol_lockouts SET session_losses = 0, last_session = ? WHERE profile_id = ? AND symbol = ? AND bot_id = ?",
        )
        .run(currentSession, profileId, symbol, row.bot_id);
    } else {
      totalLosses += row.session_losses || 0;
    }
  }
  return totalLosses;
}

export async function incrementSessionLoss(
  profileId: number,
  symbol: string,
  currentSession: string,
  botId: string = "seer",
) {
  const row = (await db
    .prepare(
      "SELECT session_losses, last_session FROM profile_symbol_lockouts WHERE profile_id = ? AND symbol = ? AND bot_id = ?",
    )
    .get(profileId, symbol, botId)) as any;

  if (!row) {
    await db
      .prepare(
        "INSERT INTO profile_symbol_lockouts (profile_id, symbol, session_losses, last_session, bot_id) VALUES (?, ?, 1, ?, ?)",
      )
      .run(profileId, symbol, currentSession, botId);
  } else if (row.last_session !== currentSession) {
    await db
      .prepare(
        "UPDATE profile_symbol_lockouts SET session_losses = 1, last_session = ? WHERE profile_id = ? AND symbol = ? AND bot_id = ?",
      )
      .run(currentSession, profileId, symbol, botId);
  } else {
    await db
      .prepare(
        "UPDATE profile_symbol_lockouts SET session_losses = session_losses + 1 WHERE profile_id = ? AND symbol = ? AND bot_id = ?",
      )
      .run(profileId, symbol, botId);
  }
}

export async function addBotLog(
  profileId: number | null,
  botId: string | null,
  symbol: string | null,
  action: string,
  details: string,
) {
  try {
    await db
      .prepare(
        `
      INSERT INTO bot_logs (profile_id, bot_id, symbol, action, details)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(profileId, botId, symbol, action, details);
      
    // Emit over websocket
    import("./socket.js").then((mod) => {
      try {
        const io = mod.getIO();
        if (io) {
          const payload = {
            profile_id: profileId,
            bot_id: botId,
            symbol,
            action,
            details,
            timestamp: new Date().toISOString()
          };
          io.to("bot_logs").emit("bot_log", payload);
          if (profileId) {
            io.to(`profile_${profileId}`).emit("discretionary_trader:system_log", payload);
          } else {
            io.emit("discretionary_trader:system_log", payload);
          }
        }
      } catch (e) {}
    }).catch(() => {});

  } catch (err: any) {
    console.warn("[DB] Failed to insert bot_log:", err.message);
  }
}

export async function saveAiDecision(
  profileId: number,
  symbol: string,
  direction: string,
  verdict: "APPROVED" | "REJECTED",
  reasoning: string,
  setup: any,
) {
  try {
    await db
      .prepare(
        `
      INSERT INTO ai_decisions (profile_id, symbol, direction, verdict, reasoning, setup_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        profileId,
        symbol,
        direction,
        verdict,
        reasoning,
        JSON.stringify(setup),
      );
  } catch (err: any) {
    console.warn("[DB] Failed to insert ai_decision:", err.message);
  }
}

export default db;


