/**
 * Targeted trace: SAGE EURUSD April 1 2026
 * Run: npx tsx server/trading/testing/trace_sage_eurusd.ts
 */
import path from 'path';
import fs from 'fs';
import { loadCsv } from '../backtester/loadCsv.js';
import { aggregateCandles } from '../market/CandleAggregator.js';
import { OPTIMIZER_CONFIG } from '../config/OptimizerPairConfig.js';
import { preComputeTriggers } from '../backtester/math_core/SageMathCore.js';
import { getFixedEstDate } from '../backtester/math_core/MathCoreUtils.js';
import { isEODSession } from '../market/MathFilters.js';
import { PairConfigManager } from '../config/PairConfig.js';
import { isNewsForceClose } from '../market/historicalNews.js';

const PRICE_EPSILON = 1e-9;
const gte = (a: number, b: number) => (a - b) >= -PRICE_EPSILON;

async function main() {
  const pair    = 'EURUSD';
  const optCfg  = OPTIMIZER_CONFIG[pair];
  const pipSize  = optCfg.pipSize;
  const spreadPts = optCfg.spread * pipSize;

  // Load data: 15-day warmup + April
  const csvDir  = path.join(process.cwd(), 'data', 'csv');
  const csvFile = fs.readdirSync(csvDir).find(f => f.startsWith('EURUSD') && f.endsWith('.csv'))!;
  const startD  = new Date('2026-03-17');
  const endD    = new Date('2026-04-02T23:59:59Z');

  const m1Rows = await loadCsv(path.join(csvDir, csvFile), optCfg.spread, startD, endD);
  const m5Candles = aggregateCandles(m1Rows, 5);

  // Build typed arrays
  const m1Length = m1Rows.length;
  const m1Typed: any = {
    open: new Float64Array(m1Length), high: new Float64Array(m1Length),
    low:  new Float64Array(m1Length), close: new Float64Array(m1Length),
    timestamp: new Float64Array(m1Length),
    estHour: new Int32Array(m1Length), minute: new Int32Array(m1Length),
    isSessionReset: new Uint8Array(m1Length), isMidnightExpiry: new Uint8Array(m1Length),
    isEOD_standard: new Uint8Array(m1Length), isNewsForceClose: new Uint8Array(m1Length),
    length: m1Length,
  };
  for (let i = 0; i < m1Length; i++) {
    const r = m1Rows[i];
    m1Typed.open[i]      = r.open;
    m1Typed.high[i]      = r.high;
    m1Typed.low[i]       = r.low;
    m1Typed.close[i]     = r.close;
    m1Typed.timestamp[i] = r.timestamp;
    m1Typed.estHour[i]   = r.estHour;
    m1Typed.minute[i]    = r.minute;
    if (i > 0) {
      const prevH = m1Rows[i-1].estHour;
      m1Typed.isSessionReset[i]   = ((prevH < 17 && r.estHour >= 17)||(prevH > r.estHour && r.estHour >= 17)||(r.estHour===17&&r.minute===0)) ? 1 : 0;
      m1Typed.isMidnightExpiry[i] = (prevH > r.estHour && r.estHour < 17) ? 1 : 0;
    }
    const dStr = getFixedEstDate(new Date(r.timestamp)).toISOString().split('T')[0];
    m1Typed.isEOD_standard[i]    = isEODSession(r.estHour, r.minute) ? 1 : 0;
    m1Typed.isNewsForceClose[i]  = isNewsForceClose(dStr, r.estHour, r.minute) ? 1 : 0;
  }

  // Get SAGE EURUSD London config
  const sageConfigs = PairConfigManager.getSageConfigs(pair);
  const londonCfg   = sageConfigs.find((c: any) => c.orbStartHour === 3 && c.orbStartMin === 15)!;
  console.log('London EURUSD SAGE config:', JSON.stringify(londonCfg, null, 2));

  const triggers = preComputeTriggers(
    m5Candles, m1Rows, pair, spreadPts, 'london', true, pipSize,
    londonCfg.orbStartHour!, londonCfg.orbStartMin!, londonCfg.orbMinutes!,
    londonCfg.sweepPips, londonCfg.actionMinutes,
    (londonCfg as any).maxSweepMultiplier, (londonCfg as any).requireCloseInside,
    (londonCfg as any).htfAlignmentRequired, (londonCfg as any).maxH1EmaSlope,
    (londonCfg as any).minWbr, (londonCfg as any).requireCloseLocationHalf,
    (londonCfg as any).useHtfSarFilter
  );

  // Find the trigger for Apr 1
  const apr1Ms = new Date('2026-04-01').getTime();
  const apr2Ms = new Date('2026-04-02').getTime();
  const apr1Triggers = triggers.filter((t: any) => t.actionCandleTimestamp >= apr1Ms && t.actionCandleTimestamp < apr2Ms);
  console.log(`\nFound ${apr1Triggers.length} triggers on Apr 1`);
  if (apr1Triggers.length === 0) { console.log('No triggers found!'); return; }

  const t = apr1Triggers[0];
  console.log(`Trigger: m5Index=${t.m5Index}, m1Index=${t.m1Index}, direction=${t.direction}`);
  console.log(`orHigh=${t.orHigh}, orLow=${t.orLow}, boxSize=${t.boxSize ?? Math.abs(t.orHigh-t.orLow)}`);

  // ── Replicate the trade manually ─────────────────────────────────────────────
  const config = londonCfg as any;
  const pct     = (config.entryPenetrationPct ?? 0) / 100;
  const boxSize = t.boxSize ?? Math.abs(t.orHigh - t.orLow);
  
  // SELL: limit at orHigh - box*pct (pullback up toward orHigh)
  const limitSellPrice = Number((t.orLow + boxSize * pct).toFixed(5));
  const sweepBuffer    = (config.sweepPips ?? 0) * pipSize;
  let   proposedSl     = t.orHigh + sweepBuffer + spreadPts;

  // clamp to minSlDist
  if (config.minSlDist !== undefined) {
    if (Math.abs(limitSellPrice - proposedSl) / pipSize < config.minSlDist - 0.001) {
      proposedSl = limitSellPrice + config.minSlDist * pipSize;
    }
  }
  const slPrice     = Number(proposedSl.toFixed(5));
  const initialRisk = Math.abs(limitSellPrice - slPrice);

  const tTrig = config.trailingSlTrigger;
  const tStep = config.trailingSlStep;

  console.log(`\n--- SELL trade ---`);
  console.log(`limitSellPrice=${limitSellPrice.toFixed(5)}, slPrice=${slPrice.toFixed(5)}`);
  console.log(`initialRisk=${initialRisk.toFixed(5)} (${(initialRisk/pipSize).toFixed(1)} pips)`);
  console.log(`tTrig=${tTrig}, tStep=${tStep}, spread=${spreadPts.toFixed(5)}`);
  console.log(`entryPenetrationPct raw=${config.entryPenetrationPct}, pct=${pct}`);

  // NOTE: in SageMathCore, for entryPenetrationPct>0:
  //   limitPrice = limitSellPrice (orLow + boxSize * pct)  ← WRONG for SELL sweep!
  // But let's check what it actually is in the sweep logic...
  // SAGE: limitSellPrice in SageMathCore is computed differently:
  // "entryPenetrationPct" means how far INTO the range the limit is placed.
  // For SELL sweep: orHigh is swept (price goes above orHigh = sweep trigger).
  // Limit SELL order placed at: orHigh - boxSize * pct/100 (INSIDE the range)
  // i.e. BELOW orHigh. Check preComputeTriggers to see what limitPrice is.
  console.log('\nNow check SageMathCore preComputeTriggers to verify limitSellPrice logic...');
  console.log(`If entryPenetrationPct=${config.entryPenetrationPct}: limitSellPrice in core = orHigh - boxSize*(pct/100)?`);
  console.log(`Expected: ${(t.orHigh - boxSize * (config.entryPenetrationPct/100)).toFixed(5)}`);
  console.log(`Using orLow: ${(t.orLow + boxSize * (config.entryPenetrationPct/100)).toFixed(5)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
