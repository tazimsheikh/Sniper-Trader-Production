import path from "path";
import fs from "fs";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { PairConfigManager } from "../config/PairConfig.js";
import { loadCsv } from "../backtester/loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { preComputeTriggers, evaluateExits } from "../backtester/math_core/SageMathCore.js";
import { buildM1TypedArrays } from "../backtester/math_core/MathCoreUtils.js";

const START_DATE = "2025-09-02";
const END_DATE = "2026-09-02";

interface LossForensics {
  symbol: string;
  dateStr: string;
  direction: string;
  rMultiple: number;
  outcome: string;
  durationMins: number;
  mfeR: number;
  maeR: number;
  cBodyPips: number;
  sweepPips: number;
  maxSweepMultiplier: number;
  wbr: number;
  closeLocationHalf: boolean;
  archetype: "INSTANT_FAKEOUT" | "CHOPPY_STALL" | "GIVEN_BACK_WIN";
}

async function runForensics() {
  const jsonPath = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster_holy_grail_portfolios.json");
  const portfolio: any[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const sageComponents = portfolio.filter((c: any) => c.botType === "Sage");

  console.log(`\n====================================================================================================`);
  console.log(` 🔬 SAGE COMPREHENSIVE LOSS FORENSICS (1-YEAR: ${START_DATE} -> ${END_DATE})`);
  console.log(`====================================================================================================\n`);

  const allLosses: LossForensics[] = [];
  const symbolStats: Record<string, { totalTrades: number; wins: number; losses: number; winR: number; lossR: number; netR: number; pf: string }> = {};

  for (const comp of sageComponents) {
    const pair = comp.symbol;
    const cleanSym = pair.replace(/\.daily$/i, "");
    const liveCfgs = PairConfigManager.getSageConfigs(cleanSym);
    let targetCfg = liveCfgs[0];
    if (liveCfgs.length > 1) {
      const match = liveCfgs.find((c: any) => comp.setup && comp.setup.includes(`StartH${c.orbStartHour}_`));
      if (match) targetCfg = match;
    }

    const optConfig = OPTIMIZER_CONFIG[cleanSym];
    if (!optConfig) continue;

    const { pipSize, spread } = optConfig;
    const spreadPts = spread * pipSize;
    const isCrypto = pair.includes("BTC") || pair.includes("ETH");
    const isIndex = pair.includes("NAS") || pair.includes("US30") || pair.includes("GER40") || pair.includes("SPX500") || pair.includes("JPN225");
    const isForex = !isCrypto && !isIndex;

    const basePrefix = cleanSym.split("_")[0].split(".")[0];
    const csvFiles = fs.readdirSync(path.join(process.cwd(), "data", "csv")).filter(f => f.startsWith(basePrefix) && f.endsWith(".csv"));
    if (!csvFiles.length) continue;

    const startD = new Date(new Date(START_DATE).getTime() - 15 * 86400000);
    const endD = new Date(new Date(END_DATE).getTime() + 86400000);
    const m1Rows = await loadCsv(path.join(process.cwd(), "data", "csv", csvFiles[0]), spread, startD, endD);
    const m5Candles = aggregateCandles(m1Rows, 5);
    const m1Typed = (buildM1TypedArrays as any)(m1Rows, spreadPts);

    const triggers = preComputeTriggers(
      m5Candles, m1Rows, cleanSym, spreadPts, targetCfg.session || "london",
      isForex, pipSize, targetCfg.orbStartHour, targetCfg.orbStartMin,
      targetCfg.orbMinutes, targetCfg.sweepPips, targetCfg.actionMinutes
    );

    const res = evaluateExits(m1Typed, m5Candles, triggers, cleanSym, targetCfg, targetCfg.session || "london", isForex, 0);
    const valid = res.tradeRecords.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");

    let pWins = 0, pLoss = 0, pWinR = 0, pLossR = 0;
    for (const r of valid) {
      const rm = r.rMultiple ?? 0;
      if (rm > 0.05) { pWins++; pWinR += rm; }
      else if (rm < -0.05) {
        pLoss++;
        pLossR += rm;

        const mfe = r.mfe ?? 0;
        const mae = r.mae ?? -1;
        let archetype: "INSTANT_FAKEOUT" | "CHOPPY_STALL" | "GIVEN_BACK_WIN";
        if (mfe >= 0.80) archetype = "GIVEN_BACK_WIN";
        else if (mfe < 0.25) archetype = "INSTANT_FAKEOUT";
        else archetype = "CHOPPY_STALL";

        allLosses.push({
          symbol: cleanSym,
          dateStr: r.dateStr || "",
          direction: r.direction || "",
          rMultiple: rm,
          outcome: r.outcome,
          durationMins: r.durationMinutes ?? 0,
          mfeR: mfe,
          maeR: mae,
          cBodyPips: r.cBodyPips ?? 0,
          sweepPips: targetCfg.sweepPips ?? 0,
          maxSweepMultiplier: targetCfg.maxSweepMultiplier ?? 3,
          wbr: r.wbr ?? 0,
          closeLocationHalf: r.closeLocationHalf ?? false,
          archetype
        });
      }
    }

    const netR = pWinR + pLossR;
    const pf = Math.abs(pLossR) > 0 ? (pWinR / Math.abs(pLossR)).toFixed(2) : "N/A";
    symbolStats[cleanSym] = {
      totalTrades: valid.length,
      wins: pWins,
      losses: pLoss,
      winR: pWinR,
      lossR: pLossR,
      netR,
      pf
    };
  }

  console.log(`  PAIR RANKING BY LOSS DAMAGE (Worst to Least):`);
  console.log(`  SYMBOL       | TRADES | WINS | LOSS |  WIN%  |   WIN_R   |   LOSS_R  |   NET_R   |   PF`);
  console.log(`  ` + "-".repeat(80));

  const sortedPairs = Object.entries(symbolStats).sort((a, b) => a[1].lossR - b[1].lossR);
  for (const [sym, st] of sortedPairs) {
    const wr = st.totalTrades > 0 ? ((st.wins / st.totalTrades) * 100).toFixed(1) : "0.0";
    console.log(`  ${sym.padEnd(12)} | ${String(st.totalTrades).padStart(6)} | ${String(st.wins).padStart(4)} | ${String(st.losses).padStart(4)} | ${wr.padStart(5)}% | +${st.winR.toFixed(2).padStart(7)}R | ${st.lossR.toFixed(2).padStart(8)}R | +${st.netR.toFixed(2).padStart(7)}R | ${st.pf.padStart(5)}`);
  }

  // Archetype Breakdown
  let fCount = 0, fLossR = 0;
  let cCount = 0, cLossR = 0;
  let gCount = 0, gLossR = 0;

  for (const l of allLosses) {
    if (l.archetype === "INSTANT_FAKEOUT") { fCount++; fLossR += l.rMultiple; }
    else if (l.archetype === "CHOPPY_STALL") { cCount++; cLossR += l.rMultiple; }
    else if (l.archetype === "GIVEN_BACK_WIN") { gCount++; gLossR += l.rMultiple; }
  }

  console.log(`\n  ============================== LOSS ARCHETYPE BREAKDOWN ==============================`);
  console.log(`  1. INSTANT FAKEOUTS (MFE < 0.25R) : ${fCount} losses | ${fLossR.toFixed(2)}R loss pool (${((fCount / allLosses.length) * 100).toFixed(1)}% of losses)`);
  console.log(`  2. CHOPPY STALLS (0.25R <= MFE < 0.80R): ${cCount} losses | ${cLossR.toFixed(2)}R loss pool (${((cCount / allLosses.length) * 100).toFixed(1)}% of losses)`);
  console.log(`  3. GIVEN-BACK WINS (MFE >= 0.80R)  : ${gCount} losses | ${gLossR.toFixed(2)}R loss pool (${((gCount / allLosses.length) * 100).toFixed(1)}% of losses)`);
  console.log(`  TOTAL LOSSES ANALYZED              : ${allLosses.length} losses | ${(fLossR + cLossR + gLossR).toFixed(2)}R total loss drag`);
  console.log(`========================================================================================\n`);
}

runForensics();
