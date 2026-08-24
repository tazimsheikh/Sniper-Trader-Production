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
  const optConfig = OPTIMIZER_CONFIG[cleanSymbol] || OPTIMIZER_CONFIG[symbol];
  
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
    } else if (cleanSymbol.includes("US30") || cleanSymbol.includes("NAS") || cleanSymbol.includes("GER40") || cleanSymbol.includes("DAX40") || cleanSymbol.includes("DE40") || cleanSymbol.includes("SPX") || cleanSymbol.includes("JPN225")) {
      digits = 2;
      tickSize = 0.1;
      pipSize = 1.0;
    } else {
      digits = 5;
      tickSize = 0.00001;
      pipSize = 0.0001;
    }
  }

  const isJpy = cleanSymbol.includes("JPY");
  const isXauOrGer = cleanSymbol.includes("XAU") || cleanSymbol.includes("GOLD") || cleanSymbol.includes("GER40") || cleanSymbol.includes("DAX40") || cleanSymbol.includes("DE40") || cleanSymbol.includes("UK100") || cleanSymbol.includes("SPX500");
  const isNas = cleanSymbol.includes("NAS") || cleanSymbol.includes("US30") || cleanSymbol.includes("BTC") || cleanSymbol.includes("ETH");
  const pipValuePerLot = isJpy ? 6.5 : isXauOrGer ? 10 : isNas ? 1 : 10;

  return {
    pipSize,
    contractSize: 100000,
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
export async function getLiveBrokerSpec(symbol: string, _token?: string, _accountId?: string) {
  // Return sensible broker spec for lot sizing in the simulator
  const isJpy = symbol.includes("JPY");
  const isXauOrGer = symbol.includes("XAU") || symbol.includes("GOLD") || symbol.includes("GER40") || symbol.includes("DAX40") || symbol.includes("DE40") || symbol.includes("UK100") || symbol.includes("SPX500");
  const isNas = symbol.includes("NAS") || symbol.includes("US30") || symbol.includes("BTC") || symbol.includes("ETH");
  const pipValuePerLot = isJpy ? 6.5 : isXauOrGer ? 10 : isNas ? 1 : 10;
  return {
    tickSize: 0.00001,
    tickValue: 1,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    pipValuePerLot,
  };
}
export function quantizeLots(rawLots: number, volumeStep = 0.01, minVolume = 0.01, maxVolume = 100): number {
  const steps = Math.floor(rawLots / volumeStep + 1e-9);
  const stepped = steps * volumeStep;
  const clamped = Math.min(Math.max(stepped, minVolume), maxVolume);
  return Math.round(clamped * 1e8) / 1e8;
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
};

export function roundPrice(price: number, brokerSymbol: string): number {
  if (typeof brokerSymbol !== 'string') {
    return Number(price.toFixed(5));
  }
  const spec = getSymbolSpec(brokerSymbol);
  return Number(price.toFixed(spec.digits));
}
