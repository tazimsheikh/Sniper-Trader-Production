import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';

// ── Types ────────────────────────────────────────────────────────────────
interface Candle {
  dateStr: string;
  timeStr: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
interface Trade {
  status: 'WON' | 'LOST' | 'TRAILED' | 'TIMEOUT';
  profit: number;
}

const STARTING_BALANCE = 100;
const PIP_VALUE_PER_LOT = 10;
let PIP_SIZE = 0.0001;
let SPREAD = 0.0001;

// ── Data Loader ────────────────────────────────────────────────────────
async function loadData(filePath: string): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const results: Candle[] = [];
    fs.createReadStream(filePath)
      .pipe(csvParser({ separator: '\t', skipLines: 1, headers: ['dateStr', 'timeStr', 'open', 'high', 'low', 'close', 'tickvol', 'vol', 'spread'] }))
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

function closeTrade(direction: string, entryPrice: number, exitPrice: number, lots: number, balance: number, pipsCalc: number): { newBalance: number; trade: Trade } {
  let pips = direction === 'BUY' ? (exitPrice - entryPrice) / PIP_SIZE : (entryPrice - exitPrice) / PIP_SIZE;
  // Apply spread penalty to pips won/lost to simulate real conditions
  pips -= (SPREAD / PIP_SIZE); 
  const profit = pips * PIP_VALUE_PER_LOT * lots;
  return { newBalance: balance + profit, trade: { status: pips > 0 ? 'WON' : 'LOST', profit } };
}

// ── Compounding Grid Strategy ──────────────────────────────────────────
// ── OldIsGold Clone Strategy ──────────────────────────────────────────
function runOigStrategy(
  candles: Candle[],
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  entryHour: number,
  entryMin: number,
  slPips: number,
  trailTriggerPips: number,
  trailDistPips: number,
  riskPct: number
): { finalBalance: number, trades: number, wr: number } {
  
  let balance = STARTING_BALANCE;
  let wins = 0;
  let totalTrades = 0;
  
  for (let d = 1; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const todayCandles = daysObj[dateKeys[d]];
    const prevDayCandles = daysObj[dateKeys[d - 1]];
    if (!prevDayCandles || prevDayCandles.length < 60) continue;
    
    // Calculate Bias from previous day close vs open
    const pOpen = prevDayCandles[0].open;
    const pClose = prevDayCandles[prevDayCandles.length - 1].close;
    if (Math.abs(pClose - pOpen) / PIP_SIZE < 10) continue; 
    const bias = pClose > pOpen ? 'BUY' : 'SELL';
    
    // Find Entry Candle
    const entryWindow = todayCandles.filter(c => parseInt(c.timeStr) === entryHour);
    if (entryWindow.length === 0) continue;
    
    const entryCandle = entryWindow.find(c => parseInt(c.timeStr.split(':')[1]) === entryMin); 
    if (!entryCandle) continue;
    
    const entryPrice = bias === 'BUY' ? entryCandle.close + SPREAD : entryCandle.close;
    const slPrice = bias === 'BUY' ? entryPrice - slPips * PIP_SIZE : entryPrice + slPips * PIP_SIZE;
    
    // Extreme Risk Aggressive Compounding Formula
    const riskAmount = balance * (riskPct / 100);
    const lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
    
    const tradeCandles = todayCandles.filter(c => c.time > entryCandle.time && parseInt(c.timeStr) < 22);
    let highest = entryPrice, lowest = entryPrice, trailSL = slPrice;
    let closed = false;
    
    for (const c of tradeCandles) {
      highest = Math.max(highest, c.high); 
      lowest = Math.min(lowest, c.low);
      
      if (bias === 'BUY') {
        if (highest - entryPrice > trailTriggerPips * PIP_SIZE) {
          const newTrail = highest - trailDistPips * PIP_SIZE;
          if (newTrail > trailSL) trailSL = newTrail;
        }
        if (c.low <= trailSL) {
          const r = closeTrade('BUY', entryPrice, trailSL, lots, balance, 0);
          balance = r.newBalance; if (r.trade.profit > 0) wins++; totalTrades++; closed = true; break;
        }
      } else {
        if (entryPrice - lowest > trailTriggerPips * PIP_SIZE) {
          const newTrail = lowest + trailDistPips * PIP_SIZE;
          if (newTrail < trailSL) trailSL = newTrail;
        }
        if (c.high + SPREAD >= trailSL) {
          const r = closeTrade('SELL', entryPrice, trailSL, lots, balance, 0);
          balance = r.newBalance; if (r.trade.profit > 0) wins++; totalTrades++; closed = true; break;
        }
      }
    }
    
    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const r = closeTrade(bias, entryPrice, last.close, lots, balance, 0);
      balance = r.newBalance; if (r.trade.profit > 0) wins++; totalTrades++;
    }
  }
  return { finalBalance: balance, trades: totalTrades, wr: totalTrades > 0 ? (wins/totalTrades)*100 : 0 };
}

// ── Optimizer Loop ─────────────────────────────────────────────────────
async function runOptimizer() {
  const pairs = [
    'GBPUSD_M1_202105030000_202605010159.csv',
    'EURUSD_M1_202105030000_202605010159.csv',
    'USDJPY_M1_202105030000_202605010159.csv',
    'AUDUSD_M1_202105030005_202605010159.csv',
  ];
  
  for (const pairStr of pairs) {
    if (pairStr.includes('JPY')) { PIP_SIZE = 0.01; SPREAD = 0.01; }
    else { PIP_SIZE = 0.0001; SPREAD = 0.0001; }
    
    console.log(`\nLoading dataset: ${pairStr}...`);
    const fullPath = path.join(process.cwd(), 'data', pairStr);
    if (!fs.existsSync(fullPath)) {
      console.log(`Could not load ${pairStr}`);
      continue;
    }
    
    let candles: Candle[];
    try {
      candles = await loadData(fullPath);
    } catch (e) {
      console.log(`Could not load ${pairStr}`);
      continue;
    }
    
    const daysObj: Record<string, Candle[]> = {};
    for (const c of candles) {
      if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
      daysObj[c.dateStr].push(c);
    }
    const dateKeys = Object.keys(daysObj).sort();
    
    console.log(`Loaded ${candles.length} candles.`);
    
    const riskPcts = [10]; // Extreme compounding
    const entryHours = [0, 1, 2, 3, 4, 7, 8, 9, 13, 14, 15]; 
    const entryMins = [0, 5, 15, 30]; 
    const slPipsOptions = [10, 15, 20, 30];
    const trailTriggers = [10, 20, 30];
    const trailDists = [10, 15, 20];
    
    let bestBalance = 100.01;
    let bestParams: any = null;
    
    for (const risk of riskPcts) {
      for (const hr of entryHours) {
        for (const min of entryMins) {
          for (const sl of slPipsOptions) {
            for (const trig of trailTriggers) {
              for (const dist of trailDists) {
                if (dist >= trig) continue; // Dist must be tighter than trigger
                
                const res = runOigStrategy(candles, daysObj, dateKeys, hr, min, sl, trig, dist, risk);
                
                if (res.finalBalance > bestBalance) {
                  bestBalance = res.finalBalance;
                  bestParams = { risk, hr, min, sl, trig, dist, trades: res.trades, wr: res.wr };
                  console.log(`[NEW BEST ${pairStr}] $${bestBalance.toFixed(2)} | Entry:${hr}:${min} SL:${sl} Trail:${trig}/${dist} Risk:${risk}% | WR: ${res.wr.toFixed(1)}%`);
                }
                
                if (bestBalance > 100000) { // 100k return = 100,000%
                  console.log('\n=======================================');
                  console.log('HOLY GRAIL FOUND!');
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
    console.log(`Best for ${pairStr}:`, bestParams, bestBalance);
  }
}
runOptimizer();
