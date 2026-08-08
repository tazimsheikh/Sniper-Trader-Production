/**
 * ATR Filter Comparison — MAGE Bot
 * Loads CSV once per pair, runs triggers WITH and WITHOUT ATR filter,
 * evaluates exits on the same data, and prints a side-by-side 6-month comparison.
 *
 * Usage: npx tsx server/trading/testing/atr_filter_comparison.ts
 */
import path from "path";
import fs from "fs";
import { loadCsv } from "../backtester/loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { buildAtrArray } from "../market/Indicators.js";
import { MAGE_PAIR_CONFIG, PairConfigManager } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { evaluateExits } from "../backtester/math_core/MageMathCore.js";
import { buildM1TypedArrays } from "../backtester/math_core/MathCoreUtils.js";

const END_DATE = new Date().toISOString().substring(0, 10);
const startRaw = new Date();
startRaw.setMonth(startRaw.getMonth() - 6);
const START_DATE = startRaw.toISOString().substring(0, 10);

const ALL_MAGE_PAIRS = Object.keys(MAGE_PAIR_CONFIG);

function preComputeTriggersATR(
  m5Candles, m1Rows, atrArr, pair, configs, isForex, spreadPts, pipSize, useAtrFilter
) {
  const triggers = [];
  const digits = pipSize < 0.001 ? 5 : pipSize < 0.01 ? 3 : pipSize < 0.1 ? 2 : 1;
  const rnd = (v) => parseFloat(v.toFixed(digits));

  for (const mCfg of configs) {
    const startMins = mCfg.orbStartHour * 60 + mCfg.orbStartMin;
    const orbMinutes = mCfg.orbMinutes;
    const minBodyPips = mCfg.minBodyPips;
    const sig = mCfg.signature || "default";
    let orHigh = -Infinity, orLow = Infinity, orStartTimestamp = 0, mageTradeTaken = false;

    for (let i = 0; i < m5Candles.length; i++) {
      const c = m5Candles[i];
      const estStr = new Date(c.timestamp).toLocaleString("en-US", { timeZone: "America/New_York" });
      const est = new Date(estStr + " UTC");
      const h = est.getUTCHours(), mm = est.getUTCMinutes();
      const currentMins = h * 60 + mm;

      if (i > 0) {
        const prev = m5Candles[i - 1];
        const pStr = new Date(prev.timestamp).toLocaleString("en-US", { timeZone: "America/New_York" });
        const pH = new Date(pStr + " UTC").getUTCHours();
        if ((pH < 17 && h >= 17) || (pH > h && h >= 17)) {
          orHigh = -Infinity; orLow = Infinity; orStartTimestamp = 0; mageTradeTaken = false;
        }
      }
      if (mageTradeTaken) continue;

      if (currentMins >= startMins && currentMins < startMins + orbMinutes) {
        if (orHigh === -Infinity) orStartTimestamp = c.timestamp;
        if (c.high > orHigh) orHigh = c.high;
        if (c.low < orLow) orLow = c.low;
        continue;
      }
      if (orHigh === -Infinity || currentMins < startMins + orbMinutes) continue;

      const endMins = mCfg.orbEndHour !== undefined
        ? mCfg.orbEndHour * 60 + (mCfg.orbEndMin || 0)
        : startMins + orbMinutes + (mCfg.actionMinutes || 180);
      const inWindow = endMins >= 1440
        ? (currentMins >= startMins + orbMinutes || currentMins < endMins % 1440)
        : (currentMins >= startMins + orbMinutes && currentMins < endMins);
      if (!inWindow) continue;

      const m1Idx = c.m1StartIndex || 0;
      const buyT = isForex ? c.close > orHigh : c.high >= orHigh + spreadPts;
      const sellT = isForex ? c.close < orLow : c.low <= orLow;
      if (!buyT && !sellT) continue;
      if (buyT && sellT) continue;
      if (buyT && Math.max(c.open, c.close) < orHigh) continue;
      if (sellT && Math.min(c.open, c.close) > orLow) continue;

      const cBodyPips = parseFloat((Math.abs(c.close - c.open) / pipSize).toFixed(1));
      if (minBodyPips !== undefined && cBodyPips < minBodyPips) continue;

      if (useAtrFilter) {
        const orPips = (orHigh - orLow) / pipSize;
        const atrVal = i >= 1 ? atrArr[i - 1] : 0;
        if (atrVal > 0) {
          const ratio = Math.round((orPips / (atrVal / pipSize)) * 100) / 100;
          if (ratio < 0.35 || ratio > 1.5) continue;
        }
      }

      if (mCfg.maxSlDist !== undefined) {
        const orPips = (orHigh - orLow) / pipSize;
        if (orPips + spreadPts / pipSize > mCfg.maxSlDist) continue;
      }

      mageTradeTaken = true;
      const rOrHigh = rnd(orHigh), rOrLow = rnd(orLow);
      triggers.push({
        m5Index: i,
        m1Index: Math.min(m1Rows.length - 1, m1Idx + 5),
        direction: buyT ? "BUY" : "SELL",
        orHigh: rOrHigh, orLow: rOrLow,
        boxSize: rnd(Math.abs(rOrHigh - rOrLow)),
        cBodyPips, orStartTimestamp, signature: sig,
      });
    }
  }
  return triggers;
}

async function runBothModes(pair) {
  const empty = () => ({ pair, trades: 0, netR: 0, wins: 0, losses: 0, winRate: 0 });
  const configs = PairConfigManager.getMageConfigs(pair);
  if (!configs || !configs.length) return { withATR: empty(), withoutATR: empty() };
  const baseSymbol = pair.replace(".Daily", "");
  const optConfig = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[baseSymbol];
  if (!optConfig) return { withATR: empty(), withoutATR: empty() };

  const { pipSize, spread } = optConfig;
  const spreadPts = spread * pipSize;
  const isForex = PairConfigManager.isForex(pair);

  const csvDir = path.join(process.cwd(), "data", "csv");
  const csvFiles = fs.readdirSync(csvDir).filter(f => f.startsWith(pair.split("_")[0]) && f.endsWith(".csv"));
  if (!csvFiles.length) { console.warn(`  No CSV for ${pair}`); return { withATR: empty(), withoutATR: empty() }; }

  const startD = new Date(new Date(START_DATE).getTime() - 15 * 86400000);
  const endD = new Date(END_DATE + "T23:59:59Z");

  const csvSizeMB = Math.round(fs.statSync(path.join(csvDir, csvFiles[0])).size / 1024 / 1024);
  process.stdout.write(`(loading ${csvSizeMB}MB CSV...)`);
  const t0 = Date.now();
  const m1Rows = await loadCsv(path.join(csvDir, csvFiles[0]), spread, startD, endD);
  process.stdout.write(` ${((Date.now()-t0)/1000).toFixed(1)}s, ${m1Rows.length} rows -> evaluating...`);
  const m5Candles = aggregateCandles(m1Rows, 5);
  const atrArr = buildAtrArray(m5Candles, 14);
  const m1Typed = buildM1TypedArrays(m1Rows, new Set(), new Set(), new Set());
  const targetStartMs = new Date(START_DATE).getTime();

  function evalMode(useAtrFilter) {
    const triggers = preComputeTriggersATR(m5Candles, m1Rows, atrArr, pair, configs, isForex, spreadPts, pipSize, useAtrFilter);
    const exitResult = evaluateExits(m1Typed, m5Candles, triggers, pair, configs[0], configs[0].session || "london", isForex);
    const records = exitResult.records || [];
    const filtered = records.filter(r => (r.openTime || r.timestamp || 0) >= targetStartMs);
    let netR = 0, wins = 0, losses = 0;
    for (const r of filtered) {
      const v = r.rMultiple ?? 0;
      netR += v;
      if (v > 0) wins++; else if (v < 0) losses++;
    }
    return { pair, trades: filtered.length, netR: Math.round(netR * 100) / 100, wins, losses, winRate: filtered.length > 0 ? Math.round(wins / filtered.length * 1000) / 10 : 0 };
  }

  return { withATR: evalMode(true), withoutATR: evalMode(false) };
}

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ATR-Relative OR Filter Impact Analysis - MAGE Bot`);
  console.log(`  Date Range: ${START_DATE} to ${END_DATE} (Last 6 Months)`);
  console.log(`  ATR Filter: OR/ATR14 ratio must be >= 0.35 and <= 1.5`);
  console.log(`${"=".repeat(70)}\n`);

  const resultsWithATR = [];
  const resultsWithoutATR = [];

  for (const pair of ALL_MAGE_PAIRS) {
    process.stdout.write(`\n  [${pair.padEnd(12)}]  `);
    const { withATR, withoutATR } = await runBothModes(pair);
    resultsWithATR.push(withATR);
    resultsWithoutATR.push(withoutATR);
    console.log(`OK  ATR: ${withATR.trades}T / ${withATR.netR.toFixed(2)}R   |   No ATR: ${withoutATR.trades}T / ${withoutATR.netR.toFixed(2)}R`);
  }

  console.log(`\n${"=".repeat(105)}`);
  console.log(`  SIDE-BY-SIDE COMPARISON TABLE`);
  console.log(`${"=".repeat(105)}`);
  console.log(`${"Pair".padEnd(12)} | ${"ATR ON".padStart(7)} ${"WR%".padStart(6)} ${"Trd".padStart(4)} | ${"ATR OFF".padStart(8)} ${"WR%".padStart(6)} ${"Trd".padStart(4)} | ${"DeltaR".padStart(8)} | ${"DeltaT".padStart(7)} | Verdict`);
  console.log("-".repeat(105));

  let totWith = 0, totWithout = 0, totTW = 0, totTWO = 0;

  for (let i = 0; i < ALL_MAGE_PAIRS.length; i++) {
    const pair = ALL_MAGE_PAIRS[i];
    const w = resultsWithATR[i];
    const wo = resultsWithoutATR[i];
    const dR = Math.round((w.netR - wo.netR) * 100) / 100;
    const dT = w.trades - wo.trades;
    totWith += w.netR; totWithout += wo.netR; totTW += w.trades; totTWO += wo.trades;

    const rPTw = w.trades > 0 ? w.netR / w.trades : 0;
    const rPTwo = wo.trades > 0 ? wo.netR / wo.trades : 0;
    let verdict = dT === 0 ? "NO CHANGE" : (rPTw > rPTwo && dR >= 0 ? "ATR HELPS" : (rPTw < rPTwo ? "ATR HURTS" : "MIXED"));

    console.log(`${pair.padEnd(12)} | ${w.netR.toFixed(2).padStart(7)} ${(w.winRate + "%").padStart(6)} ${String(w.trades).padStart(4)} | ${wo.netR.toFixed(2).padStart(8)} ${(wo.winRate + "%").padStart(6)} ${String(wo.trades).padStart(4)} | ${dR.toFixed(2).padStart(8)} | ${String(dT).padStart(7)} | ${verdict}`);
  }

  const totDelta = Math.round((totWith - totWithout) * 100) / 100;
  console.log("-".repeat(105));
  console.log(`${"TOTAL".padEnd(12)} | ${totWith.toFixed(2).padStart(7)} ${"".padStart(6)} ${String(totTW).padStart(4)} | ${totWithout.toFixed(2).padStart(8)} ${"".padStart(6)} ${String(totTWO).padStart(4)} | ${totDelta.toFixed(2).padStart(8)} | ${String(totTW - totTWO).padStart(7)} |`);
  console.log(`${"=".repeat(105)}\n`);

  const blockedTrades = totTWO - totTW;
  const rPTwith = totTW > 0 ? totWith / totTW : 0;
  const rPTwout = totTWO > 0 ? totWithout / totTWO : 0;
  console.log(`OVERALL ASSESSMENT:`);
  console.log(`  ATR filter blocks ${blockedTrades} trades over last 6 months.`);
  console.log(`  Net R impact:     ${totDelta >= 0 ? "+" : ""}${totDelta.toFixed(2)}R  ${rPTwith >= rPTwout && totDelta >= 0 ? "(ATR FILTER IS HELPING)" : "(ATR FILTER IS HURTING)"}`);
  console.log(`  R/trade WITH ATR: ${rPTwith.toFixed(4)}R`);
  console.log(`  R/trade NO  ATR:  ${rPTwout.toFixed(4)}R`);
}

main().catch(console.error);
