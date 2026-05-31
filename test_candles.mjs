import { getProfileMarkets, getProfileM15Candles } from './server/marketStore.js';
import db from './server/db.js';

async function test() {
  const profile = db.prepare('SELECT id FROM trading_profiles LIMIT 1').get();
  if (!profile) {
    console.log("No profile found");
    return;
  }
  const pid = profile.id;
  console.log("Profile ID:", pid);
  
  const markets = getProfileMarkets(pid);
  console.log("Markets Keys:", Object.keys(markets));
  
  // Try XAUUSD
  const symbol = 'XAUUSD'; 
  const candles = getProfileM15Candles(pid, symbol);
  console.log(`Candles for ${symbol}:`, candles.length);
  if (candles.length > 0) {
     console.log("First candle:", candles[0]);
     console.log("Last candle:", candles[candles.length - 1]);
  }
}

test().catch(console.error);
