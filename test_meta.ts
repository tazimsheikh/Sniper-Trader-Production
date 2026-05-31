import db from './server/db.js';
import { getSharedConnection, getSharedAccount } from './server/metaApiHandler.js';
import { decrypt, isEncrypted } from './server/crypto.js';

async function run() {
   const profile = await db.prepare('SELECT metaapi_token, metaapi_account_id FROM trading_profiles LIMIT 1').get() as any;
   const token = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
   const accId = isEncrypted(profile.metaapi_account_id) ? decrypt(profile.metaapi_account_id) : profile.metaapi_account_id;
   
   await getSharedConnection(token, accId, true);
   const account = await getSharedAccount(token, accId);
   
   // Test 1: Forward fetch
   let start1 = new Date();
   start1.setDate(start1.getDate() - 5);
   let c1 = await account.getHistoricalCandles('EURUSD', '15m', start1, 5);
   console.log("Forward fetch from 5 days ago:", c1.map(c => new Date(c.time).toISOString()));
   
   // Test 2: Backward fetch? (No start time)
   let c2 = await account.getHistoricalCandles('EURUSD', '15m', undefined, 5);
   console.log("No start time fetch:", c2.map(c => new Date(c.time).toISOString()));
   
   process.exit(0);
}
run().catch(console.error);
