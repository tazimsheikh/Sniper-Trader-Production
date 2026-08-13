import { getSharedConnection } from './dist/trading/broker/metaApiHandler.js';
import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
await client.connect();

const user = await client.query('SELECT metaapi_token FROM users WHERE id = 6');
const profile = await client.query('SELECT metaapi_account_id FROM trading_profiles WHERE id = 43');

const token = user.rows[0].metaapi_token;
const acc = profile.rows[0].metaapi_account_id;

// we must decrypt them
import { decrypt, isEncrypted } from './dist/core/crypto.js';
const rawToken = isEncrypted(token) ? decrypt(token) : token;
const rawAcc = isEncrypted(acc) ? decrypt(acc) : acc;

try {
  const conn = await getSharedConnection(rawToken, rawAcc, false);
  const symbols = await conn.getSymbols();
  const names = symbols.map(s => typeof s === 'string' ? s : s.symbol);
  console.log(names.filter(n => n.toLowerCase().includes('ger') || n.toLowerCase().includes('dax') || n.toLowerCase().includes('de')));
} catch (e) {
  console.error(e);
}
await client.end();
process.exit(0);
