const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'database.sqlite'));

try {
  db.exec('DELETE FROM pending_signals;');
  db.exec('DELETE FROM trading_profiles;');
  db.exec('DELETE FROM otps;');
  db.exec('DELETE FROM users;');
  console.log('Database wiped successfully.');
} catch (e) {
  console.error('Failed to wipe DB:', e);
}
db.close();
