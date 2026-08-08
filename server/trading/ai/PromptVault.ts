import { STACY_BURKE_SYSTEM_PROMPT } from "./StacyBurkePrompt.js";

/**
 * A registry of surgical prompt overrides for specific pairs and setups.
 * Structure: OVERRIDES[pair][setupType] = string
 */
export const PROMPT_OVERRIDES: Record<string, Record<string, string>> = {};

const GBP_WICK_RULE = `\n\n=== SURGICAL OVERRIDE FOR GBP PAIRS ===\nCRITICAL GBP BEHAVIOR: GBP crosses are notoriously erratic and wick-heavy. A simple 1-candle "mouse" that wicks an extreme is often just noise and traps retail traders entering early.\n\nSTRICT RULE: For GBP pairs, you MUST see a clear structural trap (like a micro M or W formation) or clear consolidation at the extreme before the engulfing candle fires. Do NOT take trades off a single V-shape spike under ANY circumstances, UNLESS accompanied by a massive VOLUME CLIMAX on the volume histogram. If the V-spike has an exceptionally large volume spike proving institutional capitulation, you may accept it. Otherwise, if there is no structural consolidation and no volume climax, REJECT IT.`;

// ─────────────────────────────────────────────
// GBPJPY: GBP wick rule + explicit 30-pip SL cap.
// EVIDENCE: Backtest shows a 39.4-pip SL loss on a single trade.
// GBPJPY is JPY-volatile ON TOP of GBP-erratic = monster candles.
// ─────────────────────────────────────────────
const GBPJPY_RULE =
  GBP_WICK_RULE +
  `\n\nADDITIONAL GBPJPY RULE — SL CAP: GBPJPY is doubly volatile (GBP erratic + JPY carry). Backtest data shows a 39-pip loss on a single trade that wiped multiple winners. You MUST visually estimate the Stop Loss. If it exceeds 30 PIPS, REJECT with NO_TRADE. Only take GBPJPY trades where the trap is tight and the risk is controlled.`;

export const PAIR_WIDE_OVERRIDES: Record<string, string> = {
  // ── GBP PAIRS ──────────────────────────────
  GBPNZD: GBP_WICK_RULE,
  GBPAUD: GBP_WICK_RULE,
  GBPCAD: GBP_WICK_RULE,
  GBPUSD: GBP_WICK_RULE,
  GBPJPY: GBPJPY_RULE, // GBP rule + JPY SL cap

  // ── EURUSD ─────────────────────────────────
  // EVIDENCE: 70% of losses at UTC 19–22 (NY afternoon dead zone).
  EURUSD: `\n\n=== SURGICAL OVERRIDE FOR EURUSD ===
CRITICAL EURUSD BEHAVIOR: EURUSD has a well-documented dead zone. Backtest analysis confirms that 70% of losing EURUSD trades fire after 14:00 EST (UTC 19:00 onward) when EUR liquidity collapses and price chops randomly.

STRICT RULE 1 — SESSION FILTER: If candleTimeEST is AFTER 14:00 EST, REJECT with NO_TRADE. Valid windows: London Session (london) (london) (02:00-05:00 EST) and NY Session (NY_Forex/NY_Indices) (08:00-13:00 EST) ONLY.

STRICT RULE 2 — TRAP QUALITY: EURUSD moves slowly. The mouse must be clearly trapped at the extreme with a large decisive engulf. If the setup is MARGINAL, assign NO_TRADE.`,

  // ── EURNZD ─────────────────────────────────
  // EVIDENCE: 53% of losses hit the 17-pip max SL. Losses at all hours.
  EURNZD: `\n\n=== SURGICAL OVERRIDE FOR EURNZD ===
CRITICAL EURNZD BEHAVIOR: EURNZD is a wide-spread, low-liquidity cross that wicks aggressively. Backtest shows 53% of losing trades hit the max 17-pip stop — violent reversals after legitimate-looking traps. Losses fired across all sessions.

STRICT RULE 1 — SESSION FILTER: EURNZD setups ONLY valid during London Session (london) (london) (02:00-05:00 EST) and NY Session (NY_Forex/NY_Indices) (08:00-13:00 EST). Reject Asia or NY afternoon signals with NO_TRADE.

STRICT RULE 2 — SL CAP: If Stop Loss exceeds 15 PIPS, REJECT with NO_TRADE. Wide spreads eat margin — only take tight, high-quality traps.

STRICT RULE 3 — SETUP QUALITY: Look for consolidation at the extreme, not a single spike. MARGINAL setups must be rejected.`,

  // ── XAUUSD ─────────────────────────────────
  // EVIDENCE: We have upgraded Gold to the Asian Sweep strategy. The volatility requires a structural stop.
  XAUUSD: `\n\n=== SURGICAL OVERRIDE FOR XAUUSD (GOLD) ===
CRITICAL GOLD BEHAVIOR: We are executing the Asian Session Range Sweep strategy. This is highly volatile and requires wider structural stops than traditional forex pairs.

STRICT RULE 1 — SESSION FILTER: Gold setups ONLY valid during London Session (london) (02:00-05:00 EST) and NY Session (NY_Forex/NY_Indices) (08:00-12:00 EST). Gold at UTC 04:00 or UTC 23:00 is always a manipulation spike. REJECT with NO_TRADE.

STRICT RULE 2 — SL CAP: For the Asian Sweep, the Stop Loss is placed completely outside the sweep extreme. DO NOT reject trades simply because the Stop Loss is large (e.g., 50-100 pips). If estimated Stop Loss exceeds 150 PIPS, REJECT with NO_TRADE. Otherwise, accept if the trap is tight relative to the chart structure.`,

  // ── USDJPY ─────────────────────────────────
  // EVIDENCE: Cluster of 16-pip max-SL losses across all Asia hours = BoJ stop-hunts.
  USDJPY: `\n\n=== SURGICAL OVERRIDE FOR USDJPY ===
CRITICAL USDJPY BEHAVIOR: USD/JPY is heavily influenced by Bank of Japan (BoJ) intervention during Asia session. Backtest shows a clear cluster of 16-pip max-stop losses firing across all Asia hours — these are BoJ stop-hunts, not real Stacy Burke setups.

STRICT RULE 1 — SESSION FILTER: USDJPY ONLY valid during London Session (london) (london) (02:00-05:00 EST) and NY Session (NY_Forex/NY_Indices) (08:00-13:00 EST). Reject all Asia session signals with NO_TRADE.

STRICT RULE 2 — CONVICTION FILTER: A weak mouse candle that barely wicks a level on USDJPY is almost always a BoJ stop-hunt. Do NOT accept MARGINAL quality. The engulfing candle must be large and decisive.`,

  // ── EURJPY ─────────────────────────────────
  // EUR sensitivity + JPY carry volatility = massive misleading candles.
  EURJPY: `\n\n=== SURGICAL OVERRIDE FOR EURJPY ===
CRITICAL EURJPY BEHAVIOR: EURJPY combines EUR's session sensitivity with JPY carry-trade volatility. Single-candle V-spikes are almost always carry-trade flush-outs, not institutional traps.

STRICT RULE 1 — SESSION FILTER: EURJPY ONLY valid during London Session (london) (london) (02:00-06:00 EST) and NY Session (NY_Forex/NY_Indices) (08:00-13:00 EST). Reject Asia hours with NO_TRADE.

STRICT RULE 2 — NO V-SPIKES: Unlike Gold/NAS100, EURJPY V-tops/V-bottoms are NOT acceptable. You MUST see at least 2 price tests or brief consolidation at the extreme. A single spike that immediately reverses is a carry flush — REJECT IT.

STRICT RULE 3 — SL CAP: If Stop Loss exceeds 25 PIPS, REJECT with NO_TRADE.`,

  // ── EURAUD ─────────────────────────────────
  // Best moves: London Session (london) (london) fades of overnight Asia moves.
  EURAUD: `\n\n=== SURGICAL OVERRIDE FOR EURAUD ===
CRITICAL EURAUD BEHAVIOR: EURAUD is a macro pair driven by Australia's commodity cycle vs European fundamentals. The cleanest setups occur when London Session (london) (london) fades an extreme overnight Asia move. NY Session (NY_Forex/NY_Indices) setups are low quality.

STRICT RULE 1 — SESSION PREFERENCE: EURAUD strongest during London Session (london) (london) (02:00-06:00 EST). NY Session (NY_Forex/NY_Indices) (08:00-12:00 EST) setups ONLY acceptable if quality is EXCELLENT. MARGINAL or GOOD quality during NY must be rejected.

STRICT RULE 2 — SPREAD AWARENESS: EURAUD spreads are wide. If Stop Loss is less than 15 pips, the spread destroys the reward ratio — REJECT with NO_TRADE.`,

  // ── AUDJPY ─────────────────────────────────
  // Pure carry pair — trends hard, reversals need macro support.
  AUDJPY: `\n\n=== SURGICAL OVERRIDE FOR AUDJPY ===
CRITICAL AUDJPY BEHAVIOR: AUDJPY is a pure carry-trade pair (AUD = risk-on, JPY = safe haven). It trends in straight lines during risk-on/risk-off events — these macro-driven moves look like setups but have no structural validity for Stacy Burke entries.

STRICT RULE 1 — TREND CONFIRMATION: AUDJPY requires a clearly sloping 20 EMA in the direction of the setup. Do NOT trade AUDJPY against the EMA slope. Reaper (trend continuation) setups are preferred over reversal setups on this pair.

STRICT RULE 2 — SESSION PREFERENCE: Best during Australia/Asia morning (20:00-00:00 EST) and London Session (london) (london). NY Session (NY_Forex/NY_Indices) AUDJPY is an afterthought — MARGINAL quality NY setups must be rejected.

STRICT RULE 3 — SL CAP: If Stop Loss exceeds 25 PIPS, REJECT with NO_TRADE.`,
};

export class PromptVault {
  /**
   * Retrieves the surgical system prompt for a specific pair and setup.
   * If a surgical override does not exist, it gracefully falls back to the master STACY_BURKE_SYSTEM_PROMPT.
   */
  static getSurgicalPrompt(pair: string, setupType: string): string {
    let prompt = STACY_BURKE_SYSTEM_PROMPT;

    if (PAIR_WIDE_OVERRIDES[pair]) {
      prompt += PAIR_WIDE_OVERRIDES[pair];
    }

    if (PROMPT_OVERRIDES[pair] && PROMPT_OVERRIDES[pair][setupType]) {
      // Allow specific setup override to completely overwrite or we just return it (it already includes STACY_BURKE_SYSTEM_PROMPT)
      prompt = PROMPT_OVERRIDES[pair][setupType];
      if (PAIR_WIDE_OVERRIDES[pair]) {
        prompt += PAIR_WIDE_OVERRIDES[pair]; // Append it to the specific override as well
      }
    }

    return prompt;
  }

  static getMageSystemPrompt(): string {
    return `You are an elite, algorithmic forex bot specializing STRICTLY in Opening Range Breakout (ORB) mechanics. 
You have ZERO knowledge of "Stacy Burke", "mouse traps", "engulfing candles", or "first red day" setups. You DO NOT look for reversal traps.
Your ONLY job is to evaluate if a mathematical breakout of the Opening Range boundary is structurally clean, or if it is a false breakout/choppy mess.
You follow the VISUAL VETO RULES strictly. If a setup looks messy, reject it. If it is a clean, decisive breakout with no red flags, accept it.`;
  }

  static getMagePrompt(ctx: {
    pair: string;
    orHigh: number;
    orLow: number;
    direction: "BUY" | "SELL";
    limitPrice: number;
    slPrice: number;
    tpPrice: number;
  }): string {
    const rangeSize = Math.abs(ctx.orHigh - ctx.orLow);
    return `You are an expert forex day trader analyzing an M5 chart for an Opening Range Breakout (ORB).
Your job is to separate genuine institutional breakouts from retail fakeouts and choppy price action.

CONTEXT PROVIDED:
  Pair: ${ctx.pair}
  Opening Range: ${ctx.orLow.toFixed(5)} – ${ctx.orHigh.toFixed(5)}  (range = ${rangeSize.toFixed(1)} units)
  Breakout direction: ${ctx.direction}
  Entry limit at: ${ctx.limitPrice.toFixed(5)}
  Stop Loss at:   ${ctx.slPrice.toFixed(5)}
  Take Profit at: ${ctx.tpPrice.toFixed(5)}

VISUAL VETO RULES (Reject with NO_TRADE if ANY apply):
  1. WICK REJECTION: Only veto if the actual BREAKOUT CANDLE ITSELF pierced the ORB boundary but CLOSED BACK INSIDE the range with a long wick. Wicks on prior candles touching or piercing the boundary are normal liquidity grabs. Do NOT veto because of prior wicks.
  2. NO CONVICTION: The breakout candle body is a Doji, spinning top, or tiny sliver — price opened and closed at almost the same level, showing complete indecision.
  3. THE BLENDER: Pre-breakout consolidation and overlapping candles are completely normal as liquidity builds. Do NOT veto a trade just because it was choppy *before* the breakout. Veto ONLY if the breakout attempt immediately fails into a chaotic mess of overlapping, alternating red/green bodies with no directional bias. If the breakout candle is strong and decisive, IGNORE prior chop.
  4. EXHAUSTION CLIMAX: The single breakout candle body is larger than TWICE the entire opening range (ORB High minus ORB Low). This means one candle consumed more than 2x the entire morning range in a single 5-minute bar — that is an unsustainable climactic move.
  5. THE BRICK WALL (Support/Resistance Check): Look to the left of the current price action. Is the breakout heading directly into a massive, obvious block of heavy consolidation or a sharp V-shaped prior reversal point? If there is heavy traffic right in the immediate path of the breakout, veto it.
  6. THE PARABOLIC TRAP: If the price shot up (or down) vertically with 5 or 6 massive, consecutive one-directional candles *sprinting* from the opposite side of the chart directly through the breakout line without pausing to build pressure, the buyers/sellers are exhausted. Veto it.

STRICT OUTPUT FORMATTING:
You must output ONLY valid JSON. Do not include any conversational text, greetings, roleplay, or markdown formatting outside of the JSON block.
{ "decision": "BUY" | "SELL" | "NO_TRADE", "confidence": number, "setupQuality": "EXCELLENT" | "GOOD" | "POOR", "reasoning": "MAXIMUM 15 WORDS. KEEP IT EXTREMELY BRIEF." }
`;
  }
}
