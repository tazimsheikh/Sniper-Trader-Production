// ============================================================
// mage_atr_ratio_optimizer.ts
//
// Tests different minAtrRatio thresholds on all Mage configs
// in the live grandmaster_portfolio.json.
//
// For each threshold candidate: 0.35 (current) → 0.50 → 0.80
// → 1.00 → 1.10 → 1.20 → 1.40:
//   - Shows trades blocked vs retained
//   - Shows losses cut vs winners sacrificed
//   - Shows new Net R and Win Rate
//   - Per-pair breakdown
//
// Usage:
//   npx tsx server/trading/testing/mage_atr_ratio_optimizer.ts
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { runMathBacktest as runMageMathBacktest, clearMageBacktestCache } from "../backtester/MageMathBacktester.js";
import { buildAtrArray } from "../market/Indicators.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { getFixedEstDate } from "../backtester/math_core/MathCoreUtils.js";
import { HTFContextTracker } from "../market/HTFContextTracker.js";

const START_DATE = "2025-09-01";
const END_DATE = "2026-08-31";
const PORTFOLIO_JSON = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster", "grandmaster_portfolio.json");
const OUTPUT_FILE = path.join(process.cwd(), "mage_atr_ratio_test.txt");

// Thresholds to test (as minAtrRatio — ORB must be >= this multiple of ATR)
const THRESHOLDS = [0.35, 0.50, 0.80, 1.00, 1.10, 1.20, 1.40];

function parseSetupToConfig(setupStr: string): any {
  const parts = setupStr.split("_");
  let session = parts[0];
  if (parts[0] === "NY") session = `NY_${parts[1]}`;
  const findNum = (prefix: string, isSuffix = false): number | undefined => {
    const p = isSuffix ? parts.find(item => item.endsWith(prefix)) : parts.find(item => item.startsWith(prefix));
    if (!p) return undefined;
    const raw = isSuffix ? p.slice(0, -prefix.length) : p.slice(prefix.length);
    const n = parseFloat(raw); return isNaN(n) ? undefined : n;
  };
  const findStr = (prefix: string): string | undefined => { const p = parts.find(item => item.startsWith(prefix)); return p ? p.slice(prefix.length) : undefined; };
  return {
    session,
    orbEnabled: true,
    orbStartHour: findNum("StartH") ?? 0,
    orbStartMin: findNum("StartM") ?? 0,
    orbMinutes: findNum("OrbMins") ?? 10,
    actionMinutes: findNum("ActMins") ?? 60,
    minSlDist: findNum("MinSL") ?? 10,
    maxSlDist: findNum("MaxSl") ?? findNum("MaxSL") ?? 100,
    minBodyPips: findNum("Body") ?? 0,
    exitMode: findStr("Exit") ?? "TRAILING",
    trailingSlTrigger: findNum("Trig") ?? 0,
    trailingSlStep: findNum("Step") ?? 0,
    forceCloseHours: findNum("FC") ?? 24,
    htfAlignmentRequired: true,
    maxH1EmaSlope: 20,
  };
}

interface TradeWithATR {
  pair: string;
  setup: string;
  rMultiple: number;
  isWin: boolean;
  atrRatio: number; // orPips / atrPips at entry
  orPips: number;
  atrPips: number;
  date: string;
  entryHour: number;
  direction: string;
}

async function main() {
  const lines: string[] = [];
  const log = (...args: any[]) => { const t = args.map(String).join(" "); console.log(t); lines.push(t); };

  log("=".repeat(100));
  log("  MAGE ATR RATIO FILTER — THRESHOLD SWEEP");
  log(`  Date range: ${START_DATE} --> ${END_DATE}`);
  log(`  Testing thresholds: ${THRESHOLDS.join(", ")}`);
  log("=".repeat(100));

  const portfolio: any[] = JSON.parse(fs.readFileSync(PORTFOLIO_JSON, "utf-8"));
  const magePairs = portfolio.filter(c => c.botType === "Mage");

  const seen = new Set<string>();
  const uniqueMage = magePairs.filter(c => {
    const k = `${c.symbol}::${c.setup}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  log(`\n  Mage configs in live portfolio: ${uniqueMage.length}\n`);

  const allTradesWithATR: TradeWithATR[] = [];

  // ── Collect all trades with their ATR ratio ──────────────────────────────
  for (const comp of uniqueMage) {
    const cfg = parseSetupToConfig(comp.setup);
    cfg.signature = comp.setup;
    log(`  Loading: ${comp.symbol} | ${comp.setup.substring(0, 65)}`);

    let records: any[] = [], m5: any[] = [];
    try {
      const res = await runMageMathBacktest(comp.symbol, START_DATE, END_DATE, false, undefined, undefined, null, [cfg], false);
      records = (res.records || []).filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE" && r.rMultiple !== undefined);
      m5 = (res as any).m5Candles || [];
      clearMageBacktestCache(comp.symbol);
    } catch (e: any) { log(`    [ERROR] ${e.message}`); continue; }

    if (!records.length || !m5.length) { log(`    0 trades or no candles`); continue; }
    log(`    ${records.length} trades loaded`);

    const optKey = comp.symbol.replace(/\.daily$/i, "").split("_")[0].toUpperCase();
    const optCfg = OPTIMIZER_CONFIG[optKey] || OPTIMIZER_CONFIG[comp.symbol] || OPTIMIZER_CONFIG[comp.symbol.replace(/\.daily$/i, "")];
    const pip = optCfg?.pipSize ?? 0.0001;
    const atrArr = buildAtrArray(m5, 14);

    const tsIdx = new Map<number, number>();
    for (let i = 0; i < m5.length; i++) tsIdx.set(m5[i].timestamp, i);

    for (const r of records) {
      const ts = r.timestamp ?? r.openTime ?? 0;
      let m5i = tsIdx.get(ts);
      if (m5i === undefined) {
        let lo = 0, hi = m5.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (m5[mid].timestamp < ts) lo = mid + 1; else hi = mid; }
        m5i = lo;
      }

      const atrV = m5i > 0 ? (atrArr[m5i - 1] ?? 0) : 0;
      const atrPips = atrV / pip;
      const orH = r.orHigh ?? 0, orL = r.orLow ?? 0;
      const orPips = (orH - orL) / pip;
      const atrRatio = atrPips > 0 && orPips > 0 ? orPips / atrPips : -1;

      const estE = getFixedEstDate(new Date(ts));
      let dir = "?";
      if (r.direction) dir = r.direction;
      else if (r.entry != null && r.stopLoss != null) dir = r.entry > r.stopLoss ? "BUY" : "SELL";

      allTradesWithATR.push({
        pair: comp.symbol,
        setup: comp.setup,
        rMultiple: r.rMultiple ?? 0,
        isWin: (r.rMultiple ?? 0) > 0,
        atrRatio,
        orPips,
        atrPips,
        date: estE.toISOString().split("T")[0],
        entryHour: estE.getUTCHours(),
        direction: dir,
      });
    }
  }

  const validTrades = allTradesWithATR.filter(t => t.atrRatio >= 0);
  const baselineAll = allTradesWithATR;
  const baseNetR = baselineAll.reduce((s, t) => s + t.rMultiple, 0);
  const baseWins = baselineAll.filter(t => t.isWin).length;
  const baseWR = (baseWins / baselineAll.length * 100);

  log("\n\n" + "=".repeat(100));
  log("  BASELINE (current minAtrRatio = 0.35 — effectively no filter)");
  log("=".repeat(100));
  log(`  Total Mage trades : ${baselineAll.length}`);
  log(`  Win Rate          : ${baseWR.toFixed(1)}%`);
  log(`  Net R             : +${baseNetR.toFixed(2)}R`);
  log(`  Trades with valid ATR ratio: ${validTrades.length}`);

  // ATR ratio distribution for context
  log("\n  ATR Ratio Distribution (all Mage trades with valid ratio):");
  const distBuckets = [
    { label: "<0.50",    fn: (r: number) => r < 0.50 },
    { label: "0.50-0.80", fn: (r: number) => r >= 0.50 && r < 0.80 },
    { label: "0.80-1.10", fn: (r: number) => r >= 0.80 && r < 1.10 },
    { label: "1.10-1.40", fn: (r: number) => r >= 1.10 && r < 1.40 },
    { label: ">1.40",    fn: (r: number) => r >= 1.40 },
  ];
  for (const b of distBuckets) {
    const inB = validTrades.filter(t => b.fn(t.atrRatio));
    const wB = inB.filter(t => t.isWin);
    const nR = inB.reduce((s, t) => s + t.rMultiple, 0);
    const wr = inB.length ? (wB.length / inB.length * 100) : 0;
    log(`    ${b.label.padEnd(12)} : ${inB.length.toString().padStart(4)} trades | WR=${wr.toFixed(1)}% | NetR=${nR.toFixed(2)}R | W=${wB.length} L=${inB.length - wB.length}`);
  }

  // ── Threshold sweep ──────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(100));
  log("  THRESHOLD SWEEP — Impact of raising minAtrRatio");
  log("=".repeat(100));
  log("\n  " +
    "THRESHOLD".padEnd(12) + "RETAINED".padStart(10) + "BLOCKED".padStart(9) +
    "L_CUT".padStart(8) + "W_LOST".padStart(8) +
    "NEW_WR".padStart(9) + "NEW_NETR".padStart(11) +
    "DELTA_R".padStart(10) + "  VERDICT"
  );
  log("  " + "-".repeat(100));

  type ThresholdResult = {
    threshold: number;
    retained: TradeWithATR[];
    blocked: TradeWithATR[];
    newNetR: number;
    newWR: number;
    lossesBlocked: number;
    winsLost: number;
    deltaR: number;
  };

  const results: ThresholdResult[] = [];

  for (const thresh of THRESHOLDS) {
    // Trades with unknown ATR ratio are always retained (we can't filter them)
    const noRatio = allTradesWithATR.filter(t => t.atrRatio < 0);
    const withRatio = allTradesWithATR.filter(t => t.atrRatio >= 0);
    const retained = [...noRatio, ...withRatio.filter(t => t.atrRatio >= thresh)];
    const blocked = withRatio.filter(t => t.atrRatio < thresh);

    const newNetR = retained.reduce((s, t) => s + t.rMultiple, 0);
    const newWins = retained.filter(t => t.isWin).length;
    const newWR = retained.length ? (newWins / retained.length * 100) : 0;
    const lossesBlocked = blocked.filter(t => !t.isWin).length;
    const winsLost = blocked.filter(t => t.isWin).length;
    const deltaR = newNetR - baseNetR;

    results.push({ threshold: thresh, retained, blocked, newNetR, newWR, lossesBlocked, winsLost, deltaR });

    const verdict = thresh <= 0.35 ? "← CURRENT"
      : deltaR > 0 ? "✅ IMPROVEMENT"
      : deltaR > -5 ? "⚠  MARGINAL LOSS"
      : "❌ SIGNIFICANT LOSS";

    log("  " +
      `${thresh}`.padEnd(12) +
      `${retained.length}`.padStart(10) +
      `${blocked.length}`.padStart(9) +
      `${lossesBlocked}`.padStart(8) +
      `${winsLost}`.padStart(8) +
      `${newWR.toFixed(1)}%`.padStart(9) +
      `+${newNetR.toFixed(2)}R`.padStart(11) +
      `${deltaR >= 0 ? "+" : ""}${deltaR.toFixed(2)}R`.padStart(10) +
      `  ${verdict}`
    );
  }

  // ── Detailed breakdown for best-performing threshold ─────────────────────
  // Find the threshold that gives highest Net R improvement
  const best = results.filter(r => r.threshold > 0.35).sort((a, b) => b.newNetR - a.newNetR)[0];
  if (best) {
    log("\n\n" + "=".repeat(100));
    log(`  DETAILED BREAKDOWN: Threshold = ${best.threshold} (best Net R)`);
    log("=".repeat(100));
    log(`  Trades retained : ${best.retained.length} (from ${baselineAll.length})`);
    log(`  Trades blocked  : ${best.blocked.length}`);
    log(`  Losses cut      : ${best.lossesBlocked}`);
    log(`  Winners lost    : ${best.winsLost}`);
    log(`  New Net R       : +${best.newNetR.toFixed(2)}R (was +${baseNetR.toFixed(2)}R, delta ${best.deltaR >= 0 ? "+" : ""}${best.deltaR.toFixed(2)}R)`);
    log(`  New Win Rate    : ${best.newWR.toFixed(1)}% (was ${baseWR.toFixed(1)}%)`);

    // Per-pair breakdown at this threshold
    log(`\n  Per-Pair Impact at threshold ${best.threshold}:`);
    log("  " + "PAIR".padEnd(18) + "OLD_TRADES".padStart(12) + "NEW_TRADES".padStart(12) + "BLOCKED".padStart(9) + "L_CUT".padStart(7) + "W_LOST".padStart(8) + "OLD_R".padStart(9) + "NEW_R".padStart(9) + "DELTA_R".padStart(10));
    log("  " + "-".repeat(100));
    const pairs = [...new Set(allTradesWithATR.map(t => t.pair))].sort();
    for (const pair of pairs) {
      const pAll = allTradesWithATR.filter(t => t.pair === pair);
      const pNoRatio = pAll.filter(t => t.atrRatio < 0);
      const pWithRatio = pAll.filter(t => t.atrRatio >= 0);
      const pRetained = [...pNoRatio, ...pWithRatio.filter(t => t.atrRatio >= best.threshold)];
      const pBlocked = pWithRatio.filter(t => t.atrRatio < best.threshold);
      const oldR = pAll.reduce((s, t) => s + t.rMultiple, 0);
      const newR = pRetained.reduce((s, t) => s + t.rMultiple, 0);
      const delta = newR - oldR;
      const lCut = pBlocked.filter(t => !t.isWin).length;
      const wLost = pBlocked.filter(t => t.isWin).length;
      log("  " +
        pair.padEnd(18) +
        `${pAll.length}`.padStart(12) +
        `${pRetained.length}`.padStart(12) +
        `${pBlocked.length}`.padStart(9) +
        `${lCut}`.padStart(7) +
        `${wLost}`.padStart(8) +
        `${oldR.toFixed(2)}R`.padStart(9) +
        `${newR.toFixed(2)}R`.padStart(9) +
        `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}R`.padStart(10)
      );
    }

    // Show what the blocked trades look like (ATR ratio distribution)
    log(`\n  Blocked Trades at threshold ${best.threshold} — ATR ratio distribution:`);
    const blockedByBucket: Record<string, { count: number; losses: number; wins: number; netR: number }> = {};
    for (const t of best.blocked) {
      const bLabel = t.atrRatio < 0.35 ? "<0.35"
        : t.atrRatio < 0.50 ? "0.35-0.50"
        : t.atrRatio < 0.80 ? "0.50-0.80"
        : t.atrRatio < 1.00 ? "0.80-1.00"
        : t.atrRatio < 1.10 ? "1.00-1.10"
        : "1.10+";
      if (!blockedByBucket[bLabel]) blockedByBucket[bLabel] = { count: 0, losses: 0, wins: 0, netR: 0 };
      blockedByBucket[bLabel].count++;
      blockedByBucket[bLabel].netR += t.rMultiple;
      if (t.isWin) blockedByBucket[bLabel].wins++; else blockedByBucket[bLabel].losses++;
    }
    for (const [label, data] of Object.entries(blockedByBucket).sort()) {
      log(`    ATR ${label.padEnd(12)}: ${data.count} trades | W=${data.wins} L=${data.losses} | NetR=${data.netR.toFixed(2)}R`);
    }
  }

  // ── Also check threshold=1.10 specifically (our primary candidate) ────────
  const t110 = results.find(r => r.threshold === 1.10);
  if (t110) {
    log("\n\n" + "=".repeat(100));
    log("  SPOTLIGHT: Threshold = 1.10 (our primary candidate from Section 4)");
    log("=".repeat(100));
    log(`  Retained: ${t110.retained.length} trades | Blocked: ${t110.blocked.length}`);
    log(`  Losses cut: ${t110.lossesBlocked} | Winners lost: ${t110.winsLost}`);
    log(`  Loss-to-winner ratio blocked: ${t110.lossesBlocked}:${t110.winsLost} (want > 2:1 to be worthwhile)`);
    log(`  New Net R: +${t110.newNetR.toFixed(2)}R | Was: +${baseNetR.toFixed(2)}R | Delta: ${t110.deltaR >= 0 ? "+" : ""}${t110.deltaR.toFixed(2)}R`);
    log(`  New Win Rate: ${t110.newWR.toFixed(1)}% | Was: ${baseWR.toFixed(1)}%`);

    // Show 10 sample trades that would be blocked
    log(`\n  Sample of blocked trades (ATR ratio < 1.10):`);
    const sampleBlocked = t110.blocked.sort((a, b) => a.rMultiple - b.rMultiple).slice(0, 15);
    log("  " + "DATE".padEnd(12) + "PAIR".padEnd(16) + "DIR".padEnd(5) + "R".padStart(7) + "ATR_RATIO".padStart(12) + "ORB_PIPS".padStart(10) + "ATR_PIPS".padStart(10));
    log("  " + "-".repeat(70));
    for (const t of sampleBlocked) {
      log("  " + t.date.padEnd(12) + t.pair.padEnd(16) + t.direction.padEnd(5) +
        `${t.rMultiple.toFixed(2)}R`.padStart(7) +
        t.atrRatio.toFixed(3).padStart(12) +
        t.orPips.toFixed(1).padStart(10) +
        t.atrPips.toFixed(1).padStart(10));
    }
  }

  // ── Summary recommendation ───────────────────────────────────────────────
  log("\n\n" + "=".repeat(100));
  log("  RECOMMENDATION");
  log("=".repeat(100));
  log("");

  // Find the threshold that maximizes Net R improvement
  const improvements = results.filter(r => r.threshold > 0.35 && r.deltaR > 0);
  if (improvements.length === 0) {
    log("  No threshold improves Net R vs baseline. ATR ratio filtering would hurt overall performance.");
    log("  Consider per-pair ATR tuning instead of a portfolio-wide threshold.");
  } else {
    const bestImprovement = improvements.sort((a, b) => b.deltaR - a.deltaR)[0];
    const ratio = bestImprovement.lossesBlocked > 0 ? bestImprovement.lossesBlocked / Math.max(1, bestImprovement.winsLost) : 0;
    log(`  Best threshold: minAtrRatio = ${bestImprovement.threshold}`);
    log(`  Delta R: ${bestImprovement.deltaR >= 0 ? "+" : ""}${bestImprovement.deltaR.toFixed(2)}R`);
    log(`  Loss:Winner ratio in blocked trades = ${ratio.toFixed(1)}:1`);
    log(`  New Win Rate: ${bestImprovement.newWR.toFixed(1)}% (was ${baseWR.toFixed(1)}%)`);
    log("");
    if (bestImprovement.deltaR > 0) {
      log(`  ✅ IMPLEMENT: Raise minAtrRatio to ${bestImprovement.threshold} across all Mage configs.`);
      log(`     This cuts ${bestImprovement.lossesBlocked} losing trades while only sacrificing ${bestImprovement.winsLost} winners.`);
    }
  }

  log("\n" + "=".repeat(100));
  log(`  Report saved: ${OUTPUT_FILE}`);
  log("=".repeat(100));

  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf-8");
  console.log(`\n>>> Written to: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
