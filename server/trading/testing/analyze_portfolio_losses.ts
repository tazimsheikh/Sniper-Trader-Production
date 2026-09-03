// ============================================================
// analyze_portfolio_losses.ts
//
// Deep loss analysis script. Runs the Tier-1 Math Backtester
// on every config in grandmaster_holy_grail_portfolios.json,
// collects every single losing trade, and produces a detailed
// diagnostic report:
//   - Per-config loss summary
//   - Loss breakdown by Day-of-Week
//   - Loss breakdown by Hour-of-Entry (EST)
//   - Loss breakdown by outcome type (SL / EOD / NEWS / EXPIRED)
//   - Session-level loss patterns
//   - "Toxic hour" and "toxic day" fingerprinting
//   - Worst loss streaks
//   - Pair-level loss comparison
//
// Usage:
//   npx tsx server/trading/testing/analyze_portfolio_losses.ts
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { runMathBacktest as runMageMathBacktest, clearMageBacktestCache } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest, clearSageBacktestCache } from "../backtester/SageMathBacktester.js";
import { getFixedEstDate } from "../backtester/math_core/MathCoreUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const START_DATE = "2025-09-01";
const END_DATE   = "2026-08-31";
const PORTFOLIO_JSON = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster_holy_grail_portfolios.json");
const OUTPUT_FILE = path.join(process.cwd(), "loss_analysis_report_1yr.txt");

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─────────────────────────────────────────────────────────────────────────────
// Setup string parser (mirrors simulate_portfolio_risk_math.ts)
// ─────────────────────────────────────────────────────────────────────────────
function parseSetupToConfig(setupStr: string, symbol: string, isSage: boolean): any {
  const parts = setupStr.split("_");
  let session = parts[0];
  if (parts[0] === "NY") session = `NY_${parts[1]}`;

  const findNum = (prefix: string, isSuffix = false): number | undefined => {
    const p = isSuffix
      ? parts.find((item) => item.endsWith(prefix))
      : parts.find((item) => item.startsWith(prefix));
    if (!p) return undefined;
    const raw = isSuffix ? p.slice(0, -prefix.length) : p.slice(prefix.length);
    const num = parseFloat(raw);
    return isNaN(num) ? undefined : num;
  };
  const findStr = (prefix: string): string | undefined => {
    const p = parts.find((item) => item.startsWith(prefix));
    return p ? p.slice(prefix.length) : undefined;
  };

  const parsedPct = findNum("%", true) ?? 0;
  const minSl = findNum("MinSL") ?? 10;
  const maxSl = findNum("MaxSl") ?? findNum("MaxSL") ?? 100;

  if (isSage) {
    return {
      session,
      orbEnabled: true,
      orbStartHour: findNum("StartH") ?? 0,
      orbStartMin: findNum("StartM") ?? 0,
      orbMinutes: findNum("OrbMins") ?? 15,
      actionMinutes: findNum("ActMins"),
      minSlDist: minSl,
      maxSlDist: maxSl,
      entryPenetrationPct: parsedPct,
      sweepPips: findNum("Sweep") ?? 0,
      maxSweepMultiplier: findNum("MaxSwp") ?? 3,
      requireCloseInside: findStr("ReqCls") === "true",
      exitMode: findStr("Exit") ?? "TRAILING",
      trailingSlTrigger: findNum("Trig") ?? 0,
      trailingSlStep: findNum("Step") ?? 0,
      forceCloseHours: findNum("FC") ?? 8,
      htfAlignmentRequired: true,
      maxH1EmaSlope: 20,
    };
  } else {
    return {
      session,
      orbEnabled: true,
      orbStartHour: findNum("StartH") ?? 0,
      orbStartMin: findNum("StartM") ?? 0,
      orbMinutes: findNum("OrbMins") ?? 10,
      actionMinutes: findNum("ActMins") ?? 60,
      minSlDist: minSl,
      maxSlDist: maxSl,
      minBodyPips: findNum("Body") ?? 0,
      exitMode: findStr("Exit") ?? "TRAILING",
      trailingSlTrigger: findNum("Trig") ?? 0,
      trailingSlStep: findNum("Step") ?? 0,
      forceCloseHours: findNum("FC") ?? 24,
      htfAlignmentRequired: true,
      maxH1EmaSlope: 20,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function bar(label: string, value: number, maxVal: number, width = 30): string {
  const filled = maxVal > 0 ? Math.round((value / maxVal) * width) : 0;
  const empty = width - filled;
  return `${label.padEnd(18)} [${"█".repeat(filled)}${" ".repeat(empty)}] ${value}`;
}

function pct(num: number, den: number): string {
  return den === 0 ? "0.0%" : `${((num / den) * 100).toFixed(1)}%`;
}

function lossPct(lossR: number, totalWinR: number): string {
  const grossWin = totalWinR;
  if (grossWin === 0) return "0.0%";
  return `${((Math.abs(lossR) / grossWin) * 100).toFixed(1)}%`;
}

interface TradeSummary {
  date: string;
  dayOfWeek: number;
  entryHourEST: number;
  entryMinEST: number;
  exitHourEST: number;
  outcome: string;
  rMultiple: number;
  pair: string;
  bot: string;
  session: string;
  setup: string;
  direction: string;
  riskPips: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const lines: string[] = [];
  const log = (...args: any[]) => {
    const txt = args.map(String).join(" ");
    console.log(txt);
    lines.push(txt);
  };

  log("=".repeat(90));
  log("  PORTFOLIO LOSS ANALYSIS -- TIER-1 MATH BACKTESTER");
  log(`  Date range: ${START_DATE} --> ${END_DATE}`);
  log("=".repeat(90));

  if (!fs.existsSync(PORTFOLIO_JSON)) {
    log(`[ERROR] Portfolio JSON not found: ${PORTFOLIO_JSON}`);
    process.exit(1);
  }

  const portfolio: any[] = JSON.parse(fs.readFileSync(PORTFOLIO_JSON, "utf-8"));
  log(`\nPortfolio contains ${portfolio.length} configurations\n`);

  // Deduplicate: same symbol+botType+setup counts only once
  const seen = new Set<string>();
  const uniquePortfolio = portfolio.filter((comp) => {
    const key = `${comp.symbol}::${comp.botType}::${comp.setup}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  log(`After dedup: ${uniquePortfolio.length} unique configurations\n`);

  // ─── Collect all trades ───────────────────────────────────────────────────
  const allTrades: TradeSummary[] = [];
  const perConfigStats: Array<{
    label: string; symbol: string; bot: string; setup: string;
    wins: number; losses: number; totalR: number; lossR: number;
    winR: number; worstLoss: number; avgLoss: number; worstStreak: number;
  }> = [];

  for (const comp of uniquePortfolio) {
    const isSage = comp.botType === "Sage";
    const cfg = parseSetupToConfig(comp.setup, comp.symbol, isSage);
    cfg.signature = comp.setup;

    log(`Running ${comp.botType} backtest: ${comp.symbol} | ${comp.setup.substring(0, 60)}...`);

    let records: any[] = [];
    try {
      if (isSage) {
        const res = await runSageMathBacktest(comp.symbol, START_DATE, END_DATE, false, {}, [cfg], false);
        records = (res.records || []).filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
        clearSageBacktestCache(comp.symbol);
      } else {
        const res = await runMageMathBacktest(comp.symbol, START_DATE, END_DATE, false, undefined, undefined, null, [cfg], false);
        records = (res.records || []).filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
        clearMageBacktestCache(comp.symbol);
      }
    } catch (e: any) {
      log(`  [ERROR] ${comp.symbol} ${comp.botType}: ${e.message}`);
      continue;
    }

    // Per-config analysis
    let wins = 0, losses = 0, winR = 0, lossR = 0, worstLoss = 0;
    let worstStreak = 0, currentStreak = 0;

    for (const r of records) {
      const rm = r.rMultiple ?? 0;
      if (rm > 0) {
        wins++;
        winR += rm;
        currentStreak = 0;
      } else {
        losses++;
        lossR += rm;
        if (rm < worstLoss) worstLoss = rm;
        currentStreak++;
        if (currentStreak > worstStreak) worstStreak = currentStreak;
      }

      // Build EST entry time
      const ts = r.timestamp ?? r.openTime ?? r.entryTimeMs ?? 0;
      const exitTs = r.exitTimeMs ?? r.closeTime ?? 0;
      const estEntry = getFixedEstDate(new Date(ts));
      const estExit = exitTs ? getFixedEstDate(new Date(exitTs)) : estEntry;
      const dowEntry = estEntry.getUTCDay();

      let dir = "?";
      if (r.direction) dir = r.direction;
      else if (r.entry != null && r.stopLoss != null) dir = r.entry > r.stopLoss ? "BUY" : "SELL";

      allTrades.push({
        date: estEntry.toISOString().split("T")[0],
        dayOfWeek: dowEntry,
        entryHourEST: estEntry.getUTCHours(),
        entryMinEST: estEntry.getUTCMinutes(),
        exitHourEST: estExit.getUTCHours(),
        outcome: r.outcome ?? "SL",
        rMultiple: rm,
        pair: comp.symbol,
        bot: comp.botType,
        session: cfg.session ?? "?",
        setup: comp.setup,
        direction: dir,
        riskPips: r.riskPips ?? 0,
      });
    }

    const totalR = winR + lossR;
    const avgLoss = losses > 0 ? lossR / losses : 0;
    const label = `${comp.symbol} ${comp.botType}`;

    perConfigStats.push({
      label,
      symbol: comp.symbol,
      bot: comp.botType,
      setup: comp.setup,
      wins,
      losses,
      totalR,
      lossR,
      winR,
      worstLoss,
      avgLoss,
      worstStreak,
    });

    log(`  OK: ${wins}W / ${losses}L | NetR=${totalR.toFixed(2)} | WinR=+${winR.toFixed(2)} | LossR=${lossR.toFixed(2)} | WorstL=${worstLoss.toFixed(2)} | Streak=${worstStreak}`);
  }

  // ─── Separate wins/losses ─────────────────────────────────────────────────
  const lossTrades = allTrades.filter(t => t.rMultiple < 0);
  const winTrades  = allTrades.filter(t => t.rMultiple > 0);
  const totalNetR  = allTrades.reduce((s, t) => s + t.rMultiple, 0);
  const totalLossR = lossTrades.reduce((s, t) => s + t.rMultiple, 0);
  const totalWinR  = winTrades.reduce((s, t) => s + t.rMultiple, 0);

  log("\n\n" + "=".repeat(90));
  log("  SECTION 1 -- OVERALL PORTFOLIO SUMMARY");
  log("=".repeat(90));
  log(`  Total Trades   : ${allTrades.length}`);
  log(`  Wins           : ${winTrades.length} (${pct(winTrades.length, allTrades.length)})`);
  log(`  Losses         : ${lossTrades.length} (${pct(lossTrades.length, allTrades.length)})`);
  log(`  Total Net R    : ${totalNetR.toFixed(2)}R`);
  log(`  Total Win R    : +${totalWinR.toFixed(2)}R`);
  log(`  Total Loss R   : ${totalLossR.toFixed(2)}R`);
  log(`  Loss drag      : ${lossPct(totalLossR, totalWinR)} of gross profit consumed by losses`);
  log(`  Avg Win R      : ${winTrades.length > 0 ? (totalWinR/winTrades.length).toFixed(3) : "---"}R`);
  log(`  Avg Loss R     : ${lossTrades.length > 0 ? (totalLossR/lossTrades.length).toFixed(3) : "---"}R`);
  const rr = winTrades.length > 0 && lossTrades.length > 0
    ? (totalWinR / winTrades.length) / Math.abs(totalLossR / lossTrades.length)
    : 0;
  log(`  Reward:Risk    : ${rr.toFixed(2)}:1`);

  // ─── Section 2: Per-Config Loss Leaderboard ───────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 2 -- PER-CONFIG LOSS LEADERBOARD (sorted by total loss R, worst first)");
  log("=".repeat(90));
  const sorted = [...perConfigStats].sort((a, b) => a.lossR - b.lossR);
  log("\n  " + "SYMBOL+BOT".padEnd(22) + "WINS".padStart(5) + "LOSSES".padStart(7) + "WIN_R".padStart(9) + "LOSS_R".padStart(9) + "NET_R".padStart(9) + "AVG_L".padStart(8) + "WORST_L".padStart(9) + "STREAK".padStart(8));
  log("  " + "-".repeat(90));
  for (const s of sorted) {
    log(
      "  " +
      `${s.label}`.padEnd(22) +
      `${s.wins}`.padStart(5) +
      `${s.losses}`.padStart(7) +
      `${s.winR.toFixed(2)}`.padStart(9) +
      `${s.lossR.toFixed(2)}`.padStart(9) +
      `${s.totalR.toFixed(2)}`.padStart(9) +
      `${s.avgLoss.toFixed(2)}`.padStart(8) +
      `${s.worstLoss.toFixed(2)}`.padStart(9) +
      `${s.worstStreak}`.padStart(8)
    );
    log("      SETUP: " + s.setup);
    log("");
  }

  // ─── Section 3: Loss by Day of Week ──────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 3 -- LOSS BY DAY OF WEEK");
  log("=".repeat(90));
  const lossPerDow: number[] = new Array(7).fill(0);
  const countPerDow: number[] = new Array(7).fill(0);
  const lossBucketDow: number[] = new Array(7).fill(0);
  for (const t of lossTrades) {
    lossPerDow[t.dayOfWeek]++;
    lossBucketDow[t.dayOfWeek] += t.rMultiple;
  }
  for (const t of allTrades) countPerDow[t.dayOfWeek]++;
  const maxLossDow = Math.max(...lossPerDow);
  log("");
  for (let d = 0; d < 7; d++) {
    if (countPerDow[d] === 0) continue;
    const lossRate = pct(lossPerDow[d], countPerDow[d]);
    log(`  ${bar(DOW_NAMES[d], lossPerDow[d], maxLossDow)} | ${lossRate} loss rate | ${lossBucketDow[d].toFixed(2)}R total loss`);
  }

  // ─── Section 4: Loss by Entry Hour EST ───────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 4 -- LOSS BY ENTRY HOUR (EST, 0-23)");
  log("=".repeat(90));
  const lossPerHour: number[] = new Array(24).fill(0);
  const lossBucketHour: number[] = new Array(24).fill(0);
  const tradePerHour: number[] = new Array(24).fill(0);
  for (const t of lossTrades) {
    lossPerHour[t.entryHourEST]++;
    lossBucketHour[t.entryHourEST] += t.rMultiple;
  }
  for (const t of allTrades) tradePerHour[t.entryHourEST]++;
  const maxLossH = Math.max(...lossPerHour);
  log("");
  for (let h = 0; h < 24; h++) {
    if (tradePerHour[h] === 0) continue;
    const lossRate = pct(lossPerHour[h], tradePerHour[h]);
    const hLabel = `${String(h).padStart(2, "0")}:xx EST`;
    log(`  ${bar(hLabel, lossPerHour[h], maxLossH)} | ${lossRate} loss rate | ${lossBucketHour[h].toFixed(2)}R | ${tradePerHour[h]} total trades`);
  }

  // ─── Section 5: Loss by Outcome Type ─────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 5 -- LOSS BY OUTCOME TYPE");
  log("=".repeat(90));
  const outcomeMap = new Map<string, { count: number; totalR: number }>();
  for (const t of lossTrades) {
    const key = t.outcome ?? "UNKNOWN";
    if (!outcomeMap.has(key)) outcomeMap.set(key, { count: 0, totalR: 0 });
    const e = outcomeMap.get(key)!;
    e.count++;
    e.totalR += t.rMultiple;
  }
  log("");
  const sortedOutcomes = [...outcomeMap.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [oc, data] of sortedOutcomes) {
    log(`  ${oc.padEnd(20)} | ${data.count} losing trades | ${data.totalR.toFixed(2)}R total | avg ${(data.totalR / data.count).toFixed(3)}R/trade`);
  }

  // ─── Section 6: Loss by Session ──────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 6 -- LOSS BY SESSION");
  log("=".repeat(90));
  const sessionMap = new Map<string, { losses: number; wins: number; lossR: number; winR: number }>();
  for (const t of allTrades) {
    const key = t.session;
    if (!sessionMap.has(key)) sessionMap.set(key, { losses: 0, wins: 0, lossR: 0, winR: 0 });
    const e = sessionMap.get(key)!;
    if (t.rMultiple < 0) { e.losses++; e.lossR += t.rMultiple; }
    else { e.wins++; e.winR += t.rMultiple; }
  }
  log("");
  for (const [sess, data] of [...sessionMap.entries()].sort((a, b) => a[1].lossR - b[1].lossR)) {
    const total = data.wins + data.losses;
    log(`  ${sess.padEnd(22)} | Wins: ${data.wins} (${pct(data.wins, total)}) | Losses: ${data.losses} (${pct(data.losses, total)}) | WinR: +${data.winR.toFixed(2)} | LossR: ${data.lossR.toFixed(2)} | NetR: ${(data.winR + data.lossR).toFixed(2)}`);
  }

  // ─── Section 7: Loss by Pair ─────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 7 -- LOSS BY SYMBOL");
  log("=".repeat(90));
  const pairMap = new Map<string, { losses: number; wins: number; lossR: number; winR: number }>();
  for (const t of allTrades) {
    const key = t.pair;
    if (!pairMap.has(key)) pairMap.set(key, { losses: 0, wins: 0, lossR: 0, winR: 0 });
    const e = pairMap.get(key)!;
    if (t.rMultiple < 0) { e.losses++; e.lossR += t.rMultiple; }
    else { e.wins++; e.winR += t.rMultiple; }
  }
  log("\n  " + "PAIR".padEnd(14) + "WINS".padStart(6) + "LOSSES".padStart(8) + "WIN_R".padStart(10) + "LOSS_R".padStart(10) + "NET_R".padStart(10) + "  WIN%");
  log("  " + "-".repeat(65));
  const sortedPairs = [...pairMap.entries()].sort((a, b) => a[1].lossR - b[1].lossR);
  for (const [pair, data] of sortedPairs) {
    const total = data.wins + data.losses;
    log(`  ${pair.padEnd(14)}${data.wins.toString().padStart(6)}${data.losses.toString().padStart(8)}${data.winR.toFixed(2).padStart(10)}${data.lossR.toFixed(2).padStart(10)}${(data.winR+data.lossR).toFixed(2).padStart(10)}  ${pct(data.wins, total)}`);
  }

  // ─── Section 8: Worst loss streaks per config ─────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 8 -- TOP 10 WORST STREAK CONFIGS");
  log("=".repeat(90));
  const topStreaks = [...perConfigStats].sort((a, b) => b.worstStreak - a.worstStreak).slice(0, 10);
  log("");
  for (const s of topStreaks) {
    log(`  [${s.label.padEnd(20)}] WorstStreak=${s.worstStreak} | AvgLoss=${s.avgLoss.toFixed(3)}R | TotalLossR=${s.lossR.toFixed(2)}`);
    log(`    Setup: ${s.setup}`);
    log("");
  }

  // ─── Section 9: Toxic Hour Fingerprint ────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 9 -- TOXIC HOUR FINGERPRINT (loss rate >= 60%, min 5 trades)");
  log("=".repeat(90));
  log("  These are entry hours where the system loses MORE than it wins.\n");
  let toxicFound = false;
  for (let h = 0; h < 24; h++) {
    const t = tradePerHour[h];
    if (t < 5) continue;
    const lossRate = lossPerHour[h] / t;
    if (lossRate >= 0.60) {
      log(`  WARNING: ${String(h).padStart(2, "0")}:xx EST -- ${(lossRate * 100).toFixed(1)}% loss rate | ${lossPerHour[h]}/${t} trades | ${lossBucketHour[h].toFixed(2)}R lost`);
      toxicFound = true;
    }
  }
  if (!toxicFound) log("  No toxic hours found (no hour with >=60% loss rate AND >=5 trades).");

  // ─── Section 10: Toxic Day Fingerprint ────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 10 -- TOXIC DAY FINGERPRINT (loss rate >= 60%, min 5 trades)");
  log("=".repeat(90));
  log("");
  let toxicDayFound = false;
  for (let d = 0; d < 7; d++) {
    if (countPerDow[d] < 5) continue;
    const lossRate = lossPerDow[d] / countPerDow[d];
    if (lossRate >= 0.60) {
      log(`  WARNING: ${DOW_NAMES[d]} -- ${(lossRate * 100).toFixed(1)}% loss rate | ${lossPerDow[d]}/${countPerDow[d]} trades | ${lossBucketDow[d].toFixed(2)}R lost`);
      toxicDayFound = true;
    }
  }
  if (!toxicDayFound) log("  No toxic days found.");

  // ─── Section 11: Hour x Day Loss Heatmap ────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 11 -- HOUR x DAY LOSS HEATMAP (cumulative loss R per cell, 0=no trades)");
  log("=".repeat(90));
  const heatmap: number[][] = Array.from({ length: 24 }, () => new Array(7).fill(0));
  const heatmapCount: number[][] = Array.from({ length: 24 }, () => new Array(7).fill(0));
  for (const t of allTrades) {
    heatmapCount[t.entryHourEST][t.dayOfWeek]++;
    if (t.rMultiple < 0) heatmap[t.entryHourEST][t.dayOfWeek] += t.rMultiple;
  }
  log("\n       " + DOW_NAMES.map(d => d.padStart(8)).join(""));
  log("       " + "-".repeat(8 * 7));
  for (let h = 0; h < 24; h++) {
    const hasAnyTrade = heatmapCount[h].some(c => c > 0);
    if (!hasAnyTrade) continue;
    const cells = heatmap[h].map((v, d) => {
      if (heatmapCount[h][d] === 0) return "       .";
      return v.toFixed(1).padStart(8);
    });
    log(`  ${String(h).padStart(2, "0")}:xx  ` + cells.join(""));
  }
  log("\n  Values = cumulative loss R. More negative = more damaging that hour/day combination.");

  // ─── Section 12: Individual Losing Trade List per Config ──────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 12 -- INDIVIDUAL LOSING TRADES PER CONFIG (worst R first)");
  log("=".repeat(90));

  const tradesBySetup = new Map<string, TradeSummary[]>();
  for (const t of lossTrades) {
    const key = `${t.pair}|${t.bot}|${t.session}`;
    if (!tradesBySetup.has(key)) tradesBySetup.set(key, []);
    tradesBySetup.get(key)!.push(t);
  }

  for (const [key, trades] of [...tradesBySetup.entries()].sort()) {
    log(`\n  -- ${key} -- (${trades.length} losing trades)`);
    log(`     ${"DATE".padEnd(12)} ${"DOW".padEnd(5)} ${"ENTRY".padEnd(9)} ${"EXIT_H".padEnd(7)} ${"OUTCOME".padEnd(14)} ${"R".padStart(7)} ${"DIR".padEnd(5)}`);
    log(`     ${"-".repeat(70)}`);
    const sortedLosses = [...trades].sort((a, b) => a.rMultiple - b.rMultiple);
    for (const t of sortedLosses) {
      log(
        `     ${t.date.padEnd(12)} ` +
        `${DOW_NAMES[t.dayOfWeek].padEnd(5)} ` +
        `${String(t.entryHourEST).padStart(2, "0")}:${String(t.entryMinEST).padStart(2, "0")} EST  ` +
        `${String(t.exitHourEST).padStart(2, "0")}:xx   ` +
        `${t.outcome.padEnd(14)} ` +
        `${t.rMultiple.toFixed(3).padStart(7)}R ` +
        `${t.direction}`
      );
    }
  }

  // ─── Section 13: Recommendations ─────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 13 -- RECOMMENDATIONS SUMMARY");
  log("=".repeat(90));
  log("");

  // Worst 3 configs
  const worst3 = [...perConfigStats].sort((a, b) => a.lossR - b.lossR).slice(0, 3);
  log("  Top 3 worst-loss configs:");
  for (const s of worst3) {
    log(`    - ${s.label}: ${s.lossR.toFixed(2)}R total loss | ${s.losses} losing trades | avg ${s.avgLoss.toFixed(3)}R/loss | streak ${s.worstStreak}`);
    log(`      Setup: ${s.setup}`);
  }

  // Toxic hours
  log("\n  Toxic entry hours (>=60% loss rate, >=5 trades):");
  let anyToxicH = false;
  for (let h = 0; h < 24; h++) {
    if (tradePerHour[h] < 5) continue;
    if (lossPerHour[h] / tradePerHour[h] >= 0.60) {
      log(`    - Hour ${h}:xx EST -- consider blocking via toxicHours filter`);
      anyToxicH = true;
    }
  }
  if (!anyToxicH) log("    - None -- no hour-level filtering recommended.");

  // Toxic days
  log("\n  Toxic days (>=60% loss rate, >=5 trades):");
  let anyToxicD = false;
  for (let d = 0; d < 7; d++) {
    if (countPerDow[d] < 5) continue;
    if (lossPerDow[d] / countPerDow[d] >= 0.60) {
      log(`    - ${DOW_NAMES[d]} -- consider blocking via toxicDays filter`);
      anyToxicD = true;
    }
  }
  if (!anyToxicD) log("    - None -- no day-level filtering recommended.");

  // Outcome type analysis
  log("\n  Highest-loss-count outcome types:");
  for (const [oc, data] of sortedOutcomes.slice(0, 3)) {
    log(`    - ${oc}: ${data.count} trades, ${data.totalR.toFixed(2)}R total, avg ${(data.totalR / data.count).toFixed(3)}R per trade`);
  }

  // High-loss pair analysis
  log("\n  Pairs contributing most to total losses:");
  for (const [pair, data] of sortedPairs.slice(0, 5)) {
    log(`    - ${pair}: ${data.lossR.toFixed(2)}R loss, ${data.losses} losing trades, WR=${pct(data.wins, data.wins+data.losses)}`);
  }

  log("\n\n" + "=".repeat(90));
  log(`  Analysis complete. Full report saved to: ${OUTPUT_FILE}`);
  log("=".repeat(90));

  // Write report
  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf-8");
  console.log(`\nReport written to: ${OUTPUT_FILE}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
