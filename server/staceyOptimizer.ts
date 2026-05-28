import fs from 'fs';
import readline from 'readline';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data/GBPUSD_M1_202105030000_202605010159.csv');
const NEWS_FILE = path.join(process.cwd(), 'april_news.json');

const START_DATE = new Date('2026-03-01T00:00:00Z').getTime();
const END_DATE = new Date('2026-04-30T23:59:59Z').getTime();
const PIP_SIZE = 0.0001;
const PIP_VALUE = 10;
const RISK_PCT = 5;
const SPREAD_PIPS = 2.0; 
const SLIPPAGE_PIPS = 0.5;

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }
interface Trade {
  id: string; direction: 'BUY' | 'SELL'; entryTime: number; entryPrice: number;
  slPrice: number; tp1Price: number; tp2Price: number; lots: number;
  status: 'OPEN' | 'TP1_HIT' | 'CLOSED_WON' | 'CLOSED_LOST' | 'CLOSED_EOD' | 'TIME_BAILOUT';
  exitTime?: number; exitPrice?: number; profit?: number; pips?: number;
}

let globalM1Candles: Candle[] = [];
let newsEvents: any[] = [];

async function loadData() {
  newsEvents = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf-8'));
  console.log('Loading CSV data into memory...');
  
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
  console.log(`Loaded ${globalM1Candles.length} M1 candles.`);
}

function runSimulation(config: any) {
  let BALANCE = 100.0;
  let peakBalance = BALANCE;
  let openTrades: Trade[] = [];
  let closedTrades: Trade[] = [];

  let dailyCandles: Candle[] = [];
  let m15Candles: Candle[] = [];
  let currentDayStr = '', currentM15Str = '';
  let dayOpen = 0, dayHigh = -Infinity, dayLow = Infinity;
  let m15Open = 0, m15High = -Infinity, m15Low = Infinity;
  
  let m1Candles: Candle[] = [];

  for (let cIdx = 0; cIdx < globalM1Candles.length; cIdx++) {
    const c = globalM1Candles[cIdx];
    m1Candles.push(c);
    
    const dPart = c.dateStr.split('T')[0];
    if (dPart !== currentDayStr) {
      if (currentDayStr !== '' && m1Candles.length > 1) {
        dailyCandles.push({ time: new Date(`${currentDayStr}T00:00:00Z`).getTime(), dateStr: currentDayStr, open: dayOpen, high: dayHigh, low: dayLow, close: m1Candles[m1Candles.length-2].close });
      }
      currentDayStr = dPart;
      dayOpen = c.open; dayHigh = c.high; dayLow = c.low;
    } else {
      dayHigh = Math.max(dayHigh, c.high); dayLow = Math.min(dayLow, c.low);
    }
    
    const m15Min = Math.floor(new Date(c.time).getUTCMinutes() / 15) * 15;
    const m15Str = `${dPart} ${new Date(c.time).getUTCHours()}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '' && m1Candles.length > 1) {
        m15Candles.push({ time: new Date(m1Candles[m1Candles.length-2].time).getTime(), dateStr: currentM15Str, open: m15Open, high: m15High, low: m15Low, close: m1Candles[m1Candles.length-2].close });
      }
      currentM15Str = m15Str;
      m15Open = c.open; m15High = c.high; m15Low = c.low;
    } else {
      m15High = Math.max(m15High, c.high); m15Low = Math.min(m15Low, c.low);
    }

    // Manage Trades
    for (const trade of openTrades) {
      if (trade.status === 'CLOSED_WON' || trade.status === 'CLOSED_LOST' || trade.status === 'TIME_BAILOUT') continue;
      const currentProfitPips = trade.direction === 'BUY' ? (c.close - trade.entryPrice)/PIP_SIZE : (trade.entryPrice - c.close)/PIP_SIZE;
      
      let last15MSwingLow = -Infinity, last15MSwingHigh = Infinity;
      if (m15Candles.length >= 3) {
        for(let i=1; i<m15Candles.length-1; i++){
          if(m15Candles[i].low < m15Candles[i-1].low && m15Candles[i].low < m15Candles[i+1].low) last15MSwingLow = m15Candles[i].low;
          if(m15Candles[i].high > m15Candles[i-1].high && m15Candles[i].high > m15Candles[i+1].high) last15MSwingHigh = m15Candles[i].high;
        }
      }

      const spreadVal = SPREAD_PIPS * PIP_SIZE;
      const slippageVal = SLIPPAGE_PIPS * PIP_SIZE;
      const ask = c.close + spreadVal;
      let closePrice = trade.direction === 'BUY' ? c.close : ask;
      
      if (trade.direction === 'BUY' && c.low <= trade.slPrice) {
        trade.exitPrice = trade.slPrice - slippageVal;
        trade.exitTime = c.time;
        trade.pips = (trade.exitPrice - trade.entryPrice) / PIP_SIZE;
        trade.profit = trade.pips * PIP_VALUE * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit;
        peakBalance = Math.max(peakBalance, BALANCE);
        closedTrades.push(trade);
      } else if (trade.direction === 'SELL' && c.high >= trade.slPrice) {
        trade.exitPrice = trade.slPrice + slippageVal;
        trade.exitTime = c.time;
        trade.pips = (trade.entryPrice - trade.exitPrice) / PIP_SIZE;
        trade.profit = trade.pips * PIP_VALUE * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit;
        peakBalance = Math.max(peakBalance, BALANCE);
        closedTrades.push(trade);
      } else {
        if (trade.status === 'OPEN') {
           if ((trade.direction === 'BUY' && c.high >= trade.tp1Price) || (trade.direction === 'SELL' && c.low <= trade.tp1Price)) {
              trade.status = 'TP1_HIT';
              trade.lots = trade.lots / 2;
              BALANCE += (config.tp.tp1 * PIP_VALUE * trade.lots);
              peakBalance = Math.max(peakBalance, BALANCE);
              trade.slPrice = trade.entryPrice + (trade.direction==='BUY'? 2*PIP_SIZE : -2*PIP_SIZE);
           }
        }
        
        if (trade.status === 'TP1_HIT') {
           if ((trade.direction === 'BUY' && c.high >= trade.tp2Price) || (trade.direction === 'SELL' && c.low <= trade.tp2Price)) {
              trade.exitPrice = trade.tp2Price;
              trade.exitTime = c.time;
              trade.pips = config.tp.tp2;
              trade.profit = config.tp.tp2 * PIP_VALUE * trade.lots;
              trade.status = 'CLOSED_WON';
              BALANCE += trade.profit;
              peakBalance = Math.max(peakBalance, BALANCE);
              closedTrades.push(trade);
           } else {
              const buffer = 1 * PIP_SIZE;
              if (trade.direction === 'BUY' && last15MSwingLow !== -Infinity) {
                const trailPrice = last15MSwingLow - buffer;
                if (trailPrice > trade.slPrice && trailPrice < c.close) trade.slPrice = trailPrice;
              } else if (trade.direction === 'SELL' && last15MSwingHigh !== Infinity) {
                const trailPrice = last15MSwingHigh + buffer;
                if (trailPrice < trade.slPrice && trailPrice > c.close) trade.slPrice = trailPrice;
              }
           }
        }
        
        if (trade.status === 'OPEN' && currentProfitPips >= config.tp.be) {
           const buffer = 2 * PIP_SIZE;
           const bePrice = trade.direction === 'BUY' ? trade.entryPrice + buffer : trade.entryPrice - buffer;
           if (trade.direction === 'BUY' && trade.slPrice < trade.entryPrice) trade.slPrice = bePrice;
           if (trade.direction === 'SELL' && trade.slPrice > trade.entryPrice) trade.slPrice = bePrice;
        }

        const hrsOpen = (c.time - trade.entryTime) / (1000 * 60 * 60);
        if (hrsOpen >= 0.75 && currentProfitPips < 0) {
           trade.exitPrice = closePrice;
           trade.exitTime = c.time;
           trade.pips = currentProfitPips;
           trade.profit = currentProfitPips * PIP_VALUE * trade.lots;
           trade.status = 'TIME_BAILOUT';
           BALANCE += trade.profit;
           closedTrades.push(trade);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN' || t.status === 'TP1_HIT');

    if (openTrades.length === 0 && dailyCandles.length >= 2 && m15Candles.length >= 10 && m1Candles.length >= 2) {
      if (config.sessionOnly) {
        const h = new Date(c.time).getUTCHours();
        const isLondon = h >= 7 && h < 11;
        const isNY = h >= 12 && h < 16;
        if (!isLondon && !isNY) continue;
      }

      const isNewsBlackout = newsEvents.some(n => {
        const nTime = new Date(n.date).getTime();
        return Math.abs(nTime - c.time) < 5 * 60 * 1000 && ['USD','GBP'].includes(n.country);
      });
      if (isNewsBlackout) continue;

      const prevDay = dailyCandles[dailyCandles.length - 2];
      
      let swingHighs = [], swingLows = [];
      for(let i=2; i<m15Candles.length-1; i++){
        if(m15Candles[i].high > m15Candles[i-1].high && m15Candles[i].high > m15Candles[i+1].high) swingHighs.push(m15Candles[i].high);
        if(m15Candles[i].low < m15Candles[i-1].low && m15Candles[i].low < m15Candles[i+1].low) swingLows.push(m15Candles[i].low);
      }
      
      const last15MClosed = m15Candles[m15Candles.length - 2];
      const has3PushesUp = swingHighs.length >= 3;
      const has3PushesDown = swingLows.length >= 3;
      let has15M_BOS_Short = false, has15M_BOS_Long = false;
      if (swingLows.length > 0 && last15MClosed.close < swingLows[swingLows.length-1]) has15M_BOS_Short = true;
      if (swingHighs.length > 0 && last15MClosed.close > swingHighs[swingHighs.length-1]) has15M_BOS_Long = true;

      const prevM1 = m1Candles[m1Candles.length - 2];
      const currM1 = c;

      const bodySizePrev = Math.abs(prevM1.close - prevM1.open) / PIP_SIZE;
      const bodySizeCurr = Math.abs(currM1.close - currM1.open) / PIP_SIZE;

      // SHORT SETUP
      if (c.close > prevDay.high && has3PushesUp && has15M_BOS_Short) {
         if (prevM1.close > prevM1.open && currM1.close < currM1.open && currM1.close < prevM1.open) {
            if (bodySizeCurr >= config.engulfPipSize) {
                const entryPrice = c.close - (SPREAD_PIPS * PIP_SIZE) - (SLIPPAGE_PIPS * PIP_SIZE);
                let slPrice = Math.max(currM1.high, prevM1.high) + (5 * PIP_SIZE);
                if (config.slMode === '15M_STRUCTURE' && swingHighs.length > 0) {
                    slPrice = swingHighs[swingHighs.length-1] + (2 * PIP_SIZE);
                }
                const slPips = (slPrice - entryPrice) / PIP_SIZE;
                
                if (slPips > 0) {
                    const lotSize = ((BALANCE * (RISK_PCT / 100)) / slPips) / PIP_VALUE;
                    if (lotSize >= 0.02) {
                        openTrades.push({ id: `TR_${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice, slPrice, tp1Price: entryPrice - (config.tp.tp1 * PIP_SIZE), tp2Price: entryPrice - (config.tp.tp2 * PIP_SIZE), lots: lotSize, status: 'OPEN' });
                        m15Candles = []; 
                    }
                }
            }
         }
      }
      
      // LONG SETUP
      if (c.close < prevDay.low && has3PushesDown && has15M_BOS_Long) {
         if (prevM1.close < prevM1.open && currM1.close > currM1.open && currM1.close > prevM1.open) {
            if (bodySizeCurr >= config.engulfPipSize) {
                const entryPrice = c.close + (SPREAD_PIPS * PIP_SIZE) + (SLIPPAGE_PIPS * PIP_SIZE);
                let slPrice = Math.min(currM1.low, prevM1.low) - (5 * PIP_SIZE);
                if (config.slMode === '15M_STRUCTURE' && swingLows.length > 0) {
                    slPrice = swingLows[swingLows.length-1] - (2 * PIP_SIZE);
                }
                const slPips = (entryPrice - slPrice) / PIP_SIZE;
                
                if (slPips > 0) {
                    const lotSize = ((BALANCE * (RISK_PCT / 100)) / slPips) / PIP_VALUE;
                    if (lotSize >= 0.02) {
                        openTrades.push({ id: `TR_${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice, slPrice, tp1Price: entryPrice + (config.tp.tp1 * PIP_SIZE), tp2Price: entryPrice + (config.tp.tp2 * PIP_SIZE), lots: lotSize, status: 'OPEN' });
                        m15Candles = [];
                    }
                }
            }
         }
      }
    }
  }

  const winCount = closedTrades.filter(t => (t.profit || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0;
  const growth = ((BALANCE - 100) / 100) * 100;
  const maxDrawdown = peakBalance > 0 ? ((peakBalance - BALANCE) / peakBalance) * 100 : 0;

  return { winRate, growth, maxDrawdown, balance: BALANCE, trades: closedTrades, config };
}

async function runOptimizer() {
  await loadData();
  
  const engulfPipSizes = [0, 1.0, 1.5, 2.0];
  const sessionOnlyOptions = [false, true];
  const slModes = ['1M_CANDLE', '15M_STRUCTURE'];
  const tpLevels = [
    { tp1: 25, tp2: 50, be: 15 },
    { tp1: 30, tp2: 60, be: 20 },
    { tp1: 50, tp2: 100, be: 30 }
  ];

  const permutations = [];
  for (const engulfPipSize of engulfPipSizes) {
    for (const sessionOnly of sessionOnlyOptions) {
      for (const slMode of slModes) {
        for (const tp of tpLevels) {
          permutations.push({ engulfPipSize, sessionOnly, slMode, tp });
        }
      }
    }
  }

  console.log(`Testing ${permutations.length} permutations...`);
  const results = [];
  
  for (let i = 0; i < permutations.length; i++) {
    const r = runSimulation(permutations[i]);
    results.push(r);
    process.stdout.write(`\rProgress: ${i+1}/${permutations.length}`);
  }

  results.sort((a, b) => b.growth - a.growth);

  console.log('\n\n=== TOP 5 CONFIGURATIONS ===');
  results.slice(0, 5).forEach((r, i) => {
    console.log(`${i+1}. Growth: ${r.growth.toFixed(1)}% | Win Rate: ${r.winRate.toFixed(1)}% | DD: ${r.maxDrawdown.toFixed(1)}% | Trades: ${r.trades.length}`);
    console.log(`   Config: Engulf >= ${r.config.engulfPipSize} pips | Session: ${r.config.sessionOnly?'Yes':'No'} | SL: ${r.config.slMode} | TP: ${r.config.tp.tp1}/${r.config.tp.tp2}`);
  });

  const bestResult = results[0];
  console.log('\nSaving best result to public/backtest_results.json...');
  
  const uniqueCandles: Candle[] = [];
  let lastTime = 0;
  for (const c of globalM1Candles) {
    if (c.time > lastTime) {
      uniqueCandles.push(c);
      lastTime = c.time;
    }
  }

  const output = {
    metrics: { winRate: bestResult.winRate, growth: bestResult.growth, maxDrawdown: bestResult.maxDrawdown, balance: bestResult.balance, trades: bestResult.trades.length },
    candles: uniqueCandles,
    trades: bestResult.trades
  };

  fs.writeFileSync(path.join(process.cwd(), 'public/backtest_results.json'), JSON.stringify(output));
}

runOptimizer().catch(console.error);
