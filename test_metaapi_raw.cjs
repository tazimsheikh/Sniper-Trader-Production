
require('dotenv').config();
const MetaApi = require('metaapi.cloud-sdk').default;
const { Pool } = require('pg');
const crypto = require('crypto');

function decrypt(text) {
  const ALGO = 'aes-256-gcm';
  const ENC_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv(ALGO, ENC_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

async function test() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const profileRes = await pool.query('SELECT user_id, metaapi_account_id FROM trading_profiles WHERE id = 40');
  const profile = profileRes.rows[0];
  const userRes = await pool.query('SELECT metaapi_token FROM users WHERE id = ', [profile.user_id]);
  const user = userRes.rows[0];
  
  const token = decrypt(user.metaapi_token);
  const accountId = decrypt(profile.metaapi_account_id);
  
  const api = new MetaApi(token);
  const account = await api.metatraderAccountApi.getAccount(accountId);
  const conn = account.getRPCConnection();
  await conn.connect();
  await conn.waitSynchronized();
  
  try {
    const candles = await conn.getHistoricalCandles('USDJPY', '1m', new Date(Date.now() - 3600000));
    console.log('USDJPY candles:', candles.length);
    
    const us30 = await conn.getHistoricalCandles('US30', '1m', new Date(Date.now() - 3600000));
    console.log('US30 candles:', us30.length);
    
    const dax = await conn.getHistoricalCandles('DAX40', '1m', new Date(Date.now() - 3600000));
    console.log('DAX40 candles:', dax.length);
  } catch (err) {
    console.error('API Error:', err.message);
  }
  process.exit(0);
}
test();

