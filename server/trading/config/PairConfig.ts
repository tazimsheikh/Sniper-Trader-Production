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
  'XAUUSD': [
    {
    "tickSize": 0.01,
    "pipSize": 0.1,
    "spread": 1.5,
      "toxicHours": [7, 9],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 40,
      "maxSlDist": 200,
      "minBodyPips": 15,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.01732522427093643
    }
  ],
  'AUDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.2,
      "toxicHours": [5, 7, 8, 9, 11],
      "toxicDays": [1, 3, 5],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 60,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 24,
      "riskPct": 0.022492073361729016
    }
  ],
  'USDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "toxicHours": [5],
      "toxicDays": [2],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 25,
      "maxSlDist": 30,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "riskPct": 0.018452628251760198
    }
  ],
  'GER40': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 120,
      "maxSlDist": 250,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "riskPct": 0.019122456166857774
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 120,
      "maxSlDist": 200,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "riskPct": 0.01770162259885799
    }
  ],
  'USDCHF': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicHours": [2],
      "toxicDays": [5],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 0,
      "orbStartMin": 0,
      "orbMinutes": 45,
      "actionMinutes": 180,
      "minSlDist": 8,
      "maxSlDist": 100,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.03132443689040336
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicHours": [2],
      "toxicDays": [5],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 0,
      "orbStartMin": 0,
      "orbMinutes": 45,
      "actionMinutes": 180,
      "minSlDist": 8,
      "maxSlDist": 120,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.03132443689040336
    }
  ],
  'GBPUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 1.3,
      "toxicDays": [1, 2],
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
      "riskPct": 0.02069490586550142
    }
  ],
  'CADJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.4,
      "toxicHours": [4],
      "toxicDays": [1],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 20,
      "maxSlDist": 80,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 24,
      "riskPct": 0.0248610962770228
    }
  ],
  'SPX500': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.4,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 40,
      "maxSlDist": 40,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "riskPct": 0.02357367144828479
    }
  ],
  'CHFJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 20,
      "maxSlDist": 150,
      "minBodyPips": 6,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.015887822170675258
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 20,
      "maxSlDist": 70,
      "minBodyPips": 6,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.015887822170675258
    }
  ],
  'GBPNZD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2.5,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 5,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 40,
      "maxSlDist": 60,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1.5,
      "forceCloseHours": 16,
      "riskPct": 0.012367831928967225
    }
  ],
  'EURUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicHours": [8, 14],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 5,
      "maxSlDist": 50,
      "minBodyPips": 5,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 4,
      "riskPct": 0.01799938911755922
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicHours": [8, 14],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 5,
      "maxSlDist": 30,
      "minBodyPips": 5,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 4,
      "riskPct": 0.01799938911755922
    }
  ]
};

// ============================================================
// SAGE OPTIMIZED CONFIGURATIONS
// ============================================================
export const SAGE_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'US30': [
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": true,
      "minWbr": 1.5,
      "riskPct": 0.02490755916405273
    }
  ],
  'GER40': [
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": true,
      "minWbr": 1.5,
      "riskPct": 0.03394887508901133
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
      "maxSlDist": 80,
      "entryPenetrationPct": 0,
      "sweepPips": 20,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": true,
      "minWbr": 1.5,
      "riskPct": 0.03394887508901133
    }
  ],
  'USDCHF': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicHours": [2],
      "toxicDays": [5],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 15,
      "minSlDist": 30,
      "maxSlDist": 50,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.018070351010655673
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicHours": [2],
      "toxicDays": [5],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 15,
      "minSlDist": 30,
      "maxSlDist": 35,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.018070351010655673
    }
  ],
  'USDCAD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.9,
      "toxicDays": [4],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 30,
      "actionMinutes": 30,
      "minSlDist": 25,
      "maxSlDist": 50,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": true,
      "minWbr": 1.5,
      "riskPct": 0.015887568948297067
    }
  ],
  'EURUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicHours": [8, 14],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 60,
      "actionMinutes": 10,
      "minSlDist": 15,
      "maxSlDist": 80,
      "entryPenetrationPct": 20,
      "sweepPips": 5,
      "maxSweepMultiplier": 2,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.75,
      "riskPct": 0.016187094252523817
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicHours": [8, 14],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 60,
      "actionMinutes": 10,
      "minSlDist": 15,
      "maxSlDist": 80,
      "entryPenetrationPct": 20,
      "sweepPips": 5,
      "maxSweepMultiplier": 2,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.75,
      "riskPct": 0.016187094252523817
    }
  ],
  'CHFJPY': [
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
      "maxSlDist": 60,
      "entryPenetrationPct": 0,
      "sweepPips": 5,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.75,
      "riskPct": 0.016693826081580564
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.75,
      "riskPct": 0.016693826081580564
    }
  ],
  'EURNZD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2.2,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 30,
      "minSlDist": 50,
      "maxSlDist": 100,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.020442424978023087
    }
  ],
  'EURCAD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 1.9,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 15,
      "minSlDist": 50,
      "maxSlDist": 80,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.024588727884289414
    }
  ]
};

export const SEER_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'XAUUSD': [
    {
      "tickSize": 0.01,
      "pipSize": 0.1,
      "spread": 1.5,
      "toxicHours": [7, 9],
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
