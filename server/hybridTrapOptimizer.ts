import fs from 'fs';
import readline from 'readline';
import path from 'path';

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }
interface Trade {
  id: string; direction: 'BUY' | 'SELL'; entryTime: number; entryPrice: number;
  slPrice: number; tpPrice: number; lots: number;
  status: 'OPEN' | 'CLOSED_WON' | 'CLOSED_LOST' | 'TIME_BAILOUT';
  exitTime?: number; exitPrice?: number; profit?: number; pips?: number;
}

interface HybridConfig {
  name: string;
  maxBoxPips: number;    // Asian box height limit
  minTrapPips: number;   // Minimum breakout distance
  maxTrapPips: number;   // Maximum breakout distance (avoid trends)
  rrMultiplier: number;  // Risk-Reward ratio
  macroFilter: 'EMA20' | 'MOMENTUM3'; // Type of daily macro filter
}

const PAIRS = [
  { s: 'AUDUSD', f: 'AUDUSD_M1_202105030005_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'EURUSD', f: 'EURUSD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'GBPUSD', f: 'GBPUSD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'USDCAD', f: 'USDCAD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10 },
  { s: 'USDJPY', f: 'USDJPY_M1_202105030000_202605010159.csv', p: 0.01, pv: 10 },
];

const START = new Date('2025-05-01T00:00:00Z').getTime();
const END   = new Date('2026-04-30T23:59:59Z').getTime();
const SPREAD = 1.0;
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
    if (t > END) continue;
    c.push({ time: t, dateStr: new Date(t).toISOString(), open: +p[2], high: +p[3], low: +p[4], close: +p[5] });
  }
  return c.sort((a, b) => a.time - b.time);
}

function getEMA(candles: Candle[], period: number = 20): number {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    ema = (candles[i].close * k) + (ema * (1 - k));
  }
  return ema;
}

function simHybrid(m1: Candle[], cfg: HybridConfig, pip: number, pipV: number) {
  let BAL = 100, peak = 100, maxDD = 0;
  let openTrades: Trade[] = [], closed: Trade[] = [];
  
  const m15: Candle[] = [];
  const daily: Candle[] = [];
  const buf: Candle[] = [];
  
  let curDay = '', curM15 = '';
  let dO = 0, dH = -Infinity, dL = Infinity;
  let mO = 0, mH = -Infinity, mL = Infinity;
  
  // Intraday Session Tracking
  let asianH = -Infinity, asianL = Infinity;
  let huntH = -Infinity, huntL = Infinity;
  let trapState: 'NONE' | 'BULL_TRAPPED' | 'BEAR_TRAPPED' = 'NONE';
  let tradesToday = 0;
  let macroTrend: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';

  const m1ByDay: Record<string, Candle[]> = {};
  const RISK = 2; // 2% risk per trade
  const TIME_BAILOUT_MINS = 240; // Fixed 4 hour bailout for NY runs

  for (let i = 0; i < m1.length; i++) {
    const c = m1[i];
    buf.push(c);
    const dt = new Date(c.time);
    const dp = c.dateStr.split('T')[0];
    const h = dt.getUTCHours(), m = dt.getUTCMinutes();

    // Daily Builder
    if (dp !== curDay) {
      if (curDay && m1ByDay[curDay] && m1ByDay[curDay].length > 0) {
        const lastC = m1ByDay[curDay][m1ByDay[curDay].length-1];
        daily.push({ time: new Date(`${curDay}T00:00:00Z`).getTime(), dateStr: curDay, open: dO, high: dH, low: dL, close: lastC.close });
        if (daily.length > 50) daily.shift();
      }
      curDay = dp; dO = c.open; dH = c.high; dL = c.low;
      m1ByDay[curDay] = [];
      
      // Reset daily vars
      asianH = -Infinity; asianL = Infinity;
      huntH = -Infinity; huntL = Infinity;
      trapState = 'NONE';
      tradesToday = 0;
      
      // Calculate Macro Trend at Start of Day
      macroTrend = 'NEUTRAL';
      if (daily.length >= 25) {
        if (cfg.macroFilter === 'EMA20') {
          const dEma20 = getEMA(daily, 20);
          const pClose = daily[daily.length - 1].close;
          macroTrend = pClose > dEma20 ? 'LONG' : 'SHORT';
        } else if (cfg.macroFilter === 'MOMENTUM3') {
          const d1 = daily[daily.length - 1];
          const d2 = daily[daily.length - 2];
          const d3 = daily[daily.length - 3];
          if (d1.close > d2.close && d2.close > d3.close) macroTrend = 'LONG';
          else if (d1.close < d2.close && d2.close < d3.close) macroTrend = 'SHORT';
        }
      }
    } else { dH = Math.max(dH, c.high); dL = Math.min(dL, c.low); }
    m1ByDay[curDay].push(c);

    // M15 Builder
    const m15m = Math.floor(m / 15) * 15;
    const m15s = `${dp} ${h}:${m15m}`;
    if (m15s !== curM15) {
      if (curM15 && buf.length > 1) {
        m15.push({ time: buf[buf.length-2].time, dateStr: curM15, open: mO, high: mH, low: mL, close: buf[buf.length-2].close });
        if (m15.length > 50) m15.shift(); // keep 50 for EMA
      }
      curM15 = m15s; mO = c.open; mH = c.high; mL = c.low;
    } else { mH = Math.max(mH, c.high); mL = Math.min(mL, c.low); }

    // ── MANAGE OPEN TRADES ──
    for (const t of openTrades) {
      if (['CLOSED_WON','CLOSED_LOST', 'TIME_BAILOUT'].includes(t.status)) continue;
      const sv = SLIP * pip, spv = SPREAD * pip;

      const minsOpen = (c.time - t.entryTime) / (60 * 1000);
      if (minsOpen >= TIME_BAILOUT_MINS) {
        t.exitPrice = t.direction === 'BUY' ? c.close - sv : c.close + sv;
        t.exitTime = c.time;
        t.pips = t.direction === 'BUY' ? (t.exitPrice - t.entryPrice)/pip : (t.entryPrice - t.exitPrice)/pip;
        t.profit = t.pips * pipV * t.lots;
        t.status = t.profit > 0 ? 'CLOSED_WON' : 'TIME_BAILOUT';
        BAL += t.profit; peak = Math.max(peak, BAL); maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
        continue;
      }

      if (t.direction === 'BUY') {
        if (c.low <= t.slPrice) {
          t.exitPrice = t.slPrice - sv; t.exitTime = c.time;
          t.pips = (t.exitPrice - t.entryPrice)/pip; t.profit = t.pips * pipV * t.lots;
          t.status = 'CLOSED_LOST'; BAL += t.profit; peak = Math.max(peak, BAL); maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
        } else if (c.high >= t.tpPrice) {
          t.exitPrice = t.tpPrice; t.exitTime = c.time;
          t.pips = (t.exitPrice - t.entryPrice)/pip; t.profit = t.pips * pipV * t.lots;
          t.status = 'CLOSED_WON'; BAL += t.profit; peak = Math.max(peak, BAL); closed.push(t);
        }
      } else {
        if (c.high >= t.slPrice) {
          t.exitPrice = t.slPrice + sv; t.exitTime = c.time;
          t.pips = (t.entryPrice - t.exitPrice)/pip; t.profit = t.pips * pipV * t.lots;
          t.status = 'CLOSED_LOST'; BAL += t.profit; peak = Math.max(peak, BAL); maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
        } else if (c.low <= t.tpPrice) {
          t.exitPrice = t.tpPrice; t.exitTime = c.time;
          t.pips = (t.entryPrice - t.exitPrice)/pip; t.profit = t.pips * pipV * t.lots;
          t.status = 'CLOSED_WON'; BAL += t.profit; peak = Math.max(peak, BAL); closed.push(t);
        }
      }
    }
    openTrades = openTrades.filter(t => t.status === 'OPEN');

    // ── INTRADAY MAPPING ──
    if (h >= 0 && h < 6) { 
      asianH = Math.max(asianH, c.high); asianL = Math.min(asianL, c.low); 
    }
    
    // Stop Hunt Window (07:00 - 14:00 UTC)
    if (h >= 7 && h < 14) { 
      huntH = Math.max(huntH, c.high); huntL = Math.min(huntL, c.low); 

      // 1. Box Filter
      const boxPips = (asianH - asianL) / pip;
      if (asianH > -Infinity && boxPips <= cfg.maxBoxPips) {
        
        // 2. Trap Detection (HYBRID ALIGNMENT)
        if (trapState === 'NONE') {
          const bullTrapDist = (huntH - asianH) / pip;
          const bearTrapDist = (asianL - huntL) / pip;
          
          // Macro is SHORT -> Only look for BULL TRAPS (Short entries)
          if (macroTrend === 'SHORT' && bullTrapDist >= cfg.minTrapPips && bullTrapDist <= cfg.maxTrapPips) {
             trapState = 'BULL_TRAPPED';
          } 
          // Macro is LONG -> Only look for BEAR TRAPS (Long entries)
          else if (macroTrend === 'LONG' && bearTrapDist >= cfg.minTrapPips && bearTrapDist <= cfg.maxTrapPips) {
             trapState = 'BEAR_TRAPPED';
          }
        }
      }
    }

    // ── ENTRY LOGIC (LOCK-IN) ──
    if (trapState === 'NONE' || openTrades.length > 0 || tradesToday > 0 || m15.length < 25) continue;
    if (h < 7 || h >= 16) continue;

    // Evaluate Lock-In at M15 close
    if (m % 15 === 14) { 
      const l15 = m15[m15.length - 1];
      const ema20 = getEMA(m15, 20);

      let takeTrade = false;
      let tradeDirection: 'BUY' | 'SELL' | null = null;
      let structuralSl = 0;

      if (trapState === 'BULL_TRAPPED') {
        const lockedIn = c.close < asianH; // Close back inside box
        const emaConf = c.close < ema20;    // Cross 20 EMA

        if (lockedIn && emaConf && l15.close < l15.open) { 
          takeTrade = true;
          tradeDirection = 'SELL';
          structuralSl = huntH + (2 * pip); 
        }
      }

      if (trapState === 'BEAR_TRAPPED') {
        const lockedIn = c.close > asianL; // Close back inside box
        const emaConf = c.close > ema20;    // Cross 20 EMA

        if (lockedIn && emaConf && l15.close > l15.open) { 
          takeTrade = true;
          tradeDirection = 'BUY';
          structuralSl = huntL - (2 * pip); 
        }
      }

      if (takeTrade && tradeDirection) {
        const entry = tradeDirection === 'BUY' ? c.close + (SPREAD * pip) + (SLIP * pip) : c.close - (SPREAD * pip) - (SLIP * pip);
        const slPips = Math.abs(entry - structuralSl) / pip;
        
        if (slPips < 5 || slPips > 50) continue;

        const sl = structuralSl;
        const tp = tradeDirection === 'BUY' ? entry + (slPips * cfg.rrMultiplier * pip) : entry - (slPips * cfg.rrMultiplier * pip);
        
        const lots = ((BAL * (RISK / 100)) / slPips) / pipV;
        if (lots >= 0.01) {
          openTrades.push({ id: `T${c.time}`, direction: tradeDirection, entryTime: c.time, entryPrice: entry, slPrice: sl, tpPrice: tp, lots, status: 'OPEN' });
          tradesToday++;
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
  const configs: HybridConfig[] = [];
  
  const boxOpts = [20, 30];
  const trapMaxOpts = [20, 35];
  const rrOpts = [2.0, 3.0, 4.0];
  const macroOpts: ('EMA20' | 'MOMENTUM3')[] = ['EMA20', 'MOMENTUM3'];

  for (const box of boxOpts) {
    for (const trapMax of trapMaxOpts) {
      for (const rr of rrOpts) {
        for (const macro of macroOpts) {
          configs.push({
            name: `${macro} | Box<${box}p Trap<${trapMax}p RR${rr.toFixed(1)}`,
            maxBoxPips: box,
            minTrapPips: 5,
            maxTrapPips: trapMax,
            rrMultiplier: rr,
            macroFilter: macro
          });
        }
      }
    }
  }

  console.log('═'.repeat(100));
  console.log(`HYBRID TRAP OPTIMIZER: GRID SEARCH (${configs.length} configs)`);
  console.log('Testing Macro Daily Trend + Micro Intraday Asian Box Trap (1-Year Data)');
  console.log('═'.repeat(100));

  const results: Record<string, { totalGrowth: number, totalTrades: number, wins: number, losses: number, pairs: Record<string, {growth: number, trades: number, wins: number}> }> = {};
  for (const c of configs) results[c.name] = { totalGrowth: 0, totalTrades: 0, wins: 0, losses: 0, pairs: {} };

  for (const pair of PAIRS) {
    console.log(`Processing ${pair.s}...`);
    const m1 = await load(path.join(process.cwd(), 'data', pair.f));
    for (const c of configs) {
      const r = simHybrid(m1, c, pair.p, pair.pv);
      results[c.name].totalGrowth += r.gr;
      results[c.name].totalTrades += r.trades;
      results[c.name].wins += r.w;
      results[c.name].losses += r.l;
      results[c.name].pairs[pair.s] = { growth: r.gr, trades: r.trades, wins: r.w };
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log('TOP CONFIGURATIONS & PER-PAIR BREAKDOWN');
  console.log('═'.repeat(100));
  
  const sorted = [...configs]
    .sort((a, b) => results[b.name].totalGrowth - results[a.name].totalGrowth)
    .slice(0, 5); // Just show top 5 so we don't spam the console
  
  for (const c of sorted) {
    const r = results[c.name];
    const wr = r.totalTrades > 0 ? (r.wins / r.totalTrades) * 100 : 0;
    const g = (r.totalGrowth >= 0 ? '+' : '') + r.totalGrowth.toFixed(1);
    console.log(`\n${c.name.padEnd(45)} | TOTAL WR: ${wr.toFixed(1).padStart(5)}% | TRADES: ${String(r.totalTrades).padStart(3)} | GROWTH: ${g.padStart(7)}%`);
    console.log('-'.repeat(100));
    for (const pair of PAIRS) {
      const pr = r.pairs[pair.s];
      const pwr = pr.trades > 0 ? (pr.wins / pr.trades) * 100 : 0;
      const pg = (pr.growth >= 0 ? '+' : '') + pr.growth.toFixed(1);
      console.log(`  -> ${pair.s} | Win Rate: ${pwr.toFixed(1).padStart(5)}% | Trades: ${String(pr.trades).padStart(3)} | Growth: ${pg.padStart(6)}%`);
    }
  }
}

main().catch(console.error);
