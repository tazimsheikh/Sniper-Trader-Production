import { runMathBacktest } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest } from "../backtester/SageMathBacktester.js";
import { PairConfigManager, MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG } from "../config/PairConfig.js";

async function simulate6Months2026() {
  const isAllMode = !process.argv[2] || process.argv[2] === "all";
  const targetRisks = isAllMode 
    ? [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60] 
    : [parseFloat(process.argv[2])];

  console.log("=========================================================================");
  console.log(` 💰 $100 ACCOUNT RISK MULTIPLIER SIMULATION REPORT — 6-MONTH YTD 2026`);
  console.log("=========================================================================\n");

  const months = [
    { name: "Feb 2026", start: "2026-02-01", end: "2026-02-28" },
    { name: "Mar 2026", start: "2026-03-01", end: "2026-03-31" },
    { name: "Apr 2026", start: "2026-04-01", end: "2026-04-30" },
    { name: "May 2026", start: "2026-05-01", end: "2026-05-31" },
    { name: "Jun 2026", start: "2026-06-01", end: "2026-06-30" },
    { name: "Jul 2026", start: "2026-07-01", end: "2026-07-31" },
  ];

  const botPairs = [
    { bot: "MAGE", pairs: Object.keys(MAGE_PAIR_CONFIG) },
    { bot: "SAGE", pairs: Object.keys(SAGE_PAIR_CONFIG || {}) },
  ];

  let allTrades: any[] = [];

  const overallStartMs = new Date("2026-02-01").getTime();
  const overallEndMs = new Date("2026-07-31T23:59:59Z").getTime();

  for (const group of botPairs) {
    const { bot, pairs } = group;
    for (const pair of pairs) {
      try {
        if (bot === "MAGE") {
          const configs = PairConfigManager.getMageConfigs(pair);
          for (const c of configs) {
            const res = await runMathBacktest(pair, "2026-02-01", "2026-07-31", false, undefined, undefined, null, [c], false);
            const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
            valid.forEach((r: any) => { r.bot = bot; r.pair = pair; r.riskMultiplier = c.riskPct || 1.0; });
            allTrades = allTrades.concat(valid);
          }
        } else if (bot === "SAGE") {
          const configs = PairConfigManager.getSageConfigs(pair);
          for (const c of configs) {
            const res = await runSageMathBacktest(pair, "2026-02-01", "2026-07-31", false, {}, [c], false);
            const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
            valid.forEach((r: any) => { r.bot = bot; r.pair = pair; r.riskMultiplier = c.riskPct || 1.0; });
            allTrades = allTrades.concat(valid);
          }
        }
      } catch (e: any) {
        console.error(`Error processing ${pair} for ${bot}:`, e.message);
      }
    }
  }

  // Filter chronologically
  allTrades = allTrades.filter((t: any) => {
    const tMs = new Date(t.date).getTime();
    return tMs >= overallStartMs && tMs <= overallEndMs;
  });

  // Sort strictly by trade timestamp
  allTrades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  console.log(`📊 Total Trades Executed Across 6 Months (Feb 1 – Jul 31, 2026): ${allTrades.length}\n`);

  function runMode(allTrades: any[], months: any[], mode: 'CONTINUOUS' | 'MONTHLY' | 'FIXED', BASE_RISK: number) {
    let bal = 100.0;
    let peak = 100.0;
    let maxDdDollar = 0;
    let maxDdPct = 0;
    let maxIntradayDd = 0;

    let startOfDayBal = 100.0;
    let currentEstDay = "";
    let dwcbPeakBal = 100.0;
    let halted = false;

    const monthlySnapshots: any[] = [];
    let totalNetR = 0;
    let totalWins = 0;
    let tradesTaken = 0;

    const configProfit: Record<string, { netR: number, trades: number, pnl: number }> = {};
    let riskBase = 100.0;

    for (const m of months) {
      if (mode === 'MONTHLY') {
        riskBase = bal;
      }

      const mStartMs = new Date(m.start).getTime();
      const mEndMs = new Date(m.end + "T23:59:59Z").getTime();
      const mTrades = allTrades.filter((t: any) => {
        const tMs = new Date(t.date).getTime();
        return tMs >= mStartMs && tMs <= mEndMs;
      });

      const startBal = bal;

      for (const t of mTrades) {
        if (halted) continue;

        const dateStr = new Date(t.date).toLocaleString("en-US", { timeZone: "America/New_York" });
        const estObj = new Date(dateStr);
        let simEstDay = `${estObj.getFullYear()}-${estObj.getMonth() + 1}-${estObj.getDate()}`;
        if (estObj.getHours() >= 17) {
          estObj.setDate(estObj.getDate() + 1);
          simEstDay = `${estObj.getFullYear()}-${estObj.getMonth() + 1}-${estObj.getDate()}`;
        }

        if (simEstDay !== currentEstDay) {
          currentEstDay = simEstDay;
          startOfDayBal = bal;
        }

        const dailyDrawdown = (bal - startOfDayBal) / startOfDayBal;
        if (dailyDrawdown < maxIntradayDd) maxIntradayDd = dailyDrawdown;
        if (dailyDrawdown <= -0.045) continue;

        const absoluteDrawdown = (bal - 100.0) / 100.0;
        if (absoluteDrawdown <= -0.095) {
          halted = true;
          continue;
        }

        // DWCB scaling disabled per user directive - fixed at 1.0
        const dwcbMultiplier = 1.0;

        if (mode === 'CONTINUOUS') {
          riskBase = bal;
        } else if (mode === 'FIXED') {
          riskBase = 100.0;
        } // MONTHLY is already set at the top of the month loop

        const effectiveRiskPct = BASE_RISK * (t.riskMultiplier || 1.0) * dwcbMultiplier;
        const dollarRisk = riskBase * effectiveRiskPct;
        const dollarPnl = dollarRisk * (t.rMultiple || 0);
        
        bal += dollarPnl;
        
        if (bal > peak) peak = bal;
        const ddDollar = peak - bal;
        const ddPct = (ddDollar / peak) * 100;
        if (ddDollar > maxDdDollar) maxDdDollar = ddDollar;
        if (ddPct > maxDdPct) maxDdPct = ddPct;

        totalNetR += (t.rMultiple || 0);
        if ((t.rMultiple || 0) > 0) totalWins++;
        tradesTaken++;

        const key = t.bot + " " + t.pair;
        if (!configProfit[key]) configProfit[key] = { netR: 0, trades: 0, pnl: 0 };
        configProfit[key].netR += (t.rMultiple || 0);
        configProfit[key].trades += 1;
        configProfit[key].pnl += dollarPnl;
      }

      monthlySnapshots.push({
        month: m.name,
        trades: tradesTaken,
        wins: totalWins,
        netR: totalNetR,
        endBal: bal,
        monthProfit: bal - startBal,
      });
    }

    return { bal, peak, maxDdPct, maxDdDollar, maxIntradayDd, configProfit, monthlySnapshots, totalNetR, tradesTaken, halted };
  }

  for (const BASE_RISK of targetRisks) {
    const baseRiskLabel = (BASE_RISK * 100).toFixed(0) + "%";
    const resContinuous = runMode(allTrades, months, 'CONTINUOUS', BASE_RISK);
    const resMonthly = runMode(allTrades, months, 'MONTHLY', BASE_RISK);
    const resFixed = runMode(allTrades, months, 'FIXED', BASE_RISK);

    console.log("==================================================================================================================================");
    console.log(` 📅 MONTH-BY-MONTH DOLLAR GROWTH @ ${baseRiskLabel} RISK (STARTING BALANCE = $100.00)`);
    console.log("==================================================================================================================================");
    console.log(" MONTH     | TRADES | NET R     || CONTINUOUS COMP   | MONTH PROFIT || MONTHLY COMP      | MONTH PROFIT || NO COMP (FIXED)   | MONTH PROFIT");
    console.log("----------------------------------------------------------------------------------------------------------------------------------");

    for (let i = 0; i < months.length; i++) {
      const sc = resContinuous.monthlySnapshots[i];
      const sm = resMonthly.monthlySnapshots[i];
      const sf = resFixed.monthlySnapshots[i];
      console.log(
        ` ${sc.month.padEnd(9)} | ${String(sc.trades).padStart(6)} | ${sc.netR.toFixed(2).padStart(7)}R || $${sc.endBal.toFixed(2).padStart(15)} | $${sc.monthProfit.toFixed(2).padStart(10)} || $${sm.endBal.toFixed(2).padStart(15)} | $${sm.monthProfit.toFixed(2).padStart(10)} || $${sf.endBal.toFixed(2).padStart(15)} | $${sf.monthProfit.toFixed(2).padStart(10)}`
      );
    }

    console.log("==================================================================================================================================");
    console.log(` 🏆 6-MONTH OVERALL SUMMARY (FEB 1 – JUL 31, 2026) @ ${baseRiskLabel} BASE RISK MULTIPLIER`);
    console.log("==================================================================================================================================");
    
    const mageTrades = allTrades.filter(t => t.bot === "MAGE");
    const sageTrades = allTrades.filter(t => t.bot === "SAGE");

    const mageRes = runMode(mageTrades, months, 'CONTINUOUS', BASE_RISK);
    const sageRes = runMode(sageTrades, months, 'CONTINUOUS', BASE_RISK);

    function printBotSummary(botName: string, res: any) {
      console.log(` 🤖 BOT ISOLATION: ${botName}`);
      console.log(`    • Net R             : ${res.totalNetR.toFixed(2)}R`);
      console.log(`    • Max Drawdown      : $${res.maxDdDollar.toFixed(2)} (${res.maxDdPct.toFixed(2)}%)`);
      console.log(`    • Max Intraday DD   : ${(res.maxIntradayDd * 100).toFixed(2)}%`);
      if (res.halted) console.log(`    • 🚨 ACCOUNT HALTED`);
      console.log(`    • Breakdowns:`);
      for (const [key, stats] of Object.entries(res.configProfit) as [string, any][]) {
         console.log(`      - ${key.padEnd(15)} : ${stats.netR.toFixed(2).padStart(6)}R | Trades: ${stats.trades}`);
      }
      console.log("----------------------------------------------------------------------------------------------------------------------------------");
    }

    printBotSummary("MAGE", mageRes);
    printBotSummary("SAGE", sageRes);
    
    function printSummary(name: string, res: any) {
      console.log(` 🛡️ TOTAL PORTFOLIO: ${name}`);
      console.log(`    • Total Trades       : ${res.tradesTaken}`);
      console.log(`    • Total Net R        : ${res.totalNetR.toFixed(2)}R`);
      console.log(`    • Final Balance      : $${res.bal.toFixed(2)}`);
      console.log(`    • Net Profit / Loss  : $${(res.bal - 100).toFixed(2)} (${((res.bal - 100) / 100 * 100).toFixed(1)}%)`);
      console.log(`    • Peak Balance       : $${res.peak.toFixed(2)}`);
      console.log(`    • Max Drawdown       : $${res.maxDdDollar.toFixed(2)} (${res.maxDdPct.toFixed(1)}%)`);
      console.log(`    • Max Intraday DD    : ${(res.maxIntradayDd * 100).toFixed(2)}%`);
      if (res.halted) {
        console.log(`    • 🚨 ACCOUNT HALTED DURING SIMULATION (Hit 9.5% Absolute Drawdown)`);
      }
      console.log("==================================================================================================================================");
    }

    printSummary("CONTINUOUS COMPOUNDING (Updated every trade)", resContinuous);
    console.log("\n");
  }
}

simulate6Months2026().catch(console.error);
