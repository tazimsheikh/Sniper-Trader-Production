// ============================================================
// OrchestratorShadowBacktester.ts
//
// Feeds 5.5 years of M1 CSV data through the REAL LiveOrchestrator.js
// code by registering module stubs, bypassing all live infrastructure.
//
// Usage: runShadowBacktest('ETHUSD.Daily') 
// ============================================================

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { loadCsv } from './loadCsv.js';
import { MockBrokerAccount } from './stubs/MockBrokerAccount.js';
import { MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG, PairConfigManager } from '../config/PairConfig.js';
import { OPTIMIZER_CONFIG, getDynamicPipSize } from '../config/OptimizerPairConfig.js';
import * as path from 'path';
import * as fs from 'fs';

// ── Step 1: Register all module stubs BEFORE importing LiveOrchestrator ──
// We use a loader approach via tsx's module resolution + tsconfig paths.
// The stubs are imported and then injected into the module cache.

// Since LiveOrchestrator.js is compiled JS using ESM imports, we need to 
// intercept at the JS level. We use a global registry pattern:
(global as any).isSimulator = true;

// Patch the modules that LiveOrchestrator imports from known relative paths
// We do this by pre-resolving and caching them on the global scope
// so the dynamic imports in LiveOrchestrator hit our stubs.

async function registerStubs() {
  const stubDir = path.join(process.cwd(), 'server/discretionary_trader/backtester/stubs');
  
  // We need to patch module resolution for LiveOrchestrator's static imports.
  // The cleanest approach: create mock module objects and attach them to a global registry
  // that LiveOrchestrator can use when global.isSimulator = true.

  // Load stub implementations
  const dbStub = await import('./stubs/db.stub.js');
  const socketStub = await import('./stubs/socket.stub.js');
  const metaApiStub = await import('./stubs/metaApiHandler.stub.js');
  const tradeGateStub = await import('./stubs/globalTradeGate.stub.js');
  const newsStoreStub = await import('./stubs/newsStore.stub.js');
  const queueStub = await import('./stubs/metaApiQueue.stub.js');
  const cryptoStub = await import('./stubs/crypto.stub.js');

  // Register on global so LiveOrchestrator patched code can access them
  (global as any).__SIM_DB__ = dbStub.default;
  (global as any).__SIM_SOCKET__ = socketStub;
  (global as any).__SIM_METAAPI__ = metaApiStub;
  (global as any).__SIM_TRADE_GATE__ = tradeGateStub.globalTradeGate;
  (global as any).__SIM_NEWS__ = newsStoreStub;
  (global as any).__SIM_QUEUE__ = queueStub;
  (global as any).__SIM_CRYPTO__ = cryptoStub.default;
  (global as any).__SIM_ADD_BOT_LOG__ = () => {};
  (global as any).__SIM_TIME_PROVIDER__ = (date?: Date | number) => {
    const d = date ? (typeof date === "number" ? new Date(date) : date) : ((global as any).__SIM_CURRENT_TIME__ || new Date());
    const y = d.getUTCFullYear();
    const marchFirst = new Date(Date.UTC(y, 2, 1));
    const daysToFirstSunday = (7 - marchFirst.getUTCDay()) % 7;
    const secondSundayMarch = new Date(Date.UTC(y, 2, 1 + daysToFirstSunday + 7, 7, 0, 0));
    const novFirst = new Date(Date.UTC(y, 10, 1));
    const daysToFirstSunNov = (7 - novFirst.getUTCDay()) % 7;
    const firstSundayNov = new Date(Date.UTC(y, 10, 1 + daysToFirstSunNov, 6, 0, 0));
    const t = d.getTime();
    const isDst = t >= secondSundayMarch.getTime() && t < firstSundayNov.getTime();
    const offsetHours = isDst ? -4 : -5;
    return new Date(t + offsetHours * 60 * 60 * 1000);
  };

  return { dbStub, socketStub, metaApiStub, tradeGateStub, newsStoreStub, queueStub };
}

async function loadPatchedOrchestrator(): Promise<any> {
  const mod = await import('../engine/LiveOrchestrator.js');
  return mod.LiveOrchestrator;
}

function isDST(timestamp: number): boolean {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  // DST starts second Sunday in March
  const dstStart = new Date(Date.UTC(year, 2, 1));
  let daysToSunday = (7 - dstStart.getUTCDay()) % 7;
  dstStart.setUTCDate(1 + daysToSunday + 7);
  dstStart.setUTCHours(7, 0, 0, 0); // 2:00 AM EST = 7:00 AM UTC
  // DST ends first Sunday in November
  const dstEnd = new Date(Date.UTC(year, 10, 1));
  daysToSunday = (7 - dstEnd.getUTCDay()) % 7;
  dstEnd.setUTCDate(1 + daysToSunday);
  dstEnd.setUTCHours(6, 0, 0, 0); // 2:00 AM EDT = 6:00 AM UTC
  return timestamp >= dstStart.getTime() && timestamp < dstEnd.getTime();
}

// ── Main shadow backtest runner ──
import { ShadowResult, ShadowOptions } from '../config/types.js';

export async function runShadowBacktest(pair: string, startDate?: string, endDate?: string, options: ShadowOptions = { enableMage: true, enableSage: true }): Promise<ShadowResult> {
  console.log(`\n🔮 [SHADOW] Starting OrchestratorShadowBacktester for ${pair}`);

  if (!startDate || !endDate) {
    const csvDir = path.join(process.cwd(), 'data', 'csv');
    const csvFiles = fs.readdirSync(csvDir).filter(f => f.startsWith(pair.split('_')[0]) && f.endsWith('.csv'));
    if (csvFiles.length === 0) throw new Error(`No CSV found for ${pair}`);
    const { getLatestDate } = await import('./loadCsv.js');
    const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
    const derivedEndDate = latestDate.toISOString().substring(0, 10);
    const sd = new Date(latestDate.getTime());
    sd.setMonth(sd.getMonth() - 66); // 5.5 years = 66 months
    const derivedStartDate = sd.toISOString().substring(0, 10);
    
    if (!endDate) endDate = derivedEndDate;
    if (!startDate) startDate = derivedStartDate;
  }
  
  await registerStubs();
  const LiveOrchestrator = await loadPatchedOrchestrator();

  const configArray = MAGE_PAIR_CONFIG[pair] || MAGE_PAIR_CONFIG[pair.replace('.Daily', '')] ||
                      SAGE_PAIR_CONFIG[pair] || SAGE_PAIR_CONFIG[pair.replace('.Daily', '')];
  const config = Array.isArray(configArray) ? configArray[0] : (configArray || OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[pair.replace('.Daily', '')]);
  if (!config) throw new Error(`No config for ${pair}`);

  const pipSize = getDynamicPipSize(pair);
  
  // Load spread from OPTIMIZER_CONFIG to align perfectly with Math Backtester
  const optCfg = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[pair.replace('.Daily', '')];
  let actualSpread = optCfg ? optCfg.spread : 1.5;
  const spread = actualSpread * pipSize;

  // Create mock broker
  const mockAccount = new MockBrokerAccount(pair, actualSpread, pipSize);
  (global as any).__SIM_MOCK_ACCOUNT__ = mockAccount;

  // Create orchestrator instance with simulator account
  (global as any).isSimulator = true;
  const orch = new LiveOrchestrator('simulator', 'fake_token', 'fake_account_id');
  (global as any).__SIM_ORCH__ = orch;
  const activeBots = config.activeBots || ['mage'];
  for (const bot of activeBots) {
    orch.toggleBot(bot.toLowerCase(), true);
  }
  orch.account = mockAccount;
  orch.cachedEquity = 100000;
  orch.warmedUp = true;
  orch.running = true;
  orch.activeBots.clear();
  if (options.enableMage) orch.activeBots.add('mage');
  if (options.enableSage) orch.activeBots.add('sage');
  if (options.enableSeer) orch.activeBots.add('seer');
  else orch.activeBots.delete('seer');

  // Ensure pair state has bots enabled
  const basePair = PairConfigManager.getBaseSymbol(pair);
  const sessionPairs = Array.from(orch.states.keys()).filter(k => {
    return PairConfigManager.getBaseSymbol(k as string) === basePair;
  });
  
  if (sessionPairs.length === 0) {
    throw new Error(`Pair ${pair} not found in orchestrator states. Check MAGE_PAIR_CONFIG or SAGE_PAIR_CONFIG.`);
  }

  for (const sessionPair of sessionPairs) {
    const state = orch.states.get(sessionPair);
    if (state) {
      state.botConfigs.set('mage', { enabled: !!options.enableMage, risk: 10 });
      state.botConfigs.set('sage', { enabled: !!options.enableSage, risk: 10 });
      state.botConfigs.set('seer', { enabled: !!options.enableSeer, risk: 10 });
    }
  }

  // Load CSV data
  const csvDir = path.join(process.cwd(), 'data', 'csv');
  const csvFiles = fs.readdirSync(csvDir).filter(f => f.startsWith(pair.split('_')[0]) && f.endsWith('.csv'));
  if (csvFiles.length === 0) throw new Error(`No CSV found for ${pair}`);

  const csvPath = path.join(csvDir, csvFiles[0]);
  const startD = new Date(new Date(startDate).getTime() - 30 * 86400000); // 30 days pre-load (matches MathBacktester)
  const endD = new Date(endDate + 'T23:59:59Z');
  
  const m1Candles = await loadCsv(csvPath, actualSpread, startD, endD);
  const targetStartMs = new Date(startDate).getTime();

  console.log(`   📁 Loaded ${m1Candles.length} M1 candles for ${pair}`);

  let wins = 0, losses = 0, eods = 0;
  let totalNetR = 0;
  let peakR = 0;
  let maxDrawdown = 0;

  // Feed each M1 candle through the real LiveOrchestrator
  const originalLog = console.log;
  console.log = (...args: any[]) => {
      const msg = args.join(' ');
      originalLog(msg);
  };

  let lastReportTs = 0;
  for (const m1 of m1Candles) {
    if (m1.timestamp - lastReportTs >= 30 * 86400000) {
        lastReportTs = m1.timestamp;
        originalLog(`   ⏳ Progress: ${new Date(m1.timestamp).toISOString()}`);
    }
    const ts = m1.timestamp;
    if (!isFinite(ts)) continue;

    // Set simulated time on global for force-close logic
    (global as any).__SIM_CURRENT_TIME__ = new Date(ts);

    // Update mock account's current candle
    mockAccount.setCurrentCandle(m1.open, m1.high, m1.low, m1.close, ts, m1.estHour, m1.minute);

    // ── Per-candle simulation order ───────────────────────────────────────────
    // Matches Tier 2 (MathBacktester) exactly:
    //   Tier 2: check SL hit (N) → apply trailing SL (N) → check SL hit (N+1)
    //   Shadow: checkPositionSLHits (N) → onM1Tick/trailing SL update (N) → checkPositionSLHits (N+1)
    //
    // state.activeTrades[] is now populated directly by checkPendingOrderFills at fill
    // time (not by the brittle checkSageLimitFill poller), so this SL check correctly
    // sees the fill immediately and evaluates SL using the PREVIOUS candle's trailing SL
    // — which is the correct parity with Tier 2.
    let isWarmingUp = ts < targetStartMs;
    (global as any).__SIM_WARMUP__ = isWarmingUp;

    // ── Check pending order fills BEFORE SL check and onM1Tick ──
    for (const sessionPair of sessionPairs) {
      const state = orch.states.get(sessionPair);
      if (!state) continue;
      (global as any).__SIM_ORCH_STATE__ = state;
      mockAccount.checkPendingOrderFills(state);
    }

    // ── SL hit check (BEFORE onM1Tick) — matches Tier 2 candle-by-candle order ──
    if (!isWarmingUp) {
      for (const sessionPair of sessionPairs) {
        const state = orch.states.get(sessionPair);
        if (!state) continue;
        mockAccount.checkPositionSLHits(state);
      }
    }

    // Distribute tick to orchestrator (engine applies trailing SL moves for NEXT candle's check)
    if (ts >= 1735872900000 && ts <= 1735873200000) {
       originalLog(`[BACKTESTER TICK] ${new Date(ts).toISOString()} fed to orch`);
    }
    if (ts === 1768798800000 || ts === 1768799100000) {
       originalLog(`[MAGIC SHADOW FEED] Feeding ${ts} to orch!`);
    }
    const basePair = pair.split(".")[0];
    await orch.onM1Tick(basePair, m1.open, m1.high, m1.low, m1.close, m1.tickVol || 1, ts);

    if ((orch as any).pendingPromises && (orch as any).pendingPromises.length > 0) {
      await Promise.all((orch as any).pendingPromises);
      (orch as any).pendingPromises = [];
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    // ── Trailing SL sync ──────────────────────────────────────────────────────
    // Belt-and-suspenders: ensure pos.sl reflects the latest trade.slPrice from
    // this tick's runTrailingSLChecks, ready for the NEXT candle's SL hit check.
    for (const sessionPair of sessionPairs) {
      const state = orch.states.get(sessionPair);
      if (!state) continue;
      const trades: any[] = state.activeTrades || [];
      for (const trade of trades) {
        if (trade.slPrice !== undefined && trade.metaOrderId) {
          const pos = mockAccount.positions.get(trade.metaOrderId);
          if (pos && pos.sl !== trade.slPrice) {
            pos.sl = trade.slPrice;
          }
        }
      }
      // Also sync from state.activeTrade (Mage/Seer path) as a fallback ONLY if no activeTrades
      if (trades.length === 0) {
        const at = state.activeTrade;
        if (at?.slPrice !== undefined && at.metaOrderId) {
          const pos = mockAccount.positions.get(at.metaOrderId);
          if (pos && pos.sl !== at.slPrice) {
            pos.sl = at.slPrice;
          }
        }
      }
    }


    // ── Stale pending order cleanup ───────────────────────────────────────────
    // SageEngine.ts line 162: conn.cancelOrder(ss.limitOrderId) fails silently in
    // the Shadow because SageEngine uses its own static import of getSharedConnection
    // (not patched). SageEngine DOES set ss.limitOrderId = null at line 174 after the
    // cancel attempt. But mockAccount.pendingOrders still holds the stale order, so
    // checkPendingOrderFills fills it on future sessions as a ghost trade.
    // Fix: collect all limitOrderIds currently referenced by engine state. Any pending
    // order NOT in that set is removed — mirroring the broker's cancelOrder behavior.
    const referencedOrderIds = new Set<string>();
    for (const sessionPair of sessionPairs) {
      const state = orch.states.get(sessionPair);
      if (!state) continue;
      if (state.sageStates) {
        for (const sig in state.sageStates) {
          const sSig = state.sageStates[sig];
          if (sSig.limitOrderId) referencedOrderIds.add(sSig.limitOrderId);
        }
      }
      if (state.orbStates) {
        for (const sig in state.orbStates) {
          const oSig = state.orbStates[sig];
          if (oSig.limitOrderId) referencedOrderIds.add(oSig.limitOrderId);
        }
      }
      // Legacy single orbState slot
      if (state.orbState?.limitOrderId) {
        referencedOrderIds.add(state.orbState.limitOrderId);
      }
    }

    // Garbage collection of stale pending limit orders (because SageEngine's static import of MetaApi fails in Shadow)
    for (const [orderId, order] of mockAccount.pendingOrders) {
      if (!referencedOrderIds.has(orderId)) {
        mockAccount.pendingOrders.delete(orderId);
      }
    }

    for (const sessionPair of sessionPairs) {
      const state = orch.states.get(sessionPair);
      if (!state) continue;


      // Let LiveOrchestrator handle the daily lockout resets.
      // Note: warmup suppression removed — targetStartMs filter handles warmup exclusion correctly.
      
      // Simulate Order Execution latency (Tick by Tick limit check)
      if (state.orbState?.limitOrderId && !state.activeTrade) {
        mockAccount.checkPendingOrderFills(state);
      }
      
      if (state.orbStates) {
        let hasUnfiredLimitOrb = false;
        for (const sig in state.orbStates) {
          if (state.orbStates[sig].limitOrderId) {
            hasUnfiredLimitOrb = true;
            break;
          }
        }
        if (hasUnfiredLimitOrb) mockAccount.checkPendingOrderFills(state);
      }

      if (state.sageStates) {
        let hasUnfiredLimitSage = false;
        for (const sig in state.sageStates) {
          if (state.sageStates[sig].limitOrderId) {
            hasUnfiredLimitSage = true;
            break;
          }
        }
        if (hasUnfiredLimitSage) mockAccount.checkPendingOrderFills(state);
      }
    }
  }
  
  // EOD Truncation: Force close any positions left open at the exact end of the backtest simulation range
  // This matches Tier 2 (MathBacktester) which force closes at loopEndIdx if a trade hits the absolute end of the array.
  if (mockAccount.positions.size > 0) {
    for (const posId of mockAccount.positions.keys()) {
      mockAccount.closePosition(posId);
    }
  }

  console.log = originalLog; // Restore logging

  // Collect results only from target date range
  console.log(`[SHADOW] Total tradeLog length: ${mockAccount.tradeLog.length}`);
  if (mockAccount.tradeLog.length > 0) {
    console.log(`[SHADOW] First trade openTime: ${mockAccount.tradeLog[0].openTime}`);
  }
  const results = mockAccount.tradeLog.filter(t => t.openTime >= targetStartMs);

  for (const trade of results) {
    totalNetR += trade.rMultiple;
    if (totalNetR > peakR) peakR = totalNetR;
    const dd = peakR - totalNetR;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (trade.outcome === 'SL') {
      if (trade.rMultiple > 0) wins++; else losses++;
    } else if (trade.outcome === 'EOD') {
      if (trade.rMultiple > 0) wins++; else if (trade.rMultiple < 0) losses++; else losses++;
      eods++;
    }
  }

  const tradeCount = results.length;
  const winRate = tradeCount > 0 ? (wins / tradeCount) * 100 : 0;

  // Clean up temp file
  try {
    const tempPath = path.join(process.cwd(), 'server/discretionary_trader/engine/_LiveOrchestrator_sim.mjs');
    // if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch (_) {}

  console.log(`\n📊 [SHADOW RESULT] ${pair}`);
  console.log(`   Trades: ${tradeCount} | Wins: ${wins} | Losses: ${losses}`);
  console.log(`   Net R: ${totalNetR.toFixed(2)} | Win Rate: ${winRate.toFixed(2)}% | Max DD: -${maxDrawdown.toFixed(2)} R`);

  const tradeLog = mockAccount.tradeLog;
  return { pair, totalNetR, wins, losses, eod: eods, winRate, maxDrawdown, tradeCount, tradeLog };
}
