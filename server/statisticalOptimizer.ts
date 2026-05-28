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

interface StatConfig {
  name: string;
  rsiThreshold: number; // 70, 75, 80
  atrSlMultiplier: number; // 1.0, 1.5, 2.0
  rrMultiplier: number; // 1.5, 2.0, 3.0
  timeBailout: number; // 45 minutes
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
    if (t > END) break;
    c.push({ time: t, dateStr: new Date(t).toISOString(), open: +p[2], high: +p[3], low: +p[4], close: +p[5] });
  }
  return c;
}

// Indicator Helpers
function getRSI(candles: Candle[], period: number = 14): number {
  if (candles.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
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

function simStatistical(m1: Candle[], cfg: StatConfig, pip: number, pipV: number) {
  let BAL = 100, peak = 100, maxDD = 0;
  let open: Trade[] = [], closed: Trade[] = [];
  let daily: Candle[] = [], m15: Candle[] = [], buf: Candle[] = [];
  let curDay = '', curM15 = '';
  let dO = 0, dH = -Infinity, dL = Infinity;
  let mO = 0, mH = -Infinity, mL = Infinity;
  let tDay = '', tToday = 0;

  const RISK = 2; // 2% risk per trade

  for (let i = 0; i < m1.length; i++) {
    const c = m1[i];
    buf.push(c);
    const dt = new Date(c.time);
    const dp = c.dateStr.split('T')[0];
    const h = dt.getUTCHours(), m = dt.getUTCMinutes();

    // Daily
    if (dp !== curDay) {
      if (curDay && buf.length > 1) {
        daily.push({ time: new Date(`${curDay}T00:00:00Z`).getTime(), dateStr: curDay, open: dO, high: dH, low: dL, close: buf[buf.length-2].close });
      }
      curDay = dp; dO = c.open; dH = c.high; dL = c.low;
    } else { dH = Math.max(dH, c.high); dL = Math.min(dL, c.low); }

    // M15
    const m15m = Math.floor(m / 15) * 15;
    const m15s = `${dp} ${h}:${m15m}`;
    if (m15s !== curM15) {
      if (curM15 && buf.length > 1) {
        m15.push({ time: buf[buf.length-2].time, dateStr: curM15, open: mO, high: mH, low: mL, close: buf[buf.length-2].close });
        if (m15.length > 20) m15.shift(); // Keep only last 20 for RSI(14) and ATR(14)
      }
      curM15 = m15s; mO = c.open; mH = c.high; mL = c.low;
    } else { mH = Math.max(mH, c.high); mL = Math.min(mL, c.low); }

    // Trades/day
    if (dp !== tDay) { tDay = dp; tToday = 0; }

    // ── MANAGE TRADES ──
    for (const t of open) {
      if (['CLOSED_WON','CLOSED_LOST','TIME_BAILOUT'].includes(t.status)) continue;
      const sv = SLIP * pip, spv = SPREAD * pip;
      
      // Time Bailout Check
      const minsOpen = (c.time - t.entryTime) / (60 * 1000);
      if (minsOpen >= cfg.timeBailout) {
        t.exitPrice = t.direction === 'BUY' ? c.close - sv : c.close + sv;
        t.exitTime = c.time;
        t.pips = t.direction === 'BUY' ? (t.exitPrice - t.entryPrice)/pip : (t.entryPrice - t.exitPrice)/pip;
        t.profit = t.pips * pipV * t.lots;
        t.status = t.profit > 0 ? 'CLOSED_WON' : 'TIME_BAILOUT';
        BAL += t.profit; peak = Math.max(peak, BAL);
        maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
        continue;
      }

      if (t.direction === 'BUY') {
        if (c.low <= t.slPrice) {
          t.exitPrice = t.slPrice - sv; t.exitTime = c.time;
          t.pips = (t.exitPrice - t.entryPrice)/pip; t.profit = t.pips * pipV * t.lots;
          t.status = 'CLOSED_LOST'; BAL += t.profit; peak = Math.max(peak, BAL);
          maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
        } else if (c.high >= t.tpPrice) {
          t.exitPrice = t.tpPrice; t.exitTime = c.time;
          t.pips = (t.exitPrice - t.entryPrice)/pip; t.profit = t.pips * pipV * t.lots;
          t.status = 'CLOSED_WON'; BAL += t.profit; peak = Math.max(peak, BAL); closed.push(t);
        }
      } else if (t.direction === 'SELL') {
        if (c.high >= t.slPrice) {
          t.exitPrice = t.slPrice + sv; t.exitTime = c.time;
          t.pips = (t.entryPrice - t.exitPrice)/pip; t.profit = t.pips * pipV * t.lots;
          t.status = 'CLOSED_LOST'; BAL += t.profit; peak = Math.max(peak, BAL);
          maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
        } else if (c.low <= t.tpPrice) {
          t.exitPrice = t.tpPrice; t.exitTime = c.time;
          t.pips = (t.entryPrice - t.exitPrice)/pip; t.profit = t.pips * pipV * t.lots;
          t.status = 'CLOSED_WON'; BAL += t.profit; peak = Math.max(peak, BAL); closed.push(t);
        }
      }
    }
    open = open.filter(t => t.status === 'OPEN');

    // ── ENTRY LOGIC ──
    if (open.length > 0 || daily.length < 2 || m15.length < 15 || buf.length < 2) continue;
    if (tToday >= 1) continue; // 1 trade per day limit
    if (h < 7 || h >= 16) continue; // Killzone

    const pDay = daily[daily.length - 1];
    
    // Calculate Indicators
    const rsi = getRSI(m15, 14);
    const atr = getATR(m15, 14);
    if (atr === 0) continue;

    // We only evaluate entries at the close of an M15 candle for stability
    if (m % 15 !== 1) continue; 

    const l15 = m15[m15.length - 1];
    const isRed15 = l15.close < l15.open;
    const isGreen15 = l15.close > l15.open;

    // Short (Sweeping PDH, Overbought, Reversal Candle)
    if (l15.high > pDay.high && rsi >= cfg.rsiThreshold && isRed15) {
      const entry = c.close - (SPREAD * pip) - (SLIP * pip);
      const slPips = (atr * cfg.atrSlMultiplier) / pip;
      const sl = entry + (slPips * pip);
      const tp = entry - (slPips * cfg.rrMultiplier * pip);
      
      const lots = ((BAL * (RISK / 100)) / slPips) / pipV;
      if (lots >= 0.01) {
        open.push({ id: `T${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice: entry, slPrice: sl, tpPrice: tp, lots, status: 'OPEN' });
        tToday++;
      }
    }

    // Long (Sweeping PDL, Oversold, Reversal Candle)
    if (l15.low < pDay.low && rsi <= (100 - cfg.rsiThreshold) && isGreen15) {
      const entry = c.close + (SPREAD * pip) + (SLIP * pip);
      const slPips = (atr * cfg.atrSlMultiplier) / pip;
      const sl = entry - (slPips * pip);
      const tp = entry + (slPips * cfg.rrMultiplier * pip);
      
      const lots = ((BAL * (RISK / 100)) / slPips) / pipV;
      if (lots >= 0.01) {
        open.push({ id: `T${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice: entry, slPrice: sl, tpPrice: tp, lots, status: 'OPEN' });
        tToday++;
      }
    }
  }

  const w = closed.filter(t => (t.profit || 0) > 0).length;
  const wr = closed.length > 0 ? (w / closed.length) * 100 : 0;
  const gr = ((BAL - 100) / 100) * 100;
  return { wr, gr, dd: maxDD, trades: closed.length, w, l: closed.length - w };
}

async function main() {
  // Grid Search Parameters
  const rsiOpts = [70, 75, 80];
  const atrOpts = [1.0, 1.5, 2.0];
  const rrOpts = [1.0, 1.5, 2.0];
  const timeOpts = [45, 60];

  const configs: StatConfig[] = [];
  for (const rsi of rsiOpts) {
    for (const atr of atrOpts) {
      for (const rr of rrOpts) {
        for (const time of timeOpts) {
          configs.push({
            name: `RSI>${rsi} ATRx${atr.toFixed(1)} RRx${rr.toFixed(1)} Bail${time}m`,
            rsiThreshold: rsi,
            atrSlMultiplier: atr,
            rrMultiplier: rr,
            timeBailout: time
          });
        }
      }
    }
  }

  console.log('═'.repeat(100));
  console.log(`STATISTICAL MEAN REVERSION: GRID SEARCH (${configs.length} configs)`);
  console.log('Testing Top 5 Pairs over 1 Year Data (PDH/PDL Sweep + RSI Divergence)');
  console.log('═'.repeat(100));

  const results: Record<string, { totalGrowth: number, totalTrades: number, wins: number, losses: number }> = {};
  for (const c of configs) results[c.name] = { totalGrowth: 0, totalTrades: 0, wins: 0, losses: 0 };

  for (const pair of PAIRS) {
    console.log(`Processing ${pair.s}...`);
    const m1 = await load(path.join(process.cwd(), 'data', pair.f));
    for (const c of configs) {
      const r = simStatistical(m1, c, pair.p, pair.pv);
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
    .filter(c => results[c.name].totalTrades >= 20) // Minimum statistical significance
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
