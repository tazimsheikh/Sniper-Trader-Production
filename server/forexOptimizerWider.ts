/**
 * forexOptimizerFast.ts — Single-pair focused optimizer
 *
 * Usage: npx tsx server/forexOptimizerFast.ts <PAIR> <PIP_SIZE>
 * Example: npx tsx server/forexOptimizerFast.ts AUDUSD 0.0001
 *
 * Narrower but still thorough parameter sweep.
 * Outputs the top 5 results to stdout in a parseable format.
 */

import fs from 'fs';
import path from 'path';

interface Candle {
  dateStr: string;
  timeStr: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const PIP_VALUE_PER_LOT = 10;
const STARTING_BALANCE = 100;

async function loadData(filePath: string): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const results: Candle[] = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    let isFirstLine = true;
    let buffer = '';

    stream.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (isFirstLine) { isFirstLine = false; continue; }
        if (!line) continue;
        const p = line.split('\t');
        if (p.length < 6) continue;
        const dateStr = p[0].replace(/\./g, '-');
        const timeStr = p[1];
        const open = parseFloat(p[2]);
        if (isNaN(open)) continue;
        results.push({
          dateStr, timeStr,
          time: new Date(`${dateStr}T${timeStr}Z`).getTime(),
          open, high: parseFloat(p[3]), low: parseFloat(p[4]), close: parseFloat(p[5]),
        });
      }
    });
    stream.on('end', () => resolve(results));
    stream.on('error', reject);
  });
}

function runStrategy(
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  entryHour: number, entryMin: number,
  slPips: number, tpPips: number,
  riskPct: number, emaPeriod: number,
  reverse: boolean, pipSize: number, spread: number,
) {
  let balance = STARTING_BALANCE;
  let peakBalance = STARTING_BALANCE;
  let maxDD = 0;
  let wins = 0, totalTrades = 0;
  let emaHtf = 0;

  for (let d = 1; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const todayCandles = daysObj[dateKeys[d]];
    if (!todayCandles || todayCandles.length < 60) continue;

    for (const c of todayCandles) {
      if (emaHtf === 0) emaHtf = c.close;
      else emaHtf = c.close * (2 / (emaPeriod + 1)) + emaHtf * (1 - 2 / (emaPeriod + 1));
    }

    const entryCandle = todayCandles.find(c => {
      const [h, m] = c.timeStr.split(':').map(Number);
      return h === entryHour && m === entryMin;
    });
    if (!entryCandle) continue;

    let bias: 'BUY' | 'SELL' = entryCandle.close > emaHtf ? 'BUY' : 'SELL';
    if (reverse) bias = bias === 'BUY' ? 'SELL' : 'BUY';

    const entryPrice = bias === 'BUY' ? entryCandle.close + spread : entryCandle.close;
    const slPrice = bias === 'BUY' ? entryPrice - slPips * pipSize : entryPrice + slPips * pipSize;
    const tpPrice = bias === 'BUY' ? entryPrice + tpPips * pipSize : entryPrice - tpPips * pipSize;

    const riskAmount = balance * (riskPct / 100);
    const lots = Math.max(0.01, Math.min(100, parseFloat((riskAmount / (slPips * PIP_VALUE_PER_LOT)).toFixed(2))));

    const tradeCandles = todayCandles.filter(c => c.time > entryCandle.time);
    let closed = false;

    for (const c of tradeCandles) {
      if (bias === 'BUY') {
        if (c.low <= slPrice) { balance -= slPips * PIP_VALUE_PER_LOT * lots; totalTrades++; closed = true; break; }
        if (c.high >= tpPrice) { balance += tpPips * PIP_VALUE_PER_LOT * lots; wins++; totalTrades++; closed = true; break; }
      } else {
        if (c.high + spread >= slPrice) { balance -= slPips * PIP_VALUE_PER_LOT * lots; totalTrades++; closed = true; break; }
        if (c.low <= tpPrice) { balance += tpPips * PIP_VALUE_PER_LOT * lots; wins++; totalTrades++; closed = true; break; }
      }
    }

    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const profitPips = bias === 'BUY' ? (last.close - entryPrice) / pipSize : (entryPrice - last.close) / pipSize;
      balance += profitPips * PIP_VALUE_PER_LOT * lots;
      if (profitPips > 0) wins++;
      totalTrades++;
    }

    if (balance > peakBalance) peakBalance = balance;
    const dd = ((peakBalance - balance) / peakBalance) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    finalBalance: balance,
    trades: totalTrades,
    wins,
    wr: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    maxDD,
    returnPct: ((balance - STARTING_BALANCE) / STARTING_BALANCE) * 100,
  };
}

async function main() {
  const pairArg = process.argv[2] || 'EURUSD';
  const pipSizeArg = parseFloat(process.argv[3] || '0.0001');

  // Find the data file
  const dataDir = path.join(process.cwd(), 'data');
  const files = fs.readdirSync(dataDir);
  const dataFile = files.find(f => f.startsWith(pairArg) && f.endsWith('.csv'));
  if (!dataFile) {
    console.error(`No data file found for ${pairArg} in ${dataDir}`);
    process.exit(1);
  }

  const spread = pipSizeArg; // 1 pip spread

  console.log(`Loading ${pairArg} from ${dataFile}...`);
  const candles = await loadData(path.join(dataDir, dataFile));
  console.log(`Loaded ${candles.length.toLocaleString()} M1 candles.`);

  const daysObj: Record<string, Candle[]> = {};
  for (const c of candles) {
    if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
    daysObj[c.dateStr].push(c);
  }
  const dateKeys = Object.keys(daysObj).sort();
  console.log(`${dateKeys.length} trading days: ${dateKeys[0]} → ${dateKeys[dateKeys.length - 1]}`);

  // Focused but thorough parameter sweep
  const emaPeriods  = [30, 60, 120, 240];
  const entryHours  = [0, 1, 2, 3, 7, 8, 9, 13, 14, 15];
  const entryMins   = [0, 15, 30];
  const slOptions   = [8, 10, 15, 20, 25, 30];
  const tpOptions   = [20, 30, 40, 50, 60, 80, 100];
  const reverseOpts = [false, true];

  const totalCombos = emaPeriods.length * entryHours.length * entryMins.length *
    slOptions.length * tpOptions.length * reverseOpts.length;
  console.log(`Running ${totalCombos} parameter combos...`);

  const top5: Array<{ params: any; result: any }> = [];
  let combosRun = 0;

  for (const ema of emaPeriods) {
    for (const hr of entryHours) {
      for (const min of entryMins) {
        for (const sl of slOptions) {
          for (const tp of tpOptions) {
            for (const reverse of reverseOpts) {
              combosRun++;
              const res = runStrategy(daysObj, dateKeys, hr, min, sl, tp, 5, ema, reverse, pipSizeArg, spread);

              if (res.finalBalance > STARTING_BALANCE && res.trades >= 200 && res.maxDD <= 30) {
                const entry = {
                  params: { ema, hr, min, sl, tp, reverse, risk: 5 },
                  result: res,
                };
                top5.push(entry);
                top5.sort((a, b) => b.result.returnPct - a.result.returnPct);
                if (top5.length > 5) top5.length = 5;

                if (top5[0] === entry) {
                  console.log(
                    `[BEST] $${res.finalBalance.toFixed(0)} (+${(res.returnPct / 1000).toFixed(0)}K%) | ` +
                    `DD: ${res.maxDD.toFixed(1)}% | WR: ${res.wr.toFixed(1)}% | ${res.trades}T | ` +
                    `EMA:${ema} ${hr}:${String(min).padStart(2, '0')} SL:${sl} TP:${tp} ${reverse ? 'FADE' : 'TREND'}`
                  );
                }
              }

              if (combosRun % 1000 === 0) {
                process.stderr.write(`  ${pairArg}: ${combosRun}/${totalCombos} combos done...\r`);
              }
            }
          }
        }
      }
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  TOP 5 RESULTS FOR ${pairArg}`);
  console.log(`${'═'.repeat(60)}`);
  for (let i = 0; i < top5.length; i++) {
    const { params: p, result: r } = top5[i];
    const sessionLabel =
      p.hr <= 3 ? 'Asian/Tokyo' :
      p.hr <= 9 ? 'London' : 'New York';
    console.log(
      `  ${i + 1}. $${r.finalBalance.toFixed(0)} (+${(r.returnPct / 1000).toFixed(0)}K%) | ` +
      `DD: ${r.maxDD.toFixed(1)}% | WR: ${r.wr.toFixed(1)}% | ${r.trades}T | ` +
      `${sessionLabel} ${p.hr}:${String(p.min).padStart(2, '0')} | ` +
      `EMA:${p.ema} SL:${p.sl} TP:${p.tp} ${p.reverse ? 'FADE' : 'TREND'}`
    );
  }

  // Write JSON for this pair
  const outPath = path.join(process.cwd(), `optimizer_${pairArg}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ pair: pairArg, pipSize: pipSizeArg, top5 }, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
