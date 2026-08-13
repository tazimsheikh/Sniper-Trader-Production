import db from "./server/core/db.js";
import { getSharedConnection } from "./server/trading/broker/metaApiHandler.js";
import { isEncrypted, decrypt } from "./server/core/crypto.js";

async function run() {
  const profileId = 43; // OctaFX
  const row = await (db as any).prepare(`
    SELECT u.metaapi_token, p.metaapi_account_id 
    FROM trading_profiles p 
    JOIN users u ON p.user_id = u.id 
    WHERE p.id = $1
  `).get(profileId);
  if (!row) {
    console.error("Profile not found");
    return;
  }

  const rawToken = isEncrypted(row.metaapi_token) ? decrypt(row.metaapi_token) : row.metaapi_token;
  let conn: any;
  try {
    conn = await getSharedConnection(rawToken, row.metaapi_account_id, true);
  } catch (e: any) {
    conn = await getSharedConnection(rawToken, row.metaapi_account_id, false);
  }

  console.log("Fetching symbols...");
  try {
    const symbolsRaw = await conn.getSymbols();
    const symbols = symbolsRaw.map((s: any) => typeof s === 'string' ? s : s.symbol);
    
    const eurUsdMatches = symbols.filter((s: string) => s.startsWith("EUR") && s.length <= 10);
    console.log("EUR* Matches:", eurUsdMatches.join(", "));

    if (eurUsdMatches.length > 0) {
      console.log(`\nFetching specification for ${eurUsdMatches[0]}...`);
      const spec = await conn.getSymbolSpecification(eurUsdMatches[0]);
      console.log(JSON.stringify(spec, null, 2));
    }
  } catch (e: any) {
    console.error("Error:", e.message);
  }
  process.exit(0);
}

run();
