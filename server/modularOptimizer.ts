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
}

interface DayCountConfig {
  name: string;
  useDayCount: boolean;
  requiredDay: number | null;
  useNarrative: boolean;
  sl: number;
  tp1: number;
  tp2: number;
  timeBailout?: number;
}

const PAIRS = [
  { s: 'AUDJPY', f: 'AUDJPY_M1_202105030005_202605010159.csv', p: 0.01, pv: 10 },
  { s: 'AUDUSD', f: 'AUDUSD_M1_202105030005_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'CHFJPY', f: 'CHFJPY_M1_202105030006_202605010159.csv', p: 0.01, pv: 10 },
  { s: 'EURAUD', f: 'EURAUD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'EURCAD', f: 'EURCAD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'EURCHF', f: 'EURCHF_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'EURJPY', f: 'EURJPY_M1_202105030000_202605010159.csv', p: 0.01, pv: 10 },
  { s: 'EURUSD', f: 'EURUSD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'GBPAUD', f: 'GBPAUD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'GBPCAD', f: 'GBPCAD_M1_202105030006_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'GBPCHF', f: 'GBPCHF_M1_202105030006_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'GBPJPY', f: 'GBPJPY_M1_202105030006_202605010159.csv', p: 0.01, pv: 10 },
  { s: 'GBPUSD', f: 'GBPUSD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'NZDUSD', f: 'NZDUSD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'USDCAD', f: 'USDCAD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'USDCHF', f: 'USDCHF_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'USDJPY', f: 'USDJPY_M1_202105030000_202605010159.csv', p: 0.01, pv: 10 },
];

const START = new Date('2025-05-01T00:00:00Z').getTime();
const END   = new Date('2026-04-30T23:59:59Z').getTime();
const SPREAD = 2.0;
const SLIP = 0.5;

async function load(fp: string): Promise<Candle[]> {
  const c: Candle[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
  let first = true;
  for await (const ln of rl) {
    if (first) { first = false; continue; }
    const p = ln.split('\t');
    if (p.length < 6) continue;
    const dp = p[0].replace(/\./g, '-');
    const t = new Date(`${dp}T${p[1]}Z`).getTime();
    if (t < START) continue;
    if (t > END) break;
    c.push({ time: t, dateStr: new Date(t).toISOString(), open: +p[2], high: +p[3], low: +p[4], close: +p[5] });
  }
  return c;
}

function simDayCount(m1: Candle[], cfg: DayCountConfig, pip: number, pipV: number) {
  let BAL = 100, peak = 100, maxDD = 0;
  let open: Trade[] = [], closed: Trade[] = [];
  let daily: Candle[] = [], m15: Candle[] = [], buf: Candle[] = [];
  let curDay = '', curM15 = '';
  let dO = 0, dH = -Infinity, dL = Infinity;
  let mO = 0, mH = -Infinity, mL = Infinity;
  let tDay = '', tToday = 0;
  let dcShort = 0, dcLong = 0;
  let aH = -Infinity, aL = Infinity;
  let lO = 0, lC = 0;

  // Configurable Trade Management
  const TP1 = cfg.tp1, TP2 = cfg.tp2, MAX_SL = cfg.sl, RISK = 2; 

  for (let i = 0; i < m1.length; i++) {
    const c = m1[i];
    buf.push(c);
    const dt = new Date(c.time);
    const dp = c.dateStr.split('T')[0];
    const h = dt.getUTCHours(), m = dt.getUTCMinutes();

    // Daily
    if (dp !== curDay) {
      if (curDay && buf.length > 1) {
        const closedDay = { time: new Date(`${curDay}T00:00:00Z`).getTime(), dateStr: curDay, open: dO, high: dH, low: dL, close: buf[buf.length-2].close };
        daily.push(closedDay);
        
        if (daily.length >= 2) {
          const prevD = daily[daily.length - 2];
          const currD = closedDay;
          const brokeHigh = currD.high > prevD.high;
          const brokeLow = currD.low < prevD.low;
          const isRed = currD.close < currD.open;
          const isGreen = currD.close > currD.open;
          const insideDay = currD.high <= prevD.high && currD.low >= prevD.low;

          if (insideDay) {
            if (dcShort > 0) dcShort = (dcShort % 3) + 1;
            if (dcLong > 0) dcLong = (dcLong % 3) + 1;
          } else if (brokeHigh && isRed) { dcShort = 1; dcLong = 0; }
          else if (brokeLow && isGreen) { dcLong = 1; dcShort = 0; }
          else if (brokeHigh && currD.close > prevD.high) {
            dcLong = dcLong === 0 ? 1 : (dcLong % 3) + 1; dcShort = 0;
          }
          else if (brokeLow && currD.close < prevD.low) {
            dcShort = dcShort === 0 ? 1 : (dcShort % 3) + 1; dcLong = 0;
          } else {
            if (dcShort > 0) dcShort = (dcShort % 3) + 1;
            if (dcLong > 0) dcLong = (dcLong % 3) + 1;
          }
        }
      }
      curDay = dp; dO = c.open; dH = c.high; dL = c.low;
      aH = -Infinity; aL = Infinity; lO = 0; lC = 0;
    } else { dH = Math.max(dH, c.high); dL = Math.min(dL, c.low); }

    // Track Session Narrative (Asian Range & London 1st Hour)
    if (h >= 0 && h < 6) { aH = Math.max(aH, c.high); aL = Math.min(aL, c.low); }
    if (h === 7) {
      if (m === 0) lO = c.open;
      lC = c.close;
    }

    // M15
    const m15m = Math.floor(m / 15) * 15;
    const m15s = `${dp} ${h}:${m15m}`;
    if (m15s !== curM15) {
      if (curM15 && buf.length > 1) {
        m15.push({ time: buf[buf.length-2].time, dateStr: curM15, open: mO, high: mH, low: mL, close: buf[buf.length-2].close });
        if (m15.length > 100) m15.shift();
      }
      curM15 = m15s; mO = c.open; mH = c.high; mL = c.low;
    } else { mH = Math.max(mH, c.high); mL = Math.min(mL, c.low); }

    // Trades/day
    if (dp !== tDay) { tDay = dp; tToday = 0; }

    // ── MANAGE TRADES ──
    for (const t of open) {
      if (['CLOSED_WON','CLOSED_LOST','TIME_BAILOUT'].includes(t.status)) continue;
      const sv = SLIP * pip, spv = SPREAD * pip;
      const ask = c.close + spv;
      
      // Time Bailout Check
      if (cfg.timeBailout) {
        const minsOpen = (c.time - t.entryTime) / (60 * 1000);
        if (minsOpen >= cfg.timeBailout) {
          t.exitPrice = t.direction === 'BUY' ? c.close - sv : c.close + sv;
          t.exitTime = c.time;
          t.pips = t.direction === 'BUY' ? (t.exitPrice - t.entryPrice)/pip : (t.entryPrice - t.exitPrice)/pip;
          t.profit = t.pips * pipV * t.lots;
          t.status = t.profit > 0 ? 'CLOSED_WON' : 'TIME_BAILOUT';
          BAL += t.profit; peak = Math.max(peak, BAL);
          maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
          continue; // Move to next trade
        }
      }

      if (t.direction === 'BUY' && c.low <= t.slPrice) {
        t.exitPrice = t.slPrice - sv; t.exitTime = c.time;
        t.pips = (t.exitPrice - t.entryPrice)/pip; t.profit = t.pips * pipV * t.lots;
        t.status = t.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BAL += t.profit; peak = Math.max(peak, BAL);
        maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
      } else if (t.direction === 'SELL' && c.high >= t.slPrice) {
        t.exitPrice = t.slPrice + sv; t.exitTime = c.time;
        t.pips = (t.entryPrice - t.exitPrice)/pip; t.profit = t.pips * pipV * t.lots;
        t.status = t.pips >= 0 ? 'CLOSED_WON' : 'CLOSED_LOST';
        BAL += t.profit; peak = Math.max(peak, BAL);
        maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
      } else {
        if (t.status === 'OPEN') {
          if ((t.direction === 'BUY' && c.high >= t.tp1Price) || (t.direction === 'SELL' && c.low <= t.tp1Price)) {
            t.status = 'TP1_HIT'; t.lots /= 2;
            BAL += TP1 * pipV * t.lots; peak = Math.max(peak, BAL);
            t.slPrice = t.entryPrice + (t.direction==='BUY'? 1*pip : -1*pip);
          }
        }
        if (t.status === 'TP1_HIT') {
          if ((t.direction === 'BUY' && c.high >= t.tp2Price) || (t.direction === 'SELL' && c.low <= t.tp2Price)) {
            t.exitPrice = t.tp2Price; t.exitTime = c.time;
            t.pips = TP2; t.profit = TP2 * pipV * t.lots;
            t.status = 'CLOSED_WON'; BAL += t.profit; peak = Math.max(peak, BAL); closed.push(t);
          }
        }
      }
    }
    open = open.filter(t => t.status === 'OPEN' || t.status === 'TP1_HIT');

    // ── ENTRY LOGIC ──
    if (open.length > 0 || daily.length < 4 || m15.length < 10 || buf.length < 2) continue;
    if (tToday >= 1) continue; // 1 trade per day limit

    // Best Timing from Layer 1
    if (h < 7 || h >= 16) continue;

    // 15M structure (Step 5)
    let swHs: number[] = [], swLs: number[] = [];
    for (let j=2; j<m15.length-1; j++) {
      if (m15[j].high > m15[j-1].high && m15[j].high > m15[j+1].high) swHs.push(m15[j].high);
      if (m15[j].low < m15[j-1].low && m15[j].low < m15[j+1].low) swLs.push(m15[j].low);
    }
    const l15 = m15[m15.length - 2];
    const p3U = swHs.length >= 3, p3D = swLs.length >= 3;
    const bosS = swLs.length > 0 && l15.close < swLs[swLs.length-1];
    const bosL = swHs.length > 0 && l15.close > swHs[swHs.length-1];

    // M1 Engulfing (Step 6)
    const prev = buf[buf.length - 2];
    const bs = Math.abs(c.close - c.open) / pip;
    const bearE = prev.close > prev.open && c.close < c.open && c.close < prev.open && bs >= 1;
    const bullE = prev.close < prev.open && c.close > c.open && c.close > prev.open && bs >= 1;

    // Best Money Zone from Layer 3 (Tight ±5 pips)
    const pDay = daily[daily.length - 2];
    const tol = 5 * pip; // TIGHT tolerance
    const nearHigh = c.close >= (pDay.high - tol) && c.close <= (pDay.high + tol);
    const nearLow = c.close <= (pDay.low + tol) && c.close >= (pDay.low - tol);

    // TRUE DAY COUNT GATE (Layer 4) - Stacey Burke Macro Bias
    
    // Today's count is yesterday's count + 1 (unless reset by a new trigger today, but we only have completed daily candles here)
    const todayShort = dcShort > 0 ? (dcShort % 3) + 1 : 0;
    const todayLong = dcLong > 0 ? (dcLong % 3) + 1 : 0;

    const isDay3Short = todayShort === 3;
    const isDay3Long = todayLong === 3;
    const isDay2Short = todayShort === 2;
    const isDay2Long = todayLong === 2;
    const isDay1Short = todayShort === 1;
    const isDay1Long = todayLong === 1;

    // Step 4: Narrative Filters
    const asianRange = aH - aL;
    const asianTrapShort = (asianRange >= 15 * pip) && (dH > aH) && (c.close < aH);
    const pumpAndDump = lC > lO;
    const narrativeShort = asianTrapShort || pumpAndDump;

    const asianTrapLong = (asianRange >= 15 * pip) && (dL < aL) && (c.close > aL);
    const dumpAndPump = lC < lO;
    const narrativeLong = asianTrapLong || dumpAndPump;

    // Short
    if (bearE && p3U && bosS && nearHigh) {
      let allow = true;
      if (cfg.useDayCount) {
        if (cfg.requiredDay === 3 && !isDay3Short) allow = false;
        if (cfg.requiredDay === 2 && !isDay2Short) allow = false;
        if (cfg.requiredDay === 1 && !isDay1Short) allow = false;
      }
      if (cfg.useNarrative && !narrativeShort) allow = false;

      if (allow) {
        const entry = c.close - (SPREAD * pip) - (SLIP * pip);
        const sl = entry + MAX_SL * pip;
        const lots = ((BAL * (RISK / 100)) / MAX_SL) / pipV;
        if (lots >= 0.01) {
          open.push({ id: `T${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice: entry, slPrice: sl, tp1Price: entry - TP1*pip, tp2Price: entry - TP2*pip, lots, status: 'OPEN' });
          m15 = []; tToday++;
        }
      }
    }

    // Long
    if (bullE && p3D && bosL && nearLow) {
      let allow = true;
      if (cfg.useDayCount) {
        if (cfg.requiredDay === 3 && !isDay3Long) allow = false;
        if (cfg.requiredDay === 2 && !isDay2Long) allow = false;
        if (cfg.requiredDay === 1 && !isDay1Long) allow = false;
      }
      if (cfg.useNarrative && !narrativeLong) allow = false;

      if (allow) {
        const entry = c.close + (SPREAD * pip) + (SLIP * pip);
        const sl = entry - MAX_SL * pip;
        const lots = ((BAL * (RISK / 100)) / MAX_SL) / pipV;
        if (lots >= 0.01) {
          open.push({ id: `T${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice: entry, slPrice: sl, tp1Price: entry + TP1*pip, tp2Price: entry + TP2*pip, lots, status: 'OPEN' });
          m15 = []; tToday++;
        }
      }
    }
  }

  const w = closed.filter(t => (t.profit || 0) > 0).length;
  const wr = closed.length > 0 ? (w / closed.length) * 100 : 0;
  const gr = ((BAL - 100) / 100) * 100;
  return { wr, gr, dd: maxDD, trades: closed.length, w, l: closed.length - w };
}

async function main() {
  const configs: DayCountConfig[] = [
    { name: "Layer 3 Baseline (SL:20, TP1:30, TP2:60)", useDayCount: false, requiredDay: null, useNarrative: false, sl: 20, tp1: 30, tp2: 60 },
    { name: "Layer 6: Tight SL (SL:10, TP1:30, TP2:60)", useDayCount: false, requiredDay: null, useNarrative: false, sl: 10, tp1: 30, tp2: 60 },
    { name: "Layer 6: Asymmetric (SL:10, TP1:50, TP2:100)", useDayCount: false, requiredDay: null, useNarrative: false, sl: 10, tp1: 50, tp2: 100 },
    { name: "Layer 6: Time Bailout (SL:20, Bailout:45m)", useDayCount: false, requiredDay: null, useNarrative: false, sl: 20, tp1: 30, tp2: 60, timeBailout: 45 },
    { name: "Layer 6: Extreme Runner (SL:15, TP1:80, TP2:150)", useDayCount: false, requiredDay: null, useNarrative: false, sl: 15, tp1: 80, tp2: 150 }
  ];

  console.log('═'.repeat(100));
  console.log('LAYER 6: TRADE MANAGEMENT OPTIMIZATION (SL / TP / Time Bailout)');
  console.log('═'.repeat(100));

  const results: Record<string, { totalGrowth: number, totalTrades: number, wins: number, losses: number }> = {};
  for (const c of configs) results[c.name] = { totalGrowth: 0, totalTrades: 0, wins: 0, losses: 0 };

  for (const pair of PAIRS) {
    const m1 = await load(path.join(process.cwd(), 'data', pair.f));
    let bestT = '', bestGr = -Infinity, bestWR = 0;

    for (const c of configs) {
      const r = simDayCount(m1, c, pair.p, pair.pv);
      
      results[c.name].totalGrowth += r.gr;
      results[c.name].totalTrades += r.trades;
      results[c.name].wins += r.w;
      results[c.name].losses += r.l;

      if (r.gr > bestGr) { bestGr = r.gr; bestT = c.name; bestWR = r.wr; }
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log('PORTFOLIO RESULTS BY DAY COUNT (Aggregated 17 Pairs)');
  console.log('═'.repeat(100));
  
  const sorted = [...configs].sort((a, b) => results[b.name].totalGrowth - results[a.name].totalGrowth);
  
  for (const c of sorted) {
    const r = results[c.name];
    const wr = r.totalTrades > 0 ? (r.wins / r.totalTrades) * 100 : 0;
    const g = (r.totalGrowth >= 0 ? '+' : '') + r.totalGrowth.toFixed(1);
    console.log(`${c.name.padEnd(45)} | Win Rate: ${wr.toFixed(1).padStart(5)}% | Trades: ${String(r.totalTrades).padStart(4)} | Total Growth: ${g.padStart(8)}%`);
  }
}

main().catch(console.error);
