import { getSharedStreamingConnection, getSharedConnection } from '../trading/broker/metaApiHandler.js';
import db from '../core/db.js';
import { decrypt, isEncrypted } from '../core/crypto.js';

async function run() {
  const p40 = await db.prepare("SELECT t.*, COALESCE(t.metaapi_token, u.metaapi_token) as token FROM trading_profiles t JOIN users u ON t.user_id = u.id WHERE t.id = 40").get() as any;
  let token = p40.token;
  if (isEncrypted(token)) token = decrypt(token);
  let accId = p40.metaapi_account_id;
  if (isEncrypted(accId)) accId = decrypt(accId);

  const conn = await getSharedConnection(token, accId, false);
  if (!conn) {
    console.error("No conn");
    process.exit(1);
  }

  const openTrades = await db.prepare("SELECT profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, tp_price FROM bot_trade_states WHERE status = 'OPEN'").all();
  console.log("=== CURRENT OPEN TRADES IN DB ===");
  console.table(openTrades);

  console.log("\n=== LIVE BROKER PRICES & PROXIMITY ===");
  const testSymbols = ["NAS100", "GBPJPY", "US30", "DAX40"];
  for (const sym of testSymbols) {
    try {
      const price = await conn.getSymbolPrice(sym);
      console.log(`Live Price for ${sym}: bid=${price.bid}, ask=${price.ask}`);
    } catch (e: any) {
      console.log(`Failed to get price for ${sym}: ${e.message}`);
    }
  }

  process.exit(0);
}

run().catch(console.error);
