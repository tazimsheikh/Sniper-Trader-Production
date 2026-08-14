
import db from './server/core/db.js';

async function test() {
  const profile = db.prepare('SELECT id, user_id, metaapi_account_id, metaapi_token FROM trading_profiles WHERE id IN (40, 42, 43)').all();
  console.table(profile);
  const users = db.prepare('SELECT id, metaapi_token FROM users WHERE id IN (SELECT user_id FROM trading_profiles WHERE id IN (40, 42, 43))').all();
  console.table(users);
  process.exit(0);
}
test();

