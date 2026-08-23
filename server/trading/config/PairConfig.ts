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
    const isCryptoOrMetals = ["XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "XTIUSD"].includes(symbol);
    const isIndices = ["US30", "NAS100", "SPX500", "GER30", "UK100", "JPN225", "GER40"].includes(symbol);
    if (isCryptoOrMetals || isIndices) return false;
    return /^[A-Z]{6}$/.test(symbol);
  }

  static getSageConfigs(sessionPair: string): PairConfig[] {
    const baseSymbol = this.getBaseSymbol(sessionPair);
    const data = SAGE_PAIR_CONFIG[sessionPair] || SAGE_PAIR_CONFIG[baseSymbol];
    if (!data) return [];
    const configs = Array.isArray(data) ? data : [data as any];
    return configs.map((c, i) => ({ ...c, signature: c.signature || `SAGE_${sessionPair}_${i}` }));
  }

  static getMageConfigs(sessionPair: string): PairConfig[] {
    const baseSymbol = this.getBaseSymbol(sessionPair);
    const data = MAGE_PAIR_CONFIG[sessionPair] || MAGE_PAIR_CONFIG[baseSymbol];
    if (!data) return [];
    const configs = Array.isArray(data) ? data : [data as any];
    return configs.map((c, i) => ({ ...c, signature: c.signature || `MAGE_${sessionPair}_${i}` }));
  }

  static getSeerConfigs(sessionPair: string): PairConfig[] {
    const baseSymbol = this.getBaseSymbol(sessionPair);
    const data = SEER_PAIR_CONFIG[sessionPair] || SEER_PAIR_CONFIG[baseSymbol];
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
  'GER40': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [6, 12],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 5,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 60,
      "minSlDist": 50,
      "maxSlDist": 350,
      "minBodyPips": 12,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1.5,
      "forceCloseHours": 24,
      "riskPct": 0.029259231760329824
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [6, 12],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 50,
      "maxSlDist": 350,
      "minBodyPips": 10,
      "orbPullbackPct": 0.15,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "riskPct": 0.05139007010540621
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
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 30,
      "maxSlDist": 80,
      "minBodyPips": 15,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1.5,
      "forceCloseHours": 8,
      "riskPct": 0.03050521398637339
    },
    {
    "tickSize": 0.01,
    "pipSize": 0.1,
    "spread": 1.5,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 30,
      "maxSlDist": 200,
      "minBodyPips": 15,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1.5,
      "forceCloseHours": 8,
      "riskPct": 0.027659287534715787
    }
  ],
  'AUDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.2,
      "toxicDays": [5],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 20,
      "maxSlDist": 100,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "riskPct": 0.021370495469277176
    }
  ],
  'USDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "toxicHours": [22],
      "toxicDays": [2],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 150,
      "minBodyPips": 4,
      "orbPullbackPct": 0.15,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.0262737833636224
    }
  ],
  'USDCHF': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicDays": [3],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 0,
      "orbStartMin": 0,
      "orbMinutes": 45,
      "actionMinutes": 180,
      "minSlDist": 10,
      "maxSlDist": 70,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 16,
      "riskPct": 0.14498234017028022
    }
  ],
  'US30': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "toxicHours": [5],
      "toxicDays": [2],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 50,
      "maxSlDist": 350,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "riskPct": 0.02017722228180775
    }
  ],
  'EURUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicDays": [2],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 5,
      "maxSlDist": 40,
      "minBodyPips": 5,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.15132916711355812
    }
  ],
  'JPN225': [
    {
    "tickSize": 1,
    "pipSize": 1,
    "spread": 10,
      "toxicDays": [4],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 5,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 60,
      "minSlDist": 60,
      "maxSlDist": 160,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "riskPct": 0.029609650960083875
    }
  ],
  'GBPJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 15,
      "maxSlDist": 50,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "riskPct": 0.02017722228180775
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 40,
      "maxSlDist": 100,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1.5,
      "forceCloseHours": 8,
      "riskPct": 0.05936107349123883
    }
  ]
};

// ============================================================
// SAGE OPTIMIZED CONFIGURATIONS
// ============================================================
export const SAGE_PAIR_CONFIG: Record<string, PairConfig[]> = {
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
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.08524690725438241
    }
  ],
  'GER40': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [6, 12],
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": true,
      "minWbr": 1.5,
      "riskPct": 0.15132916711355812
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [6, 12],
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.15132916711355812
    }
  ]
};

export const SEER_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'XAUUSD': [
    {
      "tickSize": 0.01,
      "pipSize": 0.1,
      "spread": 1.5,
      "session": "NY_Forex",
      "delayStartMinutes": 0,
      "cutoffHour": 13,
      "minBodyPips": 20,
      "pinBarWickBodyRatio": 1.5,
      "minSlDist": 40,
      "maxSlDist": 100,
      "minTpDist": 40,
      "defaultTpDist": 100,
      "maxTpDist": 100,
      "riskPct": 0.01,
      "maxH1EmaSlope": 20
    }
  ]
};
