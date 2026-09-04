import db from "../../core/db.js";
import { globalTradeGate } from "../../utils/GlobalTradeGate.js";

async function main() {
  console.log("🔍 Checking all AUDJPY trades in database...");
  
  const before = await db.prepare("SELECT * FROM bot_trade_states WHERE broker_symbol LIKE '%AUDJPY%'").all();
  console.log(`Found ${before.length} AUDJPY trade(s) in bot_trade_states:`);
  console.log(JSON.stringify(before, null, 2));

  const nowMs = Date.now();
  const res = await db.prepare(`
    UPDATE bot_trade_states 
    SET status = 'CLOSED', close_time = ? 
    WHERE broker_symbol LIKE '%AUDJPY%' AND status != 'CLOSED'
  `).run(nowMs);

  console.log(`\n✅ Updated ${res.changes} active AUDJPY trade(s) to 'CLOSED' in bot_trade_states.`);

  // Also check if any were in globalTradeGate
  try {
    for (const t of before) {
      if (t.profile_id && t.meta_order_id) {
        globalTradeGate.release(t.profile_id, t.meta_order_id);
      }
      if (t.profile_id && t.id) {
        globalTradeGate.release(t.profile_id, t.id);
      }
    }
  } catch (err) {
    // ignore
  }

  const after = await db.prepare("SELECT id, bot_id, broker_symbol, status, meta_order_id, open_time, close_time FROM bot_trade_states WHERE broker_symbol LIKE '%AUDJPY%'").all();
  console.log("\n📋 Current AUDJPY records in bot_trade_states after update:");
  console.log(JSON.stringify(after, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error closing AUDJPY trades:", err);
  process.exit(1);
});
