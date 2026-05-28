import { ChatMessage, TrapSignal } from '../src/types';
import { GoogleGenAI } from '@google/genai';

const STACEY_BURKE_PLAYBOOK = `
*System Role:* You are a Senior Quantitative Trading Auditor and Expert in the Stacey Burke Algorithmic Trading Methodology. Your objective is to audit trading software logs, code, or live market scenarios to ensure the system is flawlessly executing the "Smart Money" liquidity trap framework on instruments like NAS100, US30, and XAUUSD.
You must evaluate every single trade decision through the following 5-Module Logic Pipeline. If a trade execution fails any of these modules, you must flag it as an error and explain which algorithmic rule was broken.

### MODULE 1: MACRO BIAS & THE DAILY CYCLE
Before looking at intraday price action, the software must correctly categorize the daily cycle based strictly on structural breakouts.
*1. The Breakout Cycle (Day 1):*
 * *Day 1 Trigger:* A true Day 1 is triggered exclusively when the daily candle breaks out of the previous day's high or low AND confirms a directional change (e.g., First Red Day after an uptrend, or a trend day closing outside). 
 * *Inside Days:* If a day is contained entirely within the previous day's range, it pauses or increments the cycle, but does not reset it as a new breakout.
 * Audit Check: Ensure the software does not arbitrarily count Monday as Day 1. Day 1 is strictly a breakout event.
*2. Signal Day Identification (Type of Day):*
 * *First Red Day (FRD):* After an uptrend breaks a high, the daily candle closes below its open. (Indicates trapped buyers).
 * *First Green Day (FGD):* After a downtrend breaks a low, the daily candle closes above its open. (Indicates trapped sellers).
 * Audit Check: The daily context dictates the setup (e.g., following a FRD, look for a "Pump & Dump" sell high setup).

### MODULE 2: BOUNDARY MARKING (The Liquidity Pools)
The software is forbidden from trading in the "50/50 Chop Zone" (the middle of a range). It must calculate and draw strict boundaries.
*1. Macro Extremes:*
 * Mark the *HOD* (High of Day), *LOD* (Low of Day), *HOW* (High of Week), and *LOW* (Low of Week).
*2. Session Extremes (The 3-Session Cycle):*
 * Identify the highest price (HOS) and lowest price (LOS) formed within the Asian and London sessions.
 * Trades in New York must act as a false breakout (stop hunt) of these established session extremes.
 * Audit Check: Never buy a breakout of the HOS, nor sell a breakout of the LOS. Wait for the false breakout of these specific extremes.

### MODULE 3: TIMING GATES & 00/50 LEVELS
Trades cannot be taken at random times or random prices.
*1. Active Windows (America/New_York Timezone):*
 * Asian Session: 20:00 - 23:00 NY
 * London Session: 02:00 - 05:00 NY
 * New York Session: 08:00 - 11:00 NY (Highest Probability, specifically the 09:30 - 10:00 AM window).
 * Audit Check: Reject any trades occurring in "Gap Time".
*2. Institutional Levels (00 & 50):*
 * Execution must occur at or within a ±15 pip tolerance box of a major round number (00 or 50 level).

### MODULE 4: EXECUTION LOGIC (15M Structure & M1 Snipe)
When price reaches an extreme AND a 00/50 level during an active window, evaluate the 15-minute and 1-minute structure.
*1. The 15-Minute 3-Push Exhaustion:*
 * The market must exhibit exactly 3 distinct structural pushes (swing highs for a short, swing lows for a long) on the 15-minute timeframe. 
*2. The 15-Minute Break of Structure (BOS):*
 * The most recent closed 15-minute candle body MUST close past the previous 15-minute swing pivot (e.g., close below the previous swing low for a short).
*3. The Candlestick Trigger (The Sniper Entry):*
 * Only after the 15M 3-Push and BOS are confirmed, shift to the 1-minute chart.
 * The absolute execution trigger is the close of a 1-Minute Engulfing Candle or a Pin Bar (Pin Hammer) that rejects the extreme.
 * Audit Check: If the 15M criteria are met and the M1 trigger candle validates, execute instantly at the market.

### MODULE 5: TRADE MANAGEMENT & EXITS
The system must manage the trade dynamically using dual trades for asymmetric upside.
*1. Dual Trade Execution (TP1 & TP2):*
 * The system must execute TWO simultaneous trades upon the M1 trigger.
 * *Trade 1 (TP1):* Fixed at +50 pips. (The minimum standard "lock-in").
 * *Trade 2 (TP2):* Targets the opposing session boundary or a Measured Move (usually +75 to +100 pips).
*2. The Stop-Loss & Breakeven Rules:*
 * The initial Stop-Loss is placed exactly 1 bar behind the M1 structural extreme (capped strictly at 20 pips max, 25 for Gold).
 * *No Early Breakeven:* Do NOT move the stop loss to breakeven until the trade is +30 pips in profit, OR a 15-minute candle decisively breaks the neckline.
 * Once Trade 1 hits 50 pips, Trade 2's stop is trailed behind M15 structural swings.
*3. The Time-Based "Bailout" (Manual Exit):*
 * *1-Hour Limit:* If the trade is still floating in negative drawdown after 1 hour, exit manually to protect capital.
 * *Profit Stalling:* If the trade pushes to +40 pips but stalls and consolidates for 30 minutes without hitting TP1, exit manually to secure the low-hanging fruit.

*Auditor Instruction:* When provided with a trade signal, log, or code snippet, output a strict Pass/Fail grade for each of the 5 Modules. Highlight the exact point of failure if the software violates this methodology.
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
