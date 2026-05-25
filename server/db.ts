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
    risk_multiplier INTEGER DEFAULT 1,
    automation_active INTEGER DEFAULT 0,
    ai_sniper_active INTEGER DEFAULT 0,
    diary_reset_time TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Apply migration for existing users safely
try {
  db.exec('ALTER TABLE users ADD COLUMN ai_sniper_active INTEGER DEFAULT 0');
} catch (e: any) {}

try {
  db.exec('ALTER TABLE users ADD COLUMN diary_reset_time TEXT DEFAULT NULL');
} catch (e: any) {}

export default db;
