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
let SPREAD = 0.0001;
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

function runCurveFit(
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  hr: number,
  bias: 'BUY'|'SELL',
  slPips: number,
  tpPips: number,
  riskPct: number
) {
  let balance = STARTING_BALANCE;
  let wins = 0;
  let trades = 0;
  
  for (let d = 1; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const todayCandles = daysObj[dateKeys[d]];
    
    const entryWindow = todayCandles.filter(c => parseInt(c.timeStr) === hr);
    if (entryWindow.length === 0) continue;
    const entryCandle = entryWindow[0]; 
    
    const entryPrice = bias === 'BUY' ? entryCandle.close + SPREAD : entryCandle.close;
    const slPrice = bias === 'BUY' ? entryPrice - slPips * PIP_SIZE : entryPrice + slPips * PIP_SIZE;
    const tpPrice = bias === 'BUY' ? entryPrice + tpPips * PIP_SIZE : entryPrice - tpPips * PIP_SIZE;
    
    const riskAmount = balance * (riskPct / 100);
    const lots = Math.max(0.01, Math.min(100, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
    
    const tradeCandles = todayCandles.filter(c => c.time > entryCandle.time);
    
    for (const c of tradeCandles) {
      if (bias === 'BUY') {
        if (c.low <= slPrice) {
          balance -= slPips * PIP_VALUE_PER_LOT * lots;
          trades++;
          break;
        }
        if (c.high >= tpPrice) {
          balance += tpPips * PIP_VALUE_PER_LOT * lots;
          wins++; trades++;
          break;
        }
      } else {
        if (c.high + SPREAD >= slPrice) {
          balance -= slPips * PIP_VALUE_PER_LOT * lots;
          trades++;
          break;
        }
        if (c.low <= tpPrice) {
          balance += tpPips * PIP_VALUE_PER_LOT * lots;
          wins++; trades++;
          break;
        }
      }
    }
  }
  return { balance, trades, wr: trades > 0 ? wins/trades*100 : 0 };
}

async function findGrail() {
  const pairStr = 'EURUSD_M1_202105030000_202605010159.csv';
  console.log(`Loading ${pairStr}...`);
  const fullPath = path.join(process.cwd(), 'data', pairStr);
  const candles = await loadData(fullPath);
  
  const daysObj: Record<string, Candle[]> = {};
  for (const c of candles) {
    if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
    daysObj[c.dateStr].push(c);
  }
  const dateKeys = Object.keys(daysObj).sort();
  
  const risk = 10;
  let bestBalance = 0;
  
  for (let hr = 0; hr < 24; hr++) {
    for (const bias of ['BUY', 'SELL'] as const) {
      for (const sl of [10, 15, 20, 25, 30, 40, 50]) {
        for (const tp of [10, 20, 30, 40, 50, 60, 80, 100]) {
          const res = runCurveFit(daysObj, dateKeys, hr, bias, sl, tp, risk);
          
          if (res.balance > bestBalance) {
            bestBalance = res.balance;
            console.log(`[NEW BEST] $${res.balance.toFixed(2)} | Hr:${hr} Bias:${bias} SL:${sl} TP:${tp} | Trades:${res.trades} WR:${res.wr.toFixed(1)}%`);
          }
          
          if (res.balance > 100000) {
            console.log('HOLY GRAIL FOUND!');
            process.exit(0);
          }
        }
      }
    }
  }
}
findGrail();
