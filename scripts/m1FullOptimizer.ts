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
  highestProfitPips: number; pyramidAdded: boolean; totalProfit: number;
}

// Optimal pullback per pair from previous brute force
const OPTIMAL_PULLBACKS: Record<string, number> = {
  'AUDJPY': 15, 'AUDUSD': 20, 'CHFJPY': 10, 'EURAUD': 15, 'EURCAD': 15,
  'EURCHF': 4, 'EURJPY': 4, 'EURUSD': 10, 'GBPAUD': 8, 'GBPCAD': 15,
  'GBPCHF': 10, 'GBPJPY': 15, 'GBPUSD': 8, 'NAS100': 2, 'NZDUSD': 4,
  'USDCAD': 8, 'USDCHF': 6, 'USDJPY': 6, 'XAUUSD': 15
};

async function loadData(filePath: string): Promise<Candle[]> {
  const candles: Candle[] = [];
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
    candles.push({ time: timestamp, dateStr: new Date(timestamp).toISOString(), open: parseFloat(parts[2]), high: parseFloat(parts[3]), low: parseFloat(parts[4]), close: parseFloat(parts[5]) });
  }
  return candles;
}

function runSim(candles: Candle[], isGold: boolean, isJpy: boolean, pullbackTarget: number, slBufferPips: number) {
  const PIP_SIZE = isJpy ? 0.01 : (isGold ? 0.1 : 0.0001);
  const PIP_VALUE = 10;
  const SPREAD_PIPS = isJpy ? 1.5 : (isGold ? 2.5 : 1.0);

  let BALANCE = 100.0;
  let openTrades: Trade[] = [];
  let closedTrades: Trade[] = [];
  let asianHigh = -Infinity, asianLow = Infinity;
  let currentDayStr = '', hasTradedToday = false;
  let trapState = 0, h1 = -Infinity, l1 = Infinity, h2 = -Infinity, l2 = Infinity;
  let trapDirection: 'BUY' | 'SELL' | null = null;

  for (let cIdx = 0; cIdx < candles.length; cIdx++) {
    const c = candles[cIdx];
    const dt = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const nyHour = dt.getUTCHours() - 4;
    const nyH = nyHour < 0 ? nyHour + 24 : nyHour;

    if (dPart !== currentDayStr) { currentDayStr = dPart; asianHigh = -Infinity; asianLow = Infinity; hasTradedToday = false; trapState = 0; trapDirection = null; }
    if (nyH >= 20 || nyH < 2) { asianHigh = Math.max(asianHigh, c.high); asianLow = Math.min(asianLow, c.low); }

    for (const trade of openTrades) {
      if (trade.status !== 'OPEN') continue;
      const sv = SPREAD_PIPS * PIP_SIZE, slv = 0.5 * PIP_SIZE;
      const cp = trade.direction === 'BUY' ? (c.high - trade.entryPrice) / PIP_SIZE : (trade.entryPrice - c.low) / PIP_SIZE;
      trade.highestProfitPips = Math.max(trade.highestProfitPips, cp);
      const iSD = Math.abs(trade.entryPrice - trade.slPrice) / PIP_SIZE;
      if (!trade.pyramidAdded && cp >= iSD && iSD > 0) {
        trade.pyramidAdded = true;
        trade.slPrice = trade.direction === 'BUY' ? trade.entryPrice + (2 * PIP_SIZE) : trade.entryPrice - (2 * PIP_SIZE);
        trade.lotsRemaining *= 2;
      }
      if ((c.time - trade.entryTime) / 3600000 >= 3.0) {
        const cp2 = trade.direction === 'BUY' ? c.close - sv : c.close + sv;
        const pp = trade.direction === 'BUY' ? (cp2 - trade.entryPrice) / PIP_SIZE : (trade.entryPrice - cp2) / PIP_SIZE;
        trade.totalProfit += pp * PIP_VALUE * trade.lotsRemaining; trade.status = 'CLOSED_TIME';
        BALANCE += pp * PIP_VALUE * trade.lotsRemaining; closedTrades.push(trade); continue;
      }
      if (trade.direction === 'BUY') {
        if (c.low <= trade.slPrice) { const lp = (trade.slPrice - slv - trade.entryPrice) / PIP_SIZE; trade.totalProfit += lp * PIP_VALUE * trade.lotsRemaining; trade.status = trade.totalProfit >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST'; BALANCE += lp * PIP_VALUE * trade.lotsRemaining; closedTrades.push(trade); }
        else if (c.high >= trade.tpPrice) { const wp = (trade.tpPrice - trade.entryPrice) / PIP_SIZE; trade.totalProfit += wp * PIP_VALUE * trade.lotsRemaining; trade.status = 'CLOSED_WON'; BALANCE += wp * PIP_VALUE * trade.lotsRemaining; closedTrades.push(trade); }
      } else {
        if (c.high + sv >= trade.slPrice) { const lp = (trade.entryPrice - (trade.slPrice + slv)) / PIP_SIZE; trade.totalProfit += lp * PIP_VALUE * trade.lotsRemaining; trade.status = trade.totalProfit >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST'; BALANCE += lp * PIP_VALUE * trade.lotsRemaining; closedTrades.push(trade); }
        else if (c.low <= trade.tpPrice) { const wp = (trade.entryPrice - trade.tpPrice) / PIP_SIZE; trade.totalProfit += wp * PIP_VALUE * trade.lotsRemaining; trade.status = 'CLOSED_WON'; BALANCE += wp * PIP_VALUE * trade.lotsRemaining; closedTrades.push(trade); }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN');
    if (openTrades.length > 0 || hasTradedToday) continue;

    const isMorning = nyH >= 7 && nyH < 11, isAfternoon = nyH >= 13 && nyH < 15;
    if (!isMorning && !isAfternoon) { trapState = 0; continue; }
    if (asianHigh === -Infinity || (asianHigh - asianLow) / PIP_SIZE > 30) continue;

    const pAbove = (c.high - asianHigh) / PIP_SIZE, pBelow = (asianLow - c.low) / PIP_SIZE;

    if (trapState === 0) {
      if (pAbove >= 10) { trapState = 1; trapDirection = 'SELL'; h1 = c.high; l1 = c.low; }
      else if (pBelow >= 10) { trapState = 1; trapDirection = 'BUY'; l1 = c.low; h1 = c.high; }
      continue;
    }

    if (trapDirection === 'SELL') {
      if (trapState === 1) { if (c.high > h1) { h1 = c.high; } else if ((h1 - c.low) / PIP_SIZE >= pullbackTarget) { trapState = 2; h2 = -Infinity; } }
      else if (trapState === 2) {
        if (c.high > h1) { trapState = 1; h1 = c.high; } else if (c.high > h2) { h2 = c.high; }
        const bs = Math.abs(c.close - c.open), rng = c.high - c.low;
        if (h2 !== -Infinity && (h1 - h2) / PIP_SIZE <= Math.max(5.0, pullbackTarget * 0.8) && c.close < c.open && rng > 0 && bs / rng > 0.6) {
          const slPrice = Math.max(h1, h2) + (slBufferPips * PIP_SIZE);
          const slPips = Math.abs(c.close - slPrice) / PIP_SIZE;
          if (slPips >= 3 && slPips <= 40) {
            const lots = ((BALANCE * 0.05) / slPips) / PIP_VALUE;
            openTrades.push({ id: `M1_${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice: c.close, slPrice, tpPrice: c.close - slPips * 3 * PIP_SIZE, lots, lotsRemaining: lots, status: 'OPEN', highestProfitPips: 0, pyramidAdded: false, totalProfit: 0 });
            hasTradedToday = true; trapState = 0;
          }
        }
      }
    } else if (trapDirection === 'BUY') {
      if (trapState === 1) { if (c.low < l1) { l1 = c.low; } else if ((c.high - l1) / PIP_SIZE >= pullbackTarget) { trapState = 2; l2 = Infinity; } }
      else if (trapState === 2) {
        if (c.low < l1) { trapState = 1; l1 = c.low; } else if (c.low < l2) { l2 = c.low; }
        const bs = Math.abs(c.close - c.open), rng = c.high - c.low;
        if (l2 !== Infinity && (l2 - l1) / PIP_SIZE <= Math.max(5.0, pullbackTarget * 0.8) && c.close > c.open && rng > 0 && bs / rng > 0.6) {
          const slPrice = Math.min(l1, l2) - (slBufferPips * PIP_SIZE);
          const slPips = Math.abs(c.close - slPrice) / PIP_SIZE;
          if (slPips >= 3 && slPips <= 40) {
            const lots = ((BALANCE * 0.05) / slPips) / PIP_VALUE;
            openTrades.push({ id: `M1_${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice: c.close + SPREAD_PIPS * PIP_SIZE, slPrice, tpPrice: c.close + slPips * 3 * PIP_SIZE, lots, lotsRemaining: lots, status: 'OPEN', highestProfitPips: 0, pyramidAdded: false, totalProfit: 0 });
            hasTradedToday = true; trapState = 0;
          }
        }
      }
    }
  }

  const wins = closedTrades.filter(t => t.totalProfit > 0).length;
  const total = wins + closedTrades.filter(t => t.totalProfit <= 0).length;
  return { trades: total, wr: total > 0 ? (wins / total) * 100 : 0, ret: ((BALANCE - 100) / 100) * 100 };
}

async function runAll() {
  const dataDir = path.join(process.cwd(), 'data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv') && f.includes('_M1_'));
  const slBuffers = [2, 3, 5, 8, 10, 15];

  const finalMatrix: Record<string, { pullback: number; slBuffer: number; ret: number; wr: number }> = {};

  console.log(`\n=======================================================`);
  console.log(`FULL 17-PAIR SL BUFFER BRUTE FORCE (Optimizing Win Rate)`);
  console.log(`=======================================================`);

  let totalPortfolioReturn = 0;
  let pairsProcessed = 0;

  for (const file of files) {
    const sym = file.split('_')[0];
    const isGold = sym === 'XAUUSD';
    const isJpy = sym.includes('JPY');
    const pullback = OPTIMAL_PULLBACKS[sym] || 8;
    const data = await loadData(path.join(dataDir, file));
    if (data.length === 0) continue;

    let bestScore = -Infinity;
    let bestParams: any = null;

    // Score = we want the best BALANCE of winRate and return
    // Use: score = WinRate * 0.4 + log10(Return+1) * 0.6 (weighted)
    for (const buf of slBuffers) {
      const res = runSim(data, isGold, isJpy, pullback, buf);
      const score = res.ret <= 0 ? -999 : (res.wr * 0.4) + (Math.log10(res.ret + 1) * 20);
      if (score > bestScore) { bestScore = score; bestParams = { pullback, slBuffer: buf, ...res }; }
    }

    finalMatrix[sym] = bestParams;
    totalPortfolioReturn += bestParams.ret;
    pairsProcessed++;
    console.log(`[${sym}] Pullback: ${bestParams.pullback} | SL Buffer: ${bestParams.slBuffer} pips | WR: ${bestParams.wr.toFixed(1)}% | Return: +${bestParams.ret.toFixed(1)}%`);
    data.length = 0;
  }

  console.log(`\n>>> FINAL OPTIMIZED MATRIX (JSON) <<<`);
  console.log(JSON.stringify(finalMatrix, null, 2));

  console.log(`\n=======================================================`);
  console.log(`PORTFOLIO SUMMARY`);
  console.log(`=======================================================`);
  console.log(`Pairs Processed: ${pairsProcessed}`);
  console.log(`Total Portfolio Growth: +${totalPortfolioReturn.toFixed(1)}%`);
}

runAll();
