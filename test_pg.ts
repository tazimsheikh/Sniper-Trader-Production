import db, { initDb, saveEmaState, loadEmaState } from './server/db.js';

async function testPostgres() {
  console.log("=== Testing PostgreSQL Connection ===");
  try {
    console.log("1. Initializing schema...");
    await initDb();
    console.log("   Schema initialized successfully.");

    console.log("\n2. Testing simple raw query...");
    const timeRes = await db.exec('SELECT NOW() as current_time');
    console.log("   Database time:", timeRes.rows[0].current_time);

    console.log("\n3. Testing parameterized INSERT/UPDATE (saveEmaState)...");
    const testBotId = "TEST_BOT_123";
    const testProfileId = 999;
    const testEma = 123.45;
    await saveEmaState(testBotId, testProfileId, testEma);
    console.log("   saveEmaState executed successfully.");

    console.log("\n4. Testing parameterized SELECT (loadEmaState)...");
    const loadedEma = await loadEmaState(testBotId, testProfileId);
    console.log(`   loadEmaState returned: ${loadedEma} (Expected: ${testEma})`);

    if (loadedEma === testEma) {
      console.log("\n✅ ALL POSTGRESQL TESTS PASSED SUCCESSFULLY!");
    } else {
      console.error("\n❌ DATA MISMATCH: Expected", testEma, "but got", loadedEma);
    }
  } catch (error) {
    console.error("\n❌ TEST FAILED WITH ERROR:", error);
  } finally {
    console.log("\nExiting...");
    process.exit(0);
  }
}

testPostgres();
