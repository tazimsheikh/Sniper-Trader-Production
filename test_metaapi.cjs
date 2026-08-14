
const { getSharedConnection } = require('./server/trading/broker/metaApiHandler.js');
const db = require('./server/core/db.js').default;
const { decrypt } = require('./server/core/crypto.js');

async function test() {
  const tp = db.prepare('SELECT metaapi_token, metaapi_account_id FROM users WHERE id = 1').get();
  if (!tp) return console.error('No user found');
  const token = decrypt(tp.metaapi_token);
  const accountId = decrypt(tp.metaapi_account_id);
  
  try {
    const conn = await getSharedConnection(token, accountId);
    console.log('Connected. Fetching candles for USDJPY...');
    const candles = await conn.getHistoricalCandles('USDJPY', '1m', new Date(Date.now() - 3600000));
    console.log('Got', candles.length, 'candles for USDJPY');
  } catch (err) {
    console.error('Error fetching USDJPY:', err.message);
  }
  process.exit(0);
}
test();

