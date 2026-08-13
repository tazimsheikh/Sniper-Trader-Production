const Database = require('better-sqlite3');

// Try multiple possible DB paths
const paths = [
  './server/trading_cache.db',
  './trading_cache.db',
  './server/cache.db',
  './cache.db',
  './data/cache.db',
];

let db;
for (const p of paths) {
  try {
    db = new Database(p);
    console.log('Opened DB at:', p);
    break;
  } catch(e) {}
}

if (!db) {
  // Find any .db file
  const fs = require('fs');
  const files = fs.readdirSync('.').filter(f => f.endsWith('.db'));
  const serverFiles = fs.existsSync('./server') ? fs.readdirSync('./server').filter(f => f.endsWith('.db')) : [];
  console.log('Root .db files:', files);
  console.log('Server .db files:', serverFiles);
  process.exit(0);
}

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables.map(t => t.name).join(', '));

  const candleTable = tables.find(t => t.name.includes('candle') || t.name.includes('m5'));
  if (candleTable) {
    const counts = db.prepare(`SELECT symbol, COUNT(*) as cnt, MIN(timestamp) as oldest, MAX(timestamp) as newest FROM ${candleTable.name} GROUP BY symbol ORDER BY symbol`).all();
    console.log('\nCandle cache per symbol:');
    counts.forEach(r => {
      const oldestDate = new Date(r.oldest).toISOString().substring(0,16);
      const newestDate = new Date(r.newest).toISOString().substring(0,16);
      console.log(' ', r.symbol.padEnd(10), ':', String(r.cnt).padStart(5), 'candles |', oldestDate, '->', newestDate);
    });
  }
} catch(e) { console.error('Error:', e.message); }
db.close();
