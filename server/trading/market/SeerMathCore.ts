import { PairConfig } from '../config/types.js';
import { OPTIMIZER_CONFIG } from '../config/OptimizerPairConfig.js';
import { isTradeAllowed } from './MathFilters.js';

export function getDigitsForPair(pair: string): number {
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "")];
  const tickSize = optCfg?.tickSize ?? 0.00001;
  const tickStr = tickSize.toString();
  return tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
}

export function roundPrice(val: number, pair: string): number {
  return Number(val.toFixed(getDigitsForPair(pair)));
}

export function evaluateStacyBurkeSetup(
  c: any,
  prevC: any,
  ema20: number,
  prevDay: any,
  setupType: string,
  config: PairConfig,
  pipSize: number,
  pair: string,
  ignoreFilters: boolean,
  day3HighBeforeC: number,
  day3LowBeforeC: number,
  bbValues?: { upper: number; lower: number; middle: number; stdDev: number },
  rsiValue?: number
): { setupType: string; direction: 'BUY' | 'SELL'; isMage: boolean } | null {
  const cOpen = roundPrice(c.open, pair);
  const cClose = roundPrice(c.close, pair);
  const cHigh = roundPrice(c.high, pair);
  const cLow = roundPrice(c.low, pair);
  
  const prevCOpen = roundPrice(prevC.open, pair);
  const prevCClose = roundPrice(prevC.close, pair);
  const prevCHigh = roundPrice(prevC.high, pair);
  const prevCLow = roundPrice(prevC.low, pair);

  const pdHigh = roundPrice(prevDay.high, pair);
  const pdLow = roundPrice(prevDay.low, pair);
  const rEma20 = roundPrice(ema20, pair);
  const rDay3High = roundPrice(day3HighBeforeC, pair);
  const rDay3Low = roundPrice(day3LowBeforeC, pair);

  const peakTolerance = 10 * pipSize;
  const pinBarWickBodyRatio = config.pinBarWickBodyRatio !== undefined ? config.pinBarWickBodyRatio : 1.5;
  const cBodyPips = Math.abs(cClose - cOpen) / pipSize;
  const upperWickPips = (cHigh - Math.max(cOpen, cClose)) / pipSize;
  const lowerWickPips = (Math.min(cOpen, cClose) - cLow) / pipSize;

  let minBodyPips = config.minBodyPips;
  if (minBodyPips === undefined) {
    minBodyPips = 3.0; // Default for GBPUSD/EURUSD
    if (pair.includes('XAU')) minBodyPips = 20.0;
    else if (pair.includes('NAS')) minBodyPips = 20.0;
    else if (pair.includes('US30') || pair.includes('GER40')) minBodyPips = 20.0;
    else if (pair.includes('XTI')) minBodyPips = 1.5;
    else if (pair.includes('BTC')) minBodyPips = 7.5;
    else if (pair.includes('ETH')) minBodyPips = 2.0;
    else if (pair.includes('JPY') || pair.includes('AUD') || pair.includes('NZD') || pair.includes('CAD')) minBodyPips = 5.0;
  }

  const isBearishEngulfing = cClose < cOpen && prevCClose > prevCOpen && cOpen >= prevCClose && cClose <= prevCOpen && cBodyPips >= minBodyPips;
  const isBullishEngulfing = cClose > cOpen && prevCClose < prevCOpen && cOpen <= prevCClose && cClose >= prevCOpen && cBodyPips >= minBodyPips;

  const isBearishPin = upperWickPips >= cBodyPips * pinBarWickBodyRatio && upperWickPips >= minBodyPips && lowerWickPips <= Math.max(2.0, cBodyPips);
  const isBullishPin = lowerWickPips >= cBodyPips * pinBarWickBodyRatio && lowerWickPips >= minBodyPips && upperWickPips <= Math.max(2.0, cBodyPips);

  const isBearishTrigger = isBearishEngulfing || isBearishPin;
  const isBullishTrigger = isBullishEngulfing || isBullishPin;

  let isEngulfing = false;
  let expectedDirection = '';

  if (setupType === 'FRD' || setupType === 'DAY3_LONG') {
    if (isBearishTrigger) {
      expectedDirection = 'SELL';
      if (setupType === 'DAY3_LONG') {
        if (rDay3High !== -Infinity && (prevCHigh >= rDay3High - peakTolerance || cHigh >= rDay3High - peakTolerance)) isEngulfing = true;
      } else {
        if (cHigh > (pdHigh - (pdHigh - pdLow) * 0.3)) isEngulfing = true;
      }
    }
    if (setupType === 'FRD' && isBullishTrigger) {
      expectedDirection = 'BUY';
      if (cLow < (pdLow + (pdHigh - pdLow) * 0.3)) isEngulfing = true;
    }
  } else if (setupType === 'FGD' || setupType === 'DAY3_SHORT') {
    if (isBullishTrigger) {
      expectedDirection = 'BUY';
      if (setupType === 'DAY3_SHORT') {
        if (rDay3Low !== Infinity && (prevCLow <= rDay3Low + peakTolerance || cLow <= rDay3Low + peakTolerance)) isEngulfing = true;
      } else {
        if (cLow < (pdLow + (pdHigh - pdLow) * 0.3)) isEngulfing = true;
      }
    }
    if (setupType === 'FGD' && isBearishTrigger) {
      expectedDirection = 'SELL';
      if (cHigh > (pdHigh - (pdHigh - pdLow) * 0.3)) isEngulfing = true;
    }
  } else if (setupType === 'INSIDE_DAY') {
    if (isBearishTrigger && (prevCHigh > pdHigh || cHigh > pdHigh)) {
      isEngulfing = true;
      expectedDirection = 'SELL';
    } else if (isBullishTrigger && (prevCLow < pdLow || cLow < pdLow)) {
      isEngulfing = true;
      expectedDirection = 'BUY';
    }
  } else if (setupType === 'LHF_LONG') {
    if (isBullishTrigger && cLow <= rEma20 && cClose > rEma20) {
      isEngulfing = true;
      expectedDirection = 'BUY';
    }
  } else if (setupType === 'LHF_SHORT') {
    if (isBearishTrigger && cHigh >= rEma20 && cClose < rEma20) {
      isEngulfing = true;
      expectedDirection = 'SELL';
    }
  }

  if (isEngulfing) {
    const emaDistance = Math.abs(cClose - rEma20) / pipSize;
    let emaFilterPassed = true;
    if (config.maxEmaDistance !== undefined && config.maxEmaDistance > 0 && emaDistance > config.maxEmaDistance) emaFilterPassed = false;
    if (config.minEmaDistance !== undefined && config.minEmaDistance > 0 && emaDistance < config.minEmaDistance) emaFilterPassed = false;

    let allowed = true;
    if (!ignoreFilters) {
      allowed = isTradeAllowed({ pair, setupType, timestamp: c.timestamp });
    }

    let bbPassed = true;
    if (bbValues && config.bbStdDev !== undefined) {
      const dynamicUpper = bbValues.middle + (bbValues.stdDev * config.bbStdDev);
      const dynamicLower = bbValues.middle - (bbValues.stdDev * config.bbStdDev);
      if (expectedDirection === 'SELL' && cHigh < dynamicUpper) bbPassed = false;
      if (expectedDirection === 'BUY' && cLow > dynamicLower) bbPassed = false;
    }

    let rsiPassed = true;
    if (rsiValue !== undefined && config.rsiThreshold !== undefined) {
      if (expectedDirection === 'SELL' && rsiValue < config.rsiThreshold) rsiPassed = false;
      if (expectedDirection === 'BUY' && rsiValue > (100 - config.rsiThreshold)) rsiPassed = false;
    }

    if (emaFilterPassed && allowed && bbPassed && rsiPassed) {
      return {
        setupType,
        direction: expectedDirection as 'BUY' | 'SELL',
        isMage: false
      };
    }
  }

  return null;
}
