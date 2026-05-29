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
  biases: Record<number, 'BUY' | 'SELL'>;
  engulfingBullish: boolean;
  engulfingBearish: boolean;
  entryCandle: Candle;
  tradeCandles: Candle[];
}

function preProcessSetups(
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  hours: number[],
  minutes: number[],
  emaPeriods: number[]
): TradeSetup[] {
  const setups: TradeSetup[] = [];

  for (let d = 1; d < dateKeys.length; d++) {
    const todayCandles = daysObj[dateKeys[d]];
    if (!todayCandles || todayCandles.length < 60) continue;

    const emaCache: Record<number, number[]> = {};
    for (const period of emaPeriods) {
      let ema = 0;
      emaCache[period] = new Array(todayCandles.length).fill(0);
      for (let i = 0; i < todayCandles.length; i++) {
        if (ema === 0) ema = todayCandles[i].close;
        else ema = todayCandles[i].close * (2 / (period + 1)) + ema * (1 - 2 / (period + 1));
        emaCache[period][i] = ema;
      }
    }

    for (const hr of hours) {
      for (const min of minutes) {
        const entryIdx = todayCandles.findIndex(c => {
          const [h, m] = c.timeStr.split(':').map(Number);
          return h === hr && m === min;
        });

        if (entryIdx < 1) continue;

        const entryCandle = todayCandles[entryIdx];
        
        const biases: Record<number, 'BUY' | 'SELL'> = {};
        for (const period of emaPeriods) {
           const emaHtf = emaCache[period][entryIdx];
           biases[period] = entryCandle.close > emaHtf ? 'BUY' : 'SELL';
        }

        const prevCandle = todayCandles[entryIdx - 1];
        const prevIsBullish = prevCandle.close > prevCandle.open;
        const currIsBullish = entryCandle.close > entryCandle.open;

        const engulfingBullish = !prevIsBullish && currIsBullish && entryCandle.close > prevCandle.open && entryCandle.open < prevCandle.close;
        const engulfingBearish = prevIsBullish && !currIsBullish && entryCandle.close < prevCandle.open && entryCandle.open > prevCandle.close;

        setups.push({
          date: dateKeys[d],
          hour: hr,
          min,
          biases,
          engulfingBullish,
          engulfingBearish,
          entryCandle,
          tradeCandles: todayCandles.slice(entryIdx + 1)
        });
      }
    }
  }

  return setups;
}

interface ActiveTrade {
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  lots: number;
  id: number;
}

interface MultiEntryConfig {
  offset2: number | null; // minutes
  offset3: number | null; // minutes
  riskMode: 'SPLIT' | 'FULL'; // SPLIT = 5% / N, FULL = 5% per trade
  slTpMode: 'INDEPENDENT' | 'SHARED'; // INDEPENDENT = 40pips from its own entry, SHARED = exact same absolute SL/TP prices as trade 1
  confMode: 'BLIND' | 'ENGULFING'; // BLIND = just enter at time, ENGULFING = require 1m engulf
}

function runStrategyFast(
  setups: TradeSetup[],
  hr: number, min: number,
  slPips: number, tpPips: number,
  reverse: boolean, breakeven: boolean,
  confirmation: 'none' | 'engulfing',
  manualCloseHours: number, emaPeriod: number,
  pipSize: number, spread: number,
  commissionRoundTrip: number,
  pipValuePerLot: number,
  multiConfig: MultiEntryConfig
) {
  let balance = STARTING_BALANCE;
  const trades: number[] = [];
  let peak = STARTING_BALANCE;
  let maxDD = 0;

  for (let i = 0; i < setups.length; i++) {
    if (balance <= 0) break;
    const s = setups[i];
    if (s.hour !== hr || s.min !== min) continue;

    let bias = s.biases[emaPeriod];
    if (reverse) bias = bias === 'BUY' ? 'SELL' : 'BUY';

    // Base trade confirmation
    if (confirmation === 'engulfing') {
      if (bias === 'BUY' && !s.engulfingBullish) continue;
      if (bias === 'SELL' && !s.engulfingBearish) continue;
    }

    const entryPrice1 = bias === 'BUY' ? s.entryCandle.close + spread : s.entryCandle.close;
    const slPriceInit1 = bias === 'BUY' ? entryPrice1 - slPips * pipSize : entryPrice1 + slPips * pipSize;
    const tpPrice1 = bias === 'BUY' ? entryPrice1 + tpPips * pipSize : entryPrice1 - tpPips * pipSize;

    const riskAmountTotal = balance * 0.05; // 5% risk
    const numEntries = 1 + (multiConfig.offset2 !== null ? 1 : 0) + (multiConfig.offset3 !== null ? 1 : 0);
    const riskPerTrade = multiConfig.riskMode === 'SPLIT' ? riskAmountTotal / numEntries : riskAmountTotal;
    
    const minRisk = 0.01 * slPips * pipValuePerLot;
    if (minRisk > riskPerTrade) continue;

    const calcLots1 = riskPerTrade / (slPips * pipValuePerLot);
    const lots1 = Math.max(0.01, Math.min(0.2, parseFloat(calcLots1.toFixed(2))));

    let activeTrades: ActiveTrade[] = [{
       entryPrice: entryPrice1,
       slPrice: slPriceInit1,
       tpPrice: tpPrice1,
       lots: lots1,
       id: 1
    }];

    let closedProfit = 0;
    const maxExitTime = s.entryCandle.time + (manualCloseHours * 60 * 60 * 1000);

    const time2 = multiConfig.offset2 !== null ? s.entryCandle.time + multiConfig.offset2 * 60 * 1000 : null;
    const time3 = multiConfig.offset3 !== null ? s.entryCandle.time + multiConfig.offset3 * 60 * 1000 : null;
    let t2Triggered = false;
    let t3Triggered = false;

    // Helper to evaluate and add a new trade
    const tryAddTrade = (id: number, c: Candle, prevCandle: Candle) => {
        let valid = true;
        if (multiConfig.confMode === 'ENGULFING') {
            const prevIsBullish = prevCandle.close > prevCandle.open;
            const currIsBullish = c.close > c.open;
            const engBullish = !prevIsBullish && currIsBullish && c.close > prevCandle.open && c.open < prevCandle.close;
            const engBearish = prevIsBullish && !currIsBullish && c.close < prevCandle.open && c.open > prevCandle.close;
            if (bias === 'BUY' && !engBullish) valid = false;
            if (bias === 'SELL' && !engBearish) valid = false;
        }

        if (valid) {
            const ep = bias === 'BUY' ? c.close + spread : c.close;
            let slP = multiConfig.slTpMode === 'SHARED' ? slPriceInit1 : (bias === 'BUY' ? ep - slPips * pipSize : ep + slPips * pipSize);
            let tpP = multiConfig.slTpMode === 'SHARED' ? tpPrice1 : (bias === 'BUY' ? ep + tpPips * pipSize : ep - tpPips * pipSize);
            
            const distPips = Math.abs(ep - slP) / pipSize;
            if (distPips > 0) {
               const calcL = riskPerTrade / (distPips * pipValuePerLot);
               const l = Math.max(0.01, Math.min(0.2, parseFloat(calcL.toFixed(2))));
               activeTrades.push({ entryPrice: ep, slPrice: slP, tpPrice: tpP, lots: l, id });
            }
        }
    };

    for (let j = 0; j < s.tradeCandles.length; j++) {
      const c = s.tradeCandles[j];
      const prevC = j > 0 ? s.tradeCandles[j-1] : s.entryCandle;

      if (time2 && c.time >= time2 && !t2Triggered) {
         t2Triggered = true;
         // Only add if we still have trades active (e.g. didn't hit SL on trade 1)
         if (activeTrades.length > 0) tryAddTrade(2, c, prevC);
      }
      
      if (time3 && c.time >= time3 && !t3Triggered) {
         t3Triggered = true;
         if (activeTrades.length > 0) tryAddTrade(3, c, prevC);
      }

      let nextActive: ActiveTrade[] = [];
      for(const t of activeTrades) {
         let closed = false;
         if (c.time >= maxExitTime) {
            const exitPrice = bias === 'BUY' ? c.close : c.close + spread;
            const profitPips = bias === 'BUY' ? (exitPrice - t.entryPrice) / pipSize : (t.entryPrice - exitPrice) / pipSize;
            closedProfit += (profitPips * pipValuePerLot * t.lots) - (commissionRoundTrip * t.lots);
            closed = true;
         } else if (bias === 'BUY') {
            if (c.low <= t.slPrice) {
               const lossPips = (t.entryPrice - t.slPrice) / pipSize;
               closedProfit += -(lossPips * pipValuePerLot * t.lots) - (commissionRoundTrip * t.lots);
               closed = true;
            } else if (c.high >= t.tpPrice) {
               const profitPips = (t.tpPrice - t.entryPrice) / pipSize;
               closedProfit += (profitPips * pipValuePerLot * t.lots) - (commissionRoundTrip * t.lots);
               closed = true;
            } else if (breakeven && c.high >= t.entryPrice + (tpPips / 2) * pipSize) {
               t.slPrice = Math.max(t.slPrice, t.entryPrice);
            }
         } else {
            if (c.high + spread >= t.slPrice) {
               const lossPips = (t.slPrice - t.entryPrice) / pipSize;
               closedProfit += -(lossPips * pipValuePerLot * t.lots) - (commissionRoundTrip * t.lots);
               closed = true;
            } else if (c.low <= t.tpPrice) {
               const profitPips = (t.entryPrice - t.tpPrice) / pipSize;
               closedProfit += (profitPips * pipValuePerLot * t.lots) - (commissionRoundTrip * t.lots);
               closed = true;
            } else if (breakeven && c.low <= t.entryPrice - (tpPips / 2) * pipSize) {
               t.slPrice = Math.min(t.slPrice, t.entryPrice);
            }
         }
         if (!closed) nextActive.push(t);
      }
      activeTrades = nextActive;

      // Early exit optimization
      if (activeTrades.length === 0 && (!time2 || t2Triggered) && (!time3 || t3Triggered)) {
         break;
      }
    }

    for (const t of activeTrades) {
      if (s.tradeCandles.length > 0) {
        const last = s.tradeCandles[s.tradeCandles.length - 1];
        const profitPips = bias === 'BUY' ? (last.close - t.entryPrice) / pipSize : (t.entryPrice - last.close) / pipSize;
        closedProfit += (profitPips * pipValuePerLot * t.lots) - (commissionRoundTrip * t.lots);
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

async function scanPair(pair: string, dataDir: string, config: any, scenarios: MultiEntryConfig[]) {
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
  const spread = pipSize + (slippagePips * pipSize);
  
  const years = [2021, 2022, 2023, 2024, 2025];
  
  // Preprocess setups once to save massive amounts of CPU
  // Limit to only dates within our years
  const startDate = new Date('2021-05-01T00:00:00Z').getTime();
  const endDate = new Date('2026-05-01T00:00:00Z').getTime();
  const validDateKeys = dateKeys.filter(k => {
     const t = new Date(k + 'T00:00:00Z').getTime();
     return t >= startDate && t < endDate;
  });
  
  const setups = preProcessSetups(daysObj, validDateKeys, [config.hr], [config.min], [config.emaPeriod]);

  const resultsByScenario: { scenario: MultiEntryConfig, name: string, profit: number, maxDD: number, winRate: number, trades: number }[] = [];

  for (const scen of scenarios) {
     const result = runStrategyFast(
        setups, config.hr, config.min, config.sl, config.tp,
        config.reverse, config.breakeven, config.confirmation, config.manualCloseHrs, config.emaPeriod,
        pipSize, spread, commissionRT, pipValuePerLot,
        scen
     );
     
     let nameParts = ['Base'];
     if (scen.offset2) nameParts.push(`T2(+${scen.offset2}m)`);
     if (scen.offset3) nameParts.push(`T3(+${scen.offset3}m)`);
     if (scen.offset2) {
         nameParts.push(`Risk:${scen.riskMode}`);
         nameParts.push(`SL:${scen.slTpMode}`);
         nameParts.push(`Conf:${scen.confMode}`);
     }
     
     resultsByScenario.push({
        scenario: scen,
        name: nameParts.join(' | '),
        profit: result.profit,
        maxDD: result.maxDD,
        winRate: result.winRate,
        trades: result.trades
     });
  }

  // Sort by profit descending
  resultsByScenario.sort((a, b) => b.profit - a.profit);
  
  return { pair, results: resultsByScenario };
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'data');
  const configsRaw = fs.readFileSync('optimal_forex_configs.json', 'utf-8');
  const optimalConfigs = JSON.parse(configsRaw);

  // Generate Scenarios
  const scenarios: MultiEntryConfig[] = [];
  
  // 1. Baseline
  scenarios.push({ offset2: null, offset3: null, riskMode: 'FULL', slTpMode: 'INDEPENDENT', confMode: 'BLIND' });
  
  const riskModes: ('SPLIT' | 'FULL')[] = ['SPLIT', 'FULL'];
  const slTpModes: ('INDEPENDENT' | 'SHARED')[] = ['INDEPENDENT', 'SHARED'];
  const confModes: ('BLIND' | 'ENGULFING')[] = ['BLIND', 'ENGULFING'];
  
  // 2. Two Entries
  for (const o2 of [30, 60, 90]) {
     for (const rm of riskModes) {
         for (const st of slTpModes) {
             for (const cm of confModes) {
                 scenarios.push({ offset2: o2, offset3: null, riskMode: rm, slTpMode: st, confMode: cm });
             }
         }
     }
  }

  // 3. Three Entries (constrained to a few logical ladders)
  const threeEntryLadders = [
      { o2: 30, o3: 60 },
      { o2: 60, o3: 120 }
  ];
  for (const l of threeEntryLadders) {
     for (const rm of riskModes) {
         for (const st of slTpModes) {
             for (const cm of confModes) {
                 scenarios.push({ offset2: l.o2, offset3: l.o3, riskMode: rm, slTpMode: st, confMode: cm });
             }
         }
     }
  }

  console.log(`Running ${scenarios.length} scenarios per pair for ${optimalConfigs.length} pairs...`);

  let markdown = '# Multi-Entry Optimization Report\n\n';
  markdown += `This report simulates taking 2nd and 3rd entries across all possible combinations of Risk Management (Split vs Full), Stop Loss placement (Independent vs Shared), and Entry Confirmation (Blind vs Engulfing). Tested over the 5-year data window.\n\n`;

  for (let i = 0; i < optimalConfigs.length; i++) {
    const item = optimalConfigs[i];
    console.log(`Processing [${i+1}/${optimalConfigs.length}] ${item.pair}...`);
    const c = item.bestResult;
    const data = await scanPair(item.pair, dataDir, c, scenarios);
    
    if (data) {
       markdown += `## ${item.pair}\n`;
       markdown += `**Base Setup:** ${c.hr}:${c.min} UTC | Rev:${c.reverse} | SL:${c.sl} | TP:${c.tp} | EMA:${c.emaPeriod}\n\n`;
       
       // Top 5 setups
       markdown += '| Rank | Configuration | Profit | Max Drawdown | Win Rate | Trades |\n';
       markdown += '|---|---|---|---|---|---|\n';
       for (let j = 0; j < Math.min(10, data.results.length); j++) {
           const r = data.results[j];
           let icon = j === 0 ? '🏆 ' : '';
           const isBaseline = r.scenario.offset2 === null;
           if (isBaseline) icon += '(Baseline) ';
           markdown += `| ${j+1} | ${icon}${r.name} | $${r.profit.toFixed(2)} | ${r.maxDD.toFixed(1)}% | ${r.winRate.toFixed(1)}% | ${r.trades} |\n`;
       }
       
       // Find baseline rank
       const baselineIdx = data.results.findIndex(r => r.scenario.offset2 === null);
       const baseline = data.results[baselineIdx];
       markdown += `\n*Note: The Baseline (1 Entry) ranked #${baselineIdx + 1} out of ${scenarios.length} with a profit of $${baseline.profit.toFixed(2)}.*\n\n`;
       markdown += '---\n\n';
    }
  }

  const artifactsDir = path.join('C:', 'Users', 'tazim', '.gemini', 'antigravity', 'brain', 'ed74d6b2-80e4-4426-b22c-a3a73203ea55');
  fs.writeFileSync(path.join(artifactsDir, 'multi_entry_report.md'), markdown);
  console.log('Finished optimization! Report created.');
}

main().catch(console.error);
