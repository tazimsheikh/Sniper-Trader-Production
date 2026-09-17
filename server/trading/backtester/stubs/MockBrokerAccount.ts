// ============================================================
// STUB: MockBrokerAccount.ts
// Intercepts all MetaAPI calls and simulates trade fills,
// trailing stops, and closures using M1 OHLC data.
// ============================================================
import { isNewsForceClose } from '../../market/historicalNews.js';
import { getShortHash } from './crypto.stub.js';

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
  riskWeight?: number;
  intendedRiskPips?: number;
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
  clientId?: string;
  orHigh?: number;
  orLow?: number;
  limitPlacedAt?: number;
  magic?: number;
  botId?: string;
  riskWeight?: number;
}

export interface TradeRecord {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  slPrice: number;
  originalSl?: number;
  tpPrice: number;
  outcome: 'SL' | 'EOD' | 'TP' | 'NEWS_CLOSE';
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
  riskWeight?: number;
}

export class MockBrokerAccount {
  positions: Map<string, SimPosition> = new Map();
  pendingOrders: Map<string, PendingLimitOrder> = new Map();
  tradeLog: TradeRecord[] = [];

  private currentCandle: { open: number; high: number; low: number; close: number; timestamp: number; estHour: number; estMin: number; isSessionReset: boolean } | null = null;
  private spread: number;
  private pipSize: number;
  private orderId = 1;
  private simulatedTime: Date = new Date();

  private lastEstHour = -1;

  private spreadPts: number;

  constructor(private symbol: string, spread: number, pipSize: number) {
    this.spread = spread;
    this.pipSize = pipSize;
    this.spreadPts = spread * pipSize;
  }

  /** Called before each M1 tick is fed to the orchestrator */
  setCurrentCandle(o: number, h: number, l: number, c: number, ts: number, estHour: number, estMin: number) {
    const isSessionReset = this.lastEstHour !== -1 && ((this.lastEstHour < 15 && estHour >= 15) || (this.lastEstHour > estHour && estHour >= 15));
    this.currentCandle = { 
      open: o, 
      high: h, 
      low: l, 
      close: c, 
      timestamp: ts,
      estHour,
      estMin,
      isSessionReset
    };
    this.simulatedTime = new Date(ts);
    this.lastEstHour = estHour;
  }

  private deduceBotId(opts?: any): string {
    if (opts?.botId) return String(opts.botId).toUpperCase();
    if (opts?.magic) {
      if (opts.magic >= 100000000 && opts.magic < 200000000) return 'MAGE';
      if (opts.magic >= 200000000 && opts.magic < 300000000) return 'SAGE';
      if (opts.magic >= 300000000 && opts.magic < 400000000) return 'SEER';
    }
    if (opts?.clientId) {
      const cid = String(opts.clientId).toUpperCase();
      if (cid.includes('MAGE')) return 'MAGE';
      if (cid.includes('SAGE')) return 'SAGE';
      if (cid.includes('SEER') || cid.includes('SRC_')) return 'SEER';
    }
    return "UNKNOWN";
  }

  private resolveSageKey(orchestratorState: any, clientId?: string): string | null {
    if (!clientId || !orchestratorState?.sageStates) return null;
    if (orchestratorState.sageStates[clientId]) return clientId;
    
    const parts = clientId.split('_');
    for (const part of parts) {
      if (part === "P0" || part === "Psimulator" || (part.startsWith("P") && part.length <= 4) || part === "S" || part === "M" || part === "SRC" || part === "SAGE" || part === "MAGE" || part === "SEER") continue;
      for (const key of Object.keys(orchestratorState.sageStates)) {
        if (getShortHash(key) === part || key.includes(part)) {
          return key;
        }
      }
    }
    return null;
  }

  private resolveMageKey(orchestratorState: any, clientId?: string): string | null {
    if (!clientId || !orchestratorState?.orbStates) return null;
    if (orchestratorState.orbStates[clientId]) return clientId;
    
    const parts = clientId.split('_');
    for (const part of parts) {
      if (part === "P0" || part === "Psimulator" || (part.startsWith("P") && part.length <= 4) || part === "S" || part === "M" || part === "SRC" || part === "SAGE" || part === "MAGE" || part === "SEER" || part === "T1" || part === "T2") continue;
      for (const key of Object.keys(orchestratorState.orbStates)) {
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
    if (orch) {
      if (opts?.clientId) {
        const clientId = opts.clientId as string;
        for (const [sp, state] of orch.states.entries()) {
          if (clientId.includes(sp) || clientId.startsWith(sp)) {
            return state;
          }
        }
        // Short hash resolution
        const parts = clientId.split("_");
        if (parts.length >= 2) {
          const hash = parts[1];
          for (const [sp, state] of orch.states.entries()) {
            if (state.orbStates) {
              for (const sig of Object.keys(state.orbStates)) {
                if (getShortHash(sig) === hash || sig.includes(hash)) {
                  return state;
                }
              }
            }
            if (state.sageStates) {
              for (const sig of Object.keys(state.sageStates)) {
                if (getShortHash(sig) === hash || sig.includes(hash)) {
                  return state;
                }
              }
            }
          }
        }
      }
      // Match by symbol of this MockBrokerAccount instance
      const cleanSym = this.symbol.replace(".Daily", "").toUpperCase();
      for (const [sp, state] of orch.states.entries()) {
        if (sp.toUpperCase().startsWith(cleanSym)) {
          return state;
        }
      }
    }
    return (global as any).__SIM_ORCH_STATE__;
  }

  // ── MetaAPI Interface Stubs ──

  async createLimitBuyOrder(symbol: string, lots: number, price: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    
    this.pendingOrders.set(id, { id, symbol, direction: 'BUY', orderType: 'LIMIT', limitPrice: price, sl, tp, volume: lots, placedAt: this.currentCandle?.timestamp || 0, clientId: opts?.clientId, botId: this.deduceBotId(opts), magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, riskWeight: opts?.riskWeight });
    const orchState = this.getOrchState(opts);
    if (orchState) this.checkPendingOrderFills(orchState, id);
    return { orderId: id };
  }

  async createLimitSellOrder(symbol: string, lots: number, price: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    this.pendingOrders.set(id, { id, symbol, direction: 'SELL', orderType: 'LIMIT', limitPrice: price, sl, tp, volume: lots, placedAt: this.currentCandle?.timestamp || 0, clientId: opts?.clientId, botId: this.deduceBotId(opts), magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, riskWeight: opts?.riskWeight });
    const orchState = this.getOrchState(opts);
    if (orchState) this.checkPendingOrderFills(orchState, id);
    return { orderId: id };
  }


  async createStopBuyOrder(symbol: string, lots: number, price: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    // Store clientId (sig) from Sage so checkPendingOrderFills can directly populate state.activeTrades[].
    const clientId = opts?.clientId as string | undefined;
    this.pendingOrders.set(id, { id, symbol, direction: 'BUY', orderType: 'STOP', limitPrice: price, sl, tp, volume: lots, placedAt: this.currentCandle?.timestamp || 0, clientId, botId: this.deduceBotId(opts), magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow });
    const orchState = this.getOrchState(opts);
    if (orchState) this.checkPendingOrderFills(orchState, id);
    return { orderId: id };
  }

  async createStopSellOrder(symbol: string, lots: number, price: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    const clientId = opts?.clientId as string | undefined;
    this.pendingOrders.set(id, { id, symbol, direction: 'SELL', orderType: 'STOP', limitPrice: price, sl, tp, volume: lots, placedAt: this.currentCandle?.timestamp || 0, clientId, botId: this.deduceBotId(opts), magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow });
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
    let price = opts?.entryPrice !== undefined ? opts.entryPrice : ((this.currentCandle?.open || 0) + this.spreadPts);
    const c = this.currentCandle;
    const botId = this.deduceBotId(opts);
    const intendedEntry = opts?.intendedEntryPrice !== undefined ? opts.intendedEntryPrice : (opts?.limitPrice !== undefined ? opts.limitPrice : price);

    this.positions.set(id, { id, symbol, type: 'POSITION_TYPE_BUY', openPrice: price, intendedEntryPrice: intendedEntry, sl, originalSl: sl, tp, volume: lots, time: this.simulatedTime.toISOString(), botId, clientId: opts?.clientId, magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined, riskWeight: opts?.riskWeight, intendedRiskPips: opts?.intendedRiskPips });
    const orchState = (global as any).__SIM_ORCH_STATE__ || (opts?.orchState);
    if (orchState) {
      if (!orchState.activeTrades) orchState.activeTrades = [];
      if (!orchState.activeTrades.some((t: any) => String(t.metaOrderId) === String(id))) {
        orchState.activeTrades.push({
        id,
        dbId: id,
        metaOrderId: id,
        clientId: opts?.clientId || botId,
        botId,
        magic: opts?.magic,
        symbol,
        direction: 'BUY',
        entryPrice: price,
        realFillPrice: price,
        intendedEntryPrice: intendedEntry,
        slPrice: sl,
        originalSl: sl,
        tpPrice: tp,
        riskPips: opts?.intendedRiskPips || (Math.abs(price - sl) / (this.pipSize || 0.0001)),
        openTime: this.currentCandle?.timestamp || Date.now(),
        timestamp: this.currentCandle?.timestamp || Date.now(),
        isPyramidChild: opts?.isPyramidChild,
        hasPyramided: opts?.hasPyramided,
        riskWeight: opts?.riskWeight
      });
      }
    }

    if (c && !opts?.isPyramidChild) {
      const fillRiskPips = (opts?.intendedRiskPips !== undefined && opts.intendedRiskPips > 0)
        ? opts.intendedRiskPips
        : (Math.abs((intendedEntry || price) - sl) / this.pipSize);
      if (c.low <= sl) {
        const exitPrice = Math.min(c.open, sl);
        const rMultiple = (fillRiskPips > 0 ? (exitPrice - price) / this.pipSize / fillRiskPips : -1) * (opts?.riskWeight ?? 1.0);
        this.tradeLog.push({
          symbol: this.symbol, direction: 'BUY', entryPrice: price,
          exitPrice, slPrice: sl, originalSl: sl, tpPrice: tp, outcome: 'SL',
          rMultiple, openTime: c.timestamp, closeTime: c.timestamp,
          botId, clientId: opts?.clientId, magic: opts?.magic,
          orHigh: opts?.orHigh, orLow: opts?.orLow, limitPlacedAt: c.timestamp,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined,
          riskWeight: opts?.riskWeight
        });
        this.positions.delete(id);
        const orch = (global as any).__SIM_ORCH__;
        if (orch && typeof orch.onBrokerPositionClosed === "function") {
          orch.onBrokerPositionClosed(id);
        }
        if (orchState) {
          orchState.activeTrades = (orchState.activeTrades || []).filter((t: any) => String(t.metaOrderId) !== String(id));
          if (String(orchState.activeTrade?.metaOrderId) === String(id)) {
            delete orchState.activeTrade;
          }
        }
      } else if (c.high >= tp) {
        const rMultiple = (fillRiskPips > 0 ? (tp - price) / this.pipSize / fillRiskPips : 0) * (opts?.riskWeight ?? 1.0);
        this.tradeLog.push({
          symbol: this.symbol, direction: 'BUY', entryPrice: price,
          exitPrice: tp, slPrice: sl, originalSl: sl, tpPrice: tp, outcome: 'TP',
          rMultiple, openTime: c.timestamp, closeTime: c.timestamp,
          botId, clientId: opts?.clientId, magic: opts?.magic,
          orHigh: opts?.orHigh, orLow: opts?.orLow, limitPlacedAt: c.timestamp,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined,
          riskWeight: opts?.riskWeight
        });
        this.positions.delete(id);
        const orch = (global as any).__SIM_ORCH__;
        if (orch && typeof orch.onBrokerPositionClosed === "function") {
          orch.onBrokerPositionClosed(id);
        }
        if (orchState) {
          orchState.activeTrades = (orchState.activeTrades || []).filter((t: any) => String(t.metaOrderId) !== String(id));
          if (String(orchState.activeTrade?.metaOrderId) === String(id)) {
            delete orchState.activeTrade;
          }
        }
      }
    }

    return { orderId: id };
  }

  async createMarketSellOrder(symbol: string, lots: number, sl: number, tp: number, opts?: any) {
    const id = `SIM_${this.orderId++}`;
    let price = opts?.entryPrice !== undefined ? opts.entryPrice : (this.currentCandle?.open || 0);
    const c = this.currentCandle;
    const botId = this.deduceBotId(opts);
    const intendedEntry = opts?.intendedEntryPrice !== undefined ? opts.intendedEntryPrice : (opts?.limitPrice !== undefined ? opts.limitPrice : price);

    this.positions.set(id, { id, symbol, type: 'POSITION_TYPE_SELL', openPrice: price, intendedEntryPrice: intendedEntry, sl, originalSl: sl, tp, volume: lots, time: this.simulatedTime.toISOString(), botId, clientId: opts?.clientId, magic: opts?.magic, orHigh: opts?.orHigh, orLow: opts?.orLow, trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined, riskWeight: opts?.riskWeight, intendedRiskPips: opts?.intendedRiskPips });
    const orchState = (global as any).__SIM_ORCH_STATE__ || (opts?.orchState);
    if (orchState) {
      if (!orchState.activeTrades) orchState.activeTrades = [];
      if (!orchState.activeTrades.some((t: any) => String(t.metaOrderId) === String(id))) {
        orchState.activeTrades.push({
          id,
          dbId: id,
          metaOrderId: id,
          clientId: opts?.clientId || botId,
          botId,
          magic: opts?.magic,
          symbol,
          direction: 'SELL',
          entryPrice: price,
          realFillPrice: price,
          intendedEntryPrice: intendedEntry,
          slPrice: sl,
          originalSl: sl,
          tpPrice: tp,
          riskPips: opts?.intendedRiskPips || (Math.abs(price - sl) / (this.pipSize || 0.0001)),
          openTime: this.currentCandle?.timestamp || Date.now(),
          timestamp: this.currentCandle?.timestamp || Date.now(),
          isPyramidChild: opts?.isPyramidChild,
          hasPyramided: opts?.hasPyramided,
          riskWeight: opts?.riskWeight
        });
      }
    }

    if (c && !opts?.isPyramidChild) {
      const fillRiskPips = (opts?.intendedRiskPips !== undefined && opts.intendedRiskPips > 0)
        ? opts.intendedRiskPips
        : (Math.abs((intendedEntry || price) - sl) / this.pipSize);
      if (c.high + this.spreadPts >= sl) {
        const exitPrice = Math.max(c.open + this.spreadPts, sl);
        const rMultiple = (fillRiskPips > 0 ? (price - exitPrice) / this.pipSize / fillRiskPips : -1) * (opts?.riskWeight ?? 1.0);
        this.tradeLog.push({
          symbol: this.symbol, direction: 'SELL', entryPrice: price,
          exitPrice, slPrice: sl, originalSl: sl, tpPrice: tp, outcome: 'SL',
          rMultiple, openTime: c.timestamp, closeTime: c.timestamp,
          botId, clientId: opts?.clientId, magic: opts?.magic,
          orHigh: opts?.orHigh, orLow: opts?.orLow, limitPlacedAt: c.timestamp,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined,
          riskWeight: opts?.riskWeight
        });
        this.positions.delete(id);
        const orch = (global as any).__SIM_ORCH__;
        if (orch && typeof orch.onBrokerPositionClosed === "function") {
          orch.onBrokerPositionClosed(id);
        }
        if (orchState) {
          orchState.activeTrades = (orchState.activeTrades || []).filter((t: any) => String(t.metaOrderId) !== String(id));
          if (String(orchState.activeTrade?.metaOrderId) === String(id)) {
            delete orchState.activeTrade;
          }
        }
      } else if (c.low + this.spreadPts <= tp) {
        const rMultiple = (fillRiskPips > 0 ? (price - tp) / this.pipSize / fillRiskPips : 0) * (opts?.riskWeight ?? 1.0);
        this.tradeLog.push({
          symbol: this.symbol, direction: 'SELL', entryPrice: price,
          exitPrice: tp, slPrice: sl, originalSl: sl, tpPrice: tp, outcome: 'TP',
          rMultiple, openTime: c.timestamp, closeTime: c.timestamp,
          botId, clientId: opts?.clientId, magic: opts?.magic,
          orHigh: opts?.orHigh, orLow: opts?.orLow, limitPlacedAt: c.timestamp,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined,
          riskWeight: opts?.riskWeight
        });
        this.positions.delete(id);
        const orch = (global as any).__SIM_ORCH__;
        if (orch && typeof orch.onBrokerPositionClosed === "function") {
          orch.onBrokerPositionClosed(id);
        }
        if (orchState) {
          orchState.activeTrades = (orchState.activeTrades || []).filter((t: any) => String(t.metaOrderId) !== String(id));
          if (String(orchState.activeTrade?.metaOrderId) === String(id)) {
            delete orchState.activeTrade;
          }
        }
      }
    }

    return { orderId: id };
  }

  /**
   * Check pending limit orders for fills on each M1 candle.
   * This is called externally from OrchestratorShadowBacktester before feeding each M1 to the orchestrator.
   */
  /**
   * PARITY FIX: SageMathCore evaluates limit fills starting from the first M1 bar
   * of the sweep M5 candle. In Tier 2, the limit is placed at the NEXT M1 tick after
   * the M5 candle completes, so checkPendingOrderFills sees the wrong (post-sweep) candle.
   * This method temporarily uses the last completed M5 candle's high/low to simulate
   * the fill check that SageMathCore would perform within the sweep candle's M1 bars.
   */
  checkPendingOrderFillsWithSweepCandle(orchestratorState: any, singleOrderId?: string) {
    if (!this.currentCandle) return;
    const currentTs = this.currentCandle.timestamp;
    const M5_MS = 5 * 60 * 1000;

    // Look for last completed M5 candle in each session's m5Buffer
    // The sweep candle is the most recent M5 whose end time <= currentTs
    const orch = (global as any).__SIM_ORCH__;
    let sweepM5: { high: number; low: number; open: number; close: number; timestamp: number } | null = null;

    if (orch) {
      for (const [, state] of orch.states.entries()) {
        const buf: any[] = state.m5Buffer || [];
        for (let i = buf.length - 1; i >= 0; i--) {
          const c = buf[i];
          // Last completed M5: its end time (ts + 5min) <= current M1 timestamp
          if (c.timestamp + M5_MS <= currentTs) {
            if (!sweepM5 || c.timestamp > sweepM5.timestamp) {
              sweepM5 = c;
            }
            break;
          }
        }
      }
    }

    if (!sweepM5) return;

    // Temporarily override currentCandle with sweep M5 extremes for fill detection.
    // IMPORTANT: Set open to a neutral value so checkPendingOrderFills fills at exactly
    // the limit price (matching SageMathCore which fills at limitSellPrice/limitBuyPrice
    // for normal M1 touches). The M5 open can be above/below the limit causing
    // Math.max/min to produce a different fill price than T1.
    const origCandle = this.currentCandle;

    // Determine each pending order's limit price to set the correct synthetic open
    const ordersToCheck = singleOrderId
      ? (this.pendingOrders.has(singleOrderId) ? [this.pendingOrders.get(singleOrderId)!] : [])
      : Array.from(this.pendingOrders.values());

    for (const order of ordersToCheck) {
      const id = order.id;
      if (!this.pendingOrders.has(id)) continue;

      // Verify the sweep M5 candle would fill this order
      const isBuy = order.direction === 'BUY';
      const wouldFill = order.orderType === 'LIMIT'
        ? (isBuy ? sweepM5.low <= order.limitPrice : sweepM5.high >= order.limitPrice)
        : (isBuy ? sweepM5.high >= order.limitPrice : sweepM5.low <= order.limitPrice);

      if (!wouldFill) continue;

      // Set open to just inside the limit so Math.max/min resolves to exactly limitPrice
      // (matching SageMathCore which fills at the exact limit price for normal touches)
      const syntheticOpen = isBuy
        ? order.limitPrice + 1e-6   // BUY: open just above limit → Math.min(open, limit) = limit
        : order.limitPrice - 1e-6;  // SELL: open just below limit → Math.max(open, limit) = limit

      this.currentCandle = {
        ...origCandle,
        high: sweepM5.high,
        low: sweepM5.low,
        open: syntheticOpen,
        close: sweepM5.close,
        timestamp: sweepM5.timestamp,
      };
      this.checkPendingOrderFills(orchestratorState, id);
    }
    this.currentCandle = origCandle;
  }

  checkPendingOrderFills(orchestratorState: any, singleOrderId?: string) {
    const c = this.currentCandle;
    if (!c) return;

    // Parity Rule: Cancel pending limit orders at 15:00 EST rollover / 2h pre-close (positions hold overnight)
    if (c.isSessionReset || (c.estHour >= 15 && c.estHour <= 17)) {
      if (singleOrderId) return; // Do not process session reset on a single order instantiation check
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
      this.pendingOrders.clear();
      return;
    }

    const ordersToCheck = singleOrderId
      ? (this.pendingOrders.has(singleOrderId) ? [[singleOrderId, this.pendingOrders.get(singleOrderId)!]] as const : [])
      : Array.from(this.pendingOrders.entries());

    for (const [orderId, order] of ordersToCheck) {
      const isBuy = order.direction === 'BUY';
      const originalLimitPrice = order.limitPrice;

      let buyFilled = false;
      let sellFilled = false;
      
      if (order.orderType === 'STOP') {
        if (isBuy && (c.high + this.spreadPts) >= order.limitPrice) {
          buyFilled = true;
          order.limitPrice = Math.max((c.open + this.spreadPts), order.limitPrice);
        } else if (!isBuy && c.low <= order.limitPrice) {
          sellFilled = true;
          order.limitPrice = Math.min(c.open, order.limitPrice);
        }
      } else {
        if (isBuy && Number((c.low + this.spreadPts).toFixed(5)) <= Number(order.limitPrice.toFixed(5))) {
          buyFilled = true;
          order.limitPrice = Math.min((c.open + this.spreadPts), order.limitPrice);
        } else if (!isBuy && Number(c.high.toFixed(5)) >= Number(order.limitPrice.toFixed(5))) {
          sellFilled = true;
          order.limitPrice = Math.max(c.open, order.limitPrice);
        }
      }

      if (buyFilled || sellFilled) {
        const direction = buyFilled ? 'BUY' : 'SELL';
        const gappedPastSl = buyFilled
          ? order.limitPrice <= order.sl
          : order.limitPrice >= order.sl;

        if (gappedPastSl) {
          this.pendingOrders.delete(orderId);
          this.tradeLog.push({
            symbol: this.symbol,
            direction,
            entryPrice: order.limitPrice,
            exitPrice: order.limitPrice,
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
          
          const sageSig = this.resolveSageKey(orchestratorState, order.clientId);
          if (sageSig && orchestratorState?.sageStates?.[sageSig]) {
            orchestratorState.sageStates[sageSig].fired_fill_check = true;
            orchestratorState.sageStates[sageSig].limitOrderId = null;
          }
          continue;
        }

        const type = buyFilled ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL';
        
        const pos: SimPosition = {
          id: orderId,
          symbol: order.symbol,
          type: type,
          openPrice: order.limitPrice,
          sl: order.sl,
          originalSl: order.sl,
          tp: order.tp,
          volume: order.volume,
          time: this.simulatedTime.toISOString(),
          botId: order.botId || this.deduceBotId(order),
          clientId: order.clientId,
          magic: order.magic,
          originalLimitPrice: originalLimitPrice,
          orLow: order.orLow,
          limitPlacedAt: order.placedAt,
          trailLog: (global as any).__SIM_ENABLE_TRACE__ ? [] : undefined,
          riskWeight: order.riskWeight
        };
        this.positions.set(orderId, pos);
        this.pendingOrders.delete(orderId);

        const targetState = this.getOrchState(order) || orchestratorState;
        if (targetState) {
          targetState.limitOrderId = null;
          targetState.limitPlacedAt = null;
          const intendedLimit = originalLimitPrice || order.limitPrice;
          const riskPips = Math.abs(intendedLimit - order.sl) / this.pipSize;
          
          const sageSig = this.resolveSageKey(targetState, order.clientId);
            
          if (sageSig) {
            const targetSs = targetState.sageStates?.[sageSig];
            if (targetSs) {
              targetSs.fired = true;
              targetSs.fired_fill_check = true;
              targetSs.limitOrderId = null;
            }
            if (!targetState.activeTrades) targetState.activeTrades = [];
            if (!targetState.activeTrades.some((t: any) => String(t.metaOrderId) === String(orderId))) {
              targetState.activeTrades.push({
                id: orderId,
                dbId: 1,
                metaOrderId: orderId,
                clientId: sageSig,
                botId: 'SAGE',
                magic: order.magic,
                symbol: this.symbol,
                direction: isBuy ? 'BUY' : 'SELL',
                entryPrice: pos.openPrice,
                realFillPrice: pos.openPrice,
                intendedEntryPrice: originalLimitPrice || pos.intendedEntryPrice || pos.openPrice,
                slPrice: pos.sl,
                originalSl: pos.originalSl || pos.sl,
                tpPrice: pos.tp,
                riskPips: Math.abs(pos.openPrice - pos.sl) / (this.pipSize || 0.0001),
                highestPrice: pos.openPrice,
                lowestPrice: pos.openPrice,
                openTime: this.currentCandle?.timestamp || Date.now(),
                timestamp: this.currentCandle?.timestamp || Date.now(),
              });
            }
          } else {
            const mageSig = this.resolveMageKey(targetState, order.clientId) || order.clientId;
            const baseSig = mageSig ? mageSig.split('_').slice(0, -1).join('_') : '';
            const targetOs = targetState.orbStates?.[mageSig] || targetState.orbStates?.[baseSig] || targetState.orbState;
            if (targetOs) {
              targetOs.fired = true;
              targetOs.limitOrderId = null;
            }
            const targetSs = targetState.sageStates?.[mageSig] || targetState.sageStates?.[baseSig];
            if (targetSs) {
              targetSs.fired = true;
              targetSs.fired_fill_check = true;
            }
            if (!targetState.activeTrades) targetState.activeTrades = [];
            if (!targetState.activeTrades.some((t: any) => String(t.metaOrderId) === String(orderId))) {
              targetState.activeTrades.push({
                id: orderId,
                dbId: 1,
                metaOrderId: orderId,
                clientId: mageSig,
                botId: 'MAGE',
                magic: order.magic,
                symbol: this.symbol,
                direction: isBuy ? 'BUY' : 'SELL',
                entryPrice: pos.openPrice,
                intendedEntryPrice: originalLimitPrice || pos.intendedEntryPrice || pos.openPrice,
                slPrice: pos.sl,
                originalSl: pos.originalSl || pos.sl,
                tpPrice: pos.tp,
                riskPips: Math.abs(pos.openPrice - pos.sl) / (this.pipSize || 0.0001),
                highestPrice: pos.openPrice,
                lowestPrice: pos.openPrice,
                openTime: this.currentCandle?.timestamp || Date.now(),
                timestamp: this.currentCandle?.timestamp || Date.now(),
              });
            }
          }
          
          // PARITY FIX: Same-candle TP/SL exit.
          const fillEntryPrice = pos.openPrice;
          const fillSl = pos.sl;
          const fillTp = pos.tp;
          const fillRiskPips = Math.abs((originalLimitPrice || fillEntryPrice) - fillSl) / this.pipSize;

          let sameCandleExit = false;

          if (isBuy && c.low <= fillSl) {
            const exitPrice = Math.min(c.open, fillSl);
            const rMultiple = (fillRiskPips > 0 ? (exitPrice - fillEntryPrice) / this.pipSize / fillRiskPips : -1) * (pos.riskWeight ?? 1.0);
            this.tradeLog.push({
              symbol: this.symbol, direction: 'BUY', entryPrice: fillEntryPrice,
              exitPrice, slPrice: fillSl, originalSl: pos.originalSl || fillSl, tpPrice: fillTp, outcome: 'SL',
              rMultiple, openTime: c.timestamp, closeTime: c.timestamp,
              botId: pos.botId, clientId: pos.clientId, magic: pos.magic,
              orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: order.placedAt, trailLog: pos.trailLog,
              riskWeight: pos.riskWeight
            });
            this.positions.delete(orderId);
            targetState.activeTrades = (targetState.activeTrades || []).filter((t: any) => String(t.metaOrderId) !== String(orderId));
            sameCandleExit = true;
          } else if (!isBuy && c.high + this.spreadPts >= fillSl) {
            const exitPrice = Math.max(c.open + this.spreadPts, fillSl);
            const rMultiple = (fillRiskPips > 0 ? (fillEntryPrice - exitPrice) / this.pipSize / fillRiskPips : -1) * (pos.riskWeight ?? 1.0);
            this.tradeLog.push({
              symbol: this.symbol, direction: 'SELL', entryPrice: fillEntryPrice,
              exitPrice, slPrice: fillSl, originalSl: pos.originalSl || fillSl, tpPrice: fillTp, outcome: 'SL',
              rMultiple, openTime: c.timestamp, closeTime: c.timestamp,
              botId: pos.botId, clientId: pos.clientId, magic: pos.magic,
              orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: order.placedAt, trailLog: pos.trailLog,
              riskWeight: pos.riskWeight
            });
            this.positions.delete(orderId);
            targetState.activeTrades = (targetState.activeTrades || []).filter((t: any) => String(t.metaOrderId) !== String(orderId));
            sameCandleExit = true;
          } else if (isBuy && c.high >= fillTp) {
            const rMultiple = (fillRiskPips > 0 ? (fillTp - fillEntryPrice) / this.pipSize / fillRiskPips : 0) * (pos.riskWeight ?? 1.0);
            this.tradeLog.push({
              symbol: this.symbol, direction: 'BUY', entryPrice: fillEntryPrice,
              exitPrice: fillTp, slPrice: fillSl, originalSl: pos.originalSl || fillSl, tpPrice: fillTp, outcome: 'TP',
              rMultiple, openTime: c.timestamp, closeTime: c.timestamp,
              botId: pos.botId, clientId: pos.clientId, magic: pos.magic,
              orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: order.placedAt, trailLog: pos.trailLog,
              riskWeight: pos.riskWeight
            });
            this.positions.delete(orderId);
            targetState.activeTrades = (targetState.activeTrades || []).filter((t: any) => String(t.metaOrderId) !== String(orderId));
            sameCandleExit = true;
          } else if (!isBuy && c.low + this.spreadPts <= fillTp) {
            
            const rMultiple = (fillRiskPips > 0 ? (fillEntryPrice - fillTp) / this.pipSize / fillRiskPips : 0) * (pos.riskWeight ?? 1.0);
            this.tradeLog.push({
              symbol: this.symbol, direction: 'SELL', entryPrice: fillEntryPrice,
              exitPrice: fillTp, slPrice: fillSl, originalSl: pos.originalSl || fillSl, tpPrice: fillTp, outcome: 'TP',
              rMultiple, openTime: c.timestamp, closeTime: c.timestamp,
              botId: pos.botId, clientId: pos.clientId, magic: pos.magic,
              orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: order.placedAt, trailLog: pos.trailLog,
              riskWeight: pos.riskWeight
            });
            this.positions.delete(orderId);
            targetState.activeTrades = (targetState.activeTrades || []).filter((t: any) => String(t.metaOrderId) !== String(orderId));
            sameCandleExit = true;
          }

          // Mark sage state as settled if same-candle exit occurred
          if (sameCandleExit && sageSig && targetState.sageStates?.[sageSig]) {
            targetState.sageStates[sageSig].limitOrderId = null;
            targetState.sageStates[sageSig].fired = true;
            targetState.sageStates[sageSig].fired_fill_check = true;
          }
        }

      }
    }
  }
  checkPositionSLHits(orchestratorState?: any): boolean {
    if (!this.currentCandle) return false;
    const c = this.currentCandle;
    let anyHit = false;

    // Iterate over broker positions directly so no position is ever orphaned or unmanaged
    for (const pos of Array.from(this.positions.values())) {
      const isBuy = pos.type === 'POSITION_TYPE_BUY';
      const actualRiskPips = (pos.botId === 'SAGE' ? undefined : (pos as any).intendedRiskPips) || (Math.abs(pos.openPrice - (pos.originalSl || pos.sl)) / this.pipSize);
      const effectiveRiskPips = actualRiskPips > 0 ? actualRiskPips : 1;

      if (isBuy && c.low <= pos.sl) {
        const exitPrice = (c.open < pos.sl) ? c.open : pos.sl;
        let rMultiple = ((exitPrice - pos.openPrice) / this.pipSize) / effectiveRiskPips;
        if ((pos as any).hasTakenPartial) {
          const partR = (pos as any).partialR ?? 1.5;
          const bPct = (pos as any).bankPct ?? 0.5;
          rMultiple = (partR * bPct) + (rMultiple * (1.0 - bPct));
        }
        rMultiple = rMultiple * (pos.riskWeight ?? 1.0);
        this.tradeLog.push({
          symbol: this.symbol, direction: 'BUY', entryPrice: pos.openPrice,
          exitPrice: exitPrice, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'SL',
          rMultiple, openTime: new Date(pos.time).getTime(), closeTime: c.timestamp,
          botId: pos.botId, clientId: pos.clientId, magic: pos.magic,
          orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: pos.limitPlacedAt, trailLog: pos.trailLog,
          riskWeight: pos.riskWeight
        });
        this.positions.delete(pos.id);
        const orch = (global as any).__SIM_ORCH__;
        if (orch && typeof orch.onBrokerPositionClosed === "function") {
          orch.onBrokerPositionClosed(pos.id);
        }
        if (orchestratorState) {
          orchestratorState.activeTrades = orchestratorState.activeTrades?.filter((t: any) => String(t.metaOrderId) !== String(pos.id));
          if (String(orchestratorState.activeTrade?.metaOrderId) === String(pos.id)) {
            delete orchestratorState.activeTrade;
          }
          if (pos.clientId && orchestratorState.sageStates?.[pos.clientId]) {
            orchestratorState.sageStates[pos.clientId].limitOrderId = null;
            orchestratorState.sageStates[pos.clientId].fired = true;
            orchestratorState.sageStates[pos.clientId].fired_fill_check = false;
          }
        }
        anyHit = true;
      } else if (!isBuy && c.high + this.spreadPts >= pos.sl) {
        const exitPrice = (c.open + this.spreadPts > pos.sl) ? (c.open + this.spreadPts) : pos.sl;
        let rMultiple = ((pos.openPrice - exitPrice) / this.pipSize) / effectiveRiskPips;
        if ((pos as any).hasTakenPartial) {
          const partR = (pos as any).partialR ?? 1.5;
          const bPct = (pos as any).bankPct ?? 0.5;
          rMultiple = (partR * bPct) + (rMultiple * (1.0 - bPct));
        }
        rMultiple = rMultiple * (pos.riskWeight ?? 1.0);
        this.tradeLog.push({
          symbol: this.symbol, direction: 'SELL', entryPrice: pos.openPrice,
          exitPrice: exitPrice, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'SL',
          rMultiple, openTime: new Date(pos.time).getTime(), closeTime: c.timestamp,
          botId: pos.botId, clientId: pos.clientId, magic: pos.magic,
          orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: pos.limitPlacedAt, trailLog: pos.trailLog,
          riskWeight: pos.riskWeight
        });
        this.positions.delete(pos.id);
        const orch = (global as any).__SIM_ORCH__;
        if (orch && typeof orch.onBrokerPositionClosed === "function") {
          orch.onBrokerPositionClosed(pos.id);
        }
        if (orchestratorState) {
          orchestratorState.activeTrades = orchestratorState.activeTrades?.filter((t: any) => String(t.metaOrderId) !== String(pos.id));
          if (String(orchestratorState.activeTrade?.metaOrderId) === String(pos.id)) {
            delete orchestratorState.activeTrade;
          }
          if (pos.clientId && orchestratorState.sageStates?.[pos.clientId]) {
            orchestratorState.sageStates[pos.clientId].limitOrderId = null;
            orchestratorState.sageStates[pos.clientId].fired = true;
            orchestratorState.sageStates[pos.clientId].fired_fill_check = false;
          }
        }
        anyHit = true;
      } else if (pos.tp && isBuy && c.high >= pos.tp) {
        let rMultiple = (pos.tp - pos.openPrice) / this.pipSize / effectiveRiskPips;
        if ((pos as any).hasTakenPartial) {
          const partR = (pos as any).partialR ?? 1.5;
          const bPct = (pos as any).bankPct ?? 0.5;
          rMultiple = (partR * bPct) + (rMultiple * (1.0 - bPct));
        }
        rMultiple = rMultiple * (pos.riskWeight ?? 1.0);
        this.tradeLog.push({
          symbol: this.symbol, direction: 'BUY', entryPrice: pos.openPrice,
          exitPrice: pos.tp, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'TP',
          rMultiple, openTime: new Date(pos.time).getTime(), closeTime: c.timestamp,
          botId: pos.botId, clientId: pos.clientId, magic: pos.magic,
          orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: pos.limitPlacedAt, trailLog: pos.trailLog,
          riskWeight: pos.riskWeight
        });
        this.positions.delete(pos.id);
        const orch = (global as any).__SIM_ORCH__;
        if (orch && typeof orch.onBrokerPositionClosed === "function") {
          orch.onBrokerPositionClosed(pos.id);
        }
        if (orchestratorState) {
          orchestratorState.activeTrades = orchestratorState.activeTrades?.filter((t: any) => String(t.metaOrderId) !== String(pos.id));
          if (String(orchestratorState.activeTrade?.metaOrderId) === String(pos.id)) {
            delete orchestratorState.activeTrade;
          }
          if (pos.clientId && orchestratorState.sageStates?.[pos.clientId]) {
            orchestratorState.sageStates[pos.clientId].limitOrderId = null;
            orchestratorState.sageStates[pos.clientId].fired = true;
            orchestratorState.sageStates[pos.clientId].fired_fill_check = false;
          }
        }
        anyHit = true;
      } else if (pos.tp && !isBuy && c.low + this.spreadPts <= pos.tp) {
        let rMultiple = (pos.openPrice - pos.tp) / this.pipSize / effectiveRiskPips;
        if ((pos as any).hasTakenPartial) {
          const partR = (pos as any).partialR ?? 1.5;
          const bPct = (pos as any).bankPct ?? 0.5;
          rMultiple = (partR * bPct) + (rMultiple * (1.0 - bPct));
        }
        rMultiple = rMultiple * (pos.riskWeight ?? 1.0);
        this.tradeLog.push({
          symbol: this.symbol, direction: 'SELL', entryPrice: pos.openPrice,
          exitPrice: pos.tp, slPrice: pos.sl, originalSl: pos.originalSl || pos.sl, tpPrice: pos.tp, outcome: 'TP',
          rMultiple, openTime: new Date(pos.time).getTime(), closeTime: c.timestamp,
          botId: pos.botId, clientId: pos.clientId, magic: pos.magic,
          orHigh: pos.orHigh, orLow: pos.orLow, limitPlacedAt: pos.limitPlacedAt, trailLog: pos.trailLog,
        });
        this.positions.delete(pos.id);
        const orch = (global as any).__SIM_ORCH__;
        if (orch && typeof orch.onBrokerPositionClosed === "function") {
          orch.onBrokerPositionClosed(pos.id);
        }
        if (orchestratorState) {
          orchestratorState.activeTrades = orchestratorState.activeTrades?.filter((t: any) => String(t.metaOrderId) !== String(pos.id));
          if (String(orchestratorState.activeTrade?.metaOrderId) === String(pos.id)) {
            delete orchestratorState.activeTrade;
          }
          if (pos.clientId && orchestratorState.sageStates?.[pos.clientId]) {
            orchestratorState.sageStates[pos.clientId].limitOrderId = null;
            orchestratorState.sageStates[pos.clientId].fired = true;
            orchestratorState.sageStates[pos.clientId].fired_fill_check = false;
          }
        }
        anyHit = true;
      }
    }
    return anyHit;
  }

  async getSymbolPrice(symbol: string) {
    const bid = this.currentCandle?.close || 0;
    return { bid, ask: bid + this.spreadPts };
  }

  async getPositions() {
    return Array.from(this.positions.values());
  }

  async getAccountInformation() {
    return { balance: 10000, equity: 10000, marginLevel: 1000 };
  }

  async modifyPosition(positionId: string, newSl: any, tp?: number) {
    const actualSl = typeof newSl === "object" ? newSl.stopLoss : newSl;
    const actualTp = typeof newSl === "object" ? newSl.takeProfit : tp;
    const clog = (global as any).__ORIGINAL_LOG__ || console.log;
    clog(`[DEBUG MODIFY POS] ts=${this.currentCandle?.timestamp} (${new Date(this.currentCandle?.timestamp || 0).toISOString()}) positionId=${positionId}, actualSl=${actualSl}, actualTp=${actualTp}`);
    const pos = this.positions.get(positionId);
    if (pos) {
      if (actualSl !== undefined) pos.sl = actualSl;
      if (actualTp !== undefined) pos.tp = actualTp;
      if (pos.trailLog) {
        pos.trailLog.push({ time: this.currentCandle?.timestamp || Date.now(), sl: actualSl });
      }
      const orch = (global as any).__SIM_ORCH__;
      if (orch) {
        for (const state of orch.states.values()) {
          if (state.activeTrades) {
            const tr = state.activeTrades.find((t: any) => String(t.metaOrderId) === String(positionId) || String(t.id) === String(positionId));
            if (tr) {
              if (actualSl !== undefined) tr.slPrice = actualSl;
              if (actualTp !== undefined) tr.tpPrice = actualTp;
            }
          }
        }
      }
    } else {
      clog(`[DEBUG MODIFY POS FAILED] positionId ${positionId} NOT FOUND in positions map! Keys: ${Array.from(this.positions.keys()).join(',')}`);
    }
  }

  async closePosition(positionId: string) {
    const pos = this.positions.get(positionId);
    if (!pos || !this.currentCandle) return;

    const c = this.currentCandle;
    const isBuy = pos.type === 'POSITION_TYPE_BUY';
    const exitPrice = isBuy ? c.close : c.close + this.spreadPts;
    const pipSize = this.pipSize;

    const initialLimit = pos.originalLimitPrice || pos.openPrice;
    const riskPips = (pos as any).intendedRiskPips || (Math.abs(initialLimit - pos.originalSl) / pipSize);
    const profitPips = isBuy
      ? (exitPrice - pos.openPrice) / pipSize
      : (pos.openPrice - exitPrice) / pipSize;
    let rMultiple = riskPips > 0 ? profitPips / riskPips : 0;
    if ((pos as any).hasTakenPartial) {
      const partR = (pos as any).partialR ?? 1.5;
      const bPct = (pos as any).bankPct ?? 0.5;
      rMultiple = (partR * bPct) + (rMultiple * (1.0 - bPct));
    }
    rMultiple = rMultiple * (pos.riskWeight ?? 1.0);

    const estDateProvider = (global as any).__SIM_TIME_PROVIDER__;
    const estDate = estDateProvider ? estDateProvider(new Date(c.timestamp)) : new Date(c.timestamp);
    const dateStr = estDate.toISOString().split('T')[0];
    const isNews = isNewsForceClose(dateStr, estDate.getUTCHours(), estDate.getUTCMinutes());

    this.tradeLog.push({
      symbol: pos.symbol,
      direction: pos.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
      entryPrice: pos.openPrice,
      exitPrice,
      slPrice: pos.sl,
      originalSl: pos.originalSl || pos.sl,
      tpPrice: pos.tp,
      outcome: isNews ? 'NEWS_CLOSE' : 'EOD',
      rMultiple,
      openTime: new Date(pos.time).getTime(),
      closeTime: c.timestamp,
      botId: (pos as any).botId,
      clientId: (pos as any).clientId,
      magic: pos.magic,
      orHigh: pos.orHigh,
      orLow: pos.orLow,
      limitPlacedAt: (pos as any).limitPlacedAt,
      trailLog: pos.trailLog,
      riskWeight: pos.riskWeight
    });

    this.positions.delete(positionId);
    
    // Parity Fix: Properly clear state via orchestrator instead of a single global state object
    const orch = (global as any).__SIM_ORCH__;
    if (orch && typeof orch.onBrokerPositionClosed === "function") {
      orch.onBrokerPositionClosed(positionId);
    }
    
    const orchState = (global as any).__SIM_ORCH_STATE__;
    if (orchState) {
      if (orchState.activeTrades) {
        orchState.activeTrades = orchState.activeTrades.filter((t: any) => String(t.metaOrderId) !== String(positionId) && String(t.id) !== String(positionId));
      }
      if (String(orchState.activeTrade?.metaOrderId) === String(positionId) || String(orchState.activeTrade?.id) === String(positionId)) {
        delete orchState.activeTrade;
      }
      if (pos && (pos as any).clientId && orchState.sageStates?.[(pos as any).clientId]) {
        orchState.sageStates[(pos as any).clientId].limitOrderId = null;
        orchState.sageStates[(pos as any).clientId].fired_fill_check = false;
      }
    }
  }

  async closePositionPartially(positionId: string, volume: number, opts?: any) {
    const pos = this.positions.get(positionId);
    if (pos) {
      (pos as any).hasTakenPartial = true;
      if (opts?.partialR !== undefined) (pos as any).partialR = opts.partialR;
      if (opts?.bankPct !== undefined) (pos as any).bankPct = opts.bankPct;
      pos.volume = Math.max(0.01, pos.volume - volume);
    }
    return { positionId };
  }

  async getPosition(positionId: string) {
    return this.positions.get(positionId) || null;
  }

  async getHistoricalCandles(symbol: string, tf: string, startTime?: any, count?: number) {
    return [];
  }
}

