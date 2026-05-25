import fs from 'fs';
import readline from 'readline';
import path from 'path';

// ════════════════════════════════════════════════════════════════
// XAUUSD 100x STRATEGY FINDER — V2 (Correct broker timezone)
//
// Broker time is EET (UTC+2).
// London Open = 03:00–06:00 EET
// NY Open     = 15:00–18:00 EET (most volatile window)
// Asian Range = 01:00–03:00 EET
// ════════════════════════════════════════════════════════════════

interface Candle { time: number; dateStr: string; timeStr: string; open: number; high: number; low: number; close: number; }
interface Trade { strategy: string; direction: 'BUY'|'SELL'; entryTime: string; entryPrice: number; exitPrice: number; profit: number; pips: number; status: string; lots: number; }

const STARTING_BALANCE = 100.0;

let PIP_SIZE = 0.01;
const PIP_VALUE_PER_LOT = 10;
let SPREAD = 0.20;         // 20 pips realistic Gold spread
const COMMISSION_RT = 7.0;  // $7/lot round trip

function parseLine(line: string): Candle | null {
  const parts = line.split('\t');
  if (parts.length < 6 || parts[0] === '<DATE>') return null;
  const [dateStr, timeStr, open, high, low, close] = parts;
  const time = new Date(`${dateStr.replace(/\./g, '-')}T${timeStr}Z`).getTime();
  return { time, dateStr, timeStr, open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close) };
}

async function loadData(filePath: string): Promise<Candle[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  const out: Candle[] = [];
  for await (const line of rl) { const c = parseLine(line); if (c) out.push(c); }
  return out;
}

function closeTrade(direction: 'BUY'|'SELL', entryPrice: number, exitPrice: number, lots: number, balance: number, strategy: string, entryTime: string, status: string): { trade: Trade; newBalance: number } {
  const pips = direction === 'BUY' ? (exitPrice - entryPrice) / PIP_SIZE : (entryPrice - exitPrice) / PIP_SIZE;
  const profit = pips * PIP_VALUE_PER_LOT * lots - COMMISSION_RT * lots;
  return { trade: { strategy, direction, entryTime, entryPrice, exitPrice, profit, pips, status, lots }, newBalance: balance + profit };
}

// ════════════════════════════════════════════════════════════════
// STRATEGY A: ASIAN RANGE BREAKOUT (Corrected to EET times)
// Asian range = 01:00–03:00 EET. London Open = 03:00–06:00 EET.
// ════════════════════════════════════════════════════════════════
function stratAsianBreakout(candles: Candle[], riskPct: number): { trades: Trade[]; finalBalance: number } {
  let balance = STARTING_BALANCE;
  const trades: Trade[] = [];
  const days: Record<string, Candle[]> = {};
  for (const c of candles) { if (!days[c.dateStr]) days[c.dateStr] = []; days[c.dateStr].push(c); }
  const dateKeys = Object.keys(days).sort();

  for (let d = 0; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const dayCandles = days[dateKeys[d]];

    // Asian range: 01:00–03:00 EET
    const asianC = dayCandles.filter(c => { const h = parseInt(c.timeStr); return h >= 1 && h < 3; });
    if (asianC.length < 20) continue;
    const asianHigh = Math.max(...asianC.map(c => c.high));
    const asianLow  = Math.min(...asianC.map(c => c.low));
    const asianRangePips = (asianHigh - asianLow) / PIP_SIZE;
    if (asianRangePips < 8 || asianRangePips > 150) continue; // Skip outliers

    // London Kill Zone: 03:00–06:00 EET
    const londonC = dayCandles.filter(c => { const h = parseInt(c.timeStr); return h >= 3 && h < 7; });
    let inTrade = false, direction: 'BUY'|'SELL' = 'BUY', entryPrice = 0, entryTime = '', slPrice = 0, tpPrice = 0, lots = 0;
    let highest = 0, lowest = 999999, trailSL = 0;

    for (const c of londonC) {
      if (balance <= 0) break;
      if (!inTrade) {
        if (c.close > asianHigh + SPREAD * 0.5) {
          direction = 'BUY'; entryPrice = c.close + SPREAD;
          const slPips = Math.max(15, asianRangePips * 0.4);
          slPrice = entryPrice - slPips * PIP_SIZE;
          tpPrice = entryPrice + asianRangePips * 1.5 * PIP_SIZE;
          const riskAmount = balance * (riskPct / 100);
          lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
          entryTime = c.timeStr; inTrade = true; highest = c.high; lowest = c.low; trailSL = slPrice;
        } else if (c.close < asianLow - SPREAD * 0.5) {
          direction = 'SELL'; entryPrice = c.close;
          const slPips = Math.max(15, asianRangePips * 0.4);
          slPrice = entryPrice + slPips * PIP_SIZE;
          tpPrice = entryPrice - asianRangePips * 1.5 * PIP_SIZE;
          const riskAmount = balance * (riskPct / 100);
          lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
          entryTime = c.timeStr; inTrade = true; highest = c.high; lowest = c.low; trailSL = slPrice;
        }
      } else {
        highest = Math.max(highest, c.high); lowest = Math.min(lowest, c.low);
        // Trail SL after breakeven
        if (direction === 'BUY') {
          const newTrail = highest - asianRangePips * 0.5 * PIP_SIZE;
          if (newTrail > trailSL) trailSL = newTrail;
          if (c.low <= trailSL) { const r = closeTrade(direction, entryPrice, trailSL, lots, balance, 'ASIAN_BRK', entryTime, trailSL > slPrice ? 'TRAILED' : 'LOST'); balance = r.newBalance; trades.push(r.trade); inTrade = false; }
          else if (c.high >= tpPrice) { const r = closeTrade(direction, entryPrice, tpPrice, lots, balance, 'ASIAN_BRK', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); inTrade = false; }
        } else {
          const newTrail = lowest + asianRangePips * 0.5 * PIP_SIZE;
          if (newTrail < trailSL) trailSL = newTrail;
          if (c.high + SPREAD >= trailSL) { const r = closeTrade(direction, entryPrice, trailSL, lots, balance, 'ASIAN_BRK', entryTime, trailSL < slPrice ? 'TRAILED' : 'LOST'); balance = r.newBalance; trades.push(r.trade); inTrade = false; }
          else if (c.low <= tpPrice) { const r = closeTrade(direction, entryPrice, tpPrice, lots, balance, 'ASIAN_BRK', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); inTrade = false; }
        }
      }
    }
    // Force close at London session end
    if (inTrade && londonC.length > 0) {
      const last = londonC[londonC.length - 1];
      const r = closeTrade(direction, entryPrice, last.close, lots, balance, 'ASIAN_BRK', entryTime, 'TIMEOUT');
      balance = r.newBalance; trades.push(r.trade);
    }
  }
  return { trades, finalBalance: balance };
}

// ════════════════════════════════════════════════════════════════
// STRATEGY B: NY OPEN MOMENTUM (15:00–18:00 EET)
// The highest-volatility window. Trade the direction of the
// biggest candle body at the first 15 minutes of NY open.
// ════════════════════════════════════════════════════════════════
function stratNYMomentum(candles: Candle[], riskPct: number): { trades: Trade[]; finalBalance: number } {
  let balance = STARTING_BALANCE;
  const trades: Trade[] = [];
  const days: Record<string, Candle[]> = {};
  for (const c of candles) { if (!days[c.dateStr]) days[c.dateStr] = []; days[c.dateStr].push(c); }

  for (const dateStr of Object.keys(days).sort()) {
    if (balance <= 0) break;
    const dayCandles = days[dateStr];
    
    // Find the trigger candle: 15:00–15:15 EET (first 15 minutes of NY Open)
    const triggerWindow = dayCandles.filter(c => {
      const h = parseInt(c.timeStr); const m = parseInt(c.timeStr.split(':')[1]);
      return h === 15 && m >= 0 && m <= 15;
    });
    
    if (triggerWindow.length < 5) continue;
    
    // Build a 15-minute composite candle from the window
    const windowOpen  = triggerWindow[0].open;
    const windowHigh  = Math.max(...triggerWindow.map(c => c.high));
    const windowLow   = Math.min(...triggerWindow.map(c => c.low));
    const windowClose = triggerWindow[triggerWindow.length - 1].close;
    const windowRange = (windowHigh - windowLow) / PIP_SIZE;
    const bodySize    = Math.abs(windowClose - windowOpen) / PIP_SIZE;
    
    // Only trade if: strong directional candle (body > 50% of range) AND range > 15 pips
    if (windowRange < 15 || bodySize < windowRange * 0.4) continue;
    
    const direction: 'BUY'|'SELL' = windowClose > windowOpen ? 'BUY' : 'SELL';
    const entryPrice = direction === 'BUY' ? windowClose + SPREAD : windowClose;
    const slPips = windowRange * 0.5 + 10; // SL = half range + buffer
    const slPrice = direction === 'BUY' ? windowLow - 5 * PIP_SIZE : windowHigh + 5 * PIP_SIZE + SPREAD;
    const tpPrice = direction === 'BUY' ? entryPrice + slPips * 2.5 * PIP_SIZE : entryPrice - slPips * 2.5 * PIP_SIZE;
    const riskAmount = balance * (riskPct / 100);
    const lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
    const entryTime = `${dateStr} 15:15`;
    
    // Manage rest of day (15:15–20:00 EET)
    const tradeCandles = dayCandles.filter(c => { const h = parseInt(c.timeStr); return h >= 15 && h < 20; });
    let highest = entryPrice, lowest = entryPrice, trailSL = slPrice;
    let closed = false;
    
    for (const c of tradeCandles) {
      highest = Math.max(highest, c.high); lowest = Math.min(lowest, c.low);
      
      if (direction === 'BUY') {
        // Move trail up as profit grows
        if (highest - entryPrice > slPips * PIP_SIZE) {
          const newTrail = highest - slPips * PIP_SIZE;
          if (newTrail > trailSL) trailSL = newTrail;
        }
        if (c.low <= trailSL) { const r = closeTrade(direction, entryPrice, trailSL, lots, balance, 'NY_MOM', entryTime, trailSL > slPrice ? 'TRAILED' : 'LOST'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
        if (c.high >= tpPrice) { const r = closeTrade(direction, entryPrice, tpPrice, lots, balance, 'NY_MOM', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
      } else {
        if (entryPrice - lowest > slPips * PIP_SIZE) {
          const newTrail = lowest + slPips * PIP_SIZE;
          if (newTrail < trailSL) trailSL = newTrail;
        }
        if (c.high + SPREAD >= trailSL) { const r = closeTrade(direction, entryPrice, trailSL, lots, balance, 'NY_MOM', entryTime, trailSL < slPrice ? 'TRAILED' : 'LOST'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
        if (c.low <= tpPrice) { const r = closeTrade(direction, entryPrice, tpPrice, lots, balance, 'NY_MOM', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
      }
    }
    
    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const r = closeTrade(direction, entryPrice, last.close, lots, balance, 'NY_MOM', entryTime, 'TIMEOUT');
      balance = r.newBalance; trades.push(r.trade);
    }
  }
  return { trades, finalBalance: balance };
}

// ════════════════════════════════════════════════════════════════
// STRATEGY C: LONDON BREAKOUT + NY CONTINUATION
// At London open (03:00 EET), trade the direction of the last
// 4H candle (built from M1). This captures the major daily trend.
// Add to the position if NY confirms the same direction.
// ════════════════════════════════════════════════════════════════
function stratLondonTrend(candles: Candle[], riskPct: number): { trades: Trade[]; finalBalance: number } {
  let balance = STARTING_BALANCE;
  const trades: Trade[] = [];
  const days: Record<string, Candle[]> = {};
  for (const c of candles) { if (!days[c.dateStr]) days[c.dateStr] = []; days[c.dateStr].push(c); }
  const dateKeys = Object.keys(days).sort();

  for (let d = 1; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const todayCandles = days[dateKeys[d]];
    const prevDayCandles = days[dateKeys[d - 1]];
    if (!prevDayCandles || prevDayCandles.length < 60) continue;

    // 4-hour bias: Last 4 hours of previous day (19:00–23:00 EET)
    const prev4h = prevDayCandles.filter(c => { const h = parseInt(c.timeStr); return h >= 19; });
    if (prev4h.length < 20) continue;
    const prevOpen4h  = prev4h[0].open;
    const prevClose4h = prev4h[prev4h.length - 1].close;
    const trend4h: 'BUY'|'SELL' = prevClose4h > prevOpen4h ? 'BUY' : 'SELL';
    const trendStrength = Math.abs(prevClose4h - prevOpen4h) / PIP_SIZE;
    
    // Minimum 15 pip trend to confirm direction
    if (trendStrength < 15) continue;
    
    // Enter at London Open (03:05 EET) in trend direction
    const londonOpen = todayCandles.find(c => {
      const h = parseInt(c.timeStr); const m = parseInt(c.timeStr.split(':')[1]);
      return h === 3 && m >= 5 && m <= 10;
    });
    
    if (!londonOpen) continue;
    
    const entryPrice = trend4h === 'BUY' ? londonOpen.close + SPREAD : londonOpen.close;
    
    // SL = previous overnight low/high
    const prevLow  = Math.min(...prevDayCandles.slice(-60).map(c => c.low));
    const prevHigh = Math.max(...prevDayCandles.slice(-60).map(c => c.high));
    const slPrice  = trend4h === 'BUY' ? prevLow - 5 * PIP_SIZE : prevHigh + 5 * PIP_SIZE + SPREAD;
    const slPips = Math.abs(entryPrice - slPrice) / PIP_SIZE;
    
    if (slPips < 5 || slPips > 80) continue; // Reject extreme SLs
    
    const tpPrice  = trend4h === 'BUY' ? entryPrice + slPips * 2 * PIP_SIZE : entryPrice - slPips * 2 * PIP_SIZE;
    const riskAmount = balance * (riskPct / 100);
    const lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
    const entryTime = `${dateKeys[d]} 03:05`;
    
    // Trade runs all day until TP, SL, or 20:00 EET EOD close
    const tradeCandles = todayCandles.filter(c => { const h = parseInt(c.timeStr); return h >= 3 && h < 21; });
    let highest = entryPrice, lowest = entryPrice, trailSL = slPrice;
    let closed = false;
    
    for (const c of tradeCandles) {
      highest = Math.max(highest, c.high); lowest = Math.min(lowest, c.low);
      
      if (trend4h === 'BUY') {
        if (highest - entryPrice > slPips * 1.0 * PIP_SIZE) {
          const newTrail = highest - slPips * 0.8 * PIP_SIZE;
          if (newTrail > trailSL) trailSL = newTrail;
        }
        if (c.low <= trailSL) { const r = closeTrade('BUY', entryPrice, trailSL, lots, balance, 'LONDON_TREND', entryTime, trailSL > slPrice ? 'TRAILED' : 'LOST'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
        if (c.high >= tpPrice) { const r = closeTrade('BUY', entryPrice, tpPrice, lots, balance, 'LONDON_TREND', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
      } else {
        if (entryPrice - lowest > slPips * 1.0 * PIP_SIZE) {
          const newTrail = lowest + slPips * 0.8 * PIP_SIZE;
          if (newTrail < trailSL) trailSL = newTrail;
        }
        if (c.high + SPREAD >= trailSL) { const r = closeTrade('SELL', entryPrice, trailSL, lots, balance, 'LONDON_TREND', entryTime, trailSL < slPrice ? 'TRAILED' : 'LOST'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
        if (c.low <= tpPrice) { const r = closeTrade('SELL', entryPrice, tpPrice, lots, balance, 'LONDON_TREND', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
      }
    }
    
    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const r = closeTrade(trend4h, entryPrice, last.close, lots, balance, 'LONDON_TREND', entryTime, 'TIMEOUT');
      balance = r.newBalance; trades.push(r.trade);
    }
  }
  return { trades, finalBalance: balance };
}

// ════════════════════════════════════════════════════════════════
// STRATEGY D: GOLD DAILY RANGE FADER (Mean Reversion)
// After Gold has moved > 1.5x its average daily range,
// fade the extension back to the mid-point. Stat arbitrage.
// ════════════════════════════════════════════════════════════════
function stratDailyRangeFader(candles: Candle[], riskPct: number): { trades: Trade[]; finalBalance: number } {
  let balance = STARTING_BALANCE;
  const trades: Trade[] = [];
  const days: Record<string, Candle[]> = {};
  for (const c of candles) { if (!days[c.dateStr]) days[c.dateStr] = []; days[c.dateStr].push(c); }
  const dateKeys = Object.keys(days).sort();
  
  // Track rolling 14-day ADR (average daily range)
  const dailyRanges: number[] = [];
  
  for (let d = 0; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const dayCandles = days[dateKeys[d]];
    const dayHigh = Math.max(...dayCandles.map(c => c.high));
    const dayLow  = Math.min(...dayCandles.map(c => c.low));
    const dayRange = dayHigh - dayLow;
    dailyRanges.push(dayRange);
    
    if (dailyRanges.length < 14) continue;
    
    // ADR = average of last 14 daily ranges
    const adr = dailyRanges.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const adrPips = adr / PIP_SIZE;
    
    // Intraday: look for extensions of > 1.5x ADR during the NY session (15-19 EET)
    const nyCandles = dayCandles.filter(c => { const h = parseInt(c.timeStr); return h >= 15 && h < 19; });
    if (nyCandles.length < 10) continue;
    
    let inTrade = false, direction: 'BUY'|'SELL' = 'BUY', entryPrice = 0, entryTime = '', slPrice = 0, tpPrice = 0, lots = 0;
    let dayHighSoFar = Math.max(...dayCandles.filter(c => parseInt(c.timeStr) < 15).map(c => c.high));
    let dayLowSoFar  = Math.min(...dayCandles.filter(c => parseInt(c.timeStr) < 15).map(c => c.low));
    
    for (const c of nyCandles) {
      if (balance <= 0) break;
      dayHighSoFar = Math.max(dayHighSoFar, c.high);
      dayLowSoFar  = Math.min(dayLowSoFar, c.low);
      
      const currentRange = (dayHighSoFar - dayLowSoFar) / PIP_SIZE;
      
      if (!inTrade && currentRange > adrPips * 1.6) {
        // Range is extended — fade the direction of the last big move
        // If today's high made the extreme, go SELL. If low, go BUY.
        const midDay = (dayHighSoFar + dayLowSoFar) / 2;
        
        if (c.close >= dayHighSoFar - 0.10 && c.close > midDay) {
          direction = 'SELL'; entryPrice = c.close;
          const slPips = 20;
          slPrice = entryPrice + slPips * PIP_SIZE;
          tpPrice = midDay; // Target the midpoint of the day's range
          const riskAmount = balance * (riskPct / 100);
          lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
          entryTime = `${c.dateStr} ${c.timeStr}`; inTrade = true;
        } else if (c.close <= dayLowSoFar + 0.10 && c.close < midDay) {
          direction = 'BUY'; entryPrice = c.close + SPREAD;
          const slPips = 20;
          slPrice = entryPrice - slPips * PIP_SIZE;
          tpPrice = midDay;
          const riskAmount = balance * (riskPct / 100);
          lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
          entryTime = `${c.dateStr} ${c.timeStr}`; inTrade = true;
        }
      } else if (inTrade) {
        if (direction === 'BUY') {
          if (c.low <= slPrice) { const r = closeTrade('BUY', entryPrice, slPrice, lots, balance, 'RANGE_FADER', entryTime, 'LOST'); balance = r.newBalance; trades.push(r.trade); inTrade = false; }
          else if (c.high >= tpPrice) { const r = closeTrade('BUY', entryPrice, tpPrice, lots, balance, 'RANGE_FADER', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); inTrade = false; }
        } else {
          if (c.high + SPREAD >= slPrice) { const r = closeTrade('SELL', entryPrice, slPrice, lots, balance, 'RANGE_FADER', entryTime, 'LOST'); balance = r.newBalance; trades.push(r.trade); inTrade = false; }
          else if (c.low <= tpPrice) { const r = closeTrade('SELL', entryPrice, tpPrice, lots, balance, 'RANGE_FADER', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); inTrade = false; }
        }
      }
    }
    if (inTrade && nyCandles.length > 0) {
      const last = nyCandles[nyCandles.length - 1];
      const r = closeTrade(direction, entryPrice, last.close, lots, balance, 'RANGE_FADER', entryTime, 'TIMEOUT');
      balance = r.newBalance; trades.push(r.trade);
    }
  }
  return { trades, finalBalance: balance };
}

// ════════════════════════════════════════════════════════════════
// STRATEGY E: SNIPER SYSTEM (FALSE BREAK HOD/LOD)
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// STRATEGY: FOREX SMART GRID (Mean Reversion)
// ════════════════════════════════════════════════════════════════
function stratForexExtreme(candles: Candle[], riskPct: number): { trades: Trade[]; finalBalance: number } {
  let balance = STARTING_BALANCE;
  const trades: Trade[] = [];
  
  let gridTrades: any[] = [];
  let gridDir: 'BUY'|'SELL'|null = null;
  let ema50 = 0;
  
  const GRID_STEP = 20; // 20 pips between grid levels
  const GRID_TP = 10;   // 10 pips profit for the whole basket
  const MAX_LEVELS = 6;
  const LOT_MULTIPLIER = 1.5;
  const BASE_LOTS = 0.05; // Fixed small base lot to prevent blowout
  
  for (const c of candles) {
    if (balance <= 0) break;
    if (ema50 === 0) ema50 = c.close;
    else ema50 = c.close * (2/51) + ema50 * (1 - 2/51);
    
    // Manage existing grid
    if (gridTrades.length > 0) {
      let totalLots = 0;
      let totalValue = 0;
      for (const t of gridTrades) {
        totalLots += t.lots;
        totalValue += t.lots * t.entry;
      }
      const avgEntry = totalValue / totalLots;
      
      const currentProfitPips = gridDir === 'BUY' ? (c.close - avgEntry)/PIP_SIZE : (avgEntry - c.close)/PIP_SIZE;
      
      // TP Hit -> Close entire basket
      if (currentProfitPips >= GRID_TP) {
        let totalProfit = 0;
        for (const t of gridTrades) {
          const r = closeTrade(gridDir, t.entry, c.close, t.lots, balance, 'FOREX_GRID', t.entryTime, 'WON');
          balance = r.newBalance; trades.push(r.trade);
          totalProfit += r.trade.profit;
        }
        gridTrades = [];
        gridDir = null;
        continue;
      }
      
      // Stop Loss Hit -> Hard Stop at -150 pips from avg entry to protect account
      if (currentProfitPips <= -150) {
        for (const t of gridTrades) {
          const r = closeTrade(gridDir, t.entry, c.close, t.lots, balance, 'FOREX_GRID', t.entryTime, 'LOST');
          balance = r.newBalance; trades.push(r.trade);
        }
        gridTrades = [];
        gridDir = null;
        continue;
      }
      
      // Add next grid level
      if (gridTrades.length < MAX_LEVELS) {
        const lastTrade = gridTrades[gridTrades.length - 1];
        if (gridDir === 'BUY' && (lastTrade.entry - c.close)/PIP_SIZE >= GRID_STEP) {
          gridTrades.push({ entry: c.close + SPREAD, lots: lastTrade.lots * LOT_MULTIPLIER, entryTime: `${c.dateStr} ${c.timeStr}` });
        } else if (gridDir === 'SELL' && (c.close - lastTrade.entry)/PIP_SIZE >= GRID_STEP) {
          gridTrades.push({ entry: c.close, lots: lastTrade.lots * LOT_MULTIPLIER, entryTime: `${c.dateStr} ${c.timeStr}` });
        }
      }
    } 
    // Enter new grid if flat
    else {
      // Simple mean reversion entry: price pulls far away from 50 EMA
      const distFromEma = Math.abs(c.close - ema50) / PIP_SIZE;
      
      if (distFromEma > 25) { // Stretched
        gridDir = c.close > ema50 ? 'SELL' : 'BUY'; // Fade the move
        const entry = gridDir === 'BUY' ? c.close + SPREAD : c.close;
        gridTrades.push({ entry, lots: BASE_LOTS, entryTime: `${c.dateStr} ${c.timeStr}` });
      }
    }
  }
  
  // Close out open trades at end of dataset
  if (gridTrades.length > 0) {
    const c = candles[candles.length - 1];
    for (const t of gridTrades) {
      const r = closeTrade(gridDir!, t.entry, c.close, t.lots, balance, 'FOREX_GRID', t.entryTime, 'TIMEOUT');
      balance = r.newBalance; trades.push(r.trade);
    }
  }
  
  return { trades, finalBalance: balance };
}

// ════════════════════════════════════════════════════════════════
// OPTIMIZED STRATEGIES FOR NAS100 DRAWDOWN REDUCTION
// ════════════════════════════════════════════════════════════════
function stratLondonTrendOptimized(candles: Candle[], riskPct: number, filterPips: number, useEma: boolean, rr: number): { trades: Trade[]; finalBalance: number } {
  let balance = STARTING_BALANCE;
  const trades: Trade[] = [];
  const days: Record<string, Candle[]> = {};
  for (const c of candles) { if (!days[c.dateStr]) days[c.dateStr] = []; days[c.dateStr].push(c); }
  const dateKeys = Object.keys(days).sort();
  
  let ema200 = 0;

  for (let d = 1; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const todayCandles = days[dateKeys[d]];
    const prevDayCandles = days[dateKeys[d - 1]];
    if (!prevDayCandles || prevDayCandles.length < 60) continue;
    
    // Update simple daily EMA based on previous day close
    const prevClose = prevDayCandles[prevDayCandles.length - 1].close;
    if (ema200 === 0) ema200 = prevClose;
    else ema200 = (prevClose - ema200) * (2 / 201) + ema200;

    const prev4h = prevDayCandles.filter(c => { const h = parseInt(c.timeStr); return h >= 19; });
    if (prev4h.length < 20) continue;
    const prevOpen4h  = prev4h[0].open;
    const prevClose4h = prev4h[prev4h.length - 1].close;
    const trend4h: 'BUY'|'SELL' = prevClose4h > prevOpen4h ? 'BUY' : 'SELL';
    const trendStrength = Math.abs(prevClose4h - prevOpen4h) / PIP_SIZE;
    
    if (trendStrength < filterPips) continue; // Tweakable trend strength filter
    
    const londonOpen = todayCandles.find(c => {
      const h = parseInt(c.timeStr); const m = parseInt(c.timeStr.split(':')[1]);
      return h === 3 && m >= 5 && m <= 10;
    });
    if (!londonOpen) continue;
    
    // EMA Filter
    if (useEma) {
      if (trend4h === 'BUY' && londonOpen.close < ema200) continue;
      if (trend4h === 'SELL' && londonOpen.close > ema200) continue;
    }
    
    const entryPrice = trend4h === 'BUY' ? londonOpen.close + SPREAD : londonOpen.close;
    
    const prevLow  = Math.min(...prevDayCandles.slice(-60).map(c => c.low));
    const prevHigh = Math.max(...prevDayCandles.slice(-60).map(c => c.high));
    const slPrice  = trend4h === 'BUY' ? prevLow - 5 * PIP_SIZE : prevHigh + 5 * PIP_SIZE + SPREAD;
    const slPips = Math.abs(entryPrice - slPrice) / PIP_SIZE;
    
    if (slPips < 5 || slPips > 80) continue;
    
    const tpPrice  = trend4h === 'BUY' ? entryPrice + slPips * rr * PIP_SIZE : entryPrice - slPips * rr * PIP_SIZE;
    const riskAmount = balance * (riskPct / 100);
    const lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
    const entryTime = `${dateKeys[d]} 03:05`;
    
    const tradeCandles = todayCandles.filter(c => { const h = parseInt(c.timeStr); return h >= 3 && h < 21; });
    let highest = entryPrice, lowest = entryPrice, trailSL = slPrice;
    let closed = false;
    
    for (const c of tradeCandles) {
      highest = Math.max(highest, c.high); lowest = Math.min(lowest, c.low);
      
      if (trend4h === 'BUY') {
        // Break-even faster: if in profit by 0.5x SL, move to BE
        if (highest - entryPrice > slPips * 0.5 * PIP_SIZE) {
          if (entryPrice > trailSL) trailSL = entryPrice;
        }
        if (highest - entryPrice > slPips * 1.0 * PIP_SIZE) {
          const newTrail = highest - slPips * 0.8 * PIP_SIZE;
          if (newTrail > trailSL) trailSL = newTrail;
        }
        if (c.low <= trailSL) { const r = closeTrade('BUY', entryPrice, trailSL, lots, balance, 'LONDON_TREND_OPT', entryTime, trailSL >= entryPrice ? 'TRAILED' : 'LOST'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
        if (c.high >= tpPrice) { const r = closeTrade('BUY', entryPrice, tpPrice, lots, balance, 'LONDON_TREND_OPT', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
      } else {
        if (entryPrice - lowest > slPips * 0.5 * PIP_SIZE) {
          if (entryPrice < trailSL) trailSL = entryPrice;
        }
        if (entryPrice - lowest > slPips * 1.0 * PIP_SIZE) {
          const newTrail = lowest + slPips * 0.8 * PIP_SIZE;
          if (newTrail < trailSL) trailSL = newTrail;
        }
        if (c.high + SPREAD >= trailSL) { const r = closeTrade('SELL', entryPrice, trailSL, lots, balance, 'LONDON_TREND_OPT', entryTime, trailSL <= entryPrice ? 'TRAILED' : 'LOST'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
        if (c.low <= tpPrice) { const r = closeTrade('SELL', entryPrice, tpPrice, lots, balance, 'LONDON_TREND_OPT', entryTime, 'WON'); balance = r.newBalance; trades.push(r.trade); closed = true; break; }
      }
    }
    
    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const r = closeTrade(trend4h, entryPrice, last.close, lots, balance, 'LONDON_TREND_OPT', entryTime, 'TIMEOUT');
      balance = r.newBalance; trades.push(r.trade);
    }
  }
  return { trades, finalBalance: balance };
}

// ════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ════════════════════════════════════════════════════════════════
async function main() {
  console.log('Running FOREX EXTREME on All Forex Majors...');
  
  const pairs = [
    { file: 'EURUSD_M1_202105030000_202605010159.csv', name: 'EURUSD', pip: 0.0001, spread: 0.0001 },
    { file: 'GBPUSD_M1_202105030000_202605010159.csv', name: 'GBPUSD', pip: 0.0001, spread: 0.0001 },
    { file: 'AUDUSD_M1_202105030005_202605010159.csv', name: 'AUDUSD', pip: 0.0001, spread: 0.0001 },
    { file: 'NZDUSD_M1_202105030000_202605010159.csv', name: 'NZDUSD', pip: 0.0001, spread: 0.0001 },
    { file: 'USDCAD_M1_202105030000_202605010159.csv', name: 'USDCAD', pip: 0.0001, spread: 0.0001 },
    { file: 'USDCHF_M1_202105030000_202605010159.csv', name: 'USDCHF', pip: 0.0001, spread: 0.0001 },
    { file: 'USDJPY_M1_202105030000_202605010159.csv', name: 'USDJPY', pip: 0.01, spread: 0.01 },
  ];
  
  const allResults: any[] = [];
  const risk = 3; // 3% risk

  for (const pair of pairs) {
    PIP_SIZE = pair.pip;
    SPREAD = pair.spread;
    
    process.stdout.write(`  Testing FOREX EXTREME on ${pair.name} @ ${risk}% risk...\r`);
    const candles = await loadData(path.join(process.cwd(), 'data', pair.file));
    
    const res = stratForexExtreme(candles, risk);
    if (res.trades.length === 0) continue;
    
    const won  = res.trades.filter(t => ['WON','TRAILED'].includes(t.status)).length;
    const lost = res.trades.filter(t => t.status === 'LOST').length;
    const timeouts = res.trades.filter(t => t.status === 'TIMEOUT').length;
    
    const wr = (won + lost + timeouts) > 0 ? (won / (won + lost + timeouts)) * 100 : 0;
    
    let peak = STARTING_BALANCE, bal = STARTING_BALANCE, maxDD = 0, consec = 0, maxConsec = 0;
    for (const t of res.trades) {
      bal += t.profit; if (bal > peak) peak = bal;
      const dd = (peak - bal) / peak * 100; if (dd > maxDD) maxDD = dd;
      if (t.status === 'LOST' || t.profit < 0) { consec++; maxConsec = Math.max(maxConsec, consec); } else consec = 0;
    }
    
    allResults.push({ 
      name: pair.name, 
      risk, 
      finalBalance: res.finalBalance, 
      returnPct: (res.finalBalance - STARTING_BALANCE) / STARTING_BALANCE * 100, 
      trades: res.trades.length, 
      won, lost, timeouts, wr, maxDD, maxConsec 
    });
  }

  allResults.sort((a, b) => b.finalBalance - a.finalBalance);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║    FOREX SNIPER SYSTEM METRICS (TWEAKED)                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  allResults.forEach((r, i) => {
    const flag = r.finalBalance >= 10000 ? '🌌' : r.finalBalance >= 500 ? '🚀' : r.finalBalance >= 100 ? '✅' : '❌';
    console.log(`#${String(i+1).padStart(2)} ${flag}  ${r.name} @ ${r.risk}% risk`);
    console.log(`    Balance: $${r.finalBalance.toFixed(2)} | Return: ${r.returnPct.toFixed(1)}%`);
    console.log(`    Trades: ${r.trades} | WR: ${r.wr.toFixed(1)}% (${r.won}W/${r.lost}L/${r.timeouts}T) | MaxDD: ${r.maxDD.toFixed(1)}% | MaxConsecLoss: ${r.maxConsec}`);
    console.log('');
  });
}

main();
