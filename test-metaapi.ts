import db from './server/db.js';
import { decrypt, isEncrypted } from './server/crypto.js';
import { verifyMetaApiAccount, verifyMetaApiConnection, getSharedConnection } from './server/metaApiHandler.js';

async function test() {
  const users = await db.prepare('SELECT id, email, metaapi_token, metaapi_account_id FROM users').all() as any[];
  console.log('Found users:', users.length);
  for (const u of users) {
     if (!u.metaapi_token) continue;
     const token = isEncrypted(u.metaapi_token) ? decrypt(u.metaapi_token) : u.metaapi_token;
     console.log('User:', u.email);
     console.log('Token starts with:', token.substring(0, 15) + '...');
     
     let accId = u.metaapi_account_id;
     if (!accId) {
        const p = await db.prepare('SELECT metaapi_account_id FROM trading_profiles WHERE user_id = ?').get(u.id) as any;
        accId = p?.metaapi_account_id;
     }
     
     if (accId) {
       accId = isEncrypted(accId) ? decrypt(accId) : accId;
       console.log('Acc ID:', accId);
       try {
         const MetaApiPkg = (await import('metaapi.cloud-sdk/esm-node')).default;
         const api = new (MetaApiPkg as any)(token);
         console.log('Fetching account from MetaAPI cloud...');
         const account = await api.metatraderAccountApi.getAccount(accId);
         console.log('Account found:', account.id, 'State:', account.state, 'ConnectionStatus:', account.connectionStatus);
         
         console.log('Force deploying account...');
         await account.deploy();
         
         console.log('Waiting for account to be connected to broker...');
         await account.waitConnected();
         console.log('Account is fully connected to broker.');
         
         console.log('Testing RPC connection (waitSynchronized)...');
         const conn = account.getRPCConnection();
         await conn.connect();
         await conn.waitSynchronized();
         console.log('RPC Connected successfully!');
       } catch (e: any) {
         console.error('MetaAPI Fetch Error:', e.message);
         if (e.status) console.error('Status:', e.status);
         if (e.body) console.error('Body:', e.body);
       }
     } else {
       console.log('No account ID found for user');
     }
  }
}
test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
