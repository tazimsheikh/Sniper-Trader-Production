// ============================================================
// compare_normal_vs_flat_risk.ts
//
// Direct Side-by-Side Mathematical Comparison:
// Run 1: Normal Weighted (using exact riskPct from PairConfig)
// Run 2: Flat 1.0% Risk (ignoring individual riskPct, 1% set to everything)
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { loadPortfolioTrades } from "./simulate_portfolio_risk_math.js";

interface ModeResult {
  baseRisk: string;
  finalBalance: string;
  returnPct: string;
  maxDrawdownPct: string;
  maxDailyDrawdownPct: string;
  calmarRatio: string;
  breakerHits: number;
}

function runSimulation(trades: any[], baseRisk: number, mode: 'CONTINUOUS' | 'MONTHLY' | 'FIXED'): ModeResult {
  let balance = 100.0;
  let peakBalance = 100.0;
  let maxDrawdownPct = 0;
  let maxDailyDrawdownPct = 0;
  let dailyStartBalance = 100.0;
  let currentDayStr = "";
  let circuitBreakerHits = 0;
  let monthlyBalance = 100.0;
  let currentMonthStr = "";

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const r = t.rMultiple || 0;
    const tDateStr = (t.exitTime || t.entryTime || t.date || t.time || "").substring(0, 10);
    const mStr = tDateStr.substring(0, 7);

    if (mode === 'MONTHLY' && mStr !== currentMonthStr) {
      currentMonthStr = mStr;
      monthlyBalance = balance;
    }

    if (tDateStr !== currentDayStr) {
      dailyStartBalance = balance;
      currentDayStr = tDateStr;
    }

    let riskCapital = 0;
    if (mode === 'CONTINUOUS') {
      riskCapital = balance * (baseRisk * (t.riskMultiplier || 1.0));
    } else if (mode === 'MONTHLY') {
      riskCapital = monthlyBalance * (baseRisk * (t.riskMultiplier || 1.0));
    } else {
      riskCapital = 100.0 * (baseRisk * (t.riskMultiplier || 1.0));
    }

    const pnl = riskCapital * r;
    balance += pnl;

    if (balance > peakBalance) peakBalance = balance;
    const currentDdPct = ((peakBalance - balance) / peakBalance) * 100;
    if (currentDdPct > maxDrawdownPct) maxDrawdownPct = currentDdPct;

    const intradayDdPct = ((dailyStartBalance - balance) / dailyStartBalance) * 100;
    if (intradayDdPct > maxDailyDrawdownPct) maxDailyDrawdownPct = intradayDdPct;

    if (intradayDdPct >= 4.0) {
      circuitBreakerHits++;
    }
  }

  const netReturnPct = ((balance - 100.0) / 100.0) * 100;
  const calmar = maxDrawdownPct > 0 ? netReturnPct / maxDrawdownPct : netReturnPct;

  return {
    baseRisk: (baseRisk * 100).toFixed(1) + "%",
    finalBalance: "$" + balance.toFixed(2),
    returnPct: (netReturnPct > 0 ? "+" : "") + netReturnPct.toFixed(1) + "%",
    maxDrawdownPct: maxDrawdownPct.toFixed(2) + "%",
    maxDailyDrawdownPct: maxDailyDrawdownPct.toFixed(2) + "%",
    calmarRatio: calmar.toFixed(2),
    breakerHits: circuitBreakerHits
  };
}

function evaluateInstitutionalScenario(trades: any[], baseRisk: number, dailyCapPct: number, peakToDrawPct: number) {
  let bal = 100.0;
  let peak = 100.0;
  let maxDailyLossSeen = 0;
  let maxPeakDdPct = 0;
  let startOfDayBal = 100.0;
  let currentEstDay = "";
  let dayHalted = false;
  let accountHalted = false;
  let daysCircuited = 0;
  let consecutiveCircuitedDays = 0;
  let tradesTaken = 0;

  for (const t of trades) {
    if (accountHalted) continue;

    const simEstDay = t.simEstDay;

    if (simEstDay !== currentEstDay) {
      currentEstDay = simEstDay;
      startOfDayBal = bal;
      if (dayHalted) {
        consecutiveCircuitedDays++;
      } else {
        consecutiveCircuitedDays = 0;
      }
      dayHalted = false;
    }

    if (dayHalted) continue;

    if (bal > peak) peak = bal;
    const currentPeakDd = (peak - bal) / peak;
    if (currentPeakDd > maxPeakDdPct) maxPeakDdPct = currentPeakDd;

    if (currentPeakDd >= peakToDrawPct) {
      accountHalted = true;
      continue;
    }

    // 🛡️ Live Production Proximity Scaling
    let institutionalMultiplier = 1.0;
    const rho = currentPeakDd / peakToDrawPct;
    if (rho >= 0.85) {
      institutionalMultiplier = 0.15;
    } else if (rho >= 0.70) {
      institutionalMultiplier = 0.30;
    } else if (rho >= 0.50) {
      institutionalMultiplier = 0.50;
    }

    // 🛡️ Post-Circuit Breaker Dampener
    let consecutiveDayClamp = 1.0;
    if (consecutiveCircuitedDays === 1) {
      consecutiveDayClamp = 0.50;
    } else if (consecutiveCircuitedDays >= 2) {
      consecutiveDayClamp = 0.25;
    }

    const effectiveRisk = baseRisk * (t.riskMultiplier || 1.0) * institutionalMultiplier * consecutiveDayClamp;
    const riskCapital = bal * effectiveRisk;
    const r = t.rMultiple || 0;
    bal += riskCapital * r;
    tradesTaken++;

    const dailyLoss = (startOfDayBal - bal) / startOfDayBal;
    if (dailyLoss > maxDailyLossSeen) maxDailyLossSeen = dailyLoss;

    if (dailyLoss >= dailyCapPct) {
      dayHalted = true;
      daysCircuited++;
    }
  }

  const netRetPct = ((bal - 100.0) / 100.0) * 100;
  return {
    baseRisk: (baseRisk * 100).toFixed(1) + "%",
    dailyCap: (dailyCapPct * 100).toFixed(1) + "%",
    trailingLimit: (peakToDrawPct * 100).toFixed(1) + "%",
    finalBalance: "$" + bal.toFixed(2),
    netReturn: (netRetPct >= 0 ? "+" : "") + netRetPct.toFixed(1) + "%",
    maxDailyDd: (maxDailyLossSeen * 100).toFixed(2) + "%",
    maxPeakDd: (maxPeakDdPct * 100).toFixed(2) + "%",
    circuitedDays: daysCircuited,
    status: accountHalted ? "🔴 BREACHED" : "🟢 SAFE"
  };
}

function runMaxRiskScanner(trades: any[]) {
  const fineRisks: number[] = [];
  for (let r = 0.01; r <= 0.605; r += 0.005) {
    fineRisks.push(parseFloat(r.toFixed(3)));
  }

  const accountConfigs = [
    { name: "Account A (Conservative)", dailyCap: 0.025, peakToDraw: 0.055 },
    { name: "Account B (Balanced / Moderate)", dailyCap: 0.030, peakToDraw: 0.095 },
    { name: "Account C (High Equity Prop)", dailyCap: 0.200, peakToDraw: 0.500 },
    { name: "Account D (Aggressive / High Risk)", dailyCap: 0.100, peakToDraw: 0.400 },
    { name: "Account E (Optimal Growth / 100% Unconstrained)", dailyCap: 1.000, peakToDraw: 1.000 },
  ];

  const maxRiskResults: any[] = [];

  for (const acc of accountConfigs) {
    let highestSafeRisk = 0;
    let bestResult: any = null;

    for (const r of fineRisks) {
      const res = evaluateInstitutionalScenario(trades, r, acc.dailyCap, acc.peakToDraw);
      if (res.status === "🟢 SAFE") {
        highestSafeRisk = r;
        bestResult = res;
      }
    }

    if (bestResult) {
      maxRiskResults.push({
        account: acc.name,
        dailyCap: (acc.dailyCap * 100).toFixed(1) + "%",
        trailingMaxDDLimit: (acc.peakToDraw * 100).toFixed(1) + "%",
        maxSafeRisk: (highestSafeRisk * 100).toFixed(1) + "%",
        finalBalance: bestResult.finalBalance,
        netReturn: bestResult.netReturn,
        actualPeakDD: bestResult.maxPeakDd,
        actualMaxDailyDD: bestResult.maxDailyDd,
        circuitedDays: bestResult.circuitedDays
      });
    }
  }

  return maxRiskResults;
}

function calculateMonthlyBreakdown(trades: any[]) {
  const monthlyBuckets: Record<string, any[]> = {};
  for (const t of trades) {
    const dStr = t.exitTime || t.entryTime || t.date || t.time || "";
    if (!dStr) continue;
    const mKey = dStr.substring(0, 7);
    if (!monthlyBuckets[mKey]) monthlyBuckets[mKey] = [];
    monthlyBuckets[mKey].push(t);
  }

  const sortedMonths = Object.keys(monthlyBuckets).sort();
  const rows: any[] = [];
  let cumWeightedR = 0;

  for (const mKey of sortedMonths) {
    const monthTrades = monthlyBuckets[mKey];
    let mRawR = 0;
    let mWeightedR = 0;
    let mWins = 0;
    let mLosses = 0;
    let mBe = 0;

    for (const t of monthTrades) {
      const r = t.rMultiple || 0;
      const wR = r * (t.riskMultiplier || 1.0);
      mRawR += r;
      mWeightedR += wR;
      if (r > 0.0001) mWins++;
      else if (r < -0.0001) mLosses++;
      else mBe++;
    }

    cumWeightedR += mWeightedR;
    const winPct = monthTrades.length > 0 ? (mWins / monthTrades.length) * 100 : 0;

    rows.push({
      month: mKey,
      trades: monthTrades.length,
      winPct: winPct.toFixed(1) + "%",
      rawNetR: (mRawR >= 0 ? "+" : "") + mRawR.toFixed(2) + "R",
      weightedNetR: (mWeightedR >= 0 ? "+" : "") + mWeightedR.toFixed(2) + "R",
      cumWeightedR: (cumWeightedR >= 0 ? "+" : "") + cumWeightedR.toFixed(2) + "R",
    });
  }

  return rows;
}

async function main() {
  console.log("====================================================================================================");
  console.log("  ⚖️  TIER 1 MATH SIMULATOR: NORMAL PAIRCONFIG RISK vs. FLAT 1.0% RISK");
  console.log("  Evaluating 1-Year Historical Portfolio across all Modules");
  console.log("====================================================================================================\n");

  const csvDir = path.join(process.cwd(), "data", "csv");
  let dynamicEnd = "2026-08-14";
  try {
    const csvFiles = fs.readdirSync(csvDir).filter((f) => f.endsWith(".csv"));
    if (csvFiles.length > 0) {
      const { getLatestDate } = await import("../backtester/loadCsv.js");
      const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
      dynamicEnd = latestDate.toISOString().substring(0, 10);
    }
  } catch {}

  const endDate = dynamicEnd;
  const sd = new Date(new Date(endDate).getTime());
  sd.setFullYear(sd.getFullYear() - 1);
  const startDate = sd.toISOString().substring(0, 10);

  console.log(`Loading Portfolio Trades: ${startDate} → ${endDate}...`);
  const rawTrades = await loadPortfolioTrades(startDate, endDate);
  console.log(`Loaded ${rawTrades.length} trades.\n`);

  // Clone 1: Normal (using exact PairConfig riskPct)
  const tradesNormal = rawTrades.map((t: any) => ({ ...t }));

  // Clone 2: Flat 1.0% (ignoring PairConfig riskPct, flat 0.01 for everything)
  const tradesFlat = rawTrades.map((t: any) => ({ ...t, riskMultiplier: 0.01 }));

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. MODULE 1: Continuous Dynamic Compounding (Mode A) Comparison
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("====================================================================================================");
  console.log(" 💰 MODULE 1: CONTINUOUS DYNAMIC COMPOUNDING (Mode A)");
  console.log("====================================================================================================\n");

  const spectrum = [0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30];

  const modeAComparison: any[] = [];
  for (const r of spectrum) {
    const norm = runSimulation(tradesNormal, r, 'CONTINUOUS');
    const flat = runSimulation(tradesFlat, r, 'CONTINUOUS');

    modeAComparison.push({
      baseRisk: (r * 100).toFixed(1) + "%",
      normBalance: norm.finalBalance,
      flatBalance: flat.finalBalance,
      normReturn: norm.returnPct,
      flatReturn: flat.returnPct,
      normPeakDD: norm.maxDrawdownPct,
      flatPeakDD: flat.maxDrawdownPct,
      normDailyDD: norm.maxDailyDrawdownPct,
      flatDailyDD: flat.maxDailyDrawdownPct,
      normCalmar: norm.calmarRatio,
      flatCalmar: flat.calmarRatio,
    });
  }

  console.table(modeAComparison);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. MODULE 4: Presets & Max Safe Risk Scanner Comparison
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n====================================================================================================");
  console.log(" 🎯 MODULE 4: MAX SAFE RISK SCANNER COMPARISON");
  console.log("====================================================================================================\n");

  const maxRiskNorm = runMaxRiskScanner(tradesNormal);
  const maxRiskFlat = runMaxRiskScanner(tradesFlat);

  const scannerComparison: any[] = [];
  for (let i = 0; i < maxRiskNorm.length; i++) {
    const n = maxRiskNorm[i];
    const f = maxRiskFlat[i];

    scannerComparison.push({
      account: n.account,
      limits: `Cap: ${n.dailyCap} / DD: ${n.trailingMaxDDLimit}`,
      normSafeRisk: n.maxSafeRisk,
      flatSafeRisk: f.maxSafeRisk,
      normReturn: n.netReturn,
      flatReturn: f.netReturn,
      normBalance: n.finalBalance,
      flatBalance: f.finalBalance,
      normPeakDD: n.actualPeakDD,
      flatPeakDD: f.actualPeakDD,
      circuitedDays: `Norm: ${n.circuitedDays} | Flat: ${f.circuitedDays}`,
    });
  }

  console.table(scannerComparison);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Preset Scenarios (Account A, Account B, Account C)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n====================================================================================================");
  console.log(" 🏛️ PRESET SCENARIOS COMPARISON (Fixed Multipliers)");
  console.log("====================================================================================================\n");

  const presets = [
    { name: "Account A (Conservative)", risk: 0.10, dailyCap: 0.025, peakToDraw: 0.055 },
    { name: "Account B (Balanced / Moderate)", risk: 0.20, dailyCap: 0.030, peakToDraw: 0.095 },
    { name: "Account C (Aggressive / High Risk)", risk: 0.30, dailyCap: 0.100, peakToDraw: 0.400 },
  ];

  const presetRows: any[] = [];
  for (const p of presets) {
    const norm = evaluateInstitutionalScenario(tradesNormal, p.risk, p.dailyCap, p.peakToDraw);
    const flat = evaluateInstitutionalScenario(tradesFlat, p.risk, p.dailyCap, p.peakToDraw);

    presetRows.push({
      preset: p.name,
      baseRisk: (p.risk * 100).toFixed(0) + "%",
      normReturn: norm.netReturn,
      flatReturn: flat.netReturn,
      normBalance: norm.finalBalance,
      flatBalance: flat.finalBalance,
      normPeakDD: norm.maxPeakDd,
      flatPeakDD: flat.maxPeakDd,
      normDailyDD: norm.maxDailyDd,
      flatDailyDD: flat.maxDailyDd,
      status: `Norm: ${norm.status} | Flat: ${flat.status}`,
    });
  }

  console.table(presetRows);

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Monthly Breakdown Comparison
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n====================================================================================================");
  console.log(" 📅 MODULE 2: MONTHLY BREAKDOWN (Weighted Net R: Normal vs. Flat 1%)");
  console.log("====================================================================================================\n");

  const mNorm = calculateMonthlyBreakdown(tradesNormal);
  const mFlat = calculateMonthlyBreakdown(tradesFlat);

  const monthlyCompRows: any[] = [];
  for (let i = 0; i < mNorm.length; i++) {
    const n = mNorm[i];
    const f = mFlat[i];
    monthlyCompRows.push({
      month: n.month,
      trades: n.trades,
      winPct: n.winPct,
      rawNetR: n.rawNetR,
      normWeightedR: n.weightedNetR,
      flatWeightedR: f.weightedNetR,
      normCumR: n.cumWeightedR,
      flatCumR: f.cumWeightedR,
    });
  }

  console.table(monthlyCompRows);

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Generate Markdown Report
  // ─────────────────────────────────────────────────────────────────────────────
  const outReportPath = path.join(process.cwd(), "server", "trading", "testing", "normal_vs_flat_risk_report.md");
  let md = `# ⚖️ Tier 1 Math Simulator: Normal PairConfig Risk vs. Flat 1.0% Risk\n\n`;
  md += `**Evaluation Period**: ${startDate} → ${endDate} (1 Year Historical)\n`;
  md += `**Total Trades**: ${rawTrades.length} across 21 Grandmaster Components\n\n`;

  md += `## 1. Executive Summary & Findings\n\n`;
  md += `* **Why Normal (PairConfig) Risk Exists**: In \`PairConfig.ts\`, the Grandmaster optimizer dynamically weights each setup based on its Kelly ratio, win rate, and historical drawdown (e.g., high-expectancy setups like \`GER40\` Sage NY or \`NAS100\` get higher allocation, while high-drawdown setups like \`XAUUSD\` or \`AUDJPY\` get smaller allocation).\n`;
  md += `* **What Flat 1.0% Risk Does**: Treats every single trade with identical 1.0% flat risk weight, ignoring individual setup volatility or historical expectancy.\n\n`;

  md += `## 2. Max Safe Risk Scanner Comparison (Module 4)\n\n`;
  md += `| Account Preset | Daily Cap / DD Limit | Normal Max Safe Risk | Flat 1% Max Safe Risk | Normal Return | Flat 1% Return | Normal Max Peak DD | Flat 1% Max Peak DD |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const s of scannerComparison) {
    md += `| **${s.account}** | \`${s.limits}\` | **${s.normSafeRisk}** | **${s.flatSafeRisk}** | **${s.normReturn}** (${s.normBalance}) | **${s.flatReturn}** (${s.flatBalance}) | ${s.normPeakDD} | ${s.flatPeakDD} |\n`;
  }

  md += `\n## 3. Continuous Dynamic Compounding (Mode A)\n\n`;
  md += `| Base Risk | Normal Return | Flat 1% Return | Normal Balance | Flat 1% Balance | Normal Max DD | Flat 1% Max DD | Normal Calmar | Flat 1% Calmar |\n`;
  md += `| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const m of modeAComparison) {
    md += `| **${m.baseRisk}** | **${m.normReturn}** | **${m.flatReturn}** | ${m.normBalance} | ${m.flatBalance} | ${m.normPeakDD} | ${m.flatPeakDD} | ${m.normCalmar} | ${m.flatCalmar} |\n`;
  }

  md += `\n## 4. Month-by-Month Performance Comparison\n\n`;
  md += `| Month | Trades | Win Rate | Raw Net R | Normal Weighted Net R | Flat 1% Weighted Net R | Normal Cum Weighted R | Flat 1% Cum Weighted R |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const m of monthlyCompRows) {
    md += `| **${m.month}** | ${m.trades} | ${m.winPct} | ${m.rawNetR} | **${m.normWeightedR}** | **${m.flatWeightedR}** | ${m.normCumR} | ${m.flatCumR} |\n`;
  }

  fs.writeFileSync(outReportPath, md, "utf-8");
  console.log(`\n>> Saved full markdown report to: ${outReportPath}\n`);
}

main().catch(console.error);
