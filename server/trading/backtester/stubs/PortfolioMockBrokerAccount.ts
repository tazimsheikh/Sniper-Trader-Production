// ============================================================
// STUB: MockBrokerAccount.ts
// Intercepts all MetaAPI calls and simulates trade fills,
// trailing stops, and closures using M1 OHLC data.
// ============================================================
import { isNewsForceClose } from '../../market/historicalNews.js';
import { getShortHash } from './crypto.stub.js';
import { OPTIMIZER_CONFIG } from '../../config/OptimizerPairConfig.js';

export interface SimPosition {
  id: string;
  symbol: string;
  type: 'POSITION_TYPE_BUY' | 'POSITION_TYPE_SELL';
  openPrice: number;
  intendedEntryPrice?: number;
  sl: number;
  originalSl: number;
  tp: number;
  volume: number;
  time: string;
  magic?: number;
  botId?: string;
  clientId?: string;
  originalLimitPrice?: number;
  orHigh?: number;
  orLow?: number;
  limitPlacedAt?: number;
  trailLog?: { time: number; sl: number }[];
}

export interface PendingLimitOrder {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'STOP';
  limitPrice: number;
  sl: number;
  tp: number;
  volume: number;
  placedAt: number;
  // clientId (sig) stored for Sage stop orders so checkPendingOrderFills
  // can populate state.activeTrades[] directly at fill time, bypassing the
  // checkSageLimitFill poller which breaks when ss.limitOrderId is  botId?: string;
  clientId?: string;
  orHigh?: number;
  orLow?: number;
  limitPlacedAt?: number;
  magic?: number;
  botId?: string;
}

export interface TradeRecord {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  slPrice: number;
  originalSl?: number;
  tpPrice: number;
  outcome: 'SL' | 'EOD' | 'EOD_CLOSE' | 'TP' | 'NEWS_CLOSE';
  rMultiple: number;
  openTime: number;
  closeTime: number;
  magic?: number;
  botId?: string;
  clientId?: string;
  orHigh?: number;
  orLow?: number;
  limitPlacedAt?: number;
  trailLog?: { time: number; sl: number }[];
}

export class PortfolioMockBrokerAccount {
  positions: Map<string, SimPosition> = new Map();
  pendingOrders: Map<string, PendingLimitOrder> = new Map();
  tradeLog: TradeRecord[] = [];

  private currentCandles: Map<string, any> = new Map();
  private spreads: Map<string, number> = new Map();
  private pipSizes: Map<string, number> = new Map();
  private spreadPtsMap: Map<string, number> = new Map();
  private orderId = 1;
  private simulatedTime: Date = new Date();
  private lastEstHours: Map<string, number> = new Map();

  constructor() {}

  registerSymbol(symbol: string, spread: number, pipSize: number) {
    this.spreads.set(symbol, spread);
    this.pipSizes.set(symbol, pipSize);
    this.spreadPtsMap.set(symbol, spread * pipSize);
  }

  private getAdverseSlippagePts(symbol: string): number {
    const points = (global as any).__SIM_SLIPPAGE_POINTS__ || 0;
    if (points <= 0) return 0;
    const cleanSym = symbol.split('.')[0];
    const opt = OPTIMIZER_CONFIG[cleanSym];
    if (opt && opt.tickSize) {
      return points * opt.tickSize;
    }
    const pipSize = this.pipSizes.get(symbol) || 0.0001;
    return (points / 10) * pipSize;
  }

  /** Called before each M1 tick is fed to the orchestrator */
  setCurrentCandle(symbol: string, o: number, h: number, l: number, c: number, ts: number, estHour: number, estMin: number) {
    const lastEstHour = this.lastEstHours.get(symbol) || -1;
    const isSessionReset = lastEstHour !== -1 && ((lastEstHour < 17 && estHour >= 17) || (lastEstHour > estHour && estHour >= 17));
    this.currentCandles.set(symbol, { open: o, high: h, low: l, close: c, timestamp: ts, estHour, estMin, isSessionReset });
    this.simulatedTime = new Date(ts);
    this.lastEstHours.set(symbol, estHour);
  }

  private deduceBotId(opts?: any): string {
    if (opts?.botId) return opts.botId;
    const cid = opts?.clientId as string | undefined;
    if (cid) {
      const upperCid = cid.toUpperCase();
      if (upperCid.startsWith("S_") || upperCid.startsWith("SAGE_") || upperCid.includes("_SAGE_") || upperCid.includes("_S_")) return "sage";
      if (upperCid.startsWith("SRC_") || upperCid.startsWith("SEER_") || upperCid.includes("_SEER_") || upperCid.includes("_SRC_")) return "seer";
      if (upperCid.startsWith("M_") || upperCid.startsWith("MAGE_") || upperCid.includes("_MAGE_") || upperCid.includes("_M_")) return "mage";
    }
    return "mage";
  }

  private resolveSageKey(orchestratorState: any, clientId?: string): string | null {
    if (!clientId || !orchestratorState?.sageStates) return null;
    if (orchestratorState.sageStates[clientId]) return clientId;
    
    const parts = clientId.split('_');
    for (const part of parts) {
      if (part === "P0" || part === "Psimulator" || (part.startsWith("P") && part.length <= 4) || part === "S" || part === "M" || part === "SRC") continue;
      for (const key of Object.keys(orchestratorState.sageStates)) {
        if (getShortHash(key) === part || key.includes(part)) {
          return key;
        }
      }
    }
    return null;
  }

  getCurrentSimulatedTime(): Date {
    return this.simulatedTime;
  }

  private getOrchState(opts?: any): any {
    if (opts?.orchState) return opts.orchState;
    const orch = (global as any).__SIM_ORCH__;
    if (orch && opts?.clientId) {
      const clientId = opts.clientId as string;
      for (const [sp, state] of orch.states.entries()) {
        if (clientId.includes(sp) || clientId.startsWith(sp)) {
          return state;
        }
      }
    }
    return (global as any).__SIM_ORCH_STATE__;
  }

  // ── MetaAPI Interface Stubs ──

  async createLimitBuyOrder(symbol: string, lots: number, price: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    if (symbol.includes("XTIUSD")) console.log(`[DEBUG MOCK LIMIT BUY] id=${id} sym=${symbol} price=${price} sl=${sl} tp=${tp} opts=${JSON.stringify(opts)}`);
    this.pendingOrders.set(id, { id, symbol, direction: 'BUY', orderType: 'LIMIT', limitPrice: price, sl, tp, volume: lots, placedAt: this.currentCandles.get(symbol)?.timestamp || 0, clientId: opts?.clientId, botId: this.deduceBotId(opts), magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow });
    const orchState = this.getOrchState(opts);
    if (orchState) this.checkPendingOrderFills(orchState, id);
    return { orderId: id };
  }

  async createLimitSellOrder(symbol: string, lots: number, price: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    this.pendingOrders.set(id, { id, symbol, direction: 'SELL', orderType: 'LIMIT', limitPrice: price, sl, tp, volume: lots, placedAt: this.currentCandles.get(symbol)?.timestamp || 0, clientId: opts?.clientId, botId: this.deduceBotId(opts), magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow });
    const orchState = this.getOrchState(opts);
    if (orchState) this.checkPendingOrderFills(orchState, id);
    return { orderId: id };
  }


  async createStopBuyOrder(symbol: string, lots: number, price: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    // Store clientId (sig) from Sage so checkPendingOrderFills can directly populate state.activeTrades[].
    const clientId = opts?.clientId as string | undefined;
    this.pendingOrders.set(id, { id, symbol, direction: 'BUY', orderType: 'STOP', limitPrice: price, sl, tp, volume: lots, placedAt: this.currentCandles.get(symbol)?.timestamp || 0, clientId, botId: this.deduceBotId(opts), magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow });
    const orchState = this.getOrchState(opts);
    if (orchState) this.checkPendingOrderFills(orchState, id);
    return { orderId: id };
  }

  async createStopSellOrder(symbol: string, lots: number, price: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    const clientId = opts?.clientId as string | undefined;
    this.pendingOrders.set(id, { id, symbol, direction: 'SELL', orderType: 'STOP', limitPrice: price, sl, tp, volume: lots, placedAt: this.currentCandles.get(symbol)?.timestamp || 0, clientId, botId: this.deduceBotId(opts), magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow });
    const orchState = this.getOrchState(opts);
    if (orchState) this.checkPendingOrderFills(orchState, id);
    return { orderId: id };
  }

  async cancelOrder(orderId: string) {
    if (this.pendingOrders.has(orderId)) {
      this.pendingOrders.delete(orderId);
      return { stringCode: 'ORDER_CANCEL_SUCCESS' };
    }
    return { stringCode: 'ORDER_NOT_FOUND' };
  }

  async createMarketBuyOrder(symbol: string, lots: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    const spreadPts = this.spreadPtsMap.get(symbol) || 0;
    const slp = this.getAdverseSlippagePts(symbol);
    const c = this.currentCandles.get(symbol);
    let price = (c?.open || 0) + spreadPts + slp;
    if (opts?.limitPrice !== undefined) {
      price = Math.min(price, opts.limitPrice + slp);
    }
    if (price > 100 && symbol.includes('EUR')) console.log(`[ANOMALY TRACE] createMarketBuyOrder: ${symbol} price=${price}`);
    const botId = this.deduceBotId(opts);

    
    // NATIVE PARITY CHECK: If it hits SL/TP in the exact candle it was placed
    if (c) {
      if (c.low <= sl) {
        const exitPrice = Math.min(c.open, sl) - slp;
        
        let riskDist = Math.abs(price - sl);
        const pipSize = this.pipSizes.get(symbol) || 1;
        if (riskDist < pipSize * 0.1) riskDist = pipSize * 0.1;
        
        const rMultiple = (exitPrice - price) / riskDist;
        this.tradeLog.push({
          symbol: symbol, direction: 'BUY', entryPrice: price, exitPrice,
          slPrice: sl, originalSl: sl, tpPrice: tp, outcome: 'SL', rMultiple,
          openTime: c.timestamp, closeTime: c.timestamp, botId, clientId: opts?.clientId,
          magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, limitPlacedAt: opts?.placedAt,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined
        });
        return { orderId: id };
      } else if (c.high >= tp) {
        let riskDist = Math.abs(price - sl);
        const pipSize = this.pipSizes.get(symbol) || 1;
        if (riskDist < pipSize * 0.1) riskDist = pipSize * 0.1;

        const exitPrice = tp - slp;
        const rMultiple = (exitPrice - price) / riskDist;
        this.tradeLog.push({
          symbol: symbol, direction: 'BUY', entryPrice: price, exitPrice,
          slPrice: sl, originalSl: sl, tpPrice: tp, outcome: 'TP', rMultiple,
          openTime: c.timestamp, closeTime: c.timestamp, botId, clientId: opts?.clientId,
          magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, limitPlacedAt: opts?.placedAt,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined
        });
        return { orderId: id };
      }
    }

    const intendedEntry = opts?.limitPrice !== undefined ? opts.limitPrice : ((c?.open || 0) + spreadPts);
    this.positions.set(id, { id, symbol, type: 'POSITION_TYPE_BUY', openPrice: price, intendedEntryPrice: intendedEntry, sl, originalSl: sl, tp, volume: lots, time: this.simulatedTime.toISOString(), botId, clientId: opts?.clientId, magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined });
    const orchState = (global as any).__SIM_ORCH_STATE__ || (opts?.orchState);
    if (orchState) {
      if (!orchState.activeTrades) orchState.activeTrades = [];
      if (!orchState.activeTrades.some((t: any) => t.metaOrderId === id)) {
        orchState.activeTrades.push({
        id,
        dbId: id,
        metaOrderId: id,
        clientId: opts?.clientId || botId,
        botId,
        symbol,
        direction: 'BUY',
        entryPrice: price,
        intendedEntryPrice: intendedEntry,
        slPrice: sl,
        originalSl: sl,
        tpPrice: tp,
        riskPips: Math.abs(price - sl) / (this.pipSizes.get(symbol) || 1),
        openTime: this.currentCandles.get(symbol)?.timestamp || Date.now(),
        timestamp: this.currentCandles.get(symbol)?.timestamp || Date.now(),
      });
      }
    }
    return { orderId: id };
  }

  async createMarketSellOrder(symbol: string, lots: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    const c = this.currentCandles.get(symbol);
    const spreadPts = this.spreadPtsMap.get(symbol) || 0;
    const slp = this.getAdverseSlippagePts(symbol);
    let price = (c?.open || 0) - slp;
    if (opts?.limitPrice !== undefined) {
      price = Math.max(price, opts.limitPrice - slp);
    }
    const botId = this.deduceBotId(opts);

    // NATIVE PARITY CHECK: If it hits SL/TP in the exact candle it was placed
    if (c) {
      if (c.high + spreadPts >= sl) {
        const exitPrice = Math.max(c.open + spreadPts, sl) + slp;
        
        let riskDist = Math.abs(price - sl);
        const pipSize = this.pipSizes.get(symbol) || 1;
        if (riskDist < pipSize * 0.1) riskDist = pipSize * 0.1;

        const rMultiple = (price - exitPrice) / riskDist;
        this.tradeLog.push({
          symbol: symbol, direction: 'SELL', entryPrice: price, exitPrice,
          slPrice: sl, originalSl: sl, tpPrice: tp, outcome: 'SL', rMultiple,
          openTime: c.timestamp, closeTime: c.timestamp, botId, clientId: opts?.clientId,
          magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, limitPlacedAt: opts?.placedAt,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined
        });
        return { orderId: id };
      } else if (c.low + spreadPts <= tp) {
        let riskDist = Math.abs(price - sl);
        const pipSize = this.pipSizes.get(symbol) || 1;
        if (riskDist < pipSize * 0.1) riskDist = pipSize * 0.1;

        const exitPrice = tp + slp;
        const rMultiple = (price - exitPrice) / riskDist;
        this.tradeLog.push({
          symbol: symbol, direction: 'SELL', entryPrice: price, exitPrice,
          slPrice: sl, originalSl: sl, tpPrice: tp, outcome: 'TP', rMultiple,
          openTime: c.timestamp, closeTime: c.timestamp, botId, clientId: opts?.clientId,
          magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, limitPlacedAt: opts?.placedAt,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined
        });
        return { orderId: id };
      }
    }

    const intendedEntry = opts?.limitPrice !== undefined ? opts.limitPrice : (c?.open || 0);
    this.positions.set(id, { id, symbol, type: 'POSITION_TYPE_SELL', openPrice: price, intendedEntryPrice: intendedEntry, sl, originalSl: sl, tp, volume: lots, time: this.simulatedTime.toISOString(), botId, clientId: opts?.clientId, magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined });
    const orchState = (global as any).__SIM_ORCH_STATE__ || (opts?.orchState);
    if (orchState) {
      if (!orchState.activeTrades) orchState.activeTrades = [];
      if (!orchState.activeTrades.some((t: any) => t.metaOrderId === id)) {
        orchState.activeTrades.push({
          id,
          dbId: id,
          metaOrderId: id,
          clientId: opts?.clientId || botId,
          botId,
          symbol,
          direction: 'SELL',
          entryPrice: price,
          intendedEntryPrice: intendedEntry,
          slPrice: sl,
          originalSl: sl,
          tpPrice: tp,
          riskPips: Math.abs(price - sl) / (this.pipSizes.get(symbol) || 1),
          openTime: c?.timestamp || Date.now(),
          timestamp: c?.timestamp || Date.now(),
        });
      }
    }
    return { orderId: id };
  }

  /**
   * Check pending limit orders for fills on each M1 candle.
   * This is called externally from OrchestratorShadowBacktester before feeding each M1 to the orchestrator.
   */
  checkPendingOrderFills(orchestratorState: any, singleOrderId?: string) {
    // In portfolio mode, this checks all symbols that had a tick recently
    for (const [symbol, c] of Array.from(this.currentCandles.entries())) {
      // Parity Rule: Cancel pending limit orders at 17:00 EST rollover (positions hold overnight)
      if (c.isSessionReset || (c.estHour === 17 && c.estMin === 0)) {
        if (singleOrderId) continue; // Do not process session reset on a single order instantiation check
        if (orchestratorState && orchestratorState.sageStates) {
          for (const sig of Object.keys(orchestratorState.sageStates)) {
            const ss = orchestratorState.sageStates[sig];
            if (ss) {
              ss.limitOrderId = null;
              ss.fired = false;
              ss.fired_fill_check = false;
              ss.direction = null;
            }
          }
        }
        if (orchestratorState && orchestratorState.orbStates) {
          for (const sig of Object.keys(orchestratorState.orbStates)) {
            const os = orchestratorState.orbStates[sig];
            if (os) {
              os.limitOrderId = null;
              os.fired = false;
            }
          }
        }
        this.pendingOrders.clear();
      }
    }
  }
  simulateTick(m1: any, symbol: string) {
    const c = this.currentCandles.get(symbol);
    if (!c) return;
    const orchestratorState = (global as any).__SIM_ORCH_STATE__;
    const spreadPts = this.spreadPtsMap.get(symbol) || 0;
    
    // NATIVE PARITY CHECK: Process Pending LIMIT/STOP Orders FIRST
    const singleOrderId = (m1 as any)?.__mock_order_id__; // Test injection support
    if (m1 && singleOrderId && !this.pendingOrders.has(singleOrderId)) {
      if ((m1 as any).__mock_action__ === 'DELETE') {
        this.pendingOrders.delete(singleOrderId);
        if (orchestratorState) {
          orchestratorState.limitOrderId = null;
          orchestratorState.limitPlacedAt = null;
          const tr = orchestratorState.activeTrades?.find((t: any) => t.metaOrderId === singleOrderId);
          if (tr) {
            orchestratorState.activeTrades = orchestratorState.activeTrades.filter((t: any) => t.metaOrderId !== singleOrderId);
            if (orchestratorState.activeTrade?.metaOrderId === singleOrderId) delete orchestratorState.activeTrade;
          }
        }
      }
      this.pendingOrders.clear();
      return;
    }

    const ordersToCheck = singleOrderId
      ? (this.pendingOrders.has(singleOrderId) ? [[singleOrderId, this.pendingOrders.get(singleOrderId)!]] as const : [])
      : Array.from(this.pendingOrders.entries());
      
    // 16:50 EST EOD Sweeper (Prevents Weekend/Overnight Gaps)
    if (c.estHour === 16 && c.estMin === 50) {
      for (const [orderId, pos] of Array.from(this.positions.entries())) {
        if (pos.symbol !== symbol) continue;
        const trade = orchestratorState.activeTrades?.find((t: any) => t.metaOrderId === orderId);
        if (trade) {
          const isBuy = trade.direction === 'BUY';
          const slp = this.getAdverseSlippagePts(symbol);
          const exitPrice = isBuy ? c.open - slp : c.open + spreadPts + slp;
          const rMultiple = isBuy 
            ? (exitPrice - trade.entryPrice) / (this.pipSizes.get(symbol) || 1) / trade.riskPips 
            : (trade.entryPrice - exitPrice) / (this.pipSizes.get(symbol) || 1) / trade.riskPips;
            
          this.tradeLog.push({
            symbol: symbol, direction: trade.direction, entryPrice: trade.entryPrice,
            exitPrice: exitPrice, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'EOD_CLOSE',
            rMultiple, openTime: trade.openTime, closeTime: c.timestamp,
            botId: trade.botId, clientId: trade.clientId, magic: pos.magic,
            orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: undefined, trailLog: pos.trailLog
          });
          this.positions.delete(orderId);
          orchestratorState.activeTrades = orchestratorState.activeTrades.filter((t: any) => t.metaOrderId !== orderId);
          if (orchestratorState.activeTrade?.metaOrderId === orderId) delete orchestratorState.activeTrade;
        }
      }
    }

    for (const [orderId, order] of ordersToCheck) {
      if (order.symbol !== symbol) continue;

      // PARITY: Expire Sage limit orders if candle timestamp is outside the 4-hour session sweep window
      if (order.botId === 'sage' || (order.clientId && (order.clientId.startsWith('S_') || order.clientId.startsWith('SAGE_')))) {
        if (orchestratorState && orchestratorState.sageStates) {
          const sageKey = this.resolveSageKey(orchestratorState, order.clientId);
          if (sageKey) {
            const ss = orchestratorState.sageStates[sageKey];
            if (ss && ss.sessionStartMins !== undefined && ss.sessionEndMins !== undefined) {
              const currentMins = c.estHour * 60 + c.estMin;
              let isInsideSession = false;
              if (ss.sessionOvernight) {
                isInsideSession = currentMins >= ss.sessionStartMins || currentMins <= ss.sessionEndMins;
              } else {
                isInsideSession = currentMins >= ss.sessionStartMins && currentMins <= ss.sessionEndMins;
              }
              if (!isInsideSession) {
                this.pendingOrders.delete(orderId);
                ss.limitOrderId = null;
                ss.fired = false;
                ss.fired_fill_check = false;
                ss.direction = null;
                continue;
              }
            }
          }
        }
      }

      const isBuy = order.direction === 'BUY';
      const originalLimitPrice = order.limitPrice;

      let buyFilled = false;
      let sellFilled = false;
      
      if (order.orderType === 'STOP') {
        if (isBuy && Number((c.high + spreadPts).toFixed(5)) >= Number(order.limitPrice.toFixed(5))) {
          buyFilled = true;
          order.limitPrice = Math.max((c.open + spreadPts), order.limitPrice);
        } else if (!isBuy && Number(c.low.toFixed(5)) <= Number(order.limitPrice.toFixed(5))) {
          sellFilled = true;
          order.limitPrice = Math.min(c.open, order.limitPrice);
        }
      } else {
        if (isBuy && Number((c.low + spreadPts).toFixed(5)) <= Number(order.limitPrice.toFixed(5))) {
          buyFilled = true;
          order.limitPrice = Math.min((c.open + spreadPts), order.limitPrice);
        } else if (!isBuy && Number(c.high.toFixed(5)) >= Number(order.limitPrice.toFixed(5))) {
          sellFilled = true;
          order.limitPrice = Math.max(c.open, order.limitPrice);
        }
      }

      if (buyFilled || sellFilled) {
        const direction = buyFilled ? 'BUY' : 'SELL';
        const slp = this.getAdverseSlippagePts(order.symbol);
        const filledPrice = buyFilled ? order.limitPrice + slp : order.limitPrice - slp;
        const gappedPastSl = buyFilled
          ? filledPrice <= order.sl
          : filledPrice >= order.sl;

        if (gappedPastSl) {
          this.pendingOrders.delete(orderId);
          this.tradeLog.push({
            symbol: symbol,
            direction,
            entryPrice: filledPrice,
            exitPrice: filledPrice,
            slPrice: order.sl,
            originalSl: order.sl,
            tpPrice: order.tp,
            outcome: 'SL',
            rMultiple: -1.0,
            openTime: c.timestamp,
            closeTime: c.timestamp,
            botId: order.botId || this.deduceBotId(order),
            clientId: order.clientId,
            magic: order.magic,
            orHigh: order.orHigh,
            orLow: order.orLow,
            limitPlacedAt: order.placedAt,
          });
          continue;
        }

        const type = buyFilled ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL';
        const pos: SimPosition = {
          id: orderId,
          symbol: order.symbol,
          type: type,
          openPrice: filledPrice,
          sl: order.sl,
          originalSl: order.sl,
          tp: order.tp,
          volume: order.volume,
          time: c.timestamp,
          magic: order.magic,
          orHigh: order.orHigh,
          orLow: order.orLow,
          limitPlacedAt: order.placedAt,
          botId: order.botId || this.deduceBotId(order),
          clientId: order.clientId,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined
        };
        this.positions.set(orderId, pos);
        this.pendingOrders.delete(orderId);

        if (orchestratorState) {
          orchestratorState.limitOrderId = null;
          orchestratorState.limitPlacedAt = null;
          let riskPips = Math.abs(filledPrice - order.sl) / (this.pipSizes.get(symbol) || 1);
          if (riskPips < 0.1) riskPips = 0.1;
          
          const sageSig = this.resolveSageKey(orchestratorState, order.clientId);
            
          if (!orchestratorState.activeTrades) orchestratorState.activeTrades = [];
          orchestratorState.activeTrades.push({
            dbId: 0,
            metaOrderId: orderId,
            clientId: sageSig || null,
            botId: order.botId || this.deduceBotId(order),
            direction: direction,
            entryPrice: filledPrice,
            slPrice: order.sl,
            originalSl: order.sl,
            tpPrice: order.tp,
            riskPips,
            highestPrice: filledPrice,
            lowestPrice: filledPrice,
            isTrailing: false,
            volume: order.volume,
            hasTakenPartial: false,
            openTime: c.timestamp,
          });
          
          const trade = orchestratorState.activeTrades.find((t: any) => t.metaOrderId === orderId) || orchestratorState.activeTrades[orchestratorState.activeTrades.length - 1];
          if (isBuy && c.low <= pos.sl) {
            const exitPrice = Math.min(c.open, pos.sl) - slp;
            const rMultiple = (exitPrice - trade.entryPrice) / (this.pipSizes.get(symbol) || 1) / trade.riskPips;
            this.tradeLog.push({
              symbol: symbol, direction: 'BUY', entryPrice: trade.entryPrice,
              exitPrice: exitPrice, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'SL',
              rMultiple, openTime: trade.openTime, closeTime: c.timestamp,
              botId: trade.botId, clientId: trade.clientId, magic: pos.magic,
              orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: order.placedAt, trailLog: pos.trailLog
            });
            this.positions.delete(trade.metaOrderId);
            orchestratorState.activeTrades = orchestratorState.activeTrades.filter((t: any) => t.metaOrderId !== trade.metaOrderId);
            if (orchestratorState.activeTrade?.metaOrderId === trade.metaOrderId) delete orchestratorState.activeTrade;
          } else if (!isBuy && c.high + spreadPts >= pos.sl) {
            const exitPrice = Math.max(c.open + spreadPts, pos.sl) + slp;
            const rMultiple = (trade.entryPrice - exitPrice) / (this.pipSizes.get(symbol) || 1) / trade.riskPips;
            this.tradeLog.push({
              symbol: symbol, direction: 'SELL', entryPrice: trade.entryPrice,
              exitPrice: exitPrice, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'SL',
              rMultiple, openTime: trade.openTime, closeTime: c.timestamp,
              botId: trade.botId, clientId: trade.clientId, magic: pos.magic,
              orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: order.placedAt, trailLog: pos.trailLog
            });
            this.positions.delete(trade.metaOrderId);
            orchestratorState.activeTrades = orchestratorState.activeTrades.filter((t: any) => t.metaOrderId !== trade.metaOrderId);
            if (orchestratorState.activeTrade?.metaOrderId === trade.metaOrderId) delete orchestratorState.activeTrade;
          } else if (isBuy && c.high >= pos.tp) {
            const exitPrice = pos.tp - slp;
            const rMultiple = (exitPrice - trade.entryPrice) / (this.pipSizes.get(symbol) || 1) / trade.riskPips;
            this.tradeLog.push({
              symbol: symbol, direction: 'BUY', entryPrice: trade.entryPrice,
              exitPrice: exitPrice, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'TP',
              rMultiple, openTime: trade.openTime, closeTime: c.timestamp,
              botId: trade.botId, clientId: trade.clientId, magic: pos.magic,
              orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: order.placedAt, trailLog: pos.trailLog
            });
            this.positions.delete(trade.metaOrderId);
            orchestratorState.activeTrades = orchestratorState.activeTrades.filter((t: any) => t.metaOrderId !== trade.metaOrderId);
            if (orchestratorState.activeTrade?.metaOrderId === trade.metaOrderId) delete orchestratorState.activeTrade;
          } else if (!isBuy && c.low + spreadPts <= pos.tp) {
            const exitPrice = pos.tp + slp;
            const rMultiple = (trade.entryPrice - exitPrice) / (this.pipSizes.get(symbol) || 1) / trade.riskPips;
            this.tradeLog.push({
              symbol: symbol, direction: 'SELL', entryPrice: trade.entryPrice,
              exitPrice: exitPrice, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'TP',
              rMultiple, openTime: trade.openTime, closeTime: c.timestamp,
              botId: trade.botId, clientId: trade.clientId, magic: pos.magic,
              orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: order.placedAt, trailLog: pos.trailLog
            });
            this.positions.delete(trade.metaOrderId);
            orchestratorState.activeTrades = orchestratorState.activeTrades.filter((t: any) => t.metaOrderId !== trade.metaOrderId);
            if (orchestratorState.activeTrade?.metaOrderId === trade.metaOrderId) delete orchestratorState.activeTrade;
          }
        }
      }
    }
    
    this.checkPositionSLHits(orchestratorState);
  }

  checkPositionSLHits(orchestratorState: any): boolean {
    let anyHit = false;
    for (const [id, pos] of Array.from(this.positions.entries())) {
      const c = this.currentCandles.get(pos.symbol);
      if (!c) continue;
      const isBuy = pos.type === 'POSITION_TYPE_BUY';
      const spreadPts = this.spreadPtsMap.get(pos.symbol) || 0;
      const pipSize = this.pipSizes.get(pos.symbol) || 1;
      const slp = this.getAdverseSlippagePts(pos.symbol);

      let hitSL = false;
      let hitTP = false;
      let exitPrice = 0;

      if (isBuy && Number(c.low.toFixed(5)) <= Number(pos.sl.toFixed(5))) {
        hitSL = true;
        exitPrice = Math.min(c.open, pos.sl) - slp;
      } else if (!isBuy && Number((c.high + spreadPts).toFixed(5)) >= Number(pos.sl.toFixed(5))) {
        hitSL = true;
        exitPrice = Math.max(c.open + spreadPts, pos.sl) + slp;
      } else if (isBuy && pos.tp && Number(c.high.toFixed(5)) >= Number(pos.tp.toFixed(5))) {
        hitTP = true;
        exitPrice = pos.tp - slp;
      } else if (!isBuy && pos.tp && Number((c.low + spreadPts).toFixed(5)) <= Number(pos.tp.toFixed(5))) {
        hitTP = true;
        exitPrice = pos.tp + slp;
      }

      if (hitSL || hitTP) {
        let riskDist = Math.abs(pos.openPrice - pos.originalSl);
        if (riskDist < pipSize * 0.1) riskDist = pipSize * 0.1;
        const rMultiple = isBuy ? (exitPrice - pos.openPrice) / riskDist : (pos.openPrice - exitPrice) / riskDist;
        
        this.tradeLog.push({
          symbol: pos.symbol,
          direction: isBuy ? 'BUY' : 'SELL',
          entryPrice: pos.openPrice,
          exitPrice,
          slPrice: pos.sl,
          originalSl: pos.originalSl,
          tpPrice: pos.tp,
          outcome: hitSL ? 'SL' : 'TP',
          rMultiple,
          openTime: new Date(pos.time).getTime(),
          closeTime: c.timestamp,
          botId: pos.botId,
          clientId: pos.clientId,
          magic: pos.magic,
          orHigh: pos.orHigh,
          orLow: pos.orLow,
          limitPlacedAt: (pos as any).limitPlacedAt,
          trailLog: pos.trailLog
        });
        
        this.positions.delete(id);
        anyHit = true;
        
        if (orchestratorState && orchestratorState.activeTrades) {
          orchestratorState.activeTrades = orchestratorState.activeTrades.filter((t: any) => t.metaOrderId !== id && t.id !== id);
        }
        if (orchestratorState && orchestratorState.activeTrade?.metaOrderId === id) {
          delete orchestratorState.activeTrade;
        }
      }
    }
    return anyHit;
  }

  async getSymbolPrice(symbol: string) {
    const bid = this.currentCandles.get(symbol)?.close || 0;
    return { bid, ask: bid + (this.spreadPtsMap.get(symbol) || 0) };
  }

  async getPositions() {
    return Array.from(this.positions.values());
  }

  async getAccountInformation() {
    return { balance: 10000, equity: 10000, marginLevel: 1000 };
  }
  async modifyPosition(positionId: string, sl: number | null, tp: number | null) {
    const pos = this.positions.get(positionId);
    if (!pos) return;
    
    // NATIVE PARITY CHECK: SL Gap Validation & Execution
    if (sl !== null) {
      if ((global as any).__SIM_ENABLE_TRACE__) {
        if (!pos.trailLog) pos.trailLog = [];
        pos.trailLog.push({ 
          time: this.currentCandles.get(pos.symbol)?.timestamp || Date.now(), 
          sl 
        });
      }
      pos.sl = sl;
    }
    if (tp !== null) pos.tp = tp;
  }

  async closePosition(positionId: string) {
    const pos = this.positions.get(positionId);
    if (!pos) return;
    const c = this.currentCandles.get(pos.symbol);
    if (!c) return;
    
    const isBuy = pos.type === 'POSITION_TYPE_BUY';
    const spreadPts = this.spreadPtsMap.get(pos.symbol) || 0;
    const slp = this.getAdverseSlippagePts(pos.symbol);
    const exitPrice = isBuy ? c.open - slp : c.open + spreadPts + slp;
    const pipSize = this.pipSizes.get(pos.symbol) || 1;
    
    // NATIVE PARITY FIX: Clamp risk distance to prevent infinite R-multiples
    let riskDist = Math.abs(pos.openPrice - pos.originalSl);
    if (riskDist < pipSize * 0.1) riskDist = pipSize * 0.1;

    const rMultiple = isBuy 
      ? (exitPrice - pos.openPrice) / riskDist
      : (pos.openPrice - exitPrice) / riskDist;

    this.tradeLog.push({
      symbol: pos.symbol,
      direction: isBuy ? 'BUY' : 'SELL',
      entryPrice: pos.openPrice,
      exitPrice,
      slPrice: pos.sl,
      originalSl: pos.originalSl,
      tpPrice: pos.tp,
      outcome: 'EOD',
      rMultiple,
      openTime: new Date(pos.time).getTime(),
      closeTime: c.timestamp,
      botId: pos.botId,
      clientId: pos.clientId,
      magic: pos.magic,
      orHigh: pos.orHigh,
      orLow: pos.orLow,
      limitPlacedAt: pos.limitPlacedAt,
      trailLog: pos.trailLog
    });
    this.positions.delete(positionId);
    
    const orchState = (global as any).__SIM_ORCH_STATE__;
    if (orchState) {
      if (orchState.activeTrades) {
        orchState.activeTrades = orchState.activeTrades.filter((t: any) => t.metaOrderId !== positionId && t.id !== positionId);
      }
      if (orchState.activeTrade?.metaOrderId === positionId || orchState.activeTrade?.id === positionId) {
        delete orchState.activeTrade;
      }
      if (pos && (pos as any).clientId && orchState.sageStates?.[(pos as any).clientId]) {
        orchState.sageStates[(pos as any).clientId].limitOrderId = null;
        orchState.sageStates[(pos as any).clientId].fired_fill_check = false;
      }
    }
  }

  async closePositionPartially(positionId: string, volume: number, opts: any) {
    // For MAGE we don't do partials, but stub it safely
    return { positionId };
  }

  async getPosition(positionId: string) {
    return this.positions.get(positionId) || null;
  }

  async getHistoricalCandles(symbol: string, tf: string, startTime?: any, count?: number) {
    return [];
  }

  forceCloseAll(timestamp: number) {
    const orchestratorState = (global as any).__SIM_ORCH_STATE__;
    for (const [orderId, pos] of Array.from(this.positions.entries())) {
      const c = this.currentCandles.get(pos.symbol);
      if (!c) continue;
      
      const trade = orchestratorState?.activeTrades?.find((t: any) => t.metaOrderId === orderId);
      const isBuy = pos.type === 'POSITION_TYPE_BUY';
      const spreadPts = this.spreadPtsMap.get(pos.symbol) || 0;
      const slp = this.getAdverseSlippagePts(pos.symbol);
      const pipSize = this.pipSizes.get(pos.symbol) || 1;
      
      const exitPrice = isBuy ? c.close - slp : c.close + spreadPts + slp;
      const entryPrice = trade ? trade.entryPrice : pos.openPrice;
      const riskDist = trade ? (trade.riskPips * pipSize) : Math.max(Math.abs(pos.openPrice - pos.originalSl), pipSize * 0.1);
      
      const rMultiple = isBuy ? (exitPrice - entryPrice) / riskDist : (entryPrice - exitPrice) / riskDist;
      
      this.tradeLog.push({
        symbol: pos.symbol,
        direction: isBuy ? 'BUY' : 'SELL',
        entryPrice: entryPrice,
        exitPrice: exitPrice,
        slPrice: pos.sl,
        originalSl: pos.originalSl || pos.sl,
        tpPrice: pos.tp,
        outcome: 'EOD_CLOSE',
        rMultiple,
        openTime: trade ? trade.openTime : new Date(pos.time).getTime(),
        closeTime: timestamp,
        botId: pos.botId,
        clientId: pos.clientId,
        magic: pos.magic,
        orHigh: pos.orHigh,
        orLow: pos.orLow,
        limitPlacedAt: pos.limitPlacedAt,
        trailLog: pos.trailLog
      });
      this.positions.delete(orderId);
    }
  }
}

