const { Client } = require('pg');
require('dotenv').config();
const fs = require('fs');

const expectedPairs = JSON.parse(fs.readFileSync('pairs.json', 'utf8'));
const client = new Client({ connectionString: process.env.DATABASE_URL });

client.connect().then(() => {
  client.query('SELECT id, profile_name, broker_symbol_map FROM trading_profiles').then(res => {
    console.log('\n--- Database Mapping Analysis ---');
    for (const row of res.rows) {
      let map = {};
      try { map = JSON.parse(row.broker_symbol_map || '{}'); } catch(e) {}
      const missing = [];
      const present = [];
      for (const pair of expectedPairs) {
        if (!map[pair]) {
          missing.push(pair);
        } else {
          present.push(pair);
        }
      }
      console.log(`Profile ${row.id} (${row.profile_name}):`);
      console.log(`  Total mapped: ${present.length} / ${expectedPairs.length}`);
      if (missing.length > 0) {
        console.log(`  Missing pairs: ${missing.join(', ')}`);
      } else {
        console.log(`  Missing pairs: NONE`);
      }
    }
    client.end();
  });
});
