import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure the data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'database.sqlite'));

// Enable Write-Ahead Logging for better concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    metaapi_token TEXT,
    metaapi_account_id TEXT,
    gemini_api_key TEXT DEFAULT NULL,
    risk_multiplier INTEGER DEFAULT 1,
    automation_active INTEGER DEFAULT 0,
    ai_sniper_active INTEGER DEFAULT 0,
    diary_reset_time TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    purpose TEXT NOT NULL,
    payload TEXT DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trading_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    profile_name TEXT NOT NULL,
    metaapi_token TEXT,
    metaapi_account_id TEXT,
    risk_multiplier INTEGER DEFAULT 1,
    automation_active INTEGER DEFAULT 0,
    ai_sniper_active INTEGER DEFAULT 0,
    active_bots TEXT DEFAULT '[]',
    diary_reset_time TEXT DEFAULT NULL,
    session_losses INTEGER DEFAULT 0,
    last_session TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pending_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    bot_id TEXT NOT NULL,
    broker_symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    suggested_sl_pips REAL NOT NULL,
    suggested_tp_pips REAL,
    reason TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT DEFAULT 'PENDING',
    FOREIGN KEY(profile_id) REFERENCES trading_profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bot_ema_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL UNIQUE,
    ema_value REAL NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Apply migration for existing users safely
try {
  db.exec('ALTER TABLE users ADD COLUMN ai_sniper_active INTEGER DEFAULT 0');
} catch (e: any) {}

try {
  db.exec('ALTER TABLE users ADD COLUMN gemini_api_key TEXT DEFAULT NULL');
} catch (e: any) {}

try {
  db.exec('ALTER TABLE users ADD COLUMN diary_reset_time TEXT DEFAULT NULL');
} catch (e: any) {}

// Migrations for trade management
try {
  db.exec('ALTER TABLE trading_profiles ADD COLUMN session_losses INTEGER DEFAULT 0');
} catch (e: any) {}
try {
  db.exec('ALTER TABLE trading_profiles ADD COLUMN last_session TEXT DEFAULT NULL');
} catch (e: any) {}

export function saveEmaState(botId: string, emaValue: number) {
  db.prepare(`
    INSERT INTO bot_ema_state (bot_id, ema_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET ema_value = excluded.ema_value, updated_at = excluded.updated_at
  `).run(botId, emaValue, Date.now());
}

export function loadEmaState(botId: string): number | null {
  const row = db.prepare('SELECT ema_value FROM bot_ema_state WHERE bot_id = ?').get(botId) as any;
  return row ? row.ema_value : null;
}

// ── Trade Management Helpers ─────────────────────────────────────────────────
export function getSessionLosses(profileId: number, currentSession: string): number {
  const profile = db.prepare('SELECT session_losses, last_session FROM trading_profiles WHERE id = ?').get(profileId) as any;
  if (!profile) return 0;
  
  if (profile.last_session !== currentSession) {
    db.prepare('UPDATE trading_profiles SET session_losses = 0, last_session = ? WHERE id = ?').run(currentSession, profileId);
    return 0;
  }
  return profile.session_losses || 0;
}

export function incrementSessionLoss(profileId: number, currentSession: string) {
  const profile = db.prepare('SELECT session_losses, last_session FROM trading_profiles WHERE id = ?').get(profileId) as any;
  if (!profile) return;

  if (profile.last_session !== currentSession) {
    db.prepare('UPDATE trading_profiles SET session_losses = 1, last_session = ? WHERE id = ?').run(currentSession, profileId);
  } else {
    db.prepare('UPDATE trading_profiles SET session_losses = session_losses + 1 WHERE id = ?').run(profileId);
  }
}

export default db;
