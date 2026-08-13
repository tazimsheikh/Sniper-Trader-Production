import { decrypt, isEncrypted } from './dist/core/crypto.js';
import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
await client.connect();
const user = await client.query('SELECT metaapi_token FROM users WHERE id = 6');
const profile = await client.query('SELECT metaapi_account_id FROM trading_profiles WHERE id = 43');
await client.end();

const token = user.rows[0].metaapi_token;
const acc = profile.rows[0].metaapi_account_id;

const rawToken = isEncrypted(token) ? decrypt(token) : token;
const rawAcc = isEncrypted(acc) ? decrypt(acc) : acc;

console.log('Fetching symbols from MetaAPI...');
const res = await fetch("https://mt-client-api-v1.agiliumtrade.ai/users/current/accounts/" + rawAcc + "/symbols", {
  headers: { 'auth-token': rawToken }
});
const data = await res.json();
if (Array.isArray(data)) {
  const names = data.map(s => s.symbol);
  console.log(names.filter(n => n.toLowerCase().includes('ger') || n.toLowerCase().includes('dax') || n.toLowerCase().includes('de')));
} else {
  console.log('Error fetching:', data);
}
