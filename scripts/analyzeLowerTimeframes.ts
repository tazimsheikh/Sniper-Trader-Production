import fs from 'fs';
import readline from 'readline';
import path from 'path';

const START_DATE = new Date('2021-05-01T00:00:00Z').getTime();
const END_DATE = new Date('2026-05-01T23:59:59Z').getTime();

interface Candle { time: number; dateStr: string; open: number; high: number; low: number; close: number; }

async function loadData(filePath: string): Promise<Candle[]> {
  const globalM1Candles: Candle[] = [];
  if (!fs.existsSync(filePath)) return [];
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let isFirstLine = true;
  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; }
    const parts = line.split('\t');
    if (parts.length < 6) continue;
    
    const dPart = parts[0].replace(/\./g, '-');
    const timestamp = new Date(`${dPart}T${parts[1]}Z`).getTime();
    if (timestamp < START_DATE) continue;
    if (timestamp > END_DATE) break;

    globalM1Candles.push({
      time: timestamp, dateStr: new Date(timestamp).toISOString(),
      open: parseFloat(parts[2]), high: parseFloat(parts[3]), low: parseFloat(parts[4]), close: parseFloat(parts[5])
    });
  }
  return globalM1Candles;
}

function printM1Context(candles: Candle[], targetTime: number, rangeMinutes: number) {
  const startIndex = candles.findIndex(c => c.time >= targetTime - (rangeMinutes * 60 * 1000));
  const endIndex = candles.findIndex(c => c.time >= targetTime);
  
  if (startIndex === -1 || endIndex === -1) return;
  
  console.log(`\n--- 1-Minute Price Action leading up to 15M Trap Trigger at ${new Date(targetTime).toISOString()} ---`);
  for (let i = startIndex; i <= endIndex; i++) {
     const c = candles[i];
     const body = Math.abs(c.close - c.open);
     const isBull = c.close > c.open;
     const dirStr = isBull ? 'UP  ' : 'DOWN';
     console.log(`[${c.dateStr.split('T')[1].replace('.000Z', '')}] ${dirStr} | O:${c.open.toFixed(5)} H:${c.high.toFixed(5)} L:${c.low.toFixed(5)} C:${c.close.toFixed(5)}`);
  }
}

async function analyze() {
  const dataDir = path.join(process.cwd(), 'data');
  const file = 'EURUSD_M1_202105030000_202605010159.csv';
  console.log('Loading EURUSD M1 data for pattern analysis...');
  const data = await loadData(path.join(dataDir, file));
  
  const PIP_SIZE = 0.0001;
  let asianHigh = -Infinity, asianLow = Infinity;
  let currentDayStr = '', currentM15Str = '';
  let m15Open = 0, m15High = -Infinity, m15Low = Infinity;
  let m15Candles: Candle[] = [];
  
  let foundWinningTrades = 0;

  for (let cIdx = 0; cIdx < data.length; cIdx++) {
    const c = data[cIdx];
    const dt = new Date(c.time);
    const dPart = c.dateStr.split('T')[0];
    const nyHour = dt.getUTCHours() - 4; 
    const normalizedNyHour = nyHour < 0 ? nyHour + 24 : nyHour;
    const nyMinute = dt.getUTCMinutes();

    if (dPart !== currentDayStr) {
      currentDayStr = dPart;
      asianHigh = -Infinity; asianLow = Infinity;
    }
    
    if (normalizedNyHour >= 20 || normalizedNyHour < 2) {
      asianHigh = Math.max(asianHigh, c.high);
      asianLow = Math.min(asianLow, c.low);
    }
    
    const m15Min = Math.floor(nyMinute / 15) * 15;
    const m15Str = `${dPart} ${dt.getUTCHours()}:${m15Min}`;
    if (m15Str !== currentM15Str) {
      if (currentM15Str !== '' && cIdx > 1) {
        m15Candles.push({ time: data[cIdx-1].time, dateStr: currentM15Str, open: m15Open, high: m15High, low: m15Low, close: data[cIdx-1].close });
      }
      currentM15Str = m15Str;
      m15Open = c.open; m15High = c.high; m15Low = c.low;
    } else {
      m15High = Math.max(m15High, c.high); m15Low = Math.min(m15Low, c.low);
    }

    if (nyMinute % 15 === 14 && m15Candles.length >= 2) {
       const isMorning = normalizedNyHour >= 7 && normalizedNyHour < 11;
       const isAfternoon = normalizedNyHour >= 13 && normalizedNyHour < 15;
       if (!isMorning && !isAfternoon) continue;
       if (asianHigh === -Infinity) continue;

       const asianRangePips = (asianHigh - asianLow) / PIP_SIZE;
       if (asianRangePips > 30) continue;

       const triggerCandle = m15Candles[m15Candles.length - 1];
       const bodySize = Math.abs(triggerCandle.close - triggerCandle.open);
       const candleRange = triggerCandle.high - triggerCandle.low;
       if (candleRange === 0) continue;
       
       const pipsAboveAsian = (triggerCandle.high - asianHigh) / PIP_SIZE;
       const pipsBelowAsian = (asianLow - triggerCandle.low) / PIP_SIZE;

       let direction: 'BUY'|'SELL' | null = null;
       
       if (pipsAboveAsian >= 10 && triggerCandle.close < triggerCandle.open && bodySize / candleRange > 0.4) direction = 'SELL';
       else if (pipsBelowAsian >= 10 && triggerCandle.close > triggerCandle.open && bodySize / candleRange > 0.4) direction = 'BUY';

       if (direction) {
          let slPrice = direction === 'BUY' ? triggerCandle.low - (2 * PIP_SIZE) : triggerCandle.high + (2 * PIP_SIZE);
          let entryPrice = c.close;
          let slPips = Math.abs(entryPrice - slPrice) / PIP_SIZE;
          if (slPips > 35 || slPips < 5) continue; 
          
          let tpPrice = direction === 'BUY' ? entryPrice + (slPips * 3 * PIP_SIZE) : entryPrice - (slPips * 3 * PIP_SIZE);
          
          // Fast-forward to see if it wins before it loses
          let won = false;
          let lost = false;
          for (let f = cIdx; f < data.length; f++) {
             const fc = data[f];
             if (direction === 'BUY') {
                if (fc.low <= slPrice) { lost = true; break; }
                if (fc.high >= tpPrice) { won = true; break; }
             } else {
                if (fc.high >= slPrice) { lost = true; break; }
                if (fc.low <= tpPrice) { won = true; break; }
             }
          }

          if (won) {
             foundWinningTrades++;
             console.log(`\n>>> MASSIVE WINNER FOUND: ${direction} Trap at ${c.dateStr} <<<`);
             console.log(`Asian High: ${asianHigh.toFixed(5)} | Asian Low: ${asianLow.toFixed(5)}`);
             console.log(`Trigger Candle (15M): O:${triggerCandle.open} H:${triggerCandle.high} L:${triggerCandle.low} C:${triggerCandle.close}`);
             printM1Context(data, c.time, 15);
             if (foundWinningTrades >= 5) process.exit(0);
          }
       }
    }
  }
}

analyze();
