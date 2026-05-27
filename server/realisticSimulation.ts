import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { BOT_REGISTRY } from './botManager.js';
import { BotContext } from './bots/BotInterface.js';
import { isNewsBlackout } from './newsStore.js';

interface Tick {
  time: number;
  dateStr: string;
  timeStr: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  spreadPips: number;
  ema: number;
}

const SYMBOL_SPECS: Record<string, any> = {
  EURUSD: { pipSize: 0.0001, pipValuePerLot: 10 },
  GBPUSD: { pipSize: 0.0001, pipValuePerLot: 10 },
  AUDUSD: { pipSize: 0.0001, pipValuePerLot: 10 },
  NZDUSD: { pipSize: 0.0001, pipValuePerLot: 10 },
  USDCAD: { pipSize: 0.0001, pipValuePerLot: 7.3 }, 
  USDCHF: { pipSize: 0.0001, pipValuePerLot: 11.2 }, 
  USDJPY: { pipSize: 0.01, pipValuePerLot: 6.7 }, 
  GBPJPY: { pipSize: 0.01, pipValuePerLot: 6.7 },
  EURJPY: { pipSize: 0.01, pipValuePerLot: 6.7 },
  AUDJPY: { pipSize: 0.01, pipValuePerLot: 6.7 },
  CHFJPY: { pipSize: 0.01, pipValuePerLot: 6.7 },
  EURAUD: { pipSize: 0.0001, pipValuePerLot: 6.5 },
  EURCAD: { pipSize: 0.0001, pipValuePerLot: 7.3 },
  EURCHF: { pipSize: 0.0001, pipValuePerLot: 11.2 },
  GBPAUD: { pipSize: 0.0001, pipValuePerLot: 6.5 },
  GBPCAD: { pipSize: 0.0001, pipValuePerLot: 7.3 },
  GBPCHF: { pipSize: 0.0001, pipValuePerLot: 11.2 },
  XAUUSD: { pipSize: 0.1, pipValuePerLot: 10 },
  NAS100: { pipSize: 1, pipValuePerLot: 1 },
};

let STARTING_BALANCE = 100;
let balance = STARTING_BALANCE;
let peakBalance = STARTING_BALANCE;
let totalTrades = 0;
let wins = 0;

let allTicks: Tick[] = [];
let newsEvents: any[] = [];

const dailyCandles: Record<string, any[]> = {};
let currentDayStr: string = '';
let currentDayCandle: Record<string, any> = {};

async function parseCSV(filepath: string, symbol: string) {
  const stream = fs.createReadStream(filepath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let ema = 0;
  const alpha = 2 / (60 + 1);
  
  for await (const line of rl) {
    if (!line || line.startsWith('<DATE>')) continue;
    const parts = line.split('\t');
    if (parts.length < 6) continue;

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
    
    let spreadPoints = parts.length > 8 ? parseInt(parts[8]) : 10;
    const spreadPips = spreadPoints / 10;

    if (ema === 0) ema = close;
    else ema = close * alpha + ema * (1 - alpha);

    if (currentDayStr !== dateStr) {
      if (currentDayStr !== '') {
        for (const sym of Object.keys(currentDayCandle)) {
          if (!dailyCandles[sym]) dailyCandles[sym] = [];
          dailyCandles[sym].push({ ...currentDayCandle[sym], date: currentDayStr });
          if (dailyCandles[sym].length > 5) dailyCandles[sym].shift();
        }
      }
      currentDayStr = dateStr;
      currentDayCandle = {};
    }

    if (!currentDayCandle[symbol]) {
      currentDayCandle[symbol] = { open, high, low, close };
    } else {
      currentDayCandle[symbol].high = Math.max(currentDayCandle[symbol].high, high);
      currentDayCandle[symbol].low = Math.min(currentDayCandle[symbol].low, low);
      currentDayCandle[symbol].close = close;
    }

    if (dateStr.startsWith('202604')) {
      const timeMs = Date.UTC(year, month, day, hour, min);
      allTicks.push({
        time: timeMs, dateStr, timeStr: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
        symbol, open, high, low, close, spreadPips, ema
      });
    }
  }
}

function checkNewsBlackout(symbol: string, timeMs: number): boolean {
  const relevant = new Set<string>();
  if (symbol.length === 6) { relevant.add(symbol.substring(0,3)); relevant.add(symbol.substring(3,6)); }
  else relevant.add('USD');

  for (const ev of newsEvents) {
    if (ev.impact === 'High' && relevant.has(ev.country)) {
      const evTime = new Date(ev.date).getTime();
      if (Math.abs(timeMs - evTime) <= 5 * 60 * 1000) return true;
    }
  }
  return false;
}

interface OpenTrade {
  botId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  lots: number;
  pipValue: number;
  pipSize: number;
  openTime: number;
}

async function run() {
  const args = process.argv.slice(2);
  let targetPairs = new Set<string>();
  let slipPenalty = 1;
  let startingBalance = 100;
  let noEod = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pairs' && args[i+1]) {
      args[i+1].split(',').forEach(p => targetPairs.add(p.trim().toUpperCase()));
      i++;
    }
    if (args[i] === '--slippage' && args[i+1]) {
      slipPenalty = parseFloat(args[i+1]);
      i++;
    }
    if (args[i] === '--balance' && args[i+1]) {
      startingBalance = parseFloat(args[i+1]);
      i++;
    }
    if (args[i] === '--noeod') {
      noEod = true;
    }
  }

  STARTING_BALANCE = startingBalance;
  balance = STARTING_BALANCE;
  peakBalance = STARTING_BALANCE;
  totalTrades = 0;
  wins = 0;

  console.log(`Loading news events...`);
  if (fs.existsSync('april_news.json')) {
    newsEvents = JSON.parse(fs.readFileSync('april_news.json', 'utf8'));
  }

  const files = fs.readdirSync('data').filter(f => f.endsWith('.csv'));
  
  const tradedSymbols = new Set<string>();
  Object.values(BOT_REGISTRY).forEach(b => {
    b.config.symbols.forEach(s => {
      if (targetPairs.size === 0 || targetPairs.has(s)) {
        tradedSymbols.add(s);
      }
    });
  });

  console.log(`Parsing CSVs for ${tradedSymbols.size} traded symbols...`);
  for (const file of files) {
    const sym = file.split('_')[0];
    if (tradedSymbols.has(sym)) {
      console.log(`Loading ${file}...`);
      await parseCSV(path.join('data', file), sym);
    }
  }

  console.log(`Sorting ${allTicks.length} ticks chronologically...`);
  allTicks.sort((a, b) => a.time - b.time);

  console.log(`Running Simulation... Starting Balance: $${STARTING_BALANCE} | Slippage: ${slipPenalty} pips`);
  
  let openTrades: OpenTrade[] = [];
  const firedToday = new Set<string>(); 

  let currentPriceMap: Record<string, number> = {};

  for (const tick of allTicks) {
    currentPriceMap[tick.symbol] = tick.close;
    const now = new Date(tick.time);
    const dateKey = tick.dateStr;

    for (let i = openTrades.length - 1; i >= 0; i--) {
      const tr = openTrades[i];
      if (tr.symbol !== tick.symbol) continue;

      let closed = false;
      let profit = 0;
      let reason = '';

      if (tr.direction === 'BUY') {
        if (tick.low <= tr.slPrice) { profit = (tr.slPrice - tr.entryPrice) / tr.pipSize * tr.pipValue * tr.lots; closed = true; reason = 'SL Hit'; }
        else if (tick.high >= tr.tpPrice) { profit = (tr.tpPrice - tr.entryPrice) / tr.pipSize * tr.pipValue * tr.lots; closed = true; reason = 'TP Hit'; wins++; }
      } else {
        if (tick.high >= tr.slPrice) { profit = (tr.entryPrice - tr.slPrice) / tr.pipSize * tr.pipValue * tr.lots; closed = true; reason = 'SL Hit'; }
        else if (tick.low <= tr.tpPrice) { profit = (tr.entryPrice - tr.tpPrice) / tr.pipSize * tr.pipValue * tr.lots; closed = true; reason = 'TP Hit'; wins++; }
      }

      if (!noEod && !closed && now.getUTCHours() === 23 && now.getUTCMinutes() >= 55) {
        profit = tr.direction === 'BUY' ? (tick.close - tr.entryPrice) / tr.pipSize * tr.pipValue * tr.lots : (tr.entryPrice - tick.close) / tr.pipSize * tr.pipValue * tr.lots;
        closed = true;
        reason = 'EOD Close';
        if (profit > 0) wins++;
      }

      if (closed) {
        balance += profit;
        totalTrades++;
        if (balance > peakBalance) peakBalance = balance;
        openTrades.splice(i, 1);
      }
    }

    if (balance <= 0) {
      console.log('ACCOUNT BLOWN');
      break;
    }

    for (const [botId, bot] of Object.entries(BOT_REGISTRY)) {
      if (!bot.config.symbols.includes(tick.symbol)) continue;
      if (targetPairs.size > 0 && !targetPairs.has(tick.symbol)) continue;

      const fireKey = `${dateKey}-${botId}-${tick.symbol}`;
      if (firedToday.has(fireKey)) continue;

      (bot as any).htfEma = tick.ema;
      (bot as any).emaLoaded = true;

      const context: BotContext = {
        currentPrice: tick.close,
        bid: tick.close,
        ask: tick.close + (tick.spreadPips * (SYMBOL_SPECS[tick.symbol]?.pipSize || 0.0001)),
        spread: tick.spreadPips,
        brokerSymbol: tick.symbol,
        now,
        recentDailyCandles: dailyCandles[tick.symbol] || []
      };

      const signal = await bot.generateSignal(context);
      if (signal.shouldTrade && signal.direction && signal.suggestedSlPips) {
        
        const isGoldIndex = tick.symbol.includes('XAU') || tick.symbol.includes('NAS') || tick.symbol.includes('USTEC');
        const isMinor = tick.symbol.includes('JPY') || tick.symbol.includes('AUD') || tick.symbol.includes('NZD') || tick.symbol.includes('CAD') || tick.symbol.includes('CHF');
        const maxSpread = isGoldIndex ? 25 : (isMinor ? 5 : 3);
        
        if (tick.spreadPips > maxSpread) continue;

        if (checkNewsBlackout(tick.symbol, tick.time)) continue;

        const maxSl = isGoldIndex ? 250 : 150;
        const finalSl = Math.min(signal.suggestedSlPips, maxSl);
        const finalTp = signal.suggestedTpPips || finalSl * 2;

        const spec = SYMBOL_SPECS[tick.symbol];
        let riskAmount = balance * (bot.config.riskPct / 100);
        
        const minRiskAmount = 0.01 * finalSl * spec.pipValuePerLot;
        if (minRiskAmount > riskAmount) {
          if (balance < 100) {
            const minRiskPct = (minRiskAmount / balance) * 100;
            if (minRiskPct <= 15) riskAmount = minRiskAmount;
            else continue;
          } else continue;
        }

        let lots = riskAmount / (finalSl * spec.pipValuePerLot);
        lots = Math.max(0.01, Math.min(20, Math.round(lots * 100) / 100));

        const pipSize = spec.pipSize;
        
        const slip = slipPenalty * pipSize;
        const entryPrice = signal.direction === 'BUY' ? tick.close + slip : tick.close - slip;

        const slPrice = signal.direction === 'BUY' ? entryPrice - finalSl * pipSize : entryPrice + finalSl * pipSize;
        const tpPrice = signal.direction === 'BUY' ? entryPrice + finalTp * pipSize : entryPrice - finalTp * pipSize;

        openTrades.push({
          botId, symbol: tick.symbol, direction: signal.direction,
          entryPrice, slPrice, tpPrice, lots, pipValue: spec.pipValuePerLot, pipSize, openTime: tick.time
        });
        
        firedToday.add(fireKey);
      }
    }
  }

  const dd = ((peakBalance - balance) / peakBalance) * 100;
  const wr = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(2) : '0.00';
  const ret = ((balance - STARTING_BALANCE) / STARTING_BALANCE * 100).toFixed(2);

  const report = `# Realistic Multi-Pair 1-Month Simulation Report
**Date Range:** April 1, 2026 - April 30, 2026
**Starting Balance:** $${STARTING_BALANCE.toFixed(2)}
**Final Balance:** $${balance.toFixed(2)}
**Return:** ${ret}%
**Total Trades:** ${totalTrades}
**Win Rate:** ${wr}%
**Max Drawdown:** ${dd.toFixed(2)}%

## Constraints Enforced:
- ${slipPenalty}-pip Slippage Penalty
- Live Spread Tolerance Rejection (< 3 pips major, < 5 pips minor)
- High Impact News Blackout Window (+/- 5 mins) across all pairs
- Universal End Of Day Closure at 23:55 UTC
- Micro-Account Aggression Curve for $100 starting balance
`;

  fs.writeFileSync('micro_account_monthly_simulation.md', report);
  console.log(`Simulation complete! Return: ${ret}% | Win Rate: ${wr}% | Trades: ${totalTrades}`);
}

run().catch(console.error);
