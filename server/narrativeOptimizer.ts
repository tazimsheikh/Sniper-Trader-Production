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
  narrative?: string;
}

interface Config {
  engulfPipSize: number;
  sessionOnly: boolean;
  slMode: '1M_CANDLE' | '15M_STRUCTURE';
  tp: { tp1: number; tp2: number; be: number };
  minConfluence: number;
  maxTradesPerDay: number;
}

interface PairResult {
  pair: string;
  bestConfig: Config;
  winRate: number;
  growth: number;
  maxDrawdown: number;
  balance: number;
  totalTrades: number;
  wins: number;
  losses: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAIR DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════
const PAIRS: { symbol: string; file: string; pipSize: number; pipValue: number; newsCurrencies: string[] }[] = [
  { symbol: 'AUDJPY', file: 'AUDJPY_M1_202105030005_202605010159.csv', pipSize: 0.01, pipValue: 10, newsCurrencies: ['AUD','JPY'] },
  { symbol: 'AUDUSD', file: 'AUDUSD_M1_202105030005_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['AUD','USD'] },
  { symbol: 'CHFJPY', file: 'CHFJPY_M1_202105030006_202605010159.csv', pipSize: 0.01, pipValue: 10, newsCurrencies: ['CHF','JPY'] },
  { symbol: 'EURAUD', file: 'EURAUD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['EUR','AUD'] },
  { symbol: 'EURCAD', file: 'EURCAD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['EUR','CAD'] },
  { symbol: 'EURCHF', file: 'EURCHF_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['EUR','CHF'] },
  { symbol: 'EURJPY', file: 'EURJPY_M1_202105030000_202605010159.csv', pipSize: 0.01, pipValue: 10, newsCurrencies: ['EUR','JPY'] },
  { symbol: 'EURUSD', file: 'EURUSD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['EUR','USD'] },
  { symbol: 'GBPAUD', file: 'GBPAUD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['GBP','AUD'] },
  { symbol: 'GBPCAD', file: 'GBPCAD_M1_202105030006_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['GBP','CAD'] },
  { symbol: 'GBPCHF', file: 'GBPCHF_M1_202105030006_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['GBP','CHF'] },
  { symbol: 'GBPJPY', file: 'GBPJPY_M1_202105030006_202605010159.csv', pipSize: 0.01, pipValue: 10, newsCurrencies: ['GBP','JPY'] },
  { symbol: 'GBPUSD', file: 'GBPUSD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['GBP','USD'] },
  { symbol: 'NZDUSD', file: 'NZDUSD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['NZD','USD'] },
  { symbol: 'USDCAD', file: 'USDCAD_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['USD','CAD'] },
  { symbol: 'USDCHF', file: 'USDCHF_M1_202105030000_202605010159.csv', pipSize: 0.0001, pipValue: 10, newsCurrencies: ['USD','CHF'] },
  { symbol: 'USDJPY', file: 'USDJPY_M1_202105030000_202605010159.csv', pipSize: 0.01, pipValue: 10, newsCurrencies: ['USD','JPY'] },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const START_DATE = new Date('2026-02-01T00:00:00Z').getTime();
const END_DATE   = new Date('2026-04-30T23:59:59Z').getTime();
const RISK_PCT = 5;
const SPREAD_PIPS = 2.0;
const SLIPPAGE_PIPS = 0.5;

let newsEvents: any[] = [];

// ═══════════════════════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════════════════════
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
    candles.push({
      time: timestamp, dateStr: new Date(timestamp).toISOString(),
      open: parseFloat(parts[2]), high: parseFloat(parts[3]),
      low: parseFloat(parts[4]), close: parseFloat(parts[5])
    });
  }
  return candles;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NARRATIVE SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
function runSimulation(m1Data: Candle[], config: Config, pipSize: number, pipValue: number, newsCurrencies: string[]) {
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

  // ── Asian session tracking (resets daily) ──
  let asianDayStr = '';
  let asianHigh = -Infinity, asianLow = Infinity;
  let asianBreachedHigh = false, asianBreachedLow = false;

  // ── London first hour tracking ──
  let londonDayStr = '';
  let londonFirstHourOpen = 0, londonFirstHourClose = 0;
  let londonFirstHourSet = false;

  // ── Trade-per-day tracking ──
  let tradeDayStr = '';
  let tradesToday = 0;

  for (let cIdx = 0; cIdx < m1Data.length; cIdx++) {
    const c = m1Data[cIdx];
    m1Window.push(c);

    const d = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const utcH = d.getUTCHours();
    const utcM = d.getUTCMinutes();

    // ── Build Daily Candles ──
    if (dPart !== currentDayStr) {
      if (currentDayStr !== '' && m1Window.length > 1) {
        dailyCandles.push({ time: new Date(`${currentDayStr}T00:00:00Z`).getTime(), dateStr: currentDayStr, open: dayOpen, high: dayHigh, low: dayLow, close: m1Window[m1Window.length - 2].close });
      }
      currentDayStr = dPart;
      dayOpen = c.open; dayHigh = c.high; dayLow = c.low;
    } else {
      dayHigh = Math.max(dayHigh, c.high); dayLow = Math.min(dayLow, c.low);
    }

    // ── Build M15 Candles ──
    const m15Min = Math.floor(utcM / 15) * 15;
    const m15Str = `${dPart} ${utcH}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '' && m1Window.length > 1) {
        m15Candles.push({ time: m1Window[m1Window.length - 2].time, dateStr: currentM15Str, open: m15Open, high: m15High, low: m15Low, close: m1Window[m1Window.length - 2].close });
      }
      currentM15Str = m15Str;
      m15Open = c.open; m15High = c.high; m15Low = c.low;
    } else {
      m15High = Math.max(m15High, c.high); m15Low = Math.min(m15Low, c.low);
    }

    // ── Asian Session Range (00:00–06:00 UTC) ──
    if (dPart !== asianDayStr) {
      asianDayStr = dPart;
      asianHigh = -Infinity; asianLow = Infinity;
      asianBreachedHigh = false; asianBreachedLow = false;
    }
    if (utcH >= 0 && utcH < 6) {
      asianHigh = Math.max(asianHigh, c.high);
      asianLow = Math.min(asianLow, c.low);
    }
    // Track if price has breached Asian range during London
    if (utcH >= 7 && asianHigh !== -Infinity) {
      if (c.high > asianHigh) asianBreachedHigh = true;
      if (c.low < asianLow) asianBreachedLow = true;
    }

    // ── London First Hour (07:00–08:00 UTC) ──
    if (dPart !== londonDayStr) {
      londonDayStr = dPart;
      londonFirstHourSet = false;
      londonFirstHourOpen = 0; londonFirstHourClose = 0;
    }
    if (utcH === 7 && utcM === 0 && !londonFirstHourSet) {
      londonFirstHourOpen = c.open;
    }
    if (utcH === 7 && utcM === 59) {
      londonFirstHourClose = c.close;
      londonFirstHourSet = true;
    }

    // ── Trade-per-day reset ──
    if (dPart !== tradeDayStr) {
      tradeDayStr = dPart;
      tradesToday = 0;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MANAGE OPEN TRADES
    // ═══════════════════════════════════════════════════════════════════════════
    for (const trade of openTrades) {
      if (trade.status === 'CLOSED_WON' || trade.status === 'CLOSED_LOST' || trade.status === 'TIME_BAILOUT') continue;
      const currentProfitPips = trade.direction === 'BUY' ? (c.close - trade.entryPrice) / pipSize : (trade.entryPrice - c.close) / pipSize;

      let last15MSwingLow = -Infinity, last15MSwingHigh = Infinity;
      if (m15Candles.length >= 3) {
        for (let i = 1; i < m15Candles.length - 1; i++) {
          if (m15Candles[i].low < m15Candles[i - 1].low && m15Candles[i].low < m15Candles[i + 1].low) last15MSwingLow = m15Candles[i].low;
          if (m15Candles[i].high > m15Candles[i - 1].high && m15Candles[i].high > m15Candles[i + 1].high) last15MSwingHigh = m15Candles[i].high;
        }
      }

      const slippageVal = SLIPPAGE_PIPS * pipSize;
      const spreadVal = SPREAD_PIPS * pipSize;
      const ask = c.close + spreadVal;
      const closePrice = trade.direction === 'BUY' ? c.close : ask;

      // SL Hit
      if (trade.direction === 'BUY' && c.low <= trade.slPrice) {
        trade.exitPrice = trade.slPrice - slippageVal;
        trade.exitTime = c.time; trade.pips = (trade.exitPrice - trade.entryPrice) / pipSize;
        trade.profit = trade.pips * pipValue * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE);
        const dd = ((peakBalance - BALANCE) / peakBalance) * 100; maxDD = Math.max(maxDD, dd);
        closedTrades.push(trade);
      } else if (trade.direction === 'SELL' && c.high >= trade.slPrice) {
        trade.exitPrice = trade.slPrice + slippageVal;
        trade.exitTime = c.time; trade.pips = (trade.entryPrice - trade.exitPrice) / pipSize;
        trade.profit = trade.pips * pipValue * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit; peakBalance = Math.max(peakBalance, BALANCE);
        const dd = ((peakBalance - BALANCE) / peakBalance) * 100; maxDD = Math.max(maxDD, dd);
        closedTrades.push(trade);
      } else {
        // TP1
        if (trade.status === 'OPEN') {
          if ((trade.direction === 'BUY' && c.high >= trade.tp1Price) || (trade.direction === 'SELL' && c.low <= trade.tp1Price)) {
            trade.status = 'TP1_HIT';
            trade.lots = trade.lots / 2;
            BALANCE += (config.tp.tp1 * pipValue * trade.lots);
            peakBalance = Math.max(peakBalance, BALANCE);
            trade.slPrice = trade.entryPrice + (trade.direction === 'BUY' ? 2 * pipSize : -2 * pipSize);
          }
        }
        // TP2
        if (trade.status === 'TP1_HIT') {
          if ((trade.direction === 'BUY' && c.high >= trade.tp2Price) || (trade.direction === 'SELL' && c.low <= trade.tp2Price)) {
            trade.exitPrice = trade.tp2Price; trade.exitTime = c.time;
            trade.pips = config.tp.tp2; trade.profit = config.tp.tp2 * pipValue * trade.lots;
            trade.status = 'CLOSED_WON'; BALANCE += trade.profit;
            peakBalance = Math.max(peakBalance, BALANCE);
            closedTrades.push(trade);
          } else {
            // Structural trailing
            const buffer = 1 * pipSize;
            if (trade.direction === 'BUY' && last15MSwingLow !== -Infinity) {
              const tp = last15MSwingLow - buffer;
              if (tp > trade.slPrice && tp < c.close) trade.slPrice = tp;
            } else if (trade.direction === 'SELL' && last15MSwingHigh !== Infinity) {
              const tp = last15MSwingHigh + buffer;
              if (tp < trade.slPrice && tp > c.close) trade.slPrice = tp;
            }
          }
        }
        // Breakeven
        if (trade.status === 'OPEN' && currentProfitPips >= config.tp.be) {
          const buf = 2 * pipSize;
          const beP = trade.direction === 'BUY' ? trade.entryPrice + buf : trade.entryPrice - buf;
          if (trade.direction === 'BUY' && trade.slPrice < trade.entryPrice) trade.slPrice = beP;
          if (trade.direction === 'SELL' && trade.slPrice > trade.entryPrice) trade.slPrice = beP;
        }
        // Time bailout
        const hrsOpen = (c.time - trade.entryTime) / (1000 * 60 * 60);
        if (hrsOpen >= 0.75 && currentProfitPips < 0) {
          trade.exitPrice = closePrice; trade.exitTime = c.time;
          trade.pips = currentProfitPips; trade.profit = currentProfitPips * pipValue * trade.lots;
          trade.status = 'TIME_BAILOUT'; BALANCE += trade.profit;
          const dd = ((peakBalance - BALANCE) / peakBalance) * 100; maxDD = Math.max(maxDD, dd);
          closedTrades.push(trade);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN' || t.status === 'TP1_HIT');

    // ═══════════════════════════════════════════════════════════════════════════
    // LOOK FOR NEW TRADES (NARRATIVE ENGINE)
    // ═══════════════════════════════════════════════════════════════════════════
    if (openTrades.length > 0) continue;
    if (dailyCandles.length < 4) continue;
    if (m15Candles.length < 10) continue;
    if (m1Window.length < 2) continue;
    if (tradesToday >= config.maxTradesPerDay) continue;

    // Session filter
    if (config.sessionOnly) {
      const isLondon = utcH >= 7 && utcH < 11;
      const isNY = utcH >= 12 && utcH < 16;
      if (!isLondon && !isNY) continue;
    }

    // News blackout
    const isNewsBlackout = newsEvents.some(n => {
      const nTime = new Date(n.date).getTime();
      return Math.abs(nTime - c.time) < 5 * 60 * 1000 && newsCurrencies.includes(n.country);
    });
    if (isNewsBlackout) continue;

    // ── Compute 15M structure ──
    let swingHighs: number[] = [], swingLows: number[] = [];
    for (let i = 2; i < m15Candles.length - 1; i++) {
      if (m15Candles[i].high > m15Candles[i - 1].high && m15Candles[i].high > m15Candles[i + 1].high) swingHighs.push(m15Candles[i].high);
      if (m15Candles[i].low < m15Candles[i - 1].low && m15Candles[i].low < m15Candles[i + 1].low) swingLows.push(m15Candles[i].low);
    }
    const last15MC = m15Candles[m15Candles.length - 2];
    const has3PushesUp = swingHighs.length >= 3;
    const has3PushesDown = swingLows.length >= 3;
    let has15M_BOS_Short = swingLows.length > 0 && last15MC.close < swingLows[swingLows.length - 1];
    let has15M_BOS_Long = swingHighs.length > 0 && last15MC.close > swingHighs[swingHighs.length - 1];

    // ── M1 Engulfing ──
    const prevM1 = m1Window[m1Window.length - 2];
    const currM1 = c;
    const bodySize = Math.abs(currM1.close - currM1.open) / pipSize;
    const isBearEngulf = prevM1.close > prevM1.open && currM1.close < currM1.open && currM1.close < prevM1.open && bodySize >= config.engulfPipSize;
    const isBullEngulf = prevM1.close < prevM1.open && currM1.close > currM1.open && currM1.close > prevM1.open && bodySize >= config.engulfPipSize;

    const prevDay = dailyCandles[dailyCandles.length - 2];

    // ═══════════════════════════════════════════════════════════════════════════
    // NARRATIVE FILTER 1: Day Count
    // ═══════════════════════════════════════════════════════════════════════════
    let consecutiveGreen = 0, consecutiveRed = 0;
    for (let i = dailyCandles.length - 1; i >= 0; i--) {
      if (dailyCandles[i].close > dailyCandles[i].open) { consecutiveGreen++; consecutiveRed = 0; }
      else { consecutiveRed++; consecutiveGreen = 0; }
      if (i < dailyCandles.length - 1) break; // only count the streak from the end
    }
    // Actually, count the full streak
    consecutiveGreen = 0; consecutiveRed = 0;
    for (let i = dailyCandles.length - 1; i >= 0; i--) {
      const isGreen = dailyCandles[i].close > dailyCandles[i].open;
      if (i === dailyCandles.length - 1) {
        if (isGreen) consecutiveGreen = 1; else consecutiveRed = 1;
      } else {
        if (isGreen && consecutiveGreen > 0) consecutiveGreen++;
        else if (!isGreen && consecutiveRed > 0) consecutiveRed++;
        else break;
      }
    }

    const day3ShortReversal = consecutiveGreen >= 3;
    const day3LongReversal = consecutiveRed >= 3;

    // ═══════════════════════════════════════════════════════════════════════════
    // NARRATIVE FILTER 2: Money Zone
    // ═══════════════════════════════════════════════════════════════════════════
    const moneyZoneBuffer = 10 * pipSize;
    const atMoneyZoneHigh = c.close >= prevDay.high - moneyZoneBuffer;
    const atMoneyZoneLow = c.close <= prevDay.low + moneyZoneBuffer;

    // ═══════════════════════════════════════════════════════════════════════════
    // NARRATIVE FILTER 3: Asian Trap
    // ═══════════════════════════════════════════════════════════════════════════
    const bullTrap = asianBreachedHigh && asianHigh !== -Infinity && c.close < asianHigh;
    const bearTrap = asianBreachedLow && asianLow !== Infinity && c.close > asianLow;

    // ═══════════════════════════════════════════════════════════════════════════
    // NARRATIVE FILTER 4: Pump & Dump
    // ═══════════════════════════════════════════════════════════════════════════
    let pumpAndDump = false, dumpAndPump = false;
    if (londonFirstHourSet) {
      const londonBullish = londonFirstHourClose > londonFirstHourOpen;
      pumpAndDump = londonBullish && has15M_BOS_Short;
      dumpAndPump = !londonBullish && has15M_BOS_Long;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFLUENCE SCORING
    // ═══════════════════════════════════════════════════════════════════════════

    // ── SHORT SETUP ──
    let shortScore = 0;
    let shortNarrative: string[] = [];
    if (has3PushesUp && has15M_BOS_Short) { shortScore += 2; shortNarrative.push('15M_3Push_BOS'); }
    if (isBearEngulf) { shortScore += 1; shortNarrative.push('M1_Engulf'); }
    if (day3ShortReversal) { shortScore += 3; shortNarrative.push('Day3_Reversal'); }
    if (atMoneyZoneHigh) { shortScore += 2; shortNarrative.push('MoneyZone_High'); }
    if (bullTrap) { shortScore += 3; shortNarrative.push('Asian_BullTrap'); }
    if (pumpAndDump) { shortScore += 2; shortNarrative.push('PumpAndDump'); }

    if (shortScore >= config.minConfluence && isBearEngulf && (has3PushesUp || has15M_BOS_Short)) {
      const entryPrice = c.close - (SPREAD_PIPS * pipSize) - (SLIPPAGE_PIPS * pipSize);
      let slPrice = Math.max(currM1.high, prevM1.high) + (5 * pipSize);
      if (config.slMode === '15M_STRUCTURE' && swingHighs.length > 0) {
        slPrice = swingHighs[swingHighs.length - 1] + (2 * pipSize);
      }
      const slPips = (slPrice - entryPrice) / pipSize;
      if (slPips > 0 && slPips < 100) {
        const lotSize = ((BALANCE * (RISK_PCT / 100)) / slPips) / pipValue;
        if (lotSize >= 0.01) {
          openTrades.push({
            id: `TR_${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice, slPrice,
            tp1Price: entryPrice - (config.tp.tp1 * pipSize), tp2Price: entryPrice - (config.tp.tp2 * pipSize),
            lots: lotSize, status: 'OPEN', narrative: shortNarrative.join('+')
          });
          m15Candles = [];
          tradesToday++;
        }
      }
    }

    // ── LONG SETUP ──
    let longScore = 0;
    let longNarrative: string[] = [];
    if (has3PushesDown && has15M_BOS_Long) { longScore += 2; longNarrative.push('15M_3Push_BOS'); }
    if (isBullEngulf) { longScore += 1; longNarrative.push('M1_Engulf'); }
    if (day3LongReversal) { longScore += 3; longNarrative.push('Day3_Reversal'); }
    if (atMoneyZoneLow) { longScore += 2; longNarrative.push('MoneyZone_Low'); }
    if (bearTrap) { longScore += 3; longNarrative.push('Asian_BearTrap'); }
    if (dumpAndPump) { longScore += 2; longNarrative.push('DumpAndPump'); }

    if (longScore >= config.minConfluence && isBullEngulf && (has3PushesDown || has15M_BOS_Long)) {
      const entryPrice = c.close + (SPREAD_PIPS * pipSize) + (SLIPPAGE_PIPS * pipSize);
      let slPrice = Math.min(currM1.low, prevM1.low) - (5 * pipSize);
      if (config.slMode === '15M_STRUCTURE' && swingLows.length > 0) {
        slPrice = swingLows[swingLows.length - 1] - (2 * pipSize);
      }
      const slPips = (entryPrice - slPrice) / pipSize;
      if (slPips > 0 && slPips < 100) {
        const lotSize = ((BALANCE * (RISK_PCT / 100)) / slPips) / pipValue;
        if (lotSize >= 0.01) {
          openTrades.push({
            id: `TR_${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice, slPrice,
            tp1Price: entryPrice + (config.tp.tp1 * pipSize), tp2Price: entryPrice + (config.tp.tp2 * pipSize),
            lots: lotSize, status: 'OPEN', narrative: longNarrative.join('+')
          });
          m15Candles = [];
          tradesToday++;
        }
      }
    }
  }

  const wins = closedTrades.filter(t => (t.profit || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  const growth = ((BALANCE - 100) / 100) * 100;

  return { winRate, growth, maxDrawdown: maxDD, balance: BALANCE, trades: closedTrades, wins, losses: closedTrades.length - wins };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN OPTIMIZER
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  // Load news
  const newsFile = path.join(process.cwd(), 'april_news.json');
  newsEvents = JSON.parse(fs.readFileSync(newsFile, 'utf-8'));
  console.log(`Loaded ${newsEvents.length} news events.`);

  // Hyperparameter grid
  const engulfSizes = [0, 1.0, 1.5];
  const sessions = [true]; // Session-only was clearly better
  const slModes: ('1M_CANDLE' | '15M_STRUCTURE')[] = ['1M_CANDLE', '15M_STRUCTURE'];
  const tpLevels = [
    { tp1: 25, tp2: 50, be: 15 },
    { tp1: 30, tp2: 60, be: 20 },
    { tp1: 50, tp2: 100, be: 30 }
  ];
  const minConfluences = [3, 4, 5, 6];
  const maxTradesPerDayOptions = [1, 2];

  const configs: Config[] = [];
  for (const engulfPipSize of engulfSizes) {
    for (const sessionOnly of sessions) {
      for (const slMode of slModes) {
        for (const tp of tpLevels) {
          for (const minConfluence of minConfluences) {
            for (const maxTradesPerDay of maxTradesPerDayOptions) {
              configs.push({ engulfPipSize, sessionOnly, slMode, tp, minConfluence, maxTradesPerDay });
            }
          }
        }
      }
    }
  }

  console.log(`Grid size: ${configs.length} configurations per pair.`);
  console.log(`Testing ${PAIRS.length} pairs × ${configs.length} configs = ${PAIRS.length * configs.length} total simulations.\n`);

  const allResults: PairResult[] = [];

  for (const pair of PAIRS) {
    const filePath = path.join(process.cwd(), 'data', pair.file);
    process.stdout.write(`Loading ${pair.symbol}...`);
    const m1Data = await loadCandles(filePath);
    console.log(` ${m1Data.length} candles.`);

    let bestResult: any = null;
    let bestConfig: Config = configs[0];
    let bestGrowth = -Infinity;

    for (let i = 0; i < configs.length; i++) {
      const r = runSimulation(m1Data, configs[i], pair.pipSize, pair.pipValue, pair.newsCurrencies);
      // Rank by: growth first, then win rate, then lower drawdown
      const score = r.growth * 2 + r.winRate - r.maxDrawdown;
      if (score > bestGrowth || bestResult === null) {
        bestGrowth = score;
        bestResult = r;
        bestConfig = configs[i];
      }
    }

    allResults.push({
      pair: pair.symbol, bestConfig, winRate: bestResult.winRate, growth: bestResult.growth,
      maxDrawdown: bestResult.maxDrawdown, balance: bestResult.balance,
      totalTrades: bestResult.trades.length, wins: bestResult.wins, losses: bestResult.losses
    });

    console.log(`  → ${pair.symbol}: Growth=${bestResult.growth.toFixed(1)}% | WR=${bestResult.winRate.toFixed(0)}% | DD=${bestResult.maxDrawdown.toFixed(1)}% | Trades=${bestResult.trades.length} | Conf>=${bestConfig.minConfluence} | TP=${bestConfig.tp.tp1}/${bestConfig.tp.tp2} | SL=${bestConfig.slMode} | MaxTrades/Day=${bestConfig.maxTradesPerDay}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRINT SUMMARY TABLE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n\n' + '═'.repeat(130));
  console.log('STACEY BURKE NARRATIVE ENGINE — 3-MONTH BACKTEST RESULTS (Feb 1 – Apr 30, 2026)');
  console.log('═'.repeat(130));
  console.log(`${'Pair'.padEnd(10)} | ${'Growth%'.padStart(8)} | ${'WinRate%'.padStart(8)} | ${'MaxDD%'.padStart(7)} | ${'Balance'.padStart(9)} | ${'Trades'.padStart(6)} | ${'W'.padStart(3)} | ${'L'.padStart(3)} | ${'MinConf'.padStart(7)} | ${'TP'.padStart(8)} | ${'SL'.padStart(15)} | ${'MaxT/Day'.padStart(8)}`);
  console.log('─'.repeat(130));

  let totalGrowth = 0;
  let pairsWithTrades = 0;

  for (const r of allResults) {
    const growthStr = (r.growth >= 0 ? '+' : '') + r.growth.toFixed(1);
    console.log(
      `${r.pair.padEnd(10)} | ${growthStr.padStart(8)} | ${r.winRate.toFixed(0).padStart(8)} | ${r.maxDrawdown.toFixed(1).padStart(7)} | ${'$' + r.balance.toFixed(2).padStart(8)} | ${String(r.totalTrades).padStart(6)} | ${String(r.wins).padStart(3)} | ${String(r.losses).padStart(3)} | ${String(r.bestConfig.minConfluence).padStart(7)} | ${(r.bestConfig.tp.tp1 + '/' + r.bestConfig.tp.tp2).padStart(8)} | ${r.bestConfig.slMode.padStart(15)} | ${String(r.bestConfig.maxTradesPerDay).padStart(8)}`
    );
    totalGrowth += r.growth;
    if (r.totalTrades > 0) pairsWithTrades++;
  }

  console.log('─'.repeat(130));
  console.log(`Average Growth: ${(totalGrowth / allResults.length).toFixed(1)}% | Pairs with trades: ${pairsWithTrades}/${allResults.length}`);
  console.log('═'.repeat(130));

  // Save results to JSON for the frontend
  fs.writeFileSync(path.join(process.cwd(), 'public/narrative_backtest_summary.json'), JSON.stringify(allResults, null, 2));
  console.log('\nSaved summary to public/narrative_backtest_summary.json');
}

main().catch(console.error);
