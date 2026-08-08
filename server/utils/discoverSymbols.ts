import db from "../core/db.js";
import { getSharedConnection } from "../trading/broker/metaApiHandler.js";

const INDICES = [
  { base: "GER40", pattern: /^(GER|DAX|DE)[34]0/i },
  { base: "US30", pattern: /^(US|DJ|WS|DOW)[34]0/i },
  { base: "NAS100", pattern: /^(NAS|US100|USTEC|NDX|NQ)/i },
  { base: "SPX500", pattern: /^(US500|SP500|SPX|S&P)/i },
  { base: "JPN225", pattern: /^(JPN|JP|NIKKEI)225/i },
];

export async function discoverBrokerSymbols(profileId: number, token: string, accountId: string) {
  try {
    const conn = await getSharedConnection(token, accountId, true);
    console.log(`[AutoDiscover] Fetching all symbols for profile ${profileId}...`);
    let symbolsRaw: any[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        symbolsRaw = await conn.getSymbols();
        break;
      } catch (e: any) {
        if (attempt < 3 && (e.message?.includes("rateLimiting") || e.message?.includes("500 cpu credits"))) {
          console.warn(`[AutoDiscover] MetaAPI rate limited on attempt ${attempt}. Retrying in 1.5s...`);
          await new Promise(r => setTimeout(r, 1500));
        } else {
          throw e;
        }
      }
    }
    console.log(`[AutoDiscover] Fetched ${symbolsRaw.length} symbols.`);
    const symbols = symbolsRaw.map(s => typeof s === 'string' ? s : s.symbol);
    
    const newMap: Record<string, string> = {};
    
    for (const { base, pattern } of INDICES) {
      // Find all matches
      const matches = symbols.filter(s => pattern.test(s));
      if (matches.length === 0) {
        console.log(`[AutoDiscover] No match found for ${base}`);
        continue;
      }
      
      // If multiple matches, we prefer the one without "." suffix (like .Daily)
      // and we prefer exact matches or shorter strings if both have no suffix
      matches.sort((a, b) => {
        const aHasSuffix = a.includes('.');
        const bHasSuffix = b.includes('.');
        if (aHasSuffix && !bHasSuffix) return 1; // b is better
        if (!aHasSuffix && bHasSuffix) return -1; // a is better
        return a.length - b.length; // shorter is usually the standard one
      });
      
      const bestMatch = matches[0];
      newMap[base] = bestMatch;
      newMap[`${base}.Daily`] = bestMatch;
      console.log(`[AutoDiscover] Mapped ${base} / ${base}.Daily -> ${bestMatch} (out of ${matches.join(', ')})`);
    }
    
    if (Object.keys(newMap).length > 0) {
      // Fetch existing map
      const row = await (db as any).prepare("SELECT broker_symbol_map FROM trading_profiles WHERE id = $1").get(profileId);
      const existingMap = row && row.broker_symbol_map ? JSON.parse(row.broker_symbol_map) : {};
      
      const mergedMap = { ...existingMap, ...newMap };
      await (db as any).prepare("UPDATE trading_profiles SET broker_symbol_map = $1 WHERE id = $2").run(JSON.stringify(mergedMap), profileId);
      console.log(`[AutoDiscover] Updated database for profile ${profileId}.`);
    }
    return newMap;
  } catch(e: any) {
    console.error(`[AutoDiscover] Failed: ${e.message}`);
    throw e;
  }
}

// Optional: standalone runner
if (process.argv[1] && process.argv[1].includes("discoverSymbols")) {
  const profileId = parseInt(process.argv[2]);
  if (!isNaN(profileId)) {
    (db as any).prepare("SELECT metaapi_token, metaapi_account_id FROM trading_profiles WHERE id = $1").get(profileId)
      .then((row: any) => {
        if (row && row.metaapi_token) {
          return discoverBrokerSymbols(profileId, row.metaapi_token, row.metaapi_account_id);
        }
      })
      .then(() => process.exit(0))
      .catch((e: any) => {
        console.error(e);
        process.exit(1);
      });
  } else {
    console.error("Usage: tsx discoverSymbols.ts <profileId>");
    process.exit(1);
  }
}
