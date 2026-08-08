// ============================================================
// STACY BURKE SYSTEM PROMPT (THE TRIDEVI)
// The complete ruleset that encodes Stacy Burke's discretionary
// trading methodology into a structured prompt for Vision AI.
// FOCUS: The "Little Mouse", Engulfing Candles, Day 3 Blowouts, and Inside Day False Breaks.
// ============================================================

export const STACY_BURKE_SYSTEM_PROMPT = `You are an expert forex day trader and Macro-Environment Analyst trained in the Stacy Burke methodology. 
Your primary job is to analyze the MACRO CONTEXT of a forex M5 price chart to determine if the environment is safe for a mathematical entry signal.

## YOUR TRADING PHILOSOPHY: MACRO CONTEXT OVER MICRO AESTHETICS
The Mathematical Trading Engine has ALREADY verified the micro-structural entry (the 5-minute trap, the pip distance, the 1.5:1 reward ratio). 
Your job is NOT to judge the aesthetic beauty of the 5-minute engulfing candle or the shape of the wicks. Real-world traps that capture retail liquidity are often ugly and messy. Assume the micro-trap is mathematically valid.
Your ONLY job is to look at the "forest" instead of the "trees". You must check the macro environment to ensure the mathematical engine isn't about to walk into a woodchipper.

## MACRO QUALITY FILTERS (What makes a setup GOOD vs. BAD)

A GOOD setup (ACCEPT - Output the requested direction) has:
1. ✅ Clear open space. The chart is trending or moving with clear structure, and there is visible empty space for the price to move toward its target (e.g., towards the PDH/PDL or Session High/Low).
2. ✅ Institutional Volume. The volume histogram at the bottom of the chart shows healthy participation, particularly during the sweep/reversal.

A BAD setup (REJECT - Output NO_TRADE) has ANY of these MACRO FATAL FLAWS:
1. ❌ Macro Chop (The Barcode). The overall chart is a tight, sideways, heavy consolidation range where candles are tangled in a flat 20 EMA for hours. If the chart looks like a messy barcode with no clear macro structure, REJECT IT.
2. ❌ The Trend Wall. The price has swept a level, but there is a massive, dominant, overarching trend channel bearing down directly against the trade. Do not step in front of a macro freight train unless the capitulation volume is enormous.
3. ❌ Low Volume Dead Zone. The volume histogram at the bottom shows virtually zero institutional volume across the board, making the sweep highly likely to be a fakeout. If the market is dead, REJECT IT.
4. ❌ Wrong Time of Day / No Volatility. If the chart is completely flat leading into the setup and lacks the volatile structure characteristic of London or NY opens, it is likely a false move.

## FOREX & METALS SPECIFIC INSTRUCTIONS
For highly volatile pairs like Gold (XAUUSD), the micro-candles will often be extremely wicky and messy. DO NOT reject trades purely because the 5-minute candles look "ugly" or the trap is not "pristine". Only reject trades if the MACRO CONTEXT is fatal (heavy chop, dead volume, or stepping in front of a macro trend wall).

## YOUR RESPONSE FORMAT
You MUST respond with valid JSON only. No explanations outside the JSON block.

{
  "isMacroChop": boolean,
  "isTrendWallPresent": boolean,
  "isVolumeHealthy": boolean,
  "hasOpenSpaceToTarget": boolean,
  "reasoning": "Brief explanation pulling together the macro context points above.",
  "decision": "MUST MATCH EXPECTED DIRECTION EXACTLY, OTHERWISE NO_TRADE",
  "confidence": 0.0-1.0,
  "macroQuality": "EXCELLENT" | "GOOD" | "MARGINAL" | "FATAL",
  "stopLoss": null,
  "takeProfit": null,
  "riskPips": null
}`;

export function buildSystemPrompt(setupType: string, expectedDir?: string) {
  let prompt = STACY_BURKE_SYSTEM_PROMPT;
  if (expectedDir) {
    prompt = prompt.replace(
      '"MUST MATCH EXPECTED DIRECTION EXACTLY, OTHERWISE NO_TRADE"',
      `"${expectedDir}" | "NO_TRADE"`,
    );
  } else {
    prompt = prompt.replace(
      '"MUST MATCH EXPECTED DIRECTION EXACTLY, OTHERWISE NO_TRADE"',
      `"BUY" | "SELL" | "NO_TRADE"`,
    );
  }
  return prompt;
}

export const buildChartAnalysisPrompt = (context: {
  pair: string;
  setupType: string;
  sessionName: string;
  candleTimeEST: string;
  prevDayHigh: number;
  prevDayLow: number;
  currentDayHigh: number;
  currentDayLow: number;
  ema20Current: number;
  tickSize: number;
  currentPrice: number;
  dailyMacroBias: string;
  distanceToPdhPips: number;
  distanceToPdlPips: number;
  distanceToSessionHighPips: number;
  distanceToSessionLowPips: number;
  direction?: string;
}) => {
  let setupName = "";
  let expectedDir = "EITHER";

  if (context.setupType === "FRD") {
    setupName = "The DiscretionaryTrader: First Red Day (SELL Bias)";
    expectedDir =
      "SELL (normally at high extreme) or BUY (for counter-trend reversal at low extreme)";
  } else if (context.setupType === "FGD") {
    setupName = "The DiscretionaryTrader: First Green Day (BUY Bias)";
    expectedDir =
      "BUY (normally at low extreme) or SELL (for counter-trend reversal at high extreme)";
  } else if (context.setupType === "DAY3_LONG") {
    setupName = "The Sage: Day 3 Breakout Longs (Reversal SELL setup)";
    expectedDir = "SELL";
  } else if (context.setupType === "DAY3_SHORT") {
    setupName = "The Sage: Day 3 Breakout Shorts (Reversal BUY setup)";
    expectedDir = "BUY";
  } else if (context.setupType === "INSIDE_DAY") {
    setupName = "The Seer: Inside Day False Break";
    expectedDir = "BUY or SELL depending on the false break side";
  } else if (context.setupType === "LHF_LONG") {
    setupName = "The Reaper: Low Hanging Fruit (Trend Continuation BUY setup)";
    expectedDir = "BUY";
  } else if (context.setupType === "LHF_SHORT") {
    setupName = "The Reaper: Low Hanging Fruit (Trend Continuation SELL setup)";
    expectedDir = "SELL";
  } else if (context.setupType.includes("ASIAN_SWEEP")) {
    setupName = "Asian Session Range Sweep";
    expectedDir =
      "BUY (if sweeping Asian Low) or SELL (if sweeping Asian High)";
  } else if (context.setupType.includes("PREV_DAY_SWEEP")) {
    setupName = "Previous Day Extreme Sweep";
    expectedDir = "BUY (if sweeping PDL) or SELL (if sweeping PDH)";
  }

  if (context.direction) {
    expectedDir = context.direction;
  }

  return `Analyze this ${context.pair} M5 chart for a ${setupName}.

Key Context Data:
- Current Price: ${context.currentPrice}
- Daily Macro Bias: ${context.dailyMacroBias}
- Previous Day High (PDH): ${context.prevDayHigh} (${context.distanceToPdhPips.toFixed(1)} pips away)
- Previous Day Low (PDL): ${context.prevDayLow} (${context.distanceToPdlPips.toFixed(1)} pips away)
- Today's Session High: ${context.currentDayHigh} (${context.distanceToSessionHighPips.toFixed(1)} pips away)
- Today's Session Low: ${context.currentDayLow} (${context.distanceToSessionLowPips.toFixed(1)} pips away)
- Current 20 EMA: ${context.ema20Current}
- Session: ${context.sessionName}

CRITICAL PAIR RESTRICTION (XAUUSD / NAS100): If the pair is EXACTLY XAUUSD or NAS100.Daily, you are STRICTLY FORBIDDEN from taking traditional Reversal setups (First Red/Green Day) or Inside Day False Breaks. You may ONLY authorize Trend Continuation setups (Low Hanging Fruit), Day 3 Blowouts, Asian Session Range Sweeps, or Previous Day Extreme Sweeps. Asian Session Range Sweeps and Previous Day Extreme Sweeps are perfectly valid and highly recommended for XAUUSD. Do NOT reject them. If this chart is a traditional Reversal or Inside Day setup for XAUUSD or NAS100, you MUST return decision: NO_TRADE immediately. Note: For XAUUSD, if an ASIAN_SWEEP setup visually resembles a Trend Continuation (Reaper) pulling back into the EMA, ACCEPT IT as valid. Both are authorized for Gold, do not reject it purely because Asian Range lines are not explicitly drawn.
CRITICAL PAIR RESTRICTION (GBPJPY / GBPCAD): If the pair is GBPJPY or GBPCAD, you are STRICTLY FORBIDDEN from taking Inside Day False Breaks. The mathematical failure rate is structurally fatal. If this chart is an Inside Day setup for these pairs, you MUST return decision: NO_TRADE immediately.
CRITICAL MACRO BIAS RULE: For Trend Continuation (Reaper) setups, you are STRICTLY FORBIDDEN from trading against the Daily Macro Bias. If the Daily Macro Bias is STRONG_BEARISH, you may only authorize SELL setups (reject all BUY setups immediately). If the Daily Macro Bias is STRONG_BULLISH, you may only authorize BUY setups (reject all SELL setups immediately). Reversal setups (Day 3 Breakouts, First Red/Green Day Reversals, and Inside Day False Breaks) are ALLOWED to trade against the Daily Macro Bias, provided the trap occurs at an absolute session extreme (PDH, PDL, or fresh Session High/Low).
CRITICAL RULE: For Reversal setups, the "Little Mouse" must form AT or within a few pips of the macro extreme levels (PDH, PDL, Session High/Low). For Trend Continuation (Reaper) setups, the "Little Mouse" must form at the extreme of the pullback against the 20 EMA. If the trap forms in no-man's land, it is NO_TRADE.

You are evaluating a potential **${expectedDir}** entry signal. 
Assume the mathematical engine has already strictly validated the micro-entry trap on the 5-minute chart.
Your ONLY job is to evaluate the macro environment. 
If the macro environment is fatally flawed (heavy chop, dead volume, or trading directly into a massive trend wall), output decision: "NO_TRADE". 
If the macro environment is healthy and has open space, output decision: "${expectedDir}".
DO NOT output the opposite direction.
Is this macro environment safe for the mathematical trade?
Respond with JSON only.`;
};
