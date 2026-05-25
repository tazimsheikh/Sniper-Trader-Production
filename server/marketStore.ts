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

// Track the active data-source for the UI badge
export let activeDataSource: 'yahoo' | 'metaapi' = 'yahoo';

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
export function getTimingGate(): { gate: TrapSignal['timingGate']; details: string; isBlackout: boolean } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
  });

  const timeString = formatter.format(now);
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
          how: Math.max(...available.map(q => q.high)),
          low_week: Math.min(...available.map(q => q.low)),
          pipSize: config.pipSize,
          change: 0,
          changePercent: 0,
          signalDay,
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
        market.lastUpdated = now.toISOString();

        // Update session HOS/LOS during first hour only
        if (activeSessionName !== 'Gap Time') {
          const sessionStart = sessionStartTimes[activeSessionName];
          if (sessionStart && now.getTime() - sessionStart < 3_600_000) {
            market.hos = Math.max(market.hos, currentPrice);
            market.los = Math.min(market.los, currentPrice);
          }
        }

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
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', minute: 'numeric' });
  const nyMinutes = parseInt(formatter.format(now), 10);
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
  try {
    minuteCandles = await globalProvider().getMinuteCandles(symbol, toBrokerSymbol(symbol), 100);
  } catch {
    return;
  }

  if (minuteCandles.length < 25) return;

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
    lastClosedCandle.open  > prevClosedCandle.close;
  const isEngulfingLong  = prevClosedCandle &&
    lastClosedCandle.close > prevClosedCandle.high &&
    lastClosedCandle.open  < prevClosedCandle.close;

  const validShortCandle = isPinHammerShort || isEngulfingShort;
  const validLongCandle  = isPinHammerLong  || isEngulfingLong;

  let patternDetected: TrapSignal['pattern'] | null = null;
  let direction: TrapSignal['direction'] = 'SELL';
  let levelType: TrapSignal['levelType'] = 'HOD';
  let keyLevel = market.currentPrice;
  let details  = '';
  const highestPeak  = lastClosedCandle.high;
  const lowestValley = lastClosedCandle.low;

  // Level 2 EMA-filtered directional logic
  if (isNearHOD && validShortCandle && lastClosedCandle.close < ema100) {
    if (lastClosedCandle.high > market.hod || currentCandle?.high > market.hod) {
      patternDetected = market.signalDay === 'FRD' ? 'Day 2 Short (Post-FRD)' : 'Post-Inside Day False Break';
      direction = 'SELL'; levelType = 'HOD'; keyLevel = market.hod;
      details = `Level 2: False breakout of HOD. Pierce at ${highestPeak.toFixed(4)}, rejected with ${isPinHammerShort ? 'Pin Hammer' : 'Engulfing'}, closed below 20 EMA.`;
    }
  } else if (isNearLOD && validLongCandle && lastClosedCandle.close > ema100) {
    if (lastClosedCandle.low < market.lod || currentCandle?.low < market.lod) {
      patternDetected = market.signalDay === 'FGD' ? 'Day 2 Long (Post-FGD)' : 'Post-Inside Day False Break';
      direction = 'BUY'; levelType = 'LOD'; keyLevel = market.lod;
      details = `Level 2: False breakout of LOD. Pierce at ${lowestValley.toFixed(4)}, rejected with ${isPinHammerLong ? 'Pin Hammer' : 'Engulfing'}, closed above 20 EMA.`;
    }
  } else if (isNearHOS && validShortCandle && lastClosedCandle.close < ema100) {
    if (lastClosedCandle.high > market.hos || currentCandle?.high > market.hos) {
      patternDetected = 'Session Boundary Reversal'; direction = 'SELL'; levelType = 'HOS'; keyLevel = market.hos;
      details = `Level 2: Session stop hunt at HOS (${highestPeak.toFixed(4)}). Rejected below EMA.`;
    }
  } else if (isNearLOS && validLongCandle && lastClosedCandle.close > ema100) {
    if (lastClosedCandle.low < market.los || currentCandle?.low < market.los) {
      patternDetected = 'Session Boundary Reversal'; direction = 'BUY'; levelType = 'LOS'; keyLevel = market.los;
      details = `Level 2: Session stop hunt at LOS (${lowestValley.toFixed(4)}). Rejected above EMA.`;
    }
  }

  if (!patternDetected) return;

  // Dedup: don't re-fire the same symbol+pattern within 60 minutes
  const existingIndex = alerts.findIndex(
    a => a.symbol === symbol && a.pattern === patternDetected &&
         now.getTime() - new Date(a.timestamp).getTime() < 3_600_000
  );
  if (existingIndex !== -1) return;

  const entryPrice = lastClosedCandle.close;
  let stopLossDistPips: number;
  if (direction === 'SELL') {
    stopLossDistPips = ((highestPeak - entryPrice) / market.pipSize) + spread + 2.0;
  } else {
    stopLossDistPips = ((entryPrice - lowestValley) / market.pipSize) + spread + 2.0;
  }

  if (stopLossDistPips > 25) return; // Trap too wide — abort per playbook

  const confluence = calculateConfluenceScore(market, symbol, timing.gate, now.toISOString());
  const grade = Math.max(1, Math.min(5, confluence?.grade ?? 3)) as TrapSignal['grade'];

  const newAlert: TrapSignal = {
    id: `alert-${symbol}-${Date.now()}`,
    symbol,
    displayName: market.displayName,
    pattern: patternDetected,
    direction,
    triggerPrice: entryPrice,
    levelType,
    keyLevel,
    grade,
    timingGate: timing.gate,
    timestamp: now.toISOString(),
    details,
    confluenceMatrix: confluence?.matrix,
    suggestedStopLoss: Math.round(stopLossDistPips * 10) / 10,
    suggestedTakeProfit: 50,
    status: 'Trade Now',
  };

  alerts.unshift(newAlert);
  if (alerts.length > 50) alerts.length = 50;

  // Guard against concurrent duplicate execution
  const signalKey = `${symbol}-${patternDetected}`;
  if (executingSignals.has(signalKey)) return;
  executingSignals.add(signalKey);

  try {
    const aiDecision = await evaluateSignalWithAI(newAlert, market);
    if (aiDecision.approve) {
      newAlert.status = 'Trade Now';
      newAlert.details += ` [AI APPROVED: ${aiDecision.reasoning}]`;
      await executeTradeForUsers(newAlert, stopLossDistPips, 50, 5.0);
    } else {
      newAlert.status = 'Wait';
      newAlert.details += ` [AI REJECTED: ${aiDecision.reasoning}]`;
      console.log(`[MarketStore] AI Rejected ${symbol} signal: ${aiDecision.reasoning}`);
    }
  } catch (err) {
    console.error('[MarketStore] Error during AI evaluation or execution:', err);
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

export function getAlerts() {
  return alerts;
}

export function getAlertById(id: string) {
  return alerts.find(a => a.id === id);
}
