import fs from 'fs';
import readline from 'readline';
import path from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════
interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }
interface Trade {
  id: string; direction: 'BUY' | 'SELL'; entryTime: number; entryPrice: number;
  slPrice: number; tp1Price: number; tp2Price: number; lots: number;
  status: 'OPEN' | 'TP1_HIT' | 'CLOSED_WON' | 'CLOSED_LOST' | 'TIME_BAILOUT';
  exitTime?: number; exitPrice?: number; profit?: number; pips?: number;
  narrative?: string; confluenceScore?: number;
  dayCount?: number; atMoneyZone?: boolean; asianTrap?: boolean; pumpDump?: boolean;
  entryHour?: number; slPips?: number; riskReward?: number;
}

interface Config {
  engulfPipSize: number; sessionOnly: boolean; slMode: '1M_CANDLE' | '15M_STRUCTURE';
  tp: { tp1: number; tp2: number; be: number }; minConfluence: number;
  maxTradesPerDay: number; riskPct: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAIR DEFINITIONS - Focus on the 7 profitable + 3 near-miss pairs
// ═══════════════════════════════════════════════════════════════════════════════
const PAIRS = [
  { symbol: 'GBPCAD', file: 'GBPCAD_M1_202105030006_202605010159.csv', pipSize: 0.0001, pipValue: 10, nc: ['GBP','CAD'] },
  { symbol: 'USDJPY', file: 'USDJPY_M1_202105030000_202605010159.csv', pipSize: 0.01, pipValue: 10, nc: ['USD','JPY'] },
  { symbol: 'CHFJPY', file: 'CHFJPY_M1_202105030006_202605010159.csv', pipSize: 0.01, pipValue: 10, nc: ['CHF','JPY'] },
  { symbol: 'GBPUSD', file: 'GBPUSD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, nc: ['GBP','USD'] },
  { symbol: 'GBPCHF', file: 'GBPCHF_M1_202105030006_202605010159.csv', pipSize: 0.0001, pipValue: 10, nc: ['GBP','CHF'] },
  { symbol: 'USDCAD', file: 'USDCAD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, nc: ['USD','CAD'] },
  { symbol: 'EURCAD', file: 'EURCAD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, nc: ['EUR','CAD'] },
  { symbol: 'GBPJPY', file: 'GBPJPY_M1_202105030006_202605010159.csv', pipSize: 0.01, pipValue: 10, nc: ['GBP','JPY'] },
  { symbol: 'EURCHF', file: 'EURCHF_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, nc: ['EUR','CHF'] },
  { symbol: 'EURUSD', file: 'EURUSD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, nc: ['EUR','USD'] },
];

const START_DATE = new Date('2026-02-01T00:00:00Z').getTime();
const END_DATE   = new Date('2026-04-30T23:59:59Z').getTime();
const SPREAD_PIPS = 2.0;
const SLIPPAGE_PIPS = 0.5;

let newsEvents: any[] = [];

async function loadCandles(filePath: string): Promise<Candle[]> {
  const candles: Candle[] = [];
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
    candles.push({ time: timestamp, dateStr: new Date(timestamp).toISOString(), open: parseFloat(parts[2]), high: parseFloat(parts[3]), low: parseFloat(parts[4]), close: parseFloat(parts[5]) });
  }
  return candles;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATION WITH FULL TRADE METADATA
// ═══════════════════════════════════════════════════════════════════════════════
function runSim(m1Data: Candle[], config: Config, pipSize: number, pipValue: number, nc: string[]) {
  let BALANCE = 100.0;
  let peakBalance = BALANCE;
  let maxDD = 0;
  let openTrades: Trade[] = [];
  let closedTrades: Trade[] = [];
  let dailyCandles: Candle[] = [];
  let m15Candles: Candle[] = [];
  let m1Window: Candle[] = [];
  let currentDayStr = '', currentM15Str = '';
  let dayOpen = 0, dayHigh = -Infinity, dayLow = Infinity;
  let m15Open = 0, m15High = -Infinity, m15Low = Infinity;
  let asianDayStr = '', asianHigh = -Infinity, asianLow = Infinity;
  let asianBreachedHigh = false, asianBreachedLow = false;
  let londonDayStr = '', londonFirstHourOpen = 0, londonFirstHourClose = 0, londonFirstHourSet = false;
  let tradeDayStr = '', tradesToday = 0;

  // Track equity curve for drawdown analysis
  const equityCurve: { time: number; balance: number }[] = [];

  for (let cIdx = 0; cIdx < m1Data.length; cIdx++) {
    const c = m1Data[cIdx];
    m1Window.push(c);
    const d = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const utcH = d.getUTCHours();
    const utcM = d.getUTCMinutes();

    // Daily candles
    if (dPart !== currentDayStr) {
      if (currentDayStr !== '' && m1Window.length > 1) {
        dailyCandles.push({ time: new Date(`${currentDayStr}T00:00:00Z`).getTime(), dateStr: currentDayStr, open: dayOpen, high: dayHigh, low: dayLow, close: m1Window[m1Window.length-2].close });
      }
      currentDayStr = dPart; dayOpen = c.open; dayHigh = c.high; dayLow = c.low;
    } else { dayHigh = Math.max(dayHigh, c.high); dayLow = Math.min(dayLow, c.low); }

    // M15 candles
    const m15Min = Math.floor(utcM / 15) * 15;
    const m15Str = `${dPart} ${utcH}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '' && m1Window.length > 1) {
        m15Candles.push({ time: m1Window[m1Window.length-2].time, dateStr: currentM15Str, open: m15Open, high: m15High, low: m15Low, close: m1Window[m1Window.length-2].close });
      }
      currentM15Str = m15Str; m15Open = c.open; m15High = c.high; m15Low = c.low;
    } else { m15High = Math.max(m15High, c.high); m15Low = Math.min(m15Low, c.low); }

    // Asian session
    if (dPart !== asianDayStr) { asianDayStr = dPart; asianHigh = -Infinity; asianLow = Infinity; asianBreachedHigh = false; asianBreachedLow = false; }
    if (utcH >= 0 && utcH < 6) { asianHigh = Math.max(asianHigh, c.high); asianLow = Math.min(asianLow, c.low); }
    if (utcH >= 7 && asianHigh !== -Infinity) { if (c.high > asianHigh) asianBreachedHigh = true; if (c.low < asianLow) asianBreachedLow = true; }

    // London first hour
    if (dPart !== londonDayStr) { londonDayStr = dPart; londonFirstHourSet = false; londonFirstHourOpen = 0; londonFirstHourClose = 0; }
    if (utcH === 7 && utcM === 0 && !londonFirstHourSet) londonFirstHourOpen = c.open;
    if (utcH === 7 && utcM === 59) { londonFirstHourClose = c.close; londonFirstHourSet = true; }

    // Trade per day
    if (dPart !== tradeDayStr) { tradeDayStr = dPart; tradesToday = 0; }

    // Record equity every hour
    if (utcM === 0) equityCurve.push({ time: c.time, balance: BALANCE });

    // ── MANAGE OPEN TRADES ──
    for (const trade of openTrades) {
      if (trade.status === 'CLOSED_WON' || trade.status === 'CLOSED_LOST' || trade.status === 'TIME_BAILOUT') continue;
      const profitPips = trade.direction === 'BUY' ? (c.close - trade.entryPrice)/pipSize : (trade.entryPrice - c.close)/pipSize;
      let last15MSwingLow = -Infinity, last15MSwingHigh = Infinity;
      if (m15Candles.length >= 3) {
        for (let i=1; i<m15Candles.length-1; i++) {
          if (m15Candles[i].low < m15Candles[i-1].low && m15Candles[i].low < m15Candles[i+1].low) last15MSwingLow = m15Candles[i].low;
          if (m15Candles[i].high > m15Candles[i-1].high && m15Candles[i].high > m15Candles[i+1].high) last15MSwingHigh = m15Candles[i].high;
        }
      }
      const slipVal = SLIPPAGE_PIPS * pipSize;
      const spreadVal = SPREAD_PIPS * pipSize;
      const ask = c.close + spreadVal;
      const closePrice = trade.direction === 'BUY' ? c.close : ask;

      if (trade.direction === 'BUY' && c.low <= trade.slPrice) {
        trade.exitPrice = trade.slPrice - slipVal; trade.exitTime = c.time;
        trade.pips = (trade.exitPrice - trade.entryPrice)/pipSize;
        trade.profit = trade.pips * pipValue * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE);
        maxDD = Math.max(maxDD, ((peakBalance - BALANCE)/peakBalance)*100);
        closedTrades.push(trade);
      } else if (trade.direction === 'SELL' && c.high >= trade.slPrice) {
        trade.exitPrice = trade.slPrice + slipVal; trade.exitTime = c.time;
        trade.pips = (trade.entryPrice - trade.exitPrice)/pipSize;
        trade.profit = trade.pips * pipValue * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE);
        maxDD = Math.max(maxDD, ((peakBalance - BALANCE)/peakBalance)*100);
        closedTrades.push(trade);
      } else {
        if (trade.status === 'OPEN') {
          if ((trade.direction === 'BUY' && c.high >= trade.tp1Price) || (trade.direction === 'SELL' && c.low <= trade.tp1Price)) {
            trade.status = 'TP1_HIT'; trade.lots /= 2;
            BALANCE += (config.tp.tp1 * pipValue * trade.lots); peakBalance = Math.max(peakBalance, BALANCE);
            trade.slPrice = trade.entryPrice + (trade.direction==='BUY'? 2*pipSize : -2*pipSize);
          }
        }
        if (trade.status === 'TP1_HIT') {
          if ((trade.direction === 'BUY' && c.high >= trade.tp2Price) || (trade.direction === 'SELL' && c.low <= trade.tp2Price)) {
            trade.exitPrice = trade.tp2Price; trade.exitTime = c.time;
            trade.pips = config.tp.tp2; trade.profit = config.tp.tp2 * pipValue * trade.lots;
            trade.status = 'CLOSED_WON'; BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE);
            closedTrades.push(trade);
          } else {
            const buf = 1 * pipSize;
            if (trade.direction === 'BUY' && last15MSwingLow !== -Infinity) { const tp = last15MSwingLow - buf; if (tp > trade.slPrice && tp < c.close) trade.slPrice = tp; }
            else if (trade.direction === 'SELL' && last15MSwingHigh !== Infinity) { const tp = last15MSwingHigh + buf; if (tp < trade.slPrice && tp > c.close) trade.slPrice = tp; }
          }
        }
        if (trade.status === 'OPEN' && profitPips >= config.tp.be) {
          const buf = 2 * pipSize;
          const beP = trade.direction === 'BUY' ? trade.entryPrice + buf : trade.entryPrice - buf;
          if (trade.direction === 'BUY' && trade.slPrice < trade.entryPrice) trade.slPrice = beP;
          if (trade.direction === 'SELL' && trade.slPrice > trade.entryPrice) trade.slPrice = beP;
        }
        const hrs = (c.time - trade.entryTime) / (1000*60*60);
        if (hrs >= 0.75 && profitPips < 0) {
          trade.exitPrice = closePrice; trade.exitTime = c.time;
          trade.pips = profitPips; trade.profit = profitPips * pipValue * trade.lots;
          trade.status = 'TIME_BAILOUT'; BALANCE += trade.profit;
          maxDD = Math.max(maxDD, ((peakBalance - BALANCE)/peakBalance)*100);
          closedTrades.push(trade);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN' || t.status === 'TP1_HIT');

    // ── LOOK FOR NEW TRADES ──
    if (openTrades.length > 0 || dailyCandles.length < 4 || m15Candles.length < 10 || m1Window.length < 2) continue;
    if (tradesToday >= config.maxTradesPerDay) continue;

    if (config.sessionOnly) {
      const isLon = utcH >= 7 && utcH < 11;
      const isNY = utcH >= 12 && utcH < 16;
      if (!isLon && !isNY) continue;
    }

    const isNews = newsEvents.some(n => { const nt = new Date(n.date).getTime(); return Math.abs(nt - c.time) < 5*60*1000 && nc.includes(n.country); });
    if (isNews) continue;

    let swingHighs: number[] = [], swingLows: number[] = [];
    for (let i=2; i<m15Candles.length-1; i++) {
      if (m15Candles[i].high > m15Candles[i-1].high && m15Candles[i].high > m15Candles[i+1].high) swingHighs.push(m15Candles[i].high);
      if (m15Candles[i].low < m15Candles[i-1].low && m15Candles[i].low < m15Candles[i+1].low) swingLows.push(m15Candles[i].low);
    }
    const last15MC = m15Candles[m15Candles.length - 2];
    const has3PushUp = swingHighs.length >= 3;
    const has3PushDown = swingLows.length >= 3;
    const bos_short = swingLows.length > 0 && last15MC.close < swingLows[swingLows.length-1];
    const bos_long = swingHighs.length > 0 && last15MC.close > swingHighs[swingHighs.length-1];

    const prevM1 = m1Window[m1Window.length - 2];
    const bodySize = Math.abs(c.close - c.open) / pipSize;
    const isBearEngulf = prevM1.close > prevM1.open && c.close < c.open && c.close < prevM1.open && bodySize >= config.engulfPipSize;
    const isBullEngulf = prevM1.close < prevM1.open && c.close > c.open && c.close > prevM1.open && bodySize >= config.engulfPipSize;

    const prevDay = dailyCandles[dailyCandles.length - 2];

    // Day count
    let consGreen = 0, consRed = 0;
    for (let i = dailyCandles.length - 1; i >= 0; i--) {
      const g = dailyCandles[i].close > dailyCandles[i].open;
      if (i === dailyCandles.length - 1) { if (g) consGreen = 1; else consRed = 1; }
      else { if (g && consGreen > 0) consGreen++; else if (!g && consRed > 0) consRed++; else break; }
    }
    const day3Short = consGreen >= 3;
    const day3Long = consRed >= 3;

    // Money zone
    const mzBuf = 10 * pipSize;
    const atMZHigh = c.close >= prevDay.high - mzBuf;
    const atMZLow = c.close <= prevDay.low + mzBuf;

    // Asian trap
    const bullTrap = asianBreachedHigh && asianHigh !== -Infinity && c.close < asianHigh;
    const bearTrap = asianBreachedLow && asianLow !== Infinity && c.close > asianLow;

    // Pump & dump
    let pnD = false, dnP = false;
    if (londonFirstHourSet) {
      const lonBull = londonFirstHourClose > londonFirstHourOpen;
      pnD = lonBull && bos_short; dnP = !lonBull && bos_long;
    }

    // ── SHORT ──
    let sScore = 0; let sNarr: string[] = [];
    if (has3PushUp && bos_short) { sScore += 2; sNarr.push('3Push_BOS'); }
    if (isBearEngulf) { sScore += 1; sNarr.push('Engulf'); }
    if (day3Short) { sScore += 3; sNarr.push('Day3'); }
    if (atMZHigh) { sScore += 2; sNarr.push('MoneyZone'); }
    if (bullTrap) { sScore += 3; sNarr.push('AsianTrap'); }
    if (pnD) { sScore += 2; sNarr.push('PumpDump'); }

    if (sScore >= config.minConfluence && isBearEngulf && (has3PushUp || bos_short)) {
      const entry = c.close - (SPREAD_PIPS * pipSize) - (SLIPPAGE_PIPS * pipSize);
      let sl = Math.max(c.high, prevM1.high) + (5 * pipSize);
      if (config.slMode === '15M_STRUCTURE' && swingHighs.length > 0) sl = swingHighs[swingHighs.length-1] + (2 * pipSize);
      const slPips = (sl - entry) / pipSize;
      if (slPips > 0 && slPips < 100) {
        const lots = ((BALANCE * (config.riskPct / 100)) / slPips) / pipValue;
        if (lots >= 0.01) {
          openTrades.push({
            id: `TR_${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice: entry, slPrice: sl,
            tp1Price: entry - (config.tp.tp1 * pipSize), tp2Price: entry - (config.tp.tp2 * pipSize),
            lots, status: 'OPEN', narrative: sNarr.join('+'), confluenceScore: sScore,
            dayCount: consGreen, atMoneyZone: atMZHigh, asianTrap: bullTrap, pumpDump: pnD,
            entryHour: utcH, slPips, riskReward: config.tp.tp1 / slPips
          });
          m15Candles = []; tradesToday++;
        }
      }
    }

    // ── LONG ──
    let lScore = 0; let lNarr: string[] = [];
    if (has3PushDown && bos_long) { lScore += 2; lNarr.push('3Push_BOS'); }
    if (isBullEngulf) { lScore += 1; lNarr.push('Engulf'); }
    if (day3Long) { lScore += 3; lNarr.push('Day3'); }
    if (atMZLow) { lScore += 2; lNarr.push('MoneyZone'); }
    if (bearTrap) { lScore += 3; lNarr.push('AsianTrap'); }
    if (dnP) { lScore += 2; lNarr.push('DumpPump'); }

    if (lScore >= config.minConfluence && isBullEngulf && (has3PushDown || bos_long)) {
      const entry = c.close + (SPREAD_PIPS * pipSize) + (SLIPPAGE_PIPS * pipSize);
      let sl = Math.min(c.low, prevM1.low) - (5 * pipSize);
      if (config.slMode === '15M_STRUCTURE' && swingLows.length > 0) sl = swingLows[swingLows.length-1] - (2 * pipSize);
      const slPips = (entry - sl) / pipSize;
      if (slPips > 0 && slPips < 100) {
        const lots = ((BALANCE * (config.riskPct / 100)) / slPips) / pipValue;
        if (lots >= 0.01) {
          openTrades.push({
            id: `TR_${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice: entry, slPrice: sl,
            tp1Price: entry + (config.tp.tp1 * pipSize), tp2Price: entry + (config.tp.tp2 * pipSize),
            lots, status: 'OPEN', narrative: lNarr.join('+'), confluenceScore: lScore,
            dayCount: consRed, atMoneyZone: atMZLow, asianTrap: bearTrap, pumpDump: dnP,
            entryHour: utcH, slPips, riskReward: config.tp.tp1 / slPips
          });
          m15Candles = []; tradesToday++;
        }
      }
    }
  }

  const wins = closedTrades.filter(t => (t.profit || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  const growth = ((BALANCE - 100) / 100) * 100;
  return { winRate, growth, maxDrawdown: maxDD, balance: BALANCE, trades: closedTrades, equityCurve };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN FORENSICS
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  newsEvents = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'april_news.json'), 'utf-8'));

  console.log('═'.repeat(100));
  console.log('STACEY BURKE TRADE FORENSICS ENGINE');
  console.log('═'.repeat(100));

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Collect all trades with metadata from winning pairs using best config
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n📊 PHASE 1: Collecting trade metadata from all pairs...\n');

  const bestConfigs: Record<string, Config> = {
    GBPCAD:  { engulfPipSize: 1, sessionOnly: true, slMode: '15M_STRUCTURE', tp: { tp1: 50, tp2: 100, be: 30 }, minConfluence: 4, maxTradesPerDay: 1, riskPct: 5 },
    USDJPY:  { engulfPipSize: 1, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 50, tp2: 100, be: 30 }, minConfluence: 4, maxTradesPerDay: 1, riskPct: 5 },
    CHFJPY:  { engulfPipSize: 1, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 50, tp2: 100, be: 30 }, minConfluence: 6, maxTradesPerDay: 1, riskPct: 5 },
    GBPUSD:  { engulfPipSize: 1, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 25, tp2: 50, be: 15 }, minConfluence: 4, maxTradesPerDay: 1, riskPct: 5 },
    GBPCHF:  { engulfPipSize: 1, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 30, tp2: 60, be: 20 }, minConfluence: 6, maxTradesPerDay: 1, riskPct: 5 },
    USDCAD:  { engulfPipSize: 0, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 50, tp2: 100, be: 30 }, minConfluence: 3, maxTradesPerDay: 1, riskPct: 5 },
    EURCAD:  { engulfPipSize: 0, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 50, tp2: 100, be: 30 }, minConfluence: 3, maxTradesPerDay: 1, riskPct: 5 },
    GBPJPY:  { engulfPipSize: 1, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 30, tp2: 60, be: 20 }, minConfluence: 5, maxTradesPerDay: 2, riskPct: 5 },
    EURCHF:  { engulfPipSize: 1, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 30, tp2: 60, be: 20 }, minConfluence: 6, maxTradesPerDay: 1, riskPct: 5 },
    EURUSD:  { engulfPipSize: 1, sessionOnly: true, slMode: '1M_CANDLE', tp: { tp1: 30, tp2: 60, be: 20 }, minConfluence: 5, maxTradesPerDay: 1, riskPct: 5 },
  };

  let allWins: Trade[] = [];
  let allLosses: Trade[] = [];

  for (const pair of PAIRS) {
    const m1 = await loadCandles(path.join(process.cwd(), 'data', pair.file));
    const cfg = bestConfigs[pair.symbol];
    const result = runSim(m1, cfg, pair.pipSize, pair.pipValue, pair.nc);

    const w = result.trades.filter(t => (t.profit || 0) > 0);
    const l = result.trades.filter(t => (t.profit || 0) <= 0);
    allWins.push(...w);
    allLosses.push(...l);

    console.log(`  ${pair.symbol}: ${result.trades.length} trades (${w.length}W / ${l.length}L) | Growth: ${result.growth.toFixed(1)}%`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Analyze winning vs losing trade DNA
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(100));
  console.log('📊 PHASE 2: WINNING vs LOSING TRADE DNA');
  console.log('═'.repeat(100));

  const analyze = (trades: Trade[], label: string) => {
    if (trades.length === 0) { console.log(`\n  ${label}: No trades.`); return; }
    const narratives: Record<string, number> = {};
    let totalConf = 0, totalSLPips = 0, totalRR = 0;
    const hours: Record<number, number> = {};
    let dayCountSum = 0, moneyZoneCount = 0, asianTrapCount = 0, pumpDumpCount = 0;
    let buyCount = 0, sellCount = 0;

    for (const t of trades) {
      totalConf += (t.confluenceScore || 0);
      totalSLPips += (t.slPips || 0);
      totalRR += (t.riskReward || 0);
      dayCountSum += (t.dayCount || 0);
      if (t.atMoneyZone) moneyZoneCount++;
      if (t.asianTrap) asianTrapCount++;
      if (t.pumpDump) pumpDumpCount++;
      if (t.direction === 'BUY') buyCount++; else sellCount++;
      const h = t.entryHour || 0;
      hours[h] = (hours[h] || 0) + 1;
      const n = t.narrative || 'none';
      n.split('+').forEach(p => { narratives[p] = (narratives[p] || 0) + 1; });
    }

    console.log(`\n  ── ${label} (${trades.length} trades) ──`);
    console.log(`  Avg Confluence Score: ${(totalConf / trades.length).toFixed(1)}`);
    console.log(`  Avg SL (pips):        ${(totalSLPips / trades.length).toFixed(1)}`);
    console.log(`  Avg Risk:Reward:      1:${(totalRR / trades.length).toFixed(2)}`);
    console.log(`  Avg Day Count:        ${(dayCountSum / trades.length).toFixed(1)}`);
    console.log(`  Direction:            BUY=${buyCount} (${(buyCount/trades.length*100).toFixed(0)}%) | SELL=${sellCount} (${(sellCount/trades.length*100).toFixed(0)}%)`);
    console.log(`  Money Zone present:   ${moneyZoneCount}/${trades.length} (${(moneyZoneCount/trades.length*100).toFixed(0)}%)`);
    console.log(`  Asian Trap present:   ${asianTrapCount}/${trades.length} (${(asianTrapCount/trades.length*100).toFixed(0)}%)`);
    console.log(`  Pump/Dump present:    ${pumpDumpCount}/${trades.length} (${(pumpDumpCount/trades.length*100).toFixed(0)}%)`);

    console.log(`  Narrative breakdown:`);
    const sorted = Object.entries(narratives).sort((a, b) => b[1] - a[1]);
    for (const [k, v] of sorted) console.log(`    ${k.padEnd(15)} ${v} (${(v/trades.length*100).toFixed(0)}%)`);

    console.log(`  Entry hour distribution:`);
    const hSorted = Object.entries(hours).sort((a, b) => b[1] - a[1]);
    for (const [h, v] of hSorted.slice(0, 5)) console.log(`    ${h.padStart(2)}:00 UTC → ${v} trades`);
  };

  analyze(allWins, 'WINNERS');
  analyze(allLosses, 'LOSERS');

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: TP/SL/Risk Sweep on GBPUSD (best win rate pair)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(100));
  console.log('📊 PHASE 3: FINE-GRAINED TP/SL/RISK SWEEP ON GBPUSD');
  console.log('═'.repeat(100));

  const gbpusdM1 = await loadCandles(path.join(process.cwd(), 'data', 'GBPUSD_M1_202105030000_202605010159.csv'));

  const tpSweep = [
    { tp1: 15, tp2: 30, be: 10 },
    { tp1: 20, tp2: 40, be: 12 },
    { tp1: 25, tp2: 50, be: 15 },
    { tp1: 30, tp2: 60, be: 20 },
    { tp1: 35, tp2: 70, be: 22 },
    { tp1: 40, tp2: 80, be: 25 },
    { tp1: 50, tp2: 100, be: 30 },
  ];
  const riskSweep = [1, 2, 3, 5];
  const confSweep = [3, 4, 5, 6];
  const slSweep: ('1M_CANDLE' | '15M_STRUCTURE')[] = ['1M_CANDLE', '15M_STRUCTURE'];

  type SweepResult = { tp: string; risk: number; conf: number; sl: string; growth: number; wr: number; dd: number; trades: number; score: number };
  const sweepResults: SweepResult[] = [];

  let total = tpSweep.length * riskSweep.length * confSweep.length * slSweep.length;
  let count = 0;

  for (const tp of tpSweep) {
    for (const risk of riskSweep) {
      for (const conf of confSweep) {
        for (const sl of slSweep) {
          const cfg: Config = { engulfPipSize: 1, sessionOnly: true, slMode: sl, tp, minConfluence: conf, maxTradesPerDay: 1, riskPct: risk };
          const r = runSim(gbpusdM1, cfg, 0.0001, 10, ['GBP','USD']);
          // Score: heavily penalize drawdown, reward growth and win rate
          const score = r.growth * 1.5 + r.winRate * 0.5 - r.maxDrawdown * 2;
          sweepResults.push({ tp: `${tp.tp1}/${tp.tp2}`, risk, conf, sl, growth: r.growth, wr: r.winRate, dd: r.maxDrawdown, trades: r.trades.length, score });
          count++;
          if (count % 20 === 0) process.stdout.write(`\r  Progress: ${count}/${total}`);
        }
      }
    }
  }

  sweepResults.sort((a, b) => b.score - a.score);

  console.log(`\n\n  TOP 15 CONFIGURATIONS (Ranked by Growth×1.5 + WinRate×0.5 - Drawdown×2):`);
  console.log(`  ${'TP'.padEnd(8)} ${'Risk%'.padStart(5)} ${'Conf'.padStart(4)} ${'SL'.padEnd(15)} ${'Growth%'.padStart(8)} ${'WR%'.padStart(5)} ${'DD%'.padStart(6)} ${'Trades'.padStart(6)} ${'Score'.padStart(7)}`);
  console.log('  ' + '─'.repeat(80));
  for (const r of sweepResults.slice(0, 15)) {
    const gStr = (r.growth >= 0 ? '+' : '') + r.growth.toFixed(1);
    console.log(`  ${r.tp.padEnd(8)} ${String(r.risk).padStart(5)} ${String(r.conf).padStart(4)} ${r.sl.padEnd(15)} ${gStr.padStart(8)} ${r.wr.toFixed(0).padStart(5)} ${r.dd.toFixed(1).padStart(6)} ${String(r.trades).padStart(6)} ${r.score.toFixed(1).padStart(7)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: Apply the BEST config to ALL pairs
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(100));
  console.log('📊 PHASE 4: APPLYING BEST CONFIG TO ALL PAIRS');
  console.log('═'.repeat(100));

  const best = sweepResults[0];
  const tpParts = best.tp.split('/').map(Number);
  const universalConfig: Config = {
    engulfPipSize: 1, sessionOnly: true, slMode: best.sl as any,
    tp: { tp1: tpParts[0], tp2: tpParts[1], be: Math.round(tpParts[0] * 0.6) },
    minConfluence: best.conf, maxTradesPerDay: 1, riskPct: best.risk
  };

  console.log(`\n  Universal Config: TP=${best.tp} | Risk=${best.risk}% | Conf>=${best.conf} | SL=${best.sl}\n`);

  let portfolioStart = 0, portfolioEnd = 0;

  for (const pair of PAIRS) {
    const m1 = await loadCandles(path.join(process.cwd(), 'data', pair.file));
    const r = runSim(m1, universalConfig, pair.pipSize, pair.pipValue, pair.nc);
    const gStr = (r.growth >= 0 ? '+' : '') + r.growth.toFixed(1);
    console.log(`  ${pair.symbol.padEnd(8)} Growth: ${gStr.padStart(7)}% | WR: ${r.winRate.toFixed(0).padStart(3)}% | DD: ${r.maxDrawdown.toFixed(1).padStart(5)}% | Trades: ${r.trades.length}`);
    portfolioStart += 100;
    portfolioEnd += r.balance;
  }

  console.log('\n  ' + '─'.repeat(80));
  console.log(`  PORTFOLIO: $${portfolioStart} → $${portfolioEnd.toFixed(2)} (${((portfolioEnd - portfolioStart)/portfolioStart*100).toFixed(1)}% growth)`);
  console.log('═'.repeat(100));
}

main().catch(console.error);
