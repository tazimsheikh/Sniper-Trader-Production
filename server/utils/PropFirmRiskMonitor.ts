export class PropFirmRiskMonitor {
  private startOfDayEquity: Map<string, number> = new Map();
  private isHalted: Map<string, boolean> = new Map();
  private maxDrawdownPct: number = 0.10; // 10% Absolute
  private maxDailyLossPct: number = 0.04; // 4% Daily

  private getESTDate(date: Date): Date {
    return new Date(date.getTime() - 5 * 60 * 60 * 1000);
  }

  public registerSnapshot(accountId: string, currentEquity: number) {
    if (!this.startOfDayEquity.has(accountId)) {
      this.startOfDayEquity.set(accountId, currentEquity);
      this.isHalted.set(accountId, false);
      console.log(`[PropFirmRiskMonitor] 🛡️ Registered initial equity snapshot for ${accountId}: $${currentEquity.toFixed(2)}`);
    }
  }

  public resetDailySnapshot(accountId: string, currentEquity: number) {
    this.startOfDayEquity.set(accountId, currentEquity);
    this.isHalted.set(accountId, false);
    console.log(`[PropFirmRiskMonitor] 🔄 17:00 EST Reset: New daily equity snapshot for ${accountId}: $${currentEquity.toFixed(2)}`);
  }

  public checkRisk(accountId: string, currentEquity: number, startingAccountBalance: number = currentEquity, isInstitutionalEnabled: boolean = true): { halted: boolean, reason?: string } {
    if (!isInstitutionalEnabled) return { halted: false };

    if (this.isHalted.get(accountId)) {
      return { halted: true, reason: "Account is in emergency halt state." };
    }

    const startEquity = this.startOfDayEquity.get(accountId);
    if (!startEquity) return { halted: false };

    // Check Daily Loss (4.5%)
    const dailyDrawdown = (currentEquity - startEquity) / startEquity;
    if (dailyDrawdown <= -this.maxDailyLossPct) {
      this.isHalted.set(accountId, true);
      const reason = `[PropFirmRiskMonitor] 🚨 EMERGENCY HALT 🚨 Daily loss limit breached! Current Equity ($${currentEquity.toFixed(2)}) is down ${(Math.abs(dailyDrawdown)*100).toFixed(2)}% from start-of-day ($${startEquity.toFixed(2)}).`;
      console.error(reason);
      return { halted: true, reason };
    }

    // Check Absolute Drawdown (9.5%)
    const absoluteDrawdown = (currentEquity - startingAccountBalance) / startingAccountBalance;
    if (absoluteDrawdown <= -this.maxDrawdownPct) {
      this.isHalted.set(accountId, true);
      const reason = `[PropFirmRiskMonitor] 🚨 EMERGENCY HALT 🚨 Absolute drawdown limit breached! Current Equity ($${currentEquity.toFixed(2)}) is down ${(Math.abs(absoluteDrawdown)*100).toFixed(2)}% from starting balance ($${startingAccountBalance.toFixed(2)}).`;
      console.error(reason);
      return { halted: true, reason };
    }

    return { halted: false };
  }
}

export const propFirmRiskMonitor = new PropFirmRiskMonitor();
