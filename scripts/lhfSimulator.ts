import fs from 'fs';
import readline from 'readline';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'GBPUSD_M1_202105030000_202605010159.csv');

const START_DATE = new Date('2021-05-01T00:00:00Z').getTime();
const END_DATE = new Date('2026-05-01T23:59:59Z').getTime();
const PIP_SIZE = 0.0001;
const PIP_VALUE = 10;
const RISK_PCT = 5;
const SPREAD_PIPS = 1.0; 
const SLIPPAGE_PIPS = 0.5;

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }
interface Trade {
  id: string; direction: 'BUY' | 'SELL'; entryTime: number; entryPrice: number;
  slPrice: number; tpPrice: number; lots: number;
  status: 'OPEN' | 'CLOSED_WON' | 'CLOSED_LOST' | 'TIME_BAILOUT';
  exitTime?: number; exitPrice?: number; profit?: number; pips?: number;
}

let globalM1Candles: Candle[] = [];

async function loadData() {
  console.log('Loading GBPUSD CSV data into memory...');
  const fileStream = fs.createReadStream(DATA_FILE);
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
}

interface OptimizerConfig {
  name: string;
  minSessionPips: number;
  minPullbackPips: number;
  engulfRatio: number;
  rrRatio: number;
  maxSlPips: number;
}

function runSimulation(config: OptimizerConfig) {
  let BALANCE = 100.0;
  let peakBalance = BALANCE;
  let maxDD = 0;
  let openTrades: Trade[] = [];
  let closedTrades: Trade[] = [];

  let m15Candles: Candle[] = [];
  let currentDayStr = '', currentM15Str = '';
  let m15Open = 0, m15High = -Infinity, m15Low = Infinity;
  
  let sessionHigh = -Infinity, sessionLow = Infinity;
  let m1Candles: Candle[] = [];
  let hasTradedToday = false;

  for (let cIdx = 0; cIdx < globalM1Candles.length; cIdx++) {
    const c = globalM1Candles[cIdx];
    m1Candles.push(c);
    
    const dt = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const nyHour = dt.getUTCHours() - 4; 
    const normalizedNyHour = nyHour < 0 ? nyHour + 24 : nyHour;
    const nyMinute = dt.getUTCMinutes();

    if (dPart !== currentDayStr) {
      currentDayStr = dPart;
      sessionHigh = -Infinity; sessionLow = Infinity;
      hasTradedToday = false;
    }
    
    // We track the session high/low starting from Asian Open (20:00 NY)
    if (normalizedNyHour >= 20 || normalizedNyHour < 16) {
      sessionHigh = Math.max(sessionHigh, c.high);
      sessionLow = Math.min(sessionLow, c.low);
    }
    
    const m15Min = Math.floor(nyMinute / 15) * 15;
    const m15Str = `${dPart} ${dt.getUTCHours()}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '' && m1Candles.length > 1) {
        m15Candles.push({ time: new Date(m1Candles[m1Candles.length-2].time).getTime(), dateStr: currentM15Str, open: m15Open, high: m15High, low: m15Low, close: m1Candles[m1Candles.length-2].close });
      }
      currentM15Str = m15Str;
      m15Open = c.open; m15High = c.high; m15Low = c.low;
    } else {
      m15High = Math.max(m15High, c.high); m15Low = Math.min(m15Low, c.low);
    }

    // Manage open trades
    for (const trade of openTrades) {
      if (trade.status !== 'OPEN') continue;
      
      const spreadVal = SPREAD_PIPS * PIP_SIZE;
      const slippageVal = SLIPPAGE_PIPS * PIP_SIZE;
      
      if (trade.direction === 'BUY') {
        if (c.low <= trade.slPrice) {
          trade.exitPrice = trade.slPrice - slippageVal; trade.exitTime = c.time;
          trade.pips = (trade.exitPrice - trade.entryPrice) / PIP_SIZE; trade.profit = trade.pips * PIP_VALUE * trade.lots;
          trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
          BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE); maxDD = Math.max(maxDD, ((peakBalance-BALANCE)/peakBalance)*100); closedTrades.push(trade);
        } else if (c.high >= trade.tpPrice) {
          trade.exitPrice = trade.tpPrice; trade.exitTime = c.time;
          trade.pips = (trade.exitPrice - trade.entryPrice) / PIP_SIZE; trade.profit = trade.pips * PIP_VALUE * trade.lots;
          trade.status = 'CLOSED_WON';
          BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE); closedTrades.push(trade);
        }
      } else {
        if (c.high + spreadVal >= trade.slPrice) {
          trade.exitPrice = trade.slPrice + slippageVal; trade.exitTime = c.time;
          trade.pips = (trade.entryPrice - trade.exitPrice) / PIP_SIZE; trade.profit = trade.pips * PIP_VALUE * trade.lots;
          trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
          BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE); maxDD = Math.max(maxDD, ((peakBalance-BALANCE)/peakBalance)*100); closedTrades.push(trade);
        } else if (c.low <= trade.tpPrice) {
          trade.exitPrice = trade.tpPrice; trade.exitTime = c.time;
          trade.pips = (trade.entryPrice - trade.exitPrice) / PIP_SIZE; trade.profit = trade.pips * PIP_VALUE * trade.lots;
          trade.status = 'CLOSED_WON';
          BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE); closedTrades.push(trade);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN');

    if (openTrades.length > 0) continue;
    if (hasTradedToday) continue;

    // Trigger detection on M15 close
    if (nyMinute % 15 === 14 && m15Candles.length >= 4) {
       const isLondon = normalizedNyHour >= 2 && normalizedNyHour < 5;
       const isNY = normalizedNyHour >= 7 && normalizedNyHour < 11;
       if (!isLondon && !isNY) continue;

       if (sessionHigh === -Infinity) continue;

       const sessionBoxPips = (sessionHigh - sessionLow) / PIP_SIZE;
       if (sessionBoxPips < config.minSessionPips) continue;

       const triggerCandle = m15Candles[m15Candles.length - 1];
       const p1 = m15Candles[m15Candles.length - 2];
       const p2 = m15Candles[m15Candles.length - 3];
       const p3 = m15Candles[m15Candles.length - 4];
       
       const bodySize = Math.abs(triggerCandle.close - triggerCandle.open);
       const candleRange = triggerCandle.high - triggerCandle.low;
       if (candleRange === 0) continue;

       // Define the pullback extremes
       const pullbackHigh = Math.max(p1.high, p2.high, p3.high);
       const pullbackLow = Math.min(p1.low, p2.low, p3.low);

       let direction: 'BUY'|'SELL' | null = null;
       
       // DOWN TREND LHF:
       // If market has dropped heavily, the sessionLow is the extreme.
       // The pullback high must be at least config.minPullbackPips ABOVE the sessionLow.
       if (triggerCandle.close < sessionLow + ((sessionHigh - sessionLow) * 0.5)) {
          const pullbackDepthPips = (pullbackHigh - sessionLow) / PIP_SIZE;
          if (pullbackDepthPips >= config.minPullbackPips) {
             // Bearish Engulfing
             if (triggerCandle.close < triggerCandle.open) {
                const engulfRatio = bodySize / candleRange;
                if (engulfRatio >= config.engulfRatio && triggerCandle.close < p1.low) {
                   direction = 'SELL';
                }
             }
          }
       } 
       // UP TREND LHF:
       // If market has rallied heavily, the sessionHigh is the extreme.
       // The pullback low must be at least config.minPullbackPips BELOW the sessionHigh.
       else if (triggerCandle.close > sessionHigh - ((sessionHigh - sessionLow) * 0.5)) {
          const pullbackDepthPips = (sessionHigh - pullbackLow) / PIP_SIZE;
          if (pullbackDepthPips >= config.minPullbackPips) {
             // Bullish Engulfing
             if (triggerCandle.close > triggerCandle.open) {
                const engulfRatio = bodySize / candleRange;
                if (engulfRatio >= config.engulfRatio && triggerCandle.close > p1.high) {
                   direction = 'BUY';
                }
             }
          }
       }

       if (direction) {
          let slPrice = direction === 'BUY' ? pullbackLow : pullbackHigh;
          let entryPrice = c.close + (direction === 'BUY' ? SPREAD_PIPS*PIP_SIZE : 0);
          
          const slPips = Math.abs(entryPrice - slPrice) / PIP_SIZE;
          if (slPips > config.maxSlPips || slPips < 5) continue; 
          
          const tpPips = slPips * config.rrRatio;
          const tpPrice = direction === 'BUY' ? entryPrice + (tpPips * PIP_SIZE) : entryPrice - (tpPips * PIP_SIZE);
          
          const lots = ((BALANCE * (RISK_PCT/100)) / slPips) / PIP_VALUE;
          
          openTrades.push({
            id: `LHF_${c.time}`, direction, entryTime: c.time, entryPrice, slPrice, tpPrice, lots, status: 'OPEN'
          });
          hasTradedToday = true;
       }
    }
  }

  const wins = closedTrades.filter(t => t.pips && t.pips > 0).length;
  const losses = closedTrades.filter(t => t.pips && t.pips <= 0).length;
  const winRate = wins / (wins + losses || 1);
  const totalReturn = ((BALANCE - 100) / 100) * 100;
  
  console.log(`[${config.name}] Trades: ${wins+losses} | WR: ${(winRate*100).toFixed(1)}% | Return: +${totalReturn.toFixed(1)}% | DD: -${maxDD.toFixed(1)}%`);
}

async function runAll() {
  await loadData();
  
  const configs: OptimizerConfig[] = [
    { name: 'LHF RR 1:1 (20 Pip Pullback)', minSessionPips: 40, minPullbackPips: 20, engulfRatio: 0.4, rrRatio: 1.0, maxSlPips: 30 },
    { name: 'LHF RR 1:2 (20 Pip Pullback)', minSessionPips: 40, minPullbackPips: 20, engulfRatio: 0.4, rrRatio: 2.0, maxSlPips: 30 },
    { name: 'LHF RR 1:3 (20 Pip Pullback)', minSessionPips: 40, minPullbackPips: 20, engulfRatio: 0.4, rrRatio: 3.0, maxSlPips: 30 },
    
    { name: 'LHF RR 1:1 (25 Pip Pullback)', minSessionPips: 50, minPullbackPips: 25, engulfRatio: 0.4, rrRatio: 1.0, maxSlPips: 30 },
    { name: 'LHF RR 1:2 (25 Pip Pullback)', minSessionPips: 50, minPullbackPips: 25, engulfRatio: 0.4, rrRatio: 2.0, maxSlPips: 30 },
    
    { name: 'LHF RR 1:1.5 (Strict Pullback)', minSessionPips: 60, minPullbackPips: 30, engulfRatio: 0.5, rrRatio: 1.5, maxSlPips: 35 },
    { name: 'LHF RR 1:2 (Strict Pullback)', minSessionPips: 60, minPullbackPips: 30, engulfRatio: 0.5, rrRatio: 2.0, maxSlPips: 35 },
  ];

  for (const conf of configs) {
    runSimulation(conf);
  }
}

runAll();
