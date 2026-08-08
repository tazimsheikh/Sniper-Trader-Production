/**
 * MathFilters.ts - Stub Implementation
 * Exporting functions and classes needed for mathematical trade filtering.
 * The actual logic will be implemented by the implementation agent.
 */

import type { BasicTrade as Trade } from "../config/types.js";
export type { Trade };

import type { MathFilterConfig } from "../config/types.js";
export type { MathFilterConfig };

export class MathFilterManager {
  private config: MathFilterConfig = {};
  private balance: number = 10000;
  private maxBalance: number = 10000;
  private isHalted: boolean = false;

  constructor(config?: MathFilterConfig, initialBalance: number = 10000) {
    if (config) this.config = config;
    this.balance = initialBalance;
    this.maxBalance = initialBalance;
    this.isHalted = false;
    if (initialBalance <= 0) {
      this.isHalted = true;
    }
  }

  public setConfig(config: MathFilterConfig): void {
    this.config = config;
  }

  public getBalance(): number {
    return this.balance;
  }

  public getDrawdownPct(): number {
    if (this.maxBalance <= 0 || this.balance <= 0) return 100.0;
    const raw = ((this.maxBalance - this.balance) / this.maxBalance) * 100;
    return Math.round(raw * 1e6) / 1e6;
  }

  public isTradeAllowed(
    trade:
      { pair: string; setupType: string; timestamp: number } | null | undefined,
  ): boolean {
    if (this.isHalted) {
      return false;
    }
    const limit =
      this.config?.drawdownLimitPct !== undefined
        ? this.config.drawdownLimitPct
        : 29.0;
    if (this.getDrawdownPct() >= limit) {
      this.isHalted = true;
      return false;
    }
    return isTradeAllowed(trade, this.config);
  }

  public recordTradeOutcome(trade: {
    pair: string;
    setupType: string;
    timestamp: number;
    pips: number;
    riskPips: number;
    outcome: string;
  }): void {
    if (this.isHalted) {
      return;
    }
    if (
      !trade ||
      trade.riskPips === null ||
      trade.riskPips === undefined ||
      trade.riskPips <= 0
    ) {
      return;
    }
    const rMultiple = trade.pips / trade.riskPips;
    const riskAmount = this.balance * 0.01;
    const profit = riskAmount * rMultiple;
    this.balance += profit;
    if (this.balance > this.maxBalance) {
      this.maxBalance = this.balance;
    }
    if (this.balance <= 0) {
      this.isHalted = true;
      return;
    }
    const limit =
      this.config?.drawdownLimitPct !== undefined
        ? this.config.drawdownLimitPct
        : 29.0;
    if (this.getDrawdownPct() >= limit) {
      this.isHalted = true;
    }
  }

  public reset(initialBalance: number = 10000): void {
    this.balance = initialBalance;
    this.maxBalance = initialBalance;
    this.isHalted = false;
    if (initialBalance <= 0) {
      this.isHalted = true;
    }
  }
}

export function isTradeAllowed(
  trade:
    { pair: string; setupType: string; timestamp: number } | null | undefined,
  config?: MathFilterConfig,
): boolean {
  if (!trade) return false;
  if (
    trade.pair === null ||
    trade.pair === undefined ||
    typeof trade.pair !== "string"
  )
    return false;
  if (
    trade.setupType === null ||
    trade.setupType === undefined ||
    typeof trade.setupType !== "string"
  )
    return false;

  // For the Alpha Portfolio, all math filter bans are removed because the Monte Carlo
  // engine explicitly validated these pairs over 5 years WITHOUT manual day/hour bans.
  return true;
}

export function isRolloverCircuitBreaker(estHour: number, estMin: number): boolean {
  // ðŸš« Prop Firm Compliance: Rollover Circuit Breaker (16:55 to 17:05 EST) ðŸš«
  return (estHour === 16 && estMin >= 55) || (estHour === 17 && estMin <= 5);
}
export function isSeerRolloverHalt(estHour: number, estMin: number): boolean {
  // Seer specific wider window (16:50 - 17:15 EST)
  return (estHour === 16 && estMin >= 50) || (estHour === 17 && estMin < 15);
}

export function isEODSession(estHour: number, estMin: number): boolean {
  return (estHour === 16 && estMin >= 30) || (estHour >= 17 && estHour < 19);
}


export function isToxicDay(dateOrDow: Date | number, toxicDays?: number[]): boolean {
  if (!toxicDays || toxicDays.length === 0) return false;
  const dow = typeof dateOrDow === 'number' ? dateOrDow : dateOrDow.getUTCDay();
  return toxicDays.includes(dow);
}

/**
 * Calculates the dynamic risk multiplier based on Range Exhaustion and Relative Volatility Regime (RVR).
 * 
 * @param orBoxPips Opening Range or Sweep Box size in pips
 * @param adr14Pips 14-day Average Daily Range in pips
 * @param rvr Relative Volatility Regime ratio (ATR14 / SMA50(ATR14))
 * @returns Risk multiplier (0.0 = REJECT, 0.5x = Low Compression, 1.0x = Normal, 1.5x = Expansion Golden Zone)
 */
export function getVolatilityRegimeMultiplier(
  orBoxPips: number,
  adr14Pips: number,
  rvr: number
): number {
  // 1. Range Exhaustion Guard: If ORB/Sweep consumes > 65% of 14-day ADR -> REJECT (0.0x)
  if (adr14Pips > 0 && (orBoxPips / adr14Pips) > 0.65) {
    return 0.0;
  }

  // 2. Ultra-Low Volatility Compression Guard (< 0.80 RVR) -> Half Risk (0.5x)
  if (rvr < 0.80) {
    return 0.5;
  }

  // 3. Volatility Expansion Golden Zone (1.25x - 1.50x RVR) -> Boost Risk (1.5x)
  if (rvr >= 1.25 && rvr <= 1.50) {
    return 1.5;
  }

  return 1.0;
}
