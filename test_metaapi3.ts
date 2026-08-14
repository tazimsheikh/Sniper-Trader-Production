
import { getSharedConnection } from './server/trading/broker/metaApiHandler.js';
import db from './server/core/db.js';
import { decrypt, isEncrypted } from './server/core/crypto.js';

async function test() {
  const profile = db.prepare('SELECT metaapi_account_id, user_id FROM trading_profiles WHERE id = 40').get() as any;
  if (!profile) return console.error('No profile found');
  const user = db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(profile.user_id) as any;
  if (!user) return console.error('No user found');
  
  const token = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
  const accountId = isEncrypted(profile.metaapi_account_id) ? decrypt(profile.metaapi_account_id) : profile.metaapi_account_id;
  
  try {
    const conn = await getSharedConnection(token, accountId);
    console.log('Connected to profile 40. Fetching candles for USDJPY...');
    const candles = await conn.getHistoricalCandles('USDJPY', '1m', new Date(Date.now() - 3600000));
    console.log('Got', candles.length, 'candles for USDJPY');
    
    console.log('Fetching candles for GBPUSD...');
    const candles2 = await conn.getHistoricalCandles('GBPUSD', '1m', new Date(Date.now() - 3600000));
    console.log('Got', candles2.length, 'candles for GBPUSD');
  } catch (err: any) {
    console.error('Error fetching:', err.message);
  }
  process.exit(0);
}
test();

