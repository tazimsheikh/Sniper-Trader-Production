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
const PIP_SIZE = 0.01;
const PIP_VALUE_PER_LOT = 10;
const SPREAD = 0.20;         // 20 pips realistic Gold spread
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
function stratAgressiveCompound(candles: Candle[], riskPct: number, useDynamicSL: boolean, fixedSL: number = 25, rrMultiplier: number = 1.2): { trades: Trade[]; finalBalance: number } {
  let balance = STARTING_BALANCE;
  const trades: Trade[] = [];
  let openTrade: any = null;
  let dailyHistory: any[] = [];
  let currentDayStats: any = null;
  let m1Buffer: Candle[] = [];
  let ema100 = 0, ema3000 = 0;
  let activeSession = 'Gap', sessionStart = 0, hos = -1, los = 999999;

  const TIMEOUT = 45;

  function getGate(h: number, m: number): { name: string; blackout: boolean } {
    // Broker EET times (NY + 7 hours):
    if (h >= 3 && h < 6) return { name: 'Asian', blackout: false };
    if (h >= 9 && h < 12) return { name: 'London', blackout: false };
    if (h >= 15 && h < 18) return { name: 'NY', blackout: false };
    if (h === 15 && m >= 30 && m <= 45) return { name: 'NY', blackout: true };
    return { name: 'Gap', blackout: true };
  }

  for (const candle of candles) {
    if (!currentDayStats || currentDayStats.dateStr !== candle.dateStr) {
      if (currentDayStats) dailyHistory.push(currentDayStats);
      currentDayStats = { dateStr: candle.dateStr, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
    } else {
      currentDayStats.high = Math.max(currentDayStats.high, candle.high);
      currentDayStats.low = Math.min(currentDayStats.low, candle.low);
      currentDayStats.close = candle.close;
    }
    m1Buffer.push(candle); if (m1Buffer.length > 100) m1Buffer.shift();
    if (ema100 === 0) ema100 = candle.close; else ema100 = candle.close * (2/101) + ema100 * (1 - 2/101);
    if (ema3000 === 0) ema3000 = candle.close; else ema3000 = candle.close * (2/3001) + ema3000 * (1 - 2/3001);
    if (balance <= 0) continue;

    if (openTrade) {
      const elapsed = (candle.time - openTrade.startTime) / 60000;
      openTrade.highest = Math.max(openTrade.highest, candle.high);
      openTrade.lowest = Math.min(openTrade.lowest, candle.low);
      let reason = '', exit = 0;

      if (openTrade.dir === 'BUY') {
        if (candle.low <= openTrade.sl) { exit = openTrade.sl; reason = 'LOST'; }
        else if (!openTrade.t1 && candle.high >= openTrade.tp) {
          openTrade.t1 = true;
          const partial = openTrade.t1Pips * PIP_VALUE_PER_LOT * (openTrade.lots / 2);
          balance += partial;
          openTrade.sl = openTrade.entry;
        }
        if (openTrade.t1) {
          const newTrail = openTrade.highest - openTrade.trailPips * PIP_SIZE;
          if (newTrail > openTrade.sl) openTrade.sl = newTrail;
        }
      } else {
        if (candle.high + SPREAD >= openTrade.sl) { exit = openTrade.sl; reason = 'LOST'; }
        else if (!openTrade.t1 && candle.low <= openTrade.tp) {
          openTrade.t1 = true;
          const partial = openTrade.t1Pips * PIP_VALUE_PER_LOT * (openTrade.lots / 2);
          balance += partial;
          openTrade.sl = openTrade.entry;
        }
        if (openTrade.t1) {
          const newTrail = openTrade.lowest + openTrade.trailPips * PIP_SIZE;
          if (newTrail < openTrade.sl) openTrade.sl = newTrail;
        }
      }

      if (elapsed >= TIMEOUT && !openTrade.t1 && reason === '') { exit = candle.close; reason = 'TIMEOUT'; }

      if (reason !== '') {
        const remainingLots = openTrade.t1 ? openTrade.lots / 2 : openTrade.lots;
        const result = closeTrade(openTrade.dir, openTrade.entry, exit, remainingLots, balance, 'SNIPER_SYS', openTrade.entryTime, reason);
        balance = result.newBalance;
        trades.push(result.trade);
        openTrade = null;
      }
      continue;
    }

    const h = parseInt(candle.timeStr), m = parseInt(candle.timeStr.split(':')[1]);
    const gate = getGate(h, m);
    if (gate.name !== activeSession) {
      activeSession = gate.name; sessionStart = candle.time; hos = candle.high; los = candle.low;
    } else if (!gate.blackout && activeSession !== 'Gap') {
      const elapsed = (candle.time - sessionStart) / 60000;
      if (elapsed <= 60) { hos = Math.max(hos, candle.high); los = Math.min(los, candle.low); }
      if (elapsed > 60) {
        if (dailyHistory.length === 0) continue;
        const yesterday = dailyHistory[dailyHistory.length - 1];
        const price = candle.close;
        const isNearHOD = price >= yesterday.high - 15 * PIP_SIZE && price <= yesterday.high + 25 * PIP_SIZE;
        const isNearLOD = price <= yesterday.low + 15 * PIP_SIZE && price >= yesterday.low - 25 * PIP_SIZE;
        const isNearHOS = price >= hos - 10 * PIP_SIZE && price <= hos + 15 * PIP_SIZE;
        const isNearLOS = price <= los + 10 * PIP_SIZE && price >= los - 15 * PIP_SIZE;

        if (isNearHOD || isNearLOD || isNearHOS || isNearLOS) {
          const prev = m1Buffer[m1Buffer.length - 2];
          if (!prev) continue;
          const body = Math.abs(candle.close - candle.open);
          const upper = candle.high - Math.max(candle.open, candle.close);
          const lower = Math.min(candle.open, candle.close) - candle.low;
          const isPinShort = upper > body * 2 && upper > lower;
          const isPinLong  = lower > body * 2 && lower > upper;
          const isEngShort = candle.close < prev.low && candle.open > prev.close;
          const isEngLong  = candle.close > prev.high && candle.open < prev.close;

          let dir: 'BUY'|'SELL'|null = null;
          if (isNearHOD && (isPinShort||isEngShort) && candle.close < ema100 && candle.high > yesterday.high) dir = 'SELL';
          else if (isNearLOD && (isPinLong||isEngLong) && candle.close > ema100 && candle.low < yesterday.low) dir = 'BUY';
          else if (isNearHOS && (isPinShort||isEngShort) && candle.close < ema100 && candle.high > hos) dir = 'SELL';
          else if (isNearLOS && (isPinLong||isEngLong) && candle.close > ema100 && candle.low < los) dir = 'BUY';

          if (dir) {
            if (dir === 'BUY' && price < ema3000) continue;
            if (dir === 'SELL' && price > ema3000) continue;

            let slPips = fixedSL;
            if (useDynamicSL) {
              const recentCandles = m1Buffer.slice(-30);
              const structHigh = Math.max(...recentCandles.map(c => c.high));
              const structLow = Math.min(...recentCandles.map(c => c.low));
              slPips = dir === 'BUY' ? Math.abs(candle.close - structLow) / PIP_SIZE : Math.abs(candle.close - structHigh) / PIP_SIZE;
              slPips = Math.max(100, slPips); // Min 100 pips ($1.00) for Gold
            }

            const t1Pips = slPips * rrMultiplier;
            const trailPips = slPips * 1.5;

            const riskAmount = balance * (riskPct / 100);
            const entry = dir === 'BUY' ? candle.close + SPREAD : candle.close;
            let lots = Math.max(0.01, Math.min(50, Math.round(riskAmount / (slPips * PIP_VALUE_PER_LOT) * 100) / 100));
            const sl = dir === 'BUY' ? entry - slPips * PIP_SIZE : entry + slPips * PIP_SIZE;
            const tp = dir === 'BUY' ? entry + t1Pips * PIP_SIZE : entry - t1Pips * PIP_SIZE;
            
            openTrade = { dir, entry, sl, tp, lots, t1: false, highest: entry, lowest: entry, startTime: candle.time, entryTime: `${candle.dateStr} ${candle.timeStr}`, slPips, t1Pips, trailPips };
          }
        }
      }
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
  console.log('Loading XAUUSD 5-year 1M data for SNIPER MAXIMIZATION...');
  const candles = await loadData(path.join(process.cwd(), 'data', 'XAUUSD_M1_202105030101_202605010159.csv'));
  console.log(`Loaded ${candles.length} candles.\n`);

  const strategies = [
    { name: 'S1: Fixed 100pip SL, 1:1.5 RR', fn: (c, r) => stratAgressiveCompound(c, r, false, 100, 1.5) },
    { name: 'S2: Fixed 200pip SL, 1:1.5 RR', fn: (c, r) => stratAgressiveCompound(c, r, false, 200, 1.5) },
    { name: 'S3: Fixed 300pip SL, 1:1.5 RR', fn: (c, r) => stratAgressiveCompound(c, r, false, 300, 1.5) },
    { name: 'S4: Dynamic SL (Struct), 1:1 RR', fn: (c, r) => stratAgressiveCompound(c, r, true, 0, 1.0) },
    { name: 'S5: Dynamic SL (Struct), 1:2 RR', fn: (c, r) => stratAgressiveCompound(c, r, true, 0, 2.0) },
    { name: 'S6: Dynamic SL (Struct), 1:3 RR', fn: (c, r) => stratAgressiveCompound(c, r, true, 0, 3.0) },
  ];
  
  const riskLevels = [5]; 
  const allResults: any[] = [];

  for (const strat of strategies) {
    for (const risk of riskLevels) {
      process.stdout.write(`  Testing: ${strat.name} @ ${risk}% risk...\r`);
      
      const res = strat.fn(candles, risk);
      if (res.trades.length === 0) continue;
      const won  = res.trades.filter(t => ['WON','TRAILED'].includes(t.status)).length;
      const lost = res.trades.filter(t => t.status === 'LOST').length;
      const wr = (won + lost) > 0 ? (won / (won + lost)) * 100 : 0;
      let peak = STARTING_BALANCE, bal = STARTING_BALANCE, maxDD = 0, consec = 0, maxConsec = 0;
      for (const t of res.trades) {
        bal += t.profit; if (bal > peak) peak = bal;
        const dd = (peak - bal) / peak * 100; if (dd > maxDD) maxDD = dd;
        if (t.status === 'LOST') { consec++; maxConsec = Math.max(maxConsec, consec); } else consec = 0;
      }
      allResults.push({ name: strat.name, risk, finalBalance: res.finalBalance, returnPct: (res.finalBalance - 100) / 100 * 100, trades: res.trades.length, won, lost, wr, maxDD, maxConsec });
    }
  }

  allResults.sort((a, b) => b.finalBalance - a.finalBalance);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║    TRUE SNIPER SYSTEM METRICS (XAUUSD 5-YEAR)                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  allResults.forEach((r, i) => {
    const flag = r.finalBalance >= 1000000 ? '🌌' : r.finalBalance >= 1000 ? '🚀' : '✅';
    console.log(`#${String(i+1).padStart(2)} ${flag}  ${r.name} @ ${r.risk}% risk`);
    console.log(`    Balance: $${r.finalBalance.toFixed(2)} | Return: ${r.returnPct.toFixed(1)}%`);
    console.log(`    Trades: ${r.trades} | WR: ${r.wr.toFixed(1)}% (${r.won}W/${r.lost}L) | MaxDD: ${r.maxDD.toFixed(1)}% | MaxConsecLoss: ${r.maxConsec}`);
    console.log('');
  });
}

main();
