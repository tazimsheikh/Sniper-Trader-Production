import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Force Simulation Mode
process.env.SIMULATION_MODE = 'true';

// 2. Mock time using Sinon
import sinon from 'sinon';
const startDateMs = new Date('2025-05-01T00:00:00Z').getTime();
const endDateMs = new Date('2026-05-01T00:00:00Z').getTime();
const clock = sinon.useFakeTimers({
  now: startDateMs,
  toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
});

import { loadCsvData, setSimulatedTime } from '../server/simulationProvider';
import { initMarketStore, updateMarketPrices, getMarkets, getMarketSpreads } from '../server/marketStore';
import { botManagerTick } from '../server/botManager';
import db from '../server/db';
import { BOT_REGISTRY, ensureBotSchema } from '../server/botManager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSimulation() {
  console.log('=== STARTING 1-YEAR BACKTEST SIMULATION ===');
  console.log(`Time Range: 2025-05-01 to 2026-05-01`);

  // Setup Database for Simulation
  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, password_hash, metaapi_token)
    VALUES (999, 'simulation@test.com', 'dummy_hash', 'dummy_token')
  `).run();

  const activeBotsJson = JSON.stringify(Object.keys(BOT_REGISTRY));

  db.prepare(`
    INSERT OR REPLACE INTO trading_profiles (id, user_id, profile_name, metaapi_token, metaapi_account_id, risk_multiplier, automation_active, ai_sniper_active, active_bots)
    VALUES (999, 999, 'Simulation Profile', 'dummy_token', 'dummy_acc', 1.0, 1, 1, ?)
  `).run(activeBotsJson);

  await ensureBotSchema();

  // Clear any existing simulation trades
  db.prepare(`DELETE FROM trade_diary WHERE profile_id = 999`).run();
  db.prepare(`DELETE FROM bot_trade_states WHERE profile_id = 999`).run();

  // Load all CSV data
  const dataDir = path.join(__dirname, '..', 'data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));
  for (const file of files) {
    const symbolMatch = file.match(/^([A-Z0-9]+)_M1/);
    if (symbolMatch) {
      let brokerSymbol = symbolMatch[1];
      if (brokerSymbol === 'NAS100') brokerSymbol = 'USTEC';
      await loadCsvData(brokerSymbol, file);
    }
  }

  // Initialize Market Store
  await initMarketStore();

  let currentMs = startDateMs;
  let minuteCount = 0;

  // The simulation loop
  while (currentMs <= endDateMs) {
    setSimulatedTime(currentMs);
    clock.tick(60000); // Advance fake timers by 1 minute

    // We have 3 batches in marketStore, so we call it 3 times to refresh all 21 pairs for the current minute
    await updateMarketPrices(true);
    await updateMarketPrices(true);
    await updateMarketPrices(true);

    const spreads = getMarketSpreads();
    const marketsSnapshot = Object.fromEntries(
      getMarkets().map(m => {
        const spread = spreads[m.symbol] || { bid: m.currentPrice, ask: m.currentPrice };
        return [m.symbol, { ...m, bid: spread.bid, ask: spread.ask }];
      })
    );

    await botManagerTick(() => marketsSnapshot);

    currentMs += 60000;
    minuteCount++;

    if (minuteCount % 1440 === 0) { // Log every simulated day
      console.log(`[Simulation] Processed ${minuteCount / 1440} days. Current simulated time: ${new Date().toISOString()}`);
    }
  }

  console.log('=== SIMULATION COMPLETE ===');
  console.log('Generating Report...');

  // Generate Report
  const trades = db.prepare(`SELECT * FROM trade_diary WHERE profile_id = 999`).all() as any[];
  const wins = trades.filter(t => t.profit_usd > 0).length;
  const losses = trades.filter(t => t.profit_usd <= 0).length;
  const totalProfit = trades.reduce((sum, t) => sum + t.profit_usd, 0);
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  console.log(`Total Trades: ${trades.length}`);
  console.log(`Wins: ${wins}`);
  console.log(`Losses: ${losses}`);
  console.log(`Win Rate: ${winRate.toFixed(2)}%`);
  console.log(`Net Profit: $${totalProfit.toFixed(2)}`);
  
  clock.restore();
}

runSimulation().catch(err => {
  console.error('Simulation Failed:', err);
  process.exit(1);
});
