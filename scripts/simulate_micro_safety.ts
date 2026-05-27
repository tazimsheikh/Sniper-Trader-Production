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
  status: 'WON' | 'LOST' | 'REJECTED';
}

const PIP_VALUE_PER_LOT = 10;
const STARTING_BALANCE = 100; // $100 micro account
const TARGET_RISK_PCT = 3.0;  // 3% max risk

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
        // Fast-path filtering: only keep data from April 15, 2025 onwards
        if (!line.startsWith('2025') && !line.startsWith('2026')) continue;
        const p = line.split('\t');
        if (p.length < 6) continue;
        const dateStr = p[0].replace(/\./g, '-');
        if (dateStr < '2025-04-15') continue;
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

function generateSignalsOnly(
  daysObj: Record<string, Candle[]>,
  dateKeys: string[],
  entryHour: number, entryMin: number,
  slPips: number, tpPips: number,
  emaPeriod: number, reverse: boolean, 
  pipSize: number, spread: number
): { entryCandle: Candle, bias: 'BUY'|'SELL', entryPrice: number, slPrice: number, tpPrice: number, tradeCandles: Candle[] }[] {
  
  let emaHtf = 0;
  const signals = [];

  for (let d = 1; d < dateKeys.length; d++) {
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

    const tradeCandles = todayCandles.filter(c => c.time > entryCandle.time);
    signals.push({ entryCandle, bias, entryPrice, slPrice, tpPrice, tradeCandles });
  }

  return signals;
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'data');
  const files = fs.readdirSync(rootDir);
  const optimizerFiles = files.filter(f => f.startsWith('optimizer_') && f.endsWith('.json'));

  const pairsSignals: { pair: string, signals: any[], slPips: number }[] = [];

  console.log("Generating signals for all pairs...");
  for (const optFile of optimizerFiles) {
    const pairMatch = optFile.match(/optimizer_(.*)\.json/);
    if (!pairMatch) continue;
    const pair = pairMatch[1];
    
    const configData = JSON.parse(fs.readFileSync(path.join(rootDir, optFile), 'utf-8'));
    if (!configData.top5 || configData.top5.length === 0) continue;
    
    const topConfig = configData.top5[0].params;
    const pipSize = configData.pipSize || (pair.includes('JPY') ? 0.01 : 0.0001);
    
    const slippagePips = pair.includes('XAU') || pair.includes('NAS') ? 2 : 0.5;
    const totalSpreadSlippage = pipSize + (slippagePips * pipSize);

    const dataFiles = fs.readdirSync(dataDir);
    const dataFile = dataFiles.find(f => f.startsWith(pair) && f.endsWith('.csv'));
    
    if (!dataFile) continue;

    const candles = await loadData(path.join(dataDir, dataFile));
    const daysObj: Record<string, Candle[]> = {};
    for (const c of candles) {
      if (!daysObj[c.dateStr]) daysObj[c.dateStr] = [];
      daysObj[c.dateStr].push(c);
    }
    const dateKeys = Object.keys(daysObj).sort();

    const signals = generateSignalsOnly(
      daysObj, dateKeys,
      topConfig.hr, topConfig.min,
      topConfig.sl, topConfig.tp,
      topConfig.ema, topConfig.reverse, 
      pipSize, totalSpreadSlippage
    );

    pairsSignals.push({ pair, signals, slPips: topConfig.sl });
  }

  // Define 12 distinct months from May 2025 to April 2026
  const months = [];
  for (let m = 5; m <= 12; m++) months.push({ year: 2025, month: m, name: `2025-${m.toString().padStart(2, '0')}` });
  for (let m = 1; m <= 4; m++) months.push({ year: 2026, month: m, name: `2026-${m.toString().padStart(2, '0')}` });

  const commissionRT = 7;
  let md = '# Dynamic Trade Rejection Simulation ($100 Account)\n\n';
  md += 'This simulation tests starting a fresh $100 account at the beginning of each month over the last 1 year. ';
  md += 'It uses the proposed **Dynamic Trade Rejection** logic: if the minimum broker lot size (0.01) mathematically risks more than 3% ($3), the trade is rejected.\n\n';
  
  md += '| Month | Starting Balance | Ending Balance | Max Drawdown | Trades Taken | Trades Rejected | Net Profit | Time to $300 |\n';
  md += '|-------|-----------------:|---------------:|-------------:|-------------:|----------------:|-----------:|-------------:|\n';

  for (const m of months) {
    const startMs = new Date(`${m.year}-${m.month.toString().padStart(2, '0')}-01T00:00:00Z`).getTime();
    const nextMonth = m.month === 12 ? 1 : m.month + 1;
    const nextYear = m.month === 12 ? m.year + 1 : m.year;
    const endMs = new Date(`${nextYear}-${nextMonth.toString().padStart(2, '0')}-01T00:00:00Z`).getTime();

    // Collect all signals for this month across all pairs
    const monthSignals = [];
    for (const ps of pairsSignals) {
      for (const sig of ps.signals) {
        if (sig.entryCandle.time >= startMs && sig.entryCandle.time < endMs) {
          monthSignals.push({ ...sig, pair: ps.pair, slPips: ps.slPips });
        }
      }
    }

    // Sort chronologically to simulate a combined portfolio
    monthSignals.sort((a, b) => a.entryCandle.time - b.entryCandle.time);

    let balance = STARTING_BALANCE;
    let peak = STARTING_BALANCE;
    let maxDD = 0;
    let tradesTaken = 0;
    let tradesRejected = 0;
    let daysTo300 = -1;
    let tradesTo300 = -1;

    for (const sig of monthSignals) {
      if (balance <= 0) break; // blown

      // Dynamic Rejection Logic
      const riskAmount = balance * (TARGET_RISK_PCT / 100);
      let calculatedLots = riskAmount / (sig.slPips * PIP_VALUE_PER_LOT);
      
      // If calculatedLots is less than 0.01, it means 0.01 will overleverage the account.
      // E.g. riskAmount = $3, slPips = 50. calculatedLots = 3 / (50*10) = 0.006.
      // If we force 0.01, risk = 0.01 * 50 * 10 = $5. (5% > 3%). REJECT!
      const minRisk = 0.01 * sig.slPips * PIP_VALUE_PER_LOT;
      if (minRisk > riskAmount) {
        tradesRejected++;
        continue; // REJECT
      }

      // Allowed! Place at calculated lot size (rounded up to 0.01 minimum since we proved it's safe)
      const lots = Math.max(0.01, Math.min(20, Math.round(calculatedLots * 100) / 100));

      let closed = false;
      let profit = 0;

      for (const c of sig.tradeCandles) {
        if (sig.bias === 'BUY') {
          if (c.low <= sig.slPrice) {
            profit = -(sig.slPips * PIP_VALUE_PER_LOT * lots) - (commissionRT * lots);
            closed = true; break;
          }
          if (c.high >= sig.tpPrice) {
            // we don't have exactly the TP pips here, but we can calculate it from entry price
            const tpPips = (sig.tpPrice - sig.entryPrice) / (sig.pair.includes('JPY') ? 0.01 : 0.0001);
            profit = (tpPips * PIP_VALUE_PER_LOT * lots) - (commissionRT * lots);
            closed = true; break;
          }
        } else {
          // Sell logic (with spread for SL)
          const pipSize = sig.pair.includes('JPY') ? 0.01 : 0.0001;
          const totalSpread = sig.pair.includes('XAU') ? 2 : 0.5; // Approx
          if (c.high + (totalSpread * pipSize) >= sig.slPrice) {
            profit = -(sig.slPips * PIP_VALUE_PER_LOT * lots) - (commissionRT * lots);
            closed = true; break;
          }
          if (c.low <= sig.tpPrice) {
            const tpPips = (sig.entryPrice - sig.tpPrice) / pipSize;
            profit = (tpPips * PIP_VALUE_PER_LOT * lots) - (commissionRT * lots);
            closed = true; break;
          }
        }
      }

      if (closed) {
        balance += profit;
        tradesTaken++;
        if (balance > peak) peak = balance;
        const dd = ((peak - balance) / peak) * 100;
        if (dd > maxDD) maxDD = dd;
        
        if (balance >= 300 && daysTo300 === -1) {
          daysTo300 = Math.ceil((sig.entryCandle.time - startMs) / (1000 * 60 * 60 * 24));
          tradesTo300 = tradesTaken;
        }
      }
    }

    const netProfit = balance - STARTING_BALANCE;
    md += `| ${m.name} | $${STARTING_BALANCE.toFixed(2)} | $${balance.toFixed(2)} | ${maxDD.toFixed(2)}% | ${tradesTaken} | ${tradesRejected} | $${netProfit.toFixed(2)} | ${daysTo300 > -1 ? daysTo300 + ' days (' + tradesTo300 + ' trades)' : 'Never'} |\n`;
  }

  fs.writeFileSync(path.join(rootDir, 'micro_safety_report.md'), md);
  console.log("Report generated at micro_safety_report.md");
}

main().catch(console.error);
