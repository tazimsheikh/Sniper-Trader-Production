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

async function scanPair(pair: string, dataDir: string, config: any) {
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

  const isGold = pair.includes('XAU');
  const isJpy = pair.includes('JPY');
  const pipSize = isGold || isJpy ? 0.01 : 0.0001;
  const pipValuePerLot = isGold ? 1 : 10;
  const commissionRT = 7;
  const slippagePips = 1.0;
  const spread = pipSize + (slippagePips * pipSize);
  
  const years = [2021, 2022, 2023, 2024, 2025];
  const yearlyResults: any[] = [];
  
  let total5YearProfit = 0;

  for (const year of years) {
    const startStr = `${year}-05-01T00:00:00Z`;
    const endStr = `${year + 1}-05-01T00:00:00Z`;
    const startDate = new Date(startStr).getTime();
    const endDate = new Date(endStr).getTime();
    
    const recentDateKeys = dateKeys.filter(k => {
      const time = new Date(k + 'T00:00:00Z').getTime();
      return time >= startDate && time < endDate;
    });
    
    if (recentDateKeys.length < 50) continue; // Not enough data for this year (e.g., 2026 isn't full)
    
    const setups = preProcessSetups(daysObj, recentDateKeys, [config.hr], [config.min], [config.emaPeriod]);
    
    const result = runStrategyFast(
      setups, config.hr, config.min, config.sl, config.tp,
      config.reverse, config.breakeven, config.confirmation, config.manualCloseHrs, config.emaPeriod,
      pipSize, spread, commissionRT, pipValuePerLot
    );
    
    yearlyResults.push({
      year: `${year}-${year+1}`,
      profit: result.profit,
      maxDD: result.maxDD,
      winRate: result.winRate,
      trades: result.trades
    });
    total5YearProfit += result.profit;
  }
  
  return { pair, config, yearlyResults, total5YearProfit };
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'data');
  const configsRaw = fs.readFileSync('optimal_forex_configs.json', 'utf-8');
  const optimalConfigs = JSON.parse(configsRaw);

  const allResults = [];
  
  let markdown = '# 5-Year Historical Performance Breakdown\n\n';
  markdown += 'This report simulates a `$1000` starting account independently each year, strictly running the optimized settings.\n\n';

  for (const item of optimalConfigs) {
    const pair = item.pair;
    const c = item.bestResult;
    const data = await scanPair(pair, dataDir, c);
    
    if (data) {
       allResults.push(data);
       markdown += `## ${pair}\n`;
       markdown += `**Setup:** ${c.hr}:${c.min} UTC | Rev:${c.reverse} | SL:${c.sl} | TP:${c.tp} | EMA:${c.emaPeriod} | BE:${c.breakeven} | Conf:${c.confirmation}\n\n`;
       markdown += '| Period | Trades | Win Rate | Max Drawdown | Profit |\n';
       markdown += '|---|---|---|---|---|\n';
       for (const yr of data.yearlyResults) {
          markdown += `| ${yr.year} | ${yr.trades} | ${yr.winRate.toFixed(1)}% | ${yr.maxDD.toFixed(1)}% | $${yr.profit.toFixed(2)} |\n`;
       }
       markdown += `**Average Yearly Profit:** $${(data.total5YearProfit / 5).toFixed(2)}\n\n`;
       markdown += '---\n\n';
    }
  }

  const artifactsDir = path.join('C:', 'Users', 'tazim', '.gemini', 'antigravity', 'brain', 'f529c87d-343b-47d8-88e2-cb3ac3fe3e4d');
  fs.writeFileSync(path.join(artifactsDir, '5_year_performance_report.md'), markdown);
  console.log('Finished 5-year backtest! Artifact created.');
}

main().catch(console.error);
