import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PairConfigManager } from '../config/PairConfig.js';
import { OPTIMIZER_CONFIG } from '../config/OptimizerPairConfig.js';
import { loadCsv, normalizeM1Data } from '../backtester/loadCsv.js';
import { aggregateCandles } from '../market/CandleAggregator.js';
import { buildM1TypedArrays } from '../backtester/math_core/MathCoreUtils.js';

import { preComputeTriggers as preComputeWithAtr, evaluateExits as evaluateExitsWithAtr } from '../backtester/math_core/MageMathCore.js';
import { preComputeTriggers as preComputeNoAtr, evaluateExits as evaluateExitsNoAtr } from './MageMathCoreNoAtr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CSV_DIR = path.join(REPO_ROOT, 'data', 'csv');

// Set simulator flag
(global as any).isSimulator = true;
(global as any).__SIM_DB__ = {
  getProfileData: () => ({ dwcb_enabled: 0, institutional_enabled: 0 }),
  updatePeakBalance: () => {},
};

async function testAtrFilter() {
  const pairsToTest = [
    { raw: 'US30.Daily', pair: 'US30' },
    { raw: 'NAS100.Daily', pair: 'NAS100' },
    { raw: 'GER40.Daily', pair: 'GER40' },
    { raw: 'XAUUSD', pair: 'XAUUSD' },
    { raw: 'GBPUSD', pair: 'GBPUSD' },
    { raw: 'USDJPY', pair: 'USDJPY' }
  ];
  const results: any[] = [];
  
  for (const { raw, pair } of pairsToTest) {
    const isForex = PairConfigManager.isForex(pair);
    
    // Get the configured Mage setup from the Holy Grail portfolio
    const mageConfigs = PairConfigManager.getMageConfigs(pair);
    if (!mageConfigs || mageConfigs.length === 0) {
      console.log(`Skipping ${pair}: No Mage config found`);
      continue;
    }
    
    // Take the first available session for this pair
    const mCfg = mageConfigs[0];
    const sessionName = mCfg.session;
    const optCfg = OPTIMIZER_CONFIG[pair];
    const pipSize = optCfg ? optCfg.pipSize : 0.0001;
    const spreadPts = optCfg ? optCfg.spread * pipSize : 0;
    
    const csvPath = path.join(CSV_DIR, `${raw}_M1.csv`);
    if (!fs.existsSync(csvPath)) continue;
    
    console.log(`\n===========================================`);
    console.log(`🚀 Testing ${pair} (${sessionName})`);
    console.log(`===========================================`);
    
    const rows = await loadCsv(csvPath);
    console.log(`   Loaded ${rows.length} rows.`);
    
    const m5Candles = aggregateCandles(rows, 5);
    const m1Data = buildM1TypedArrays(rows);
    
    // ---------------------------------------------------------
    // 1. Run WITH ATR
    // ---------------------------------------------------------
    const triggersWithAtr = preComputeWithAtr(
      m5Candles, rows, pair, spreadPts, sessionName, isForex, pipSize,
      mCfg.orbStartHour ?? 0, mCfg.orbStartMin ?? 0, mCfg.orbMinutes ?? 15, mCfg.actionMinutes ?? 5, mCfg.minBodyPips
    );
    const resWithAtr = evaluateExitsWithAtr(m1Data, m5Candles, triggersWithAtr, pair, mCfg, sessionName, isForex);
    
    // ---------------------------------------------------------
    // 2. Run WITHOUT ATR
    // ---------------------------------------------------------
    const triggersNoAtr = preComputeNoAtr(
      m5Candles, rows, pair, spreadPts, sessionName, isForex, pipSize,
      mCfg.orbStartHour ?? 0, mCfg.orbStartMin ?? 0, mCfg.orbMinutes ?? 15, mCfg.actionMinutes ?? 5, mCfg.minBodyPips
    );
    const resNoAtr = evaluateExitsNoAtr(m1Data, m5Candles, triggersNoAtr, pair, mCfg, sessionName, isForex);
    
    console.log(`   [ATR ON]  Trades: ${resWithAtr.trades} | Win Rate: ${resWithAtr.winRate.toFixed(2)}% | Net R: ${resWithAtr.totalNetR.toFixed(2)} R`);
    console.log(`   [ATR OFF] Trades: ${resNoAtr.trades} | Win Rate: ${resNoAtr.winRate.toFixed(2)}% | Net R: ${resNoAtr.totalNetR.toFixed(2)} R`);
    
    const diff = resWithAtr.totalNetR - resNoAtr.totalNetR;
    const isHelping = diff > 0;
    
    console.log(`   => ATR Filter Impact: ${diff > 0 ? '+' : ''}${diff.toFixed(2)} R`);
    
    results.push({
      pair,
      tradesOn: resWithAtr.trades,
      tradesOff: resNoAtr.trades,
      netROn: resWithAtr.totalNetR,
      netROff: resNoAtr.totalNetR,
      diff,
      isHelping
    });
  }
  
  console.log(`\n===========================================`);
  console.log(`🏆 FINAL CONCLUSION OVER MULTIPLE YEARS`);
  console.log(`===========================================`);
  let totalNetRAtrOn = 0;
  let totalNetRAtrOff = 0;
  let totalTradesOn = 0;
  let totalTradesOff = 0;
  
  for (const r of results) {
    totalNetRAtrOn += r.netROn;
    totalNetRAtrOff += r.netROff;
    totalTradesOn += r.tradesOn;
    totalTradesOff += r.tradesOff;
  }
  
  console.log(`Total Portfolio Net R (ATR ON) : ${totalNetRAtrOn.toFixed(2)} R (Trades: ${totalTradesOn})`);
  console.log(`Total Portfolio Net R (ATR OFF): ${totalNetRAtrOff.toFixed(2)} R (Trades: ${totalTradesOff})`);
  const globalDiff = totalNetRAtrOn - totalNetRAtrOff;
  console.log(`Global Edge from ATR Filter: ${globalDiff > 0 ? '+' : ''}${globalDiff.toFixed(2)} R`);
}

testAtrFilter().catch(console.error);
