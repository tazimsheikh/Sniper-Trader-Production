import fs from 'fs';
import readline from 'readline';
import path from 'path';

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }
interface TradeData {
  status: 'WON' | 'LOST';
  dayOfWeek: number;
  entryHour: number;
  asianBoxPips: number;
  trapDepthPips: number;
  engulfingPips: number;
}

const START = new Date('2021-05-01T00:00:00Z').getTime();
const END   = new Date('2026-05-01T23:59:59Z').getTime();
const SPREAD = 1.0;
const SLIP = 0.5;
const PIP = 0.0001;

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
  { s: 'XAUUSD', f: 'XAUUSD_M1_202105030101_202605010159.csv', p: 0.1, pv: 10 }
];

function getADR(daily: Candle[], period: number = 14): number {
  if (daily.length < period) return 0;
  let sum = 0;
  for (let i = daily.length - period; i < daily.length; i++) {
    sum += (daily[i].high - daily[i].low);
  }
  return sum / period;
}

function analyzeForensics(m1: Candle[], pairName: string, pipSize: number, rrTarget: number) {
  const trades: any[] = [];
  
  const m15: Candle[] = [];
  const daily: Candle[] = [];
  const buf: Candle[] = [];
  
  let curDay = '', curM15 = '';
  let dO = 0, dH = -Infinity, dL = Infinity;
  let mO = 0, mH = -Infinity, mL = Infinity;
  
  let asianH = -Infinity, asianL = Infinity;
  let huntH = -Infinity, huntL = Infinity;
  let trapState: 'NONE' | 'BULL_TRAPPED' | 'BEAR_TRAPPED' = 'NONE';
  let tradesToday = 0;
  let macroTrend: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  let trapStartTime: number | null = null;

  const m1ByDay: Record<string, Candle[]> = {};
  let activeTrade: any = null;

  for (let i = 0; i < m1.length; i++) {
    const c = m1[i];
    buf.push(c);
    const dt = new Date(c.time);
    const dp = c.dateStr.split('T')[0];
    const h = dt.getUTCHours(), m = dt.getUTCMinutes();
    const dayOfWeek = dt.getUTCDay();

    if (dp !== curDay) {
      if (curDay && m1ByDay[curDay] && m1ByDay[curDay].length > 0) {
        const lastC = m1ByDay[curDay][m1ByDay[curDay].length-1];
        daily.push({ time: new Date(`${curDay}T00:00:00Z`).getTime(), dateStr: curDay, open: dO, high: dH, low: dL, close: lastC.close });
        if (daily.length > 50) daily.shift();
      }
      curDay = dp; dO = c.open; dH = c.high; dL = c.low;
      m1ByDay[curDay] = [];
      
      asianH = -Infinity; asianL = Infinity;
      huntH = -Infinity; huntL = Infinity;
      trapState = 'NONE';
      tradesToday = 0;
      trapStartTime = null;
      
      macroTrend = 'NEUTRAL';
      if (daily.length >= 25) {
        const d1 = daily[daily.length - 1];
        const d2 = daily[daily.length - 2];
        const d3 = daily[daily.length - 3];
        if (d1.close > d2.close && d2.close > d3.close) macroTrend = 'LONG';
        else if (d1.close < d2.close && d2.close < d3.close) macroTrend = 'SHORT';
      }
    } else { dH = Math.max(dH, c.high); dL = Math.min(dL, c.low); }
    m1ByDay[curDay].push(c);

    const m15m = Math.floor(m / 15) * 15;
    const m15s = `${dp} ${h}:${m15m}`;
    if (m15s !== curM15) {
      if (curM15 && buf.length > 1) {
        m15.push({ time: buf[buf.length-2].time, dateStr: curM15, open: mO, high: mH, low: mL, close: buf[buf.length-2].close });
        if (m15.length > 50) m15.shift();
      }
      curM15 = m15s; mO = c.open; mH = c.high; mL = c.low;
    } else { mH = Math.max(mH, c.high); mL = Math.min(mL, c.low); }

    // Manage Trade
    if (activeTrade) {
      const minsOpen = (c.time - activeTrade.entryTime) / (60 * 1000);
      let exitStatus: 'WON' | 'LOST' | null = null;

      if (minsOpen >= 240) {
        const profit = activeTrade.direction === 'BUY' ? c.close - activeTrade.entryPrice : activeTrade.entryPrice - c.close;
        exitStatus = profit > 0 ? 'WON' : 'LOST';
      } else if (activeTrade.direction === 'BUY') {
        if (c.low <= activeTrade.slPrice) exitStatus = 'LOST';
        else if (c.high >= activeTrade.tpPrice) exitStatus = 'WON';
      } else {
        if (c.high >= activeTrade.slPrice) exitStatus = 'LOST';
        else if (c.low <= activeTrade.tpPrice) exitStatus = 'WON';
      }

      if (exitStatus) {
        activeTrade.meta.status = exitStatus;
        activeTrade.meta.minutesInTrade = minsOpen;
        trades.push(activeTrade.meta);
        activeTrade = null;
      }
    }

    if (h >= 0 && h < 6) { asianH = Math.max(asianH, c.high); asianL = Math.min(asianL, c.low); }
    if (h >= 7 && h < 14) { 
      if (c.high > huntH) huntH = c.high;
      if (c.low < huntL) huntL = c.low;

      if (trapStartTime === null) {
        if (c.high > asianH) trapStartTime = c.time;
        if (c.low < asianL) trapStartTime = c.time;
      }

      const boxPips = (asianH - asianL) / pipSize;
      if (asianH > -Infinity && boxPips <= 150) { // Gold Asian Box can be $15 (150 pips)
        if (trapState === 'NONE') {
          const bullTrapDist = (huntH - asianH) / pipSize;
          const bearTrapDist = (asianL - huntL) / pipSize;
          if (bullTrapDist >= 5) trapState = 'BULL_TRAPPED';
          else if (bearTrapDist >= 5) trapState = 'BEAR_TRAPPED';
        }
      }
    }

    if (trapState === 'NONE' || activeTrade || tradesToday > 0 || m15.length < 25) continue;
    
    // HARD FILTERS (Block 7/8/14)
    // if (dayOfWeek === 3 || dayOfWeek === 5) continue; 
    if (h < 7 || h >= 16) continue;
    if (h === 7 || h === 8 || h === 14) continue;

    if (m % 15 === 14) { 
      const l15 = m15[m15.length - 1];
      const ema20 = getEMA(m15, 20);

      let takeTrade = false;
      let tradeDirection: 'BUY' | 'SELL' | null = null;
      let structuralSl = 0;
      
      const pdh = daily.length > 0 ? daily[daily.length-1].high : 0;
      const pdl = daily.length > 0 ? daily[daily.length-1].low : 0;
      const adr14 = getADR(daily, 14) / pipSize;

      let meta: any = {
        pair: pairName,
        date: dt.toISOString(),
        dayOfWeek,
        entryHour: h,
        asianBoxPips: (asianH - asianL) / pipSize,
        adr14Pips: adr14,
        timeInTrapMins: trapStartTime ? (c.time - trapStartTime) / 60000 : 0
      };

      if (trapState === 'BULL_TRAPPED') {
        if (c.close < asianH && c.close < ema20 && l15.close < l15.open) { 
          takeTrade = true; tradeDirection = 'SELL'; structuralSl = huntH + (2 * pipSize); 
          meta.trapDepthPips = (huntH - asianH) / pipSize;
          meta.engulfingPips = (l15.open - l15.close) / pipSize;
          meta.distToPDH = pdh > 0 ? (pdh - c.close) / pipSize : 0;
          meta.distToPDL = pdl > 0 ? (c.close - pdl) / pipSize : 0;
        }
      }

      if (trapState === 'BEAR_TRAPPED') {
        if (c.close > asianL && c.close > ema20 && l15.close > l15.open) { 
          takeTrade = true; tradeDirection = 'BUY'; structuralSl = huntL - (2 * pipSize); 
          meta.trapDepthPips = (asianL - huntL) / pipSize;
          meta.engulfingPips = (l15.close - l15.open) / pipSize;
          meta.distToPDH = pdh > 0 ? (pdh - c.close) / pipSize : 0;
          meta.distToPDL = pdl > 0 ? (c.close - pdl) / pipSize : 0;
        }
      }

      if (takeTrade && tradeDirection) {
        const entry = tradeDirection === 'BUY' ? c.close + (SPREAD * pipSize) + (SLIP * pipSize) : c.close - (SPREAD * pipSize) - (SLIP * pipSize);
        const slPips = Math.abs(entry - structuralSl) / pipSize;
        
        if (slPips < 5 || slPips > 100) continue; // Gold SL can be up to $10 (100 pips)

        meta.slPips = slPips;
        meta.engulfRatio = meta.engulfingPips / meta.asianBoxPips;
        
        const tp = tradeDirection === 'BUY' ? entry + (slPips * rrTarget * pipSize) : entry - (slPips * rrTarget * pipSize);
        
        activeTrade = { direction: tradeDirection, entryTime: c.time, entryPrice: entry, slPrice: structuralSl, tpPrice: tp, meta };
        tradesToday++;
      }
    }
  }

  return trades;
}

async function simulateScenario(trades: any[], scenarioName: string) {
  let balance = 100; // Start with $100
  let peak = 100;
  let maxDD = 0;
  let wins = 0;
  let losses = 0;

  for (const t of trades) {
    const riskAmount = balance * 0.05; // 5% risk
    if (t.status === 'WON') {
      balance += riskAmount * 5; // 1:5 RR
      wins++;
    } else {
      balance -= riskAmount;
      losses++;
    }
    
    if (balance > peak) peak = balance;
    const dd = (peak - balance) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const total = wins + losses;
  const wr = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';
  const ret = ((balance - 100) / 100 * 100).toFixed(1);

  console.log(`\n--- SCENARIO: ${scenarioName} ---`);
  console.log(`Total Trades: ${total}`);
  console.log(`Wins: ${wins} | Losses: ${losses} | Win Rate: ${wr}%`);
  console.log(`Starting Balance: $100.00`);
  console.log(`Ending Balance: $${balance.toFixed(2)}`);
  console.log(`Total Return: ${ret}%`);
  console.log(`Max Drawdown: ${maxDD.toFixed(1)}%`);
}

async function main() {
  const rrTarget = 5.0;
  const allTrades: any[] = [];

  console.log('═'.repeat(100));
  console.log('RUNNING AGGRESSIVE BACKTEST (1:5 RR, 5 YEARS, $100 START, 5% RISK)');
  console.log('═'.repeat(100));

  for (const pair of PAIRS) {
    try {
      console.log(`Processing ${pair.s}...`);
      const m1 = await load(path.join(process.cwd(), 'data', pair.f));
      const trades = analyzeForensics(m1, pair.s, pair.p, rrTarget);
      
      // APPLY HOLY GRAIL FILTER
      const filtered = trades.filter(t => 
        t.trapDepthPips > 10 && 
        t.engulfRatio > 0.4 && 
        t.adr14Pips > 80
      );
      
      allTrades.push(...filtered);
    } catch (e) {
      console.log(`Could not load ${pair.s}`);
    }
  }

  const pairStats: Record<string, { w: number, l: number, t: number }> = {};
  for (const t of allTrades) {
    if (!pairStats[t.pair]) pairStats[t.pair] = { w: 0, l: 0, t: 0 };
    pairStats[t.pair].t++;
    if (t.status === 'WON') pairStats[t.pair].w++;
    else pairStats[t.pair].l++;
  }

  const results = Object.entries(pairStats).map(([pair, s]) => {
    const wr = s.t > 0 ? (s.w / s.t * 100) : 0;
    return { pair, ...s, wr };
  }).sort((a, b) => b.wr - a.wr);

  console.log('\n--- PAIR TIERS ---');
  for (const r of results) {
    console.log(`${r.pair}: WR ${r.wr.toFixed(1)}% | ${r.t} trades (${r.w}W / ${r.l}L)`);
  }
}

main().catch(console.error);
