import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("CRITICAL: DATABASE_URL is not defined in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('supabase.com') || process.env.DATABASE_URL.includes('neon.tech') 
       ? { rejectUnauthorized: false } 
       : false
});

class DbStatement {
  constructor(private sql: string, private pool: pg.Pool) {}

  async get(...params: any[]) {
    const res = await this.pool.query(this.sql, params);
    return res.rows[0];
  }

  async all(...params: any[]) {
    const res = await this.pool.query(this.sql, params);
    return res.rows;
  }

  async run(...params: any[]) {
    let queryStr = this.sql;
    const isInsert = queryStr.trim().toUpperCase().startsWith('INSERT');
    if (isInsert && !queryStr.toUpperCase().includes('RETURNING')) {
      // Very naive append for basic statements to preserve sqlite compatibility
      queryStr += ' RETURNING id';
    }
    
    // SQLite uses ON CONFLICT DO UPDATE SET. Postgres uses ON CONFLICT (cols) DO UPDATE SET.
    // If we have an ON CONFLICT without DO UPDATE or DO NOTHING, it might crash, but our SQL explicitly specifies DO UPDATE.
    
    try {
      const res = await this.pool.query(queryStr, params);
      return { 
        changes: res.rowCount, 
        lastInsertRowid: isInsert && res.rows.length > 0 ? res.rows[0].id : undefined 
      };
    } catch (err: any) {
      console.error(`[DB Error] Query: ${queryStr}`, err.message);
      throw err;
    }
  }
}

const db = {
  prepare: (sql: string) => {
    // Convert ? to $1, $2, $3...
    let i = 1;
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    return new DbStatement(pgSql, pool);
  },
  exec: async (sql: string) => {
    return pool.query(sql);
  }
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
      openrouter_api_key TEXT DEFAULT NULL,
      risk_multiplier INTEGER DEFAULT 5,
      automation_active INTEGER DEFAULT 0,
      ai_sniper_active INTEGER DEFAULT 0,
      diary_reset_time TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS otps (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      purpose TEXT NOT NULL,
      payload TEXT DEFAULT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trading_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      profile_name TEXT NOT NULL,
      metaapi_token TEXT,
      metaapi_account_id TEXT,
      risk_multiplier INTEGER DEFAULT 5,
      automation_active INTEGER DEFAULT 0,
      ai_sniper_active INTEGER DEFAULT 0,
      active_bots TEXT DEFAULT '[]',
      peak_balance REAL DEFAULT 0,
      safety_settings TEXT DEFAULT '{}',
      diary_reset_time TEXT DEFAULT NULL,
      session_losses INTEGER DEFAULT 0,
      last_session TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profile_symbol_lockouts (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES trading_profiles(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      session_losses INTEGER DEFAULT 0,
      last_session TEXT DEFAULT NULL,
      UNIQUE(profile_id, symbol)
    );

    CREATE TABLE IF NOT EXISTS pending_signals (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES trading_profiles(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      bot_id TEXT NOT NULL,
      broker_symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      suggested_sl_pips REAL NOT NULL,
      suggested_tp_pips REAL,
      reason TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      status TEXT DEFAULT 'PENDING'
    );

    CREATE TABLE IF NOT EXISTS bot_ema_state (
      id SERIAL PRIMARY KEY,
      bot_id TEXT NOT NULL,
      profile_id INTEGER NOT NULL,
      ema_value REAL NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(bot_id, profile_id)
    );
    
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      close_time BIGINT,
      pnl REAL
    );

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
  `);
}
// Exported initDb is awaited in server.ts

export async function saveEmaState(botId: string, profileId: number, emaValue: number) {
  await db.prepare(`
    INSERT INTO bot_ema_state (bot_id, profile_id, ema_value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(bot_id, profile_id) DO UPDATE SET ema_value = excluded.ema_value, updated_at = excluded.updated_at
  `).run(botId, profileId, emaValue, Date.now());
}

export async function loadEmaState(botId: string, profileId: number): Promise<number | null> {
  const row = await db.prepare('SELECT ema_value FROM bot_ema_state WHERE bot_id = ? AND profile_id = ?').get(botId, profileId) as any;
  return row ? row.ema_value : null;
}

// ── Trade Management Helpers ─────────────────────────────────────────────────
export async function getSessionLosses(profileId: number, symbol: string, currentSession: string): Promise<number> {
  const row = await db.prepare('SELECT session_losses, last_session FROM profile_symbol_lockouts WHERE profile_id = ? AND symbol = ?').get(profileId, symbol) as any;
  if (!row) return 0;
  
  if (row.last_session !== currentSession) {
    await db.prepare('UPDATE profile_symbol_lockouts SET session_losses = 0, last_session = ? WHERE profile_id = ? AND symbol = ?').run(currentSession, profileId, symbol);
    return 0;
  }
  return row.session_losses || 0;
}

export async function incrementSessionLoss(profileId: number, symbol: string, currentSession: string) {
  const row = await db.prepare('SELECT session_losses, last_session FROM profile_symbol_lockouts WHERE profile_id = ? AND symbol = ?').get(profileId, symbol) as any;
  
  if (!row) {
    await db.prepare('INSERT INTO profile_symbol_lockouts (profile_id, symbol, session_losses, last_session) VALUES (?, ?, 1, ?)')
      .run(profileId, symbol, currentSession);
  } else if (row.last_session !== currentSession) {
    await db.prepare('UPDATE profile_symbol_lockouts SET session_losses = 1, last_session = ? WHERE profile_id = ? AND symbol = ?')
      .run(currentSession, profileId, symbol);
  } else {
    await db.prepare('UPDATE profile_symbol_lockouts SET session_losses = session_losses + 1 WHERE profile_id = ? AND symbol = ?')
      .run(profileId, symbol);
  }
}

export default db;
