// ============================================================
// analyze_portfolio_losses_shadow.ts
//
// SHADOW (Tier-2) version of the loss analysis.
// Runs the REAL LiveOrchestrator through OrchestratorShadowBacktester
// for every pair in grandmaster_holy_grail_portfolios.json, collects
// every trade tick-by-tick, and produces the same 13-section diagnostic
// report as the math version — but using the genuine live engine.
//
// Usage:
//   npx tsx server/trading/testing/analyze_portfolio_losses_shadow.ts
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { runShadowBacktest } from "../backtester/OrchestratorShadowBacktester.js";
import { getFixedEstDate } from "../backtester/math_core/MathCoreUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const START_DATE = "2025-09-01";
const END_DATE   = "2026-08-31";
const PORTFOLIO_JSON = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster_holy_grail_portfolios.json");
const OUTPUT_FILE = path.join(process.cwd(), "loss_analysis_shadow_1yr.txt");

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function bar(label: string, value: number, maxVal: number, width = 30): string {
  const filled = maxVal > 0 ? Math.round((value / maxVal) * width) : 0;
  const empty = width - filled;
  return `${label.padEnd(18)} [${"#".repeat(filled)}${" ".repeat(empty)}] ${value}`;
}

function pct(num: number, den: number): string {
  return den === 0 ? "0.0%" : `${((num / den) * 100).toFixed(1)}%`;
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
  direction: string;
  clientId: string;
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
  log("  PORTFOLIO LOSS ANALYSIS -- TIER-2 SHADOW ORCHESTRATOR (GENUINE LIVE ENGINE)");
  log(`  Date range: ${START_DATE} --> ${END_DATE}`);
  log("=".repeat(90));

  if (!fs.existsSync(PORTFOLIO_JSON)) {
    log(`[ERROR] Portfolio JSON not found: ${PORTFOLIO_JSON}`);
    process.exit(1);
  }

  const portfolio: any[] = JSON.parse(fs.readFileSync(PORTFOLIO_JSON, "utf-8"));

  // Collect unique symbols from portfolio (shadow runs per symbol, not per config)
  const uniqueSymbols = [...new Set(portfolio.map((c: any) => c.symbol.split(".")[0]))];
  log(`\nPortfolio: ${portfolio.length} configs across ${uniqueSymbols.length} symbols`);
  log(`Symbols: ${uniqueSymbols.join(", ")}\n`);

  // ─── Run shadow backtester per symbol ────────────────────────────────────
  const allTrades: TradeSummary[] = [];
  const perSymbolStats: Array<{
    symbol: string; bot: string;
    wins: number; losses: number; totalR: number; lossR: number;
    winR: number; worstLoss: number; avgLoss: number; worstStreak: number;
  }> = [];

  for (const symbol of uniqueSymbols) {
    log(`\n${"─".repeat(70)}`);
    log(`Running SHADOW backtest: ${symbol} [Mage + Sage] ${START_DATE} -> ${END_DATE}`);

    let tradeLog: any[] = [];
    try {
      const res = await runShadowBacktest(symbol, START_DATE, END_DATE, {
        enableMage: true,
        enableSage: true,
        enableSeer: false,
      });
      // Filter to target date range only (shadow returns full warmup)
      const targetStartMs = new Date(START_DATE).getTime();
      const targetEndMs = new Date(END_DATE).getTime() + 86400000;
      tradeLog = (res.tradeLog || []).filter((t: any) =>
        t.openTime >= targetStartMs &&
        t.openTime <= targetEndMs &&
        t.outcome !== "SKIPPED" &&
        t.outcome !== "NO_TRADE"
      );
    } catch (e: any) {
      log(`  [ERROR] ${symbol}: ${e.message}`);
      continue;
    }

    log(`  Shadow complete: ${tradeLog.length} trades`);

    // Build per-symbol stats and per-bot breakdowns
    const botGroups = new Map<string, { wins: number; losses: number; winR: number; lossR: number; worstLoss: number; worstStreak: number; currentStreak: number }>();

    for (const t of tradeLog) {
      const rm: number = t.rMultiple ?? 0;
      const rawBot: string = (t.botId || "MAGE").toUpperCase().includes("SAGE") ? "Sage" : "Mage";
      const sessionRaw: string = t.clientId || t.session || "";
      // Extract session from clientId (e.g. "london_30%_..." → "london")
      const sessionPart = sessionRaw.split("_")[0] || "unknown";
      const session = sessionPart.startsWith("NY") ? sessionRaw.split("_").slice(0, 2).join("_") : sessionPart;

      const groupKey = `${rawBot}|${session}`;
      if (!botGroups.has(groupKey)) {
        botGroups.set(groupKey, { wins: 0, losses: 0, winR: 0, lossR: 0, worstLoss: 0, worstStreak: 0, currentStreak: 0 });
      }
      const g = botGroups.get(groupKey)!;

      if (rm > 0) {
        g.wins++;
        g.winR += rm;
        g.currentStreak = 0;
      } else {
        g.losses++;
        g.lossR += rm;
        if (rm < g.worstLoss) g.worstLoss = rm;
        g.currentStreak++;
        if (g.currentStreak > g.worstStreak) g.worstStreak = g.currentStreak;
      }

      // Build EST entry time for heatmap
      const ts = t.openTime ?? 0;
      const closeTs = t.closeTime ?? ts;
      const estEntry = getFixedEstDate(new Date(ts));
      const estExit  = getFixedEstDate(new Date(closeTs));

      let dir = "?";
      if (t.direction) dir = t.direction;
      else if (t.entryPrice != null && t.slPrice != null) {
        dir = t.entryPrice > t.slPrice ? "BUY" : "SELL";
      }

      allTrades.push({
        date: estEntry.toISOString().split("T")[0],
        dayOfWeek: estEntry.getUTCDay(),
        entryHourEST: estEntry.getUTCHours(),
        entryMinEST:  estEntry.getUTCMinutes(),
        exitHourEST:  estExit.getUTCHours(),
        outcome: t.outcome ?? "SL",
        rMultiple: rm,
        pair: symbol,
        bot: rawBot,
        session,
        direction: dir,
        clientId: t.clientId || "",
      });
    }

    // Push per-bot stats for this symbol
    for (const [groupKey, g] of botGroups.entries()) {
      const [bot, session] = groupKey.split("|");
      log(`  [${symbol} ${bot} ${session}] ${g.wins}W / ${g.losses}L | NetR=${(g.winR + g.lossR).toFixed(2)} | LossR=${g.lossR.toFixed(2)} | WorstStreak=${g.worstStreak}`);
      perSymbolStats.push({
        symbol: `${symbol} ${bot} ${session}`,
        bot,
        wins: g.wins,
        losses: g.losses,
        totalR: g.winR + g.lossR,
        lossR: g.lossR,
        winR: g.winR,
        worstLoss: g.worstLoss,
        avgLoss: g.losses > 0 ? g.lossR / g.losses : 0,
        worstStreak: g.worstStreak,
      });
    }
  }

  // ─── Separate wins/losses ─────────────────────────────────────────────────
  const lossTrades = allTrades.filter(t => t.rMultiple < 0);
  const winTrades  = allTrades.filter(t => t.rMultiple > 0);
  const totalNetR  = allTrades.reduce((s, t) => s + t.rMultiple, 0);
  const totalLossR = lossTrades.reduce((s, t) => s + t.rMultiple, 0);
  const totalWinR  = winTrades.reduce((s, t) => s + t.rMultiple, 0);

  // ─── SECTION 1 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 1 -- OVERALL PORTFOLIO SUMMARY (Shadow / Genuine Live Engine)");
  log("=".repeat(90));
  log(`  Total Trades   : ${allTrades.length}`);
  log(`  Wins           : ${winTrades.length} (${pct(winTrades.length, allTrades.length)})`);
  log(`  Losses         : ${lossTrades.length} (${pct(lossTrades.length, allTrades.length)})`);
  log(`  Total Net R    : ${totalNetR.toFixed(2)}R`);
  log(`  Total Win R    : +${totalWinR.toFixed(2)}R`);
  log(`  Total Loss R   : ${totalLossR.toFixed(2)}R`);
  const lossDrag = totalWinR > 0 ? ((Math.abs(totalLossR) / totalWinR) * 100).toFixed(1) : "0.0";
  log(`  Loss drag      : ${lossDrag}% of gross profit consumed by losses`);
  log(`  Avg Win R      : ${winTrades.length > 0 ? (totalWinR / winTrades.length).toFixed(3) : "---"}R`);
  log(`  Avg Loss R     : ${lossTrades.length > 0 ? (totalLossR / lossTrades.length).toFixed(3) : "---"}R`);
  const rr = winTrades.length > 0 && lossTrades.length > 0
    ? (totalWinR / winTrades.length) / Math.abs(totalLossR / lossTrades.length)
    : 0;
  log(`  Reward:Risk    : ${rr.toFixed(2)}:1`);

  // ─── SECTION 2 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 2 -- PER-SYMBOL/SESSION LOSS LEADERBOARD (worst first)");
  log("=".repeat(90));
  const sortedStats = [...perSymbolStats].sort((a, b) => a.lossR - b.lossR);
  log("\n  " + "SYMBOL+BOT+SESSION".padEnd(32) + "WINS".padStart(5) + "LOSSES".padStart(7) + "WIN_R".padStart(9) + "LOSS_R".padStart(9) + "NET_R".padStart(9) + "AVG_L".padStart(8) + "STREAK".padStart(8));
  log("  " + "-".repeat(90));
  for (const s of sortedStats) {
    const netMark = s.totalR < 0 ? " <<NET-NEG>>" : "";
    log(
      "  " +
      s.symbol.padEnd(32) +
      `${s.wins}`.padStart(5) +
      `${s.losses}`.padStart(7) +
      `${s.winR.toFixed(2)}`.padStart(9) +
      `${s.lossR.toFixed(2)}`.padStart(9) +
      `${s.totalR.toFixed(2)}`.padStart(9) +
      `${s.avgLoss.toFixed(2)}`.padStart(8) +
      `${s.worstStreak}`.padStart(8) +
      netMark
    );
  }

  // ─── SECTION 3 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 3 -- LOSS BY DAY OF WEEK");
  log("=".repeat(90));
  const lossPerDow: number[] = new Array(7).fill(0);
  const countPerDow: number[] = new Array(7).fill(0);
  const lossBucketDow: number[] = new Array(7).fill(0);
  for (const t of lossTrades) { lossPerDow[t.dayOfWeek]++; lossBucketDow[t.dayOfWeek] += t.rMultiple; }
  for (const t of allTrades) countPerDow[t.dayOfWeek]++;
  const maxLossDow = Math.max(...lossPerDow);
  log("");
  for (let d = 0; d < 7; d++) {
    if (countPerDow[d] === 0) continue;
    log(`  ${bar(DOW_NAMES[d], lossPerDow[d], maxLossDow)} | ${pct(lossPerDow[d], countPerDow[d])} loss rate | ${lossBucketDow[d].toFixed(2)}R`);
  }

  // ─── SECTION 4 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 4 -- LOSS BY ENTRY HOUR (EST, 0-23)  [TOXIC = >=60% loss rate, >=5 trades]");
  log("=".repeat(90));
  const lossPerHour: number[] = new Array(24).fill(0);
  const lossBucketHour: number[] = new Array(24).fill(0);
  const tradePerHour: number[] = new Array(24).fill(0);
  for (const t of lossTrades) { lossPerHour[t.entryHourEST]++; lossBucketHour[t.entryHourEST] += t.rMultiple; }
  for (const t of allTrades) tradePerHour[t.entryHourEST]++;
  const maxLossH = Math.max(...lossPerHour);
  log("");
  for (let h = 0; h < 24; h++) {
    if (tradePerHour[h] === 0) continue;
    const lossRate = lossPerHour[h] / tradePerHour[h];
    const toxicFlag = (lossRate >= 0.60 && tradePerHour[h] >= 5) ? " <<TOXIC>>" : "";
    const hLabel = `${String(h).padStart(2, "0")}:xx EST`;
    log(`  ${bar(hLabel, lossPerHour[h], maxLossH)} | ${pct(lossPerHour[h], tradePerHour[h])} loss rate | ${lossBucketHour[h].toFixed(2)}R | ${tradePerHour[h]} trades${toxicFlag}`);
  }

  // ─── SECTION 5 ────────────────────────────────────────────────────────────
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
  for (const [oc, data] of [...outcomeMap.entries()].sort((a, b) => b[1].count - a[1].count)) {
    log(`  ${oc.padEnd(20)} | ${data.count} losses | ${data.totalR.toFixed(2)}R total | avg ${(data.totalR / data.count).toFixed(3)}R/trade`);
  }

  // ─── SECTION 6 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 6 -- LOSS BY SESSION");
  log("=".repeat(90));
  const sessionMap = new Map<string, { losses: number; wins: number; lossR: number; winR: number }>();
  for (const t of allTrades) {
    if (!sessionMap.has(t.session)) sessionMap.set(t.session, { losses: 0, wins: 0, lossR: 0, winR: 0 });
    const e = sessionMap.get(t.session)!;
    if (t.rMultiple < 0) { e.losses++; e.lossR += t.rMultiple; } else { e.wins++; e.winR += t.rMultiple; }
  }
  log("");
  for (const [sess, data] of [...sessionMap.entries()].sort((a, b) => a[1].lossR - b[1].lossR)) {
    const total = data.wins + data.losses;
    log(`  ${sess.padEnd(22)} | Wins: ${data.wins} (${pct(data.wins, total)}) | Losses: ${data.losses} (${pct(data.losses, total)}) | WinR: +${data.winR.toFixed(2)} | LossR: ${data.lossR.toFixed(2)} | NetR: ${(data.winR + data.lossR).toFixed(2)}`);
  }

  // ─── SECTION 7 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 7 -- LOSS BY SYMBOL");
  log("=".repeat(90));
  const pairMap = new Map<string, { losses: number; wins: number; lossR: number; winR: number }>();
  for (const t of allTrades) {
    if (!pairMap.has(t.pair)) pairMap.set(t.pair, { losses: 0, wins: 0, lossR: 0, winR: 0 });
    const e = pairMap.get(t.pair)!;
    if (t.rMultiple < 0) { e.losses++; e.lossR += t.rMultiple; } else { e.wins++; e.winR += t.rMultiple; }
  }
  log("\n  " + "PAIR".padEnd(14) + "WINS".padStart(6) + "LOSSES".padStart(8) + "WIN_R".padStart(10) + "LOSS_R".padStart(10) + "NET_R".padStart(10) + "  WIN%");
  log("  " + "-".repeat(65));
  for (const [pair, data] of [...pairMap.entries()].sort((a, b) => a[1].lossR - b[1].lossR)) {
    const total = data.wins + data.losses;
    const netMark = (data.winR + data.lossR) < 0 ? " <<NEG>>" : "";
    log(`  ${pair.padEnd(14)}${data.wins.toString().padStart(6)}${data.losses.toString().padStart(8)}${data.winR.toFixed(2).padStart(10)}${data.lossR.toFixed(2).padStart(10)}${(data.winR + data.lossR).toFixed(2).padStart(10)}  ${pct(data.wins, total)}${netMark}`);
  }

  // ─── SECTION 8 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 8 -- TOP 10 WORST STREAK CONFIGS");
  log("=".repeat(90));
  const topStreaks = [...perSymbolStats].sort((a, b) => b.worstStreak - a.worstStreak).slice(0, 10);
  log("");
  for (const s of topStreaks) {
    log(`  [${s.symbol.padEnd(32)}] WorstStreak=${s.worstStreak} | AvgLoss=${s.avgLoss.toFixed(3)}R | TotalLossR=${s.lossR.toFixed(2)}`);
  }

  // ─── SECTION 9 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 9 -- TOXIC HOUR FINGERPRINT (loss rate >= 60%, min 5 trades)");
  log("=".repeat(90));
  log("");
  let toxicFound = false;
  for (let h = 0; h < 24; h++) {
    if (tradePerHour[h] < 5) continue;
    if (lossPerHour[h] / tradePerHour[h] >= 0.60) {
      log(`  WARNING: ${String(h).padStart(2, "0")}:xx EST -- ${((lossPerHour[h] / tradePerHour[h]) * 100).toFixed(1)}% loss rate | ${lossPerHour[h]}/${tradePerHour[h]} trades | ${lossBucketHour[h].toFixed(2)}R lost`);
      toxicFound = true;
    }
  }
  if (!toxicFound) log("  No toxic hours found.");

  // ─── SECTION 10 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 10 -- TOXIC DAY FINGERPRINT (loss rate >= 60%, min 5 trades)");
  log("=".repeat(90));
  log("");
  let toxicDayFound = false;
  for (let d = 0; d < 7; d++) {
    if (countPerDow[d] < 5) continue;
    if (lossPerDow[d] / countPerDow[d] >= 0.60) {
      log(`  WARNING: ${DOW_NAMES[d]} -- ${((lossPerDow[d] / countPerDow[d]) * 100).toFixed(1)}% loss rate | ${lossPerDow[d]}/${countPerDow[d]} trades | ${lossBucketDow[d].toFixed(2)}R`);
      toxicDayFound = true;
    }
  }
  if (!toxicDayFound) log("  No toxic days found.");

  // ─── SECTION 11 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 11 -- HOUR x DAY LOSS HEATMAP (cumulative loss R per cell)");
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
    if (!heatmapCount[h].some(c => c > 0)) continue;
    const cells = heatmap[h].map((v, d) => heatmapCount[h][d] === 0 ? "       ." : v.toFixed(1).padStart(8));
    log(`  ${String(h).padStart(2, "0")}:xx  ` + cells.join(""));
  }
  log("\n  Values = cumulative loss R. More negative = more damaging.");

  // ─── SECTION 12 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 12 -- INDIVIDUAL LOSING TRADES PER PAIR/SESSION (worst first)");
  log("=".repeat(90));

  const tradesByGroup = new Map<string, TradeSummary[]>();
  for (const t of lossTrades) {
    const key = `${t.pair}|${t.bot}|${t.session}`;
    if (!tradesByGroup.has(key)) tradesByGroup.set(key, []);
    tradesByGroup.get(key)!.push(t);
  }
  for (const [key, trades] of [...tradesByGroup.entries()].sort()) {
    log(`\n  -- ${key} -- (${trades.length} losing trades)`);
    log(`     ${"DATE".padEnd(12)} ${"DOW".padEnd(5)} ${"ENTRY".padEnd(9)} ${"EXIT_H".padEnd(7)} ${"OUTCOME".padEnd(14)} ${"R".padStart(7)} ${"DIR".padEnd(5)}`);
    log(`     ${"-".repeat(68)}`);
    for (const t of [...trades].sort((a, b) => a.rMultiple - b.rMultiple)) {
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

  // ─── SECTION 13 ────────────────────────────────────────────────────────────
  log("\n\n" + "=".repeat(90));
  log("  SECTION 13 -- SHADOW vs MATH COMPARISON NOTES & RECOMMENDATIONS");
  log("=".repeat(90));
  log("");

  const worst3 = [...perSymbolStats].sort((a, b) => a.lossR - b.lossR).slice(0, 3);
  log("  Top 3 worst-loss configs (Shadow):");
  for (const s of worst3) {
    log(`    - ${s.symbol}: ${s.lossR.toFixed(2)}R loss | ${s.losses} losing trades | avg ${s.avgLoss.toFixed(3)}R | streak ${s.worstStreak}`);
  }

  log("\n  Toxic entry hours (>=60% loss rate, >=5 trades):");
  let anyH = false;
  for (let h = 0; h < 24; h++) {
    if (tradePerHour[h] < 5) continue;
    if (lossPerHour[h] / tradePerHour[h] >= 0.60) {
      log(`    - Hour ${h}:xx EST -- consider toxicHours filter`);
      anyH = true;
    }
  }
  if (!anyH) log("    - None.");

  log("\n  Toxic days (>=60% loss rate, >=5 trades):");
  let anyD = false;
  for (let d = 0; d < 7; d++) {
    if (countPerDow[d] < 5) continue;
    if (lossPerDow[d] / countPerDow[d] >= 0.60) {
      log(`    - ${DOW_NAMES[d]} -- consider toxicDays filter`);
      anyD = true;
    }
  }
  if (!anyD) log("    - None.");

  log("\n  Outcome type breakdown:");
  for (const [oc, data] of [...outcomeMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3)) {
    log(`    - ${oc}: ${data.count} trades, ${data.totalR.toFixed(2)}R, avg ${(data.totalR / data.count).toFixed(3)}R`);
  }

  log("\n  Pairs with net-negative results:");
  let anyNeg = false;
  for (const [pair, data] of [...pairMap.entries()]) {
    if ((data.winR + data.lossR) < 0) {
      log(`    - ${pair}: NetR=${( data.winR + data.lossR).toFixed(2)}R, WR=${pct(data.wins, data.wins + data.losses)}`);
      anyNeg = true;
    }
  }
  if (!anyNeg) log("    - None (all pairs are net-positive).");

  log("\n\n" + "=".repeat(90));
  log(`  Analysis complete. Full report saved to: ${OUTPUT_FILE}`);
  log("=".repeat(90));

  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf-8");
  console.log(`\nReport written to: ${OUTPUT_FILE}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
