import fs from 'fs';
import readline from 'readline';
import path from 'path';

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }

const START = new Date('2025-05-01T00:00:00Z').getTime();
const END   = new Date('2026-04-30T23:59:59Z').getTime();
const SPREAD = 1.0;

async function load(fp: string): Promise<Candle[]> {
  const c: Candle[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
  let first = true;
  for await (const ln of rl) {
    if (first) { first = false; continue; }
    const p = ln.split('\t');
    if (p.length < 6) continue;
    const dp = p[0].replace(/\./g, '-');
    const t = new Date(`${dp}T${p[1]}Z`).getTime();
    if (t < START) continue;
    if (t > END) continue;
    c.push({ time: t, dateStr: new Date(t).toISOString(), open: +p[2], high: +p[3], low: +p[4], close: +p[5] });
  }
  return c.sort((a, b) => a.time - b.time);
}

async function main() {
  console.log("Loading GBPUSD 1-Year Data...");
  const m1 = await load(path.join(process.cwd(), 'data', 'GBPUSD_M1_202105030000_202605010159.csv'));
  
  // Build Daily Candles
  const daily: Candle[] = [];
  let curDay = '';
  let dO = 0, dH = -Infinity, dL = Infinity;
  let buf: Candle[] = [];
  
  // To analyze intraday of the Trade Day, we store M1 candles grouped by Day
  const m1ByDay: Record<string, Candle[]> = {};

  for (const c of m1) {
    const dp = c.dateStr.split('T')[0];
    if (dp !== curDay) {
      if (curDay && m1ByDay[curDay] && m1ByDay[curDay].length > 0) {
        const lastC = m1ByDay[curDay][m1ByDay[curDay].length-1];
        daily.push({ time: new Date(`${curDay}T00:00:00Z`).getTime(), dateStr: curDay, open: dO, high: dH, low: dL, close: lastC.close });
      }
      curDay = dp; dO = c.open; dH = c.high; dL = c.low;
      m1ByDay[curDay] = [];
    } else {
      dH = Math.max(dH, c.high); dL = Math.min(dL, c.low);
    }
    m1ByDay[curDay].push(c);
  }
  // push last
  if (curDay && m1ByDay[curDay] && m1ByDay[curDay].length > 0) {
    const lastC = m1ByDay[curDay][m1ByDay[curDay].length-1];
    daily.push({ time: new Date(`${curDay}T00:00:00Z`).getTime(), dateStr: curDay, open: dO, high: dH, low: dL, close: lastC.close });
  }

  console.log(`Loaded ${daily.length} daily candles.`);

  let setupCount = 0;
  let successCount = 0; // The Trade Day closed in the correct continuation direction
  
  // Let's track NY session stats
  let nyProvidedTrade = 0; // NY provided a 20+ pip move in the correct direction

  console.log("\n--- FORENSIC ANALYSIS OF DAY 2 CONTINUATIONS ---");
  
  for (let i = 3; i < daily.length - 1; i++) {
    const dMinus3 = daily[i-3];
    const dMinus2 = daily[i-2];
    const dMinus1 = daily[i-1];
    const signalDay = daily[i];
    const tradeDay = daily[i+1];

    const dMinus3Green = dMinus3.close > dMinus3.open;
    const dMinus2Green = dMinus2.close > dMinus2.open;
    const dMinus1Green = dMinus1.close > dMinus1.open;
    const signalDayRed = signalDay.close < signalDay.open;

    const dMinus3Red = dMinus3.close < dMinus3.open;
    const dMinus2Red = dMinus2.close < dMinus2.open;
    const dMinus1Red = dMinus1.close < dMinus1.open;
    const signalDayGreen = signalDay.close > signalDay.open;

    // EXACTLY 2 days of trend (not 3)
    let isShortSetup = dMinus3Red && dMinus2Green && dMinus1Green && signalDayRed;
    let isLongSetup = dMinus3Green && dMinus2Red && dMinus1Red && signalDayGreen;

    if (isShortSetup || isLongSetup) {
      setupCount++;
      const dir = isShortSetup ? 'SHORT' : 'LONG';
      console.log(`\n[SETUP #${setupCount}] Direction: ${dir} | Signal Day: ${signalDay.dateStr} | Trade Day: ${tradeDay.dateStr}`);
      
      const tradeDayM1 = m1ByDay[tradeDay.dateStr.split('T')[0]];
      if (!tradeDayM1) continue;

      // Did the Trade Day close in the correct continuation direction?
      const tradeDayRed = tradeDay.close < tradeDay.open;
      const tradeDayGreen = tradeDay.close > tradeDay.open;
      
      let successfulClose = false;
      if (isShortSetup && tradeDayRed) successfulClose = true;
      if (isLongSetup && tradeDayGreen) successfulClose = true;
      
      if (successfulClose) successCount++;
      console.log(`  -> Daily Close Success: ${successfulClose ? 'YES' : 'NO'} (Open: ${tradeDay.open}, Close: ${tradeDay.close})`);

      // Intraday Analysis (Asian, London, NY)
      let asianH = -Infinity, asianL = Infinity;
      let londonH = -Infinity, londonL = Infinity;
      let nyH = -Infinity, nyL = Infinity;
      let nyOpenPrice = 0;
      let foundNyOpen = false;

      for (const c of tradeDayM1) {
        const h = new Date(c.time).getUTCHours();
        if (h >= 0 && h < 6) { asianH = Math.max(asianH, c.high); asianL = Math.min(asianL, c.low); }
        if (h >= 7 && h < 12) { londonH = Math.max(londonH, c.high); londonL = Math.min(londonL, c.low); }
        if (h >= 12 && h < 16) { 
            if (!foundNyOpen) { nyOpenPrice = c.open; foundNyOpen = true; }
            nyH = Math.max(nyH, c.high); nyL = Math.min(nyL, c.low); 
        }
      }

      console.log(`  -> Asian Range: ${(asianH - asianL).toFixed(4)}`);
      console.log(`  -> London broke Asian? High: ${londonH > asianH}, Low: ${londonL < asianL}`);
      
      // NY Opportunity: Did NY offer a 20 pip continuation from its open?
      if (isShortSetup) {
        const nyMaxDrop = nyOpenPrice - nyL;
        console.log(`  -> NY Max Drop from Open: ${(nyMaxDrop * 10000).toFixed(1)} pips`);
        if (nyMaxDrop >= 0.0020) nyProvidedTrade++;
      } else {
        const nyMaxRise = nyH - nyOpenPrice;
        console.log(`  -> NY Max Rise from Open: ${(nyMaxRise * 10000).toFixed(1)} pips`);
        if (nyMaxRise >= 0.0020) nyProvidedTrade++;
      }
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log(`SUMMARY OF EXACT "2 TREND DAYS -> SIGNAL DAY -> TRADE DAY" PATTERN`);
  console.log(`Total Perfect Setups found in 1 Year (GBPUSD): ${setupCount}`);
  if (setupCount > 0) {
    console.log(`Trade Day Closed in Continuation Direction: ${successCount} times (${((successCount/setupCount)*100).toFixed(1)}%)`);
    console.log(`NY Session offered a 20+ pip continuation trade: ${nyProvidedTrade} times (${((nyProvidedTrade/setupCount)*100).toFixed(1)}%)`);
  }
  console.log('═'.repeat(100));
}

main().catch(console.error);
