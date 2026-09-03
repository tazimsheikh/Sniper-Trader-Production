// Toxic filter thresholds — tuned to avoid over-filtering profitable hours
// Criteria: a session-hour/day must be BOTH persistently losing (≥65% of months)
// AND materially negative in total R (< -2R for hours, < -3R for days).
// This prevents marginal-negative hours that still contribute to compounding from being blocked.
const HOUR_MIN_NET_R    = -2.0;  // hour total net R must be worse than this
const DAY_MIN_NET_R     = -3.0;  // day total net R must be worse than this
const LOSING_RATIO_MIN  = 0.65;  // ≥65% of active months must be losing
const ACTIVE_MONTHS_MIN = 3;     // minimum months with any activity

import * as fs from "fs";
import * as path from "path";
import { PairConfigManager, SAGE_PAIR_CONFIG, MAGE_PAIR_CONFIG } from "../../config/PairConfig.js";
import { runSageMathBacktest, clearSageBacktestCache } from "../../backtester/SageMathBacktester.js";
import { runMathBacktest as runMageMathBacktest, clearMageBacktestCache } from "../../backtester/MageMathBacktester.js";
import { getFixedEstDate } from "../../engine/LiveOrchestrator.js";

function safeWriteFileSync(filePath: string, content: string) {
  try {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, "utf-8");
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    fs.renameSync(tmpPath, filePath);
  } catch (_) { fs.writeFileSync(filePath, content, { flag: "w" }); }
}

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

interface MonthStat { trades: number; totalR: number; }
function freshHourlyStats(): Record<number,Record<number,MonthStat>> {
  const s: Record<number,Record<number,MonthStat>> = {};
  for (let h=0;h<24;h++){s[h]={};for(let m=1;m<=12;m++)s[h][m]={trades:0,totalR:0};}
  return s;
}
function freshDailyStats(): Record<number,Record<number,MonthStat>> {
  const s: Record<number,Record<number,MonthStat>> = {};
  for (let d=0;d<7;d++){s[d]={};for(let m=1;m<=12;m++)s[d][m]={trades:0,totalR:0};}
  return s;
}
function accumulateRecord(record:any, h:ReturnType<typeof freshHourlyStats>, d:ReturnType<typeof freshDailyStats>) {
  if (!record||record.outcome==="SKIPPED") return;
  const r=record.rMultiple??0;
  const est=getFixedEstDate(new Date(record.timestamp));
  const hour=est.getUTCHours(), calMonth=est.getUTCMonth()+1, dow=est.getUTCDay();
  h[hour][calMonth].trades++;h[hour][calMonth].totalR+=r;
  d[dow][calMonth].trades++;d[dow][calMonth].totalR+=r;
}
function detectToxicHours(h:ReturnType<typeof freshHourlyStats>): number[] {
  const b:number[]=[];
  for(let hr=0;hr<24;hr++){
    let aM=0,lM=0,tR=0;
    for(let m=1;m<=12;m++){const s=h[hr][m];if(s.trades>0){aM++;tR+=s.totalR;if(s.totalR<0)lM++;}}
    if(tR<HOUR_MIN_NET_R&&aM>=ACTIVE_MONTHS_MIN&&lM/aM>=LOSING_RATIO_MIN){b.push(hr);console.log(`   🚫 Toxic Hour ${String(hr).padStart(2,"0")}:xx EST | NetR:${tR.toFixed(2)} | ${lM}/${aM} months (${((lM/aM)*100).toFixed(0)}%)`);}
  }
  return b;
}
function detectToxicDays(d:ReturnType<typeof freshDailyStats>): number[] {
  const b:number[]=[];
  for(let dw=0;dw<7;dw++){
    let aM=0,lM=0,tR=0;
    for(let m=1;m<=12;m++){const s=d[dw][m];if(s.trades>0){aM++;tR+=s.totalR;if(s.totalR<0)lM++;}}
    if(tR<DAY_MIN_NET_R&&aM>=ACTIVE_MONTHS_MIN&&lM/aM>=LOSING_RATIO_MIN){b.push(dw);console.log(`   🚫 Toxic Day [${DAY_NAMES[dw]}] | NetR:${tR.toFixed(2)} | ${lM}/${aM} months (${((lM/aM)*100).toFixed(0)}%)`);}
  }
  return b;
}

// ─── Block-scoped config updater ─────────────────────────────────────────────
// blockAnchor: "MAGE_PAIR_CONFIG" or "SAGE_PAIR_CONFIG" — narrows search to
// the correct export block so same pair key in different exports doesn't collide.
function updateConfigByPairIndex(
  content: string, pair: string, index: number,
  bannedHours: number[], bannedDays: number[],
  blockAnchor: string
): string {
  // Find the export block anchor first
  const anchorIdx = content.indexOf(`export const ${blockAnchor}`);
  if (anchorIdx === -1) {
    console.warn(`  ⚠️  Block anchor "${blockAnchor}" not found — skipping`);
    return content;
  }

  // Find the pair key within that block (search forward from anchor)
  const searchArea = content.substring(anchorIdx);
  const pairPattern = new RegExp(`(['"]${pair}['"]\\s*:\\s*\\[)`);
  const pairMatch = pairPattern.exec(searchArea);
  if (!pairMatch) {
    // Pair doesn't exist in this bot's config — nothing to update (normal for Sage-only pairs)
    return content;
  }

  // Absolute position within content
  const arrayStart = anchorIdx + pairMatch.index + pairMatch[0].length;

  // Walk from arrayStart to find the N-th top-level { block
  let pos = arrayStart;
  let configCount = 0;
  let blockStart = -1, blockEnd = -1;

  while (pos < content.length) {
    const ch = content[pos];
    if (ch === "]" && blockStart === -1) {
      console.warn(`  ⚠️  Index ${index} out of range for pair "${pair}" in ${blockAnchor}`);
      return content;
    }
    if (ch === "{") {
      if (configCount === index) {
        blockStart = pos;
        let depth = 0;
        for (let i = pos; i < content.length; i++) {
          if (content[i] === "{") depth++;
          if (content[i] === "}") { depth--; if (depth===0){blockEnd=i;break;} }
        }
        break;
      }
      // Skip this block
      let depth = 0;
      for (; pos < content.length; pos++) {
        if (content[pos] === "{") depth++;
        if (content[pos] === "}") { depth--; if (depth===0){configCount++;break;} }
      }
    }
    pos++;
  }

  if (blockStart===-1||blockEnd===-1) {
    console.warn(`  ⚠️  Block [${index}] not found for "${pair}" in ${blockAnchor}`);
    return content;
  }

  let block = content.substring(blockStart, blockEnd+1);
  block = block.replace(/"toxicHours":\s*\[[\d,\s]*\](,?\n?\s*)?/g, "");
  block = block.replace(/"toxicDays":\s*\[[\d,\s]*\](,?\n?\s*)?/g, "");
  let inj = "";
  if (bannedHours.length > 0) inj += `"toxicHours": [${bannedHours.join(", ")}],\n      `;
  if (bannedDays.length > 0)  inj += `"toxicDays": [${bannedDays.join(", ")}],\n      `;
  if (inj) block = block.replace(/"session":/, `${inj}"session":`);

  return content.substring(0, blockStart) + block + content.substring(blockEnd+1);
}

async function runDynamicToxicFilterInjection() {
  console.log(`\n☠️  [Toxic Injector v3] Per-Session | Block-Scoped | Pair+Index Targeted`);
  console.log(`   Criteria: Hour NetR<${HOUR_MIN_NET_R}R, Day NetR<${DAY_MIN_NET_R}R, losingRatio>=${(LOSING_RATIO_MIN*100).toFixed(0)}%, activeMonths>=${ACTIVE_MONTHS_MIN}\n`);

  const allPairs = Array.from(new Set([
    ...Object.keys(SAGE_PAIR_CONFIG),
    ...Object.keys(MAGE_PAIR_CONFIG),
  ]));

  const bans: Array<{pair:string;bot:"MAGE"|"SAGE";index:number;bannedHours:number[];bannedDays:number[]}> = [];

  for (const pair of allPairs) {
    const now = new Date();
    let endDate = now.toISOString().substring(0,10);
    const sd = new Date(now.getTime()); sd.setFullYear(sd.getFullYear()-1);
    let startDate = sd.toISOString().substring(0,10);
    const csvDir = path.join(process.cwd(),"data","csv");
    const csvFiles = fs.readdirSync(csvDir).filter(f=>f.startsWith(pair.split("_")[0])&&f.endsWith(".csv"));
    if (csvFiles.length>0) {
      const {getLatestDate} = await import("../../backtester/loadCsv.js");
      const latest = getLatestDate(path.join(csvDir,csvFiles[0]));
      endDate = latest.toISOString().substring(0,10);
      const sd1=new Date(latest.getTime()); sd1.setFullYear(sd1.getFullYear()-1);
      startDate = sd1.toISOString().substring(0,10);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`  Pair: ${pair}  [${startDate} to ${endDate}]`);
    console.log(`${"=".repeat(70)}`);

    // ── SAGE ────────────────────────────────────────────────────────────────
    const sageConfigs = PairConfigManager.getSageConfigs(pair);
    for (let i=0;i<sageConfigs.length;i++) {
      const cfg = sageConfigs[i];
      const label = `SAGE_${pair}_${i}`;
      console.log(`\n  [SAGE #${i}] session:${cfg.session??"?"}`);
      const hS=freshHourlyStats(), dS=freshDailyStats(); let hasData=false;
      try {
        // ALWAYS audit without prior toxic filters to discover the true underlying underperforming hours/days
        const cleanCfg = { ...cfg, toxicHours: undefined, toxicDays: undefined };
        const r = await runSageMathBacktest(pair,startDate,endDate,false,{},[cleanCfg]);
        for (const rec of r.records){accumulateRecord(rec,hS,dS);if(rec.outcome!=="SKIPPED")hasData=true;}
      } catch(e:any){console.warn(`  ⚠️  Sage error [${label}]: ${e.message}`);}
      if(hasData){const bH=detectToxicHours(hS),bD=detectToxicDays(dS);bans.push({pair,bot:"SAGE",index:i,bannedHours:bH,bannedDays:bD});console.log(`  → [${label}] H=[${bH}] D=[${bD.map(d=>DAY_NAMES[d])}]`);}
      else{bans.push({pair,bot:"SAGE",index:i,bannedHours:[],bannedDays:[]});console.log(`  → [${label}] no trades — clearing`);}
      clearSageBacktestCache(pair);
    }

    // ── MAGE ────────────────────────────────────────────────────────────────
    const mageConfigs = PairConfigManager.getMageConfigs(pair);
    for (let i=0;i<mageConfigs.length;i++) {
      const cfg = mageConfigs[i];
      const label = `MAGE_${pair}_${i}`;
      console.log(`\n  [MAGE #${i}] session:${cfg.session??"?"} orbStartH:${cfg.orbStartHour} orbStartMin:${cfg.orbStartMin} orbMins:${cfg.orbMinutes}`);
      const hS=freshHourlyStats(), dS=freshDailyStats(); let hasData=false;
      try {
        // ALWAYS audit without prior toxic filters to discover the true underlying underperforming hours/days
        const cleanCfg = { ...cfg, toxicHours: undefined, toxicDays: undefined };
        const r = await runMageMathBacktest(pair,startDate,endDate,false,undefined,undefined,null,[cleanCfg]);
        for (const rec of r.records){accumulateRecord(rec,hS,dS);if(rec.outcome!=="SKIPPED")hasData=true;}
      } catch(e:any){console.warn(`  ⚠️  Mage error [${label}]: ${e.message}`);}
      if(hasData){const bH=detectToxicHours(hS),bD=detectToxicDays(dS);bans.push({pair,bot:"MAGE",index:i,bannedHours:bH,bannedDays:bD});console.log(`  → [${label}] H=[${bH}] D=[${bD.map(d=>DAY_NAMES[d])}]`);}
      else{bans.push({pair,bot:"MAGE",index:i,bannedHours:[],bannedDays:[]});console.log(`  → [${label}] no trades — clearing`);}
      clearMageBacktestCache(pair);
    }
  }

  // ── Write to PairConfig.ts ────────────────────────────────────────────────
  const PAIR_CONFIG_PATH = path.join(process.cwd(),"server","trading","config","PairConfig.ts");
  if (!fs.existsSync(PAIR_CONFIG_PATH)){console.error("❌ PairConfig.ts not found!");process.exit(1);}
  let content = fs.readFileSync(PAIR_CONFIG_PATH,"utf8");
  let injected=0;

  function applyBans(banList: typeof bans, botType: "MAGE"|"SAGE") {
    const blockAnchor = botType==="MAGE" ? "MAGE_PAIR_CONFIG" : "SAGE_PAIR_CONFIG";
    const byPair = new Map<string,typeof bans>();
    for (const b of banList) { if(!byPair.has(b.pair))byPair.set(b.pair,[]); byPair.get(b.pair)!.push(b); }
    for (const [,pairBans] of byPair.entries()) {
      // Apply descending index order to preserve offsets within the same block
      for (const ban of pairBans.slice().sort((a,b)=>b.index-a.index)) {
        content = updateConfigByPairIndex(content, ban.pair, ban.index, ban.bannedHours, ban.bannedDays, blockAnchor);
        if (ban.bannedHours.length>0||ban.bannedDays.length>0) {
          console.log(`✅ [${botType}_${ban.pair}_${ban.index}] H:[${ban.bannedHours}] D:[${ban.bannedDays.map(d=>DAY_NAMES[d])}]`);
          injected++;
        } else {
          console.log(`🧹 [${botType}_${ban.pair}_${ban.index}] cleared`);
        }
      }
    }
  }

  applyBans(bans.filter(b=>b.bot==="SAGE"), "SAGE");
  applyBans(bans.filter(b=>b.bot==="MAGE"), "MAGE");

  safeWriteFileSync(PAIR_CONFIG_PATH, content);
  console.log(`\n✅ PairConfig.ts updated for MAGE and SAGE.`);

  // ── SEER ────────────────────────────────────────────────────────────────
  try {
    const { runSeerToxicFilterInjection } = await import("../seer/inject_seer_toxic_hours.js");
    await runSeerToxicFilterInjection();
  } catch (e: any) {
    console.warn(`  ⚠️  SEER toxic injection skipped: ${e.message}`);
  }

  console.log(`✅ Per-session toxic injection complete (v3).\n`);

  // ── Step 2: Regenerate IST trade schedule ────────────────────────────────
  console.log(`\n📅 [Step 2/3] Regenerating IST trade schedule...`);
  try {
    const { execSync } = await import("child_process");
    execSync("npx tsx server/trading/optimizer/grandmaster/generate_ist_schedule.ts", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    console.log(`✅ IST schedule regenerated.`);
  } catch (e: any) {
    console.error(`❌ IST schedule generation failed: ${e.message}`);
  }

  // ── Step 3: Regenerate PDF ───────────────────────────────────────────────
  console.log(`\n📄 [Step 3/3] Regenerating PDF...`);
  try {
    const { spawnSync } = await import("child_process");
    // PDF generator uses Edge which emits stderr noise causing non-zero exit code.
    // We verify success by checking the output file rather than exit code.
    spawnSync("node", ["server/trading/optimizer/grandmaster/generate_pdf_fast.cjs"], {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    const pdfPath = path.join(process.cwd(), "server", "trading", "optimizer", "chronological_ist_trade_schedule.pdf");
    if (fs.existsSync(pdfPath)) {
      console.log(`✅ PDF regenerated.`);
    } else {
      console.error(`❌ PDF file not found after generation attempt.`);
    }
  } catch (e: any) {
    console.error(`❌ PDF generation failed: ${e.message}`);
  }

  console.log(`\n🏁 All done: toxic filters injected → IST schedule updated → PDF regenerated.\n`);
}

runDynamicToxicFilterInjection().catch(console.error);

