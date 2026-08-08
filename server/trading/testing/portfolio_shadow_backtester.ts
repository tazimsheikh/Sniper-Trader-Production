// ============================================================
// portfolio_shadow_backtester.ts
//
// Feeds multiple M1 CSV data chronologically into the REAL LiveOrchestrator.
// Simulated live portfolio testing (Mage, Sage, DWCB, etc.).
// ============================================================

import { loadCsv } from '../backtester/loadCsv.js';
import { PortfolioMockBrokerAccount } from '../backtester/stubs/PortfolioMockBrokerAccount.js';
import { MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG, PairConfigManager } from '../config/PairConfig.js';
import { OPTIMIZER_CONFIG, getDynamicPipSize } from '../config/OptimizerPairConfig.js';
import * as path from 'path';
import * as fs from 'fs';

(global as any).isSimulator = true;

async function registerStubs() {
  const dbStub = await import('../backtester/stubs/db.stub.js');
  const socketStub = await import('../backtester/stubs/socket.stub.js');
  const metaApiStub = await import('../backtester/stubs/metaApiHandler.stub.js');
  const tradeGateStub = await import('../backtester/stubs/globalTradeGate.stub.js');
  const newsStoreStub = await import('../backtester/stubs/newsStore.stub.js');
  const queueStub = await import('../backtester/stubs/metaApiQueue.stub.js');
  const cryptoStub = await import('../backtester/stubs/crypto.stub.js');

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
    const estStr = d.toLocaleString("en-US", { timeZone: "America/New_York" });
    return new Date(estStr + " UTC");
  };
}

async function loadPatchedOrchestrator(): Promise<any> {
  const mod = await import('../engine/LiveOrchestrator.js');
  return mod.LiveOrchestrator;
}

export async function runPortfolioShadowBacktest(startDate: string, endDate: string) {
  console.log(`\n🔮 [PORTFOLIO SHADOW] Starting Chronological Backtester (${startDate} to ${endDate})`);

  await registerStubs();
  const LiveOrchestrator = await loadPatchedOrchestrator();

  const mockAccount = new PortfolioMockBrokerAccount();
  (global as any).__SIM_MOCK_ACCOUNT__ = mockAccount;

  // Create orchestrator instance with simulator account
  (global as any).isSimulator = true;
  const orch = new LiveOrchestrator('simulator', 'fake_token', 'fake_account_id');
  (global as any).__SIM_ORCH__ = orch;
  
  orch.toggleBot('mage', true);
  orch.toggleBot('sage', true);
  orch.activeBots.delete('seer');
  
  orch.account = mockAccount;
  orch.cachedEquity = 100000;
  orch.warmedUp = true;
  orch.running = true;

  // Gather active pairs from configs
  const activePairs = new Set<string>();
  Object.keys(MAGE_PAIR_CONFIG).forEach(p => activePairs.add(p.replace('.Daily', '')));
  Object.keys(SAGE_PAIR_CONFIG).forEach(p => activePairs.add(p.replace('.Daily', '')));

  console.log(`\n📡 Gathered ${activePairs.size} active pairs for portfolio simulation...`);

  const allTicks: { symbol: string, tick: any }[] = [];
  const startD = new Date(new Date(startDate).getTime() - 15 * 86400000); // 15 days pre-load
  const endD = new Date(endDate + 'T23:59:59Z');

  const csvDir = path.join(process.cwd(), 'data', 'csv');

  // Load and merge CSVs
  for (const pair of activePairs) {
    // Enable bot configs for the session states
    const sessionPairs = Array.from(orch.states.keys()).filter(k => (k as string).replace('.Daily', '') === pair);
    for (const sessionPair of sessionPairs) {
      const state = orch.states.get(sessionPair);
      if (state) {
        state.botConfigs.set('mage', { enabled: true, risk: 10 });
        state.botConfigs.set('sage', { enabled: true, risk: 10 });
        state.botConfigs.set('seer', { enabled: false, risk: 0 });
      }
    }

    const pipSize = getDynamicPipSize(pair);
    const optCfg = OPTIMIZER_CONFIG[pair];
    const actualSpread = optCfg ? optCfg.spread : 1.5;
    
    mockAccount.registerSymbol(pair, actualSpread, pipSize);

    const csvFiles = fs.readdirSync(csvDir).filter(f => f.startsWith(pair.split('_')[0]) && f.endsWith('.csv'));
    if (csvFiles.length > 0) {
      const csvPath = path.join(csvDir, csvFiles[0]);
      const m1Candles = await loadCsv(csvPath, actualSpread, startD, endD);
      console.log(`   📁 Loaded ${m1Candles.length} M1 candles for ${pair}`);
      for (const tick of m1Candles) {
        allTicks.push({ symbol: pair, tick });
      }
    } else {
      console.warn(`   ⚠️ Warning: No CSV found for ${pair}`);
    }
  }

  // Chronological sort
  console.log(`\n⏳ Sorting ${allTicks.length} total ticks chronologically...`);
  allTicks.sort((a, b) => a.tick.timestamp - b.tick.timestamp);

  console.log(`\n▶️ Starting execution...`);
  const originalLog = console.log;
  console.log = (...args: any[]) => {
      const msg = args.join(' ');
      // Silence heavy tick logs to speed up output, or uncomment to debug
      // if (!msg.includes('[TickFeed]')) originalLog(msg);
  };

  const targetStartMs = new Date(startDate).getTime();
  let lastReportTs = 0;

  let peakFloatingR = 0;
  let maxIntradayDrawdownR = 0;

  for (const { symbol, tick } of allTicks) {
    const ts = tick.timestamp;
    if (!isFinite(ts)) continue;

    (global as any).__SIM_CURRENT_TIME__ = new Date(ts);

    if (ts - lastReportTs >= 7 * 86400000) {
      lastReportTs = ts;
      originalLog(`   ⏳ Progress: ${new Date(ts).toISOString()} | Equity: $${orch.cachedEquity.toFixed(2)}`);
    }

    const estHour = tick.eetHour;
    
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false });
    const parts = formatter.formatToParts(new Date(ts));
    const hrPart = parts.find(p => p.type === 'hour')?.value;
    const mnPart = parts.find(p => p.type === 'minute')?.value;
    const explicitEstHour = hrPart ? parseInt(hrPart, 10) : tick.eetHour;
    const explicitEstMin = mnPart ? parseInt(mnPart, 10) : tick.eetMin;

    mockAccount.setCurrentCandle(symbol, tick.open, tick.high, tick.low, tick.close, tick.timestamp, explicitEstHour, explicitEstMin);

    if (ts >= targetStartMs) {
      mockAccount.simulateTick(tick, symbol);

      // Track intraday floating R drawdown at each tick
      let currentUnrealizedR = 0;
      for (const pos of (mockAccount as any).positions.values()) {
        const c = (mockAccount as any).currentCandles.get(pos.symbol);
        if (c) {
          const isBuy = pos.type === 'POSITION_TYPE_BUY';
          const pipSize = (mockAccount as any).pipSizes.get(pos.symbol) || 1;
          let riskDist = Math.abs(pos.openPrice - pos.originalSl);
          if (riskDist < pipSize * 0.1) riskDist = pipSize * 0.1;
          const floatR = isBuy
            ? (c.close - pos.openPrice) / riskDist
            : (pos.openPrice - c.close) / riskDist;
          currentUnrealizedR += floatR;
        }
      }
      const closedNetR = mockAccount.tradeLog
        .filter(t => t.openTime >= targetStartMs && t.rMultiple !== undefined && t.rMultiple !== null && t.rMultiple !== -1.0)
        .reduce((sum, t) => sum + t.rMultiple, 0);
      const totalFloatingNetR = closedNetR + currentUnrealizedR;
      if (totalFloatingNetR > peakFloatingR) {
        peakFloatingR = totalFloatingNetR;
      }
      const currentIntradayDd = peakFloatingR - totalFloatingNetR;
      if (currentIntradayDd > maxIntradayDrawdownR) {
        maxIntradayDrawdownR = currentIntradayDd;
      }
    }
    
    await orch.onM1Tick(
      symbol,
      tick.open,
      tick.high,
      tick.low,
      tick.close,
      1,
      ts
    );
  }

  // Restore console.log
  console.log = originalLog;
  console.log(`\n✅ Portfolio Simulation Complete.`);

  const log = mockAccount.tradeLog;
  const filtered = log.filter(t => t.openTime >= targetStartMs && t.rMultiple !== undefined && t.rMultiple !== null && t.rMultiple !== -1.0);
  
  let wins = 0;
  let totalNetR = 0;
  
  const monthlyData: { [month: string]: { netR: number, wins: number, trades: number } } = {};
  let maxDrawdownR = 0;
  let peakNetR = 0;
  
  for (const t of filtered) {
    if (t.rMultiple > 0) wins++;
    totalNetR += t.rMultiple;
    
    // Update Drawdown
    if (totalNetR > peakNetR) {
        peakNetR = totalNetR;
    }
    const drawdown = peakNetR - totalNetR;
    if (drawdown > maxDrawdownR) {
        maxDrawdownR = drawdown;
    }
    
    // Aggregate by month
    const d = new Date(t.openTime);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!monthlyData[month]) {
        monthlyData[month] = { netR: 0, wins: 0, trades: 0 };
    }
    monthlyData[month].netR += t.rMultiple;
    monthlyData[month].trades++;
    if (t.rMultiple > 0) monthlyData[month].wins++;
    
    if (Math.abs(t.rMultiple) > 5) {
      console.log(`[ANOMALY] Huge R-Multiple: ${t.rMultiple.toFixed(2)}R | Pair: ${t.symbol} | Bot: ${t.botId} | Entry: ${t.entryPrice} | Exit: ${t.exitPrice} | SL: ${t.slPrice} | OrigSL: ${t.originalSl}`);
    }
  }

  console.log(`\n======================================================`);
  console.log(` 🏆 PORTFOLIO SHADOW BACKTEST REPORT: ${startDate} to ${endDate}`);
  console.log(`======================================================`);
  for (const m of Object.keys(monthlyData).sort()) {
      const data = monthlyData[m];
      const winRate = data.trades > 0 ? (data.wins / data.trades * 100).toFixed(1) : 0;
      console.log(`  📅 Month ${m}: ${data.netR > 0 ? '+' : ''}${data.netR.toFixed(2)} R (${data.trades} trades, ${winRate}% WR)`);
  }
  console.log(`------------------------------------------------------`);
  console.log(`Total Valid Trades:    ${filtered.length}`);
  console.log(`Win Rate:              ${filtered.length > 0 ? (wins / filtered.length * 100).toFixed(1) : 0}%`);
  console.log(`Portfolio Net R:       ${totalNetR > 0 ? '+' : ''}${totalNetR.toFixed(2)} R`);
  console.log(`Max Closed Drawdown:   -${maxDrawdownR.toFixed(2)} R`);
  console.log(`Max Intraday Drawdown: -${maxIntradayDrawdownR.toFixed(2)} R`);
  console.log(`Final Equity:          $${orch.cachedEquity.toFixed(2)}`);
  console.log(`======================================================`);

  return filtered;
}

// Runner
if (process.argv[1] && process.argv[1].endsWith('portfolio_shadow_backtester.ts')) {
  const args = process.argv.slice(2);
  const sDate = args[0] || '2026-06-01';
  const eDate = args[1] || '2026-06-30';
  runPortfolioShadowBacktest(sDate, eDate).catch(console.error);
}

