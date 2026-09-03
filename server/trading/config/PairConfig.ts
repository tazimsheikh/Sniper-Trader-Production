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
  'GBPJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "toxicDays": [3],
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 180,
      "minSlDist": 25,
      "maxSlDist": 50,
      "minBodyPips": 4,
      "orbPullbackPct": 0.15,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 1.5,
      "forceCloseHours": 24,
      "riskPct": 0.019681275696016316
    }
  ],
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
      "actionMinutes": 180,
      "minSlDist": 15,
      "maxSlDist": 350,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 3,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "riskPct": 0.036886126842183335
    }
  ],
  'SPX500.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.4,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 7,
      "maxSlDist": 80,
      "minBodyPips": 5,
      "orbPullbackPct": 0.3,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1,
      "trailingSlStep": 1.5,
      "forceCloseHours": 24,
      "riskPct": 0.023658422130492386
    },
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.4,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 0,
      "orbMinutes": 10,
      "actionMinutes": 120,
      "minSlDist": 5,
      "maxSlDist": 40,
      "minBodyPips": 5,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 2,
      "forceCloseHours": 24,
      "riskPct": 0.012031254291534423
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
      "maxSlDist": 200,
      "minBodyPips": 15,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1.5,
      "forceCloseHours": 24,
      "riskPct": 0.014678040412387692
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
      "minSlDist": 50,
      "maxSlDist": 140,
      "minBodyPips": 10,
      "orbPullbackPct": 0,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 2,
      "forceCloseHours": 16,
      "riskPct": 0.012031254291534423
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
      "orbStartMin": 30,
      "orbMinutes": 120,
      "actionMinutes": 60,
      "minSlDist": 70,
      "maxSlDist": 100,
      "entryPenetrationPct": 0,
      "sweepPips": 30,
      "maxSweepMultiplier": 3,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.04331251544952393
    }
  ],
  'NAS100.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 20,
      "orbStartMin": 45,
      "orbMinutes": 60,
      "actionMinutes": 30,
      "minSlDist": 120,
      "maxSlDist": 200,
      "entryPenetrationPct": 20,
      "sweepPips": 5,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 0.25,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.013871661856131801
    },
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": true,
      "minWbr": 1.5,
      "riskPct": 0.012031254291534423
    }
  ],
  'SPX500.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1.4,
      "session": "NY_Indices",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 30,
      "maxSlDist": 40,
      "entryPenetrationPct": 0.2,
      "sweepPips": 10,
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
      "riskPct": 0.03549295399820004
    }
  ],
  'XAUUSD': [
    {
    "tickSize": 0.01,
    "pipSize": 0.1,
    "spread": 1.5,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 10,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 30,
      "minSlDist": 30,
      "maxSlDist": 80,
      "entryPenetrationPct": 20,
      "sweepPips": 10,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 0.5,
      "trailingSlStep": 1,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.02639692764191647
    }
  ],
  'GER40.DAILY': [
    {
    "tickSize": 0.1,
    "pipSize": 1,
    "spread": 1,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 15,
      "orbMinutes": 60,
      "actionMinutes": 5,
      "minSlDist": 10,
      "maxSlDist": 200,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 2,
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
      "riskPct": 0.02935134271905256
    },
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.04331251544952393
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
      "riskPct": 0.024396156238764642
    }
  ],
  'US30.DAILY': [
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.01445635029614837
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.75,
      "riskPct": 0.021908116985867844
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
      "orbStartMin": 15,
      "orbMinutes": 30,
      "actionMinutes": 10,
      "minSlDist": 10,
      "maxSlDist": 80,
      "entryPenetrationPct": 20,
      "sweepPips": 3,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 1,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.02824387799726233
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
      "riskPct": 0.012861599428414437
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.025288100606956933
    },
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 0.7,
      "session": "asia",
      "orbEnabled": true,
      "orbStartHour": 21,
      "orbStartMin": 0,
      "orbMinutes": 30,
      "actionMinutes": 15,
      "minSlDist": 30,
      "maxSlDist": 50,
      "entryPenetrationPct": 20,
      "sweepPips": 5,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "MIDPOINT",
      "trailingSlTrigger": 1,
      "trailingSlStep": 2,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.012031254291534423
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
      "maxSlDist": 80,
      "entryPenetrationPct": 0,
      "sweepPips": 3,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": false,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 12,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.012031254291534423
    }
  ],
  'CHFJPY': [
    {
    "tickSize": 0.001,
    "pipSize": 0.01,
    "spread": 1.6,
      "session": "london",
      "orbEnabled": true,
      "orbStartHour": 3,
      "orbStartMin": 0,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 40,
      "maxSlDist": 60,
      "entryPenetrationPct": 0,
      "sweepPips": 10,
      "maxSweepMultiplier": 2,
      "requireCloseInside": true,
      "exitMode": "OPPOSITE_BOUNDARY",
      "trailingSlTrigger": 1.5,
      "trailingSlStep": 2,
      "forceCloseHours": 8,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.75,
      "riskPct": 0.022881565387888294
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": false,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.023456693934649914
    }
  ],
  'EURCAD': [
    {
    "tickSize": 0.00001,
    "pipSize": 0.0001,
    "spread": 1.9,
      "session": "NY_Forex",
      "orbEnabled": true,
      "orbStartHour": 9,
      "orbStartMin": 45,
      "orbMinutes": 15,
      "actionMinutes": 15,
      "minSlDist": 40,
      "maxSlDist": 100,
      "entryPenetrationPct": 20,
      "sweepPips": 10,
      "maxSweepMultiplier": 1.5,
      "requireCloseInside": true,
      "exitMode": "TRAILING",
      "trailingSlTrigger": 2,
      "trailingSlStep": 0.5,
      "forceCloseHours": 16,
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.023128354761900526
    }
  ],
  'EURAUD': [
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
      "htfAlignmentRequired": true,
      "maxH1EmaSlope": 20,
      "useHtfSarFilter": true,
      "requireCloseLocationHalf": false,
      "minWbr": 1.5,
      "riskPct": 0.012031254291534423
    }
  ]
};

// ============================================================
// SEER OPTIMIZED CONFIGURATIONS
// ============================================================
export const SEER_PAIR_CONFIG: Record<string, PairConfig[]> = {
  "GER40.DAILY": [
    {
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
        "spread": 1,
        "pipSize": 1,
        "tickSize": 0.1,
        "riskPct": 0.04331251544952393
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
        "riskPct": 0.03085207080235585
    }
  ]
};
