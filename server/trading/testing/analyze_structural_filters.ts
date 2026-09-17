// ============================================================
// analyze_structural_filters.ts
//
// Deep structural analysis of losing trades using signals the
// optimizer has NEVER seen. Runs Tier-1 Math Backtest on every
// Mage + Sage + Seer config in grandmaster_portfolio.json and
// analyzes:
//
//   Signal A: H1 Swing Structure at Entry
//   Signal B: ADR % Consumed at Entry
//   Signal C: ATR Ratio Decile Distribution
//   Signal D: Breakout Candle WBR on breakout side
//   Signal E: Entry Latency (minutes since ORB end)
//   Signal F: Session Open Distance
//
// Usage:
//   npx tsx server/trading/testing/analyze_structural_filters.ts
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { runMathBacktest as runMageMathBacktest, clearMageBacktestCache } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest, clearSageBacktestCache } from "../backtester/SageMathBacktester.js";
import { runSeerMathBacktest, clearSeerBacktestCache } from "../backtester/SeerMathBacktester.js";
import { HTFContextTracker } from "../market/HTFContextTracker.js";
import { buildAtrArray } from "../market/Indicators.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { getFixedEstDate } from "../backtester/math_core/MathCoreUtils.js";

const START_DATE = "2025-09-01";
const END_DATE = "2026-08-31";
const PORTFOLIO_JSON = path.join(process.cwd(), "server", "trading", "optimizer", "grandmaster", "grandmaster_portfolio.json");
const OUTPUT_FILE = path.join(process.cwd(), "structural_filter_analysis.txt");

function parseSetupToConfig(setupStr: string, symbol: string, botType: string): any {
  const parts = setupStr.split("_");
  let session = parts[0];
  if (parts[0] === "NY") session = `NY_${parts[1]}`;
  const findNum = (prefix: string, isSuffix = false): number | undefined => {
    const p = isSuffix ? parts.find((item) => item.endsWith(prefix)) : parts.find((item) => item.startsWith(prefix));
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
  if (botType === "Sage") {
    return { session, orbEnabled: true, orbStartHour: findNum("StartH") ?? 0, orbStartMin: findNum("StartM") ?? 0, orbMinutes: findNum("OrbMins") ?? 15, actionMinutes: findNum("ActMins"), minSlDist: minSl, maxSlDist: maxSl, entryPenetrationPct: parsedPct, sweepPips: findNum("Sweep") ?? 0, maxSweepMultiplier: findNum("MaxSwp") ?? 3, requireCloseInside: findStr("ReqCls") === "true", exitMode: findStr("Exit") ?? "TRAILING", trailingSlTrigger: findNum("Trig") ?? 0, trailingSlStep: findNum("Step") ?? 0, forceCloseHours: findNum("FC") ?? 8, htfAlignmentRequired: true, maxH1EmaSlope: 20 };
  } else if (botType === "Seer") {
    return { session, minBodyPips: findNum("Body"), minSlDist: minSl, maxSlDist: maxSl, trailingSlTrigger: findNum("Trig") ?? 0, trailingSlStep: findNum("Step") ?? 0, forceCloseHours: findNum("FC") ?? 16, exitMode: findStr("Exit") ?? "TRAILING", pinBarWickBodyRatio: findNum("Wick") ?? 1.5 };
  } else {
    return { session, orbEnabled: true, orbStartHour: findNum("StartH") ?? 0, orbStartMin: findNum("StartM") ?? 0, orbMinutes: findNum("OrbMins") ?? 10, actionMinutes: findNum("ActMins") ?? 60, minSlDist: minSl, maxSlDist: maxSl, minBodyPips: findNum("Body") ?? 0, exitMode: findStr("Exit") ?? "TRAILING", trailingSlTrigger: findNum("Trig") ?? 0, trailingSlStep: findNum("Step") ?? 0, forceCloseHours: findNum("FC") ?? 24, htfAlignmentRequired: true, maxH1EmaSlope: 20 };
  }
}

function pct(num: number, den: number): string { return den === 0 ? " n/a" : `${((num / den) * 100).toFixed(1)}%`; }
function winPct(w: number, t: number): string { return t === 0 ? " n/a" : `${((w / t) * 100).toFixed(1)}%`; }
function avgR(trades: EnrichedTrade[]): string { if (!trades.length) return " n/a"; return `${(trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length).toFixed(3)}R`; }
function bar(w: number, t: number, width = 20): string { const f = t > 0 ? Math.round((w / t) * width) : 0; return `[${"█".repeat(f)}${"░".repeat(width - f)}]`; }

function buildDailyRangeMap(m5: any[], pip: number): Map<string, number> {
  const days: { high: number; low: number; date: string }[] = [];
  let dayH = -Infinity, dayL = Infinity, lastH = -1, curDate = "";
  for (const c of m5) {
    const dStr = getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0];
    const rollover = lastH !== -1 && ((lastH < 17 && c.estHour >= 17) || (lastH > c.estHour && c.estHour >= 17));
    if (rollover && curDate) { days.push({ high: dayH, low: dayL, date: curDate }); dayH = -Infinity; dayL = Infinity; }
    if (c.high > dayH) dayH = c.high;
    if (c.low < dayL) dayL = c.low;
    curDate = dStr; lastH = c.estHour;
  }
  const res = new Map<string, number>();
  for (let i = 0; i < days.length; i++) {
    const win = days.slice(Math.max(0, i - 19), i + 1);
    res.set(days[i].date, win.reduce((s, d) => s + (d.high - d.low) / pip, 0) / win.length);
  }
  return res;
}

function buildSessionOpenMap(m5: any[]): Map<string, number> {
  const res = new Map<string, number>();
  let lastH = -1;
  for (const c of m5) {
    const rollover = lastH !== -1 && ((lastH < 17 && c.estHour >= 17) || (lastH > c.estHour && c.estHour >= 17));
    if (rollover || (lastH === -1 && c.estHour >= 17)) {
      const dStr = getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0];
      if (!res.has(dStr)) res.set(dStr, c.open);
    }
    lastH = c.estHour;
  }
  return res;
}

interface EnrichedTrade {
  pair: string; bot: string; session: string; date: string; dayOfWeek: number;
  entryHourEST: number; entryMinEST: number; direction: "BUY" | "SELL"; outcome: string;
  rMultiple: number; riskPips: number; isWin: boolean;
  h1Structure: "BULLISH" | "BEARISH" | "NEUTRAL"; h1Aligned: boolean;
  adrConsumedPct: number; adrBucket: string;
  atrRatio: number; atrRatioBucket: string;
  breakoutWbr: number; wbrBucket: string;
  entryLatencyMins: number; latencyBucket: string;
  sessionOpenDistPct: number; sessionOpenBucket: string;
}

function adrB(p: number): string { if (p < 20) return "<20%"; if (p < 40) return "20-40%"; if (p < 60) return "40-60%"; if (p < 80) return "60-80%"; return ">80%"; }
const ADR_B = ["<20%", "20-40%", "40-60%", "60-80%", ">80%"];

function atrB(r: number): string { if (r < 0.5) return "<0.50"; if (r < 0.8) return "0.50-0.80"; if (r < 1.1) return "0.80-1.10"; if (r < 1.4) return "1.10-1.40"; return ">1.40"; }
const ATR_B = ["<0.50", "0.50-0.80", "0.80-1.10", "1.10-1.40", ">1.40"];

function wbrB(wbr: number): string { if (wbr < 0) return "N/A"; if (wbr < 0.3) return "0-0.30"; if (wbr < 0.7) return "0.30-0.70"; if (wbr < 1.2) return "0.70-1.20"; return ">1.20"; }
const WBR_B = ["0-0.30", "0.30-0.70", "0.70-1.20", ">1.20", "N/A"];

function latB(m: number): string { if (m < 0) return "N/A"; if (m <= 15) return "0-15m"; if (m <= 30) return "15-30m"; if (m <= 60) return "30-60m"; if (m <= 90) return "60-90m"; return ">90m"; }
const LAT_B = ["0-15m", "15-30m", "30-60m", "60-90m", ">90m", "N/A"];

function sOB(p: number): string { if (p < 15) return "<15%"; if (p < 30) return "15-30%"; if (p < 50) return "30-50%"; if (p < 75) return "50-75%"; return ">75%"; }
const SOB_B = ["<15%", "15-30%", "30-50%", "50-75%", ">75%"];

function printBuckets(log: Function, label: string, buckets: string[], trades: EnrichedTrade[], keyFn: (t: EnrichedTrade) => string) {
  log(`\n  ${label}`);
  log("  " + "-".repeat(90));
  log("  " + "BUCKET".padEnd(16) + "TRADES".padStart(8) + "WINS".padStart(7) + "LOSSES".padStart(8) + "WIN%".padStart(8) + "AVG_R".padStart(9) + "  VISUAL");
  log("  " + "-".repeat(90));
  for (const b of buckets) {
    const inB = trades.filter((t) => keyFn(t) === b);
    if (!inB.length) continue;
    const w = inB.filter((t) => t.isWin);
    const avgRv = inB.reduce((s, t) => s + t.rMultiple, 0) / inB.length;
    log("  " + b.padEnd(16) + `${inB.length}`.padStart(8) + `${w.length}`.padStart(7) + `${inB.length - w.length}`.padStart(8) + winPct(w.length, inB.length).padStart(8) + `${avgRv.toFixed(3)}R`.padStart(9) + "  " + bar(w.length, inB.length));
  }
}

function printCross(log: Function, lA: string, lB: string, bA: string[], bB: string[], trades: EnrichedTrade[], kA: (t: EnrichedTrade) => string, kB: (t: EnrichedTrade) => string, minT = 5) {
  log(`\n  ${lA} x ${lB} (Win% per cell, min ${minT} trades)`);
  log("  " + "-".repeat(14 + bB.length * 12));
  log("  " + lA.substring(0, 12).padEnd(14) + bB.map((b) => b.padStart(12)).join(""));
  log("  " + "-".repeat(14 + bB.length * 12));
  for (const a of bA) {
    const tA = trades.filter((t) => kA(t) === a);
    if (!tA.length) continue;
    let row = "  " + a.padEnd(14);
    for (const b of bB) {
      const cell = tA.filter((t) => kB(t) === b);
      row += cell.length < minT ? "      --".padStart(12) : `${((cell.filter(t=>t.isWin).length/cell.length)*100).toFixed(0)}%(${cell.length})`.padStart(12);
    }
    log(row);
  }
}

async function main() {
  const lines: string[] = [];
  const log = (...args: any[]) => { const txt = args.map(String).join(" "); console.log(txt); lines.push(txt); };

  log("=".repeat(100));
  log("  STRUCTURAL FILTER ANALYSIS -- NEVER-BEFORE-TESTED ENTRY SIGNALS");
  log(`  Date range: ${START_DATE} --> ${END_DATE}  |  Portfolio: grandmaster_portfolio.json`);
  log("=".repeat(100));

  if (!fs.existsSync(PORTFOLIO_JSON)) { log(`[ERROR] Not found: ${PORTFOLIO_JSON}`); process.exit(1); }
  const portfolio: any[] = JSON.parse(fs.readFileSync(PORTFOLIO_JSON, "utf-8"));
  log(`\nPortfolio: ${portfolio.length} configs`);

  const seen = new Set<string>();
  const uniq = portfolio.filter((c) => { const k = `${c.symbol}::${c.botType}::${c.setup}`; if (seen.has(k)) return false; seen.add(k); return true; });
  log(`After dedup: ${uniq.length} unique configs\n`);

  const all: EnrichedTrade[] = [];

  for (const comp of uniq) {
    const isSage = comp.botType === "Sage";
    const isSeer = comp.botType === "Seer";
    const cfg = parseSetupToConfig(comp.setup, comp.symbol, comp.botType);
    cfg.signature = comp.setup;
    log(`  [${comp.botType.toUpperCase()}] ${comp.symbol} | ${comp.setup.substring(0, 65)}`);

    let records: any[] = [], m5: any[] = [];
    try {
      if (isSage) { const r = await runSageMathBacktest(comp.symbol, START_DATE, END_DATE, false, {}, [cfg], false); records = (r.records||[]).filter((x:any)=>x.outcome!=="SKIPPED"&&x.outcome!=="NO_TRADE"&&x.rMultiple!==undefined); m5=(r as any).m5Candles||[]; clearSageBacktestCache(comp.symbol); }
      else if (isSeer) { const r = await runSeerMathBacktest(comp.symbol, START_DATE, END_DATE, false, {}, [cfg], false); records=(r.records||[]).filter((x:any)=>x.outcome!=="SKIPPED"&&x.outcome!=="NO_TRADE"&&x.rMultiple!==undefined); m5=(r as any).m5Candles||[]; clearSeerBacktestCache(comp.symbol); }
      else { const r = await runMageMathBacktest(comp.symbol, START_DATE, END_DATE, false, undefined, undefined, null, [cfg], false); records=(r.records||[]).filter((x:any)=>x.outcome!=="SKIPPED"&&x.outcome!=="NO_TRADE"&&x.rMultiple!==undefined); m5=(r as any).m5Candles||[]; clearMageBacktestCache(comp.symbol); }
    } catch (e:any) { log(`    [ERROR] ${e.message}`); continue; }

    if (!records.length) { log(`    No trades`); continue; }
    log(`    ${records.length} trades`);
    if (!m5.length) { log(`    [WARN] No m5Candles`); continue; }

    const optKey = comp.symbol.replace(/\.daily$/i,"").split("_")[0].toUpperCase();
    const optCfg = OPTIMIZER_CONFIG[optKey] || OPTIMIZER_CONFIG[comp.symbol] || OPTIMIZER_CONFIG[comp.symbol.replace(/\.daily$/i,"")];
    const pip = optCfg?.pipSize ?? 0.0001;

    const htfData = HTFContextTracker.precomputeHTFData(m5);
    const atrArr = buildAtrArray(m5, 14);
    const drMap = buildDailyRangeMap(m5, pip);
    const soMap = buildSessionOpenMap(m5);
    const tsIdx = new Map<number, number>();
    for (let i = 0; i < m5.length; i++) tsIdx.set(m5[i].timestamp, i);

    for (const r of records) {
      const rm = r.rMultiple ?? 0;
      const ts = r.timestamp ?? r.openTime ?? r.entryTimeMs ?? 0;
      const estE = getFixedEstDate(new Date(ts));
      const dow = estE.getUTCDay(), eH = estE.getUTCHours(), eM = estE.getUTCMinutes();
      const dStr = estE.toISOString().split("T")[0];
      let dir: "BUY"|"SELL" = "BUY";
      if (r.direction) dir = r.direction;
      else if (r.entry!=null&&r.stopLoss!=null) dir = r.entry > r.stopLoss ? "BUY" : "SELL";

      let m5i = tsIdx.get(ts);
      if (m5i === undefined) { let lo=0,hi=m5.length-1; while(lo<hi){const mid=(lo+hi)>>1; if(m5[mid].timestamp<ts)lo=mid+1; else hi=mid;} m5i=lo; }

      const h1S = HTFContextTracker.getH1SwingStructure(htfData, m5i);
      const h1A = (dir==="BUY"&&h1S==="BULLISH")||(dir==="SELL"&&h1S==="BEARISH")||h1S==="NEUTRAL";

      const avgDR = drMap.get(dStr) ?? 0;
      const sesO = soMap.get(dStr) ?? 0;
      const ep = r.entry ?? m5[m5i]?.close ?? 0;
      const adrPct = (avgDR>0&&ep>0&&sesO>0) ? (Math.abs(ep-sesO)/pip/avgDR*100) : 0;

      const atrV = m5i>0 ? (atrArr[m5i-1]??0) : 0;
      const atrPips = atrV / pip;
      const orH = r.orHigh??0, orL = r.orLow??0;
      const orPips = (orH-orL)/pip;
      const atrRatio = (atrPips>0&&orPips>0) ? orPips/atrPips : -1;

      let wbr = -1;
      if (!isSeer && m5[m5i]) {
        const ac = m5[m5i];
        const body = Math.abs(ac.close-ac.open);
        const bTop = Math.max(ac.open,ac.close), bBot = Math.min(ac.open,ac.close);
        const bPips = body/pip;
        if (bPips > 0.01) { const bkWick = dir==="BUY" ? (ac.high-bTop)/pip : (bBot-ac.low)/pip; wbr = Math.max(0,bkWick)/bPips; }
      }

      let latency = -1;
      if (!isSeer && cfg.orbStartHour!==undefined && cfg.orbMinutes!==undefined) {
        const orbEnd = cfg.orbStartHour*60+(cfg.orbStartMin??0)+cfg.orbMinutes;
        let lat = eH*60+eM - orbEnd;
        if (lat < -120) lat += 24*60;
        if (lat >= 0 && lat <= 300) latency = lat;
      }

      all.push({
        pair: comp.symbol, bot: comp.botType, session: cfg.session??"?", date: dStr, dayOfWeek: dow,
        entryHourEST: eH, entryMinEST: eM, direction: dir, outcome: r.outcome??"SL",
        rMultiple: rm, riskPips: r.riskPips??0, isWin: rm>0,
        h1Structure: h1S, h1Aligned: h1A,
        adrConsumedPct: adrPct, adrBucket: adrB(adrPct),
        atrRatio, atrRatioBucket: atrRatio>=0 ? atrB(atrRatio) : "N/A",
        breakoutWbr: wbr, wbrBucket: wbrB(wbr),
        entryLatencyMins: latency, latencyBucket: latB(latency),
        sessionOpenDistPct: adrPct, sessionOpenBucket: sOB(adrPct),
      });
    }
  }

  // ── REPORT ──────────────────────────────────────────────────────────────
  const W = all.filter(t=>t.isWin), L = all.filter(t=>!t.isWin);
  const netR = all.reduce((s,t)=>s+t.rMultiple,0);
  const winR = W.reduce((s,t)=>s+t.rMultiple,0), lossR = L.reduce((s,t)=>s+t.rMultiple,0);

  log("\n\n"+"=".repeat(100));
  log("  SECTION 1 -- PORTFOLIO OVERVIEW");
  log("=".repeat(100));
  log(`  Total Trades : ${all.length}  |  Wins: ${W.length} (${pct(W.length,all.length)})  |  Losses: ${L.length} (${pct(L.length,all.length)})`);
  log(`  Net R: ${netR.toFixed(2)}R  |  Win R: +${winR.toFixed(2)}R  |  Loss R: ${lossR.toFixed(2)}R`);
  log(`  Avg Win: ${W.length>0?(winR/W.length).toFixed(3):"-"}R  |  Avg Loss: ${L.length>0?(lossR/L.length).toFixed(3):"-"}R`);
  log("\n  Per-Bot:");
  for (const bot of ["Mage","Sage","Seer"]) {
    const bt = all.filter(t=>t.bot===bot); const bw = bt.filter(t=>t.isWin);
    log(`    ${bot.padEnd(6)}: ${bt.length} trades | WR=${pct(bw.length,bt.length)} | NetR=${bt.reduce((s,t)=>s+t.rMultiple,0).toFixed(2)}R | W=${bw.length} L=${bt.length-bw.length}`);
  }

  // Section 2: H1 Structure
  log("\n\n"+"=".repeat(100));
  log("  SECTION 2 -- SIGNAL A: H1 SWING STRUCTURE AT ENTRY");
  log("  (HH+HL = BULLISH, LH+LL = BEARISH, unconfirmed = NEUTRAL)");
  log("=".repeat(100));
  const groups = [
    {label:"Aligned (with H1)", t:all.filter(t=>t.h1Aligned&&t.h1Structure!=="NEUTRAL")},
    {label:"Counter-Structure",  t:all.filter(t=>!t.h1Aligned)},
    {label:"H1 Neutral",         t:all.filter(t=>t.h1Structure==="NEUTRAL")},
  ];
  log("\n  "+"GROUP".padEnd(22)+"TRADES".padStart(8)+"WINS".padStart(7)+"LOSSES".padStart(8)+"WIN%".padStart(8)+"AVG_R".padStart(9)+"  VISUAL");
  log("  "+"-".repeat(80));
  for (const g of groups) {
    const gw = g.t.filter(t=>t.isWin);
    const av = g.t.length ? g.t.reduce((s,t)=>s+t.rMultiple,0)/g.t.length : 0;
    log("  "+g.label.padEnd(22)+`${g.t.length}`.padStart(8)+`${gw.length}`.padStart(7)+`${g.t.length-gw.length}`.padStart(8)+winPct(gw.length,g.t.length).padStart(8)+`${av.toFixed(3)}R`.padStart(9)+"  "+bar(gw.length,g.t.length));
  }
  log("\n  Per-Bot H1 Alignment:");
  for (const bot of ["Mage","Sage","Seer"]) {
    const al = all.filter(t=>t.bot===bot&&t.h1Aligned&&t.h1Structure!=="NEUTRAL");
    const co = all.filter(t=>t.bot===bot&&!t.h1Aligned);
    const ne = all.filter(t=>t.bot===bot&&t.h1Structure==="NEUTRAL");
    log(`    ${bot} Aligned : ${al.length} | WR=${winPct(al.filter(t=>t.isWin).length,al.length)} | AvgR=${avgR(al)}`);
    log(`    ${bot} Counter : ${co.length} | WR=${winPct(co.filter(t=>t.isWin).length,co.length)} | AvgR=${avgR(co)}`);
    log(`    ${bot} Neutral : ${ne.length} | WR=${winPct(ne.filter(t=>t.isWin).length,ne.length)} | AvgR=${avgR(ne)}`);
    log("");
  }

  // Section 3: ADR
  log("\n\n"+"=".repeat(100));
  log("  SECTION 3 -- SIGNAL B: ADR % CONSUMED AT ENTRY");
  log("  abs(entryPrice - sessionOpen[17:00 EST]) / rolling20DayAvgRange * 100");
  log("=".repeat(100));
  printBuckets(log, "All Bots -- ADR % Consumed", ADR_B, all, t=>t.adrBucket);
  for (const bot of ["Mage","Sage","Seer"]) { const bt=all.filter(t=>t.bot===bot); if(bt.length) printBuckets(log,`${bot} -- ADR % Consumed`,ADR_B,bt,t=>t.adrBucket); }
  log("\n  KEY (WR < 35%, >= 10 trades):");
  let found=false;
  for (const b of ADR_B) { const inB=all.filter(t=>t.adrBucket===b); if(inB.length<10) continue; const wr=inB.filter(t=>t.isWin).length/inB.length; const nr=inB.reduce((s,t)=>s+t.rMultiple,0); if(wr<0.35){log(`    *** "${b}": WR=${(wr*100).toFixed(1)}%, NetR=${nr.toFixed(1)}, ${inB.length} trades`);found=true;} }
  if(!found) log("    None (all buckets >= 35%).");

  // Section 4: ATR Ratio
  log("\n\n"+"=".repeat(100));
  log("  SECTION 4 -- SIGNAL C: ATR RATIO (orPips / m5ATR14)");
  log("=".repeat(100));
  const ms = all.filter(t=>(t.bot==="Mage"||t.bot==="Sage")&&t.atrRatioBucket!=="N/A");
  printBuckets(log, "Mage+Sage -- ATR Ratio", ATR_B, ms, t=>t.atrRatioBucket);
  for (const bot of ["Mage","Sage"]) { const bt=ms.filter(t=>t.bot===bot); if(bt.length) printBuckets(log,`${bot} -- ATR Ratio`,ATR_B,bt,t=>t.atrRatioBucket); }
  log("\n  KEY (WR < 35%):");
  found=false;
  for (const b of ATR_B) { const inB=ms.filter(t=>t.atrRatioBucket===b); if(inB.length<10) continue; const wr=inB.filter(t=>t.isWin).length/inB.length; const nr=inB.reduce((s,t)=>s+t.rMultiple,0); if(wr<0.35){log(`    *** "${b}": WR=${(wr*100).toFixed(1)}%, NetR=${nr.toFixed(1)}, ${inB.length} trades`);found=true;} }
  if(!found) log("    None.");

  // Section 5: Breakout WBR
  log("\n\n"+"=".repeat(100));
  log("  SECTION 5 -- SIGNAL D: BREAKOUT CANDLE WICK-BODY RATIO (Mage + Sage)");
  log("  breakout-side-wick-pips / body-pips on the trigger candle");
  log("=".repeat(100));
  const mswbr = all.filter(t=>(t.bot==="Mage"||t.bot==="Sage")&&t.breakoutWbr>=0);
  printBuckets(log, "Mage+Sage -- Breakout WBR", WBR_B.filter(b=>b!=="N/A"), mswbr, t=>t.wbrBucket);
  for (const bot of ["Mage","Sage"]) { const bt=mswbr.filter(t=>t.bot===bot); if(bt.length) printBuckets(log,`${bot} -- Breakout WBR`,WBR_B.filter(b=>b!=="N/A"),bt,t=>t.wbrBucket); }
  log("\n  KEY:");
  found=false;
  for (const b of WBR_B) { if(b==="N/A") continue; const inB=mswbr.filter(t=>t.wbrBucket===b); if(inB.length<10) continue; const wr=inB.filter(t=>t.isWin).length/inB.length; const nr=inB.reduce((s,t)=>s+t.rMultiple,0); if(wr<0.35){log(`    *** "${b}": WR=${(wr*100).toFixed(1)}%, NetR=${nr.toFixed(1)}, ${inB.length} trades`);found=true;} }
  if(!found) log("    None.");

  // Section 6: Entry Latency
  log("\n\n"+"=".repeat(100));
  log("  SECTION 6 -- SIGNAL E: ENTRY LATENCY (Mage + Sage) -- mins from ORB close to entry");
  log("=".repeat(100));
  const mslat = all.filter(t=>(t.bot==="Mage"||t.bot==="Sage")&&t.entryLatencyMins>=0);
  printBuckets(log, "Mage+Sage -- Entry Latency", LAT_B.filter(b=>b!=="N/A"), mslat, t=>t.latencyBucket);
  for (const bot of ["Mage","Sage"]) { const bt=mslat.filter(t=>t.bot===bot); if(bt.length) printBuckets(log,`${bot} -- Entry Latency`,LAT_B.filter(b=>b!=="N/A"),bt,t=>t.latencyBucket); }
  log("\n  KEY:");
  found=false;
  for (const b of LAT_B) { if(b==="N/A") continue; const inB=mslat.filter(t=>t.latencyBucket===b); if(inB.length<10) continue; const wr=inB.filter(t=>t.isWin).length/inB.length; const nr=inB.reduce((s,t)=>s+t.rMultiple,0); if(wr<0.35){log(`    *** "${b}": WR=${(wr*100).toFixed(1)}%, NetR=${nr.toFixed(1)}, ${inB.length} trades`);found=true;} }
  if(!found) log("    None.");

  // Section 7: Session Open Distance
  log("\n\n"+"=".repeat(100));
  log("  SECTION 7 -- SIGNAL F: SESSION OPEN DISTANCE (how far from 17:00 EST open)");
  log("=".repeat(100));
  printBuckets(log, "All Bots -- Session Open Distance", SOB_B, all, t=>t.sessionOpenBucket);
  const seer = all.filter(t=>t.bot==="Seer");
  if(seer.length) printBuckets(log, "Seer -- Session Open Distance", SOB_B, seer, t=>t.sessionOpenBucket);

  // Section 8: Cross-Tabs
  log("\n\n"+"=".repeat(100));
  log("  SECTION 8 -- CROSS-TABS: Multi-Signal Combinations");
  log("=".repeat(100));
  printCross(log,"H1 Align","ADR Bucket",["Aligned","Counter"],ADR_B,all,t=>t.h1Aligned?"Aligned":"Counter",t=>t.adrBucket);
  printCross(log,"H1 Struct","ADR Bucket",["BULLISH","BEARISH","NEUTRAL"],ADR_B,all,t=>t.h1Structure,t=>t.adrBucket);
  if(mswbr.length>20) printCross(log,"WBR Bucket","ADR Bucket",WBR_B.filter(b=>b!=="N/A"),ADR_B,mswbr,t=>t.wbrBucket,t=>t.adrBucket);
  if(mslat.length>20) {
    printCross(log,"Latency","ADR Bucket",LAT_B.filter(b=>b!=="N/A"),ADR_B,mslat,t=>t.latencyBucket,t=>t.adrBucket);
    printCross(log,"H1 Align","Latency",["Aligned","Counter"],LAT_B.filter(b=>b!=="N/A"),mslat,t=>t.h1Aligned?"Aligned":"Counter",t=>t.latencyBucket);
  }

  // Section 9: Worst 20 losses
  log("\n\n"+"=".repeat(100));
  log("  SECTION 9 -- TOP 20 WORST LOSSES (with structural context)");
  log("=".repeat(100));
  const worst20 = [...L].sort((a,b)=>a.rMultiple-b.rMultiple).slice(0,20);
  log("\n  "+"DATE".padEnd(12)+"BOT".padEnd(7)+"PAIR".padEnd(14)+"DIR".padEnd(5)+"R".padStart(7)+"H1STR".padStart(8)+"ALN".padStart(5)+"ADR%".padStart(7)+"WBR".padStart(7)+"LAT".padStart(8));
  log("  "+"-".repeat(88));
  for (const t of worst20) {
    log("  "+t.date.padEnd(12)+t.bot.padEnd(7)+t.pair.padEnd(14)+t.direction.padEnd(5)+`${t.rMultiple.toFixed(2)}R`.padStart(7)+t.h1Structure.substring(0,4).padStart(8)+(t.h1Aligned?"  Y":"  N").padStart(5)+`${t.adrConsumedPct.toFixed(0)}%`.padStart(7)+(t.breakoutWbr>=0?t.breakoutWbr.toFixed(2):" N/A").padStart(7)+(t.entryLatencyMins>=0?`${Math.round(t.entryLatencyMins)}m`:" N/A").padStart(8));
  }

  // Section 10: Recommendations
  log("\n\n"+"=".repeat(100));
  log("  SECTION 10 -- FILTER RECOMMENDATIONS (WR < 35%, >= 10 trades, NetR < -3)");
  log("=".repeat(100));
  const recs: string[] = [];

  const counterAll = all.filter(t=>!t.h1Aligned);
  const alignedAll = all.filter(t=>t.h1Aligned&&t.h1Structure!=="NEUTRAL");
  const cWR = counterAll.length ? counterAll.filter(t=>t.isWin).length/counterAll.length : 0.5;
  const aWR = alignedAll.length ? alignedAll.filter(t=>t.isWin).length/alignedAll.length : 0.5;
  const cNR = counterAll.reduce((s,t)=>s+t.rMultiple,0);
  if(counterAll.length>=15 && cWR<aWR-0.04) recs.push(`  A. H1 SWING STRUCTURE: Counter trades WR=${(cWR*100).toFixed(1)}% vs Aligned ${(aWR*100).toFixed(1)}%, ${counterAll.length} trades, NetR=${cNR.toFixed(1)}R\n     Filter: vetoCounterH1Structure: true — blocks ${counterAll.filter(t=>!t.isWin).length} losers / loses ${counterAll.filter(t=>t.isWin).length} winners`);

  for (const b of ADR_B) { const inB=all.filter(t=>t.adrBucket===b); if(inB.length<10) continue; const wr=inB.filter(t=>t.isWin).length/inB.length; const nr=inB.reduce((s,t)=>s+t.rMultiple,0); if(wr<0.35&&nr<-3){recs.push(`  B. ADR CONSUMED "${b}": WR=${(wr*100).toFixed(1)}%, NetR=${nr.toFixed(1)}, ${inB.length} trades\n     Filter: adrConsumedMaxPct cap in MathFilters.ts — blocks ${inB.filter(t=>!t.isWin).length} losers / loses ${inB.filter(t=>t.isWin).length} winners`);break;} }

  for (const b of WBR_B) { if(b==="N/A") continue; const inB=mswbr.filter(t=>t.wbrBucket===b); if(inB.length<10) continue; const wr=inB.filter(t=>t.isWin).length/inB.length; const nr=inB.reduce((s,t)=>s+t.rMultiple,0); if(wr<0.35&&nr<-3){recs.push(`  C. BREAKOUT WBR "${b}": WR=${(wr*100).toFixed(1)}%, NetR=${nr.toFixed(1)}, ${inB.length} trades\n     Filter: tighten maxWbr param in MageMathCore/SageMathCore`);break;} }

  for (const b of LAT_B) { if(b==="N/A") continue; const inB=mslat.filter(t=>t.latencyBucket===b); if(inB.length<10) continue; const wr=inB.filter(t=>t.isWin).length/inB.length; const nr=inB.reduce((s,t)=>s+t.rMultiple,0); if(wr<0.35&&nr<-3){recs.push(`  D. ENTRY LATENCY "${b}": WR=${(wr*100).toFixed(1)}%, NetR=${nr.toFixed(1)}, ${inB.length} trades\n     Filter: reduce actionMinutes for affected configs`);break;} }

  if(!recs.length) { log("\n  No individual signal cleared threshold. See cross-tabs for combinations.\n"); }
  else { log(""); for(const r of recs){log(r);log("");} }

  log("=".repeat(100));
  log(`  Report saved: ${OUTPUT_FILE}`);
  log("=".repeat(100));

  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf-8");
  console.log(`\n>>> Written to: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
