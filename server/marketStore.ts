import { MarketData, TrapSignal } from '../src/types';
import { calculateConfluenceScore } from './confluenceCalculator';
import { executeTradeForUsers } from './metaApiHandler';
import { evaluateSignalWithAI } from './aiFilter';
import {
  globalProvider, refreshGlobalProvider, toBrokerSymbol, CandleProvider,
} from './candleProvider';

// ── Shared pip size registry (single source of truth) ────────────────────────
// IMPORTANT: This must match metaApiHandler.ts SYMBOL_SPECS.pipSize exactly.
export const ASSET_MAP: Record<string, { symbol: string; name: string; pipSize: number }> = {
  'NQ=F':     { symbol: 'NQ=F',     name: 'NAS100 Futures',   pipSize: 1      },
  'GC=F':     { symbol: 'GC=F',     name: 'XAUUSD Gold',      pipSize: 0.01   },
  'CL=F':     { symbol: 'CL=F',     name: 'XTIUSD Crude Oil', pipSize: 0.01   },
  'EURUSD=X': { symbol: 'EURUSD=X', name: 'EURUSD Forex',     pipSize: 0.0001 },
  'GBPUSD=X': { symbol: 'GBPUSD=X', name: 'GBPUSD Forex',     pipSize: 0.0001 },
  'USDJPY=X': { symbol: 'USDJPY=X', name: 'USDJPY Forex',     pipSize: 0.01   },
  'AUDUSD=X': { symbol: 'AUDUSD=X', name: 'AUDUSD Forex',     pipSize: 0.0001 },
  'USDCAD=X': { symbol: 'USDCAD=X', name: 'USDCAD Forex',     pipSize: 0.0001 },
  'NZDUSD=X': { symbol: 'NZDUSD=X', name: 'NZDUSD Forex',     pipSize: 0.0001 },
  'USDCHF=X': { symbol: 'USDCHF=X', name: 'USDCHF Forex',     pipSize: 0.0001 },
  'GBPJPY=X': { symbol: 'GBPJPY=X', name: 'GBPJPY Forex',     pipSize: 0.01   },
  'EURGBP=X': { symbol: 'EURGBP=X', name: 'EURGBP Forex',     pipSize: 0.0001 },
  'EURJPY=X': { symbol: 'EURJPY=X', name: 'EURJPY Forex',     pipSize: 0.01   },
  'AUDJPY=X': { symbol: 'AUDJPY=X', name: 'AUDJPY Forex',     pipSize: 0.01   },
  'EURAUD=X': { symbol: 'EURAUD=X', name: 'EURAUD Forex',     pipSize: 0.0001 },
  'GBPAUD=X': { symbol: 'GBPAUD=X', name: 'GBPAUD Forex',     pipSize: 0.0001 },
  'CHFJPY=X': { symbol: 'CHFJPY=X', name: 'CHFJPY Forex',     pipSize: 0.01   },
  'AUDCAD=X': { symbol: 'AUDCAD=X', name: 'AUDCAD Forex',     pipSize: 0.0001 },
  'EURCAD=X': { symbol: 'EURCAD=X', name: 'EURCAD Forex',     pipSize: 0.0001 },
  'NZDJPY=X': { symbol: 'NZDJPY=X', name: 'NZDJPY Forex',     pipSize: 0.01   },
  'GBPCAD=X': { symbol: 'GBPCAD=X', name: 'GBPCAD Forex',     pipSize: 0.0001 },
};

let markets: Record<string, MarketData> = {};
let alerts: TrapSignal[] = [];

// 🛡️ BUG FIX #3: Track real bid/ask separately since MarketData has no bid/ask fields.
// Yahoo returns bid/ask per quote; we persist them here so the bot engine gets real spread.
const liveSpreads: Record<string, { bid: number; ask: number }> = {};

// Track the active data-source for the UI badge
export let activeDataSource: 'yahoo' | 'metaapi' | 'simulation' = 'yahoo';

// In-flight execution guard (prevents duplicate trades per signal)
const executingSignals = new Set<string>();

// Session tracking
let activeSessionName = 'Gap Time';
let sessionStartTimes: Record<string, number> = {};

// ── Batch layout for live-price polling ──────────────────────────────────────
// Each sub-array is polled in one network call (Yahoo batch / MetaAPI fan-out)
const BATCHES: string[][] = [
  ['NQ=F', 'GC=F', 'CL=F', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X'],
  ['NZDUSD=X', 'USDCHF=X', 'GBPJPY=X', 'EURGBP=X', 'EURJPY=X', 'AUDJPY=X', 'EURAUD=X'],
  ['GBPAUD=X', 'CHFJPY=X', 'AUDCAD=X', 'EURCAD=X', 'NZDJPY=X', 'GBPCAD=X'],
];
let yahooBatchIndex = 0;

// ── Round-number trap helper ──────────────────────────────────────────────────
function getRoundNumberTraps(price: number, symbol: string): string[] {
  const traps: string[] = [];
  if (symbol.includes('EURUSD') || symbol.includes('GBPUSD') || symbol.includes('AUDUSD') || symbol.includes('EURGBP')) {
    const lastDigits = Math.round((price * 10000) % 100);
    if (Math.abs(lastDigits - 0) <= 2 || Math.abs(lastDigits - 100) <= 2) traps.push('00 Level Trap');
    if (Math.abs(lastDigits - 50) <= 2) traps.push('50 Level Trap');
  } else if (symbol.includes('JPY') || symbol.includes('GC=F') || symbol.includes('CL=F')) {
    const lastDigits = Math.round(price % 100);
    if (Math.abs(lastDigits - 0) <= 1 || Math.abs(lastDigits - 100) <= 1) traps.push('00 Century Level');
    if (Math.abs(lastDigits - 50) <= 1) traps.push('50 Round Level');
  } else if (symbol.includes('NQ=F')) {
    const lastDigits = Math.round(price % 100);
    if (Math.abs(lastDigits) <= 10 || Math.abs(lastDigits - 100) <= 10) traps.push('00 Century Level');
    if (Math.abs(lastDigits - 50) <= 10) traps.push('50 Round Level');
  }
  return traps;
}

// ── Session / timing gate ─────────────────────────────────────────────────────
const GLOBAL_FORMATTER_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});

const GLOBAL_FORMATTER_MINUTE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  minute: 'numeric',
});


export function getTimingGate(): { gate: TrapSignal['timingGate']; details: string; isBlackout: boolean } {
  const now = new Date();
  
  const timeString = GLOBAL_FORMATTER_HM.format(now);
  const [nyHoursStr, nyMinutesStr] = timeString.split(':');
  const nyHours = parseInt(nyHoursStr, 10);
  const nyMinutes = parseInt(nyMinutesStr, 10);
  const nyTotalMinutes = (nyHours === 24 ? 0 : nyHours) * 60 + nyMinutes;

  const isAsianSession = nyTotalMinutes >= 20 * 60 && nyTotalMinutes < 23 * 60;
  const isLondonSession = nyTotalMinutes >= 2 * 60 && nyTotalMinutes < 5 * 60;
  const isNYSession = nyTotalMinutes >= 8 * 60 && nyTotalMinutes < 11 * 60;
  const isNewsBlackout = nyTotalMinutes >= 8 * 60 + 30 && nyTotalMinutes < 8 * 60 + 45;

  if (isNYSession) {
    if (nyTotalMinutes >= 8 * 60 + 20 && nyTotalMinutes < 8 * 60 + 30) {
      return { gate: 'COMEX Open', details: 'Metals Pit Open', isBlackout: false };
    }
    if (isNewsBlackout) {
      return { gate: 'Major News Spike', details: 'NFP/CPI News Flush Window Blackout', isBlackout: true };
    }
    if (nyTotalMinutes >= 9 * 60 + 30 && nyTotalMinutes < 10 * 60) {
      return { gate: 'Equity Open Box', details: 'US Stock Market Open Initial Trap', isBlackout: false };
    }
    if (nyTotalMinutes >= 10 * 60 && nyTotalMinutes < 11 * 60) {
      return { gate: '10:00 AM Club', details: '4-Hour Algorithmic Rotation Reversal', isBlackout: false };
    }
    return { gate: 'New York Session', details: 'NY Execution Window', isBlackout: false };
  }

  if (isAsianSession) return { gate: 'Asian Session', details: 'Asian Cross Scalping', isBlackout: false };
  if (isLondonSession) return { gate: 'London Session', details: 'London Core Liquidity Hunt Window', isBlackout: false };

  return { gate: 'Gap Time', details: 'Dead Hours', isBlackout: true };
}

// ── initMarketStore ───────────────────────────────────────────────────────────
export async function initMarketStore() {
  // Select the best available provider and cache it
  const provider = refreshGlobalProvider();
  activeDataSource = provider.source;

  console.log(`[MarketStore] Initialising with data source: ${activeDataSource.toUpperCase()}`);

  const now = new Date();

  for (const key of Object.keys(ASSET_MAP)) {
    const config = ASSET_MAP[key];
    const brokerSymbol = toBrokerSymbol(key);
    try {
      const candles = await provider.getDailyCandles(key, brokerSymbol, 14);

      if (candles && candles.length >= 1) {
        const available = candles.slice(-Math.min(4, candles.length));
        const yesterday = available[available.length - 1];

        let signalDay: MarketData['signalDay'] = 'Normal';

        if (available.length >= 4) {
          const [d0, d1, d2, d3] = available;
          if (d3.high < d2.high && d3.low > d2.low) {
            signalDay = 'Inside Day';
          } else {
            const isTrendUp   = d0.high < d1.high && d1.high < d2.high;
            const isTrendDown = d0.low  > d1.low  && d1.low  > d2.low;
            if (isTrendUp   && d3.close < d3.open) signalDay = 'FRD';
            else if (isTrendDown && d3.close > d3.open) signalDay = 'FGD';
          }
        } else if (available.length >= 2) {
          const prev = available[available.length - 2];
          if (yesterday.high < prev.high && yesterday.low > prev.low) signalDay = 'Inside Day';
        }

        const recentDailyCandles = available.map(q => ({
          date: q.date.split('T')[0],
          open: q.open,
          high: q.high,
          low:  q.low,
          close: q.close,
        }));

        const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

        let mondayHigh = yesterday.high;
        let mondayLow = yesterday.low;
        let dayOfWeekCycle: 1|2|3 = 1;
        let how = yesterday.high;
        let low_week = yesterday.low;

        // Stacey Burke Algorithmic Day Counting
        let dayCountCycle: 1|2|3 = 1;
        let lastTrend = 0; // 1 for up, -1 for down

        for (let i = 1; i < candles.length - 1; i++) {
          const prev = candles[i - 1];
          const curr = candles[i];
          
          const isGreen = curr.close > curr.open;
          const isRed = curr.close < curr.open;
          const brokeHigh = curr.high > prev.high;
          const brokeLow = curr.low < prev.low;
          
          let isDay1 = false;
          
          if (brokeHigh && isRed) {
             // First Red Day
             isDay1 = true;
             lastTrend = -1;
          } else if (brokeLow && isGreen) {
             // First Green Day
             isDay1 = true;
             lastTrend = 1;
          } else if (brokeHigh && curr.close > prev.high) {
             // Starting a trend outside
             if (lastTrend !== 1) {
                isDay1 = true;
                lastTrend = 1;
             }
          } else if (brokeLow && curr.close < prev.low) {
             if (lastTrend !== -1) {
                isDay1 = true;
                lastTrend = -1;
             }
          }
          
          if (isDay1) {
            dayCountCycle = 1;
          } else {
            dayCountCycle = (dayCountCycle % 3) + 1 as 1|2|3;
          }
        }
        
        dayOfWeekCycle = dayCountCycle;

        markets[key] = {
          symbol:      config.symbol,
          displayName: config.name,
          currentPrice:  yesterday.close,
          open:          yesterday.open,
          high:          yesterday.high,
          low:           yesterday.low,
          prevClose:     yesterday.close,
          hod: yesterday.high,
          lod: yesterday.low,
          hos: yesterday.high,
          los: yesterday.low,
          how,
          low_week,
          signalDay,
          dayOfWeek,
          dayOfWeekCycle,
          mondayHigh,
          mondayLow,
          asianHigh: yesterday.high,
          asianLow: yesterday.low,
          londonHigh: yesterday.high,
          londonLow: yesterday.low,
          pipSize: config.pipSize,
          change: 0,
          changePercent: 0,
          recentDailyCandles,
          lastUpdated: now.toISOString(),
        };
      }
    } catch (e) {
      console.error(`[MarketStore] Failed to fetch historical for ${key}:`, e);
    }
  }
}

// ── Alert status refresh ──────────────────────────────────────────────────────
export function updateAlertStatuses() {
  const now = new Date();
  alerts.forEach(alert => {
    const market = markets[alert.symbol];
    if (!market) return;

    const diff = Math.abs(market.currentPrice - alert.triggerPrice);
    const pipsDiff = diff / (market.pipSize || 1);
    const elapsedMin = (now.getTime() - new Date(alert.timestamp).getTime()) / 60000;

    if (elapsedMin > 45 || pipsDiff > 80) {
      alert.status = 'Trade Expired';
    } else if (pipsDiff <= 8) {
      alert.status = 'Trade Now';
    } else if (pipsDiff <= 25) {
      alert.status = 'Get Ready';
    } else {
      alert.status = 'Wait';
    }
  });
}

// ── Live price batch update (provider-agnostic) ───────────────────────────────
export async function updateMarketPrices(shouldSyncPrices = true) {
  const now = new Date();
  const currentGate = getTimingGate();
  const provider = globalProvider();
  
  // FIX: Track actual active provider dynamically
  activeDataSource = provider.source;

  // Session change → reset HOS/LOS to current price
  if (currentGate.gate !== activeSessionName) {
    activeSessionName = currentGate.gate;
    if (activeSessionName !== 'Gap Time') {
      sessionStartTimes[activeSessionName] = now.getTime();
      for (const symbol of Object.keys(markets)) {
        markets[symbol].hos = markets[symbol].currentPrice;
        markets[symbol].los = markets[symbol].currentPrice;
      }
    }
  }

  if (shouldSyncPrices) {
    const currentBatch = BATCHES[yahooBatchIndex % BATCHES.length];
    yahooBatchIndex++;

    try {
      const batchInput = currentBatch
        .filter(s => markets[s])
        .map(s => ({ yahoo: s, broker: toBrokerSymbol(s) }));

      const quotes = await provider.getLiveQuoteBatch(batchInput);

      const currNY = (parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[0], 10) === 24 ? 0 : parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[0], 10)) * 60 + parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[1], 10);

      for (const q of quotes) {
        // getLiveQuoteBatch returns quotes keyed either by yahoo or broker symbol
        // Find the market entry regardless of which key is used
        const symbol = Object.keys(markets).find(
          k => k === q.symbol || toBrokerSymbol(k) === q.symbol
        );
        if (!symbol) continue;

        const market = markets[symbol];
        const currentPrice = q.price;

        market.currentPrice = currentPrice;
        market.high = Math.max(market.high, currentPrice);
        market.low  = Math.min(market.low,  currentPrice);
        market.hod  = market.high;
        market.lod  = market.low;
        market.change = currentPrice - market.prevClose;
        market.changePercent = market.prevClose !== 0
          ? (market.change / market.prevClose) * 100
          : 0;

        let prevNY = -1;
        if (market.lastUpdated) {
          const [hPrev, mPrev] = GLOBAL_FORMATTER_HM.format(new Date(market.lastUpdated)).split(':');
          prevNY = (parseInt(hPrev, 10) === 24 ? 0 : parseInt(hPrev, 10)) * 60 + parseInt(mPrev, 10);
        }

        if (prevNY !== -1) {
          if (prevNY < 1200 && currNY >= 1200) { market.asianHigh = currentPrice; market.asianLow = currentPrice; }
          if (prevNY < 120 && currNY >= 120) { market.londonHigh = currentPrice; market.londonLow = currentPrice; }
        }

        if (currNY >= 1200 || currNY < 120) {
          market.asianHigh = Math.max(market.asianHigh, currentPrice);
          market.asianLow = Math.min(market.asianLow, currentPrice);
        } else if (currNY >= 120 && currNY < 480) {
          market.londonHigh = Math.max(market.londonHigh, currentPrice);
          market.londonLow = Math.min(market.londonLow, currentPrice);
        }

        market.lastUpdated = now.toISOString();

        // Update session HOS/LOS during first hour only
        if (activeSessionName !== 'Gap Time') {
          const sessionStart = sessionStartTimes[activeSessionName];
          if (sessionStart && now.getTime() - sessionStart < 3_600_000) {
            market.hos = Math.max(market.hos, currentPrice);
            market.los = Math.min(market.los, currentPrice);
          }
        }

        // BUG FIX #3: Persist real bid/ask from live quote into liveSpreads store
        liveSpreads[symbol] = { bid: q.bid, ask: q.ask };

        await checkForTrapTrigger(symbol, market, { bid: q.bid, ask: q.ask });
      }
    } catch (err) {
      console.error(`[MarketStore] ${provider.source} price sync error:`, err);
    }
  }

  // Cross-pair derived prices (always calculated regardless of provider)
  const eurusd = markets['EURUSD=X']?.currentPrice || 1.0723;
  const gbpusd = markets['GBPUSD=X']?.currentPrice || 1.2918;
  const usdjpy = markets['USDJPY=X']?.currentPrice || 154.50;

  if (markets['GBPJPY=X']) {
    markets['GBPJPY=X'].currentPrice = gbpusd * usdjpy;
    markets['GBPJPY=X'].change = markets['GBPJPY=X'].currentPrice - markets['GBPJPY=X'].prevClose;
  }
  if (markets['EURGBP=X']) {
    markets['EURGBP=X'].currentPrice = eurusd / gbpusd;
    markets['EURGBP=X'].change = markets['EURGBP=X'].currentPrice - markets['EURGBP=X'].prevClose;
  }

  updateAlertStatuses();
}

// ── Level 2 Trap Detection ────────────────────────────────────────────────────
async function checkForTrapTrigger(symbol: string, market: MarketData, quote: { bid: number; ask: number }) {
  const timing = getTimingGate();
  if (timing.isBlackout || timing.gate === 'Gap Time') return;

  const bid = quote.bid || market.currentPrice;
  const ask = quote.ask || market.currentPrice;
  const spread = Math.abs(ask - bid) / market.pipSize;
  if (spread > 3.0) return; // Spread filter — abort on wide spread

  const now = new Date();
  const nyMinutes = parseInt(GLOBAL_FORMATTER_MINUTE.format(now), 10);
  const isRotationMins =
    nyMinutes >= 58 || nyMinutes <= 2 ||
    (nyMinutes >= 13 && nyMinutes <= 17) ||
    (nyMinutes >= 28 && nyMinutes <= 32) ||
    (nyMinutes >= 43 && nyMinutes <= 47);

  if (!isRotationMins) return;

  // Session must be established (> 60 min old) before we look for boundary reversals
  const isBoundaryLocked =
    activeSessionName !== 'Gap Time' &&
    now.getTime() - (sessionStartTimes[activeSessionName] || 0) > 3_600_000;
  if (!isBoundaryLocked) return;

  // Proximity checks
  const isNearHOD = market.currentPrice >= market.hod - 2 * market.pipSize && market.currentPrice <= market.hod + 10 * market.pipSize;
  const isNearLOD = market.currentPrice <= market.lod + 2 * market.pipSize && market.currentPrice >= market.lod - 10 * market.pipSize;
  const isNearHOS = market.currentPrice >= market.hos - 2 * market.pipSize && market.currentPrice <= market.hos + 10 * market.pipSize;
  const isNearLOS = market.currentPrice <= market.los + 2 * market.pipSize && market.currentPrice >= market.los - 10 * market.pipSize;

  if (!isNearHOD && !isNearLOD && !isNearHOS && !isNearLOS) return;

  // Fetch 1-minute candles for Level 2 confirmation (via active provider)
  let minuteCandles;
  let m15Candles;
  try {
    minuteCandles = await globalProvider().getMinuteCandles(symbol, toBrokerSymbol(symbol), 100);
    m15Candles = await globalProvider().get15MinuteCandles(symbol, toBrokerSymbol(symbol), 25);
  } catch {
    return;
  }

  if (minuteCandles.length < 25 || !m15Candles || m15Candles.length < 10) return;

  // ── Stacey Burke 15M Logic (BOS & 3 Pushes) ──
  const swingHighs: { idx: number; price: number }[] = [];
  const swingLows: { idx: number; price: number }[] = [];
  
  for (let i = 2; i < m15Candles.length - 1; i++) {
    const c = m15Candles[i];
    const prev1 = m15Candles[i-1];
    const next1 = m15Candles[i+1];
    
    if (c.high > prev1.high && c.high > next1.high) swingHighs.push({ idx: i, price: c.high });
    if (c.low < prev1.low && c.low < next1.low) swingLows.push({ idx: i, price: c.low });
  }

  const last15MClosed = m15Candles[m15Candles.length - 2];
  let has15M_BOS_Short = false;
  let has15M_BOS_Long = false;
  let has3PushesUp = swingHighs.length >= 3;
  let has3PushesDown = swingLows.length >= 3;

  if (swingLows.length > 0) {
    const lastSwingLow = swingLows[swingLows.length - 1].price;
    market.last15MSwingLow = lastSwingLow;
    if (last15MClosed.close < lastSwingLow) has15M_BOS_Short = true;
  }
  if (swingHighs.length > 0) {
    const lastSwingHigh = swingHighs[swingHighs.length - 1].price;
    market.last15MSwingHigh = lastSwingHigh;
    if (last15MClosed.close > lastSwingHigh) has15M_BOS_Long = true;
  }

  // 1-minute 100-EMA (approximates 5-minute 20-EMA in algorithmic terms)
  let ema100 = minuteCandles[0].close || market.currentPrice;
  const k = 2 / (100 + 1);
  for (let i = 1; i < minuteCandles.length; i++) {
    const c = minuteCandles[i].close;
    if (c) ema100 = c * k + ema100 * (1 - k);
  }

  const lastClosedCandle  = minuteCandles[minuteCandles.length - 2];
  const currentCandle     = minuteCandles[minuteCandles.length - 1];
  const prevClosedCandle  = minuteCandles[minuteCandles.length - 3];

  if (!lastClosedCandle?.close) return;

  // Candlestick pattern recognition
  const bodySize  = Math.abs(lastClosedCandle.close - lastClosedCandle.open);
  const upperWick = lastClosedCandle.high - Math.max(lastClosedCandle.open, lastClosedCandle.close);
  const lowerWick = Math.min(lastClosedCandle.open, lastClosedCandle.close) - lastClosedCandle.low;

  const isPinHammerShort = upperWick > bodySize * 2 && upperWick > lowerWick;
  const isPinHammerLong  = lowerWick > bodySize * 2 && lowerWick > upperWick;

  const isEngulfingShort = prevClosedCandle &&
    lastClosedCandle.close < prevClosedCandle.low &&
    lastClosedCandle.open >= prevClosedCandle.close;
  const isEngulfingLong  = prevClosedCandle &&
    lastClosedCandle.close > prevClosedCandle.high &&
    lastClosedCandle.open <= prevClosedCandle.close;

  const validShortCandle = isPinHammerShort || isEngulfingShort;
  const validLongCandle  = isPinHammerLong  || isEngulfingLong;

  let patternDetected: TrapSignal['pattern'] | null = null;
  let direction: TrapSignal['direction'] = 'SELL';
  let levelType: TrapSignal['levelType'] = 'HOD';
  let levelPrice = market.currentPrice;

  // Level 2 EMA-filtered directional logic + Stacey Burke 15M Filter
  if (isNearHOD && validShortCandle && lastClosedCandle.close < ema100 && has3PushesUp && has15M_BOS_Short) {
    if (lastClosedCandle.high >= market.hod - market.pipSize || currentCandle?.high >= market.hod - market.pipSize) {
      patternDetected = 'Peak Formation High / False Break';
      direction = 'SELL'; levelType = 'HOD'; levelPrice = market.hod;
    }
  } else if (isNearLOD && validLongCandle && lastClosedCandle.close > ema100 && has3PushesDown && has15M_BOS_Long) {
    if (lastClosedCandle.low <= market.lod + market.pipSize || currentCandle?.low <= market.lod + market.pipSize) {
      patternDetected = 'Peak Formation Low / False Break';
      direction = 'BUY'; levelType = 'LOD'; levelPrice = market.lod;
    }
  } else if (isNearHOS && validShortCandle && lastClosedCandle.close < ema100 && has3PushesUp && has15M_BOS_Short) {
    if (lastClosedCandle.high >= market.hos - market.pipSize || currentCandle?.high >= market.hos - market.pipSize) {
      patternDetected = 'Session Window High Trap'; direction = 'SELL'; levelType = 'HOS'; levelPrice = market.hos;
    }
  } else if (isNearLOS && validLongCandle && lastClosedCandle.close > ema100 && has3PushesDown && has15M_BOS_Long) {
    if (lastClosedCandle.low <= market.los + market.pipSize || currentCandle?.low <= market.los + market.pipSize) {
      patternDetected = 'Session Window Low Trap'; direction = 'BUY'; levelType = 'LOS'; levelPrice = market.los;
    }
  }

  if (!patternDetected) return;
  console.log(`[TRAP TRIGGER] ${symbol} pattern: ${patternDetected} (dir: ${direction}, lvl: ${levelType}, price: ${levelPrice})`);

  // Dedup: don't re-fire the same symbol+pattern within 60 minutes
  const existingIndex = alerts.findIndex(
    a => a.symbol === symbol && a.pattern === patternDetected &&
         now.getTime() - new Date(a.timestamp).getTime() < 3_600_000
  );
  if (existingIndex !== -1) return;

  const entryPrice = lastClosedCandle.close;
  let stopLossDistPips: number;
  if (direction === 'SELL') {
    stopLossDistPips = ((lastClosedCandle.high - entryPrice) / market.pipSize) + spread + 2.0;
  } else {
    stopLossDistPips = ((entryPrice - lastClosedCandle.low) / market.pipSize) + spread + 2.0;
  }

  if (stopLossDistPips > 25) return; // Trap too wide — abort per playbook

  // Three-Session Setup Logic:
  // Asian sets high/low. London breaks it. NY reverses it.
  const londonBrokeAsia = market.londonHigh > market.asianHigh || market.londonLow < market.asianLow;
  const nyReversing = (londonBrokeAsia && market.currentPrice > market.londonLow && market.currentPrice < market.londonHigh);
  const isThreeSessionSetup = londonBrokeAsia && nyReversing && timing.gate === 'New York Session';

  // Day 1 Filter Logic
  if (market.dayOfWeekCycle === 1 && !isThreeSessionSetup) {
    return; // Block Day 1 trades unless it's a 3-Session Setup
  }

  const isThreeDaySetup = market.dayOfWeekCycle === 3;
  const isHolyGrailConfluence = isThreeDaySetup && isThreeSessionSetup;

  const confluence = calculateConfluenceScore(market, symbol, timing.gate, now.toISOString());
  const grade = Math.max(1, Math.min(5, confluence?.grade ?? 3)) as TrapSignal['grade'];

  const newAlert: TrapSignal = {
    id: `${symbol}-${Date.now()}`,
    symbol,
    displayName: market.displayName,
    pattern: patternDetected,
    direction,
    triggerPrice: ask,
    levelType,
    keyLevel: levelPrice,
    grade,
    timingGate: timing.gate,
    timestamp: now.toISOString(),
    details: `${patternDetected} ${direction} trap at ${levelType} (${levelPrice.toFixed(5)}). ${timing.details}`,
    confluenceMatrix: confluence?.matrix,
    suggestedStopLoss: stopLossDistPips,
    suggestedTakeProfit: stopLossDistPips * 2, // 1:2 default R:R
    isThreeDaySetup,
    isThreeSessionSetup,
    isHolyGrailConfluence,
    status: 'Trade Now',
  };

  // Guard against concurrent duplicate execution
  const signalKey = `${symbol}-${patternDetected}`;
  if (executingSignals.has(signalKey)) return;
  executingSignals.add(signalKey);

  // 1. INSTANT BOT EXECUTION (Bypassing AI latency)
  try {
    await executeTradeForUsers(newAlert, stopLossDistPips, 50, 5.0);
    console.log(`[MarketStore] Bot executed instantly: ${symbol} ${direction}. Bypassing AI for speed.`);
  } catch (err) {
    console.error(`[MarketStore] Bot execution error for ${symbol}:`, err);
  }

  // 2. GEMINI AUDIT FOR SIGNAL UI
  // The user requested that nothing appears in the Signals window without Gemini Audit.
  try {
    const aiDecision = await evaluateSignalWithAI(newAlert, market);
    if (aiDecision.approve) {
      newAlert.status = 'Trade Now';
      newAlert.details += ` [GEMINI AUDITED: ${aiDecision.reasoning}]`;
      
      // Only push to UI after Gemini approval
      alerts.unshift(newAlert);
      if (alerts.length > 50) alerts.length = 50;
      console.log(`[MarketStore] Gemini Approved ${symbol} signal. Broadcasting to UI.`);
    } else {
      console.log(`[MarketStore] Gemini Rejected ${symbol} signal for UI display: ${aiDecision.reasoning}`);
      // It will NOT be pushed to the alerts array.
    }
  } catch (err) {
    console.error('[MarketStore] Error during AI evaluation:', err);
  } finally {
    executingSignals.delete(signalKey);
  }
}

// ── Public accessors ──────────────────────────────────────────────────────────
export function manuallyTriggerTrap(_symbol: string, _patternType: string): TrapSignal {
  return {} as TrapSignal; // UI compatibility — no fake trades
}

export function getMarkets() {
  return Object.values(markets);
}

// 🛡️ BUG FIX #3: Export live spreads so botManagerTick can pass real bid/ask to bots
export function getMarketSpreads(): Record<string, { bid: number; ask: number }> {
  return liveSpreads;
}

export function getAlerts() {
  return alerts;
}

export function getAlertById(id: string) {
  return alerts.find(a => a.id === id);
}
