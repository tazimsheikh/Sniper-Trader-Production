import db from '../core/db.js';

async function run() {
  console.log("Updating existing trading profiles to enable DWCB by default...");
  try {
    await db.prepare('UPDATE trading_profiles SET dwcb_enabled = 1, mage_dwcb_enabled = 1').run();
    console.log("Success: dwcb_enabled and mage_dwcb_enabled set to 1 for all existing profiles.");
  } catch (err: any) {
    console.error("Error updating profiles:", err.message);
  } finally {
    process.exit(0);
  }
}

run();
