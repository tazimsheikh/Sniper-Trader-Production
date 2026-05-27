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

const STARTING_BALANCE = 100;
// XAUUSD 1 lot = 100 oz. 1 pip = 0.01. So 100 * 0.01 = $1
const PIP_VALUE_PER_LOT = 1;

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

function runStrategyForTrades(
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  entryHour: number, entryMin: number,
  slPips: number, tpPips: number,
  riskPct: number, emaPeriod: number,
  reverse: boolean, pipSize: number, spread: number,
  commissionRoundTrip: number
) {
  let balance = STARTING_BALANCE;
  let emaHtf = 0;
  const trades: any[] = [];
  let maxDD = 0;
  let peak = STARTING_BALANCE;

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
    // Dynamic Rejection logic: if 0.01 risk > 5%, reject
    const minRisk = 0.01 * slPips * PIP_VALUE_PER_LOT;
    if (minRisk > riskAmount) {
      continue;
    }

    // Hard cap max lots
    const calculatedLots = riskAmount / (slPips * PIP_VALUE_PER_LOT);
    const lots = Math.max(0.01, Math.min(0.1, parseFloat(calculatedLots.toFixed(2))));

    const tradeCandles = todayCandles.filter(c => c.time > entryCandle.time);
    let closed = false;

    for (const c of tradeCandles) {
      if (bias === 'BUY') {
        if (c.low <= slPrice) {
          const profit = -(slPips * PIP_VALUE_PER_LOT * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push({ profit });
          closed = true; break;
        }
        if (c.high >= tpPrice) {
          const profit = (tpPips * PIP_VALUE_PER_LOT * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push({ profit });
          closed = true; break;
        }
      } else {
        if (c.high + spread >= slPrice) {
          const profit = -(slPips * PIP_VALUE_PER_LOT * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push({ profit });
          closed = true; break;
        }
        if (c.low <= tpPrice) {
          const profit = (tpPips * PIP_VALUE_PER_LOT * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push({ profit });
          closed = true; break;
        }
      }
    }

    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const profitPips = bias === 'BUY' ? (last.close - entryPrice) / pipSize : (entryPrice - last.close) / pipSize;
      const profit = (profitPips * PIP_VALUE_PER_LOT * lots) - (commissionRoundTrip * lots);
      balance += profit;
      trades.push({ profit });
    }

    if (balance > peak) peak = balance;
    const dd = ((peak - balance) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const wins = trades.filter(t => t.profit > 0).length;
  return {
    balance,
    profit: balance - STARTING_BALANCE,
    maxDD,
    trades: trades.length,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0
  };
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'data');
  const pair = 'XAUUSD';
  
  const dataFiles = fs.readdirSync(dataDir);
  const dataFile = dataFiles.find(f => f.startsWith(pair) && f.endsWith('.csv'));
  
  if (!dataFile) {
    console.error('Data file for XAUUSD not found');
    return;
  }

  console.log('Loading data...');
  const candles = await loadData(path.join(dataDir, dataFile));
  
  const daysObj: Record<string, Candle[]> = {};
  for (const c of candles) {
    if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
    daysObj[c.dateStr].push(c);
  }
  const dateKeys = Object.keys(daysObj).sort();
  
  // Use last 1 year data to find the sweet spot for a faster scan
  const END_DATE = new Date('2026-05-01T00:00:00Z').getTime();
  const START_DATE = END_DATE - (365 * 24 * 60 * 60 * 1000);
  
  // Filter daysObj down to last 1 year
  const recentDateKeys = dateKeys.filter(k => {
    const time = new Date(k + 'T00:00:00Z').getTime();
    return time >= START_DATE && time <= END_DATE;
  });

  const pipSize = 0.01;
  const commissionRT = 7;
  const slippagePips = 1.0;
  const baseSpread = pipSize;
  const totalSpreadSlippage = baseSpread + (slippagePips * pipSize);

  // Stacey Burke typically trades NY (12-16 UTC) or London (7-11 UTC)
  // Let's scan hours 7 to 16
  const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const minutes = [0, 15, 30, 45];
  // Common Gold parameters based on existing config
  const slPips = 400; // $4
  const tpPips = 1000; // $10
  const emaPeriod = 30; // Let's use 30 as it was the default
  const riskPct = 5;

  let bestResult = null;

  console.log('Scanning for XAUUSD Sweet Spot...');
  for (const hr of hours) {
    for (const min of minutes) {
      // test both reverse=true and reverse=false
      for (const reverse of [true, false]) {
        const result = runStrategyForTrades(
          daysObj, recentDateKeys,
          hr, min,
          slPips, tpPips,
          riskPct, emaPeriod,
          reverse, pipSize, totalSpreadSlippage,
          commissionRT
        );

        if (result.trades > 20) {
          if (!bestResult || result.profit > bestResult.profit) {
            bestResult = { hr, min, reverse, ...result };
          }
          console.log(`Time ${hr}:${min}, reverse=${reverse} -> WinRate: ${result.winRate.toFixed(1)}%, Profit: $${result.profit.toFixed(2)}, MaxDD: ${result.maxDD.toFixed(1)}%`);
        }
      }
    }
  }

  console.log('\n==================================');
  console.log('BEST XAUUSD SWEET SPOT FOUND:');
  console.log('==================================');
  console.log(bestResult);
}

main().catch(console.error);
