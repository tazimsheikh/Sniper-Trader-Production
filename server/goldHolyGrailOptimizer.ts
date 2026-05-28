import fs from 'fs';
import readline from 'readline';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'XAUUSD_M1_202105030101_202605010159.csv');

const START_DATE = new Date('2021-05-01T00:00:00Z').getTime();
const END_DATE = new Date('2026-05-01T23:59:59Z').getTime();
const PIP_SIZE = 0.1; // Gold pip is $0.10
const PIP_VALUE = 10; // For XAUUSD: 1 standard lot = $10 per 0.1 price move
const RISK_PCT = 5; // 5% risk per trade
const SPREAD_PIPS = 2.5; // Typical gold spread is around $0.25
const SLIPPAGE_PIPS = 0.5; // Factor in some slippage for aggressive entries

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }
interface Trade {
  id: string; direction: 'BUY' | 'SELL'; entryTime: number; entryPrice: number;
  slPrice: number; tpPrice: number; lots: number;
  status: 'OPEN' | 'CLOSED_WON' | 'CLOSED_LOST' | 'TIME_BAILOUT';
  exitTime?: number; exitPrice?: number; profit?: number; pips?: number;
}

let globalM1Candles: Candle[] = [];

async function loadData() {
  console.log('Loading XAUUSD CSV data into memory...');
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
  maxSlPips: number;
  minTrapPips: number;
  maxBoxPips: number;
  engulfRatio: number;
  entryMethod: 'STANDARD' | 'RETRACE_50' | '15M_SWING';
  rrRatio: number;
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

  // Used for retracement entries
  let pendingRetraceEntry: { direction: 'BUY'|'SELL', limitPrice: number, slPrice: number, expiryTime: number } | null = null;

  for (let cIdx = 0; cIdx < globalM1Candles.length; cIdx++) {
    const c = globalM1Candles[cIdx];
    m1Candles.push(c);
    
    const dt = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const nyHour = dt.getUTCHours() - 4; // Approximating NY time from UTC (ignores DST for speed)
    const normalizedNyHour = nyHour < 0 ? nyHour + 24 : nyHour;
    const nyMinute = dt.getUTCMinutes();

    if (dPart !== currentDayStr) {
      if (currentDayStr !== '' && m1Candles.length > 1) {
        dailyCandles.push({ time: new Date(`${currentDayStr}T00:00:00Z`).getTime(), dateStr: currentDayStr, open: dayOpen, high: dayHigh, low: dayLow, close: m1Candles[m1Candles.length-2].close });
      }
      currentDayStr = dPart;
      dayOpen = c.open; dayHigh = c.high; dayLow = c.low;
      asianHigh = -Infinity; asianLow = Infinity;
      pendingRetraceEntry = null; // Clear pending orders on new day
    } else {
      dayHigh = Math.max(dayHigh, c.high); dayLow = Math.min(dayLow, c.low);
    }
    
    // Track Asian Session (approx 8PM to Midnight NY)
    if (normalizedNyHour >= 20 || normalizedNyHour < 2) {
      asianHigh = Math.max(asianHigh, c.high);
      asianLow = Math.min(asianLow, c.low);
    }
    
    const m15Min = Math.floor(nyMinute / 15) * 15;
    const m15Str = `${dPart} ${dt.getUTCHours()}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '' && bufReady(m1Candles)) {
        m15Candles.push({ time: new Date(m1Candles[m1Candles.length-2].time).getTime(), dateStr: currentM15Str, open: m15Open, high: m15High, low: m15Low, close: m1Candles[m1Candles.length-2].close });
      }
      currentM15Str = m15Str;
      m15Open = c.open; m15High = c.high; m15Low = c.low;
    } else {
      m15High = Math.max(m15High, c.high); m15Low = Math.min(m15Low, c.low);
    }

    // ── MANAGE OPEN TRADES ──
    for (const trade of openTrades) {
      if (trade.status !== 'OPEN') continue;
      
      const spreadVal = SPREAD_PIPS * PIP_SIZE;
      const slippageVal = SLIPPAGE_PIPS * PIP_SIZE;
      const ask = c.close + spreadVal;
      let closePrice = trade.direction === 'BUY' ? c.close : ask;
      
      // Time Bailout (1 hour / 60 mins)
      const minsOpen = (c.time - trade.entryTime) / 60000;
      if (minsOpen >= 60) {
        const currentPips = trade.direction === 'BUY' ? (c.close - trade.entryPrice)/PIP_SIZE : (trade.entryPrice - c.close)/PIP_SIZE;
        if (currentPips < 0) { // Only bailout if floating negative
            trade.exitPrice = closePrice; trade.exitTime = c.time;
            trade.pips = currentPips; trade.profit = currentPips * PIP_VALUE * trade.lots;
            trade.status = 'TIME_BAILOUT';
            BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE); maxDD = Math.max(maxDD, ((peakBalance-BALANCE)/peakBalance)*100); closedTrades.push(trade);
            continue;
        }
      }

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

    if (openTrades.length > 0) continue; // One trade at a time

    // ── CHECK PENDING RETRACEMENT ENTRIES ──
    if (pendingRetraceEntry) {
       if (c.time > pendingRetraceEntry.expiryTime) {
           pendingRetraceEntry = null; // Expired
       } else {
           if (pendingRetraceEntry.direction === 'BUY' && c.low <= pendingRetraceEntry.limitPrice) {
               const slPips = (pendingRetraceEntry.limitPrice - pendingRetraceEntry.slPrice) / PIP_SIZE;
               if (slPips <= config.maxSlPips) {
                   const lots = ((BALANCE * (RISK_PCT/100)) / slPips) / PIP_VALUE;
                   const tp = pendingRetraceEntry.limitPrice + (slPips * config.rrRatio * PIP_SIZE);
                   openTrades.push({ id: `TR_${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice: pendingRetraceEntry.limitPrice, slPrice: pendingRetraceEntry.slPrice, tpPrice: tp, lots, status: 'OPEN' });
               }
               pendingRetraceEntry = null;
           } else if (pendingRetraceEntry.direction === 'SELL' && c.high >= pendingRetraceEntry.limitPrice) {
               const slPips = (pendingRetraceEntry.slPrice - pendingRetraceEntry.limitPrice) / PIP_SIZE;
               if (slPips <= config.maxSlPips) {
                   const lots = ((BALANCE * (RISK_PCT/100)) / slPips) / PIP_VALUE;
                   const tp = pendingRetraceEntry.limitPrice - (slPips * config.rrRatio * PIP_SIZE);
                   openTrades.push({ id: `TR_${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice: pendingRetraceEntry.limitPrice, slPrice: pendingRetraceEntry.slPrice, tpPrice: tp, lots, status: 'OPEN' });
               }
               pendingRetraceEntry = null;
           }
       }
    }
    if (openTrades.length > 0) continue;

    // ── TRIGGER DETECTION (M15 Close) ──
    if (nyMinute % 15 === 14 && m15Candles.length >= 3 && m1Candles.length >= 2) {
       // Morning/Afternoon Windows (7AM-11AM, 1PM-3PM NY)
       const isMorning = normalizedNyHour >= 7 && normalizedNyHour < 11;
       const isAfternoon = normalizedNyHour >= 13 && normalizedNyHour < 15;
       if (!isMorning && !isAfternoon) continue;

       if (asianHigh === -Infinity) continue;

       const asianBoxPips = (asianHigh - asianLow) / PIP_SIZE;
       if (asianBoxPips > config.maxBoxPips) continue;

       const triggerCandle = m15Candles[m15Candles.length - 1];
       const bodySize = Math.abs(triggerCandle.close - triggerCandle.open);
       const candleRange = triggerCandle.high - triggerCandle.low;
       if (candleRange === 0) continue;

       const pipsAboveAsian = (triggerCandle.high - asianHigh) / PIP_SIZE;
       const pipsBelowAsian = (asianLow - triggerCandle.low) / PIP_SIZE;

       const upperWick = triggerCandle.high - Math.max(triggerCandle.open, triggerCandle.close);
       const lowerWick = Math.min(triggerCandle.open, triggerCandle.close) - triggerCandle.low;

       let direction: 'BUY'|'SELL' | null = null;
       let engulfingStrong = false;
       
       if (pipsAboveAsian >= config.minTrapPips && triggerCandle.close < triggerCandle.open) {
          const engulfRatio = bodySize / candleRange;
          if (engulfRatio >= config.engulfRatio || upperWick > bodySize * 2) {
             direction = 'SELL';
             engulfingStrong = true;
          }
       } else if (pipsBelowAsian >= config.minTrapPips && triggerCandle.close > triggerCandle.open) {
          const engulfRatio = bodySize / candleRange;
          if (engulfRatio >= config.engulfRatio || lowerWick > bodySize * 2) {
             direction = 'BUY';
             engulfingStrong = true;
          }
       }

       if (direction && engulfingStrong) {
          let slPrice = 0;
          let entryPrice = 0;
          let tpPrice = 0;
          
          if (config.entryMethod === '15M_SWING') {
              let swingEx = direction === 'SELL' ? -Infinity : Infinity;
              for(let i=1; i<m15Candles.length-1; i++) {
                 if (direction === 'SELL' && m15Candles[i].high > m15Candles[i-1].high && m15Candles[i].high > m15Candles[i+1].high) {
                     swingEx = Math.max(swingEx, m15Candles[i].high);
                 }
                 if (direction === 'BUY' && m15Candles[i].low < m15Candles[i-1].low && m15Candles[i].low < m15Candles[i+1].low) {
                     swingEx = Math.min(swingEx, m15Candles[i].low);
                 }
              }
              slPrice = direction === 'SELL' 
                 ? (swingEx !== -Infinity ? Math.max(swingEx, triggerCandle.high) : triggerCandle.high) + (5 * PIP_SIZE)
                 : (swingEx !== Infinity ? Math.min(swingEx, triggerCandle.low) : triggerCandle.low) - (5 * PIP_SIZE);
              entryPrice = direction === 'SELL' ? c.close - (SPREAD_PIPS*PIP_SIZE) : c.close + (SPREAD_PIPS*PIP_SIZE);
          } else {
              slPrice = direction === 'SELL' ? triggerCandle.high + (5 * PIP_SIZE) : triggerCandle.low - (5 * PIP_SIZE);
              entryPrice = direction === 'SELL' ? c.close - (SPREAD_PIPS*PIP_SIZE) : c.close + (SPREAD_PIPS*PIP_SIZE);
          }

          if (config.entryMethod === 'RETRACE_50') {
              // Place limit order at 50% of the M15 trigger candle body
              const limitPrice = direction === 'SELL' 
                  ? triggerCandle.close + (bodySize / 2) 
                  : triggerCandle.close - (bodySize / 2);
              
              pendingRetraceEntry = {
                  direction,
                  limitPrice,
                  slPrice,
                  expiryTime: c.time + (30 * 60 * 1000) // 30 mins to hit limit
              };
          } else {
              // Execute immediately
              const slPips = direction === 'SELL' ? (slPrice - entryPrice) / PIP_SIZE : (entryPrice - slPrice) / PIP_SIZE;
              if (slPips > 0 && slPips <= config.maxSlPips) {
                  const lots = ((BALANCE * (RISK_PCT/100)) / slPips) / PIP_VALUE;
                  tpPrice = direction === 'SELL' ? entryPrice - (slPips * config.rrRatio * PIP_SIZE) : entryPrice + (slPips * config.rrRatio * PIP_SIZE);
                  if (lots >= 0.01) {
                      openTrades.push({ id: `TR_${c.time}`, direction, entryTime: c.time, entryPrice, slPrice, tpPrice, lots, status: 'OPEN' });
                  }
              }
          }
       }
    }
  }

  const w = closedTrades.filter(t => (t.profit || 0) > 0).length;
  const wr = closedTrades.length > 0 ? (w / closedTrades.length) * 100 : 0;
  const gr = ((BALANCE - 100) / 100) * 100;
  return { wr, gr, dd: maxDD, trades: closedTrades.length, w, l: closedTrades.length - w, balance: BALANCE };
}

function bufReady(buf: Candle[]) { return buf.length > 1; }

async function main() {
  await loadData();
  
  const configs: OptimizerConfig[] = [];
  
  const maxSlOptions = [40, 60, 80]; // Relax stop limits a bit to give gold room to breathe
  const trapDepthOpts = [15, 20];
  const boxOpts = [150, 200, 300]; // Wider boxes to allow more trades
  const rrOpts = [2.0, 3.0, 4.0]; // Try different RR ratios

  for (const sl of maxSlOptions) {
    for (const trap of trapDepthOpts) {
      for (const box of boxOpts) {
        for (const rr of rrOpts) {
          configs.push({
            name: `15M_SWING | SL:${sl} | Trap:${trap} | Box:${box} | RR:${rr.toFixed(1)}`,
            maxSlPips: sl,
            minTrapPips: trap,
            maxBoxPips: box,
            engulfRatio: 0.4, // Standard
            entryMethod: '15M_SWING',
            rrRatio: rr
          });
        }
      }
    }
  }

  console.log('═'.repeat(100));
  console.log(`GOLD (XAUUSD) HOLY GRAIL TRAP OPTIMIZER - 5 YEAR BACKTEST (${configs.length} configs)`);
  console.log('═'.repeat(100));

  const results = [];

  for (let i = 0; i < configs.length; i++) {
    const r = runSimulation(configs[i]);
    results.push({ config: configs[i], result: r });
    if (i % 10 === 0) process.stdout.write(`\rProgress: ${i}/${configs.length}`);
  }
  process.stdout.write(`\rProgress: ${configs.length}/${configs.length}\n`);

  // Remove the strict filter so we can see what's happening
  const valid = results;
  valid.sort((a, b) => b.result.gr - a.result.gr); // Sort by highest growth

  console.log('\n=== TOP 10 CONFIGURATIONS BY RETURN ===');
  valid.slice(0, 10).forEach((r, i) => {
    const { config: c, result: res } = r;
    console.log(`${i+1}. ${c.name.padEnd(65)} | DD: ${res.dd.toFixed(1)}% | WR: ${res.wr.toFixed(1)}% | Trades: ${String(res.trades).padStart(3)} | Growth: +${res.gr.toFixed(0)}%`);
  });

  // Sort by lowest drawdown
  const safe = [...valid].sort((a, b) => a.result.dd - b.result.dd);
  console.log('\n=== TOP 5 SAFEST CONFIGURATIONS (LOWEST DRAWDOWN) ===');
  safe.slice(0, 5).forEach((r, i) => {
    const { config: c, result: res } = r;
    console.log(`${i+1}. ${c.name.padEnd(65)} | DD: ${res.dd.toFixed(1)}% | WR: ${res.wr.toFixed(1)}% | Trades: ${String(res.trades).padStart(3)} | Growth: +${res.gr.toFixed(0)}%`);
  });
}

main().catch(console.error);
