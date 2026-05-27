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

const PIP_VALUE_PER_LOT = 10;
const STARTING_BALANCE = 100;
const PIP_SIZE = 0.0001;

async function loadData(filePath: string): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    const results: Candle[] = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    let leftover = '';

    stream.on('data', (chunk: Buffer) => {
      leftover += chunk.toString();
      let n = leftover.indexOf('\n');
      while (n !== -1) {
        const line = leftover.substring(0, n).trim();
        leftover = leftover.substring(n + 1);
        n = leftover.indexOf('\n');

        if (!line || line.startsWith('<DATE>')) continue;
        const parts = line.split('\t');
        if (parts.length >= 6) {
          const dateStr = parts[0].replace(/\./g, '');
          const timeStr = parts[1].replace(/:/g, '');
          const year = parseInt(dateStr.substring(0, 4));
          const month = parseInt(dateStr.substring(4, 6)) - 1;
          const day = parseInt(dateStr.substring(6, 8));
          const hour = parseInt(timeStr.substring(0, 2));
          const min = parseInt(timeStr.substring(2, 4));
          const open = parseFloat(parts[2]);
          const high = parseFloat(parts[3]);
          const low = parseFloat(parts[4]);
          const close = parseFloat(parts[5]);

          results.push({
            dateStr, timeStr,
            time: Date.UTC(year, month, day, hour, min),
            open, high, low, close
          });
        }
      }
    });

    stream.on('end', () => {
      resolve(results);
    });
    stream.on('error', reject);
  });
}

function runBacktest(candles: Candle[], mode: 'BASELINE' | 'FORCE_CLOSE_NEWS'): any {
  let balance = STARTING_BALANCE;
  let inTrade = false;
  let direction = '';
  let entryPrice = 0;
  let slPrice = 0;
  let tpPrice = 0;
  let lots = 0;

  let totalTrades = 0;
  let wins = 0;
  let losses = 0;

  const EMA_PERIOD = 60;
  let ema = 0;

  // EURUSD London Fade params
  const SL_PIPS = 20;
  const TP_PIPS = 50;
  const RISK_PCT = 5;

  let lastTickMin = -1;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const hour = parseInt(c.timeStr.substring(0, 2));
    const min = parseInt(c.timeStr.substring(2, 4));
    const currentMin = hour * 60 + min;

    // EMA Update (once per minute)
    if (currentMin !== lastTickMin) {
      if (ema === 0) ema = c.close;
      else {
        const alpha = 2 / (EMA_PERIOD + 1);
        ema = c.close * alpha + ema * (1 - alpha);
      }
      lastTickMin = currentMin;
    }

    if (!inTrade) {
      // Trigger logic: 09:05 UTC to 09:06 UTC
      if (hour === 9 && min >= 5 && min <= 6) {
        if (ema !== 0) {
          direction = c.close < ema ? 'BUY' : 'SELL';
          entryPrice = c.close;
          slPrice = direction === 'BUY' ? entryPrice - (SL_PIPS * PIP_SIZE) : entryPrice + (SL_PIPS * PIP_SIZE);
          tpPrice = direction === 'BUY' ? entryPrice + (TP_PIPS * PIP_SIZE) : entryPrice - (TP_PIPS * PIP_SIZE);
          const riskAmount = balance * (RISK_PCT / 100);
          lots = riskAmount / (SL_PIPS * PIP_VALUE_PER_LOT);
          inTrade = true;
          totalTrades++;
        }
      }
    } else {
      // In Trade Management
      let closed = false;
      let exitPrice = 0;

      // 1. Force Close for News Mode
      // Simulating USD high impact news at 12:30 UTC (08:30 NY) and 14:00 UTC (10:00 NY)
      if (mode === 'FORCE_CLOSE_NEWS' && ((hour === 12 && min === 25) || (hour === 13 && min === 55))) {
        exitPrice = c.close;
        closed = true;
      }
      // 2. SL / TP Logic
      else if (direction === 'BUY') {
        if (c.low <= slPrice) { exitPrice = slPrice; closed = true; }
        else if (c.high >= tpPrice) { exitPrice = tpPrice; closed = true; }
      } else {
        if (c.high >= slPrice) { exitPrice = slPrice; closed = true; }
        else if (c.low <= tpPrice) { exitPrice = tpPrice; closed = true; }
      }

      if (closed) {
        const pips = direction === 'BUY' ? (exitPrice - entryPrice) / PIP_SIZE : (entryPrice - exitPrice) / PIP_SIZE;
        const profit = pips * PIP_VALUE_PER_LOT * lots;
        balance += profit;
        
        if (pips > 0) wins++;
        else losses++;

        inTrade = false;
      }
    }
  }

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const returnPct = ((balance - STARTING_BALANCE) / STARTING_BALANCE) * 100;

  return { totalTrades, wins, losses, winRate, returnPct, finalBalance: balance };
}

async function main() {
  const dataPath = path.join(process.cwd(), 'data', 'EURUSD_M1_202105030000_202605010159.csv');
  console.log('Loading 1-year data for EURUSD...');
  const candles = await loadData(dataPath);
  console.log(`Loaded ${candles.length} ticks.`);

  console.log('\\n--- RUNNING BASELINE BACKTEST ---');
  const baseRes = runBacktest(candles, 'BASELINE');
  console.log(`Trades: ${baseRes.totalTrades} | Win Rate: ${baseRes.winRate.toFixed(2)}% | Return: +${baseRes.returnPct.toFixed(0)}% | Balance: $${baseRes.finalBalance.toFixed(2)}`);

  console.log('\\n--- RUNNING FORCE CLOSE BEFORE NEWS BACKTEST ---');
  console.log('Force closing trades at exactly 08:25 and 09:55 NY time (simulating pre-news dump)');
  const newsRes = runBacktest(candles, 'FORCE_CLOSE_NEWS');
  console.log(`Trades: ${newsRes.totalTrades} | Win Rate: ${newsRes.winRate.toFixed(2)}% | Return: +${newsRes.returnPct.toFixed(0)}% | Balance: $${newsRes.finalBalance.toFixed(2)}`);
}

main().catch(console.error);
