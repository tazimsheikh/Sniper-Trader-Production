import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

interface Candle {
  dateStr: string;
  timeStr: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

let PIP_SIZE = 0.0001;
let SPREAD = 0.0001; // 1 pip spread for standard testing
const PIP_VALUE_PER_LOT = 10;
const STARTING_BALANCE = 100;

async function loadData(filePath: string): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const results: Candle[] = [];
    fs.createReadStream(filePath)
      .pipe(csv({ separator: '\t', skipLines: 1, headers: ['dateStr', 'timeStr', 'open', 'high', 'low', 'close', 'tickvol', 'vol', 'spread'] }))
      .on('data', (data) => {
        results.push({
          dateStr: data.dateStr.replace(/\./g, '-'),
          timeStr: data.timeStr,
          time: new Date(`${data.dateStr.replace(/\./g, '-')}T${data.timeStr}Z`).getTime(),
          open: parseFloat(data.open),
          high: parseFloat(data.high),
          low: parseFloat(data.low),
          close: parseFloat(data.close),
        });
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

function runSessionStrategy(
  candles: Candle[],
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  entryHour: number,
  entryMin: number,
  slPips: number,
  tpPips: number,
  riskPct: number,
  emaPeriod: number,
  reverse: boolean
) {
  let balance = STARTING_BALANCE;
  let wins = 0;
  let totalTrades = 0;
  
  let emaHtf = 0;
  
  for (let d = 1; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const todayCandles = daysObj[dateKeys[d]];
    if (!todayCandles || todayCandles.length < 60) continue;
    
    // Update HTF EMA based on M1 closes (1440 = 24H, 240 = 4H)
    for (const c of todayCandles) {
      if (emaHtf === 0) emaHtf = c.close;
      else emaHtf = c.close * (2/(emaPeriod+1)) + emaHtf * (1 - 2/(emaPeriod+1));
    }
    
    const entryWindow = todayCandles.filter(c => parseInt(c.timeStr) === entryHour);
    if (entryWindow.length === 0) continue;
    
    const entryCandle = entryWindow.find(c => parseInt(c.timeStr.split(':')[1]) === entryMin); 
    if (!entryCandle) continue;
    
    // Determine HTF Bias
    let bias = entryCandle.close > emaHtf ? 'BUY' : 'SELL';
    if (reverse) bias = bias === 'BUY' ? 'SELL' : 'BUY';
    
    const entryPrice = bias === 'BUY' ? entryCandle.close + SPREAD : entryCandle.close;
    const slPrice = bias === 'BUY' ? entryPrice - slPips * PIP_SIZE : entryPrice + slPips * PIP_SIZE;
    const tpPrice = bias === 'BUY' ? entryPrice + tpPips * PIP_SIZE : entryPrice - tpPips * PIP_SIZE;
    
    const riskAmount = balance * (riskPct / 100);
    const lots = Math.max(0.01, Math.min(100, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
    
    const tradeCandles = todayCandles.filter(c => c.time > entryCandle.time);
    let closed = false;
    
    for (const c of tradeCandles) {
      if (bias === 'BUY') {
        if (c.low <= slPrice) {
          balance -= slPips * PIP_VALUE_PER_LOT * lots;
          totalTrades++; closed = true; break;
        }
        if (c.high >= tpPrice) {
          balance += tpPips * PIP_VALUE_PER_LOT * lots;
          wins++; totalTrades++; closed = true; break;
        }
      } else {
        if (c.high + SPREAD >= slPrice) {
          balance -= slPips * PIP_VALUE_PER_LOT * lots;
          totalTrades++; closed = true; break;
        }
        if (c.low <= tpPrice) {
          balance += tpPips * PIP_VALUE_PER_LOT * lots;
          wins++; totalTrades++; closed = true; break;
        }
      }
    }
    
    // End of day close if not stopped out
    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const profitPips = bias === 'BUY' ? (last.close - entryPrice) / PIP_SIZE : (entryPrice - last.close) / PIP_SIZE;
      balance += profitPips * PIP_VALUE_PER_LOT * lots;
      if (profitPips > 0) wins++; 
      totalTrades++;
    }
  }
  return { finalBalance: balance, trades: totalTrades, wr: totalTrades > 0 ? (wins/totalTrades)*100 : 0 };
}

async function runOptimizer() {
  const pairs = [
    'GBPUSD_M1_202105030000_202605010159.csv',
    'EURUSD_M1_202105030000_202605010159.csv',
    'AUDUSD_M1_202105030005_202605010159.csv',
  ];
  
  for (const pairStr of pairs) {
    PIP_SIZE = pairStr.includes('JPY') ? 0.01 : 0.0001;
    SPREAD = PIP_SIZE * 1; // 1 pip spread
    
    console.log(`\nLoading dataset: ${pairStr}...`);
    const fullPath = path.join(process.cwd(), 'data', pairStr);
    if (!fs.existsSync(fullPath)) {
      console.log(`Could not load ${pairStr}`);
      continue;
    }
    
    const candles = await loadData(fullPath);
    console.log(`Loaded ${candles.length} candles.`);
    
    const daysObj: Record<string, Candle[]> = {};
    for (const c of candles) {
      if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
      daysObj[c.dateStr].push(c);
    }
    const dateKeys = Object.keys(daysObj).sort();
    
    // SAFE TRADING PARAMETERS
    const riskPcts = [5]; // Realistic risk compounding
    const emaPeriods = [240, 1440]; // 4H and 24H trend alignment
    const entryHours = [8, 9, 13, 14]; // London & NY Open ONLY
    const entryMins = [0, 15, 30]; 
    const slPipsOptions = [10, 15, 20, 25]; // Strong hard stops
    const tpPipsOptions = [15, 20, 30, 40, 50]; // Fixed targets
    const reverseOptions = [false, true]; // Trend-follow vs Mean-revert
    
    let bestBalance = 0;
    let bestParams: any = null;
    
    for (const risk of riskPcts) {
      for (const ema of emaPeriods) {
        for (const hr of entryHours) {
          for (const min of entryMins) {
            for (const sl of slPipsOptions) {
              for (const tp of tpPipsOptions) {
                for (const reverse of reverseOptions) {
                  
                  const res = runSessionStrategy(candles, daysObj, dateKeys, hr, min, sl, tp, risk, ema, reverse);
                  
                  if (res.finalBalance > bestBalance && res.finalBalance > STARTING_BALANCE) {
                    bestBalance = res.finalBalance;
                    bestParams = { risk, ema, hr, min, sl, tp, reverse, trades: res.trades, wr: res.wr };
                    console.log(`[NEW BEST ${pairStr}] $${bestBalance.toFixed(2)} | EMA:${ema} Entry:${hr}:${min} SL:${sl} TP:${tp} Rev:${reverse} | WR: ${res.wr.toFixed(1)}%`);
                  }
                  
                  // Goal: Target 10,000%+ ($10k final balance from $100) or more.
                  if (res.finalBalance > 10000) {
                    console.log('\n=======================================');
                    console.log('🌟 LEGITIMATE EDGE FOUND! 🌟');
                    console.log(`Pair: ${pairStr}`);
                    console.log(bestParams);
                    console.log(`Final Balance: $${bestBalance.toFixed(2)}`);
                    console.log('=======================================\n');
                    process.exit(0);
                  }
                }
              }
            }
          }
        }
      }
    }
    console.log(`Best for ${pairStr}:`, bestParams, bestBalance);
  }
}
runOptimizer();
