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
  slMode: '1M_CANDLE' | '15M_STRUCTURE';
  tp1: number; tp2: number; be: number;
  minConfluence: number;
  maxTradesPerDay: number;
  riskPct: number;
  requireTrapOrPump: boolean;  // FORENSIC: require Asian Trap or Pump/Dump
  skipDay3: boolean;           // FORENSIC: don't boost Day3
  startHourUTC: number;       // FORENSIC: skip early London
  endHourUTC: number;
  minAsianRangePips: number;  // NEW: minimum Asian range to validate traps
  maxSLPips: number;          // NEW: cap SL to avoid outsized losers
  skipMonFri: boolean;        // NEW: skip Monday/Friday
  bailoutHours: number;       // NEW: time bailout
}

const PAIRS = [
  { s: 'AUDJPY', f: 'AUDJPY_M1_202105030005_202605010159.csv', p: 0.01, pv: 10, nc: ['AUD','JPY'] },
  { s: 'AUDUSD', f: 'AUDUSD_M1_202105030005_202605010159.csv', p: 0.0001, pv: 10, nc: ['AUD','USD'] },
  { s: 'CHFJPY', f: 'CHFJPY_M1_202105030006_202605010159.csv', p: 0.01, pv: 10, nc: ['CHF','JPY'] },
  { s: 'EURAUD', f: 'EURAUD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['EUR','AUD'] },
  { s: 'EURCAD', f: 'EURCAD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['EUR','CAD'] },
  { s: 'EURCHF', f: 'EURCHF_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['EUR','CHF'] },
  { s: 'EURJPY', f: 'EURJPY_M1_202105030000_202605010159.csv', p: 0.01, pv: 10, nc: ['EUR','JPY'] },
  { s: 'EURUSD', f: 'EURUSD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['EUR','USD'] },
  { s: 'GBPAUD', f: 'GBPAUD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['GBP','AUD'] },
  { s: 'GBPCAD', f: 'GBPCAD_M1_202105030006_202605010159.csv', p: 0.0001, pv: 10, nc: ['GBP','CAD'] },
  { s: 'GBPCHF', f: 'GBPCHF_M1_202105030006_202605010159.csv', p: 0.0001, pv: 10, nc: ['GBP','CHF'] },
  { s: 'GBPJPY', f: 'GBPJPY_M1_202105030006_202605010159.csv', p: 0.01, pv: 10, nc: ['GBP','JPY'] },
  { s: 'GBPUSD', f: 'GBPUSD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['GBP','USD'] },
  { s: 'NZDUSD', f: 'NZDUSD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['NZD','USD'] },
  { s: 'USDCAD', f: 'USDCAD_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['USD','CAD'] },
  { s: 'USDCHF', f: 'USDCHF_M1_202105030000_202605010159.csv', p: 0.0001, pv: 10, nc: ['USD','CHF'] },
  { s: 'USDJPY', f: 'USDJPY_M1_202105030000_202605010159.csv', p: 0.01, pv: 10, nc: ['USD','JPY'] },
];

const START = new Date('2026-02-01T00:00:00Z').getTime();
const END   = new Date('2026-04-30T23:59:59Z').getTime();
const SPREAD = 2.0;
const SLIP = 0.5;

let news: any[] = [];

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

function sim(m1: Candle[], cfg: Config, pip: number, pipV: number, nc: string[]) {
  let BAL = 100, peak = 100, maxDD = 0;
  let open: Trade[] = [], closed: Trade[] = [];
  let daily: Candle[] = [], m15: Candle[] = [], buf: Candle[] = [];
  let curDay = '', curM15 = '';
  let dO = 0, dH = -Infinity, dL = Infinity;
  let mO = 0, mH = -Infinity, mL = Infinity;
  let aDay = '', aH = -Infinity, aL = Infinity, aBH = false, aBL = false;
  let lDay = '', lO = 0, lC = 0, lSet = false;
  let tDay = '', tToday = 0;

  for (let i = 0; i < m1.length; i++) {
    const c = m1[i];
    buf.push(c);
    const dt = new Date(c.time);
    const dp = c.dateStr.split('T')[0];
    const h = dt.getUTCHours(), m = dt.getUTCMinutes();
    const dow = dt.getUTCDay();

    // Daily
    if (dp !== curDay) {
      if (curDay && buf.length > 1) daily.push({ time: new Date(`${curDay}T00:00:00Z`).getTime(), dateStr: curDay, open: dO, high: dH, low: dL, close: buf[buf.length-2].close });
      curDay = dp; dO = c.open; dH = c.high; dL = c.low;
    } else { dH = Math.max(dH, c.high); dL = Math.min(dL, c.low); }

    // M15
    const m15m = Math.floor(m / 15) * 15;
    const m15s = `${dp} ${h}:${m15m}`;
    if (m15s !== curM15) {
      if (curM15 && buf.length > 1) m15.push({ time: buf[buf.length-2].time, dateStr: curM15, open: mO, high: mH, low: mL, close: buf[buf.length-2].close });
      curM15 = m15s; mO = c.open; mH = c.high; mL = c.low;
    } else { mH = Math.max(mH, c.high); mL = Math.min(mL, c.low); }

    // Asian
    if (dp !== aDay) { aDay = dp; aH = -Infinity; aL = Infinity; aBH = false; aBL = false; }
    if (h >= 0 && h < 6) { aH = Math.max(aH, c.high); aL = Math.min(aL, c.low); }
    if (h >= 7 && aH !== -Infinity) { if (c.high > aH) aBH = true; if (c.low < aL) aBL = true; }

    // London 1st hour
    if (dp !== lDay) { lDay = dp; lSet = false; lO = 0; lC = 0; }
    if (h === 7 && m === 0 && !lSet) lO = c.open;
    if (h === 7 && m === 59) { lC = c.close; lSet = true; }

    // Trades/day
    if (dp !== tDay) { tDay = dp; tToday = 0; }

    // ── MANAGE TRADES ──
    for (const t of open) {
      if (['CLOSED_WON','CLOSED_LOST','TIME_BAILOUT'].includes(t.status)) continue;
      const pp = t.direction === 'BUY' ? (c.close - t.entryPrice)/pip : (t.entryPrice - c.close)/pip;
      
      // Find 15M swing for trailing
      let swL = -Infinity, swH = Infinity;
      if (m15.length >= 3) {
        for (let j=1; j<m15.length-1; j++) {
          if (m15[j].low < m15[j-1].low && m15[j].low < m15[j+1].low) swL = m15[j].low;
          if (m15[j].high > m15[j-1].high && m15[j].high > m15[j+1].high) swH = m15[j].high;
        }
      }

      const sv = SLIP * pip, spv = SPREAD * pip;
      const ask = c.close + spv;
      const cp = t.direction === 'BUY' ? c.close : ask;

      // SL
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
        // TP1
        if (t.status === 'OPEN') {
          if ((t.direction === 'BUY' && c.high >= t.tp1Price) || (t.direction === 'SELL' && c.low <= t.tp1Price)) {
            t.status = 'TP1_HIT'; t.lots /= 2;
            BAL += cfg.tp1 * pipV * t.lots; peak = Math.max(peak, BAL);
            t.slPrice = t.entryPrice + (t.direction==='BUY'? 1*pip : -1*pip);
          }
        }
        // TP2
        if (t.status === 'TP1_HIT') {
          if ((t.direction === 'BUY' && c.high >= t.tp2Price) || (t.direction === 'SELL' && c.low <= t.tp2Price)) {
            t.exitPrice = t.tp2Price; t.exitTime = c.time;
            t.pips = cfg.tp2; t.profit = cfg.tp2 * pipV * t.lots;
            t.status = 'CLOSED_WON'; BAL += t.profit; peak = Math.max(peak, BAL); closed.push(t);
          } else {
            const b = 1 * pip;
            if (t.direction === 'BUY' && swL !== -Infinity) { const tp = swL - b; if (tp > t.slPrice && tp < c.close) t.slPrice = tp; }
            else if (t.direction === 'SELL' && swH !== Infinity) { const tp = swH + b; if (tp < t.slPrice && tp > c.close) t.slPrice = tp; }
          }
        }
        // BE
        if (t.status === 'OPEN' && pp >= cfg.be) {
          const bp = t.direction === 'BUY' ? t.entryPrice + 1*pip : t.entryPrice - 1*pip;
          if (t.direction === 'BUY' && t.slPrice < t.entryPrice) t.slPrice = bp;
          if (t.direction === 'SELL' && t.slPrice > t.entryPrice) t.slPrice = bp;
        }
        // Time bailout
        const hrs = (c.time - t.entryTime) / 3600000;
        if (hrs >= cfg.bailoutHours && pp < 0) {
          t.exitPrice = cp; t.exitTime = c.time; t.pips = pp; t.profit = pp * pipV * t.lots;
          t.status = 'TIME_BAILOUT'; BAL += t.profit;
          maxDD = Math.max(maxDD, ((peak-BAL)/peak)*100); closed.push(t);
        }
      }
    }
    open = open.filter(t => t.status === 'OPEN' || t.status === 'TP1_HIT');

    // ── ENTRY LOGIC ──
    if (open.length > 0 || daily.length < 4 || m15.length < 10 || buf.length < 2) continue;
    if (tToday >= cfg.maxTradesPerDay) continue;

    // Session filter
    if (h < cfg.startHourUTC || h >= cfg.endHourUTC) continue;
    // Skip Mon/Fri
    if (cfg.skipMonFri && (dow === 1 || dow === 5)) continue;

    // News
    const isNews = news.some(n => { const nt = new Date(n.date).getTime(); return Math.abs(nt - c.time) < 5*60*1000 && nc.includes(n.country); });
    if (isNews) continue;

    // Asian range check
    const asianRange = aH !== -Infinity ? (aH - aL) / pip : 0;
    if (asianRange < cfg.minAsianRangePips) continue;

    // 15M structure
    let swHs: number[] = [], swLs: number[] = [];
    for (let j=2; j<m15.length-1; j++) {
      if (m15[j].high > m15[j-1].high && m15[j].high > m15[j+1].high) swHs.push(m15[j].high);
      if (m15[j].low < m15[j-1].low && m15[j].low < m15[j+1].low) swLs.push(m15[j].low);
    }
    const l15 = m15[m15.length - 2];
    const p3U = swHs.length >= 3, p3D = swLs.length >= 3;
    const bosS = swLs.length > 0 && l15.close < swLs[swLs.length-1];
    const bosL = swHs.length > 0 && l15.close > swHs[swHs.length-1];

    // M1 Engulfing
    const prev = buf[buf.length - 2];
    const bs = Math.abs(c.close - c.open) / pip;
    const bearE = prev.close > prev.open && c.close < c.open && c.close < prev.open && bs >= cfg.engulfPipSize;
    const bullE = prev.close < prev.open && c.close > c.open && c.close > prev.open && bs >= cfg.engulfPipSize;

    const pDay = daily[daily.length - 2];

    // Narrative filters
    const bullTrap = aBH && aH !== -Infinity && c.close < aH;
    const bearTrap = aBL && aL !== Infinity && c.close > aL;
    let pnD = false, dnP = false;
    if (lSet) { const lb = lC > lO; pnD = lb && bosS; dnP = !lb && bosL; }

    // Day count (but we can skip scoring it)
    let cG = 0, cR = 0;
    for (let j = daily.length - 1; j >= 0; j--) {
      const g = daily[j].close > daily[j].open;
      if (j === daily.length - 1) { if (g) cG = 1; else cR = 1; }
      else { if (g && cG > 0) cG++; else if (!g && cR > 0) cR++; else break; }
    }

    // ── SHORT ──
    let sS = 0;
    if (p3U && bosS) sS += 2;
    if (bearE) sS += 1;
    if (!cfg.skipDay3 && cG >= 3) sS += 3;
    if (bullTrap) sS += 3;
    if (pnD) sS += 2;

    const hasTrapOrPumpS = bullTrap || pnD;
    if (sS >= cfg.minConfluence && bearE && (p3U || bosS)) {
      if (!cfg.requireTrapOrPump || hasTrapOrPumpS) {
        const entry = c.close - (SPREAD * pip) - (SLIP * pip);
        let sl = Math.max(c.high, prev.high) + (5 * pip);
        if (cfg.slMode === '15M_STRUCTURE' && swHs.length > 0) sl = swHs[swHs.length-1] + (2 * pip);
        let slPips = (sl - entry) / pip;
        if (slPips > cfg.maxSLPips) slPips = cfg.maxSLPips; // Cap SL
        sl = entry + slPips * pip;
        if (slPips > 0 && slPips < 100) {
          const lots = ((BAL * (cfg.riskPct / 100)) / slPips) / pipV;
          if (lots >= 0.01) {
            open.push({ id: `T${c.time}`, direction: 'SELL', entryTime: c.time, entryPrice: entry, slPrice: sl, tp1Price: entry - cfg.tp1*pip, tp2Price: entry - cfg.tp2*pip, lots, status: 'OPEN' });
            m15 = []; tToday++;
          }
        }
      }
    }

    // ── LONG ──
    let lS = 0;
    if (p3D && bosL) lS += 2;
    if (bullE) lS += 1;
    if (!cfg.skipDay3 && cR >= 3) lS += 3;
    if (bearTrap) lS += 3;
    if (dnP) lS += 2;

    const hasTrapOrPumpL = bearTrap || dnP;
    if (lS >= cfg.minConfluence && bullE && (p3D || bosL)) {
      if (!cfg.requireTrapOrPump || hasTrapOrPumpL) {
        const entry = c.close + (SPREAD * pip) + (SLIP * pip);
        let sl = Math.min(c.low, prev.low) - (5 * pip);
        if (cfg.slMode === '15M_STRUCTURE' && swLs.length > 0) sl = swLs[swLs.length-1] - (2 * pip);
        let slPips = (entry - sl) / pip;
        if (slPips > cfg.maxSLPips) slPips = cfg.maxSLPips;
        sl = entry - slPips * pip;
        if (slPips > 0 && slPips < 100) {
          const lots = ((BAL * (cfg.riskPct / 100)) / slPips) / pipV;
          if (lots >= 0.01) {
            open.push({ id: `T${c.time}`, direction: 'BUY', entryTime: c.time, entryPrice: entry, slPrice: sl, tp1Price: entry + cfg.tp1*pip, tp2Price: entry + cfg.tp2*pip, lots, status: 'OPEN' });
            m15 = []; tToday++;
          }
        }
      }
    }
  }

  const w = closed.filter(t => (t.profit || 0) > 0).length;
  const wr = closed.length > 0 ? (w / closed.length) * 100 : 0;
  const gr = ((BAL - 100) / 100) * 100;
  return { wr, gr, dd: maxDD, bal: BAL, trades: closed.length, w, l: closed.length - w };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  news = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'april_news.json'), 'utf-8'));

  // Build massive config grid focused on forensic findings
  const configs: Config[] = [];
  
  const tp1s = [10, 15, 20, 25];
  const tp2s_mult = [2, 3]; // tp2 = tp1 * mult
  const risks = [1, 2, 3];
  const confs = [3, 4, 5, 6];
  const reqTrap = [true, false];
  const skipD3 = [true, false];
  const startHrs = [7, 8];
  const endHrs = [16];
  const slModes: ('1M_CANDLE' | '15M_STRUCTURE')[] = ['1M_CANDLE', '15M_STRUCTURE'];
  const minAsian = [0, 15];
  const maxSLs = [15, 25, 40];
  const skipMFs = [false, true];
  const bailouts = [0.5, 1.0, 1.5];

  for (const tp1 of tp1s) {
    for (const mult of tp2s_mult) {
      for (const risk of risks) {
        for (const conf of confs) {
          for (const rt of reqTrap) {
            for (const sd of skipD3) {
              for (const sh of startHrs) {
                for (const sl of slModes) {
                  for (const ma of minAsian) {
                    for (const ms of maxSLs) {
                      for (const smf of skipMFs) {
                        for (const bo of bailouts) {
                          configs.push({
                            engulfPipSize: 1, slMode: sl,
                            tp1, tp2: tp1 * mult, be: Math.round(tp1 * 0.6),
                            minConfluence: conf, maxTradesPerDay: 1, riskPct: risk,
                            requireTrapOrPump: rt, skipDay3: sd,
                            startHourUTC: sh, endHourUTC: 16,
                            minAsianRangePips: ma, maxSLPips: ms,
                            skipMonFri: smf, bailoutHours: bo
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Prune to manageable size — sample strategically
  // Full grid is too big, so let's use the forensic insights to pre-filter
  const smartConfigs: Config[] = [];
  for (const c of configs) {
    // Always require trap or pump (forensic finding #1)
    // Always skip day3 (forensic finding #2)  
    // Always start at 8+ (forensic finding #3)
    // Focus on configs that follow ALL forensic recommendations
    if (c.requireTrapOrPump && c.skipDay3 && c.startHourUTC >= 8) {
      smartConfigs.push(c);
    }
    // Also test the "soft" version — require trap but allow day3
    if (c.requireTrapOrPump && !c.skipDay3 && c.startHourUTC >= 8 && c.riskPct <= 2) {
      smartConfigs.push(c);
    }
    // And test 7:00 start with trap required (maybe trap fixes the 7am problem)
    if (c.requireTrapOrPump && c.skipDay3 && c.startHourUTC === 7 && c.riskPct <= 2) {
      smartConfigs.push(c);
    }
  }

  console.log(`Total configs in smart grid: ${smartConfigs.length}`);
  console.log(`Testing across ${PAIRS.length} pairs = ${PAIRS.length * smartConfigs.length} total simulations\n`);

  type PairBest = { sym: string; cfg: Config; wr: number; gr: number; dd: number; bal: number; trades: number; w: number; l: number; score: number };
  const pairBests: PairBest[] = [];

  // Also track global best configs across all pairs
  const cfgScores: Map<string, { totalGrowth: number; totalWR: number; totalDD: number; count: number; pairsPositive: number }> = new Map();

  for (const pair of PAIRS) {
    const m1 = await load(path.join(process.cwd(), 'data', pair.f));
    process.stdout.write(`${pair.s} (${m1.length} candles)... `);

    let bestScore = -Infinity;
    let bestResult: any = null;
    let bestCfg: Config = smartConfigs[0];

    for (const cfg of smartConfigs) {
      const r = sim(m1, cfg, pair.p, pair.pv, pair.nc);
      // Score: heavily penalize drawdown, reward growth, bonus for high WR
      const score = r.gr * 2 + r.wr * 0.5 - r.dd * 3 + (r.trades > 0 ? 10 : -50);
      
      if (score > bestScore) {
        bestScore = score; bestResult = r; bestCfg = cfg;
      }

      // Track config performance across pairs
      const key = JSON.stringify({ tp1: cfg.tp1, tp2: cfg.tp2, risk: cfg.riskPct, conf: cfg.minConfluence, sl: cfg.slMode, ma: cfg.minAsianRangePips, ms: cfg.maxSLPips, smf: cfg.skipMonFri, bo: cfg.bailoutHours, sh: cfg.startHourUTC });
      const existing = cfgScores.get(key) || { totalGrowth: 0, totalWR: 0, totalDD: 0, count: 0, pairsPositive: 0 };
      existing.totalGrowth += r.gr;
      existing.totalWR += r.wr;
      existing.totalDD += r.dd;
      existing.count++;
      if (r.gr > 0) existing.pairsPositive++;
      cfgScores.set(key, existing);
    }

    pairBests.push({ sym: pair.s, cfg: bestCfg, ...bestResult, score: bestScore });
    const g = (bestResult.gr >= 0 ? '+' : '') + bestResult.gr.toFixed(1);
    console.log(`Growth: ${g}% | WR: ${bestResult.wr.toFixed(0)}% | DD: ${bestResult.dd.toFixed(1)}% | T: ${bestResult.trades} (${bestResult.w}W/${bestResult.l}L) | TP:${bestCfg.tp1}/${bestCfg.tp2} Risk:${bestCfg.riskPct}% Conf:${bestCfg.minConfluence} SL:${bestCfg.slMode.substring(0,3)} MaxSL:${bestCfg.maxSLPips} Bo:${bestCfg.bailoutHours}h ${bestCfg.skipMonFri?'NoMonFri':''}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND BEST UNIVERSAL CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(120));
  console.log('BEST UNIVERSAL CONFIGURATIONS (across ALL 17 pairs)');
  console.log('═'.repeat(120));

  const universalRanked = Array.from(cfgScores.entries()).map(([key, v]) => ({
    key, avgGrowth: v.totalGrowth / v.count, avgWR: v.totalWR / v.count, avgDD: v.totalDD / v.count,
    pairsPositive: v.pairsPositive, count: v.count,
    // Score: maximize pairs positive, then avg growth, minimize avg DD
    score: v.pairsPositive * 20 + (v.totalGrowth / v.count) * 2 - (v.totalDD / v.count) * 2
  })).sort((a, b) => b.score - a.score);

  console.log(`${'Config'.padEnd(85)} ${'AvgGr%'.padStart(7)} ${'AvgWR%'.padStart(7)} ${'AvgDD%'.padStart(7)} ${'Pairs+'.padStart(6)} ${'Score'.padStart(7)}`);
  console.log('─'.repeat(120));

  for (const u of universalRanked.slice(0, 20)) {
    const cfg = JSON.parse(u.key);
    const label = `TP:${cfg.tp1}/${cfg.tp2} R:${cfg.risk}% C:${cfg.conf} SL:${cfg.sl.substring(0,3)} MaxSL:${cfg.ms} Asian:${cfg.ma} MonFri:${cfg.smf?'Skip':'OK'} Bo:${cfg.bo}h Start:${cfg.sh}`;
    console.log(`${label.padEnd(85)} ${(u.avgGrowth>=0?'+':'')+u.avgGrowth.toFixed(1).padStart(6)} ${u.avgWR.toFixed(0).padStart(7)} ${u.avgDD.toFixed(1).padStart(7)} ${String(u.pairsPositive).padStart(6)} ${u.score.toFixed(1).padStart(7)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PER-PAIR BEST RESULTS TABLE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(120));
  console.log('PER-PAIR BEST RESULTS (individually optimized)');
  console.log('═'.repeat(120));
  console.log(`${'Pair'.padEnd(8)} ${'Growth%'.padStart(8)} ${'WR%'.padStart(5)} ${'DD%'.padStart(6)} ${'Trades'.padStart(6)} ${'W'.padStart(3)} ${'L'.padStart(3)} | ${'TP'.padStart(6)} ${'Risk'.padStart(4)} ${'Conf'.padStart(4)} ${'SL'.padStart(5)} ${'MaxSL'.padStart(5)} ${'Bo'.padStart(4)} ${'MonFri'.padStart(8)}`);
  console.log('─'.repeat(120));

  let portStart = 0, portEnd = 0, profitablePairs = 0;
  for (const r of pairBests) {
    const g = (r.gr >= 0 ? '+' : '') + r.gr.toFixed(1);
    console.log(`${r.sym.padEnd(8)} ${g.padStart(8)} ${r.wr.toFixed(0).padStart(5)} ${r.dd.toFixed(1).padStart(6)} ${String(r.trades).padStart(6)} ${String(r.w).padStart(3)} ${String(r.l).padStart(3)} | ${(r.cfg.tp1+'/'+r.cfg.tp2).padStart(6)} ${(r.cfg.riskPct+'%').padStart(4)} ${String(r.cfg.minConfluence).padStart(4)} ${r.cfg.slMode.substring(0,5).padStart(5)} ${String(r.cfg.maxSLPips).padStart(5)} ${(r.cfg.bailoutHours+'h').padStart(4)} ${(r.cfg.skipMonFri?'Skip':'OK').padStart(8)}`);
    portStart += 100; portEnd += r.bal;
    if (r.gr > 0) profitablePairs++;
  }

  console.log('─'.repeat(120));
  console.log(`PORTFOLIO: $${portStart} → $${portEnd.toFixed(2)} (${((portEnd-portStart)/portStart*100).toFixed(1)}% growth) | ${profitablePairs}/${PAIRS.length} pairs profitable`);
  console.log('═'.repeat(120));

  // ═══════════════════════════════════════════════════════════════════════════
  // NOW RUN THE BEST UNIVERSAL CONFIG ON ALL PAIRS
  // ═══════════════════════════════════════════════════════════════════════════
  if (universalRanked.length > 0) {
    const bestU = JSON.parse(universalRanked[0].key);
    const uCfg: Config = {
      engulfPipSize: 1, slMode: bestU.sl, tp1: bestU.tp1, tp2: bestU.tp2,
      be: Math.round(bestU.tp1 * 0.6), minConfluence: bestU.conf,
      maxTradesPerDay: 1, riskPct: bestU.risk, requireTrapOrPump: true,
      skipDay3: true, startHourUTC: bestU.sh, endHourUTC: 16,
      minAsianRangePips: bestU.ma, maxSLPips: bestU.ms,
      skipMonFri: bestU.smf, bailoutHours: bestU.bo
    };

    console.log(`\n${'═'.repeat(120)}`);
    console.log(`BEST UNIVERSAL CONFIG APPLIED TO ALL PAIRS`);
    console.log(`Config: TP=${bestU.tp1}/${bestU.tp2} Risk=${bestU.risk}% Conf>=${bestU.conf} SL=${bestU.sl} MaxSL=${bestU.ms} Asian>=${bestU.ma} Bo=${bestU.bo}h Start=${bestU.sh} MonFri=${bestU.smf?'Skip':'OK'}`);
    console.log('═'.repeat(120));

    let uStart = 0, uEnd = 0, uProf = 0;
    for (const pair of PAIRS) {
      const m1 = await load(path.join(process.cwd(), 'data', pair.f));
      const r = sim(m1, uCfg, pair.p, pair.pv, pair.nc);
      const g = (r.gr >= 0 ? '+' : '') + r.gr.toFixed(1);
      console.log(`  ${pair.s.padEnd(8)} Growth: ${g.padStart(7)}% | WR: ${r.wr.toFixed(0).padStart(3)}% | DD: ${r.dd.toFixed(1).padStart(5)}% | Trades: ${r.trades} (${r.w}W/${r.l}L)`);
      uStart += 100; uEnd += r.bal;
      if (r.gr > 0) uProf++;
    }
    console.log('─'.repeat(120));
    console.log(`  PORTFOLIO: $${uStart} → $${uEnd.toFixed(2)} (${((uEnd-uStart)/uStart*100).toFixed(1)}%) | ${uProf}/${PAIRS.length} profitable`);
    console.log('═'.repeat(120));
  }
}

main().catch(console.error);
