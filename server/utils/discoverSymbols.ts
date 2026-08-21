import db from "../core/db.js";
import { getSharedConnection } from "../trading/broker/metaApiHandler.js";

const PAIRS_TO_DISCOVER = [
  // Indices
  { base: "GER40", pattern: /^(GER|DAX|DE)[34]0/i },
  { base: "US30", pattern: /^(US|DJ|WS|DOW)[34]0/i },
  { base: "NAS100", pattern: /^(NAS|US100|USTEC|NDX|NQ)/i },
  { base: "SPX500", pattern: /^(US500|SP500|SPX|S&P)/i },
  { base: "JPN225", pattern: /^(JPN|JP|NIKKEI)225/i },
  // Crypto
  { base: "BTCUSD", pattern: /^(BTCUSD|BITCOIN)/i },
  { base: "ETHUSD", pattern: /^(ETHUSD|ETHEREUM)/i },
  // Commodities
  { base: "XAUUSD", pattern: /^(XAUUSD|GOLD)/i },
  { base: "XTIUSD", pattern: /^(XTIUSD|USOIL|WTI)/i },
  // Majors & Minors
  { base: "EURUSD", pattern: /^EURUSD/i },
  { base: "GBPUSD", pattern: /^GBPUSD/i },
  { base: "USDCAD", pattern: /^USDCAD/i },
  { base: "USDJPY", pattern: /^USDJPY/i },
  { base: "AUDUSD", pattern: /^AUDUSD/i },
  { base: "NZDUSD", pattern: /^NZDUSD/i },
  { base: "USDCHF", pattern: /^USDCHF/i },
  // Crosses
  { base: "EURNZD", pattern: /^EURNZD/i },
  { base: "EURAUD", pattern: /^EURAUD/i },
  { base: "EURCAD", pattern: /^EURCAD/i },
  { base: "EURJPY", pattern: /^EURJPY/i },
  { base: "GBPJPY", pattern: /^GBPJPY/i },
  { base: "GBPAUD", pattern: /^GBPAUD/i },
  { base: "GBPCAD", pattern: /^GBPCAD/i },
  { base: "GBPNZD", pattern: /^GBPNZD/i },
  { base: "AUDJPY", pattern: /^AUDJPY/i },
  { base: "CADJPY", pattern: /^CADJPY/i },
  { base: "CHFJPY", pattern: /^CHFJPY/i },
];

export async function discoverBrokerSymbols(profileId: number, token: string, accountId: string) {
  try {
    let conn: any;
    try {
      conn = await getSharedConnection(token, accountId, true);
    } catch (e: any) {
      if (e.message?.includes("Fast fail")) {
        conn = await getSharedConnection(token, accountId, false);
      } else {
        throw e;
      }
    }
    console.log(`[AutoDiscover] Commencing suffix-probing discovery for profile ${profileId}...`);
    
    let SUFFIXES = ['', '.m', '.a', '.ecn', '.pro', '.raw', '.p', 'c', 'x', '_m', '.cash'];
    const INDEX_ALIASES: Record<string, string[]> = {
      "GER40": ["GER40", "DAX40", "DE40", "GER30", "DE30", "GDAXI", "DAX", "DAX30", ".DE40", ".GER40"],
      "US30": ["US30", "DJ30", "WS30", "DOW30", "DOWJONES", ".US30"],
      "NAS100": ["NAS100", "US100", "USTEC", "NDX", "NDX100", "NQ100", ".NAS100"],
      "SPX500": ["SPX500", "US500", "SP500", "SPX", ".SPX500"],
      "JPN225": ["JPN225", "JP225", "NIKKEI225", ".JPN225"],
      "XAUUSD": ["XAUUSD", "GOLD"],
      "XTIUSD": ["XTIUSD", "USOIL", "WTI"],
      "BTCUSD": ["BTCUSD", "BITCOIN"],
      "ETHUSD": ["ETHUSD", "ETHEREUM"],
    };

    const newMap: Record<string, string> = {};
    
    for (const { base } of PAIRS_TO_DISCOVER) {
      const aliases = INDEX_ALIASES[base] || [base];
      const candidates: { candidate: string, suffix: string }[] = [];
      
      // Build candidate list prioritizing the dynamically learned fastest suffix
      for (const alias of aliases) {
        for (const suffix of SUFFIXES) {
          candidates.push({ candidate: alias + suffix, suffix });
        }
      }

      let found = false;
      for (const { candidate, suffix } of candidates) {
        let attempts = 0;
        
        while (attempts < 3) {
          attempts++;
          try {
            // Slow down slightly to stay under the 500 CPU credits per 1s limit
            await new Promise(r => setTimeout(r, 10)); 
            const spec = await conn.getSymbolSpecification(candidate);
            
            if (spec && spec.tradeMode !== 'DISABLED' && spec.tradeMode !== 'CALCULATE') {
              newMap[base] = candidate;
              console.log(`[AutoDiscover] ✅ Mapped ${base} -> ${candidate} (tradeMode: ${spec.tradeMode})`);
              found = true;
              
              // Optimization: Prioritize this suffix for subsequent pairs to drop search time from 60s to <2s
              const suffixIdx = SUFFIXES.indexOf(suffix);
              if (suffixIdx > 0) {
                SUFFIXES.splice(suffixIdx, 1);
                SUFFIXES.unshift(suffix);
              }
            }
            break; // Break the retry loop (either found or not disabled, move to next or exit)
          } catch (e: any) {
            if (e.message?.includes("rateLimiting") || e.message?.includes("cpu credits")) {
              console.warn(`[AutoDiscover] Rate limit hit probing ${candidate}. Backing off 1s (Attempt ${attempts}/3)...`);
              await new Promise(r => setTimeout(r, 1000));
            } else {
              // Symbol doesn't exist, break the retry loop and try next candidate
              break;
            }
          }
        }
        if (found) break; // Break candidate loop if we found the symbol
      }
      
      if (!found) {
        console.log(`[AutoDiscover] ❌ No tradable match found for ${base}`);
      }
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
