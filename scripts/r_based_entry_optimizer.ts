import fs from 'fs';
import path from 'path';

interface Candle {
  dateStr: string;
  timeStr: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const STARTING_BALANCE = 1000;

async function loadData(filePath: string): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const results: Candle[] = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    let isFirstLine = true;
    let buffer = '';
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (isFirstLine) { isFirstLine = false; continue; }
        if (!line) continue;
        const p = line.split('\t');
        if (p.length < 6) continue;
        const dateStr = p[0].replace(/\./g, '-');
        const timeStr = p[1];
        const open = parseFloat(p[2]);
        if (isNaN(open)) continue;
        results.push({
          dateStr, timeStr,
          time: new Date(`${dateStr}T${timeStr}Z`).getTime(),
          open, high: parseFloat(p[3]), low: parseFloat(p[4]), close: parseFloat(p[5]),
        });
      }
    });
    stream.on('end', () => resolve(results));
    stream.on('error', reject);
  });
}

interface TradeSetup {
  date: string;
  hour: number;
  min: number;
  bias: 'BUY' | 'SELL';
  engulfingMatch: boolean;
  entryCandle: Candle;
  tradeCandles: Candle[];
}

function preProcessSetups(
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  hr: number, min: number,
  emaPeriod: number,
  reverse: boolean,
  confirmation: 'none' | 'engulfing'
): TradeSetup[] {
  const setups: TradeSetup[] = [];

  for (let d = 1; d < dateKeys.length; d++) {
    const todayCandles = daysObj[dateKeys[d]];
    if (!todayCandles || todayCandles.length < 60) continue;

    let ema = 0;
    const emaArr = new Array(todayCandles.length).fill(0);
    for (let i = 0; i < todayCandles.length; i++) {
      if (ema === 0) ema = todayCandles[i].close;
      else ema = todayCandles[i].close * (2 / (emaPeriod + 1)) + ema * (1 - 2 / (emaPeriod + 1));
      emaArr[i] = ema;
    }

    const entryIdx = todayCandles.findIndex(c => {
      const [h, m] = c.timeStr.split(':').map(Number);
      return h === hr && m === min;
    });
    if (entryIdx < 1) continue;

    const entryCandle = todayCandles[entryIdx];
    let bias: 'BUY' | 'SELL' = entryCandle.close > emaArr[entryIdx] ? 'BUY' : 'SELL';
    if (reverse) bias = bias === 'BUY' ? 'SELL' : 'BUY';

    const prevCandle = todayCandles[entryIdx - 1];
    const prevIsBullish = prevCandle.close > prevCandle.open;
    const currIsBullish = entryCandle.close > entryCandle.open;
    const engBullish = !prevIsBullish && currIsBullish && entryCandle.close > prevCandle.open && entryCandle.open < prevCandle.close;
    const engBearish = prevIsBullish && !currIsBullish && entryCandle.close < prevCandle.open && entryCandle.open > prevCandle.close;

    let engulfingMatch = true;
    if (confirmation === 'engulfing') {
      if (bias === 'BUY' && !engBullish) engulfingMatch = false;
      if (bias === 'SELL' && !engBearish) engulfingMatch = false;
    }
    if (!engulfingMatch) continue;

    setups.push({
      date: dateKeys[d],
      hour: hr, min,
      bias,
      engulfingMatch,
      entryCandle,
      tradeCandles: todayCandles.slice(entryIdx + 1)
    });
  }
  return setups;
}

interface RScenario {
  // R levels at which to add entries (e.g. 0.5 = when trade is up 0.5 × initial SL distance)
  // null means no additional entry
  r2: number | null;
  r3: number | null;
  // Risk per additional entry
  riskMode: 'SPLIT' | 'FULL'; // SPLIT = 5%/N; FULL = 5% per entry
  // SL/TP for subsequent entries: SHARED = same absolute price as entry 1; INDEPENDENT = own SL/TP
  slTpMode: 'SHARED' | 'INDEPENDENT';
}

function runRStrategy(
  setups: TradeSetup[],
  slPips: number, tpPips: number,
  breakeven: boolean,
  manualCloseHours: number,
  pipSize: number, spread: number,
  commissionRT: number,
  pipValuePerLot: number,
  scen: RScenario
) {
  let balance = STARTING_BALANCE;
  const trades: number[] = [];
  let peak = STARTING_BALANCE;
  let maxDD = 0;

  const numEntries = 1 + (scen.r2 !== null ? 1 : 0) + (scen.r3 !== null ? 1 : 0);
  const totalRiskPct = 0.05;

  for (const s of setups) {
    if (balance <= 0) break;
    const bias = s.bias;

    const ep1 = bias === 'BUY' ? s.entryCandle.close + spread : s.entryCandle.close;
    const sl1 = bias === 'BUY' ? ep1 - slPips * pipSize : ep1 + slPips * pipSize;
    const tp1 = bias === 'BUY' ? ep1 + tpPips * pipSize : ep1 - tpPips * pipSize;
    const rDist = slPips * pipSize; // 1R distance in price

    const riskPerTrade = scen.riskMode === 'SPLIT'
      ? (balance * totalRiskPct) / numEntries
      : balance * totalRiskPct;

    const minRisk = 0.01 * slPips * pipValuePerLot;
    if (minRisk > riskPerTrade) continue;

    const calcLots1 = riskPerTrade / (slPips * pipValuePerLot);
    const lots1 = Math.max(0.01, Math.min(0.5, parseFloat(calcLots1.toFixed(2))));

    interface ActiveTrade {
      ep: number; sl: number; tp: number; lots: number;
      id: number; slMoved: boolean;
    }

    const activeTrades: ActiveTrade[] = [{ ep: ep1, sl: sl1, tp: tp1, lots: lots1, id: 1, slMoved: false }];
    let t2Triggered = false;
    let t3Triggered = false;
    let closedProfit = 0;

    const maxExitTime = s.entryCandle.time + manualCloseHours * 3600 * 1000;

    // Helper: price profit pips from entry 1 perspective
    const getProfitPips = (currentClose: number) =>
      bias === 'BUY'
        ? (currentClose - ep1) / pipSize
        : (ep1 - currentClose) / pipSize;

    const tryAdd = (id: number, currentEp: number, prevC: Candle) => {
      // Subsequent entries just enter at market
      const ep = bias === 'BUY' ? currentEp + spread : currentEp;
      let sl: number, tp: number;
      if (scen.slTpMode === 'SHARED') {
        sl = sl1; tp = tp1;
      } else {
        sl = bias === 'BUY' ? ep - slPips * pipSize : ep + slPips * pipSize;
        tp = bias === 'BUY' ? ep + tpPips * pipSize : ep - tpPips * pipSize;
      }
      const distPips = Math.abs(ep - sl) / pipSize;
      if (distPips <= 0) return;
      const calcL = riskPerTrade / (distPips * pipValuePerLot);
      const lots = Math.max(0.01, Math.min(0.5, parseFloat(calcL.toFixed(2))));
      activeTrades.push({ ep, sl, tp, lots, id, slMoved: false });
    };

    let toRemove: number[] = [];

    for (let j = 0; j < s.tradeCandles.length; j++) {
      const c = s.tradeCandles[j];
      const profitPips = getProfitPips(c.close);
      const prevC = j > 0 ? s.tradeCandles[j - 1] : s.entryCandle;

      // Check pyramid triggers
      if (scen.r2 !== null && !t2Triggered && profitPips >= scen.r2 * slPips) {
        t2Triggered = true;
        if (activeTrades.length > 0) tryAdd(2, c.close, prevC);
      }
      if (scen.r3 !== null && !t3Triggered && profitPips >= scen.r3 * slPips) {
        t3Triggered = true;
        if (activeTrades.length > 0) tryAdd(3, c.close, prevC);
      }

      toRemove = [];
      for (let ti = 0; ti < activeTrades.length; ti++) {
        const t = activeTrades[ti];
        let closed = false;

        // Time-based exit
        if (c.time >= maxExitTime) {
          const exitPrice = bias === 'BUY' ? c.close : c.close + spread;
          const profitP = bias === 'BUY' ? (exitPrice - t.ep) / pipSize : (t.ep - exitPrice) / pipSize;
          closedProfit += profitP * pipValuePerLot * t.lots - commissionRT * t.lots;
          closed = true;
        } else if (bias === 'BUY') {
          if (c.low <= t.sl) {
            const lossPips = (t.ep - t.sl) / pipSize;
            closedProfit += -(lossPips * pipValuePerLot * t.lots) - commissionRT * t.lots;
            closed = true;
          } else if (c.high >= t.tp) {
            const profitP = (t.tp - t.ep) / pipSize;
            closedProfit += profitP * pipValuePerLot * t.lots - commissionRT * t.lots;
            closed = true;
          } else if (breakeven && !t.slMoved && c.high >= t.ep + (tpPips / 2) * pipSize) {
            t.sl = Math.max(t.sl, t.ep);
            t.slMoved = true;
          }
        } else {
          if (c.high + spread >= t.sl) {
            const lossPips = (t.sl - t.ep) / pipSize;
            closedProfit += -(lossPips * pipValuePerLot * t.lots) - commissionRT * t.lots;
            closed = true;
          } else if (c.low <= t.tp) {
            const profitP = (t.ep - t.tp) / pipSize;
            closedProfit += profitP * pipValuePerLot * t.lots - commissionRT * t.lots;
            closed = true;
          } else if (breakeven && !t.slMoved && c.low <= t.ep - (tpPips / 2) * pipSize) {
            t.sl = Math.min(t.sl, t.ep);
            t.slMoved = true;
          }
        }

        if (closed) toRemove.push(ti);
      }

      for (let ri = toRemove.length - 1; ri >= 0; ri--) {
        activeTrades.splice(toRemove[ri], 1);
      }

      if (activeTrades.length === 0) break;
    }

    // Close any still-open trades at last candle
    for (const t of activeTrades) {
      if (s.tradeCandles.length > 0) {
        const last = s.tradeCandles[s.tradeCandles.length - 1];
        const profitP = bias === 'BUY'
          ? (last.close - t.ep) / pipSize
          : (t.ep - last.close) / pipSize;
        closedProfit += profitP * pipValuePerLot * t.lots - commissionRT * t.lots;
      }
    }

    balance += closedProfit;
    trades.push(closedProfit);
    if (balance > peak) peak = balance;
    const dd = ((peak - balance) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const wins = trades.filter(p => p > 0).length;
  return {
    profit: balance - STARTING_BALANCE,
    maxDD,
    trades: trades.length,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0
  };
}

function scenarioName(s: RScenario): string {
  const parts = ['Baseline'];
  if (s.r2 !== null) parts.push(`T2(+${s.r2}R)`);
  if (s.r3 !== null) parts.push(`T3(+${s.r3}R)`);
  if (s.r2 !== null) {
    parts.push(`Risk:${s.riskMode}`);
    parts.push(`SL:${s.slTpMode}`);
  }
  return parts.join(' | ');
}

async function scanPair(pair: string, dataDir: string, config: any, scenarios: RScenario[]) {
  const dataFiles = fs.readdirSync(dataDir);
  const dataFile = dataFiles.find(f => f.startsWith(pair) && f.endsWith('.csv'));
  if (!dataFile) return null;

  const candles = await loadData(path.join(dataDir, dataFile));
  const daysObj: Record<string, Candle[]> = {};
  for (const c of candles) {
    if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
    daysObj[c.dateStr].push(c);
  }
  const dateKeys = Object.keys(daysObj).sort();

  const isGold = pair.includes('XAU');
  const isJpy = pair.includes('JPY');
  const pipSize = isGold || isJpy ? 0.01 : 0.0001;
  const pipValuePerLot = isGold ? 1 : 10;
  const commissionRT = 7;
  const slippagePips = 1.0;
  const spread = pipSize + slippagePips * pipSize;

  const startDate = new Date('2021-05-01T00:00:00Z').getTime();
  const endDate = new Date('2026-05-01T00:00:00Z').getTime();
  const validDateKeys = dateKeys.filter(k => {
    const t = new Date(k + 'T00:00:00Z').getTime();
    return t >= startDate && t < endDate;
  });

  const setups = preProcessSetups(
    daysObj, validDateKeys,
    config.hr, config.min, config.emaPeriod,
    config.reverse, config.confirmation
  );

  const results = scenarios.map(scen => ({
    name: scenarioName(scen),
    scen,
    ...runRStrategy(
      setups, config.sl, config.tp,
      config.breakeven, config.manualCloseHrs,
      pipSize, spread, commissionRT, pipValuePerLot,
      scen
    )
  }));

  results.sort((a, b) => b.profit - a.profit);
  return { pair, results };
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'data');
  const optimalConfigs: any[] = JSON.parse(fs.readFileSync('optimal_forex_configs.json', 'utf-8'));

  // Build scenarios
  const scenarios: RScenario[] = [];

  // 1. Baseline (no additional entries)
  scenarios.push({ r2: null, r3: null, riskMode: 'FULL', slTpMode: 'INDEPENDENT' });

  const rLevels2 = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
  const riskModes: ('SPLIT' | 'FULL')[] = ['SPLIT', 'FULL'];
  const slTpModes: ('SHARED' | 'INDEPENDENT')[] = ['SHARED', 'INDEPENDENT'];

  // 2. Two entries (Entry2 at various R levels)
  for (const r2 of rLevels2) {
    for (const rm of riskModes) {
      for (const st of slTpModes) {
        scenarios.push({ r2, r3: null, riskMode: rm, slTpMode: st });
      }
    }
  }

  // 3. Three entries: Entry2 at r2, Entry3 at r3 (r3 > r2)
  const rLadders = [
    { r2: 0.25, r3: 0.5 },
    { r2: 0.5,  r3: 1.0 },
    { r2: 0.5,  r3: 1.5 },
    { r2: 0.75, r3: 1.5 },
    { r2: 1.0,  r3: 2.0 },
  ];
  for (const l of rLadders) {
    for (const rm of riskModes) {
      for (const st of slTpModes) {
        scenarios.push({ r2: l.r2, r3: l.r3, riskMode: rm, slTpMode: st });
      }
    }
  }

  console.log(`Running ${scenarios.length} R-based scenarios per pair for ${optimalConfigs.length} pairs...`);

  let markdown = '# R-Based Pyramid Entry Optimization Report\n\n';
  markdown += `Simulating pyramiding on winners: Entry 2 is triggered when the first trade is in profit by a target multiple of R (e.g. +0.5R = up 50% of the SL distance). Entry 3 is triggered at a higher R level. Tested over the 5-year window (May 2021 – May 2026) for all 17 pairs.\n\n`;
  markdown += `**Variables tested:**\n`;
  markdown += `- 2nd Entry at: +0.25R, +0.5R, +0.75R, +1R, +1.5R, +2R\n`;
  markdown += `- 3rd Entry ladders: 0.25→0.5R, 0.5→1R, 0.5→1.5R, 0.75→1.5R, 1→2R\n`;
  markdown += `- Risk Mode: FULL (5% per trade) vs SPLIT (5% shared)\n`;
  markdown += `- SL/TP Mode: SHARED (same absolute SL/TP as T1) vs INDEPENDENT (own levels from its entry)\n\n`;
  markdown += '---\n\n';

  let grandTotalBaseline = 0;
  let grandTotalBest = 0;

  for (let i = 0; i < optimalConfigs.length; i++) {
    const item = optimalConfigs[i];
    console.log(`Processing [${i + 1}/${optimalConfigs.length}] ${item.pair}...`);
    const c = item.bestResult;
    const data = await scanPair(item.pair, dataDir, c, scenarios);
    if (!data) continue;

    const baseline = data.results.find(r => r.scen.r2 === null)!;
    const baselineRank = data.results.indexOf(baseline) + 1;
    grandTotalBaseline += baseline.profit;
    grandTotalBest += data.results[0].profit;

    markdown += `## ${item.pair}\n`;
    markdown += `**Base Setup:** ${c.hr}:${c.min < 10 ? '0' + c.min : c.min} UTC | Rev:${c.reverse} | SL:${c.sl}pips | TP:${c.tp}pips | EMA:${c.emaPeriod}\n\n`;
    markdown += '| Rank | Configuration | Profit | Max DD | Win Rate | Trades |\n';
    markdown += '|---|---|---|---|---|---|\n';
    for (let j = 0; j < Math.min(10, data.results.length); j++) {
      const r = data.results[j];
      const icon = j === 0 ? '🏆 ' : '';
      const baseTag = r.scen.r2 === null ? '**(Baseline)** ' : '';
      markdown += `| ${j + 1} | ${icon}${baseTag}${r.name} | $${r.profit.toFixed(2)} | ${r.maxDD.toFixed(1)}% | ${r.winRate.toFixed(1)}% | ${r.trades} |\n`;
    }
    markdown += `\n*Baseline ranked #${baselineRank}/${scenarios.length}. Baseline profit: $${baseline.profit.toFixed(2)} → Best R-pyramid: $${data.results[0].profit.toFixed(2)} (+${((data.results[0].profit / baseline.profit - 1) * 100).toFixed(0)}% vs baseline)*\n\n`;
    markdown += '---\n\n';
  }

  markdown += `## Grand Summary\n`;
  markdown += `| Metric | Baseline (1 Entry) | Best R-Pyramid |\n`;
  markdown += `|---|---|---|\n`;
  markdown += `| Total 5Y Profit (all 17 pairs) | $${grandTotalBaseline.toFixed(2)} | $${grandTotalBest.toFixed(2)} |\n`;
  markdown += `| Improvement | — | +${((grandTotalBest / grandTotalBaseline - 1) * 100).toFixed(0)}% |\n`;

  const outDir = path.join('C:', 'Users', 'tazim', '.gemini', 'antigravity', 'brain', 'ed74d6b2-80e4-4426-b22c-a3a73203ea55');
  fs.writeFileSync(path.join(outDir, 'r_based_report.md'), markdown);
  console.log('R-based pyramid report written!');
}

main().catch(console.error);
