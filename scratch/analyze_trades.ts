import fs from 'fs';
import path from 'path';

const resultsPath = path.join(process.cwd(), 'public/backtest_results.json');
const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

console.log(`Total Trades: ${data.trades.length}`);
const losses = data.trades.filter((t: any) => t.profit < 0);
console.log(`Total Losses: ${losses.length}`);

// Print details of the first 3 losing trades
for (let i = 0; i < Math.min(3, losses.length); i++) {
  const t = losses[i];
  console.log(`\n--- Trade ${i + 1} ---`);
  console.log(`Direction: ${t.direction}`);
  console.log(`Entry Time: ${new Date(t.entryTime).toISOString()}`);
  console.log(`Exit Time: ${new Date(t.exitTime).toISOString()}`);
  console.log(`Entry Price: ${t.entryPrice}`);
  console.log(`SL Price: ${t.slPrice}`);
  console.log(`Exit Price: ${t.exitPrice}`);
  console.log(`Reason: ${t.status}`);
  console.log(`Pips: ${t.pips}`);
  
  // Find candles around entry
  const entryIdx = data.candles.findIndex((c: any) => c.time === t.entryTime);
  if (entryIdx !== -1) {
    console.log(`M1 Candles prior to entry:`);
    for (let j = Math.max(0, entryIdx - 2); j <= entryIdx; j++) {
      const c = data.candles[j];
      console.log(`  ${new Date(c.time).toISOString()} | O: ${c.open} H: ${c.high} L: ${c.low} C: ${c.close}`);
    }
  }
}
