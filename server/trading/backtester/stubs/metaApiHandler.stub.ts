// ── METAAPI HANDLER STUB ──
import { MockBrokerAccount } from "./MockBrokerAccount.js";

declare global {
  var __SIM_MOCK_ACCOUNT__: MockBrokerAccount | undefined;
}

export function getSharedConnection(_token: string, _accountId: string) {
  return {
    getAccountInformation: async () => ({
      balance: 100000,
      equity: 100000,
      margin: 0,
      freeMargin: 100000,
    }),
    getPositions: async () => {
      // Return positions from MockBrokerAccount in MetaAPI format so
      // SageEngine's fallback fill poller can detect filled orders and
      // correctly populate state.activeTrades[].
      const mock = global.__SIM_MOCK_ACCOUNT__;
      if (!mock) return [];
      return Array.from(mock.positions.values()).map((p: any) => ({
        id: p.id,
        symbol: p.symbol,
        type: p.type === 'POSITION_TYPE_BUY' ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL',
        openPrice: p.openPrice,
        volume: p.volume,
        stopLoss: p.sl,
        takeProfit: p.tp,
        time: p.time,
        // Pass through the actual magic number from the position.
        // Fallback to 200000000 ONLY if undefined (for legacy compat)
        magic: p.magic !== undefined ? p.magic : 200000000,
      }));
    },
    getSymbolPrice: async (sym: string) =>
      global.__SIM_MOCK_ACCOUNT__?.getSymbolPrice(sym) || {
        bid: 100,
        ask: 100,
      },
    getSymbolSpecification: async (sym: string) => {
      return {
        tickSize: 0.00001,
        tickValue: 1,
        contractSize: 100000,
        minVolume: 0.01,
        maxVolume: 100,
        volumeStep: 0.01
      };
    },
    modifyPosition: async (id: string, arg2: any, arg3?: any) =>
      global.__SIM_MOCK_ACCOUNT__?.modifyPosition(
        id,
        typeof arg2 === "object" ? arg2.stopLoss : arg2,
        typeof arg2 === "object" ? arg2.takeProfit : arg3,
      ),
    closePosition: async (id: string) =>
      global.__SIM_MOCK_ACCOUNT__?.closePosition(id),
    closePositionPartially: async (id: string, vol: number) =>
      global.__SIM_MOCK_ACCOUNT__?.closePositionPartially(id, vol, {}),
    createMarketBuyOrder: async (
      sym: string,
      lots: number,
      sl: number,
      tp: number,
      opts?: any,
    ) => global.__SIM_MOCK_ACCOUNT__?.createMarketBuyOrder(sym, lots, sl, tp, opts),
    createMarketSellOrder: async (
      sym: string,
      lots: number,
      sl: number,
      tp: number,
      opts?: any,
    ) => global.__SIM_MOCK_ACCOUNT__?.createMarketSellOrder(sym, lots, sl, tp, opts),
    createLimitBuyOrder: async (
      sym: string,
      lots: number,
      price: number,
      sl: number,
      tp: number,
      opts?: any,
    ) =>
      global.__SIM_MOCK_ACCOUNT__?.createLimitBuyOrder(
        sym,
        lots,
        price,
        sl,
        tp,
        opts,
      ),
    createLimitSellOrder: async (
      sym: string,
      lots: number,
      price: number,
      sl: number,
      tp: number,
      opts?: any,
    ) =>
      global.__SIM_MOCK_ACCOUNT__?.createLimitSellOrder(
        sym,
        lots,
        price,
        sl,
        tp,
        opts,
      ),
    // Intercepts createLimitOrder calls from engines. clientId is now a short hash (M_<12chars>_<timestamp>).
    // Strip the _<timestamp> suffix so it matches the signature hash lookup in LiveOrchestrator.
    createLimitOrder: async (
      _accId: string,
      sym: string,
      type: string,
      lots: number,
      price: number,
      opts: { stopLoss: number; takeProfit: number; clientId?: string; botId?: string; orHigh?: number; orLow?: number },
    ) => {
      // Strip the _<timestamp> suffix that MageEngine appends: "SIG_NY_Forex_0_1234567890" → "SIG_NY_Forex_0"
      const rawClientId = (opts as any).clientId as string | undefined;
      const clientId = rawClientId ? rawClientId.replace(/_\d+$/, '') : undefined;
      if (type === "ORDER_TYPE_BUY_LIMIT") {
        return global.__SIM_MOCK_ACCOUNT__?.createLimitBuyOrder(
          sym, lots, price, opts.stopLoss, opts.takeProfit, { clientId }
        );
      } else if (type === "ORDER_TYPE_SELL_LIMIT") {
        return global.__SIM_MOCK_ACCOUNT__?.createLimitSellOrder(
          sym, lots, price, opts.stopLoss, opts.takeProfit, { clientId }
        );
      } else if (type === "ORDER_TYPE_BUY_STOP") {
        return global.__SIM_MOCK_ACCOUNT__?.createStopBuyOrder(
          sym, lots, price, opts.stopLoss, opts.takeProfit, { clientId }
        );
      } else if (type === "ORDER_TYPE_SELL_STOP") {
        return global.__SIM_MOCK_ACCOUNT__?.createStopSellOrder(
          sym, lots, price, opts.stopLoss, opts.takeProfit, { clientId }
        );
      } else {
        return global.__SIM_MOCK_ACCOUNT__?.createLimitSellOrder(
          sym, lots, price, opts.stopLoss, opts.takeProfit, { clientId }
        );
      }
    },
    cancelOrder: async (id: string) =>
      global.__SIM_MOCK_ACCOUNT__?.cancelOrder(id),
  };
}
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";

export function getSharedAccount(_token: string, _accountId: string) {
  return null;
}

export function getSymbolSpec(symbol: string) {
  if (!symbol || typeof symbol !== "string") {
    return {
      pipSize: 0.0001,
      contractSize: 100000,
      digits: 5,
      tickSize: 0.00001,
      stopsLevel: 0,
      minVolume: 0.01,
      maxVolume: 100,
      volumeStep: 0.01,
      pipValuePerLot: 10,
    };
  }
  const cleanSymbol = symbol
    .replace(".Daily", "")
    .replace(/_[0-9]+$/, "")
    .replace("=X", "")
    .replace("=F", "");
  const INDEX_ALIASES: Record<string, string> = {
    SP500: "SPX500",
    US500: "SPX500",
    SPX: "SPX500",
    US30: "US30",
    DJ30: "US30",
    WS30: "US30",
    DOW30: "US30",
    NAS100: "NAS100",
    US100: "NAS100",
    USTEC: "NAS100",
    NDX: "NAS100",
    GER40: "GER40",
    DAX40: "GER40",
    DE40: "GER40",
    GER30: "GER40",
    DE30: "GER40",
    JPN225: "JPN225",
    JP225: "JPN225",
    UK100: "UK100",
    FTSE100: "UK100",
    GOLD: "XAUUSD",
    USOIL: "XTIUSD",
    WTI: "XTIUSD",
  };

  const canonicalSymbol = INDEX_ALIASES[cleanSymbol] || cleanSymbol.split("_")[0].split(".")[0];
  const optConfig = OPTIMIZER_CONFIG[canonicalSymbol] || OPTIMIZER_CONFIG[cleanSymbol] || OPTIMIZER_CONFIG[symbol];
  
  let digits = 5;
  let tickSize = 0.00001;
  let pipSize = 0.0001;

  if (optConfig) {
    tickSize = optConfig.tickSize ?? 0.00001;
    const tickStr = tickSize.toString();
    digits = tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
    pipSize = optConfig.pipSize ?? 0.0001;
  } else {
    if (cleanSymbol.includes("JPY")) {
      digits = 3;
      tickSize = 0.001;
      pipSize = 0.01;
    } else if (cleanSymbol.includes("XAU") || cleanSymbol.includes("GOLD") || cleanSymbol.includes("XTI") || cleanSymbol.includes("OIL") || cleanSymbol.includes("BTC") || cleanSymbol.includes("ETH")) {
      digits = 2;
      tickSize = 0.01;
      pipSize = cleanSymbol.includes("XAU") || cleanSymbol.includes("GOLD") ? 0.1 : 0.01;
    } else if (
      cleanSymbol.includes("US30") ||
      cleanSymbol.includes("DJ") ||
      cleanSymbol.includes("WS") ||
      cleanSymbol.includes("DOW") ||
      cleanSymbol.includes("NAS") ||
      cleanSymbol.includes("USTEC") ||
      cleanSymbol.includes("NDX") ||
      cleanSymbol.includes("GER") ||
      cleanSymbol.includes("DAX") ||
      cleanSymbol.includes("DE40") ||
      cleanSymbol.includes("DE30") ||
      cleanSymbol.includes("SPX") ||
      cleanSymbol.includes("SP500") ||
      cleanSymbol.includes("US500") ||
      cleanSymbol.includes("JPN") ||
      cleanSymbol.includes("JP225") ||
      cleanSymbol.includes("NIKKEI") ||
      cleanSymbol.includes("UK100") ||
      cleanSymbol.includes("FTSE")
    ) {
      digits = 2;
      tickSize = 0.1;
      pipSize = 1.0;
    } else {
      digits = 5;
      tickSize = 0.00001;
      pipSize = 0.0001;
    }
  }

  const pipValuePerLot = getFallbackPipValue(cleanSymbol);

  return {
    pipSize,
    contractSize: cleanSymbol.includes("XAU") ? 100 : (cleanSymbol.includes("US30") || cleanSymbol.includes("NAS") || cleanSymbol.includes("GER") || cleanSymbol.includes("SPX") ? 1 : 100000),
    digits,
    tickSize,
    stopsLevel: 0,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    pipValuePerLot,
  };
}
export function safeDecryptAccountId(id: string | undefined) {
  return id || "SIM_ACCOUNT";
}
export function getBrokerSymbol(
  symbol: string,
  customMap?: Record<string, string> | null,
): string {
  const clean = symbol.replace(/_[0-9]+$/, "").replace("=X", "").replace("=F", "");
  if (customMap && customMap[clean]) {
    return customMap[clean];
  }
  if (customMap && customMap[symbol]) {
    return customMap[symbol];
  }
  return clean;
}
export function clearSharedConnection(_token: string, _accountId: string) {}
export function forceRebootMetaApi(_token: string, _accountId: string) {}

export function getFallbackPipValue(brokerSymbol: string, referencePrice?: number): number {
  if (!brokerSymbol || typeof brokerSymbol !== "string") return 10.0;
  const clean = brokerSymbol
    .replace(".Daily", "")
    .replace(/_[0-9]+$/, "")
    .replace("=X", "")
    .replace("=F", "")
    .toUpperCase();

  // 1. Major US Indices & Equities (1 point = $1.00 per standard 1.0 contract lot)
  if (
    clean.includes("US30") ||
    clean.includes("DJ30") ||
    clean.includes("WS30") ||
    clean.includes("DOW30") ||
    clean.includes("DOW") ||
    clean.includes("NAS100") ||
    clean.includes("USTEC") ||
    clean.includes("NDX") ||
    clean.includes("SPX500") ||
    clean.includes("SP500") ||
    clean.includes("US500") ||
    clean.includes("BTC") ||
    clean.includes("ETH")
  ) {
    return 1.0;
  }

  // 2. European Indices (GER40 / DAX40 / DE40 / UK100)
  if (
    clean.includes("GER") ||
    clean.includes("DAX") ||
    clean.includes("DE40") ||
    clean.includes("DE30") ||
    clean.includes("UK100") ||
    clean.includes("FTSE")
  ) {
    return 1.10;
  }

  // 3. Asian Indices (JPN225 / NIKKEI)
  if (clean.includes("JPN") || clean.includes("JP225") || clean.includes("NIKKEI")) {
    return 0.65;
  }

  // 4. Commodities: Gold (XAUUSD)
  if (clean.includes("XAU") || clean.includes("GOLD")) {
    return 10.0;
  }

  // 5. Commodities: Crude Oil (XTIUSD / WTI / USOIL)
  if (clean.includes("XTI") || clean.includes("OIL") || clean.includes("USOIL") || clean.includes("WTI")) {
    return 10.0;
  }

  // 6. Forex Pairs - JPY Crosses (USDJPY, AUDJPY, GBPJPY, EURJPY, CADJPY, CHFJPY)
  if (clean.includes("JPY")) {
    if (referencePrice && referencePrice > 50 && clean.startsWith("USD")) {
      return 1000.0 / referencePrice;
    }
    return 6.45;
  }

  // 7. Forex Pairs - CHF Quote (USDCHF, EURCHF, GBPCHF)
  if (clean.endsWith("CHF") || clean === "USDCHF") {
    if (referencePrice && referencePrice > 0.5 && referencePrice < 2.0 && clean.startsWith("USD")) {
      return 10.0 / referencePrice;
    }
    return 12.35;
  }

  // 8. Forex Pairs - CAD Quote (USDCAD, EURCAD, GBPCAD, AUDCAD, NZDCAD)
  if (clean.endsWith("CAD") || clean === "USDCAD") {
    if (referencePrice && referencePrice > 0.9 && referencePrice < 2.5 && clean.startsWith("USD")) {
      return 10.0 / referencePrice;
    }
    return 7.17;
  }

  // 9. Forex Pairs - NZD Quote (EURNZD, GBPNZD, AUDNZD)
  if (clean.endsWith("NZD")) {
    return 6.00;
  }

  // 10. Forex Pairs - AUD Quote (EURAUD, GBPAUD)
  if (clean.endsWith("AUD")) {
    return 6.60;
  }

  // 11. Forex Pairs - GBP Quote (EURGBP)
  if (clean.endsWith("GBP")) {
    return 13.00;
  }

  // 12. Forex Majors with USD Quote (EURUSD, GBPUSD, AUDUSD, NZDUSD)
  return 10.0;
}

export async function getLiveBrokerSpec(symbol: string, _token?: string, _accountId?: string) {
  const pipValuePerLot = getFallbackPipValue(symbol);
  return {
    tickSize: 0.00001,
    tickValue: 1,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    pipValuePerLot,
    stopsLevel: 0,
    digits: 5
  };
}
export function quantizeLots(rawLots: number, volumeStep = 0.01, minVolume = 0.01, maxVolume = 100): number {
  const steps = Math.floor(rawLots / volumeStep + 1e-9);
  const stepped = steps * volumeStep;
  const clamped = Math.min(Math.max(stepped, minVolume), maxVolume);
  return Math.round(clamped * 1e8) / 1e8;
}
export function calculateStopsLevelSafePrices(
  direction: "BUY" | "SELL",
  currentPrice: number,
  rawSl: number,
  rawTp: number,
  stopsLevelPoints: number = 0,
  tickSize: number = 0.00001,
  digits: number = 5,
  isFallback: boolean = false
): { pSl: number; pTp: number } {
  const extraBuffer = isFallback ? tickSize * 25 : 0;
  const minStopDist = Math.max((stopsLevelPoints + 10) * tickSize + extraBuffer, tickSize * 10 + extraBuffer);
  let finalSl = Number.isFinite(rawSl) ? rawSl : (direction === "BUY" ? currentPrice - minStopDist : currentPrice + minStopDist);
  let finalTp = Number.isFinite(rawTp) ? rawTp : 0;

  if (direction === "BUY") {
    if (currentPrice - finalSl < minStopDist) {
      finalSl = currentPrice - minStopDist;
    }
    if (finalTp > 0 && finalTp - currentPrice < minStopDist) {
      finalTp = currentPrice + minStopDist;
    }
  } else {
    if (finalSl - currentPrice < minStopDist) {
      finalSl = currentPrice + minStopDist;
    }
    if (finalTp > 0 && currentPrice - finalTp < minStopDist) {
      finalTp = currentPrice - minStopDist;
    }
  }

  return {
    pSl: Number.isFinite(finalSl) && finalSl > 0 ? Number(finalSl.toFixed(digits)) : 0,
    pTp: Number.isFinite(finalTp) && finalTp > 0 ? Number(finalTp.toFixed(digits)) : 0,
  };
}

export default {
  getSharedConnection,
  getSharedAccount,
  getSymbolSpec,
  safeDecryptAccountId,
  getBrokerSymbol,
  clearSharedConnection,
  forceRebootMetaApi,
  getLiveBrokerSpec,
  quantizeLots,
  calculateStopsLevelSafePrices,
  roundPrice,
};

export function roundPrice(price: number, brokerSymbol: string): number {
  if (typeof brokerSymbol !== 'string') {
    return Number(price.toFixed(5));
  }
  const spec = getSymbolSpec(brokerSymbol);
  return Number(price.toFixed(spec.digits));
}
