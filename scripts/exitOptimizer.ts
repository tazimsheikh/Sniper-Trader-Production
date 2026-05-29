import fs from 'fs';
import readline from 'readline';
import path from 'path';

const START_DATE = new Date('2021-05-01T00:00:00Z').getTime();
const END_DATE = new Date('2026-05-01T23:59:59Z').getTime();
const RISK_PCT = 5;

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }

interface Trade {
  id: string; direction: 'BUY' | 'SELL'; entryTime: number; entryPrice: number;
  slPrice: number; tpPrice: number; lots: number; lotsRemaining: number;
  status: 'OPEN' | 'CLOSED_WON' | 'CLOSED_LOST' | 'CLOSED_TIME';
  highestProfitPips: number;
  pyramidAdded: boolean;
  totalProfit: number;
}

interface OptimizerConfig {
  name: string;
  exitStrategy: 'INFINITE' | 'EOD' | 'WINDOW' | '3_HOUR';
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
    
    const dPart = parts[0].replace(/\./g, '-');
    const timestamp = new Date(`${dPart}T${parts[1]}Z`).getTime();
    if (timestamp < START_DATE) continue;
    if (timestamp > END_DATE) break;

    globalM1Candles.push({
      time: timestamp, dateStr: new Date(timestamp).toISOString(),
      open: parseFloat(parts[2]), high: parseFloat(parts[3]), low: parseFloat(parts[4]), close: parseFloat(parts[5])
    });
  }
  return globalM1Candles;
}

function runSimulation(globalM1Candles: Candle[], config: OptimizerConfig, isGold: boolean, isJpy: boolean) {
  const PIP_SIZE = isJpy ? 0.01 : (isGold ? 0.1 : 0.0001);
  const PIP_VALUE = 10;
  const SPREAD_PIPS = isJpy ? 1.5 : (isGold ? 2.5 : 1.0); 

  let BALANCE = 100.0;
  let maxDD = 0;
  let peakBalance = BALANCE;
  let openTrades: Trade[] = [];
  let closedTrades: Trade[] = [];

  let m15Candles: Candle[] = [];
  let currentDayStr = '', currentM15Str = '';
  let m15Open = 0, m15High = -Infinity, m15Low = Infinity;
  
  let asianHigh = -Infinity, asianLow = Infinity;
  let hasTradedToday = false;

  for (let cIdx = 0; cIdx < globalM1Candles.length; cIdx++) {
    const c = globalM1Candles[cIdx];
    const dt = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const nyHour = dt.getUTCHours() - 4; 
    const normalizedNyHour = nyHour < 0 ? nyHour + 24 : nyHour;
    const nyMinute = dt.getUTCMinutes();

    if (dPart !== currentDayStr) {
      currentDayStr = dPart;
      asianHigh = -Infinity; asianLow = Infinity;
      hasTradedToday = false;
    }
    
    if (normalizedNyHour >= 20 || normalizedNyHour < 2) {
      asianHigh = Math.max(asianHigh, c.high);
      asianLow = Math.min(asianLow, c.low);
    }
    
    const m15Min = Math.floor(nyMinute / 15) * 15;
    const m15Str = `${dPart} ${dt.getUTCHours()}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '' && cIdx > 1) {
        m15Candles.push({ time: globalM1Candles[cIdx-1].time, dateStr: currentM15Str, open: m15Open, high: m15High, low: m15Low, close: globalM1Candles[cIdx-1].close });
      }
      currentM15Str = m15Str;
      m15Open = c.open; m15High = c.high; m15Low = c.low;
    } else {
      m15High = Math.max(m15High, c.high); m15Low = Math.min(m15Low, c.low);
    }

    // Trade Management Loop
    for (const trade of openTrades) {
      if (trade.status !== 'OPEN') continue;
      
      const spreadVal = SPREAD_PIPS * PIP_SIZE;
      const slippageVal = 0.5 * PIP_SIZE;
      
      const currentPips = trade.direction === 'BUY' ? (c.high - trade.entryPrice) / PIP_SIZE : (trade.entryPrice - c.low) / PIP_SIZE;
      trade.highestProfitPips = Math.max(trade.highestProfitPips, currentPips);

      // Pyramiding Logic (Add second position at 1R profit)
      if (!trade.pyramidAdded && trade.highestProfitPips >= Math.abs(trade.entryPrice - trade.slPrice)/PIP_SIZE) {
         trade.pyramidAdded = true;
         trade.slPrice = trade.entryPrice; // Move SL to Breakeven
         trade.lotsRemaining *= 2; // Double the position
      }

      let timeBailout = false;
      if (config.exitStrategy === 'EOD' && normalizedNyHour === 17 && nyMinute === 0) {
         timeBailout = true;
      } else if (config.exitStrategy === 'WINDOW') {
         // NY Morning Window Bailout at 11:30 AM
         if (normalizedNyHour === 11 && nyMinute === 30) timeBailout = true;
         // NY Afternoon Window Bailout at 15:30 (3:30 PM)
         if (normalizedNyHour === 15 && nyMinute === 30) timeBailout = true;
      } else if (config.exitStrategy === '3_HOUR') {
         const hoursElapsed = (c.time - trade.entryTime) / (1000 * 60 * 60);
         if (hoursElapsed >= 3.0) timeBailout = true;
      }

      if (timeBailout) {
         const closePrice = trade.direction === 'BUY' ? c.close - spreadVal : c.close + spreadVal;
         const pips = trade.direction === 'BUY' ? (closePrice - trade.entryPrice) / PIP_SIZE : (trade.entryPrice - closePrice) / PIP_SIZE;
         trade.totalProfit += (pips * PIP_VALUE * trade.lotsRemaining);
         trade.status = 'CLOSED_TIME';
         BALANCE += (pips * PIP_VALUE * trade.lotsRemaining); 
         peakBalance = Math.max(peakBalance, BALANCE); maxDD = Math.max(maxDD, ((peakBalance-BALANCE)/peakBalance)*100); 
         closedTrades.push(trade);
         continue;
      }

      // Stop Loss / Take Profit Execution
      if (trade.direction === 'BUY') {
        if (c.low <= trade.slPrice) {
          const lossPips = (trade.slPrice - slippageVal - trade.entryPrice) / PIP_SIZE;
          trade.totalProfit += (lossPips * PIP_VALUE * trade.lotsRemaining);
          trade.status = trade.totalProfit >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
          BALANCE += (lossPips * PIP_VALUE * trade.lotsRemaining); 
          peakBalance = Math.max(peakBalance, BALANCE); maxDD = Math.max(maxDD, ((peakBalance-BALANCE)/peakBalance)*100); 
          closedTrades.push(trade);
        } else if (c.high >= trade.tpPrice) {
          const winPips = (trade.tpPrice - trade.entryPrice) / PIP_SIZE;
          trade.totalProfit += (winPips * PIP_VALUE * trade.lotsRemaining);
          trade.status = 'CLOSED_WON';
          BALANCE += (winPips * PIP_VALUE * trade.lotsRemaining); 
          peakBalance = Math.max(peakBalance, BALANCE); closedTrades.push(trade);
        }
      } else {
        if (c.high + spreadVal >= trade.slPrice) {
          const lossPips = (trade.entryPrice - (trade.slPrice + slippageVal)) / PIP_SIZE;
          trade.totalProfit += (lossPips * PIP_VALUE * trade.lotsRemaining);
          trade.status = trade.totalProfit >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
          BALANCE += (lossPips * PIP_VALUE * trade.lotsRemaining); 
          peakBalance = Math.max(peakBalance, BALANCE); maxDD = Math.max(maxDD, ((peakBalance-BALANCE)/peakBalance)*100); 
          closedTrades.push(trade);
        } else if (c.low <= trade.tpPrice) {
          const winPips = (trade.entryPrice - trade.tpPrice) / PIP_SIZE;
          trade.totalProfit += (winPips * PIP_VALUE * trade.lotsRemaining);
          trade.status = 'CLOSED_WON';
          BALANCE += (winPips * PIP_VALUE * trade.lotsRemaining); 
          peakBalance = Math.max(peakBalance, BALANCE); closedTrades.push(trade);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN');

    if (openTrades.length > 0) continue;
    if (hasTradedToday) continue;

    // Trap Signal Trigger Detection
    if (nyMinute % 15 === 14 && m15Candles.length >= 2) {
       const isMorning = normalizedNyHour >= 7 && normalizedNyHour < 11;
       const isAfternoon = normalizedNyHour >= 13 && normalizedNyHour < 15;
       if (!isMorning && !isAfternoon) continue;
       if (asianHigh === -Infinity) continue;

       const asianRangePips = (asianHigh - asianLow) / PIP_SIZE;
       if (asianRangePips > 30) continue; // Skip high momentum days

       const triggerCandle = m15Candles[m15Candles.length - 1];
       const bodySize = Math.abs(triggerCandle.close - triggerCandle.open);
       const candleRange = triggerCandle.high - triggerCandle.low;
       if (candleRange === 0) continue;
       
       const pipsAboveAsian = (triggerCandle.high - asianHigh) / PIP_SIZE;
       const pipsBelowAsian = (asianLow - triggerCandle.low) / PIP_SIZE;

       let direction: 'BUY'|'SELL' | null = null;
       
       if (pipsAboveAsian >= 10) {
          if (triggerCandle.close < triggerCandle.open) { 
             if (bodySize / candleRange > 0.4) direction = 'SELL';
          }
       } 
       else if (pipsBelowAsian >= 10) {
          if (triggerCandle.close > triggerCandle.open) { 
             if (bodySize / candleRange > 0.4) direction = 'BUY';
          }
       }

       if (direction) {
          let slPrice = direction === 'BUY' ? triggerCandle.low - (2 * PIP_SIZE) : triggerCandle.high + (2 * PIP_SIZE);
          let entryPrice = c.close + (direction === 'BUY' ? SPREAD_PIPS*PIP_SIZE : 0);
          
          let slPips = Math.abs(entryPrice - slPrice) / PIP_SIZE;
          if (slPips > 35 || slPips < 5) continue; 
          
          const tpPips = slPips * 3.0; // 1:3 Base RR
          const tpPrice = direction === 'BUY' ? entryPrice + (tpPips * PIP_SIZE) : entryPrice - (tpPips * PIP_SIZE);
          
          const lots = ((BALANCE * (RISK_PCT/100)) / slPips) / PIP_VALUE;
          
          openTrades.push({
            id: `TRAP_${c.time}`, direction, entryTime: c.time, entryPrice, slPrice, tpPrice, 
            lots, lotsRemaining: lots, status: 'OPEN', highestProfitPips: 0, 
            pyramidAdded: false, totalProfit: 0
          });
          hasTradedToday = true;
       }
    }
  }

  const wins = closedTrades.filter(t => t.totalProfit > 0).length;
  const losses = closedTrades.filter(t => t.totalProfit <= 0).length;
  const timeClose = closedTrades.filter(t => t.status === 'CLOSED_TIME').length;
  const winRate = wins / (wins + losses || 1);
  const totalReturn = ((BALANCE - 100) / 100) * 100;
  
  return { trades: wins+losses, wr: winRate*100, ret: totalReturn, dd: maxDD, timeClose };
}

async function runAll() {
  const dataDir = path.join(process.cwd(), 'data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv') && f.includes('_M1_'));
  
  const configs: OptimizerConfig[] = [
    { name: 'INFINITE (No Time Limit)', exitStrategy: 'INFINITE' },
    { name: 'EOD (5:00 PM NY Bailout)', exitStrategy: 'EOD' },
    { name: 'WINDOW (11:30 AM NY Bailout)', exitStrategy: 'WINDOW' },
    { name: '3_HOUR (Strict 3 Hour Limit)', exitStrategy: '3_HOUR' }
  ];

  console.log(`Starting Exit Strategy Optimizer...`);

  for (const config of configs) {
    let totalTrades = 0;
    let avgWinRate = 0;
    let portfolioReturn = 0;
    let pairsProcessed = 0;

    console.log(`\n========================================`);
    console.log(`TESTING EXIT STRATEGY: ${config.name}`);
    console.log(`========================================`);

    for (const file of files) {
      const sym = file.split('_')[0];
      const isGold = sym === 'XAUUSD' || sym === 'GC=F';
      const isJpy = sym.includes('JPY');
      
      const data = await loadData(path.join(dataDir, file));
      if (data.length === 0) continue;

      const res = runSimulation(data, config, isGold, isJpy);
      
      console.log(`[${sym}] Trades: ${res.trades} | Time Exits: ${res.timeClose} | WR: ${res.wr.toFixed(1)}% | Return: +${res.ret.toFixed(1)}%`);
      
      totalTrades += res.trades;
      avgWinRate += res.wr;
      portfolioReturn += res.ret;
      pairsProcessed++;
      
      data.length = 0; // Free memory
    }
    
    console.log(`\n>>> PORTFOLIO TOTAL [${config.name}] <<<`);
    console.log(`Total Trades: ${totalTrades} | Avg WR: ${(avgWinRate/pairsProcessed).toFixed(1)}% | Cumulative Portfolio Growth: +${portfolioReturn.toFixed(1)}%`);
  }
}

runAll();
