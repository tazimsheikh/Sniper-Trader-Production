import fs from 'fs';
import readline from 'readline';
import path from 'path';

// Types
interface Candle {
  time: number;
  dateStr: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Trade {
  id: string;
  direction: 'BUY' | 'SELL';
  entryTime: number;
  entryPrice: number;
  slPrice: number;
  tp1Price: number;
  tp2Price: number;
  lots: number;
  status: 'OPEN' | 'TP1_HIT' | 'CLOSED_WON' | 'CLOSED_LOST' | 'CLOSED_EOD' | 'TIME_BAILOUT';
  exitTime?: number;
  exitPrice?: number;
  profit?: number;
  pips?: number;
}

const DATA_FILE = path.join(process.cwd(), 'data/GBPUSD_M1_202105030000_202605010159.csv');
const NEWS_FILE = path.join(process.cwd(), 'april_news.json');

// Configuration
const START_DATE = new Date('2026-03-01T00:00:00Z').getTime();
const END_DATE = new Date('2026-04-30T23:59:59Z').getTime();
let BALANCE = 100.0; // Start with $100 account
const PIP_SIZE = 0.0001; // For GBPUSD
const PIP_VALUE = 10; // For 1 Standard Lot
const RISK_PCT = 5; // 5% risk per trade
const SPREAD_PIPS = 2.0; 
const SLIPPAGE_PIPS = 0.5;

async function runBacktest() {
  console.log('Loading News...');
  const newsEvents: any[] = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf-8'));
  
  console.log(`Starting Backtest on GBPUSD from ${new Date(START_DATE).toISOString()} to ${new Date(END_DATE).toISOString()}`);
  
  const fileStream = fs.createReadStream(DATA_FILE);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let m1Candles: Candle[] = [];
  let dailyCandles: Candle[] = [];
  let m15Candles: Candle[] = [];
  
  let currentDayStr = '';
  let dayOpen = 0, dayHigh = -Infinity, dayLow = Infinity;
  
  let currentM15Str = '';
  let m15Open = 0, m15High = -Infinity, m15Low = Infinity;

  let openTrades: Trade[] = [];
  let closedTrades: Trade[] = [];
  let peakBalance = BALANCE;
  
  let isFirstLine = true;
  let linesRead = 0;

  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; } // Skip header
    
    // <DATE>	<TIME>	<OPEN>	<HIGH>	<LOW>	<CLOSE>	<TICKVOL>	<VOL>	<SPREAD>
    const parts = line.split('\t');
    if (parts.length < 6) continue;
    
    // Parse 2021.05.03 00:00:00 to valid Date
    const dPart = parts[0].replace(/\./g, '-');
    const tPart = parts[1];
    const timestamp = new Date(`${dPart}T${tPart}Z`).getTime();
    
    if (timestamp < START_DATE) continue;
    if (timestamp > END_DATE) break;

    const open = parseFloat(parts[2]);
    const high = parseFloat(parts[3]);
    const low = parseFloat(parts[4]);
    const close = parseFloat(parts[5]);
    
    const candle: Candle = { time: timestamp, dateStr: new Date(timestamp).toISOString(), open, high, low, close };
    m1Candles.push(candle);
    
    // Build Daily
    const dayStr = dPart;
    if (dayStr !== currentDayStr) {
      if (currentDayStr !== '') {
        dailyCandles.push({
          time: new Date(`${currentDayStr}T00:00:00Z`).getTime(),
          dateStr: currentDayStr,
          open: dayOpen, high: dayHigh, low: dayLow, close: m1Candles[m1Candles.length-2].close
        });
      }
      currentDayStr = dayStr;
      dayOpen = open;
      dayHigh = high;
      dayLow = low;
    } else {
      dayHigh = Math.max(dayHigh, high);
      dayLow = Math.min(dayLow, low);
    }
    
    // Build M15
    const m15Min = Math.floor(new Date(timestamp).getUTCMinutes() / 15) * 15;
    const m15Str = `${dayStr} ${new Date(timestamp).getUTCHours()}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '') {
        m15Candles.push({
          time: new Date(m1Candles[m1Candles.length-2].time).getTime(),
          dateStr: currentM15Str,
          open: m15Open, high: m15High, low: m15Low, close: m1Candles[m1Candles.length-2].close
        });
      }
      currentM15Str = m15Str;
      m15Open = open;
      m15High = high;
      m15Low = low;
    } else {
      m15High = Math.max(m15High, high);
      m15Low = Math.min(m15Low, low);
    }

    // --- ENGINE LOGIC EVERY MINUTE ---
    
    // Manage Open Trades
    for (const trade of openTrades) {
      if (trade.status === 'CLOSED_WON' || trade.status === 'CLOSED_LOST' || trade.status === 'TIME_BAILOUT') continue;
      
      const currentProfitPips = trade.direction === 'BUY' ? (close - trade.entryPrice)/PIP_SIZE : (trade.entryPrice - close)/PIP_SIZE;
      
      // Calculate 15M Swings (for trailing stop)
      let last15MSwingLow = -Infinity;
      let last15MSwingHigh = Infinity;
      if (m15Candles.length >= 3) {
        for(let i=1; i<m15Candles.length-1; i++){
          if(m15Candles[i].low < m15Candles[i-1].low && m15Candles[i].low < m15Candles[i+1].low) last15MSwingLow = m15Candles[i].low;
          if(m15Candles[i].high > m15Candles[i-1].high && m15Candles[i].high > m15Candles[i+1].high) last15MSwingHigh = m15Candles[i].high;
        }
      }

      // Check SL / TP
      const spreadVal = SPREAD_PIPS * PIP_SIZE;
      const slippageVal = SLIPPAGE_PIPS * PIP_SIZE;
      
      const bid = close; // Simplified
      const ask = close + spreadVal;
      
      let closePrice = trade.direction === 'BUY' ? bid : ask;
      
      if (trade.direction === 'BUY' && low <= trade.slPrice) {
        trade.exitPrice = trade.slPrice - slippageVal; // Slippage on SL
        trade.exitTime = timestamp;
        trade.pips = (trade.exitPrice - trade.entryPrice) / PIP_SIZE;
        trade.profit = trade.pips * PIP_VALUE * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit;
        peakBalance = Math.max(peakBalance, BALANCE);
        closedTrades.push(trade);
      } else if (trade.direction === 'SELL' && high >= trade.slPrice) {
        trade.exitPrice = trade.slPrice + slippageVal; // Slippage on SL
        trade.exitTime = timestamp;
        trade.pips = (trade.entryPrice - trade.exitPrice) / PIP_SIZE;
        trade.profit = trade.pips * PIP_VALUE * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit;
        peakBalance = Math.max(peakBalance, BALANCE);
        closedTrades.push(trade);
      } else {
        // TP1 Hit
        if (trade.status === 'OPEN') {
           if ((trade.direction === 'BUY' && high >= trade.tp1Price) || (trade.direction === 'SELL' && low <= trade.tp1Price)) {
              trade.status = 'TP1_HIT'; // Partial closed, logic simplifies to just one trade object here but we book half profit
              trade.lots = trade.lots / 2; // Keep half for TP2
              BALANCE += (50 * PIP_VALUE * trade.lots); // Book 50 pips on half
              peakBalance = Math.max(peakBalance, BALANCE);
              trade.slPrice = trade.entryPrice + (trade.direction==='BUY'? 2*PIP_SIZE : -2*PIP_SIZE); // BE
           }
        }
        
        // TP2 Hit
        if (trade.status === 'TP1_HIT') {
           if ((trade.direction === 'BUY' && high >= trade.tp2Price) || (trade.direction === 'SELL' && low <= trade.tp2Price)) {
              trade.exitPrice = trade.tp2Price;
              trade.exitTime = timestamp;
              trade.pips = 100;
              trade.profit = 100 * PIP_VALUE * trade.lots;
              trade.status = 'CLOSED_WON';
              BALANCE += trade.profit;
              peakBalance = Math.max(peakBalance, BALANCE);
              closedTrades.push(trade);
           } else {
              // Structural Trailing Stop
              const buffer = 1 * PIP_SIZE;
              if (trade.direction === 'BUY' && last15MSwingLow !== -Infinity) {
                const trailPrice = last15MSwingLow - buffer;
                if (trailPrice > trade.slPrice && trailPrice < close) trade.slPrice = trailPrice;
              } else if (trade.direction === 'SELL' && last15MSwingHigh !== Infinity) {
                const trailPrice = last15MSwingHigh + buffer;
                if (trailPrice < trade.slPrice && trailPrice > close) trade.slPrice = trailPrice;
              }
           }
        }
        
        // Breakeven logic before TP1
        if (trade.status === 'OPEN' && currentProfitPips >= 30) {
           const buffer = 2 * PIP_SIZE;
           const bePrice = trade.direction === 'BUY' ? trade.entryPrice + buffer : trade.entryPrice - buffer;
           if (trade.direction === 'BUY' && trade.slPrice < trade.entryPrice) trade.slPrice = bePrice;
           if (trade.direction === 'SELL' && trade.slPrice > trade.entryPrice) trade.slPrice = bePrice;
        }

        // Time bailout (45 min)
        const hrsOpen = (timestamp - trade.entryTime) / (1000 * 60 * 60);
        if (hrsOpen >= 0.75 && currentProfitPips < 0) {
           trade.exitPrice = closePrice;
           trade.exitTime = timestamp;
           trade.pips = currentProfitPips;
           trade.profit = currentProfitPips * PIP_VALUE * trade.lots;
           trade.status = 'TIME_BAILOUT';
           BALANCE += trade.profit;
           closedTrades.push(trade);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN' || t.status === 'TP1_HIT');

    // Look for New Trades
    if (openTrades.length === 0 && dailyCandles.length >= 2 && m15Candles.length >= 10 && m1Candles.length >= 2) {
      // News Blackout Check
      const isNewsBlackout = newsEvents.some(n => {
        const nTime = new Date(n.date).getTime();
        return Math.abs(nTime - timestamp) < 5 * 60 * 1000 && ['USD','GBP'].includes(n.country);
      });
      if (isNewsBlackout) continue;

      const prevDay = dailyCandles[dailyCandles.length - 2];
      
      // Calculate 15M 3-Push and BOS
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
      const currM1 = m1Candles[m1Candles.length - 1];

      // SHORT SETUP (Day 1 First Red Day / Reversal)
      if (close > prevDay.high && has3PushesUp && has15M_BOS_Short) {
         // M1 Engulfing Short
         if (prevM1.close > prevM1.open && currM1.close < currM1.open && currM1.close < prevM1.open) {
            const entryPrice = close - (SPREAD_PIPS * PIP_SIZE) - (SLIPPAGE_PIPS * PIP_SIZE);
            const slPrice = Math.max(currM1.high, prevM1.high) + (5 * PIP_SIZE);
            const slPips = (slPrice - entryPrice) / PIP_SIZE;
            
            const riskAmount = BALANCE * (RISK_PCT / 100);
            const lotSize = (riskAmount / slPips) / PIP_VALUE;
            
            if (lotSize >= 0.02) {
               openTrades.push({
                 id: `TR_${timestamp}`, direction: 'SELL', entryTime: timestamp,
                 entryPrice, slPrice, tp1Price: entryPrice - (50 * PIP_SIZE), tp2Price: entryPrice - (100 * PIP_SIZE),
                 lots: lotSize, status: 'OPEN'
               });
               // Prevent rapid re-entry by skipping some ticks
               m15Candles = []; 
            }
         }
      }
      
      // LONG SETUP
      if (close < prevDay.low && has3PushesDown && has15M_BOS_Long) {
         // M1 Engulfing Long
         if (prevM1.close < prevM1.open && currM1.close > currM1.open && currM1.close > prevM1.open) {
            const entryPrice = close + (SPREAD_PIPS * PIP_SIZE) + (SLIPPAGE_PIPS * PIP_SIZE);
            const slPrice = Math.min(currM1.low, prevM1.low) - (5 * PIP_SIZE);
            const slPips = (entryPrice - slPrice) / PIP_SIZE;
            
            const riskAmount = BALANCE * (RISK_PCT / 100);
            const lotSize = (riskAmount / slPips) / PIP_VALUE;
            
            if (lotSize >= 0.02) {
               openTrades.push({
                 id: `TR_${timestamp}`, direction: 'BUY', entryTime: timestamp,
                 entryPrice, slPrice, tp1Price: entryPrice + (50 * PIP_SIZE), tp2Price: entryPrice + (100 * PIP_SIZE),
                 lots: lotSize, status: 'OPEN'
               });
               m15Candles = [];
            }
         }
      }
    }
  }

  // Calculate Metrics
  const winCount = closedTrades.filter(t => (t.profit || 0) > 0).length;
  const winRate = (winCount / closedTrades.length) * 100;
  const growth = ((BALANCE - 100) / 100) * 100;
  const maxDrawdown = ((peakBalance - BALANCE) / peakBalance) * 100;

  console.log(`\n=== BACKTEST COMPLETE ===`);
  console.log(`Total Trades: ${closedTrades.length}`);
  console.log(`Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`Final Balance: $${BALANCE.toFixed(2)}`);
  console.log(`Growth: ${growth.toFixed(1)}%`);
  console.log(`Max Drawdown: ${maxDrawdown.toFixed(1)}%`);

  // Filter out any duplicate timestamps
  const uniqueCandles: Candle[] = [];
  let lastTime = 0;
  for (const c of m1Candles) {
    if (c.time > lastTime) {
      uniqueCandles.push(c);
      lastTime = c.time;
    }
  }

  // Write Results for Frontend
  const output = {
    metrics: { winRate, growth, maxDrawdown, balance: BALANCE, trades: closedTrades.length },
    candles: uniqueCandles,
    trades: closedTrades
  };

  fs.writeFileSync(path.join(process.cwd(), 'public/backtest_results.json'), JSON.stringify(output));
  console.log('Saved to public/backtest_results.json');
}

runBacktest().catch(console.error);
