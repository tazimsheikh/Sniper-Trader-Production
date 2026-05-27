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

const STARTING_BALANCE = 100;

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

    // Calculate EMAs for the whole day to cache them at each candle index
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

function runStrategyFast(
  setups: TradeSetup[],
  hr: number, min: number,
  slPips: number, tpPips: number,
  reverse: boolean, breakeven: boolean,
  confirmation: 'none' | 'engulfing',
  manualCloseHours: number, emaPeriod: number,
  pipSize: number, spread: number,
  commissionRoundTrip: number,
  pipValuePerLot: number
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

    if (confirmation === 'engulfing') {
      if (bias === 'BUY' && !s.engulfingBullish) continue;
      if (bias === 'SELL' && !s.engulfingBearish) continue;
    }

    const entryPrice = bias === 'BUY' ? s.entryCandle.close + spread : s.entryCandle.close;
    const slPriceInit = bias === 'BUY' ? entryPrice - slPips * pipSize : entryPrice + slPips * pipSize;
    const tpPrice = bias === 'BUY' ? entryPrice + tpPips * pipSize : entryPrice - tpPips * pipSize;

    const riskAmount = balance * 0.05; // 5% risk
    const minRisk = 0.01 * slPips * pipValuePerLot;
    if (minRisk > riskAmount) continue;

    const calculatedLots = riskAmount / (slPips * pipValuePerLot);
    const lots = Math.max(0.01, Math.min(0.1, parseFloat(calculatedLots.toFixed(2)))); // Max 0.1 lots

    let closed = false;
    let currentSlPrice = slPriceInit;
    const maxExitTime = s.entryCandle.time + (manualCloseHours * 60 * 60 * 1000);

    for (let j = 0; j < s.tradeCandles.length; j++) {
      const c = s.tradeCandles[j];
      if (c.time >= maxExitTime) {
        const exitPrice = bias === 'BUY' ? c.close : c.close + spread;
        const profitPips = bias === 'BUY' ? (exitPrice - entryPrice) / pipSize : (entryPrice - exitPrice) / pipSize;
        const profit = (profitPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
        balance += profit;
        trades.push(profit);
        closed = true; break;
      }

      if (bias === 'BUY') {
        if (c.low <= currentSlPrice) {
          const lossPips = (entryPrice - currentSlPrice) / pipSize;
          const profit = -(lossPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push(profit);
          closed = true; break;
        }
        if (c.high >= tpPrice) {
          const profit = (tpPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push(profit);
          closed = true; break;
        }
        if (breakeven && c.high >= entryPrice + (tpPips / 2) * pipSize) {
          currentSlPrice = Math.max(currentSlPrice, entryPrice);
        }
      } else {
        if (c.high + spread >= currentSlPrice) {
          const lossPips = (currentSlPrice - entryPrice) / pipSize;
          const profit = -(lossPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push(profit);
          closed = true; break;
        }
        if (c.low <= tpPrice) {
          const profit = (tpPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push(profit);
          closed = true; break;
        }
        if (breakeven && c.low <= entryPrice - (tpPips / 2) * pipSize) {
          currentSlPrice = Math.min(currentSlPrice, entryPrice);
        }
      }
    }

    if (!closed && s.tradeCandles.length > 0) {
      const last = s.tradeCandles[s.tradeCandles.length - 1];
      const profitPips = bias === 'BUY' ? (last.close - entryPrice) / pipSize : (entryPrice - last.close) / pipSize;
      const profit = (profitPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
      balance += profit;
      trades.push(profit);
    }

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

async function scanPair(pair: string, dataDir: string) {
  const dataFiles = fs.readdirSync(dataDir);
  const dataFile = dataFiles.find(f => f.startsWith(pair) && f.endsWith('.csv'));
  if (!dataFile) return null;

  console.log(`Scanning ${pair}...`);
  const candles = await loadData(path.join(dataDir, dataFile));
  
  const daysObj: Record<string, Candle[]> = {};
  for (const c of candles) {
    if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
    daysObj[c.dateStr].push(c);
  }
  const dateKeys = Object.keys(daysObj).sort();
  
  const END_DATE = new Date('2026-05-01T00:00:00Z').getTime();
  const START_DATE = END_DATE - (5 * 365 * 24 * 60 * 60 * 1000); // 5 years
  const recentDateKeys = dateKeys.filter(k => {
    const time = new Date(k + 'T00:00:00Z').getTime();
    return time >= START_DATE && time <= END_DATE;
  });

  const isGold = pair.includes('XAU');
  const isJpy = pair.includes('JPY');
  const pipSize = isGold || isJpy ? 0.01 : 0.0001;
  const pipValuePerLot = isGold ? 1 : 10;
  const commissionRT = 7;
  const slippagePips = 1.0;
  const spread = pipSize + (slippagePips * pipSize);

  const hours = [7, 8, 9, 13, 14, 15]; // Classic London and NY opens
  const minutes = [0, 15, 30, 45];
  const emaPeriods = [50, 100, 240];
  
  console.log(`  Pre-processing setups...`);
  const setups = preProcessSetups(daysObj, recentDateKeys, hours, minutes, emaPeriods);

  const reverses = [true, false];
  const slPipsArr = isGold ? [200, 300] : [20, 25, 30, 40]; // Tight stops
  const tpMultipliers = [1, 1.5, 2, 3]; // Realistic targets (1:1, 1:2)
  const breakevens = [false, true];
  const confirmations: ('none'|'engulfing')[] = ['none', 'engulfing'];
  const manualCloseHrsArr = [4, 8];

  let bestResult: any = null;
  let permutations = 0;

  console.log(`  Executing grid search over combinations...`);
  for (const hr of hours) {
    for (const min of minutes) {
      for (const reverse of reverses) {
        for (const sl of slPipsArr) {
          for (const tpMult of tpMultipliers) {
             const tp = sl * tpMult;
             for (const be of breakevens) {
               for (const conf of confirmations) {
                 for (const closeHrs of manualCloseHrsArr) {
                    for (const ema of emaPeriods) {
                        permutations++;
                        const result = runStrategyFast(
                          setups, hr, min, sl, tp,
                          reverse, be, conf, closeHrs, ema, pipSize, spread, commissionRT, pipValuePerLot
                        );

                        if (result.trades > 20) { // allow slightly fewer trades since wider stops trigger less frequently
                          // Score penalizes DD more aggressively if it's over 40%
                          let ddPenalty = Math.max(result.maxDD, 1);
                          if (result.maxDD > 40) ddPenalty *= 2; 
                          const score = result.profit / ddPenalty;

                          if (!bestResult || score > bestResult.score) {
                            bestResult = {
                              hr, min, reverse, sl, tp, breakeven: be, confirmation: conf, manualCloseHrs: closeHrs, emaPeriod: ema,
                              score, ...result
                            };
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

  if (bestResult && bestResult.profit > 0) {
    console.log(`✅ [${pair}] Best: ${bestResult.hr}:${bestResult.min} | Rev:${bestResult.reverse} | SL:${bestResult.sl} | TP:${bestResult.tp} | EMA:${bestResult.emaPeriod} | BE:${bestResult.breakeven} | Conf:${bestResult.confirmation} | CloseHr:${bestResult.manualCloseHrs} -> Profit: $${bestResult.profit.toFixed(2)}, DD: ${bestResult.maxDD.toFixed(1)}%, WinRate: ${bestResult.winRate.toFixed(1)}%`);
    return { pair, bestResult };
  } else {
    console.log(`❌ [${pair}] No profitable setup found.`);
    return null;
  }
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'data');
  const pairs = [
    'AUDJPY', 'AUDUSD', 'CHFJPY', 'EURAUD', 'EURCAD', 'EURCHF',
    'EURJPY', 'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPJPY', 'GBPUSD',
    'NAS100', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY', 'XAUUSD'
  ];

  const optimalConfigs = [];

  for (const pair of pairs) {
    const data = await scanPair(pair, dataDir);
    if (data?.bestResult) {
       optimalConfigs.push(data);
    }
  }

  fs.writeFileSync('optimal_forex_configs.json', JSON.stringify(optimalConfigs, null, 2));
  console.log('Finished scanning all pairs! Configs saved to optimal_forex_configs.json');
}

main().catch(console.error);
