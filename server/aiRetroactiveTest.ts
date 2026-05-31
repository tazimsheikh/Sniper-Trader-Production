import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import path from 'path';

// Disable simulation mode internally so AI is forced to evaluate
process.env.SIMULATION_MODE = 'false';

import { evaluateSignalWithAI } from './aiFilter';
import { TrapSignal, MarketData } from '../src/types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & CONFIG
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
  
  // Market context for AI
  hod?: number; lod?: number;
}

const START_DATE = new Date('2026-04-01T00:00:00Z').getTime();
const END_DATE   = new Date('2026-04-30T23:59:59Z').getTime();
const SPREAD_PIPS = 2.0;
const SLIPPAGE_PIPS = 0.5;

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
// SIMULATION ENGINE (Stripped down pure math bot)
// ═══════════════════════════════════════════════════════════════════════════════
function runSim(m1Data: Candle[], pipSize: number, pipValue: number, symbol: string) {
  const config = { engulfPipSize: 1, sessionOnly: true, slMode: '15M_STRUCTURE', tp: { tp1: 50, tp2: 100, be: 30 }, minConfluence: 4, maxTradesPerDay: 1, riskPct: 5 };
  
  let BALANCE = 100.0;
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

  for (let cIdx = 0; cIdx < m1Data.length; cIdx++) {
    const c = m1Data[cIdx];
    m1Window.push(c);
    if (m1Window.length > 50) m1Window.shift();
    const d = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const utcH = d.getUTCHours();
    const utcM = d.getUTCMinutes();

    if (dPart !== currentDayStr) {
      if (currentDayStr !== '' && m1Window.length > 1) {
        dailyCandles.push({ time: new Date(`${currentDayStr}T00:00:00Z`).getTime(), dateStr: currentDayStr, open: dayOpen, high: dayHigh, low: dayLow, close: m1Window[m1Window.length-2].close });
        if (dailyCandles.length > 50) dailyCandles.shift();
      }
      currentDayStr = dPart; dayOpen = c.open; dayHigh = c.high; dayLow = c.low;
    } else { dayHigh = Math.max(dayHigh, c.high); dayLow = Math.min(dayLow, c.low); }

    const m15Min = Math.floor(utcM / 15) * 15;
    const m15Str = `${dPart} ${utcH}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '' && m1Window.length > 1) {
        m15Candles.push({ time: m1Window[m1Window.length-2].time, dateStr: currentM15Str, open: m15Open, high: m15High, low: m15Low, close: m1Window[m1Window.length-2].close });
        if (m15Candles.length > 200) m15Candles.shift();
      }
      currentM15Str = m15Str; m15Open = c.open; m15High = c.high; m15Low = c.low;
    } else { m15High = Math.max(m15High, c.high); m15Low = Math.min(m15Low, c.low); }

    if (dPart !== asianDayStr) { asianDayStr = dPart; asianHigh = -Infinity; asianLow = Infinity; asianBreachedHigh = false; asianBreachedLow = false; }
    if (utcH >= 0 && utcH < 6) { asianHigh = Math.max(asianHigh, c.high); asianLow = Math.min(asianLow, c.low); }
    if (utcH >= 7 && asianHigh !== -Infinity) { if (c.high > asianHigh) asianBreachedHigh = true; if (c.low < asianLow) asianBreachedLow = true; }

    if (dPart !== londonDayStr) { londonDayStr = dPart; londonFirstHourSet = false; londonFirstHourOpen = 0; londonFirstHourClose = 0; }
    if (utcH === 7 && utcM === 0 && !londonFirstHourSet) londonFirstHourOpen = c.open;
    if (utcH === 7 && utcM === 59) { londonFirstHourClose = c.close; londonFirstHourSet = true; }

    if (dPart !== tradeDayStr) { tradeDayStr = dPart; tradesToday = 0; }

    // ── MANAGE OPEN TRADES ──
    for (const trade of openTrades) {
      if (trade.status === 'CLOSED_WON' || trade.status === 'CLOSED_LOST' || trade.status === 'TIME_BAILOUT') continue;
      const profitPips = trade.direction === 'BUY' ? (c.close - trade.entryPrice)/pipSize : (trade.entryPrice - c.close)/pipSize;
      const slipVal = SLIPPAGE_PIPS * pipSize;
      const spreadVal = SPREAD_PIPS * pipSize;
      const ask = c.close + spreadVal;
      const closePrice = trade.direction === 'BUY' ? c.close : ask;

      if (trade.direction === 'BUY' && c.low <= trade.slPrice) {
        trade.exitPrice = trade.slPrice - slipVal; trade.exitTime = c.time;
        trade.pips = (trade.exitPrice - trade.entryPrice)/pipSize;
        trade.profit = trade.pips * pipValue * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit; closedTrades.push(trade);
      } else if (trade.direction === 'SELL' && c.high >= trade.slPrice) {
        trade.exitPrice = trade.slPrice + slipVal; trade.exitTime = c.time;
        trade.pips = (trade.entryPrice - trade.exitPrice)/pipSize;
        trade.profit = trade.pips * pipValue * trade.lots;
        trade.status = trade.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BALANCE += trade.profit; closedTrades.push(trade);
      } else {
        if (trade.status === 'OPEN') {
          if ((trade.direction === 'BUY' && c.high >= trade.tp1Price) || (trade.direction === 'SELL' && c.low <= trade.tp1Price)) {
            trade.status = 'TP1_HIT';
            const closedLots = trade.lots / 2; trade.lots -= closedLots;
            BALANCE += (config.tp.tp1 * pipValue * closedLots);
            trade.slPrice = trade.entryPrice + (trade.direction==='BUY'? 2*pipSize : -2*pipSize);
          }
        }
        if (trade.status === 'TP1_HIT') {
          if ((trade.direction === 'BUY' && c.high >= trade.tp2Price) || (trade.direction === 'SELL' && c.low <= trade.tp2Price)) {
            trade.exitPrice = trade.tp2Price; trade.exitTime = c.time;
            trade.pips = config.tp.tp2; trade.profit = config.tp.tp2 * pipValue * trade.lots;
            trade.status = 'CLOSED_WON'; BALANCE += trade.profit; closedTrades.push(trade);
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
          trade.status = 'TIME_BAILOUT'; BALANCE += trade.profit; closedTrades.push(trade);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN' || t.status === 'TP1_HIT');

    // ── LOOK FOR NEW TRADES ──
    if (openTrades.length > 0 || dailyCandles.length < 4 || m15Candles.length < 10 || m1Window.length < 2) continue;
    if (tradesToday >= config.maxTradesPerDay) continue;

    const isLon = utcH >= 7 && utcH < 11;
    const isNY = utcH >= 12 && utcH < 16;
    if (!isLon && !isNY) continue;

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

    let consGreen = 0, consRed = 0;
    for (let i = dailyCandles.length - 1; i >= 0; i--) {
      const g = dailyCandles[i].close > dailyCandles[i].open;
      if (i === dailyCandles.length - 1) { if (g) consGreen = 1; else consRed = 1; }
      else { if (g && consGreen > 0) consGreen++; else if (!g && consRed > 0) consRed++; else break; }
    }
    const day3Short = consGreen >= 3;
    const day3Long = consRed >= 3;

    const mzBuf = 10 * pipSize;
    const atMZHigh = c.close >= prevDay.high - mzBuf;
    const atMZLow = c.close <= prevDay.low + mzBuf;

    const bullTrap = asianBreachedHigh && asianHigh !== -Infinity && c.close < asianHigh;
    const bearTrap = asianBreachedLow && asianLow !== Infinity && c.close > asianLow;

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
      const entry = c.close - (SLIPPAGE_PIPS * pipSize); 
      let sl = swingHighs.length > 0 ? swingHighs[swingHighs.length-1] + (2 * pipSize) : c.high + (5*pipSize);
      const slPips = (sl - entry) / pipSize;
      if (slPips > 0 && slPips < 100) {
        const lots = ((BALANCE * (config.riskPct / 100)) / slPips) / pipValue;
        if (lots >= 0.01) {
          openTrades.push({
            id: `TR_${symbol}_${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice: entry, slPrice: sl,
            tp1Price: entry - (config.tp.tp1 * pipSize), tp2Price: entry - (config.tp.tp2 * pipSize),
            lots, status: 'OPEN', narrative: sNarr.join('+'), confluenceScore: sScore,
            dayCount: consGreen, atMoneyZone: atMZHigh, asianTrap: bullTrap, pumpDump: pnD,
            entryHour: utcH, slPips, riskReward: config.tp.tp1 / slPips,
            hod: dayHigh, lod: dayLow
          });
          tradesToday++;
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
      let sl = swingLows.length > 0 ? swingLows[swingLows.length-1] - (2 * pipSize) : c.low - (5*pipSize);
      const slPips = (entry - sl) / pipSize;
      if (slPips > 0 && slPips < 100) {
        const lots = ((BALANCE * (config.riskPct / 100)) / slPips) / pipValue;
        if (lots >= 0.01) {
          openTrades.push({
            id: `TR_${symbol}_${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice: entry, slPrice: sl,
            tp1Price: entry + (config.tp.tp1 * pipSize), tp2Price: entry + (config.tp.tp2 * pipSize),
            lots, status: 'OPEN', narrative: lNarr.join('+'), confluenceScore: lScore,
            dayCount: consRed, atMoneyZone: atMZLow, asianTrap: bearTrap, pumpDump: dnP,
            entryHour: utcH, slPips, riskReward: config.tp.tp1 / slPips,
            hod: dayHigh, lod: dayLow
          });
          tradesToday++;
        }
      }
    }
  }

  return closedTrades;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI RETROACTIVE EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════
async function evaluateHistoricalTradesWithAI(trades: Trade[]) {
  let aiFilteredWins = 0;
  let aiFilteredLosses = 0;
  let aiApprovedWins = 0;
  let aiApprovedLosses = 0;

  console.log(`\n🤖 Launching AI Retroactive Test on ${trades.length} trades for April 2026...\n`);

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const isWin = (t.profit || 0) > 0;
    
    // Extract symbol from ID
    const symbolStr = t.id.split('_')[1] || 'GBPUSD';
    
    // Construct mock objects for the AI filter
    const signal: TrapSignal = {
      id: t.id,
      symbol: symbolStr,
      direction: t.direction,
      pattern: t.narrative || 'Unknown',
      levelType: t.direction === 'SELL' ? 'HOD' : 'LOD',
      keyLevel: t.direction === 'SELL' ? (t.hod || 0) : (t.lod || 0),
      timingGate: t.entryHour! >= 12 ? 'New York Session' : 'London Session',
      triggerPrice: t.entryPrice,
      suggestedStopLoss: t.slPips || 0,
      suggestedTakeProfit: 100, // mock value
      grade: (Math.min(5, Math.max(1, t.confluenceScore || 1)) as 1|2|3|4|5),
      details: `Historical Math Trigger in Backtest`,
      displayName: symbolStr,
      timestamp: new Date(t.entryTime).toISOString()
    };

    const market: MarketData = {
      symbol: symbolStr,
      displayName: symbolStr,
      currentPrice: t.entryPrice,
      open: t.entryPrice, high: t.entryPrice, low: t.entryPrice, prevClose: t.entryPrice,
      hos: t.hod || 0, los: t.lod || 0, how: t.hod || 0, low_week: t.lod || 0,
      change: 0, changePercent: 0, dayOfWeek: 1, dayOfWeekCycle: 1,
      mondayHigh: t.hod || 0, mondayLow: t.lod || 0,
      asianHigh: t.hod || 0, asianLow: t.lod || 0, londonHigh: t.hod || 0, londonLow: t.lod || 0,
      londonOpen: t.entryPrice, londonClose: t.entryPrice, londonNarrative: 'NONE',
      recentDailyCandles: [], lastUpdated: new Date().toISOString(),
      pipSize: 0.0001,
      hod: t.hod || 0, lod: t.lod || 0,
      signalDay: t.dayCount! >= 3 ? 'FRD' : 'Inside Day'
    };

    try {
      const result = await evaluateSignalWithAI(signal, market);
      
      const pnlColor = isWin ? '\x1b[32m' : '\x1b[31m'; // Green/Red
      const aiColor = result.approve ? '\x1b[32mAPPROVED\x1b[0m' : '\x1b[31mREJECTED\x1b[0m';
      
      console.log(`Trade #${i+1}: ${new Date(t.entryTime).toISOString().split('T')[0]} [${symbolStr}] ${t.direction} @ ${t.entryPrice.toFixed(5)}`);
      console.log(`  -> Math Result: ${pnlColor}${(t.profit || 0).toFixed(2)}\x1b[0m (${isWin ? 'WIN' : 'LOSS'})`);
      console.log(`  -> AI Decision: ${aiColor} | ${result.reasoning}`);
      console.log(`-`.repeat(50));

      if (isWin && result.approve) aiApprovedWins++;
      if (isWin && !result.approve) aiFilteredWins++;
      if (!isWin && result.approve) aiApprovedLosses++;
      if (!isWin && !result.approve) aiFilteredLosses++;

      // Sleep to prevent hammering OpenRouter rate limits (approx 500ms)
      await new Promise(r => setTimeout(r, 500));
      
    } catch (e: any) {
      console.error(`Error evaluating trade ${t.id}:`, e.message);
    }
  }

  console.log(`\n\n` + `═`.repeat(60));
  console.log(`📊 AI RETROACTIVE FORENSICS REPORT (10 Pairs - April 2026)`);
  console.log(`═`.repeat(60));
  console.log(`Original Math Strategy: ${aiApprovedWins + aiFilteredWins} Wins / ${aiApprovedLosses + aiFilteredLosses} Losses`);
  console.log(`AI Filter Performance:`);
  console.log(`  ✅ Losses Prevented by AI:      ${aiFilteredLosses} (Good)`);
  console.log(`  ❌ Wins Prevented by AI:        ${aiFilteredWins} (Bad)`);
  console.log(`  🎯 Valid Wins Allowed by AI:    ${aiApprovedWins}`);
  console.log(`  ⚠️ Bad Losses Allowed by AI:    ${aiApprovedLosses}`);
  console.log(`\nResult: AI saved you from ${aiFilteredLosses} bad trades, but cost you ${aiFilteredWins} good trades.`);
}

async function main() {
  let allTrades: Trade[] = [];

  console.log(`Loading data and running Pure Math Simulation for all 10 pairs...`);
  
  for (const pair of PAIRS) {
    const filePath = path.join(process.cwd(), 'data', pair.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[Warning] Skipping ${pair.symbol}: File not found (${filePath})`);
      continue;
    }
    
    const m1 = await loadCandles(filePath);
    const trades = runSim(m1, pair.pipSize, pair.pipValue, pair.symbol);
    
    console.log(`[${pair.symbol}] Math engine found ${trades.length} trades.`);
    allTrades = allTrades.concat(trades);
  }

  if (allTrades.length === 0) {
    console.log(`No trades generated across any pairs in April 2026 for this config.`);
    return;
  }
  
  // Sort all trades by time
  allTrades.sort((a, b) => a.entryTime - b.entryTime);
  
  await evaluateHistoricalTradesWithAI(allTrades);
}

main().catch(console.error);
