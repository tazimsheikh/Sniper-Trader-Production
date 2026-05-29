import fs from 'fs';
import readline from 'readline';
import path from 'path';

const START_DATE = new Date('2021-05-01T00:00:00Z').getTime();
const END_DATE = new Date('2026-05-01T23:59:59Z').getTime();

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }
interface Trade {
  id: string; direction: 'BUY' | 'SELL'; entryTime: number; entryPrice: number;
  slPrice: number; tpPrice: number; lots: number; lotsRemaining: number;
  status: 'OPEN' | 'CLOSED_WON' | 'CLOSED_LOST' | 'CLOSED_TIME';
  highestProfitPips: number;
  pyramidAdded: boolean;
  totalProfit: number;
}

async function loadData(filePath: string): Promise<Candle[]> {
  const globalM1Candles: Candle[] = [];
  if (!fs.existsSync(filePath)) return [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let isFirstLine = true;
  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; }
    const parts = line.split('\t');
    if (parts.length < 6) continue;
    const timestamp = new Date(`${parts[0].replace(/\./g, '-')}T${parts[1]}Z`).getTime();
    if (timestamp < START_DATE || timestamp > END_DATE) continue;
    globalM1Candles.push({
      time: timestamp, dateStr: new Date(timestamp).toISOString(),
      open: parseFloat(parts[2]), high: parseFloat(parts[3]), low: parseFloat(parts[4]), close: parseFloat(parts[5])
    });
  }
  return globalM1Candles;
}

function runM1Simulation(globalM1Candles: Candle[], isGold: boolean, isJpy: boolean, pullbackTarget: number) {
  const PIP_SIZE = isJpy ? 0.01 : (isGold ? 0.1 : 0.0001);
  const PIP_VALUE = 10;
  const SPREAD_PIPS = isJpy ? 1.5 : (isGold ? 2.5 : 1.0); 

  let BALANCE = 100.0;
  let openTrades: Trade[] = [];
  let closedTrades: Trade[] = [];

  let asianHigh = -Infinity, asianLow = Infinity;
  let currentDayStr = '';
  let hasTradedToday = false;

  let trapState = 0; 
  let h1 = -Infinity, l1 = Infinity;
  let h2 = -Infinity, l2 = Infinity;
  let trapDirection: 'BUY'|'SELL'|null = null;

  for (let cIdx = 0; cIdx < globalM1Candles.length; cIdx++) {
    const c = globalM1Candles[cIdx];
    const dt = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const nyHour = dt.getUTCHours() - 4; 
    const normalizedNyHour = nyHour < 0 ? nyHour + 24 : nyHour;

    if (dPart !== currentDayStr) {
      currentDayStr = dPart;
      asianHigh = -Infinity; asianLow = Infinity;
      hasTradedToday = false;
      trapState = 0;
      trapDirection = null;
    }
    
    if (normalizedNyHour >= 20 || normalizedNyHour < 2) {
      asianHigh = Math.max(asianHigh, c.high);
      asianLow = Math.min(asianLow, c.low);
    }

    for (const trade of openTrades) {
      if (trade.status !== 'OPEN') continue;
      
      const spreadVal = SPREAD_PIPS * PIP_SIZE;
      const slippageVal = 0.5 * PIP_SIZE;
      const currentPips = trade.direction === 'BUY' ? (c.high - trade.entryPrice) / PIP_SIZE : (trade.entryPrice - c.low) / PIP_SIZE;
      trade.highestProfitPips = Math.max(trade.highestProfitPips, currentPips);

      const initialSlDistancePips = Math.abs(trade.entryPrice - trade.slPrice) / PIP_SIZE;
      if (!trade.pyramidAdded && currentPips >= initialSlDistancePips && initialSlDistancePips > 0) {
         trade.pyramidAdded = true;
         trade.slPrice = trade.direction === 'BUY' ? trade.entryPrice + (2*PIP_SIZE) : trade.entryPrice - (2*PIP_SIZE);
         trade.lotsRemaining *= 2; 
      }

      if ((c.time - trade.entryTime) / 3600000 >= 3.0) {
         const closePrice = trade.direction === 'BUY' ? c.close - spreadVal : c.close + spreadVal;
         const pips = trade.direction === 'BUY' ? (closePrice - trade.entryPrice) / PIP_SIZE : (trade.entryPrice - closePrice) / PIP_SIZE;
         trade.totalProfit += (pips * PIP_VALUE * trade.lotsRemaining);
         trade.status = 'CLOSED_TIME';
         BALANCE += (pips * PIP_VALUE * trade.lotsRemaining); 
         closedTrades.push(trade);
         continue;
      }

      if (trade.direction === 'BUY') {
        if (c.low <= trade.slPrice) {
          const lossPips = (trade.slPrice - slippageVal - trade.entryPrice) / PIP_SIZE;
          trade.totalProfit += (lossPips * PIP_VALUE * trade.lotsRemaining);
          trade.status = trade.totalProfit >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
          BALANCE += (lossPips * PIP_VALUE * trade.lotsRemaining); 
          closedTrades.push(trade);
        } else if (c.high >= trade.tpPrice) {
          const winPips = (trade.tpPrice - trade.entryPrice) / PIP_SIZE;
          trade.totalProfit += (winPips * PIP_VALUE * trade.lotsRemaining);
          trade.status = 'CLOSED_WON';
          BALANCE += (winPips * PIP_VALUE * trade.lotsRemaining); 
          closedTrades.push(trade);
        }
      } else {
        if (c.high + spreadVal >= trade.slPrice) {
          const lossPips = (trade.entryPrice - (trade.slPrice + slippageVal)) / PIP_SIZE;
          trade.totalProfit += (lossPips * PIP_VALUE * trade.lotsRemaining);
          trade.status = trade.totalProfit >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
          BALANCE += (lossPips * PIP_VALUE * trade.lotsRemaining); 
          closedTrades.push(trade);
        } else if (c.low <= trade.tpPrice) {
          const winPips = (trade.entryPrice - trade.tpPrice) / PIP_SIZE;
          trade.totalProfit += (winPips * PIP_VALUE * trade.lotsRemaining);
          trade.status = 'CLOSED_WON';
          BALANCE += (winPips * PIP_VALUE * trade.lotsRemaining); 
          closedTrades.push(trade);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN');

    if (openTrades.length > 0) continue;
    if (hasTradedToday) continue;

    const isMorning = normalizedNyHour >= 7 && normalizedNyHour < 11;
    const isAfternoon = normalizedNyHour >= 13 && normalizedNyHour < 15;
    if (!isMorning && !isAfternoon) { trapState = 0; continue; }
    if (asianHigh === -Infinity) continue;
    if ((asianHigh - asianLow) / PIP_SIZE > 30) continue;

    const pipsAboveAsian = (c.high - asianHigh) / PIP_SIZE;
    const pipsBelowAsian = (asianLow - c.low) / PIP_SIZE;

    if (trapState === 0) {
       if (pipsAboveAsian >= 10) { trapState = 1; trapDirection = 'SELL'; h1 = c.high; l1 = c.low; }
       else if (pipsBelowAsian >= 10) { trapState = 1; trapDirection = 'BUY'; l1 = c.low; h1 = c.high; }
       continue;
    }

    if (trapDirection === 'SELL') {
       if (trapState === 1) {
          if (c.high > h1) { h1 = c.high; l1 = c.low; } 
          else if ((h1 - c.low) / PIP_SIZE >= pullbackTarget) { trapState = 2; h2 = -Infinity; } 
       } else if (trapState === 2) {
          if (c.high > h1) { trapState = 1; h1 = c.high; l1 = c.low; } 
          else if (c.high > h2) { h2 = c.high; } 
          
          const bodySize = Math.abs(c.close - c.open);
          const range = c.high - c.low;
          if (h2 !== -Infinity && (h1 - h2) / PIP_SIZE <= Math.max(5.0, pullbackTarget*0.8) && c.close < c.open && bodySize/range > 0.6) {
             const slPrice = Math.max(h1, h2) + (2 * PIP_SIZE);
             const slPips = Math.abs(c.close - slPrice) / PIP_SIZE;
             if (slPips >= 3 && slPips <= 25) {
                const lots = ((BALANCE * 0.05) / slPips) / PIP_VALUE;
                openTrades.push({ id: `M1_${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice: c.close, slPrice, tpPrice: c.close - (slPips*3*PIP_SIZE), lots, lotsRemaining: lots, status: 'OPEN', highestProfitPips: 0, pyramidAdded: false, totalProfit: 0 });
                hasTradedToday = true; trapState = 0;
             }
          }
       }
    } else if (trapDirection === 'BUY') {
       if (trapState === 1) {
          if (c.low < l1) { l1 = c.low; h1 = c.high; } 
          else if ((c.high - l1) / PIP_SIZE >= pullbackTarget) { trapState = 2; l2 = Infinity; } 
       } else if (trapState === 2) {
          if (c.low < l1) { trapState = 1; l1 = c.low; h1 = c.high; } 
          else if (c.low < l2) { l2 = c.low; } 
          
          const bodySize = Math.abs(c.close - c.open);
          const range = c.high - c.low;
          if (l2 !== Infinity && (l2 - l1) / PIP_SIZE <= Math.max(5.0, pullbackTarget*0.8) && c.close > c.open && bodySize/range > 0.6) {
             const slPrice = Math.min(l1, l2) - (2 * PIP_SIZE);
             const slPips = Math.abs(c.close - slPrice) / PIP_SIZE;
             if (slPips >= 3 && slPips <= 25) {
                const lots = ((BALANCE * 0.05) / slPips) / PIP_VALUE;
                openTrades.push({ id: `M1_${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice: c.close + SPREAD_PIPS*PIP_SIZE, slPrice, tpPrice: c.close + (slPips*3*PIP_SIZE), lots, lotsRemaining: lots, status: 'OPEN', highestProfitPips: 0, pyramidAdded: false, totalProfit: 0 });
                hasTradedToday = true; trapState = 0;
             }
          }
       }
    }
  }

  const wins = closedTrades.filter(t => t.totalProfit > 0).length;
  const losses = closedTrades.filter(t => t.totalProfit <= 0).length;
  const wr = wins / (wins + losses || 1);
  return { trades: wins+losses, wr: wr*100, ret: ((BALANCE - 100)/100)*100 };
}

async function runAll() {
  const dataDir = path.join(process.cwd(), 'data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv') && f.includes('_M1_'));
  
  const parametersToTest = [2.0, 4.0, 6.0, 8.0, 10.0, 15.0, 20.0];
  
  console.log(`\n========================================`);
  console.log(`BRUTE FORCE M1 PULLBACK OPTIMIZER (17 PAIRS)`);
  console.log(`========================================`);

  const optimalConfigs: Record<string, { pullback: number, ret: number, wr: number }> = {};

  for (const file of files) {
    const sym = file.split('_')[0];
    const isGold = sym === 'XAUUSD' || sym === 'GC=F';
    const isJpy = sym.includes('JPY');
    const data = await loadData(path.join(dataDir, file));
    if (data.length === 0) continue;
    
    let bestRet = -Infinity;
    let bestParams: any = null;

    console.log(`Scanning [${sym}]...`);
    for (const pullback of parametersToTest) {
      const res = runM1Simulation(data, isGold, isJpy, pullback);
      if (res.ret > bestRet) {
         bestRet = res.ret;
         bestParams = { pullback, ret: res.ret, wr: res.wr };
      }
    }
    
    optimalConfigs[sym] = bestParams;
    console.log(`==> [${sym}] BEST: Pullback=${bestParams.pullback} pips | Return: +${bestParams.ret.toFixed(1)}% | WR: ${bestParams.wr.toFixed(1)}%`);
    data.length = 0;
  }
  
  console.log(`\n>>> FINAL OPTIMAL CONFIGS (JSON) <<<`);
  console.log(JSON.stringify(optimalConfigs, null, 2));
}

runAll();
