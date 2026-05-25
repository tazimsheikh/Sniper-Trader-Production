import { MarketData } from '../src/types';

export function calculateConfluenceScore(market: MarketData, symbol: string, currentGate: string, timeStr: string) {
  let inChopZone = false;

  const isNasdaqOrGold = symbol === 'NQ=F' || symbol === 'GC=F';
  if (!isNasdaqOrGold) return null;

  const now = new Date();
  const todayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const isMonday = todayName === 'Monday';

  const pipDivisor = market.pipSize;
  const pipsToHOD = Math.abs(market.currentPrice - market.hod) / pipDivisor;
  const pipsToLOD = Math.abs(market.currentPrice - market.lod) / pipDivisor;
  const sessionRange = (market.hod - market.lod) / pipDivisor;

  // "IF price IS BETWEEN HOD and LOD (far from both) -> CHOP ZONE. Hard fail."
  if (pipsToHOD > 15 && pipsToLOD > 15 && sessionRange > 30) {
    inChopZone = true;
  }

  const isParabolicBreakout =
    (pipsToHOD < 5 && market.currentPrice > market.hod) ||
    (pipsToLOD < 5 && market.currentPrice < market.lod);

  // Monday Rule: No reversals on parabolic breakouts
  if (isMonday && isParabolicBreakout) {
    return { grade: 0, reason: 'Day One Runner Rule: Force Trend Continuation — reversals forbidden.', matrix: {} };
  }

  if (inChopZone) {
    return { grade: 0, reason: 'Chop Zone: Price is mid-range between HOD and LOD.', matrix: {} };
  }

  const matrix: any = {
    'SESSION_LEVELS (Max 1 CP)': 0,
    'DAILY_EXTREMES (Max 1 CP)': 0,
    'WEEKLY_MONTHLY_EXTREMES (Max 2 CP)': 0,
    'TIMING_WINDOWS (Max 1 CP)': 0,
    'MARKET_STRUCTURE_SIGNALS (Max 2 CP)': 0,
  };

  // SESSION_LEVELS (Max 1 CP): price within 15 pips of a session extreme
  if (pipsToHOD <= 15 || pipsToLOD <= 15) {
    matrix['SESSION_LEVELS (Max 1 CP)'] = 1;
  }

  // DAILY_EXTREMES (Max 1 CP): price within 5 pips of daily high/low
  if (pipsToHOD <= 5 || pipsToLOD <= 5) {
    matrix['DAILY_EXTREMES (Max 1 CP)'] = 1;
  }

  // WEEKLY_MONTHLY_EXTREMES (Max 2 CP)
  let weeklyScore = 0;
  const pipsToHOW = Math.abs(market.currentPrice - market.how) / pipDivisor;
  if (pipsToHOW <= 20) weeklyScore += 1;
  // First 3 days of month = monthly level confluence
  if (now.getDate() <= 3 && (pipsToHOD <= 15 || pipsToLOD <= 15)) weeklyScore += 1;
  matrix['WEEKLY_MONTHLY_EXTREMES (Max 2 CP)'] = Math.min(weeklyScore, 2);

  // TIMING_WINDOWS (Max 1 CP)
  if (
    currentGate === 'London Session' ||
    currentGate === '10:00 AM Club' ||
    currentGate === 'COMEX Open' ||
    currentGate === 'Equity Open Box'
  ) {
    matrix['TIMING_WINDOWS (Max 1 CP)'] = 1;
  }

  // MARKET_STRUCTURE_SIGNALS (Max 2 CP)
  let msScore = 0;

  // Signal day classification: FRD/FGD or Inside Day
  if (market.signalDay === 'FRD' || market.signalDay === 'FGD') {
    msScore += 1;
  } else if (market.signalDay === 'Inside Day') {
    msScore += 1;
  }

  // ── FIX: Real 3-push detection using actual candle history ───────────────
  // 3-push = 3 consecutive higher highs (bullish exhaustion) or 3 lower lows (bearish exhaustion)
  const candles = market.recentDailyCandles;
  if (candles && candles.length >= 4) {
    const [c0, c1, c2, c3] = candles; // oldest → newest
    const is3PushUp =
      c1.high > c0.high &&
      c2.high > c1.high &&
      c3.high > c2.high; // Three consecutive higher highs → exhaustion setup

    const is3PushDown =
      c1.low < c0.low &&
      c2.low < c1.low &&
      c3.low < c2.low; // Three consecutive lower lows → exhaustion setup

    if (is3PushUp || is3PushDown) msScore += 1;
  }

  matrix['MARKET_STRUCTURE_SIGNALS (Max 2 CP)'] = Math.min(msScore, 2);

  const cpTotal = Object.values(matrix).reduce((acc: any, val: any) => acc + val, 0) as number;

  const gradingDict: Record<number, any> = {
    1: {
      definition: 'Session Scalp',
      risk_percentage: '1%',
      entry_execution: '1-minute chart Pin Hammer or Engulfing at session High/Low.',
      management: 'Nail and Bail. Tight 25-pip stop. Fixed 25–50 pip target.',
    },
    2: {
      definition: 'Base Continuation (Low-Hanging Fruit)',
      risk_percentage: '2%',
      entry_execution: '5-minute candle crosses 20 EMA, pullback, rejection in trend direction.',
      management: 'Move stop to break-even on first local structure break.',
    },
    3: {
      definition: 'Signal Day Trap',
      risk_percentage: '3%',
      entry_execution: 'False breakout confirmation candle closes back inside prior extreme.',
      management: 'Target 50 pips. Move to break-even on acceleration.',
    },
    4: {
      definition: 'Weekly Extreme Liquidity Trap',
      risk_percentage: '4%',
      entry_execution: 'Price sweeps HOW/LOW during session open → M/W leg forms.',
      management: 'Secure partials at prior day close. Trail rest.',
    },
    5: {
      definition: 'ACB Multi-Timeframe Alignment',
      risk_percentage: '5%',
      entry_execution: '15m structure break + 1m lower/higher close matching weekly macro bias.',
      management: '2% initial. Scale-in 3% on structure breaks. Scratch if no move in 30 min.',
    },
  };

  const assignedGrade = Math.min(Math.floor(cpTotal), 5) as 1 | 2 | 3 | 4 | 5;

  if (assignedGrade >= 1) {
    return { grade: assignedGrade, params: gradingDict[assignedGrade], matrix };
  }

  return { grade: 0, reason: 'Not enough confluence points — no trade.' };
}
