import { BotConfig, BotContext, BotSignal, BotTradeState, TradeAction } from './BotInterface.js';

export interface RefinedConfig extends BotConfig {
  optimalParams: {
    emaFast: number;
    emaMedium: number;
    emaTrend: number;
    coilMaxSpread: number;
    coilMinCandles: number;
    coilMaxBoxHeight: number;
    majorLevelModulo: number;
    execZoneRadius: number;
    primaryWindowOpenHour: number;
    primaryWindowOpenMin: number;
    primaryWindowCloseHour: number;
    primaryWindowCloseMin: number;
    enableEarlyWindow: boolean;
    earlyWindowOpenHour: number;
    earlyWindowCloseHour: number;
    frontsideCutoffDay: number;
    require15MinAlignment: boolean;
    invalidationThreshold: number;
    tpUseHierarchy: boolean;
    breathingSpaceMin: number;
    useMonthlyAnchors: boolean;
    requireEmaTrendFilter: boolean;
    requireEmaLockBackside: boolean;
    emaLockCandles: number;
    slBuffer: number;
    targetExpansion: number;
    minRR: number;
    fridayOverrideEnabled: boolean;
    fridayForceCloseHour: number;
    fridayForceCloseMin: number;
    maxTradesPerDay: number;
    cooldownCandles: number;

    // Dynamic Profit Taking Params
    enableBreakEven?: boolean;
    breakEvenTriggerR?: number;
    enableTrailingStop?: boolean;
    trailingStopActivationR?: number;
    trailingStopDistanceR?: number;
  };
}

export interface CoreState {
  weeklyTrend: 'BUY' | 'SELL' | 'NEUTRAL';
  currentWeekKey: string;
  lastTradingDate: string;
  coilCounter: number;
  coilBoxHigh: number;
  coilBoxLow: number;
  tradesToday: number;
  cooldownCounter: number;
}

export class PatternHunterCore {
    static debugStats = {
        totalEvaluated: 0,
        skippedCooldown: 0,
        skippedMaxTrades: 0,
        skippedMinCandles: 0,
        skippedGate1Zone: 0,
        skippedGate2Time: 0,
        skippedGate3Weekly: 0,
        skippedPolarity: 0,
        skippedTrigger: 0,
        skippedBreathing: 0,
        skippedRR: 0,
        triggeredValid: 0
    };
  
  static initializeState(): CoreState {
    return {
      weeklyTrend: 'NEUTRAL',
      currentWeekKey: '',
      lastTradingDate: '',
      coilCounter: 0,
      coilBoxHigh: -Infinity,
      coilBoxLow: Infinity,
      tradesToday: 0,
      cooldownCounter: 0
    };
  }

  static evaluateSignal(context: BotContext, config: RefinedConfig, state: CoreState): BotSignal | null {
    const p = config.optimalParams;
    if (!p || Object.keys(p).length === 0) return null;

    const { currentPrice, brokerSymbol, m5Candles, now, recentDailyCandles, currentIndex } = context;
    const i = currentIndex !== undefined ? currentIndex : m5Candles ? m5Candles.length - 1 : -1;
    if (!m5Candles || i < Math.max(p.emaTrend, p.coilMinCandles) + 10) {
        return null;
    }
    const c = m5Candles[i]; 
    const prevC = m5Candles[i - 1];
    if (!c || !prevC) return null;

    const tickSize = brokerSymbol.includes('JPY') || brokerSymbol.includes('XAU') ? 0.01 : 0.0001;
    const spreadVal = (brokerSymbol.includes('JPY') ? 1.5 : 1.0) * tickSize;
    const slippageVal = 0.5 * tickSize;

    // --- TIME PARSING (EST) ---
    let estHour, estMinute, estDayOfWeek, currentMonth, tradingDateStr;
    let tradingDateObj: Date;

    if (context.simulatedTime) {
        estHour = context.simulatedTime.estHour;
        estMinute = context.simulatedTime.estMinute;
        estDayOfWeek = context.simulatedTime.estDayOfWeek;
        tradingDateStr = context.simulatedTime.tradingDateStr;
        currentMonth = context.simulatedTime.currentMonth;
        tradingDateObj = new Date(`${tradingDateStr}T12:00:00Z`);
    } else {
        const NY_FORMATTER = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const parts = NY_FORMATTER.formatToParts(now);
        const pParts: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== 'literal') pParts[part.type] = part.value;
        }

        estHour = parseInt(pParts.hour, 10) % 24;
        const rawMinute = parseInt(pParts.minute, 10);
        estMinute = Math.floor(rawMinute / 5) * 5; 
        
        const dStr = `${pParts.year}-${pParts.month}-${pParts.day}T12:00:00Z`;
        tradingDateObj = new Date(dStr);
        if (estHour >= 17) tradingDateObj.setUTCDate(tradingDateObj.getUTCDate() + 1);
        
        estDayOfWeek = tradingDateObj.getUTCDay();
        if (estDayOfWeek === 6) { tradingDateObj.setUTCDate(tradingDateObj.getUTCDate() + 2); estDayOfWeek = 1; }
        else if (estDayOfWeek === 0) { tradingDateObj.setUTCDate(tradingDateObj.getUTCDate() + 1); estDayOfWeek = 1; }
        
        currentMonth = tradingDateObj.getUTCMonth();
        tradingDateStr = `${tradingDateObj.getUTCFullYear()}-${String(tradingDateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(tradingDateObj.getUTCDate()).padStart(2, '0')}`;
    }

    // --- INDICATOR CALCULATION ---
    let emaFastVal = 0, emaMediumVal = 0, emaTrendVal = 0;
    
    if (context.precomputedEma) {
        emaFastVal = context.precomputedEma.fast[i];
        emaMediumVal = context.precomputedEma.medium[i];
        emaTrendVal = context.precomputedEma.trend[i];
    } else {
        const m5Closes = m5Candles.slice(0, i + 1).map(c => c.close);
        const calcEMA = (data: number[], period: number) => {
            const k = 2 / (period + 1);
            let e = data[0];
            for (let j = 1; j < data.length; j++) e = data[j] * k + e * (1 - k);
            return e;
        };
        emaFastVal = calcEMA(m5Closes, p.emaFast);
        emaMediumVal = calcEMA(m5Closes, p.emaMedium);
        emaTrendVal = calcEMA(m5Closes, p.emaTrend);
    }

    // --- COIL UPDATE ---
    const oldCoilCounter = state.coilCounter;
    const oldCoilBoxHigh = state.coilBoxHigh;
    const oldCoilBoxLow = state.coilBoxLow;

    // Use the PREVIOUS candle to update the coil state, so the CURRENT candle can break out of it!
    let spreadToCheck = Math.abs(emaFastVal - emaTrendVal) / tickSize; // Fallback
    if (context.precomputedEma && i >= 1) {
        spreadToCheck = Math.abs(context.precomputedEma.fast[i - 1] - context.precomputedEma.trend[i - 1]) / tickSize;
    } else if (i >= 1) {
        const m5ClosesPrev = m5Candles.slice(0, i).map(c => c.close);
        const calcEMA = (data: number[], period: number) => {
            const k = 2 / (period + 1);
            let e = data[0];
            for (let j = 1; j < data.length; j++) e = data[j] * k + e * (1 - k);
            return e;
        };
        const prevEmaFast = calcEMA(m5ClosesPrev, p.emaFast);
        const prevEmaTrend = calcEMA(m5ClosesPrev, p.emaTrend);
        spreadToCheck = Math.abs(prevEmaFast - prevEmaTrend) / tickSize;
    }

    if (spreadToCheck <= p.coilMaxSpread) {
        state.coilCounter++;
        state.coilBoxHigh = state.coilBoxHigh === -Infinity ? prevC.high : Math.max(state.coilBoxHigh, prevC.high);
        state.coilBoxLow = state.coilBoxLow === Infinity ? prevC.low : Math.min(state.coilBoxLow, prevC.low);
        if (Math.abs(state.coilBoxHigh - state.coilBoxLow) / tickSize > p.coilMaxBoxHeight) {
            state.coilCounter = 0; state.coilBoxHigh = -Infinity; state.coilBoxLow = Infinity;
        }
    } else {
        state.coilCounter = 0; state.coilBoxHigh = -Infinity; state.coilBoxLow = Infinity;
    }

    if (oldCoilCounter < p.coilMinCandles || oldCoilCounter === 0) {
        PatternHunterCore.debugStats.skippedMinCandles++;
        return null;
    }
    const boxHeight = (oldCoilBoxHigh - oldCoilBoxLow) / tickSize;

    // --- GATE 1: PRICE / MAJOR LEVEL ---
    const moduloPoints = p.majorLevelModulo * tickSize;
    const nearestLevel = Math.round(c.close / moduloPoints) * moduloPoints;
    const distToLevel = Math.abs(c.close - nearestLevel) / tickSize;
    if (distToLevel > p.execZoneRadius) {
        PatternHunterCore.debugStats.skippedGate1Zone++;
        return null;
    }
    
    const zonePolarity = c.close < nearestLevel ? 'BUY' : 'SELL';

    // --- GATE 2: TIME ---
    let inWindow = false;
    if (estHour > p.primaryWindowOpenHour || (estHour === p.primaryWindowOpenHour && estMinute >= p.primaryWindowOpenMin)) {
        if (estHour < p.primaryWindowCloseHour || (estHour === p.primaryWindowCloseHour && estMinute <= p.primaryWindowCloseMin)) {
            inWindow = true;
        }
    }
    if (p.enableEarlyWindow && !inWindow) {
        if (estHour >= p.earlyWindowOpenHour && estHour < p.earlyWindowCloseHour) inWindow = true;
    }
    if (!inWindow) {
        PatternHunterCore.debugStats.skippedGate2Time++;
        return null;
    }
    if (p.require15MinAlignment && estMinute % 15 !== 0) {
        PatternHunterCore.debugStats.skippedGate2Time++;
        return null;
    }

    // --- DAILY CANDLE ANCHOR PARSING ---
    let prevDayHigh = -Infinity, prevDayLow = Infinity;
    let htfHighDay1 = -Infinity, htfLowDay1 = Infinity;
    let htfHighDay3 = -Infinity, htfLowDay3 = Infinity;
    let monthHigh = -Infinity, monthLow = Infinity;
    let fridayAnchorHigh = -Infinity, fridayAnchorLow = Infinity;

    if (recentDailyCandles && recentDailyCandles.length > 0) {
        // recentDailyCandles is already sorted chronologically
        const prevDay = recentDailyCandles[recentDailyCandles.length - 1];
        if (prevDay) {
            prevDayHigh = prevDay.high;
            prevDayLow = prevDay.low;
        }
        
        let mondayOfCurrentWeek = new Date(tradingDateObj.getTime());
        mondayOfCurrentWeek.setUTCDate(mondayOfCurrentWeek.getUTCDate() - (estDayOfWeek - 1));
        mondayOfCurrentWeek.setUTCHours(0, 0, 0, 0);
        const mondayTime = mondayOfCurrentWeek.getTime();

        for (let k = recentDailyCandles.length - 1; k >= 0; k--) {
            const dc = recentDailyCandles[k];
            
            // In backtester, dow and month are injected dynamically by Data Loader.
            let dow = (dc as any).dayOfWeek;
            let dMonth = (dc as any).month;
            let dTime = (dc as any).timestamp;

            if (dow === undefined || dMonth === undefined || dTime === undefined) {
                const parts = dc.date.split('-');
                const dYear = parseInt(parts[0], 10);
                dMonth = parseInt(parts[1], 10) - 1;
                const dDay = parseInt(parts[2], 10);
                dTime = Date.UTC(dYear, dMonth, dDay, 12, 0, 0);
                dow = new Date(dTime).getUTCDay();
                if (dow === 6) dow = 1; else if (dow === 0) dow = 1;
            }
            
            const isCurrentWeek = dTime >= mondayTime;

            if (isCurrentWeek) {
                if (dow === 1 && htfHighDay1 === -Infinity) { htfHighDay1 = dc.high; htfLowDay1 = dc.low; }
                if (dow === 3 && htfHighDay3 === -Infinity) { htfHighDay3 = dc.high; htfLowDay3 = dc.low; }
            }

            if (dow === 5 && fridayAnchorHigh === -Infinity && !isCurrentWeek) {
                fridayAnchorHigh = dc.high; fridayAnchorLow = dc.low;
            }

            if (dMonth === currentMonth) {
                monthHigh = dc.high; monthLow = dc.low;
            }
        }
    }

    // --- DAILY ROLLOVER & WEEKLY RESET ---
    if (state.lastTradingDate !== tradingDateStr) {
        state.lastTradingDate = tradingDateStr;
        state.tradesToday = 0;
        if (estDayOfWeek === 1) {
            state.weeklyTrend = 'NEUTRAL';
        }
    }

    if (state.cooldownCounter > 0) {
        state.cooldownCounter--;
        PatternHunterCore.debugStats.skippedCooldown++;
        return null; // inside cooldown
    }
    if (p.maxTradesPerDay > 0 && state.tradesToday >= p.maxTradesPerDay) {
        PatternHunterCore.debugStats.skippedMaxTrades++;
        return null;
    }

    // --- GATE 3: WEEKLY CYCLE ---
    if (state.weeklyTrend === 'NEUTRAL' && fridayAnchorHigh !== -Infinity) {
        if (c.close > fridayAnchorHigh) state.weeklyTrend = 'BUY';
        else if (c.close < fridayAnchorLow) state.weeklyTrend = 'SELL';
    }

    const isFrontside = estDayOfWeek <= p.frontsideCutoffDay;
    let allowedDirection = isFrontside ? state.weeklyTrend : (state.weeklyTrend === 'BUY' ? 'SELL' : (state.weeklyTrend === 'SELL' ? 'BUY' : 'NEUTRAL'));
    if (allowedDirection === 'NEUTRAL') {
        PatternHunterCore.debugStats.skippedGate3Weekly++;
        return null;
    }
    
    let tradeDirection = allowedDirection;

    // HTF Invalidation Check
    if (isFrontside) {
        let htfHigh = Math.max(htfHighDay1, htfHighDay3);
        let htfLow = Math.min(htfLowDay1, htfLowDay3);
        if (p.useMonthlyAnchors && monthHigh !== -Infinity) {
            htfHigh = htfHigh === -Infinity ? monthHigh : Math.max(htfHigh, monthHigh);
            htfLow = htfLow === Infinity ? monthLow : Math.min(htfLow, monthLow);
        }

        const distToHigh = Math.abs(htfHigh - c.close) / tickSize;
        const distToLow = Math.abs(c.close - htfLow) / tickSize;

        if (tradeDirection === 'BUY' && distToHigh <= p.invalidationThreshold) tradeDirection = 'SELL';
        else if (tradeDirection === 'SELL' && distToLow <= p.invalidationThreshold) tradeDirection = 'BUY';
    }

    if (zonePolarity !== tradeDirection) {
        PatternHunterCore.debugStats.skippedPolarity++;
        return null;
    }

    // --- EXECUTION TRIGGER ---
    let triggered = false;
    let baseTrigger = false;
    if (tradeDirection === 'BUY') {
        baseTrigger = (!p.requireEmaTrendFilter || c.close > emaTrendVal) && c.close > oldCoilBoxHigh;
        if (isFrontside) {
            triggered = baseTrigger;
        } else {
            const emaMediumPrev = context.precomputedEma ? context.precomputedEma.medium[i-1] : 0;
            const emaLock = !p.requireEmaLockBackside || (c.close > emaMediumVal && prevC.close > emaMediumPrev);
            triggered = baseTrigger && emaLock;
        }
    } else {
        baseTrigger = (!p.requireEmaTrendFilter || c.close < emaTrendVal) && c.close < oldCoilBoxLow;
        if (isFrontside) {
            triggered = baseTrigger;
        } else {
            const emaMediumPrev = context.precomputedEma ? context.precomputedEma.medium[i-1] : 0;
            const emaLock = !p.requireEmaLockBackside || (c.close < emaMediumVal && prevC.close < emaMediumPrev);
            triggered = baseTrigger && emaLock;
        }
    }

    if (!triggered) {
        PatternHunterCore.debugStats.skippedTrigger++;
        return null;
    }
    PatternHunterCore.debugStats.triggeredValid++;

    // Breathing Space Check
    if (p.breathingSpaceMin > 0 && prevDayHigh !== -Infinity) {
        const space = tradeDirection === 'BUY' ? Math.abs(prevDayHigh - c.close) / tickSize : Math.abs(c.close - prevDayLow) / tickSize;
        if (space < p.breathingSpaceMin) {
            PatternHunterCore.debugStats.skippedBreathing++;
            return null;
        }
    }

    // --- RISK / REWARD ---
    const sl = tradeDirection === 'BUY' ? oldCoilBoxLow - (p.slBuffer * tickSize) : oldCoilBoxHigh + (p.slBuffer * tickSize);
    let tp = tradeDirection === 'BUY' 
        ? oldCoilBoxHigh + ((oldCoilBoxHigh - oldCoilBoxLow) * p.targetExpansion) 
        : oldCoilBoxLow - ((oldCoilBoxHigh - oldCoilBoxLow) * p.targetExpansion);

    // --- GATE 5: TP HIERARCHY ---
    if (p.tpUseHierarchy) {
        let htfHigh = Math.max(htfHighDay1, htfHighDay3);
        let htfLow = Math.min(htfLowDay1, htfLowDay3);
        if (p.useMonthlyAnchors) {
            const mk = `${tradingDateObj.getUTCFullYear()}-${String(tradingDateObj.getUTCMonth() + 1).padStart(2, '0')}`;
            const ma = context.recentDailyCandles.find(c => c.date.startsWith(mk));
            if (ma) {
                htfHigh = Math.max(htfHigh, ma.high);
                htfLow = Math.min(htfLow, ma.low);
            }
        }
        
        if (tradeDirection === 'BUY' && htfHigh < tp && htfHigh > c.close) tp = htfHigh;
        else if (tradeDirection === 'SELL' && htfLow > tp && htfLow < c.close) tp = htfLow;
    }

    if (estDayOfWeek === 5 && p.fridayOverrideEnabled) {
        if (tradeDirection === 'BUY') {
            const fridayTp = c.close < nearestLevel ? nearestLevel : nearestLevel + moduloPoints;
            tp = Math.min(tp, fridayTp);
        } else {
            const fridayTp = c.close > nearestLevel ? nearestLevel : nearestLevel - moduloPoints;
            tp = Math.max(tp, fridayTp);
        }
    }

    const risk = Math.abs(c.close - sl) / tickSize;
    const reward = Math.abs(tp - c.close) / tickSize;
    if (risk === 0 || (reward / risk) < p.minRR) {
        PatternHunterCore.debugStats.skippedRR++;
        return null;
    }

    state.tradesToday++;
    state.cooldownCounter = p.cooldownCandles;

    return {
        shouldTrade: true,
        direction: tradeDirection,
        brokerSymbol,
        suggestedSlPips: risk,
        suggestedTpPips: reward,
        reason: `Engine Breakout Match (${boxHeight.toFixed(1)} pip coil)`
    };
  }

  static manageTrade(trade: BotTradeState, context: BotContext, config: RefinedConfig): TradeAction {
    const p = config.optimalParams;
    const { currentPrice, brokerSymbol, now } = context;
    const tickSize = brokerSymbol.includes('JPY') || brokerSymbol.includes('XAU') ? 0.01 : 0.0001;
    const spreadVal = (brokerSymbol.includes('JPY') ? 1.5 : 1.0) * tickSize;

    // --- TIME PARSING ---
    let estHour, estMinute, estDayOfWeek;
    if (context.simulatedTime) {
        estHour = context.simulatedTime.estHour;
        estMinute = context.simulatedTime.estMinute;
        estDayOfWeek = context.simulatedTime.estDayOfWeek;
    } else {
        const NY_FORMATTER = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const parts = NY_FORMATTER.formatToParts(now);
        const pParts: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== 'literal') pParts[part.type] = part.value;
        }
        estHour = parseInt(pParts.hour, 10) % 24;
        estMinute = parseInt(pParts.minute, 10);
        const dStr = `${pParts.year}-${pParts.month}-${pParts.day}T12:00:00Z`;
        let tradingDateObj = new Date(dStr);
        if (estHour >= 17) tradingDateObj.setUTCDate(tradingDateObj.getUTCDate() + 1);
        estDayOfWeek = tradingDateObj.getUTCDay();
        if (estDayOfWeek === 6) { tradingDateObj.setUTCDate(tradingDateObj.getUTCDate() + 2); estDayOfWeek = 1; }
        else if (estDayOfWeek === 0) { tradingDateObj.setUTCDate(tradingDateObj.getUTCDate() + 1); estDayOfWeek = 1; }
    }

    // 1. Friday Force Close
    if (estDayOfWeek === 5 && estHour >= p.fridayForceCloseHour && estMinute >= p.fridayForceCloseMin) {
        return { action: 'CLOSE', reason: 'FRIDAY_CLOSE' };
    }

    // Dynamic Profit Taking Params
    const initialRiskPips = Math.abs(trade.entryPrice - trade.slPrice) / tickSize;
    if (initialRiskPips === 0) return { action: 'HOLD' }; // Safety fallback

    const currentProfitPips = trade.direction === 'BUY'
        ? (currentPrice - trade.entryPrice) / tickSize
        : (trade.entryPrice - currentPrice) / tickSize;
    
    const currentR = currentProfitPips / initialRiskPips;

    // 2. Trailing Stop
    if (p.enableTrailingStop && p.trailingStopActivationR && p.trailingStopDistanceR) {
        if (currentR >= p.trailingStopActivationR) {
            const trailingDistPrice = (p.trailingStopDistanceR * initialRiskPips) * tickSize;
            let newSlPrice = trade.slPrice;
            if (trade.direction === 'BUY') {
                newSlPrice = Math.max(trade.slPrice, currentPrice - trailingDistPrice);
            } else {
                newSlPrice = Math.min(trade.slPrice, currentPrice + trailingDistPrice);
            }
            // Add a small epsilon to avoid unnecessary repeated modification calls
            if (Math.abs(newSlPrice - trade.slPrice) > tickSize * 0.5) {
                return { action: 'MODIFY_SL', newSlPrice };
            }
        }
    }

    // 3. Break-Even
    if (p.enableBreakEven && p.breakEvenTriggerR) {
        if (currentR >= p.breakEvenTriggerR) {
            const bePrice = trade.entryPrice;
            if (trade.direction === 'BUY' && trade.slPrice < bePrice) {
                return { action: 'MODIFY_SL', newSlPrice: bePrice };
            } else if (trade.direction === 'SELL' && trade.slPrice > bePrice) {
                return { action: 'MODIFY_SL', newSlPrice: bePrice };
            }
        }
    }

    return { action: 'HOLD' };
  }
}
