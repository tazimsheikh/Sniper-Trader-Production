import * as fs from "fs";
import * as path from "path";
import { SEER_PAIR_CONFIG } from "../config/PairConfig.js";
import { runSeerMathBacktest, clearSeerBacktestCache } from "../backtester/SeerMathBacktester.js";
import paramsToConfig from "../optimizer/grandmaster/utils/seer_params_parser.js";

interface AuditResult {
  pair: string;
  source: string;
  session: string;
  setup: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netR: number;
  maxDD: number;
  profitFactor: number;
}

function calculateMaxDD(records: any[]): { maxDD: number; profitFactor: number } {
  let cumR = 0;
  let peak = 0;
  let maxDD = 0;
  let grossWin = 0;
  let grossLoss = 0;

  for (const r of records) {
    if (r.outcome === "SKIPPED") continue;
    const rMult = r.rMultiple ?? 0;
    cumR += rMult;
    if (cumR > peak) peak = cumR;
    const dd = peak - cumR;
    if (dd > maxDD) maxDD = dd;

    if (rMult > 0) grossWin += rMult;
    else grossLoss += Math.abs(rMult);
  }

  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99.9 : 0);
  return { maxDD, profitFactor };
}

async function runAudit() {
  console.log("\n================================================================================");
  console.log("🔮 SEER MATHEMATICAL BACKTEST COMPREHENSIVE AUDIT");
  console.log("================================================================================\n");

  const resultsActive: AuditResult[] = [];
  const resultsDumpTop: AuditResult[] = [];

  // ── PART 1: AUDIT ACTIVE CONFIGS IN PairConfig.ts (SEER_PAIR_CONFIG) ────────
  console.log("▶ PART 1: Testing ACTIVE Configurations in PairConfig.ts (Live Grandmaster Portfolio)...\n");

  for (const [pair, configs] of Object.entries(SEER_PAIR_CONFIG)) {
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const session = cfg.session || "ny";
      const setupDesc = `Body:${cfg.minBodyPips}_Wick:${cfg.pinBarWickBodyRatio}_SL:${cfg.minSlDist}-${cfg.maxSlDist}_Trig:${cfg.trailingSlTrigger}_Step:${cfg.trailingSlStep}_FC:${cfg.forceCloseHours}`;

      try {
        const res = await runSeerMathBacktest(pair, undefined, undefined, false, {}, [cfg], false);
        const { maxDD, profitFactor } = calculateMaxDD(res.records || []);

        resultsActive.push({
          pair,
          source: `PairConfig[${i}]`,
          session,
          setup: setupDesc,
          trades: res.trades,
          wins: res.wins,
          losses: res.losses,
          winRate: res.winRate,
          netR: res.totalNetR,
          maxDD,
          profitFactor,
        });
        clearSeerBacktestCache(pair);
      } catch (e: any) {
        console.warn(`  ⚠️ Error on ${pair}: ${e.message}`);
      }
    }
  }

  // ── PART 2: AUDIT TOP RANK-1 CONFIG FOR ALL 25 PAIRS FROM OPTIMIZER DUMP ───
  console.log("▶ PART 2: Testing TOP (Rank 1) Alphas from seer_optimizer_dump across all 25 pairs...\n");

  const dumpDir = path.join(process.cwd(), "server", "trading", "optimizer", "seer", "seer_optimizer_dump");
  if (fs.existsSync(dumpDir)) {
    const files = fs.readdirSync(dumpDir).filter(f => f.startsWith("state_") && f.endsWith(".json"));

    for (const file of files) {
      const rawSym = file.replace("state_", "").replace(".json", "");
      try {
        const stateData = JSON.parse(fs.readFileSync(path.join(dumpDir, file), "utf8"));
        if (!Array.isArray(stateData) || stateData.length === 0) continue;

        const top = stateData[0];
        const parsedCfg = paramsToConfig(top.setup, rawSym);

        const res = await runSeerMathBacktest(rawSym, undefined, undefined, false, {}, [parsedCfg], false);
        const { maxDD, profitFactor } = calculateMaxDD(res.records || []);

        resultsDumpTop.push({
          pair: rawSym,
          source: "Optimizer Rank 1",
          session: parsedCfg.session || "ny",
          setup: top.setup,
          trades: res.trades,
          wins: res.wins,
          losses: res.losses,
          winRate: res.winRate,
          netR: res.totalNetR,
          maxDD,
          profitFactor,
        });
        clearSeerBacktestCache(rawSym);
      } catch (e: any) {
        console.warn(`  ⚠️ Error on ${rawSym}: ${e.message}`);
      }
    }
  }

  // ── DISPLAY TABLES ──────────────────────────────────────────────────────────
  console.log("\n================================================================================");
  console.log("📊 SECTION 1: ACTIVE SEER_PAIR_CONFIG (Current Live Portfolio Alphas)");
  console.log("================================================================================");
  console.table(
    resultsActive.map(r => ({
      Pair: r.pair,
      Session: r.session.toUpperCase(),
      Trades: r.trades,
      "Win Rate": `${r.winRate.toFixed(1)}%`,
      "Net R": `${r.netR >= 0 ? "+" : ""}${r.netR.toFixed(2)} R`,
      "Max DD": `${r.maxDD.toFixed(2)} R`,
      "Profit Factor": r.profitFactor.toFixed(2),
      Setup: r.setup,
    }))
  );

  console.log("\n================================================================================");
  console.log("📊 SECTION 2: TOP RANK-1 ALPHAS FROM SEER OPTIMIZER DUMP (All 25 Pairs)");
  console.log("================================================================================");
  console.table(
    resultsDumpTop.map(r => ({
      Pair: r.pair,
      Session: r.session.toUpperCase(),
      Trades: r.trades,
      "Win Rate": `${r.winRate.toFixed(1)}%`,
      "Net R": `${r.netR >= 0 ? "+" : ""}${r.netR.toFixed(2)} R`,
      "Max DD": `${r.maxDD.toFixed(2)} R`,
      "Profit Factor": r.profitFactor.toFixed(2),
      Setup: r.setup.length > 45 ? r.setup.substring(0, 42) + "..." : r.setup,
    }))
  );

  // Summary Totals
  const activeTotR = resultsActive.reduce((sum, r) => sum + r.netR, 0);
  const activeTotT = resultsActive.reduce((sum, r) => sum + r.trades, 0);
  const dumpTotR = resultsDumpTop.reduce((sum, r) => sum + r.netR, 0);
  const dumpTotT = resultsDumpTop.reduce((sum, r) => sum + r.trades, 0);

  console.log("\n================================================================================");
  console.log(`🎯 ACTIVE PORTFOLIO TOTALS (8 Seer Alphas): ${activeTotT} Trades | ${activeTotR >= 0 ? "+" : ""}${activeTotR.toFixed(2)} R`);
  console.log(`🏆 ALL 25-PAIR RANK-1 TOTALS (25 Seer Alphas): ${dumpTotT} Trades | ${dumpTotR >= 0 ? "+" : ""}${dumpTotR.toFixed(2)} R`);
  console.log("================================================================================\n");
}

runAudit().catch(console.error);
