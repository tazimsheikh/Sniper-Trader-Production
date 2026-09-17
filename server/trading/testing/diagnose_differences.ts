import fs from "fs";
import path from "path";
import { PortfolioMockBrokerAccount } from "../backtester/stubs/PortfolioMockBrokerAccount.js";
import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";

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

async function main() {
  await registerStubs();
  const mod = await import("../engine/LiveOrchestrator.js");
  const LiveOrchestrator = mod.LiveOrchestrator;

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

  const targetDateStr = "2026-09-14";
  const todayDir = path.join(process.cwd(), "data", "today_csv");
  const testPairs = ["XAUUSD", "NZDUSD", "US30", "USDJPY"];

  const allTicks: { symbol: string; tick: any }[] = [];

  for (const pair of testPairs) {
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
            estHour: estDate.getUTCHours(),
            estMin: estDate.getUTCMinutes(),
          },
        });
      }
    }
  }

  allTicks.sort((a, b) => a.tick.timestamp - b.tick.timestamp);
  console.log(`Replaying ${allTicks.length} ticks for ${testPairs.join(", ")}...`);

  // Intercept trade execution events
  const trades: any[] = [];
  mockAccount.onOrderExecuted = (order: any) => {
    trades.push({ type: "EXEC", ...order, timeUTC: new Date(order.openTime).toISOString() });
    console.log(`>>> [TRADE FIRED] ${order.botId} ${order.symbol} ${order.direction} at ${order.entryPrice} | UTC: ${new Date(order.openTime).toISOString()}`);
  };

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

  console.log("\nTotal trades executed in simulator for target pairs:", mockAccount.tradeLog.length);
  for (const tr of mockAccount.tradeLog) {
    console.log(`- ${tr.botId} ${tr.symbol} ${tr.direction} | Open: ${new Date(tr.openTime).toISOString()} @ ${tr.entryPrice} | Close: ${new Date(tr.closeTime).toISOString()} @ ${tr.exitPrice} | R: ${tr.rMultiple} (${tr.outcome})`);
  }
}

main().catch(console.error);
