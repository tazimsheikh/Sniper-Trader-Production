import db from "../core/db.js";

async function cleanupTrades() {
  console.log(`[TradeCleanup] 🧹 Starting daily trade cleanup...`);
  
  try {
    const result = await db.prepare(`
      DELETE FROM bot_trade_states 
      WHERE status IN ('CLOSED', 'FAILED', 'CANCELLED', 'FINISHED', 'WON', 'LOST') 
        AND created_at < NOW() - INTERVAL '48 hours'
    `).run();
    
    console.log(`[TradeCleanup] ✅ Successfully deleted ${result?.changes || 0} old trades.`);
    process.exit(0);
  } catch (err) {
    console.error(`[TradeCleanup] ❌ Error during trade cleanup:`, err);
    process.exit(1);
  }
}

cleanupTrades();
