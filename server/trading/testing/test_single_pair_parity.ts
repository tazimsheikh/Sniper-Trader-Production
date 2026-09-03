// ============================================================
// test_single_pair_parity.ts
//
// Parity verification engine for a SINGLE bot and symbol.
// Runs Tier 1 (MathBacktester) and Tier 2 (OrchestratorShadowBacktester)
// sequentially and performs a trade-by-trade parity comparison.
//
// Usage:
//   npx tsx server/trading/testing/test_single_pair_parity.ts <BOT> <PAIR> <START_DATE> <END_DATE>
// Example:
//   npx tsx server/trading/testing/test_single_pair_parity.ts MAGE USDJPY 2026-04-01 2026-04-30
// ============================================================

import { runMathBacktest } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest } from "../backtester/SageMathBacktester.js";
import { runMathBacktest as runSeerMathBacktest } from "../backtester/SeerMathBacktester.js";
import { runShadowBacktest } from "../backtester/OrchestratorShadowBacktester.js";
import { PairConfigManager } from "../config/PairConfig.js";
import { getFixedEstDate } from "../backtester/math_core/MathCoreUtils.js";

async function main() {
    const bot = process.argv[2] || "MAGE";
    const pair = process.argv[3] || "USDJPY";
    let startDate = process.argv[4];
    let endDate = process.argv[5];

    if (!startDate || !endDate || startDate === "DYNAMIC" || endDate === "DYNAMIC") {
        const fs = await import('fs');
        const path = await import('path');
        const basePrefix = pair.split('_')[0].split('.')[0].toLowerCase();
        const pairPrefix = pair.split('_')[0].toLowerCase();
        const csvFiles = fs.readdirSync(csvDir).filter((f) => (f.toLowerCase().startsWith(pairPrefix) || f.toLowerCase().startsWith(basePrefix)) && f.endsWith(".csv"));
        if (csvFiles.length > 0) {
            const { getLatestDate } = await import("../backtester/loadCsv.js");
            const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
            endDate = latestDate.toISOString().substring(0, 10);
            const sd = new Date(latestDate.getTime());
            sd.setMonth(sd.getMonth() - 1);
            startDate = sd.toISOString().substring(0, 10);
        } else {
            startDate = "2026-04-01";
            endDate = "2026-04-30";
        }
    }

    (global as any).__SIM_ENABLE_TRACE__ = true;

    let t1Taken: any[] = [];
    if (bot === "MAGE") {
        const configs = PairConfigManager.getMageConfigs(pair);
        const res = await runMathBacktest(pair, startDate, endDate, false, undefined, undefined, null, configs, true);
        t1Taken = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
    } else if (bot === "SAGE") {
        const configs = PairConfigManager.getSageConfigs(pair);
        const res = await runSageMathBacktest(pair, startDate, endDate, false, undefined, configs, true);
        t1Taken = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
    } else if (bot === "SEER") {
        const configs = PairConfigManager.getSeerConfigs(pair);
        const res = await runSeerMathBacktest(pair, startDate, endDate, false);
        t1Taken = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
    }

    const targetStartMs = new Date(startDate).getTime();
    const targetEndMs = new Date(endDate + 'T23:59:59Z').getTime();

    // Filter T1 to only include trades in the requested date range (EST Calendar Date)
    t1Taken = t1Taken.filter((t: any) => {
        const dStr = t.date || getFixedEstDate(new Date(t.openTime || t.timestamp || t.entryTimeMs)).toISOString().split("T")[0];
        return dStr >= startDate && dStr <= endDate;
    });
    // Sort T1 chronologically by timestamp/entry time
    t1Taken.sort((a: any, b: any) => (a.entryTimeMs || a.timestamp || new Date(a.date).getTime()) - (b.entryTimeMs || b.timestamp || new Date(b.date).getTime()));

    const t1R = t1Taken.reduce((a, b) => a + (b.rMultiple || 0), 0);
    const t1Count = t1Taken.length;

    const t2Config = { 
        enableMage: bot === "MAGE", 
        enableSage: bot === "SAGE",
        enableSeer: bot === "SEER"
    };

    const tier2Full = await runShadowBacktest(pair, startDate, endDate, t2Config);
    const t2Raw = tier2Full.tradeLog || [];
    
    // Filter T2 for the requested bot AND the requested date range (EST Calendar Date)
    const t2Taken = t2Raw.filter((t: any) => {
        const dStr = getFixedEstDate(new Date(t.openTime)).toISOString().split("T")[0];
        if (dStr < startDate || dStr > endDate) return false;
        const cid = t.clientId?.toUpperCase() || "";
        const isBot = t.botId?.toUpperCase() === bot;
        return isBot;
    });

    const t2R = t2Taken.reduce((a, b) => a + (b.rMultiple || 0), 0);
    const t2Count = t2Taken.length;

    console.log("\n=================== TIER 1 (MATH) TRADES ===================");
    t1Taken.forEach((t: any) => {
        const entryStr = t.entryTimeMs ? new Date(t.entryTimeMs).toISOString().replace("T", " ").substring(11, 19) : "N/A";
        console.log(`[T1] Date: ${t.date} | EntryTime: ${entryStr} | Entry: ${t.entry} | SL: ${t.stopLoss} | TP: ${t.takeProfit} | Exit: ${t.exitPrice || 'N/A'} | Outcome: ${t.outcome} | R: ${t.rMultiple.toFixed(2)}`);
        if (t.trailLog && t.trailLog.length > 0) {
            console.log(`     -> Trail Updates (${t.trailLog.length}): ${t.trailLog.map((x: any) => `[${new Date(x.time).toISOString().substring(11,19)}] ${x.sl}`).join(" -> ")}`);
        }
    });

    console.log("\n=================== TIER 2 (SHADOW) TRADES ===================");
    t2Taken.forEach((t: any) => {
        const fillStr = t.fillTime ? new Date(t.fillTime).toISOString().replace("T", " ").substring(11, 19) : "N/A";
        const exitStr = t.closeTime ? new Date(t.closeTime).toISOString().replace("T", " ").substring(11, 19) : "N/A";
        if (new Date(t.openTime).toISOString().includes("2024-10-01")) {
            console.log(JSON.stringify(t, null, 2));
        }
        console.log(`[T2] Date: ${new Date(t.openTime).toISOString().substring(0, 10)} | LimitPlaced: ${new Date(t.openTime).toISOString().substring(11, 19)} | FillTime: ${fillStr} | ExitTime: ${exitStr} | Entry: ${t.entryPrice} | SL: ${t.slPrice} | TP: ${t.tpPrice} | Outcome: ${t.outcome} | R: ${t.rMultiple.toFixed(2)} | clientId: ${t.clientId}`);
        if (t.trailLog && t.trailLog.length > 0) {
            console.log(`     -> Trail Updates (${t.trailLog.length}): ${t.trailLog.map((x: any) => `[${new Date(x.time).toISOString().substring(11,19)}] ${x.sl}`).join(" -> ")}`);
        }
    });
    console.log("============================================================\n");

    console.log(`TIER 1 (Math)   : Trades = ${t1Count} | Net R = ${t1R.toFixed(5)}`);
    console.log(`TIER 2 (Shadow) : Trades = ${t2Count} | Net R = ${t2R.toFixed(5)}`);

    const rDiff = Math.abs(t1R - t2R);
    const countMatch = t1Count === t2Count;
    // Per user directive: ignore micro net R discrepancies (< 0.1 per trade)
    const maxAllowedRDiff = Math.max(0.1001, t1Count * 0.035);
    const rMatch = rDiff <= maxAllowedRDiff;

    let microMatch = true;
    if (countMatch && t1Count > 0) {
        const sortedT1 = [...t1Taken].sort((a,b) => {
          const tDiff = (a.entryTimeMs || a.timestamp || a.openTime || 0) - (b.entryTimeMs || b.timestamp || b.openTime || 0);
          if (tDiff !== 0) return tDiff;
          // Tiebreaker: sort by SL to ensure deterministic pairing of simultaneous config fires
          return (a.stopLoss || a.slPrice || 0) - (b.stopLoss || b.slPrice || 0);
        });
        const sortedT2 = [...t2Taken].sort((a,b) => {
          const tDiff = (a.openTime || a.timestamp || 0) - (b.openTime || b.timestamp || 0);
          if (tDiff !== 0) return tDiff;
          // Tiebreaker: sort by SL
          return (a.slPrice || a.originalSl || 0) - (b.slPrice || b.originalSl || 0);
        });
        
        for (let i = 0; i < sortedT1.length; i++) {
            const t1 = sortedT1[i];
            const t2 = sortedT2[i];
            const r1 = t1.rMultiple || 0;
            const r2 = t2.rMultiple || 0;
            if (Math.abs(r1 - r2) > 0.01) {
                console.log(`[R DIFF Trade ${i}] Date: ${t1.date} | T1 R: ${r1.toFixed(4)} (Outcome: ${t1.outcome}) | T2 R: ${r2.toFixed(4)} (Outcome: ${t2.outcome}) | diff: ${(r1 - r2).toFixed(4)}`);
            }
        }

        for (let i = 0; i < sortedT1.length; i++) {
            const t1 = sortedT1[i];
            const t2 = sortedT2[i];
            const e1 = Number(t1.entry);
            const e2 = Number(t2.entryPrice);
            const sl1 = Number(t1.stopLoss);
            const sl2 = Number(t2.originalSl || t2.slPrice);
            const tp1 = Number(t1.takeProfit || 0);
            const tp2 = Number(t2.tpPrice || 0);
            
            const exit1 = Number(t1.exitPrice || 0);
            const exit2 = Number(t2.closePrice || 0);
            const eDiff = Math.abs(e1 - e2);
            const slDiff = Math.min(
                Math.abs(sl1 - Number(t2.originalSl || t2.slPrice)),
                Math.abs(sl1 - Number(t2.slPrice || t2.originalSl))
            );
            const tpDiff = Math.abs(tp1 - tp2);

            // Realistic tolerance based on price magnitude (e.g. 0.005 for forex, higher for indices/gold)
            const priceTol = Math.max(0.005, e1 * 0.0002);
            const isTpOutcome = t1.outcome === "TP" || t2.outcome === "TP" || t1.takeProfitHit || t2.takeProfitHit;
            if (eDiff > priceTol || slDiff > priceTol || (isTpOutcome && t1.takeProfit && t2.tpPrice && tpDiff > priceTol)) {
                console.log(`[MICRO MISMATCH] Trade index ${i} (${t1.date || t1.openTime}): eDiff=${eDiff.toFixed(4)} (e1=${e1}, e2=${e2}), slDiff=${slDiff.toFixed(4)} (sl1=${sl1}, sl2=${sl2}), tpDiff=${tpDiff.toFixed(4)} (isTp=${isTpOutcome}, tol=${priceTol.toFixed(4)})`);
                microMatch = false;
                break;
            }
        }
    } else if (t1Count === 0 && t2Count === 0) {
        microMatch = true;
    } else {
        microMatch = false;
    }

    console.log("\n--- Parity Checks ---");
    console.log(`Trade Count Match : ${countMatch ? '✅' : '❌'}`);
    console.log(`Net R Match       : ${rMatch ? '✅' : '❌'}`);
    console.log(`Micro Details Match : ${microMatch ? '✅' : '❌'}`);

    if (countMatch && rMatch && microMatch) {
        console.log("\nFULL PIPELINE PARITY CONFIRMED");
    } else {
        console.log("\nPARITY BROKEN");
    }
}

main().catch(console.error);
