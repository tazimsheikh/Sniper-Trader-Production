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

interface Trade {
  entryTime: number;
  exitTime: number;
  profit: number; // in dollars
}

const STARTING_BALANCE = 100; // Realistic starting balance

// Helper to parse candle
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

function runStrategyForTrades(
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  entryHour: number, entryMin: number,
  slPips: number, tpPips: number,
  riskPct: number, emaPeriod: number,
  reverse: boolean, pipSize: number, spread: number,
  commissionRoundTrip: number,
  pipValuePerLot: number
): Trade[] {
  let balance = STARTING_BALANCE;
  let emaHtf = 0;
  const trades: Trade[] = [];

  for (let d = 1; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const todayCandles = daysObj[dateKeys[d]];
    if (!todayCandles || todayCandles.length < 60) continue;

    for (const c of todayCandles) {
      if (emaHtf === 0) emaHtf = c.close;
      else emaHtf = c.close * (2 / (emaPeriod + 1)) + emaHtf * (1 - 2 / (emaPeriod + 1));
    }

    const entryCandle = todayCandles.find(c => {
      const [h, m] = c.timeStr.split(':').map(Number);
      return h === entryHour && m === entryMin;
    });
    if (!entryCandle) continue;

    let bias: 'BUY' | 'SELL' = entryCandle.close > emaHtf ? 'BUY' : 'SELL';
    if (reverse) bias = bias === 'BUY' ? 'SELL' : 'BUY';

    const entryPrice = bias === 'BUY' ? entryCandle.close + spread : entryCandle.close;
    const slPrice = bias === 'BUY' ? entryPrice - slPips * pipSize : entryPrice + slPips * pipSize;
    const tpPrice = bias === 'BUY' ? entryPrice + tpPips * pipSize : entryPrice - tpPips * pipSize;

    const riskAmount = balance * (riskPct / 100);
    // Dynamic Trade Rejection
    const minRisk = 0.01 * slPips * pipValuePerLot;
    if (minRisk > riskAmount) {
      continue;
    }
    
    // Hard cap max lots to 0.1
    const calculatedLots = riskAmount / (slPips * pipValuePerLot);
    const lots = Math.max(0.01, Math.min(0.1, parseFloat(calculatedLots.toFixed(2))));

    const tradeCandles = todayCandles.filter(c => c.time > entryCandle.time);
    let closed = false;
    let currentSlPrice = slPrice;

    for (const c of tradeCandles) {
      if (bias === 'BUY') {
        if (c.low <= currentSlPrice) {
          const lossPips = (entryPrice - currentSlPrice) / pipSize;
          const profit = -(lossPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push({ entryTime: entryCandle.time, exitTime: c.time, profit });
          closed = true; break;
        }
        if (c.high >= tpPrice) {
          const profit = (tpPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push({ entryTime: entryCandle.time, exitTime: c.time, profit });
          closed = true; break;
        }
        // Move to breakeven if 50% to TP
        if (c.high >= entryPrice + (tpPips / 2) * pipSize) {
          currentSlPrice = Math.max(currentSlPrice, entryPrice);
        }
      } else {
        if (c.high + spread >= currentSlPrice) {
          const lossPips = (currentSlPrice - entryPrice) / pipSize;
          const profit = -(lossPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push({ entryTime: entryCandle.time, exitTime: c.time, profit });
          closed = true; break;
        }
        if (c.low <= tpPrice) {
          const profit = (tpPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
          balance += profit;
          trades.push({ entryTime: entryCandle.time, exitTime: c.time, profit });
          closed = true; break;
        }
        // Move to breakeven if 50% to TP
        if (c.low <= entryPrice - (tpPips / 2) * pipSize) {
          currentSlPrice = Math.min(currentSlPrice, entryPrice);
        }
      }
    }

    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const profitPips = bias === 'BUY' ? (last.close - entryPrice) / pipSize : (entryPrice - last.close) / pipSize;
      const profit = (profitPips * pipValuePerLot * lots) - (commissionRoundTrip * lots);
      balance += profit;
      trades.push({ entryTime: entryCandle.time, exitTime: last.time, profit });
    }
  }

  return trades;
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'data');
  const files = fs.readdirSync(rootDir);
  const optimizerFiles = files.filter(f => f.startsWith('optimizer_') && f.endsWith('.json'));

  const pairsData: { pair: string, trades: Trade[] }[] = [];

  // End Date for simulation logic: max date across our dataset is around 2026-05-01
  const END_DATE = new Date('2026-05-01T00:00:00Z').getTime();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  for (const optFile of optimizerFiles) {
    const pairMatch = optFile.match(/optimizer_(.*)\.json/);
    if (!pairMatch) continue;
    const pair = pairMatch[1];
    
    const configData = JSON.parse(fs.readFileSync(path.join(rootDir, optFile), 'utf-8'));
    if (!configData.top5 || configData.top5.length === 0) continue;
    
    // Choose the best performing config
    const topConfig = configData.top5[0].params;
    
    const pipSize = configData.pipSize || (pair.includes('JPY') ? 0.01 : 0.0001);
    
    // Realistic penalties
    // Commission: standard raw spread account is ~$7 per lot RT
    const commissionRT = 7;
    // User requested 1 pip slippage
    const slippagePips = 1.0;
    const baseSpread = pipSize; // 1 pip base
    const totalSpreadSlippage = baseSpread + (slippagePips * pipSize);

    const dataFiles = fs.readdirSync(dataDir);
    const dataFile = dataFiles.find(f => f.startsWith(pair) && f.endsWith('.csv'));
    
    if (!dataFile) {
      console.log(`Skipping ${pair}, no data file.`);
      continue;
    }

    console.log(`Processing ${pair} with realistic slippage of ${slippagePips} pips...`);
    const candles = await loadData(path.join(dataDir, dataFile));
    
    const daysObj: Record<string, Candle[]> = {};
    for (const c of candles) {
      if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
      daysObj[c.dateStr].push(c);
    }
    const dateKeys = Object.keys(daysObj).sort();

    const pipValuePerLot = pair.includes('XAU') ? 1 : 10;

    const trades = runStrategyForTrades(
      daysObj, dateKeys,
      topConfig.hr, topConfig.min,
      topConfig.sl, topConfig.tp,
      topConfig.risk || 5, topConfig.ema,
      topConfig.reverse, pipSize, totalSpreadSlippage,
      commissionRT, pipValuePerLot
    );

    pairsData.push({ pair, trades });
  }

  // Periods: 1w, 1m, 3m, 6m, 1y
  const periods = [
    { name: '1 Week', ms: 7 * ONE_DAY },
    { name: '1 Month', ms: 30 * ONE_DAY },
    { name: '3 Months', ms: 91 * ONE_DAY },
    { name: '6 Months', ms: 182 * ONE_DAY },
    { name: '1 Year', ms: 365 * ONE_DAY },
  ];

  console.log('\n=============================================');
  console.log('    REALISTIC BACKTEST REPORT GENERATED');
  console.log('=============================================\n');

  const reportData: any = {};

  for (const period of periods) {
    const startTime = END_DATE - period.ms;
    reportData[period.name] = { pairs: {}, combined: { profit: 0, maxDD: 0, trades: 0 } };

    // To calculate combined drawdown accurately over time, we need to interleave all trades by time
    const combinedTrades = [];

    for (const { pair, trades } of pairsData) {
      const periodTrades = trades.filter(t => t.entryTime >= startTime && t.entryTime <= END_DATE);
      
      let balance = STARTING_BALANCE;
      let peak = STARTING_BALANCE;
      let maxDD = 0;
      let wins = 0;

      for (const t of periodTrades) {
        balance += t.profit;
        if (balance > peak) peak = balance;
        const dd = ((peak - balance) / peak) * 100;
        if (dd > maxDD) maxDD = dd;
        if (t.profit > 0) wins++;
        
        combinedTrades.push(t);
      }

      reportData[period.name].pairs[pair] = {
        profit: balance - STARTING_BALANCE,
        maxDD: maxDD,
        tradeCount: periodTrades.length,
        winRate: periodTrades.length > 0 ? (wins / periodTrades.length * 100) : 0
      };
    }

    // Sort combined trades by time to calculate combined DD
    combinedTrades.sort((a, b) => a.entryTime - b.entryTime);
    
    // We assume a single combined account of $100 for the combined drawdown metric
    let combBalance = 100;
    let combPeak = 100;
    let combMaxDD = 0;

    for (const t of combinedTrades) {
      combBalance += t.profit;
      if (combBalance > combPeak) combPeak = combBalance;
      const dd = ((combPeak - combBalance) / combPeak) * 100;
      if (dd > combMaxDD) combMaxDD = dd;
    }

    reportData[period.name].combined = {
      profit: combBalance - 100,
      maxDD: combMaxDD,
      tradeCount: combinedTrades.length
    };
  }

  // Output formatting to MD
  let md = '# Realistic Trading Bot Backtest Report\n\n';
  md += 'This report evaluates the realistic performance of the deployed trading bots over the last 1 week, 1 month, 3 months, 6 months, and 1 year. ';
  md += 'It incorporates strict market realism variables to ensure output mirrors live execution conditions:\n';
  md += '- **Starting Balance:** $100 per pair ($100 for Combined Portfolio)\n';
  md += '- **Risk per Trade:** 5%\n';
  md += '- **Maximum Lot Cap:** 0.1 Lots\n';
  md += '- **Safety Mechanisms:** Dynamic Trade Rejection (skips trade if min 0.01 lot > 5% risk) & Breakeven Trailing Stops (at 50% TP)\n';
  md += '- **Slippage & Spread penalty:** 1 pip broker spread + 1 pip slippage (-1 pip slippage)\n';
  md += '- **Commission:** $7 round-trip per standard lot\n\n';

  for (const period of periods) {
    const data = reportData[period.name];
    md += `## Performance: Last ${period.name}\n\n`;
    md += '| Pair | Total Profit | Max Drawdown | Trades | Win Rate |\n';
    md += '|------|-------------:|-------------:|-------:|---------:|\n';

    for (const [pair, stats] of Object.entries(data.pairs)) {
      const s = stats as any;
      md += `| ${pair} | $${s.profit.toFixed(2)} | ${s.maxDD.toFixed(2)}% | ${s.tradeCount} | ${s.winRate.toFixed(1)}% |\n`;
    }

    md += `| **COMBINED PORTFOLIO** | **$${data.combined.profit.toFixed(2)}** | **${data.combined.maxDD.toFixed(2)}%** | **${data.combined.tradeCount}** | **-** |\n\n`;
  }

  fs.writeFileSync(path.join(rootDir, 'backtest_report_generated.md'), md);
  console.log('Report successfully generated at backtest_report_generated.md');
}

main().catch(console.error);
