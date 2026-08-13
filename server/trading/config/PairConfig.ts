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
    const baseSymbol = sessionPair.split("_")[0];
    const data = SAGE_PAIR_CONFIG[sessionPair] || SAGE_PAIR_CONFIG[baseSymbol];
    if (!data) return [];
    const configs = Array.isArray(data) ? data : [data as any];
    return configs.map((c, i) => ({ ...c, signature: c.signature || `SAGE_${sessionPair}_${i}` }));
  }

  static getMageConfigs(sessionPair: string): PairConfig[] {
    const baseSymbol = sessionPair.split("_")[0];
    const data = MAGE_PAIR_CONFIG[sessionPair] || MAGE_PAIR_CONFIG[baseSymbol];
    if (!data) return [];
    const configs = Array.isArray(data) ? data : [data as any];
    return configs.map((c, i) => ({ ...c, signature: c.signature || `MAGE_${sessionPair}_${i}` }));
  }

  static getSeerConfigs(sessionPair: string): PairConfig[] {
    const baseSymbol = sessionPair.split("_")[0];
    const data = SEER_PAIR_CONFIG[sessionPair] || SEER_PAIR_CONFIG[baseSymbol];
    if (!data) return [];
    const configs = Array.isArray(data) ? data : [data as any];
    return configs.map((c, i) => ({ ...c, signature: c.signature || `SEER_${sessionPair}_${i}` }));
  }

  static getBlackSwanConfigs(_sessionPair: string): PairConfig[] {
    return [];
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
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 350,
      "minBodyPips": 12,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.04608443100079986
    }
  ],
  'GBPJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "toxicHours": [5, 6, 22, 23],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 20,
      "maxSlDist": 50,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "riskPct": 0.05766101858220285
    }
  ],
  'USDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "toxicHours": [2, 7],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 25,
      "maxSlDist": 70,
      "minBodyPips": 4,
      "orbPullbackPct": 0.6,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 24,
      "riskPct": 0.022038957568066037
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "toxicHours": [2, 7],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 15,
      "maxSlDist": 40,
      "minBodyPips": 4,
      "orbPullbackPct": 0.6,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "riskPct": 0.05475266825918048
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "toxicHours": [2, 7],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 30,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "riskPct": 0.01897532680621455
    }
  ],
  'GBPAUD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2,
      "toxicHours": [12],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 180,
      "minSlDist": 20,
      "maxSlDist": 40,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1.5,
      "forceCloseHours": 16,
      "riskPct": 0.04213242954868372
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2,
      "toxicHours": [12],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 0,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 30,
      "maxSlDist": 40,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 24,
      "riskPct": 0.023137743167806295
    }
  ],
  'NAS100': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [7],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 30,
      "maxSlDist": 250,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "riskPct": 0.04884575530539189
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [7],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 0,
      "orbMinutes": 45,
      "actionMinutes": 180,
      "minSlDist": 20,
      "maxSlDist": 180,
      "minBodyPips": 12,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "riskPct": 0.0059667443306268
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [7],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 0,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 180,
      "minSlDist": 30,
      "maxSlDist": 60,
      "minBodyPips": 10,
      "orbPullbackPct": 0.6,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.018813814080567315
    }
  ],
  'US30': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 30,
      "maxSlDist": 100,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1.5,
      "forceCloseHours": 12,
      "riskPct": 0.03284693802329223
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 120,
      "minSlDist": 20,
      "maxSlDist": 100,
      "minBodyPips": 12,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.008292212834831978
    }
  ]
};

// ============================================================
// SAGE OPTIMIZED CONFIGURATIONS
// ============================================================
export const SAGE_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'AUDUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.6,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 10,
      "maxSlDist": 30,
      "entryPenetrationPct": 20,
      "sweepPips": 2,
      "maxSweepMultiplier": 3,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.05922283482136437
    }
  ],
  'NZDUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicHours": [21],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 18,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 30,
      "minSlDist": 15,
      "maxSlDist": 50,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 2,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.044760727910346756
    }
  ],
  'USDCAD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.9,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 30,
      "actionMinutes": 15,
      "minSlDist": 15,
      "maxSlDist": 35,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 3,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.0899945356504839
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
      "orbMinutes": 30,
      "actionMinutes": 30,
      "minSlDist": 30,
      "maxSlDist": 80,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.05834811827347675
    }
  ],
  'NAS100': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [7],
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 10,
      "minSlDist": 70,
      "maxSlDist": 150,
      "entryPenetrationPct": 20,
      "sweepPips": 20,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 0.25,
      "trailingSlStep": 1,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.09316863440817524
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [7],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 10,
      "minSlDist": 120,
      "maxSlDist": 200,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 3,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.024548419290316054
    }
  ],
  'BTCUSD': [
    {
    "tickSize": 1,
    "pipSize": 10,
    "spread": 1.5,
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 30,
      "orbMinutes": 120,
      "actionMinutes": 10,
      "minSlDist": 100,
      "maxSlDist": 500,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 2,
      "requireCloseInside": false,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.05633100078035906
    }
  ],
  'EURUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 60,
      "actionMinutes": 10,
      "minSlDist": 15,
      "maxSlDist": 50,
      "entryPenetrationPct": 0,
      "sweepPips": 2,
      "maxSweepMultiplier": 3,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.016471193216468134
    }
  ],
  'GBPJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "toxicHours": [5, 6, 22, 23],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 18,
      "orbStartMin": 0,
      "orbMinutes": 120,
      "actionMinutes": 30,
      "minSlDist": 20,
      "maxSlDist": 80,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "riskPct": 0.03246373441222683
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
};;
