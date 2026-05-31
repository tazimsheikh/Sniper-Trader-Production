import { MarketData, TrapSignal } from '../src/types';
import { executeTradeForProfile } from './metaApiHandler';
import { getProviderForProfile, toBrokerSymbol, CandleProvider } from './candleProvider';

// ── Shared pip size registry (single source of truth) ────────────────────────
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

// ── Batch layout for live-price polling ──────────────────────────────────────
const BATCHES: string[][] = [
  ['NQ=F', 'GC=F', 'CL=F', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X'],
  ['NZDUSD=X', 'USDCHF=X', 'GBPJPY=X', 'EURGBP=X', 'EURJPY=X', 'AUDJPY=X', 'EURAUD=X'],
  ['GBPAUD=X', 'CHFJPY=X', 'AUDCAD=X', 'EURCAD=X', 'NZDJPY=X', 'GBPCAD=X'],
];

const GLOBAL_FORMATTER_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
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

export class ProfileStore {
  profileId: number;
  markets: Record<string, MarketData> = {};
  alerts: TrapSignal[] = [];
  liveSpreads: Record<string, { bid: number; ask: number }> = {};
  activeDataSource: 'yahoo' | 'metaapi' | 'simulation' = 'yahoo';
  executingSignals = new Set<string>();
  
  activeSessionName = 'Gap Time';
  sessionStartTimes: Record<string, number> = {};
  yahooBatchIndex = 0;

  // Unified Engine Simulation Support
  isSimulation: boolean = false;
  mockTrades: any[] = [];
  simulationConfig = {
      tpMultiplier: 5.0,
      slBuffer: 2.0
  };

  private lastM15FetchTime: Record<string, number> = {};
  public cachedM15Candles: Record<string, any[]> = {};

  constructor(profileId: number) {
    this.profileId = profileId;
  }

  async init() {
    const provider = await getProviderForProfile(this.profileId);
    this.activeDataSource = provider.source;
    console.log(`[ProfileStore ${this.profileId}] Initialising with data source: ${this.activeDataSource.toUpperCase()}`);

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

          const recentDailyCandles = candles.map(q => ({
            date: q.date.split('T')[0],
            open: q.open,
            high: q.high,
            low:  q.low,
            close: q.close,
          }));

          const adr14 = candles.length > 0 
            ? candles.reduce((sum, c) => sum + (c.high - c.low), 0) / candles.length / config.pipSize
            : 0;

          const dayOfWeek = now.getDay();

          let mondayHigh = yesterday.high;
          let mondayLow = yesterday.low;
          let dayOfWeekCycle: 1|2|3 = 1;
          let how = yesterday.high;
          let low_week = yesterday.low;

          let dayCountCycle: 1|2|3 = 1;
          let lastTrend = 0;

          for (let i = 1; i < candles.length - 1; i++) {
            const prev = candles[i - 1];
            const curr = candles[i];
            
            const isGreen = curr.close > curr.open;
            const isRed = curr.close < curr.open;
            const brokeHigh = curr.high > prev.high;
            const brokeLow = curr.low < prev.low;
            
            let isDay1 = false;
            
            if (brokeHigh && isRed) {
               isDay1 = true;
               lastTrend = -1;
            } else if (brokeLow && isGreen) {
               isDay1 = true;
               lastTrend = 1;
            } else if (brokeHigh && curr.close > prev.high) {
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

          this.markets[key] = {
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
            londonOpen: yesterday.open,
            londonClose: yesterday.close,
            londonNarrative: 'NONE',
            pipSize: config.pipSize,
            change: 0,
            changePercent: 0,
            recentDailyCandles,
            adr14,
            lastUpdated: now.toISOString(),
          };
        }
      } catch (e) {
        console.error(`[ProfileStore ${this.profileId}] Failed to fetch historical for ${key}:`, e);
      }
    }
  }

  updateAlertStatuses() {
    const now = new Date();
    this.alerts.forEach(alert => {
      const market = this.markets[alert.symbol];
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

  async updatePrices(shouldSyncPrices = true) {
    if (this.isSimulation) return; 

    const now = new Date();
    const currentGate = getTimingGate();
    const provider = await getProviderForProfile(this.profileId);
    
    this.activeDataSource = provider.source;

    if (currentGate.gate !== this.activeSessionName) {
      this.activeSessionName = currentGate.gate;
      if (this.activeSessionName !== 'Gap Time') {
        this.sessionStartTimes[this.activeSessionName] = now.getTime();
        for (const symbol of Object.keys(this.markets)) {
          this.markets[symbol].hos = this.markets[symbol].currentPrice;
          this.markets[symbol].los = this.markets[symbol].currentPrice;
        }
      }
    }

    if (shouldSyncPrices) {
      const currentBatch = BATCHES[this.yahooBatchIndex % BATCHES.length];
      this.yahooBatchIndex++;

      try {
        const batchInput = currentBatch
          .filter(s => this.markets[s])
          .map(s => ({ yahoo: s, broker: toBrokerSymbol(s) }));

        const quotes = await provider.getLiveQuoteBatch(batchInput);

        const currNY = (parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[0], 10) === 24 ? 0 : parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[0], 10)) * 60 + parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[1], 10);

        for (const q of quotes) {
          const symbol = Object.keys(this.markets).find(
            k => k === q.symbol || toBrokerSymbol(k) === q.symbol
          );
          if (!symbol) continue;

          const market = this.markets[symbol];
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

          // Compute M15 swings (throttle fetch to every 5 mins to ensure fresh but not rate-limited)
          const nowMs = now.getTime();
          const lastFetch = this.lastM15FetchTime[symbol] || 0;
          if (nowMs - lastFetch > 5 * 60 * 1000 || !this.cachedM15Candles[symbol]) {
             try {
                const brokerSymbolForM15 = toBrokerSymbol(symbol);
                const m15 = await provider.get15MinuteCandles(symbol, brokerSymbolForM15, 50);
                this.cachedM15Candles[symbol] = m15;
                this.lastM15FetchTime[symbol] = nowMs;
                
                let last15MSwingLow = -Infinity, last15MSwingHigh = Infinity;
                if (m15 && m15.length >= 3) {
                   for (let i = 1; i < m15.length - 1; i++) {
                      if (m15[i].low < m15[i-1].low && m15[i].low < m15[i+1].low) last15MSwingLow = m15[i].low;
                      if (m15[i].high > m15[i-1].high && m15[i].high > m15[i+1].high) last15MSwingHigh = m15[i].high;
                   }
                }
                market.last15MSwingHigh = last15MSwingHigh !== Infinity ? last15MSwingHigh : undefined;
                market.last15MSwingLow = last15MSwingLow !== -Infinity ? last15MSwingLow : undefined;
             } catch(e) { /* ignore */ }
          }

          let prevNY = -1;
          if (market.lastUpdated) {
            const [hPrev, mPrev] = GLOBAL_FORMATTER_HM.format(new Date(market.lastUpdated)).split(':');
            prevNY = (parseInt(hPrev, 10) === 24 ? 0 : parseInt(hPrev, 10)) * 60 + parseInt(mPrev, 10);
          }

          if (prevNY !== -1) {
            if (prevNY < 1200 && currNY >= 1200) { market.asianHigh = currentPrice; market.asianLow = currentPrice; }
            if (prevNY < 120 && currNY >= 120) { 
               market.londonHigh = currentPrice; 
               market.londonLow = currentPrice; 
               market.londonOpen = currentPrice;
               market.londonNarrative = 'NONE';
            }
            if (prevNY < 180 && currNY >= 180) {
               market.londonClose = currentPrice;
               if (market.londonClose > market.londonOpen) {
                  market.londonNarrative = 'PUMP';
               } else if (market.londonClose < market.londonOpen) {
                  market.londonNarrative = 'DUMP';
               } else {
                  market.londonNarrative = 'NONE';
               }
            }
          }

          if (currNY >= 1200 || currNY < 120) {
            market.asianHigh = Math.max(market.asianHigh, currentPrice);
            market.asianLow = Math.min(market.asianLow, currentPrice);
          } else if (currNY >= 120 && currNY < 480) {
            market.londonHigh = Math.max(market.londonHigh, currentPrice);
            market.londonLow = Math.min(market.londonLow, currentPrice);
          }

          market.lastUpdated = now.toISOString();

          if (this.activeSessionName !== 'Gap Time') {
            const sessionStart = this.sessionStartTimes[this.activeSessionName];
            if (sessionStart && now.getTime() - sessionStart < 3_600_000) {
              market.hos = Math.max(market.hos, currentPrice);
              market.los = Math.min(market.los, currentPrice);
            }
          }

          this.liveSpreads[symbol] = { bid: q.bid, ask: q.ask };

          await this.checkForTrapTrigger(symbol, market, { bid: q.bid, ask: q.ask });
        }
      } catch (err) {
        console.error(`[ProfileStore ${this.profileId}] ${provider.source} price sync error:`, err);
      }
    }

    const eurusd = this.markets['EURUSD=X']?.currentPrice || 1.0723;
    const gbpusd = this.markets['GBPUSD=X']?.currentPrice || 1.2918;
    const usdjpy = this.markets['USDJPY=X']?.currentPrice || 154.50;

    if (this.markets['GBPJPY=X']) {
      this.markets['GBPJPY=X'].currentPrice = gbpusd * usdjpy;
      this.markets['GBPJPY=X'].change = this.markets['GBPJPY=X'].currentPrice - this.markets['GBPJPY=X'].prevClose;
    }
    if (this.markets['EURGBP=X']) {
      this.markets['EURGBP=X'].currentPrice = eurusd / gbpusd;
      this.markets['EURGBP=X'].change = this.markets['EURGBP=X'].currentPrice - this.markets['EURGBP=X'].prevClose;
    }

    this.updateAlertStatuses();
  }

  async checkForTrapTrigger(symbol: string, market: MarketData, quote: { bid: number; ask: number }) {
      // V5: Trap Generation Logic has been moved to RefinedSniperBot.ts
      // This file purely acts as a data feed store.
      return;
  }

  // Inject historical ticks directly into the bot logic
  async processMockTick(symbol: string, currentPrice: number, bid: number, ask: number) {
      if (!this.markets[symbol]) return;
      const market = this.markets[symbol];
      const now = new Date();
      const currentGate = getTimingGate();
      
      this.activeDataSource = 'simulation';
      
      if (currentGate.gate !== this.activeSessionName) {
        this.activeSessionName = currentGate.gate;
        if (this.activeSessionName !== 'Gap Time') {
          this.sessionStartTimes[this.activeSessionName] = now.getTime();
          market.hos = market.currentPrice;
          market.los = market.currentPrice;
        }
      }

      market.currentPrice = currentPrice;
      market.high = Math.max(market.high, currentPrice);
      market.low  = Math.min(market.low,  currentPrice);
      market.hod  = market.high;
      market.lod  = market.low;
      market.change = currentPrice - market.prevClose;
      market.changePercent = market.prevClose !== 0 ? (market.change / market.prevClose) * 100 : 0;

      const currNY = (parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[0], 10) === 24 ? 0 : parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[0], 10)) * 60 + parseInt(GLOBAL_FORMATTER_HM.format(now).split(':')[1], 10);
      
      let prevNY = -1;
      if (market.lastUpdated) {
        const [hPrev, mPrev] = GLOBAL_FORMATTER_HM.format(new Date(market.lastUpdated)).split(':');
        prevNY = (parseInt(hPrev, 10) === 24 ? 0 : parseInt(hPrev, 10)) * 60 + parseInt(mPrev, 10);
      }

      if (prevNY !== -1) {
        if (prevNY < 1200 && currNY >= 1200) { market.asianHigh = currentPrice; market.asianLow = currentPrice; }
        if (prevNY < 120 && currNY >= 120) { 
           market.londonHigh = currentPrice; 
           market.londonLow = currentPrice; 
           market.londonOpen = currentPrice;
           market.londonNarrative = 'NONE';
        }
        if (prevNY < 180 && currNY >= 180) {
           market.londonClose = currentPrice;
           if (market.londonClose > market.londonOpen) {
              market.londonNarrative = 'PUMP';
           } else if (market.londonClose < market.londonOpen) {
              market.londonNarrative = 'DUMP';
           } else {
              market.londonNarrative = 'NONE';
           }
        }
      }

      if (currNY >= 1200 || currNY < 120) {
        market.asianHigh = Math.max(market.asianHigh, currentPrice);
        market.asianLow = Math.min(market.asianLow, currentPrice);
      } else if (currNY >= 120 && currNY < 480) {
        market.londonHigh = Math.max(market.londonHigh, currentPrice);
        market.londonLow = Math.min(market.londonLow, currentPrice);
      }

      market.lastUpdated = now.toISOString();

      if (this.activeSessionName !== 'Gap Time') {
        const sessionStart = this.sessionStartTimes[this.activeSessionName];
        if (sessionStart && now.getTime() - sessionStart < 3_600_000) {
          market.hos = Math.max(market.hos, currentPrice);
          market.los = Math.min(market.los, currentPrice);
        }
      }

      this.liveSpreads[symbol] = { bid, ask };
      await this.checkForTrapTrigger(symbol, market, { bid, ask });
  }
}

// Global registry of active ProfileStores
export const profileStores = new Map<number, ProfileStore>();

export function deleteProfileStore(profileId: number) {
  profileStores.delete(profileId);
}

export async function getOrCreateProfileStore(profileId: number): Promise<ProfileStore> {
  if (!profileStores.has(profileId)) {
    const store = new ProfileStore(profileId);
    await store.init();
    profileStores.set(profileId, store);
  }
  return profileStores.get(profileId)!;
}

export function manuallyTriggerTrap(_symbol: string, _patternType: string): TrapSignal {
  return {} as TrapSignal;
}

// Helpers for the engine to grab data per profile
export function getProfileMarkets(profileId: number) {
  const store = profileStores.get(profileId);
  return store ? Object.values(store.markets) : [];
}

export function getProfileMarketSpreads(profileId: number) {
  const store = profileStores.get(profileId);
  return store ? store.liveSpreads : {};
}

export function getProfileAlerts(profileId: number) {
  const store = profileStores.get(profileId);
  return store ? store.alerts : [];
}

export function getProfileAlertById(profileId: number, alertId: string) {
  const store = profileStores.get(profileId);
  return store ? store.alerts.find(a => a.id === alertId) : undefined;
}

export function getProfileActiveDataSource(profileId: number) {
  const store = profileStores.get(profileId);
  return store ? store.activeDataSource : 'yahoo';
}

export function getProfileM15Candles(profileId: number, symbol: string) {
  const store = profileStores.get(profileId);
  if (!store) return [];
  // Find the exact key (e.g. 'EURUSD=X')
  const exactKey = Object.keys(store.markets).find(k => store.markets[k].symbol === symbol || k === symbol);
  return exactKey ? (store.cachedM15Candles[exactKey] || []) : [];
}
