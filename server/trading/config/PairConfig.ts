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
  'USDJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "toxicDays": [2],
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
      "riskPct": 0.027698972307025307
    }
  ],
  'CHFJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "toxicHours": [10],
      "toxicDays": [5],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 20,
      "maxSlDist": 80,
      "minBodyPips": 4,
      "orbPullbackPct": 0.6,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "riskPct": 0.06406544705484067
    }
  ],
  'GBPJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "toxicHours": [5, 6],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 4,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 40,
      "minBodyPips": 4,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "riskPct": 0.034743770404400603
    }
  ],
  'US30': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.5,
      "toxicHours": [5, 6],
      "toxicDays": [2],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 180,
      "minSlDist": 50,
      "maxSlDist": 140,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1.5,
      "forceCloseHours": 16,
      "riskPct": 0.02853802242974913
    }
  ],
  'GER40': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "toxicHours": [6],
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 5,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 60,
      "minSlDist": 50,
      "maxSlDist": 250,
      "minBodyPips": 12,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1.5,
      "forceCloseHours": 24,
      "riskPct": 0.02690974003901637
    }
  ],
  'NAS100': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 30,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 180,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.03691250626333587
    }
  ],
  'GBPNZD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 2.5,
      "toxicDays": [4],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 8,
      "orbStartMin": 30,
      "orbMinutes": 15,
      "actionMinutes": 180,
      "minSlDist": 25,
      "maxSlDist": 30,
      "minBodyPips": 4,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.06053014921028829
    }
  ],
  'EURJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1,
      "toxicDays": [3],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 10,
      "actionMinutes": 60,
      "minSlDist": 15,
      "maxSlDist": 30,
      "minBodyPips": 4,
      "orbPullbackPct": 0.6,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1,
      "forceCloseHours": 24,
      "riskPct": 0.02692668018382969
    }
  ]
};

// ============================================================
// SAGE OPTIMIZED CONFIGURATIONS
// ============================================================
export const SAGE_PAIR_CONFIG: Record<string, PairConfig[]> = {
  'NZDUSD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 18,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 30,
      "minSlDist": 15,
      "maxSlDist": 80,
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
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.08195447146880581
    }
  ],
  'USDCHF': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 0.8,
      "toxicDays": [1],
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 20,
      "maxSlDist": 35,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.06027650885924126
    }
  ],
  'NAS100': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 0,
      "orbMinutes": 60,
      "actionMinutes": 10,
      "minSlDist": 120,
      "maxSlDist": 150,
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
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.03824322619257978
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
