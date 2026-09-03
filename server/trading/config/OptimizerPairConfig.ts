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
  "GER40.DAILY": { tickSize: 0.1, pipSize: 1.0, spread: 1.0, maxSpreadLimit: 5.2 },
  "JPN225.DAILY": { tickSize: 1, pipSize: 1.0, spread: 10.0, maxSpreadLimit: 37 },
  "NAS100.DAILY": { tickSize: 0.1, pipSize: 1.0, spread: 1.0, maxSpreadLimit: 3.1 },
  "SPX500.DAILY": { tickSize: 0.1, pipSize: 1.0, spread: 1.4, maxSpreadLimit: 2.9 },
  "US30.DAILY": { tickSize: 0.1, pipSize: 1.0, spread: 1.5, maxSpreadLimit: 8.1 },
  "BTCUSD.DAILY": { tickSize: 1, pipSize: 10.0, spread: 1.5, maxSpreadLimit: 2.33 },
  "ETHUSD.DAILY": { tickSize: 0.1, pipSize: 1.0, spread: 3.0, maxSpreadLimit: 4.5 },
};

export function getDynamicPipSize(symbol: string): number {
  const base = symbol.replace(/\.daily$/i, "").split("_")[0];
  return OPTIMIZER_CONFIG[symbol]?.pipSize || OPTIMIZER_CONFIG[base]?.pipSize || OPTIMIZER_CONFIG[base.toUpperCase()]?.pipSize || 0.0001;
}
