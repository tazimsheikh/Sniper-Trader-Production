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
  console.log(`Loaded ${globalM1Candles.length.toLocaleString()} M1 candles.`);
}

interface OptimizerConfig {
  name: string;
  minAsianPips: number;
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

  let dailyCandles: Candle[] = [];
  let m15Candles: Candle[] = [];
  let currentDayStr = '', currentM15Str = '';
  let dayOpen = 0, dayHigh = -Infinity, dayLow = Infinity;
  let m15Open = 0, m15High = -Infinity, m15Low = Infinity;
  
  let asianHigh = -Infinity, asianLow = Infinity;
  let m1Candles: Candle[] = [];
  let hasTradedToday = false;
  
  // Track consecutive pullback candles
  let consecutiveGreen = 0;
  let consecutiveRed = 0;

  for (let cIdx = 0; cIdx < globalM1Candles.length; cIdx++) {
    const c = globalM1Candles[cIdx];
    m1Candles.push(c);
    
    const dt = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const nyHour = dt.getUTCHours() - 4; 
    const normalizedNyHour = nyHour < 0 ? nyHour + 24 : nyHour;
    const nyMinute = dt.getUTCMinutes();

    if (dPart !== currentDayStr) {
      if (currentDayStr !== '' && m1Candles.length > 1) {
        dailyCandles.push({ time: new Date(`${currentDayStr}T00:00:00Z`).getTime(), dateStr: currentDayStr, open: dayOpen, high: dayHigh, low: dayLow, close: m1Candles[m1Candles.length-2].close });
      }
      currentDayStr = dPart;
      dayOpen = c.open; dayHigh = c.high; dayLow = c.low;
      asianHigh = -Infinity; asianLow = Infinity;
      hasTradedToday = false;
    } else {
      dayHigh = Math.max(dayHigh, c.high); dayLow = Math.min(dayLow, c.low);
    }
    
    // Asian Session: 8PM to 2AM NY
    if (normalizedNyHour >= 20 || normalizedNyHour < 2) {
      asianHigh = Math.max(asianHigh, c.high);
      asianLow = Math.min(asianLow, c.low);
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
      const ask = c.close + spreadVal;
      
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
    if (hasTradedToday) continue; // Only 1 trade per day

    // Trigger detection on M15 close
    if (nyMinute % 15 === 14 && m15Candles.length >= 4) {
       const isLondon = normalizedNyHour >= 2 && normalizedNyHour < 5;
       const isNY = normalizedNyHour >= 7 && normalizedNyHour < 11;
       if (!isLondon && !isNY) continue;

       if (asianHigh === -Infinity) continue;

       const asianBoxPips = (asianHigh - asianLow) / PIP_SIZE;
       
       // TREND RULE: Asian box must be LARGE enough to establish momentum
       if (asianBoxPips < config.minAsianPips) continue;

       const triggerCandle = m15Candles[m15Candles.length - 1];
       const p1 = m15Candles[m15Candles.length - 2];
       const p2 = m15Candles[m15Candles.length - 3];
       const p3 = m15Candles[m15Candles.length - 4];
       
       const bodySize = Math.abs(triggerCandle.close - triggerCandle.open);
       const candleRange = triggerCandle.high - triggerCandle.low;
       if (candleRange === 0) continue;

       let direction: 'BUY'|'SELL' | null = null;
       
       // MACRO TREND DOWN: Price is below Asian Low (or lower half of Asian range)
       const isMacroDowntrend = triggerCandle.close < asianLow + ((asianHigh - asianLow) * 0.2);
       
       // MACRO TREND UP: Price is above Asian High (or upper half of Asian range)
       const isMacroUptrend = triggerCandle.close > asianHigh - ((asianHigh - asianLow) * 0.2);

       // SELL SETUP (Downtrend Continuation)
       // We look for a 3-push correction UP (3 consecutive higher highs or green candles)
       const isThreePushUp = p3.close > p3.open && p2.close > p2.open && p1.close > p1.open;
       
       // BUY SETUP (Uptrend Continuation)
       // We look for a 3-push correction DOWN (3 consecutive lower lows or red candles)
       const isThreePushDown = p3.close < p3.open && p2.close < p2.open && p1.close < p1.open;

       if (isMacroDowntrend && isThreePushUp) {
          // Trigger: Bearish Engulfing
          if (triggerCandle.close < triggerCandle.open) {
             const engulfRatio = bodySize / candleRange;
             if (engulfRatio >= config.engulfRatio && triggerCandle.close < p1.low) {
                direction = 'SELL';
             }
          }
       } 
       else if (isMacroUptrend && isThreePushDown) {
          // Trigger: Bullish Engulfing
          if (triggerCandle.close > triggerCandle.open) {
             const engulfRatio = bodySize / candleRange;
             if (engulfRatio >= config.engulfRatio && triggerCandle.close > p1.high) {
                direction = 'BUY';
             }
          }
       }

       if (direction) {
          let slPrice = direction === 'BUY' ? Math.min(triggerCandle.low, p1.low, p2.low, p3.low) : Math.max(triggerCandle.high, p1.high, p2.high, p3.high);
          let entryPrice = c.close + (direction === 'BUY' ? SPREAD_PIPS*PIP_SIZE : 0);
          
          const slPips = Math.abs(entryPrice - slPrice) / PIP_SIZE;
          if (slPips > config.maxSlPips || slPips < 5) continue; // Risk filter
          
          const tpPips = slPips * config.rrRatio;
          const tpPrice = direction === 'BUY' ? entryPrice + (tpPips * PIP_SIZE) : entryPrice - (tpPips * PIP_SIZE);
          
          const lots = ((BALANCE * (RISK_PCT/100)) / slPips) / PIP_VALUE;
          
          openTrades.push({
            id: `TREND_${c.time}`, direction, entryTime: c.time, entryPrice, slPrice, tpPrice, lots, status: 'OPEN'
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
    { name: '3-Push RR 1:1 (Min 25 Pips)', minAsianPips: 25, engulfRatio: 0.4, rrRatio: 1.0, maxSlPips: 30 },
    { name: '3-Push RR 1:2 (Min 25 Pips)', minAsianPips: 25, engulfRatio: 0.4, rrRatio: 2.0, maxSlPips: 30 },
    { name: '3-Push RR 1:3 (Min 25 Pips)', minAsianPips: 25, engulfRatio: 0.4, rrRatio: 3.0, maxSlPips: 30 },
    { name: '3-Push RR 1:1 (Min 30 Pips)', minAsianPips: 30, engulfRatio: 0.4, rrRatio: 1.0, maxSlPips: 30 },
    { name: '3-Push RR 1:2 (Min 30 Pips)', minAsianPips: 30, engulfRatio: 0.4, rrRatio: 2.0, maxSlPips: 30 },
    { name: '3-Push RR 1:3 (Min 30 Pips)', minAsianPips: 30, engulfRatio: 0.4, rrRatio: 3.0, maxSlPips: 30 },
    { name: '3-Push RR 1:2 (Wide SL 40)', minAsianPips: 30, engulfRatio: 0.4, rrRatio: 2.0, maxSlPips: 40 },
  ];

  for (const conf of configs) {
    runSimulation(conf);
  }
}

runAll();
