// ============================================================
// OPTIMIZER PAIR CONFIG
// Base configurations required for backtesting and optimization
// ============================================================

import { BasePhysicalConfig } from "./types.js";

export const OPTIMIZER_CONFIG: Record<string, BasePhysicalConfig> = {
  AUDJPY: { tickSize: 0.001, pipSize: 0.01, spread: 1.2, maxSpreadLimit: 2.2 },
  AUDUSD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 0.6,
    maxSpreadLimit: 1.7,
  },
  "BTCUSD": {
    tickSize: 1,
    pipSize: 10.0,
    spread: 1.5,
    maxSpreadLimit: 2.33,
  }, 
  CADJPY: { tickSize: 0.001, pipSize: 0.01, spread: 1.4, maxSpreadLimit: 2.8 }, 
  CHFJPY: { tickSize: 0.001, pipSize: 0.01, spread: 1.6, maxSpreadLimit: 3.7 }, 
  "ETHUSD": {
    tickSize: 0.1,
    pipSize: 1.0,
    spread: 3.0,
    maxSpreadLimit: 4.5,
  },
  EURAUD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 2.3,
    maxSpreadLimit: 3.1,
  },
  EURCAD: { tickSize: 0.00001, pipSize: 0.0001, spread: 1.9, maxSpreadLimit: 4 },
  EURJPY: { tickSize: 0.001, pipSize: 0.01, spread: 1.0, maxSpreadLimit: 5.6 },
  EURNZD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 2.2,
    maxSpreadLimit: 3.1,
  },
  EURUSD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 0.5,
    maxSpreadLimit: 1.2,
  },
  GBPAUD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 2.0,
    maxSpreadLimit: 3,
  }, 
  GBPCAD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 2.2,
    maxSpreadLimit: 4.8,
  }, 
  GBPJPY: { tickSize: 0.001, pipSize: 0.01, spread: 1.6, maxSpreadLimit: 2.7 },
  GBPNZD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 2.5,
    maxSpreadLimit: 3,
  }, 
  GBPUSD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 1.3,
    maxSpreadLimit: 1.8,
  },
  "GER40": {
    tickSize: 0.1,
    pipSize: 1.0,
    spread: 1.0,
    maxSpreadLimit: 5.2,
  },
  "DAX40": {
    tickSize: 0.1,
    pipSize: 1.0,
    spread: 1.0,
    maxSpreadLimit: 5.2,
  },
  "DE40": {
    tickSize: 0.1,
    pipSize: 1.0,
    spread: 1.0,
    maxSpreadLimit: 5.2,
  }, 
  "JPN225": { tickSize: 1, pipSize: 1.0, spread: 10.0, maxSpreadLimit: 37 },
  "NAS100": {
    tickSize: 0.1,
    pipSize: 1.0,
    spread: 1.0,
    maxSpreadLimit: 3.1,
  },
  NZDUSD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 0.8,
    maxSpreadLimit: 1.8,
  },
  "SPX500": {
    tickSize: 0.1,
    pipSize: 1.0,
    spread: 1.4,
    maxSpreadLimit: 2.9,
  },
  "US30": {
    tickSize: 0.1,
    pipSize: 1.0,
    spread: 1.5,
    maxSpreadLimit: 8.1,
  }, 
  USDCAD: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 0.9,
    maxSpreadLimit: 2,
  },
  USDCHF: {
    tickSize: 0.00001,
    pipSize: 0.0001,
    spread: 0.8,
    maxSpreadLimit: 1.7,
  },
  USDJPY: { tickSize: 0.001, pipSize: 0.01, spread: 0.7, maxSpreadLimit: 2.4 },
  XAUUSD: {
    tickSize: 0.01,
    pipSize: 0.1,
    spread: 1.5,
    maxSpreadLimit: 3.1,
  },
  XTIUSD: { tickSize: 0.01, pipSize: 0.01, spread: 3.0, maxSpreadLimit: 15 }, 
};

export function getDynamicPipSize(symbol: string): number {
  const base = symbol.replace(".Daily", "").split("_")[0];
  if (OPTIMIZER_CONFIG[base]?.pipSize) return OPTIMIZER_CONFIG[base].pipSize;
  
  if (base.includes("BTC")) return 10;
  if (base.includes("ETH") || base.includes("NAS") || base.includes("US30") || base.includes("GER40") || base.includes("DAX40") || base.includes("DE40") || base.includes("SPX500") || base.includes("JPN225")) return 1.0;
  if (base.includes("XTIUSD") || base.includes("JPY")) return 0.01;
  if (base.includes("XAU")) return 0.1;
  return 0.0001;
}
