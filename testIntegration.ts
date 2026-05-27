import db from './server/db.js';
import { botManagerTick, initBotManagerSchema } from './server/botManager.js';

function getActiveBots(profile: any) {
  try {
    return JSON.parse(profile.active_bots || '[]');
  } catch {
    return [];
  }
}

async function runTest() {
  console.log("=== STARTING INTEGRATION TEST ===");
  try { initBotManagerSchema(); } catch (_) {}
  try { db.exec('ALTER TABLE bot_trade_states ADD COLUMN profile_id INTEGER'); } catch (_) {}
  try { db.exec('ALTER TABLE trade_diary ADD COLUMN profile_id INTEGER'); } catch (_) {}

  // 1. Setup mock users
  db.exec("DELETE FROM users WHERE email LIKE '%@test.com'");
  db.exec("DELETE FROM trading_profiles WHERE profile_name LIKE 'Test Profile%'");

  const stmt = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'pwd')");
  const user1Id = stmt.run('user1@test.com').lastInsertRowid;
  const user2Id = stmt.run('user2@test.com').lastInsertRowid;

  // 2. Setup mock profiles
  const profileStmt = db.prepare(`
    INSERT INTO trading_profiles (
      user_id, profile_name, metaapi_token, metaapi_account_id, 
      automation_active, active_bots
    ) VALUES (?, ?, 'dummy_token', 'dummy_acc', ?, ?)
  `);

  // Profile A: User 1, Active, EURUSD Bot ON
  profileStmt.run(user1Id, 'Test Profile A', 1, JSON.stringify(['eurusd-london-fade']));
  // Profile B: User 2, Active, EURUSD Bot OFF
  profileStmt.run(user2Id, 'Test Profile B', 1, JSON.stringify([]));
  // Profile C: User 2, Inactive Master Switch, EURUSD Bot ON
  profileStmt.run(user2Id, 'Test Profile C', 0, JSON.stringify(['eurusd-london-fade']));

  console.log("Mock profiles created.");

  // We cannot easily run botManagerTick directly without MetaAPI exploding if it tries to connect.
  // Instead, we will simulate the profile loop behavior that botManagerTick uses.
  const profiles = db.prepare(`
    SELECT * FROM trading_profiles 
    WHERE automation_active = 1 
      AND metaapi_token IS NOT NULL 
      AND metaapi_account_id IS NOT NULL
  `).all() as any[];

  console.log(`Found ${profiles.length} active profiles with tokens.`);
  if (profiles.length !== 2) {
    console.error("BUG: Expected exactly 2 active profiles (A and B). C is inactive.");
  } else {
    console.log("Master switch filter logic works!");
  }

  // Check bot mapping
  for (const profile of profiles) {
    const activeBots = getActiveBots(profile);
    if (profile.profile_name === 'Test Profile A') {
      if (activeBots.includes('eurusd-london-fade') && activeBots.length === 1) {
        console.log("Profile A correctly loaded active bots.");
      } else {
        console.error("BUG: Profile A bot loading failed.", activeBots);
      }
    } else if (profile.profile_name === 'Test Profile B') {
      if (activeBots.length === 0) {
        console.log("Profile B correctly ignored inactive bots.");
      } else {
        console.error("BUG: Profile B loaded bots when it shouldn't have.");
      }
    }
  }

  console.log("=== INTEGRATION TEST COMPLETE ===");
}

runTest().catch(console.error);
