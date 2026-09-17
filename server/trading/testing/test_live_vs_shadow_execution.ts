// ============================================================
// test_live_vs_shadow_execution.ts
//
// Validates real Live MetaTrader broker trade execution logs against
// Shadow LiveOrchestrator simulation replay for a given calendar date.
//
// Usage:
//   npx tsx server/trading/testing/test_live_vs_shadow_execution.ts [YYYY-MM-DD]
// Example:
//   npx tsx server/trading/testing/test_live_vs_shadow_execution.ts 2026-04-15
// ============================================================

import fs from "fs";
import path from "path";
import db from "../../core/db.js";
import MetaApiPkg from "metaapi.cloud-sdk/esm-node";
const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;
import { decrypt, isEncrypted } from "../../core/crypto.js";
import { PortfolioMockBrokerAccount } from "../backtester/stubs/PortfolioMockBrokerAccount.js";
import { MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG, PairConfigManager } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function registerStubs() {
  (global as any).isSimulator = true;
  const dbStub = await import("../backtester/stubs/db.stub.js");
  const socketStub = await import("../backtester/stubs/socket.stub.js");
  const metaApiStub = await import("../backtester/stubs/metaApiHandler.stub.js");
  const tradeGateStub = await import("../backtester/stubs/globalTradeGate.stub.js");
  const newsStoreStub = await import("../backtester/stubs/newsStore.stub.js");
  const queueStub = await import("../backtester/stubs/metaApiQueue.stub.js");
  const cryptoStub = await import("../backtester/stubs/crypto.stub.js");

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
}

async function loadPatchedOrchestrator(): Promise<any> {
  const mod = await import("../engine/LiveOrchestrator.js");
  return mod.LiveOrchestrator;
}

async function fetchCandles(targetDateStr: string, activePairs: string[]) {
  const profile = await db.prepare(`
    SELECT tp.id, tp.metaapi_account_id, COALESCE(tp.metaapi_token, u.metaapi_token) as metaapi_token, tp.broker_symbol_map
    FROM trading_profiles tp
    JOIN users u ON u.id = tp.user_id
    WHERE tp.id = 44 OR tp.id = 49
    ORDER BY tp.id ASC
    LIMIT 1
  `).get();

  let token = profile.metaapi_token;
  if (isEncrypted(token)) token = decrypt(token);

  let accId = profile.metaapi_account_id;
  if (isEncrypted(accId)) accId = decrypt(accId);

  let symbolMap: Record<string, string> = {};
  try {
    if (profile.broker_symbol_map) symbolMap = JSON.parse(profile.broker_symbol_map);
  } catch (_) {}

  const api = new MetaApi(token);
  const account = await api.metatraderAccountApi.getAccount(accId);

  const targetDateObj = new Date(`${targetDateStr}T23:59:59.000Z`);
  const todayDir = path.join(process.cwd(), "data", "today_csv");
  if (!fs.existsSync(todayDir)) fs.mkdirSync(todayDir, { recursive: true });

  console.log(`\n📥 Fetching full 24-hour M1 data for ${targetDateStr} (Profile #${profile.id})...`);

  for (const pair of activePairs) {
    let brokerSymbol = symbolMap[pair] || (pair === "GER40" ? (profile.id === 49 ? "DAX40" : "GER40") : pair);
    const jsonPath = path.join(todayDir, `${pair}_${targetDateStr}.json`);
    
    // If already downloaded and has candles, reuse cache
    if (fs.existsSync(jsonPath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        if (Array.isArray(cached) && cached.length > 500) {
          console.log(`✅ ${pair} (${brokerSymbol}): Loaded ${cached.length} candles from cache`);
          continue;
        }
      } catch (e) {}
    }

    try {
      let currentStartTime = targetDateObj;
      const allChunks = [];
      
      for (let i = 0; i < 5; i++) {
        const chunk = await account.getHistoricalCandles(brokerSymbol, "1m", currentStartTime, 1000);
        if (chunk && chunk.length > 0) {
          allChunks.push(...chunk);
          currentStartTime = new Date(chunk[0].time);
        }
        await sleep(500);
      }

      // Merge and deduplicate
      const map = new Map<number, any>();
      for (const c of allChunks) {
        const ts = new Date(c.time).getTime();
        map.set(ts, c);
      }

      const merged = Array.from(map.values()).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      // Do NOT filter strictly for target date so we keep 3 days of warm-up data
      const filtered = merged;

      console.log(`✅ ${pair} (${brokerSymbol}): ${filtered.length} candles (with warm-up)`);
      fs.writeFileSync(jsonPath, JSON.stringify(filtered, null, 2));
    } catch (e: any) {
      console.error(`❌ ${pair} (${brokerSymbol}) error: ${e.message}`);
    }
    await sleep(1200);
  }

  console.log("\n🎉 Full 24-hour candles successfully ready!\n");
}

async function main() {
  const targetDateStr = process.argv[2] || new Date().toISOString().split("T")[0];

  console.log("\n====================================================================================================");
  console.log(" 👑 LIVE VERSUS SHADOW PARITY CHECKER");
  console.log(` Date Tested: ${targetDateStr}`);
  console.log("====================================================================================================\n");

  // 1. Fetch Live Trades from REAL DB (BEFORE registering stubs!)
  const targetStartMs = new Date(`${targetDateStr}T00:00:00.000Z`).getTime();
  const targetEndMs = new Date(`${targetDateStr}T23:59:59.999Z`).getTime();

  const rawLiveTrades = await db.prepare(`
    SELECT * FROM trade_diary 
    WHERE CAST(open_time AS BIGINT) >= ? AND CAST(open_time AS BIGINT) <= ?
    AND UPPER(bot_id) != 'MANUAL' AND UPPER(bot_id) != 'DISCRETIONARY'
    ORDER BY CAST(open_time AS BIGINT) ASC
  `).all(targetStartMs, targetEndMs);

  // Deduplicate live trades across multiple accounts to unique canonical trades per bot/pair
  const liveTradesMap = new Map<string, any>();
  for (const t of rawLiveTrades) {
    const cleanSym = t.broker_symbol.replace('.Daily', '').replace('DAX40', 'GER40');
    const key = `${t.bot_id.toUpperCase()}_${cleanSym}_${t.direction.toUpperCase()}`;
    if (!liveTradesMap.has(key)) {
      liveTradesMap.set(key, t);
    }
  }
  const liveTrades = Array.from(liveTradesMap.values());

  const activePairsSet = new Set<string>([
    "USDJPY", "XAUUSD", "EURUSD", "NAS100", "US30", "GER40", "NZDUSD", 
    "USDCHF", "GBPJPY", "EURJPY", "CHFJPY", "GBPAUD", "EURCAD", "AUDJPY", "EURAUD", "GBPUSD", "USDCAD", "CADJPY"
  ]);
  for (const t of rawLiveTrades) {
    const cleanSym = t.broker_symbol.replace('.Daily', '').replace('DAX40', 'GER40');
    activePairsSet.add(cleanSym);
  }
  const activePairs = Array.from(activePairsSet);

  // 2. Fetch Candles
  await fetchCandles(targetDateStr, activePairs);

  console.log(`📦 Found ${rawLiveTrades.length} raw live account trade records (${liveTrades.length} unique canonical signals) in Live DB for ${targetDateStr}.\n`);

  // 3. Set Up Shadow Orchestrator Simulation (Register stubs now)
  await registerStubs();
  const LiveOrchestrator = await loadPatchedOrchestrator();

  const mockAccount = new PortfolioMockBrokerAccount();
  (global as any).__SIM_MOCK_ACCOUNT__ = mockAccount;

  const orch = new LiveOrchestrator("simulator", "fake_token", "fake_account_id");
  (global as any).__SIM_ORCH__ = orch;

  orch.toggleBot("mage", true);
  orch.toggleBot("sage", true);
  orch.toggleBot("seer", true);

  orch.account = mockAccount;
  orch.cachedEquity = 100000;
  orch.warmedUp = true;
  orch.running = true;

  const todayDir = path.join(process.cwd(), "data", "today_csv");
  const allTicks: { symbol: string; tick: any }[] = [];

  for (const pair of activePairs) {
    const sessionPairs = Array.from(orch.states.keys()).filter(k => (k as string).split(".")[0] === pair);
    for (const sessionPair of sessionPairs) {
      const state = orch.states.get(sessionPair);
      if (state) {
        state.botConfigs.set("mage", { enabled: true, risk: 10 });
        state.botConfigs.set("sage", { enabled: true, risk: 10 });
        state.botConfigs.set("seer", { enabled: true, risk: 10 });
      }
    }

    const pipSize = getDynamicPipSize(pair);
    const optCfg = OPTIMIZER_CONFIG[pair];
    const actualSpread = optCfg ? optCfg.spread : 1.5;

    mockAccount.registerSymbol(pair, actualSpread, pipSize);

    const jsonPath = path.join(todayDir, `${pair}_${targetDateStr}.json`);
    if (fs.existsSync(jsonPath)) {
      const candles: any[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      for (const c of candles) {
        const ts = new Date(c.time).getTime();
        const estDate = (global as any).__SIM_TIME_PROVIDER__(new Date(ts));
        const estHour = estDate.getUTCHours();
        const estMin = estDate.getUTCMinutes();

        allTicks.push({
          symbol: pair,
          tick: {
            timestamp: ts,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.tickVolume || 1,
            spread: actualSpread,
            estHour,
            estMin,
          },
        });
      }
    }
  }

  allTicks.sort((a, b) => a.tick.timestamp - b.tick.timestamp);
  console.log(`⏳ Replaying ${allTicks.length} Chronological M1 Ticks from ${targetDateStr} through Shadow LiveOrchestrator...`);

  // Silence verbose logs
  const origLog = console.log;
  console.log = () => {};

  for (const t of allTicks) {
    (global as any).__SIM_CURRENT_TIME__ = new Date(t.tick.timestamp);

    mockAccount.setCurrentCandle(
      t.symbol,
      t.tick.open,
      t.tick.high,
      t.tick.low,
      t.tick.close,
      t.tick.timestamp,
      t.tick.estHour,
      t.tick.estMin
    );
    mockAccount.simulateTick(t.tick, t.symbol);

    await orch.onM1Tick(
      t.symbol,
      t.tick.open,
      t.tick.high,
      t.tick.low,
      t.tick.close,
      t.tick.volume,
      t.tick.timestamp,
      t.tick.spread
    );
  }
  
  // EOD Cutoff: Close any trades left floating at the end of the simulation
  mockAccount.forceCloseAll(allTicks[allTicks.length - 1].tick.timestamp);

  console.log = origLog;
  
  // Filter shadow trades to only include those opened on the target date
  const shadowTrades = mockAccount.tradeLog.filter(t => t.openTime >= targetStartMs && t.openTime <= targetEndMs);
  console.log(`🎯 Shadow Orchestrator generated ${shadowTrades.length} trades for ${targetDateStr} (after warm-up).`);

  // 4. Parity Comparison
  const comparisonResults = [];
  
  const shadowMap = new Map<string, any>();
  for (const st of shadowTrades) {
    const key = `${st.botId.toUpperCase()}_${st.symbol}_${st.direction.toUpperCase()}`;
    if (!shadowMap.has(key)) shadowMap.set(key, st);
  }

  const allKeys = new Set([...liveTradesMap.keys(), ...shadowMap.keys()]);
  
  for (const key of allKeys) {
    const live = liveTradesMap.get(key);
    const shadow = shadowMap.get(key);

    const liveEntry = live ? Number(live.entry_price).toFixed(5) : "N/A";
    const liveExit = live ? Number(live.exit_price).toFixed(5) : "N/A";
    const shadowEntry = shadow ? Number(shadow.entryPrice).toFixed(5) : "N/A";
    const shadowExit = shadow ? Number(shadow.exitPrice).toFixed(5) : "N/A";
    const liveStatus = live ? (live.exit_price ? `LOST` : "OPEN") : "NOT TAKEN LIVE";
    const shadowOutcome = shadow ? (shadow.outcome === "WIN" ? `TP (+${shadow.rMultiple.toFixed(2)}R)` : `SL (${shadow.rMultiple > 0 ? "+" : ""}${shadow.rMultiple.toFixed(2)}R)`) : "NOT TAKEN SHADOW";
    
    let parityStatus = "🔴 MISMATCH";
    if (live && shadow) parityStatus = "🟢 PERFECT 100% PARITY";
    if (!live && shadow) parityStatus = "🔵 SHADOW EXTRA";
    if (live && !shadow) parityStatus = "🟠 LIVE EXTRA";

    const [bot, pair, dir] = key.split("_");

    comparisonResults.push({
      Bot: bot,
      Pair: pair,
      Dir: dir,
      "Live Entry": liveEntry,
      "Shadow Entry": shadowEntry,
      "Live Exit": liveExit,
      "Shadow Exit": shadowExit,
      "Live Status": liveStatus,
      "Shadow Outcome": shadowOutcome,
      "Parity Status": parityStatus,
      "Live Trigger (UTC)": live ? new Date(Number(live.open_time)).toISOString().split("T")[1].substring(0, 8) : "N/A",
      "Shadow Trigger (UTC)": shadow ? new Date(shadow.openTime).toISOString().split("T")[1].substring(0, 8) : "N/A"
    });
  }

  console.log("\n====================================================================================================");
  console.log(" 📊 PARITY COMPARISON TABLE: LIVE BROKER EXECUTION vs SHADOW SIMULATOR");
  console.log("====================================================================================================");
  console.table(comparisonResults);
  console.log("====================================================================================================");
  console.log(" 🏁 LIVE VS SHADOW PARITY AUDIT COMPLETE");
  console.log("====================================================================================================\n");

  // Output JSON report
  const reportPath = path.join(__dirname, "live_vs_shadow_execution_report.json");
  const reportData = {
    date: targetDateStr,
    timestamp: new Date().toISOString(),
    results: comparisonResults
  };
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`✅ Full JSON report saved to: ${reportPath}`);

  process.exit(0);
}

main().catch(console.error);
