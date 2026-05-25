/**
 * forexOptimizerV4.ts — Deep 5-pair optimizer
 *
 * Finds high-return, low-drawdown session-fade strategies for:
 *   EURUSD, AUDUSD, USDCHF, USDCAD, NZDUSD
 *
 * Uses 5-year M1 candle data. Tracks max drawdown in addition to returns.
 * Risk is fixed at 5% per trade (compounding). Starting balance = $100.
 */

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

interface BacktestResult {
  finalBalance: number;
  trades: number;
  wins: number;
  wr: number;
  maxDD: number;        // max drawdown %
  peakBalance: number;
  returnPct: number;
}

interface StrategyParams {
  pair: string;
  riskPct: number;
  emaPeriod: number;
  entryHour: number;
  entryMin: number;
  slPips: number;
  tpPips: number;
  reverse: boolean;     // true = mean-reversion (fade the EMA), false = trend-follow
}

const PIP_VALUE_PER_LOT = 10;
const STARTING_BALANCE = 100;

async function loadData(filePath: string): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const results: Candle[] = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    let isFirstLine = true;
    let buffer = '';

    stream.on('data', (chunk: string) => {
      buffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (isFirstLine) { isFirstLine = false; continue; }
        if (!line) continue;

        const parts = line.split('\t');
        if (parts.length < 6) continue;

        const dateStr = parts[0].replace(/\./g, '-');
        const timeStr = parts[1];
        const open  = parseFloat(parts[2]);
        const high  = parseFloat(parts[3]);
        const low   = parseFloat(parts[4]);
        const close = parseFloat(parts[5]);

        if (isNaN(open)) continue;

        results.push({
          dateStr,
          timeStr,
          time: new Date(`${dateStr}T${timeStr}Z`).getTime(),
          open, high, low, close,
        });
      }
    });

    stream.on('end', () => {
      // Process remaining buffer
      if (buffer.trim()) {
        const parts = buffer.trim().split('\t');
        if (parts.length >= 6) {
          const dateStr = parts[0].replace(/\./g, '-');
          const timeStr = parts[1];
          results.push({
            dateStr, timeStr,
            time: new Date(`${dateStr}T${timeStr}Z`).getTime(),
            open: parseFloat(parts[2]),
            high: parseFloat(parts[3]),
            low: parseFloat(parts[4]),
            close: parseFloat(parts[5]),
          });
        }
      }
      resolve(results);
    });
    stream.on('error', reject);
  });
}

function runStrategy(
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  params: StrategyParams,
  pipSize: number,
  spread: number,
): BacktestResult {
  let balance = STARTING_BALANCE;
  let peakBalance = STARTING_BALANCE;
  let maxDD = 0;
  let wins = 0;
  let totalTrades = 0;
  let emaHtf = 0;

  for (let d = 1; d < dateKeys.length; d++) {
    if (balance <= 0) break;
    const todayCandles = daysObj[dateKeys[d]];
    if (!todayCandles || todayCandles.length < 60) continue;

    // Update HTF EMA on all M1 closes of today
    for (const c of todayCandles) {
      if (emaHtf === 0) emaHtf = c.close;
      else emaHtf = c.close * (2 / (params.emaPeriod + 1)) + emaHtf * (1 - 2 / (params.emaPeriod + 1));
    }

    // Find entry candle at the specified hour:minute
    const entryCandle = todayCandles.find(c => {
      const [h, m] = c.timeStr.split(':').map(Number);
      return h === params.entryHour && m === params.entryMin;
    });
    if (!entryCandle) continue;

    // Determine bias
    let bias: 'BUY' | 'SELL' = entryCandle.close > emaHtf ? 'BUY' : 'SELL';
    if (params.reverse) bias = bias === 'BUY' ? 'SELL' : 'BUY';

    const entryPrice = bias === 'BUY' ? entryCandle.close + spread : entryCandle.close;
    const slPrice = bias === 'BUY'
      ? entryPrice - params.slPips * pipSize
      : entryPrice + params.slPips * pipSize;
    const tpPrice = bias === 'BUY'
      ? entryPrice + params.tpPips * pipSize
      : entryPrice - params.tpPips * pipSize;

    const riskAmount = balance * (params.riskPct / 100);
    const lots = Math.max(0.01, Math.min(100,
      parseFloat((riskAmount / (params.slPips * PIP_VALUE_PER_LOT)).toFixed(2))
    ));

    // Simulate on remaining M1 candles of the day
    const tradeCandles = todayCandles.filter(c => c.time > entryCandle.time);
    let closed = false;

    for (const c of tradeCandles) {
      if (bias === 'BUY') {
        if (c.low <= slPrice) {
          balance -= params.slPips * PIP_VALUE_PER_LOT * lots;
          totalTrades++; closed = true; break;
        }
        if (c.high >= tpPrice) {
          balance += params.tpPips * PIP_VALUE_PER_LOT * lots;
          wins++; totalTrades++; closed = true; break;
        }
      } else {
        if (c.high + spread >= slPrice) {
          balance -= params.slPips * PIP_VALUE_PER_LOT * lots;
          totalTrades++; closed = true; break;
        }
        if (c.low <= tpPrice) {
          balance += params.tpPips * PIP_VALUE_PER_LOT * lots;
          wins++; totalTrades++; closed = true; break;
        }
      }
    }

    // EOD close if not stopped out
    if (!closed && tradeCandles.length > 0) {
      const last = tradeCandles[tradeCandles.length - 1];
      const profitPips = bias === 'BUY'
        ? (last.close - entryPrice) / pipSize
        : (entryPrice - last.close) / pipSize;
      balance += profitPips * PIP_VALUE_PER_LOT * lots;
      if (profitPips > 0) wins++;
      totalTrades++;
    }

    // Track drawdown
    if (balance > peakBalance) peakBalance = balance;
    const dd = ((peakBalance - balance) / peakBalance) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    finalBalance: balance,
    trades: totalTrades,
    wins,
    wr: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    maxDD,
    peakBalance,
    returnPct: ((balance - STARTING_BALANCE) / STARTING_BALANCE) * 100,
  };
}

// ── Session names for human-readable output ──────────────────────────────────
function sessionName(hour: number): string {
  if (hour >= 0 && hour <= 3) return 'Asian/Tokyo';
  if (hour >= 7 && hour <= 9) return 'London';
  if (hour >= 13 && hour <= 15) return 'New York';
  return `Session@${hour}:00`;
}

// ── Main optimizer loop ──────────────────────────────────────────────────────
async function optimizeAll() {
  const pairs = [
    { file: 'EURUSD_M1_202105030000_202605010159.csv', symbol: 'EURUSD', pipSize: 0.0001 },
    { file: 'AUDUSD_M1_202105030005_202605010159.csv', symbol: 'AUDUSD', pipSize: 0.0001 },
    { file: 'USDCHF_M1_202105030000_202605010159.csv', symbol: 'USDCHF', pipSize: 0.0001 },
    { file: 'USDCAD_M1_202105030000_202605010159.csv', symbol: 'USDCAD', pipSize: 0.0001 },
    { file: 'NZDUSD_M1_202105030000_202605010159.csv', symbol: 'NZDUSD', pipSize: 0.0001 },
  ];

  // Wide parameter sweep
  const riskPcts      = [5];
  const emaPeriods    = [30, 60, 120, 240, 480];   // 30M, 1H, 2H, 4H, 8H EMA
  const entryHours    = [0, 1, 2, 3, 7, 8, 9, 13, 14, 15];  // Asian, London, NY opens
  const entryMins     = [0, 15, 30];
  const slPipsOptions = [8, 10, 12, 15, 20];
  const tpPipsOptions = [12, 15, 20, 25, 30, 40, 45, 50];
  const reverseOpts   = [false, true];  // trend vs fade

  const totalCombos = riskPcts.length * emaPeriods.length * entryHours.length *
    entryMins.length * slPipsOptions.length * tpPipsOptions.length * reverseOpts.length;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  FOREX OPTIMIZER V4 — Deep 5-Year Backtest`);
  console.log(`  ${totalCombos} parameter combos × ${pairs.length} pairs = ${totalCombos * pairs.length} total runs`);
  console.log(`${'═'.repeat(70)}\n`);

  const allResults: Array<{
    symbol: string;
    params: StrategyParams;
    result: BacktestResult;
  }> = [];

  for (const pair of pairs) {
    const spread = pair.pipSize;  // 1 pip spread
    const fullPath = path.join(process.cwd(), 'data', pair.file);

    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  Data file not found: ${pair.file} — skipping.`);
      continue;
    }

    console.log(`📊 Loading ${pair.symbol} (${pair.file})...`);
    const candles = await loadData(fullPath);
    console.log(`   Loaded ${candles.length.toLocaleString()} M1 candles.`);

    // Group by day
    const daysObj: Record<string, Candle[]> = {};
    for (const c of candles) {
      if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
      daysObj[c.dateStr].push(c);
    }
    const dateKeys = Object.keys(daysObj).sort();
    console.log(`   ${dateKeys.length} trading days: ${dateKeys[0]} → ${dateKeys[dateKeys.length - 1]}`);

    let bestForPair: { params: StrategyParams; result: BacktestResult } | null = null;
    let combosRun = 0;

    // Top 10 results per pair (sorted by returnPct with DD < 30%)
    const top10: Array<{ params: StrategyParams; result: BacktestResult }> = [];

    for (const risk of riskPcts) {
      for (const ema of emaPeriods) {
        for (const hr of entryHours) {
          for (const min of entryMins) {
            for (const sl of slPipsOptions) {
              for (const tp of tpPipsOptions) {
                for (const reverse of reverseOpts) {
                  combosRun++;

                  const params: StrategyParams = {
                    pair: pair.symbol,
                    riskPct: risk,
                    emaPeriod: ema,
                    entryHour: hr,
                    entryMin: min,
                    slPips: sl,
                    tpPips: tp,
                    reverse,
                  };

                  const res = runStrategy(daysObj, dateKeys, params, pair.pipSize, spread);

                  // Only consider strategies with:
                  //   - Positive returns
                  //   - At least 200 trades (statistical significance over 5 years)
                  //   - Max drawdown <= 30%
                  if (res.finalBalance > STARTING_BALANCE && res.trades >= 200 && res.maxDD <= 30) {
                    // Insert into top 10
                    top10.push({ params, result: res });
                    top10.sort((a, b) => b.result.returnPct - a.result.returnPct);
                    if (top10.length > 10) top10.length = 10;

                    if (!bestForPair || res.returnPct > bestForPair.result.returnPct) {
                      bestForPair = { params, result: res };
                      console.log(
                        `   [NEW BEST] $${res.finalBalance.toFixed(0)} ` +
                        `(+${res.returnPct.toFixed(0)}%) | DD: ${res.maxDD.toFixed(1)}% | ` +
                        `WR: ${res.wr.toFixed(1)}% | ${res.trades} trades | ` +
                        `EMA:${ema} Entry:${hr}:${String(min).padStart(2, '0')} ` +
                        `SL:${sl} TP:${tp} ${reverse ? 'FADE' : 'TREND'}`
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    console.log(`\n   ── TOP 10 for ${pair.symbol} (${'─'.repeat(50)})`);
    for (let i = 0; i < top10.length; i++) {
      const { params: p, result: r } = top10[i];
      console.log(
        `   ${i + 1}. $${r.finalBalance.toFixed(0)} (+${r.returnPct.toFixed(0)}%) | ` +
        `DD: ${r.maxDD.toFixed(1)}% | WR: ${r.wr.toFixed(1)}% | ${r.trades}T | ` +
        `${sessionName(p.entryHour)} ${p.entryHour}:${String(p.entryMin).padStart(2, '0')} | ` +
        `EMA:${p.emaPeriod} SL:${p.slPips} TP:${p.tpPips} ${p.reverse ? 'FADE' : 'TREND'}`
      );
      allResults.push({ symbol: pair.symbol, params: p, result: r });
    }
    console.log('');
  }

  // ── Final summary ────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  FINAL RESULTS — Best strategy per pair`);
  console.log(`${'═'.repeat(70)}`);

  // Group by symbol, pick top 1 from each
  const symbols = [...new Set(allResults.map(r => r.symbol))];
  for (const sym of symbols) {
    const best = allResults
      .filter(r => r.symbol === sym)
      .sort((a, b) => b.result.returnPct - a.result.returnPct)[0];
    if (!best) continue;

    const { params: p, result: r } = best;
    console.log(
      `\n  🏆 ${sym}:` +
      `\n     Return:     +${r.returnPct.toFixed(0)}% ($${r.finalBalance.toFixed(0)} from $${STARTING_BALANCE})` +
      `\n     Max DD:     ${r.maxDD.toFixed(1)}%` +
      `\n     Win Rate:   ${r.wr.toFixed(1)}% (${r.wins}/${r.trades})` +
      `\n     Entry:      ${sessionName(p.entryHour)} ${p.entryHour}:${String(p.entryMin).padStart(2, '0')} UTC` +
      `\n     EMA:        ${p.emaPeriod}-period (${p.emaPeriod >= 240 ? '4H+' : p.emaPeriod >= 60 ? '1H+' : '<1H'} HTF)` +
      `\n     SL/TP:      ${p.slPips} / ${p.tpPips} pips (R:R = 1:${(p.tpPips / p.slPips).toFixed(1)})` +
      `\n     Direction:  ${p.reverse ? 'MEAN REVERSION (fade)' : 'TREND FOLLOW'}` +
      `\n     Risk:       ${p.riskPct}% per trade`
    );
  }

  // Write results to JSON for bot generation
  const outputPath = path.join(process.cwd(), 'optimizer_v4_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`\n✅ Full results saved to ${outputPath}`);
}

optimizeAll().catch(err => {
  console.error('Optimizer crashed:', err);
  process.exit(1);
});
