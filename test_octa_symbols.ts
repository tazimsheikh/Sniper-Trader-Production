import 'dotenv/config';
import { decrypt, isEncrypted } from './server/core/crypto.ts';
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

console.log('Fetching all symbols containing US30, DJ, NAS...');
const res = await fetch('https://mt-client-api-v1.new-york.agiliumtrade.ai/users/current/accounts/' + rawAcc + '/symbols', { headers: { 'auth-token': rawToken } });
const data = await res.json();
if (Array.isArray(data)) {
  const names = data.map(s => s.symbol);
  console.log('Available:', names.filter(n => n.toLowerCase().includes('us30') || n.toLowerCase().includes('dj') || n.toLowerCase().includes('nas') || n.toLowerCase().includes('ustec')));
} else {
  console.log('Error fetching symbols:', data);
}
