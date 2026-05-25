import { ChatMessage, TrapSignal } from '../src/types';
import { GoogleGenAI } from '@google/genai';

const STACEY_BURKE_PLAYBOOK = `
*System Role:* You are a Senior Quantitative Trading Auditor and Expert in the Stacey Burke Algorithmic Trading Methodology. Your objective is to audit trading software logs, code, or live market scenarios to ensure the system is flawlessly executing the "Smart Money" liquidity trap framework on instruments like NAS100, US30, and XAUUSD.
You must evaluate every single trade decision through the following 5-Module Logic Pipeline. If a trade execution fails any of these modules, you must flag it as an error and explain which algorithmic rule was broken.

### MODULE 1: MACRO BIAS & DAY COUNTING (The Daily Setup)
Before looking at intraday price action, the software must correctly categorize the current day and the previous day's closing data.
*1. Anchor Point Verification:*
 * The software must record Friday's Closing Price. This is the anchor for the new week.
 * The software must record the Previous Day's High, Low, Open, and Close.
*2. The 3-Day Cycle Counting:*
 * *Day 1:* Monday establishes the opening range. (Alternatively, Thursday can act as a reset Day 1).
 * *Day 2:* Tuesday typically expands the range.
 * *Day 3:* Wednesday is the midpoint and the highest probability day for a macro reversal or blow-off trend. (Friday is the secondary Day 3).
 * Audit Check: Ensure the software knows exactly what Day it is in the 3-Day cycle.
*3. Signal Day Identification:*
The software must analyze the previous daily candle to identify "Signal Days."
 * *First Red Day (FRD):* After 3 consecutive days of higher highs, the daily candle closes below its open. (Indicates trapped buyers).
 * *First Green Day (FGD):* After 3 consecutive days of lower lows, the daily candle closes above its open. (Indicates trapped sellers).
 * *Inside Day:* The daily candle's High and Low are completely contained within the previous day's High and Low. (Indicates a coiling market; prepare for a range expansion).
 * Audit Check: If today follows a First Red Day, the software's bias must be to look for a "Pump & Dump" (Sell High) trap.

### MODULE 2: BOUNDARY MARKING (The Liquidity Pools)
The software is forbidden from trading in the "50/50 Chop Zone" (the middle of a range). It must calculate and draw strict boundaries.
*1. Daily Extremes (Macro Liquidity):*
 * The software must mark the *HOD* (High of Day) and *LOD* (Low of Day) from the previous day, as well as the *HOW* (High of Week) and *LOW* (Low of Week).
*2. Session Extremes (Micro Liquidity & The Trigger):*
 * *What it is:* The software must identify the highest price (HOS) and lowest price (LOS) formed within the first hour of the active trading session (Asia, London, or NY).
 * *Why it must be checked:* Institutional algorithms use the first hour to establish false support/resistance. Retail traders place stop-losses just outside the HOS/LOS. The market makers will "stop hunt" these levels before reversing.
 * Audit Check: The software must never buy a breakout of the HOS, nor sell a breakout of the LOS. It must wait for the false breakout of these specific session extremes.

### MODULE 3: TIMING GATES & INSTITUTIONAL ARMOR
Trades cannot be taken at random times. The software must filter execution through strict temporal and defensive gates.
*1. Active Windows (America/New_York Timezone):*
 * Asian Session: 20:00 - 23:00 NY
 * London Session: 02:00 - 05:00 NY
 * New York Session: 08:00 - 11:00 NY (Highest Probability)
 * Audit Check: Reject any trades occurring in "Gap Time" (between these sessions).
*2. The New York Sniper Triggers:*
 * *08:20 NY:* COMEX Gold Open (Check for XAUUSD traps).
 * *08:30 NY:* Major Red News. (Software must enter a 15-minute blackout period. No execution allowed before or exactly during the news spike).
 * *09:30 to 10:00 NY (The Open Box):* Software must draw a box around the high and low of this 30-minute window. No execution inside this box.
 * *10:00 AM NY (The 4-Hour Rotation):* The highest probability time for a stop-hunt reversal.
*3. Institutional Armor (Defensive Logic):*
 * *Spread Filter:* Software must abort execution if the live spread exceeds 3.0 pips/points.
 * *Lockout Rule:* Maximum 1 losing trade per session. If stopped out, the software must freeze until the next major session.

### MODULE 4: EXECUTION LOGIC (The Trap & Trigger)
When the software detects price reaching an extreme (HOD/LOD or HOS/LOS) during an active window, it must shift to the 1-minute chart (M1) and evaluate the following Boolean logic.
*1. The False Breakout (The Stop Hunt):*
 * Did the price pierce the extreme level by at least 1-2 pips/points? (TRUE)
*2. The 20 EMA Trend Filter:*
 * *For Shorts:* Is the M1 closing price currently below the 5-minute 20 EMA? (TRUE)
 * *For Longs:* Is the M1 closing price currently above the 5-minute 20 EMA? (TRUE)
*3. The 15-Minute Clock Constraint:*
 * Is the current system time exactly on a 15-minute rotation interval (+/- 1 minute)? (XX:00, XX:15, XX:30, XX:45). (TRUE)
*4. The Candlestick Trigger (The Sniper Entry):*
 * *Short (Pump & Dump):* Did the M1 candle close back inside the broken High, and is it a bearish Engulfing Candle or a Pin Hammer rejecting the high?
 * *Long (Dump & Pump - Lowest Closing Body Rule):* Locate the M15 candle with the Lowest Closing Body in the downward trend. Did the M1 candle break above that body's open and close back inside the broken Low?
 * Audit Check: If ALL Boolean checks = TRUE, the software is authorized to execute a Market Order.

### MODULE 5: RISK MANAGEMENT & EXITS
The software must manage the trade dynamically to ensure capital preservation and maximum asymmetric upside.
*1. The Stop-Loss (The Failsafe):*
 * Must be placed mathematically behind the extreme wick of the stop-hunt.
 * *Institutional Buffer:* Must add the live spread + a 2-pip buffer to the wick extreme to avoid targeted stop-hunts.
 * Audit Check: If the calculated Stop-Loss is greater than 25 pips/points from the entry price, the software must ABORT the trade. (The trap is too wide).
*2. The Break-Even Trigger (The Free Ride):*
 * Stacey Burke trades are "ACB" (Ain't Coming Back).
 * The software must automatically modify the Stop-Loss to Entry Price + Spread once the trade is floating at +25 pips/points in profit.
*3. The Take Profit (The Exit):*
 * *Target 1 (50% of position):* Fixed at +50 pips/points for a standard session scalp.
 * *Target 2 (50% of position):* 100% Geometric Range Expansion.
   * Logic: The software calculates the height of the consolidation box formed before the breakout, and projects that exact height outward from the entry point.
 * *Time Ejection:* If the trade has not reached +25 pips in profit within 45 minutes of execution, the software must close the trade at market price. (The trap has failed/stalled).

*Auditor Instruction:* When provided with a trade log or code snippet, output a strict Pass/Fail grade for each of the 5 Modules. Highlight the exact point of failure if the software violates this methodology.
`;

// ── FIX: Singleton AI instance — instantiate once, reuse on every request ────
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set.');
    }
    _ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }
  return _ai;
}

// ── Signal verification ────────────────────────────────────────────────────────
export async function verifySignalWithAI(
  symbol: string,
  pattern: string
): Promise<{ approved: boolean; reasoning: string }> {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      // FIX: Correct model name
      model: 'gemini-2.0-flash',
      // @ts-ignore
      systemInstruction: STACEY_BURKE_PLAYBOOK,
      contents: [{
        role: 'user',
        parts: [{
          text: `A signal was generated for ${symbol} with pattern "${pattern}". Validate this signal based on the playbook rules. ` +
                `Reply in JSON format: { "approved": boolean, "reasoning": "string" }. Be strict. Only approve high-probability setups.`
        }]
      }],
      config: { responseMimeType: 'application/json' }
    });

    if (response.text) return JSON.parse(response.text);
    throw new Error('No response text from AI');
  } catch (err: any) {
    console.error('[TutorAgent] AI verification failed — REJECTING signal as safety precaution:', err.message);
    // FIX: Fail safe (reject) not fail open (approve)
    return {
      approved: false,
      reasoning: `AI verification unavailable (${err.message}). Signal rejected as a safety precaution — no trade executed.`
    };
  }
}

// ── Tutor chat ─────────────────────────────────────────────────────────────────
export async function askTutorAgent(
  userPrompt: string,
  history: ChatMessage[],
  relatedSignal?: TrapSignal
): Promise<string> {
  const systemMessageContent = STACEY_BURKE_PLAYBOOK + (relatedSignal
    ? `\n\nYou are currently tutoring the student on this specific market signal:\n` +
      `- Asset: ${relatedSignal.displayName} (${relatedSignal.symbol})\n` +
      `- Setup type: ${relatedSignal.pattern}\n` +
      `- Direction: ${relatedSignal.direction}\n` +
      `- Trigger Price: ${relatedSignal.triggerPrice.toFixed(4)}\n` +
      `- Key Level: ${relatedSignal.keyLevel.toFixed(4)} (${relatedSignal.levelType})\n` +
      `- Star Grade: ${relatedSignal.grade}-Star\n` +
      `- Session Gate: ${relatedSignal.timingGate}\n` +
      `- Details: ${relatedSignal.details}\n\n` +
      `Explain exactly how this signal maps to the Sniper Smart Money principles.`
    : '');

  // FIX: Truncate history to last 20 messages to avoid context window overflow / excess billing
  const MAX_HISTORY = 20;
  const truncatedHistory = history.slice(-MAX_HISTORY);

  const contents = [
    ...truncatedHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    })),
    { role: 'user', parts: [{ text: userPrompt }] },
  ];

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      // FIX: Correct model name
      model: 'gemini-2.0-flash',
      contents: contents as any,
      config: {
        // @ts-ignore
        systemInstruction: systemMessageContent,
      },
    });

    if (response.text) return response.text;
    throw new Error('Empty response from AI');
  } catch (err: any) {
    console.error('[TutorAgent] Chat API error:', err.message);
    return generateLocalFallbackTutorReply(userPrompt, relatedSignal);
  }
}

// ── Offline fallback tutor ─────────────────────────────────────────────────────
function generateLocalFallbackTutorReply(userPrompt: string, signal?: TrapSignal): string {
  const normPrompt = userPrompt.toLowerCase();

  if (signal) {
    if (normPrompt.includes('why') || normPrompt.includes('suggest') || normPrompt.includes('explain')) {
      return `### 🏫 Sniper Smart Money Tutor — Detailed Analysis

This **${signal.grade}-Star ${signal.pattern}** setup on **${signal.displayName}** triggers direct market-maker mechanics:

1. **Trapped Liquidity**: Price aggressively marked outside the standard range into ${signal.levelType} at **${signal.keyLevel.toFixed(4)}**, triggering breakout traders into chasing continuation.
2. **Timing Gate**: Occurring inside the **${signal.timingGate}** window — a critical algorithmic block update period.
3. **Execution Tactics**:
   - Zoom to the **1-minute chart** and wait for an **M-top/W-bottom** double rejection.
   - Look for a **Pin Hammer or Engulfing candle** rejecting **${signal.keyLevel.toFixed(4)}**.
4. **Risk Allocation**:
   - Hard stop: **${signal.suggestedStopLoss} pips** behind the execution wick.
   - Target: **${signal.suggestedTakeProfit} pips** measured move.
   - Time-ejection: If no movement within 45 minutes, exit at market.`;
    }
  }

  if (normPrompt.includes('20 ema') || normPrompt.includes('ema')) {
    return `### 🛡️ The 20 EMA Gatekeeper Rule
The **20 EMA on the 5-minute chart** is our absolute trend filter:
1. **Shorting**: Do NOT sell above the 5m 20 EMA. Wait for price to break below, pull back, and reject the underside.
2. **Buying**: Do NOT buy below the 5m 20 EMA. Wait for price to cross above, hold on retest, turn EMA from resistance to support.
This filter prevents counter-trending into high-momentum daily runs.`;
  }

  if (normPrompt.includes('stop') || normPrompt.includes('risk') || normPrompt.includes('loss')) {
    return `### 🛡️ Core Risk Management Protocol
- **Maximum Stop-Loss**: 25 pips from entry. If wider, abort.
- **Execution Wick Rule**: Stop goes strictly behind the 1-minute wick high/low.
- **Break-Even**: Move stop to entry + spread the moment the trade breaks local structure in your direction.
- **Time Expiry**: If no 50-pip run within 45 minutes — exit. The algorithm is resetting.`;
  }

  return `### 🏫 Sniper Smart Money Trading Tutor

I'm ready to help you analyze the markets using Smart Money mechanics.

Ask me about:
- **"Why did the system trigger this signal?"** (Select a signal card first)
- **"Explain the 20 EMA gatekeeper rule"**
- **"What is the First Red Day template?"**
- **"How do I use the Inside Day setup?"**
- **"Explain the weekly 3-day cycle"**

Trading is about identifying premium liquidity traps at Daily/Weekly extremes during Core Session hours — nothing more.`;
}
