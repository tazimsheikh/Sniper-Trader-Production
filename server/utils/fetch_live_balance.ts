import { getSharedStreamingConnection } from '../trading/broker/metaApiHandler.js';
import db from '../core/db.js';
import { decrypt, isEncrypted } from '../core/crypto.js';

async function run() {
  const profileId = 33;
  const profile = db.prepare("SELECT t.metaapi_account_id, COALESCE(t.metaapi_token, u.metaapi_token) as token FROM trading_profiles t JOIN users u ON t.user_id = u.id WHERE t.id = ?").get(profileId) as any;
  
  if (!profile) {
    console.log("Profile not found");
    return;
  }
  
  let token = profile.token;
  if (isEncrypted(token)) token = decrypt(token);
  
  let accountId = profile.metaapi_account_id;
  if (isEncrypted(accountId)) accountId = decrypt(accountId);
  
  console.log("Decrypted Account ID:", accountId);
  console.log("Connecting to MetaAPI...");
  try {
    const conn = await getSharedStreamingConnection(token, accountId, false);
    if (conn) {
      const info = await conn.getAccountInformation();
      console.log("REAL LIVE BROKER INFO:");
      console.log(info);
    }
  } catch (err: any) {
    console.error("MetaAPI Connection Error:", err.message);
  }
  
  process.exit(0);
}

run().catch(console.error);
