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
      "minSlDist": 8,
      "maxSlDist": 30,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 1,
      "forceCloseHours": 16,
      "riskPct": 0.011468672752380372
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicDays": [3, 5],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 0,
      "orbStartMin": 0,
      "orbMinutes": 45,
      "actionMinutes": 180,
      "minSlDist": 10,
      "maxSlDist": 120,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 16,
      "riskPct": 0.041287221908569344
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicDays": [2, 5],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 8,
      "maxSlDist": 70,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1,
      "forceCloseHours": 4,
      "riskPct": 0.03524030761448287
    }
  ],
  'USDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "toxicHours": [5],
      "toxicDays": [2, 4],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 30,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "riskPct": 0.01844989895947915
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
      "actionMinutes": 120,
      "minSlDist": 30,
      "maxSlDist": 80,
      "minBodyPips": 15,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "riskPct": 0.041287221908569344
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
      "actionMinutes": 120,
      "minSlDist": 20,
      "maxSlDist": 50,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 24,
      "riskPct": 0.03735657147668092
    }
  ],
  'EURUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicHours": [3],
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
      "riskPct": 0.041287221908569344
    }
  ],
  'AUDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.2,
      "toxicHours": [5, 7, 8, 9],
      "toxicDays": [1, 5],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 150,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 24,
      "riskPct": 0.041287221908569344
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.2,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 100,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1.5,
      "forceCloseHours": 8,
      "riskPct": 0.011468672752380372
    }
  ],
  'EURJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1,
      "toxicHours": [12, 15],
      "toxicDays": [3],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 20,
      "maxSlDist": 100,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.03399017051342407
    }
  ],
  'GBPUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 1.3,
      "toxicHours": [7],
      "toxicDays": [4],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 12.5,
      "maxSlDist": 60,
      "minBodyPips": 5,
      "orbPullbackPct": 0.6,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.041287221908569344
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
      "riskPct": 0.011468672752380372
    }
  ]
};

// ============================================================
// SAGE OPTIMIZED CONFIGURATIONS
// ============================================================
export const SAGE_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'EURNZD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2.2,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 120,
      "actionMinutes": 15,
      "minSlDist": 50,
      "maxSlDist": 100,
      "entryPenetrationPct": 0,
      "sweepPips": 30,
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
      "riskPct": 0.03531441845066892
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2.2,
      "toxicHours": [7],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 120,
      "actionMinutes": 30,
      "minSlDist": 40,
      "maxSlDist": 60,
      "entryPenetrationPct": 0,
      "sweepPips": 30,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.018080317352138994
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
      "riskPct": 0.011468672752380372
    }
  ],
  'XAUUSD': [
    {
    "tickSize": 0.01,
    "pipSize": 0.1,
    "spread": 1.5,
      "toxicHours": [14],
      "toxicDays": [2],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 120,
      "actionMinutes": 10,
      "minSlDist": 40,
      "maxSlDist": 160,
      "entryPenetrationPct": 0,
      "sweepPips": 7,
      "maxSweepMultiplier": 2,
      "requireCloseInside": false,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.011468672752380372
    }
  ],
  'EURUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicDays": [1],
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.75,
      "riskPct": 0.020384045696929688
    },
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.5,
      "toxicHours": [6],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 60,
      "actionMinutes": 10,
      "minSlDist": 15,
      "maxSlDist": 30,
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
      "riskPct": 0.011468672752380372
    },
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.75,
      "riskPct": 0.020906407653858292
    }
  ],
  'AUDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.2,
      "toxicDays": [4],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 2,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 15,
      "minSlDist": 20,
      "maxSlDist": 60,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.014365771265178729
    }
  ],
  'EURJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1,
      "toxicHours": [5, 6],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 30,
      "maxSlDist": 100,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 3,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.011468672752380372
    }
  ],
  'USDCHF': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 30,
      "orbMinutes": 120,
      "actionMinutes": 10,
      "minSlDist": 30,
      "maxSlDist": 35,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.011468672752380372
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
      "orbMinutes": 60,
      "actionMinutes": 30,
      "minSlDist": 20,
      "maxSlDist": 35,
      "entryPenetrationPct": 20,
      "sweepPips": 2,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": true,
      "minWbr": 1.5,
      "riskPct": 0.02782508135756422
    }
  ],
  'GBPAUD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 2,
      "orbStartMin": 0,
      "orbMinutes": 120,
      "actionMinutes": 30,
      "minSlDist": 50,
      "maxSlDist": 100,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.011468672752380372
    }
  ]
};

// ============================================================
// SEER OPTIMIZED CONFIGURATIONS
// ============================================================
export const SEER_PAIR_CONFIG: Record<string, PairConfig[]> = {
  "EURJPY": [
    {
        "toxicHours": [4],
      "toxicDays": [3],
      "session": "london",
        "minBodyPips": 8,
        "pinBarWickBodyRatio": 1.2,
        "minSlDist": 40,
        "maxSlDist": 60,
        "trailingSlTrigger": 0.5,
        "trailingSlStep": 0.5,
        "forceCloseHours": 12,
        "exitMode": "TRAILING",
        "spread": 1,
        "pipSize": 0.01,
        "tickSize": 0.001,
        "riskPct": 0.011468672752380372
    }
  ],
  "GER40": [
    {
        "toxicHours": [11],
      "toxicDays": [3],
      "session": "ny",
        "minBodyPips": 20,
        "pinBarWickBodyRatio": 2,
        "minSlDist": 50,
        "maxSlDist": 100,
        "trailingSlTrigger": 0.5,
        "trailingSlStep": 0.5,
        "forceCloseHours": 8,
        "exitMode": "TRAILING",
        "spread": 1,
        "pipSize": 1,
        "tickSize": 0.1,
        "riskPct": 0.041287221908569344
    }
  ],
  "NAS100": [
    {
        "session": "ny",
        "minBodyPips": 30,
        "pinBarWickBodyRatio": 1.2,
        "minSlDist": 100,
        "maxSlDist": 140,
        "trailingSlTrigger": 0.5,
        "trailingSlStep": 0.5,
        "forceCloseHours": 8,
        "exitMode": "TRAILING",
        "spread": 1,
        "pipSize": 1,
        "tickSize": 0.1,
        "riskPct": 0.011468672752380372
    },
    {
        "session": "ny",
        "minBodyPips": 30,
        "pinBarWickBodyRatio": 1.2,
        "minSlDist": 100,
        "maxSlDist": 180,
        "trailingSlTrigger": 0.5,
        "trailingSlStep": 0.5,
        "forceCloseHours": 16,
        "exitMode": "TRAILING",
        "spread": 1,
        "pipSize": 1,
        "tickSize": 0.1,
        "riskPct": 0.011468672752380372
    },
    {
        "session": "ny",
        "minBodyPips": 30,
        "pinBarWickBodyRatio": 1.2,
        "minSlDist": 100,
        "maxSlDist": 200,
        "trailingSlTrigger": 0.5,
        "trailingSlStep": 0.5,
        "forceCloseHours": 16,
        "exitMode": "TRAILING",
        "spread": 1,
        "pipSize": 1,
        "tickSize": 0.1,
        "riskPct": 0.011468672752380372
    },
    {
        "session": "ny",
        "minBodyPips": 30,
        "pinBarWickBodyRatio": 1.2,
        "minSlDist": 100,
        "maxSlDist": 180,
        "trailingSlTrigger": 0.5,
        "trailingSlStep": 0.5,
        "forceCloseHours": 24,
        "exitMode": "TRAILING",
        "spread": 1,
        "pipSize": 1,
        "tickSize": 0.1,
        "riskPct": 0.011468672752380372
    }
  ],
  "XAUUSD": [
    {
        "toxicHours": [2],
      "toxicDays": [2],
      "session": "london",
        "minBodyPips": 35,
        "pinBarWickBodyRatio": 1.2,
        "minSlDist": 15,
        "maxSlDist": 120,
        "trailingSlTrigger": 0.5,
        "trailingSlStep": 0.5,
        "forceCloseHours": 12,
        "exitMode": "TRAILING",
        "spread": 1.5,
        "pipSize": 0.1,
        "tickSize": 0.01,
        "riskPct": 0.011468672752380372
    }
  ],
  "XTIUSD": [
    {
        "toxicDays": [2],
      "session": "asia",
        "minBodyPips": 25,
        "pinBarWickBodyRatio": 2,
        "minSlDist": 20,
        "maxSlDist": 40,
        "trailingSlTrigger": 0.5,
        "trailingSlStep": 0.5,
        "forceCloseHours": 16,
        "exitMode": "TRAILING",
        "spread": 3,
        "pipSize": 0.01,
        "tickSize": 0.01,
        "riskPct": 0.034218203076331756
    }
  ]
};
