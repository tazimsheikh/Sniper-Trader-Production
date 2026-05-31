import db from './server/db.js';
import { getProviderForProfile } from './server/candleProvider.js';

async function run() {
   const profile = await db.prepare('SELECT id FROM trading_profiles LIMIT 1').get() as any;
   if (!profile) return console.log("No profile");
   
   console.log("Using profile ID:", profile.id);
   const provider = await getProviderForProfile(profile.id);
   console.log("Provider source:", provider.source);
   
   try {
     console.log("Fetching M15 candles from provider...");
     const candles = await provider.get15MinuteCandles('EURUSD=X', 'EURUSD', 50);
     console.log(`Provider returned ${candles.length} candles.`);
     if (candles.length > 0) {
       console.log("First candle:", candles[0]);
       console.log("Last candle:", candles[candles.length - 1]);
     }
   } catch(e: any) {
     console.log("Provider threw:", e.message);
   }
   process.exit(0);
}
run().catch(console.error);
