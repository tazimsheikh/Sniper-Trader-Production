import dbModule from "../core/db.js";
import { logger } from "./logger.js";

const db: any = new Proxy({}, {
  get(_target, prop) {
    const activeDb = (global as any).__SIM_DB__ || dbModule;
    return activeDb[prop];
  }
});

export interface DwcbResult {
  dwcbMultiplier: number;
  currentPeak: number;
  drawdown: number;
}

/**
 * Calculates the Daily Drawdown Circuit Breaker (DWCB) multiplier based on profile settings and current balance.
 * Updates the peak balance in the database if the current balance exceeds it.
 * 
 * @param profileId The trading profile ID
 * @param dwcbEnabled Whether DWCB is enabled (1 or 0)
 * @param dwcbPeakBalance The current peak balance from the profile record
 * @param effectiveBalance The current effective balance of the account
 * @returns An object containing the multiplier, updated/current peak, and calculated drawdown.
 */
export async function calculateDwcb(
  profileId: string | number,
  dwcbEnabled: number | boolean,
  dwcbPeakBalance: number,
  effectiveBalance: number
): Promise<DwcbResult> {
  let dwcbMultiplier = 1;
  let currentPeak = dwcbPeakBalance || 0;
  let drawdown = 0;

  if (dwcbEnabled === 1 || dwcbEnabled === true) {
    if (effectiveBalance > currentPeak) {
      currentPeak = effectiveBalance;
      try {
        await db
          .prepare("UPDATE trading_profiles SET dwcb_peak_balance = ? WHERE id = ?")
          .run(currentPeak, profileId);
      } catch (err: any) {
        logger.error(`[DwcbCalculator] Failed to update peak balance for profile ${profileId}:`, err.message);
      }
    }
    drawdown = currentPeak > 0 ? (currentPeak - effectiveBalance) / currentPeak : 0;
    const boundedDD = Math.min(0.29, Math.max(0, drawdown));
    dwcbMultiplier = Math.max(0, 1 - Math.pow(boundedDD / 0.29, 2));

    // Drawdown Velocity Soft Halt: if drawdown > 5% within recent trades, scale down risk
    if (drawdown > 0.05 && dwcbMultiplier > 0.25) {
      dwcbMultiplier *= 0.5; // Apply soft velocity dampener
    }
  }

  return { dwcbMultiplier, currentPeak, drawdown };
}
