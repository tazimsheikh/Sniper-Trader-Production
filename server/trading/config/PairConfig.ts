// ============================================================
// PAIR CONFIGURATIONS
// ============================================================

import type { PairConfig } from "./types.js";
export type { PairConfig };
export class PairConfigManager {
  static isOrbEnabled(sessionPair: string): boolean {
    const mageCfgs = this.getMageConfigs(sessionPair);
    const sageCfgs = this.getSageConfigs(sessionPair);
    const seerCfg = this.getSeerConfigs(sessionPair);
    return mageCfgs.some(c => c.orbEnabled) || sageCfgs.some(c => c.orbEnabled) || seerCfg.some(c => c.orbEnabled);
  }

  static getOrbTime(sessionPair: string): { hour: number; min: number } {
    const mageCfgs = this.getMageConfigs(sessionPair);
    const sageCfgs = this.getSageConfigs(sessionPair);
    const seerCfg = this.getSeerConfigs(sessionPair);
    
    const config = mageCfgs[0] || sageCfgs[0] || seerCfg[0];
    
    if (
      config?.orbStartHour !== undefined &&
      config?.orbStartMin !== undefined
    ) {
      return { hour: config.orbStartHour, min: config.orbStartMin };
    }
    return { hour: 9, min: 30 };
  }

  static getBaseSymbol(sessionPair: string): string {
    return sessionPair.split("_")[0].split(".")[0];
  }

  static isForex(sessionPair: string): boolean {
    const symbol = this.getBaseSymbol(sessionPair);
    const isCryptoOrMetals = ["XAUUSD", "XAGUSD"].includes(symbol);
    const isIndices = ["US30", "NAS100", "GER30", "UK100", "GER40"].includes(symbol);
    if (isCryptoOrMetals || isIndices) return false;
    return /^[A-Z]{6}$/.test(symbol);
  }

  static getSageConfigs(sessionPair: string): PairConfig[] {
    const baseSymbol = this.getBaseSymbol(sessionPair);
    const data = SAGE_PAIR_CONFIG[sessionPair] || 
                 SAGE_PAIR_CONFIG[baseSymbol] ||
                 SAGE_PAIR_CONFIG[`${baseSymbol}.DAILY`] ||
                 SAGE_PAIR_CONFIG[`${baseSymbol}.Daily`];
    if (!data) return [];
    const configs = Array.isArray(data) ? data : [data as any];
    return configs.map((c, i) => ({ ...c, signature: c.signature || `SAGE_${sessionPair}_${i}` }));
  }

  static getMageConfigs(sessionPair: string): PairConfig[] {
    const baseSymbol = this.getBaseSymbol(sessionPair);
    const data = MAGE_PAIR_CONFIG[sessionPair] || 
                 MAGE_PAIR_CONFIG[baseSymbol] ||
                 MAGE_PAIR_CONFIG[`${baseSymbol}.DAILY`] ||
                 MAGE_PAIR_CONFIG[`${baseSymbol}.Daily`];
    if (!data) return [];
    const configs = Array.isArray(data) ? data : [data as any];
    return configs.map((c, i) => ({ ...c, signature: c.signature || `MAGE_${sessionPair}_${i}` }));
  }

  static getSeerConfigs(sessionPair: string): PairConfig[] {
    const baseSymbol = this.getBaseSymbol(sessionPair);
    const data = SEER_PAIR_CONFIG[sessionPair] || 
                 SEER_PAIR_CONFIG[baseSymbol] ||
                 SEER_PAIR_CONFIG[`${baseSymbol}.DAILY`] ||
                 SEER_PAIR_CONFIG[`${baseSymbol}.Daily`];
    if (!data) return [];
    const configs = Array.isArray(data) ? data : [data as any];
    return configs.map((c, i) => ({ ...c, signature: c.signature || `SEER_${sessionPair}_${i}` }));
  }

  static getRepresentativeConfig(sessionPair: string): PairConfig | undefined {
    return this.getMageConfigs(sessionPair)[0] || 
           this.getSageConfigs(sessionPair)[0] || 
           this.getSeerConfigs(sessionPair)[0];
  }
}
// ============================================================
// MAGE OPTIMIZED CONFIGURATIONS
// ============================================================
export const MAGE_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'NAS100.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicDays": [0, 4],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 18,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 15,
      "maxSlDist": 80,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.025
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 2,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 120,
      "minSlDist": 50,
      "maxSlDist": 180,
      "minBodyPips": 10,
      "orbPullbackPct": 0.15,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.018477826946610276
    }
  ],
  'USDCHF': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 15,
      "actionMinutes": 60,
      "minSlDist": 10,
      "maxSlDist": 50,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.02418227900544074
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 15,
      "maxSlDist": 20,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1.5,
      "forceCloseHours": 12,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.00951476140485427
    }
  ],
  'GER40.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 30,
      "maxSlDist": 100,
      "minBodyPips": 20,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "slMode": "MIDPOINT",
      "riskPct": 0.018650518160077328
    }
  ],
  'EURUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicDays": [1],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 12.5,
      "maxSlDist": 30,
      "minBodyPips": 5,
      "orbPullbackPct": 0.15,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.025
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 60,
      "minSlDist": 10,
      "maxSlDist": 40,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "ADTEL_MODERATE",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.01767763322880761
    }
  ],
  'XAUUSD': [
    {
    "tickSize": 0.01,
    "pipSize": 0.1,
    "spread": 1.5,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 30,
      "maxSlDist": 80,
      "minBodyPips": 24,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1.5,
      "forceCloseHours": 8,
      "slMode": "MIDPOINT",
      "riskPct": 0.025
    }
  ],
  'GBPUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 1.3,
      "toxicDays": [1],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 60,
      "minSlDist": 7.5,
      "maxSlDist": 80,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.01778459713622503
    }
  ],
  'GBPAUD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 120,
      "minSlDist": 25,
      "maxSlDist": 80,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.019877031910840635
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2,
      "toxicDays": [1, 4],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 60,
      "minSlDist": 15,
      "maxSlDist": 70,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1.5,
      "forceCloseHours": 8,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.01907039303443718
    }
  ],
  'EURCAD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 1.9,
      "toxicDays": [0],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 17,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 25,
      "maxSlDist": 50,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.025
    }
  ],
  'USDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "toxicHours": [23],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 30,
      "maxSlDist": 30,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1.5,
      "forceCloseHours": 16,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.016481918767408305
    }
  ],
  'AUDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.2,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 180,
      "minSlDist": 25,
      "maxSlDist": 40,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "slMode": "OPPOSITE_BOUNDARY",
      "riskPct": 0.017349254466674173
    }
  ]
};

// ============================================================
// SAGE OPTIMIZED CONFIGURATIONS
// ============================================================
export const SAGE_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'GER40.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 30,
      "orbMinutes": 30,
      "actionMinutes": 30,
      "minSlDist": 70,
      "maxSlDist": 150,
      "entryPenetrationPct": 20,
      "sweepPips": 5,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.25,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 10,
      "minSlDist": 70,
      "maxSlDist": 150,
      "entryPenetrationPct": 0,
      "sweepPips": 20,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 5,
      "minSlDist": 70,
      "maxSlDist": 200,
      "entryPenetrationPct": 0,
      "sweepPips": 20,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 15,
      "minSlDist": 120,
      "maxSlDist": 200,
      "entryPenetrationPct": 20,
      "sweepPips": 20,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 2,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 15,
      "minSlDist": 40,
      "maxSlDist": 150,
      "entryPenetrationPct": 0,
      "sweepPips": 30,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.25,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "riskPct": 0.025
    }
  ],
  'USDCAD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.9,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 30,
      "actionMinutes": 30,
      "minSlDist": 25,
      "maxSlDist": 30,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 0.5,
      "forceCloseHours": 8,
      "riskPct": 0.019927998967202418
    }
  ],
  'EURUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 10,
      "minSlDist": 20,
      "maxSlDist": 60,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 30,
      "orbMinutes": 60,
      "actionMinutes": 15,
      "minSlDist": 10,
      "maxSlDist": 40,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.025
    }
  ],
  'XAUUSD': [
    {
    "tickSize": 0.01,
    "pipSize": 0.1,
    "spread": 1.5,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 60,
      "actionMinutes": 15,
      "minSlDist": 40,
      "maxSlDist": 120,
      "entryPenetrationPct": 0,
      "sweepPips": 5,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.024579754409949726
    },
    {
    "tickSize": 0.01,
    "pipSize": 0.1,
    "spread": 1.5,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 60,
      "actionMinutes": 10,
      "minSlDist": 30,
      "maxSlDist": 120,
      "entryPenetrationPct": 0,
      "sweepPips": 7,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "riskPct": 0.008
    }
  ],
  'GBPUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 1.3,
      "toxicHours": [9],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 120,
      "actionMinutes": 15,
      "minSlDist": 20,
      "maxSlDist": 30,
      "entryPenetrationPct": 20,
      "sweepPips": 2,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.015206122996802632
    }
  ],
  'GBPAUD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 22,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 30,
      "minSlDist": 30,
      "maxSlDist": 100,
      "entryPenetrationPct": 20,
      "sweepPips": 5,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "riskPct": 0.01004378613974292
    }
  ],
  'EURCAD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 1.9,
      "toxicDays": [4],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 30,
      "actionMinutes": 15,
      "minSlDist": 20,
      "maxSlDist": 100,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 2,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "riskPct": 0.010490940703422505
    }
  ],
  'USDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 0,
      "orbMinutes": 120,
      "actionMinutes": 60,
      "minSlDist": 30,
      "maxSlDist": 50,
      "entryPenetrationPct": 20,
      "sweepPips": 2,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 15,
      "minSlDist": 25,
      "maxSlDist": 35,
      "entryPenetrationPct": 0,
      "sweepPips": 2,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.021441918165262898
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 10,
      "minSlDist": 25,
      "maxSlDist": 35,
      "entryPenetrationPct": 0,
      "sweepPips": 2,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 1,
      "trailingSlStep": 0.5,
      "forceCloseHours": 8,
      "riskPct": 0.011241417989635304
    }
  ],
  'AUDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.2,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 120,
      "actionMinutes": 15,
      "minSlDist": 60,
      "maxSlDist": 80,
      "entryPenetrationPct": 0,
      "sweepPips": 30,
      "maxSweepMultiplier": 2,
      "requireCloseInside": false,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.025
    }
  ],
  'US30.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 40,
      "maxSlDist": 300,
      "entryPenetrationPct": 20,
      "sweepPips": 30,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "toxicHours": [13],
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 30,
      "minSlDist": 20,
      "maxSlDist": 200,
      "entryPenetrationPct": 20,
      "sweepPips": 50,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "riskPct": 0.015089887594291865
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 120,
      "maxSlDist": 150,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1,
      "forceCloseHours": 16,
      "riskPct": 0.021800633406572477
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 120,
      "maxSlDist": 150,
      "entryPenetrationPct": 20,
      "sweepPips": 10,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 0.25,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "riskPct": 0.023806911448758544
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 120,
      "maxSlDist": 150,
      "entryPenetrationPct": 0,
      "sweepPips": 30,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 0.25,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.018056139654231747
    }
  ],
  'EURAUD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2.3,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 120,
      "actionMinutes": 5,
      "minSlDist": 60,
      "maxSlDist": 200,
      "entryPenetrationPct": 0,
      "sweepPips": 20,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "riskPct": 0.012992034880747547
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2.3,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 30,
      "orbMinutes": 30,
      "actionMinutes": 5,
      "minSlDist": 60,
      "maxSlDist": 300,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "riskPct": 0.014150926217616945
    }
  ],
  'CHFJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 30,
      "minSlDist": 20,
      "maxSlDist": 60,
      "entryPenetrationPct": 0,
      "sweepPips": 5,
      "maxSweepMultiplier": 2,
      "requireCloseInside": false,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 8,
      "riskPct": 0.008
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 2,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 40,
      "maxSlDist": 100,
      "entryPenetrationPct": 0,
      "sweepPips": 5,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "riskPct": 0.008
    }
  ],
  'NAS100.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 5,
      "minSlDist": 70,
      "maxSlDist": 300,
      "entryPenetrationPct": 20,
      "sweepPips": 5,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "riskPct": 0.013753466314672953
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 45,
      "orbMinutes": 60,
      "actionMinutes": 5,
      "minSlDist": 120,
      "maxSlDist": 150,
      "entryPenetrationPct": 20,
      "sweepPips": 5,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.25,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 15,
      "minSlDist": 20,
      "maxSlDist": 150,
      "entryPenetrationPct": 0,
      "sweepPips": 5,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 0.25,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "riskPct": 0.01021218774247739
    }
  ],
  'NZDUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 120,
      "actionMinutes": 15,
      "minSlDist": 15,
      "maxSlDist": 30,
      "entryPenetrationPct": 0,
      "sweepPips": 2,
      "maxSweepMultiplier": 3,
      "requireCloseInside": false,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "riskPct": 0.008
    }
  ],
  'CADJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.4,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 18,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 30,
      "minSlDist": 40,
      "maxSlDist": 60,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "riskPct": 0.025
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.4,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 18,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 30,
      "minSlDist": 30,
      "maxSlDist": 80,
      "entryPenetrationPct": 20,
      "sweepPips": 10,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.025
    }
  ],
  'USDCHF': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 25,
      "maxSlDist": 50,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 8,
      "riskPct": 0.008
    }
  ]
};

// ============================================================
// SEER OPTIMIZED CONFIGURATIONS
// ============================================================
export const SEER_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'US30.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "session": "asia",
      "minBodyPips": 20,
      "pinBarWickBodyRatio": 1.2,
      "minSlDist": 100,
      "maxSlDist": 200,
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "exitMode": "TRAILING",
      "riskPct": 0.025
    }
  ],
  'GBPAUD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2,
      "toxicHours": [20],
      "toxicDays": [2],
      "session": "asia",
      "minBodyPips": 7.5,
      "pinBarWickBodyRatio": 1.2,
      "minSlDist": 40,
      "maxSlDist": 100,
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "exitMode": "TRAILING",
      "riskPct": 0.008
    }
  ],
  'GER40.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [11],
      "toxicDays": [3],
      "session": "ny",
      "minBodyPips": 20,
      "pinBarWickBodyRatio": 2,
      "minSlDist": 50,
      "maxSlDist": 60,
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "exitMode": "TRAILING",
      "riskPct": 0.025
    }
  ]
};

