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

interface TrapConfig {
  name: string;
  entryType: 'BLIND_1200' | 'M15_CONFIRMATION';
  atrSlMultiplier: number;
  rrMultiplier: number;
  timeBailout: number;
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

function getATR(candles: Candle[], period: number = 14): number {
  if (candles.length <= period) return 0;
  let trSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  return trSum / period;
}

function simTrap(m1: Candle[], cfg: TrapConfig, pip: number, pipV: number) {
  let BAL = 100, peak = 100, maxDD = 0;
  let openTrades: Trade[] = [], closed: Trade[] = [];
  
  const daily: Candle[] = [];
  const m15: Candle[] = [];
  const buf: Candle[] = [];
  
  let curDay = '', curM15 = '';
  let dO = 0, dH = -Infinity, dL = Infinity;
  let mO = 0, mH = -Infinity, mL = Infinity;
  
  // Intraday Session Tracking
  let asianH = -Infinity, asianL = Infinity;
  let londonH = -Infinity, londonL = Infinity;
  let trapSatisfied = false;
  let tradeDirection: 'BUY' | 'SELL' | null = null;
  let tradesToday = 0;

  const m1ByDay: Record<string, Candle[]> = {};

  const RISK = 2; // 2% risk per trade

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
      }
      curDay = dp; dO = c.open; dH = c.high; dL = c.low;
      m1ByDay[curDay] = [];
      
      // Reset daily vars
      asianH = -Infinity; asianL = Infinity;
      londonH = -Infinity; londonL = Infinity;
      trapSatisfied = false;
      tradeDirection = null;
      tradesToday = 0;
      
      // Daily Logic Check
      if (daily.length >= 4) {
        const d3 = daily[daily.length-4];
        const d2 = daily[daily.length-3];
        const d1 = daily[daily.length-2];
        const signal = daily[daily.length-1];

        const d3Red = d3.close < d3.open;
        const d3Green = d3.close > d3.open;
        const d2Red = d2.close < d2.open;
        const d2Green = d2.close > d2.open;
        const d1Red = d1.close < d1.open;
        const d1Green = d1.close > d1.open;
        const sigRed = signal.close < signal.open;
        const sigGreen = signal.close > signal.open;

        const isShortSetup = d3Red && d2Green && d1Green && sigRed;
        const isLongSetup = d3Green && d2Red && d1Red && sigGreen;

        if (isShortSetup) tradeDirection = 'SELL';
        if (isLongSetup) tradeDirection = 'BUY';
      }

    } else { dH = Math.max(dH, c.high); dL = Math.min(dL, c.low); }
    m1ByDay[curDay].push(c);

    // M15 Builder
    const m15m = Math.floor(m / 15) * 15;
    const m15s = `${dp} ${h}:${m15m}`;
    if (m15s !== curM15) {
      if (curM15 && buf.length > 1) {
        m15.push({ time: buf[buf.length-2].time, dateStr: curM15, open: mO, high: mH, low: mL, close: buf[buf.length-2].close });
        if (m15.length > 20) m15.shift();
      }
      curM15 = m15s; mO = c.open; mH = c.high; mL = c.low;
    } else { mH = Math.max(mH, c.high); mL = Math.min(mL, c.low); }

    // ── MANAGE OPEN TRADES ──
    for (const t of openTrades) {
      if (['CLOSED_WON','CLOSED_LOST','TIME_BAILOUT'].includes(t.status)) continue;
      const sv = SLIP * pip, spv = SPREAD * pip;
      
      // Time Bailout
      const minsOpen = (c.time - t.entryTime) / (60 * 1000);
      if (minsOpen >= cfg.timeBailout) {
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
    if (h >= 0 && h < 6) { asianH = Math.max(asianH, c.high); asianL = Math.min(asianL, c.low); }
    if (h >= 7 && h < 12) { londonH = Math.max(londonH, c.high); londonL = Math.min(londonL, c.low); }

    // Trap Check at 12:00
    if (h === 12 && m === 0) {
      if (tradeDirection === 'SELL' && londonH > asianH) trapSatisfied = true; // Bull Trap
      if (tradeDirection === 'BUY' && londonL < asianL) trapSatisfied = true; // Bear Trap
    }

    // ── ENTRY LOGIC ──
    if (!tradeDirection || !trapSatisfied || openTrades.length > 0 || tradesToday > 0 || m15.length < 15) continue;
    if (h < 12 || h >= 16) continue; // Only enter in NY session

    const atr = getATR(m15, 14);
    if (atr === 0) continue;

    let takeTrade = false;

    if (cfg.entryType === 'BLIND_1200') {
      if (h === 12 && m === 0) takeTrade = true;
    } else if (cfg.entryType === 'M15_CONFIRMATION') {
      // Evaluate at the close of an M15 candle
      if (m % 15 === 1) {
        const l15 = m15[m15.length - 1];
        if (tradeDirection === 'SELL' && l15.close < l15.open) takeTrade = true;
        if (tradeDirection === 'BUY' && l15.close > l15.open) takeTrade = true;
      }
    }

    if (takeTrade) {
      const entry = tradeDirection === 'BUY' ? c.close + (SPREAD * pip) + (SLIP * pip) : c.close - (SPREAD * pip) - (SLIP * pip);
      const slPips = (atr * cfg.atrSlMultiplier) / pip;
      
      const sl = tradeDirection === 'BUY' ? entry - (slPips * pip) : entry + (slPips * pip);
      const tp = tradeDirection === 'BUY' ? entry + (slPips * cfg.rrMultiplier * pip) : entry - (slPips * cfg.rrMultiplier * pip);
      
      const lots = ((BAL * (RISK / 100)) / slPips) / pipV;
      if (lots >= 0.01) {
        openTrades.push({ id: `T${c.time}`, direction: tradeDirection, entryTime: c.time, entryPrice: entry, slPrice: sl, tpPrice: tp, lots, status: 'OPEN' });
        tradesToday++;
      }
    }
  }

  const w = closed.filter(t => (t.profit || 0) > 0).length;
  const wr = closed.length > 0 ? (w / closed.length) * 100 : 0;
  const gr = ((BAL - 100) / 100) * 100;
  return { wr, gr, dd: maxDD, trades: closed.length, w, l: closed.length - w };
}

async function main() {
  const configs: TrapConfig[] = [];
  
  const entryOpts: ('BLIND_1200' | 'M15_CONFIRMATION')[] = ['BLIND_1200', 'M15_CONFIRMATION'];
  const atrOpts = [1.0, 1.5, 2.0];
  const rrOpts = [2.0, 3.0, 4.0];
  const timeOpts = [60, 120, 240];

  for (const entry of entryOpts) {
    for (const atr of atrOpts) {
      for (const rr of rrOpts) {
        for (const time of timeOpts) {
          configs.push({
            name: `${entry === 'BLIND_1200' ? 'Blind' : 'M15'} | ATRx${atr.toFixed(1)} RRx${rr.toFixed(1)} Bail${time}m`,
            entryType: entry, atrSlMultiplier: atr, rrMultiplier: rr, timeBailout: time
          });
        }
      }
    }
  }

  console.log('═'.repeat(100));
  console.log(`ASIAN TRAP OPTIMIZER: GRID SEARCH (${configs.length} configs)`);
  console.log('Testing 2-Day Trend -> Signal Reversal -> London Trap -> NY Entry (1-Year Data)');
  console.log('═'.repeat(100));

  const results: Record<string, { totalGrowth: number, totalTrades: number, wins: number, losses: number }> = {};
  for (const c of configs) results[c.name] = { totalGrowth: 0, totalTrades: 0, wins: 0, losses: 0 };

  for (const pair of PAIRS) {
    console.log(`Processing ${pair.s}...`);
    const m1 = await load(path.join(process.cwd(), 'data', pair.f));
    for (const c of configs) {
      const r = simTrap(m1, c, pair.p, pair.pv);
      results[c.name].totalGrowth += r.gr;
      results[c.name].totalTrades += r.trades;
      results[c.name].wins += r.w;
      results[c.name].losses += r.l;
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log('TOP 10 BEST PERFORMING CONFIGURATIONS (Aggregated 5 Pairs)');
  console.log('═'.repeat(100));
  
  const sorted = [...configs]
    .sort((a, b) => results[b.name].totalGrowth - results[a.name].totalGrowth)
    .slice(0, 10);
  
  for (const c of sorted) {
    const r = results[c.name];
    const wr = r.totalTrades > 0 ? (r.wins / r.totalTrades) * 100 : 0;
    const g = (r.totalGrowth >= 0 ? '+' : '') + r.totalGrowth.toFixed(1);
    console.log(`${c.name.padEnd(45)} | Win Rate: ${wr.toFixed(1).padStart(5)}% | Trades: ${String(r.totalTrades).padStart(4)} | Growth: ${g.padStart(8)}%`);
  }
}

main().catch(console.error);
