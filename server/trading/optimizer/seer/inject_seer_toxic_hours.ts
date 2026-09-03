// ============================================================================
// ☠️ SEER TOXIC HOURS & TOXIC DAYS DYNAMIC INJECTOR
// ============================================================================
// Criteria: A session-hour/day must be BOTH persistently losing (≥65% of active months)
// AND materially negative in total R (< -2.0R for hours, < -3.0R for days).
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import { PairConfigManager, SEER_PAIR_CONFIG } from "../../config/PairConfig.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { runSeerMathBacktest } from "../../backtester/SeerMathBacktester.js";
import { getFixedEstDate } from "../../backtester/math_core/MathCoreUtils.js";

const HOUR_MIN_NET_R    = -2.0;  // hour total net R must be worse than this
const DAY_MIN_NET_R     = -3.0;  // day total net R must be worse than this
const LOSING_RATIO_MIN  = 0.65;  // ≥65% of active months must be losing
const ACTIVE_MONTHS_MIN = 3;     // minimum active calendar months

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function safeWriteFileSync(filePath: string, content: string) {
  try {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, "utf-8");
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    fs.renameSync(tmpPath, filePath);
  } catch (_) { fs.writeFileSync(filePath, content, { flag: "w" }); }
}

interface MonthStat { trades: number; totalR: number; }

function freshHourlyStats(): Record<number, Record<number, MonthStat>> {
  const s: Record<number, Record<number, MonthStat>> = {};
  for (let h = 0; h < 24; h++) {
    s[h] = {};
    for (let m = 1; m <= 12; m++) s[h][m] = { trades: 0, totalR: 0 };
  }
  return s;
}

function freshDailyStats(): Record<number, Record<number, MonthStat>> {
  const s: Record<number, Record<number, MonthStat>> = {};
  for (let d = 0; d < 7; d++) {
    s[d] = {};
    for (let m = 1; m <= 12; m++) s[d][m] = { trades: 0, totalR: 0 };
  }
  return s;
}

function accumulateRecord(
  record: any,
  h: ReturnType<typeof freshHourlyStats>,
  d: ReturnType<typeof freshDailyStats>
) {
  if (!record || record.outcome === "SKIPPED") return;
  const r = record.rMultiple ?? 0;
  const ts = record.entryTimeMs || record.timestamp || (record.date ? new Date(record.date).getTime() : 0);
  if (!ts) return;
  const est = getFixedEstDate(new Date(ts));
  const hour = est.getUTCHours();
  const calMonth = est.getUTCMonth() + 1;
  const dow = est.getUTCDay();
  h[hour][calMonth].trades++;
  h[hour][calMonth].totalR += r;
  d[dow][calMonth].trades++;
  d[dow][calMonth].totalR += r;
}

function detectToxicHours(h: ReturnType<typeof freshHourlyStats>): number[] {
  const b: number[] = [];
  for (let hr = 0; hr < 24; hr++) {
    let aM = 0, lM = 0, tR = 0;
    for (let m = 1; m <= 12; m++) {
      const s = h[hr][m];
      if (s.trades > 0) {
        aM++;
        tR += s.totalR;
        if (s.totalR < 0) lM++;
      }
    }
    if (tR < HOUR_MIN_NET_R && aM >= ACTIVE_MONTHS_MIN && lM / aM >= LOSING_RATIO_MIN) {
      b.push(hr);
      console.log(`   🚫 Toxic Hour ${String(hr).padStart(2, "0")}:xx EST | NetR:${tR.toFixed(2)} | ${lM}/${aM} months (${((lM / aM) * 100).toFixed(0)}%)`);
    }
  }
  return b;
}

function detectToxicDays(d: ReturnType<typeof freshDailyStats>): number[] {
  const b: number[] = [];
  for (let dw = 0; dw < 7; dw++) {
    let aM = 0, lM = 0, tR = 0;
    for (let m = 1; m <= 12; m++) {
      const s = d[dw][m];
      if (s.trades > 0) {
        aM++;
        tR += s.totalR;
        if (s.totalR < 0) lM++;
      }
    }
    if (tR < DAY_MIN_NET_R && aM >= ACTIVE_MONTHS_MIN && lM / aM >= LOSING_RATIO_MIN) {
      b.push(dw);
      console.log(`   🚫 Toxic Day [${DAY_NAMES[dw]}] | NetR:${tR.toFixed(2)} | ${lM}/${aM} months (${((lM / aM) * 100).toFixed(0)}%)`);
    }
  }
  return b;
}

// ─── Block-scoped config updater for SEER_PAIR_CONFIG ────────────────────────
function updateConfigByPairIndex(
  content: string,
  pair: string,
  index: number,
  bannedHours: number[],
  bannedDays: number[],
  blockAnchor: string = "SEER_PAIR_CONFIG"
): string {
  const anchorIdx = content.indexOf(`export const ${blockAnchor}`);
  if (anchorIdx === -1) {
    console.warn(`  ⚠️  Block anchor "${blockAnchor}" not found — skipping`);
    return content;
  }

  const searchArea = content.substring(anchorIdx);
  const pairPattern = new RegExp(`(['"]${pair}['"]\\s*:\\s*\\[)`);
  const pairMatch = pairPattern.exec(searchArea);
  if (!pairMatch) {
    return content;
  }

  const arrayStart = anchorIdx + pairMatch.index + pairMatch[0].length;
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
          if (content[i] === "}") {
            depth--;
            if (depth === 0) { blockEnd = i; break; }
          }
        }
        break;
      }
      let depth = 0;
      for (; pos < content.length; pos++) {
        if (content[pos] === "{") depth++;
        if (content[pos] === "}") {
          depth--;
          if (depth === 0) { configCount++; break; }
        }
      }
    }
    pos++;
  }

  if (blockStart === -1 || blockEnd === -1) {
    console.warn(`  ⚠️  Block [${index}] not found for "${pair}" in ${blockAnchor}`);
    return content;
  }

  let block = content.substring(blockStart, blockEnd + 1);
  block = block.replace(/"toxicHours":\s*\[[\d,\s]*\](,?\n?\s*)?/g, "");
  block = block.replace(/"toxicDays":\s*\[[\d,\s]*\](,?\n?\s*)?/g, "");
  let inj = "";
  if (bannedHours.length > 0) inj += `"toxicHours": [${bannedHours.join(", ")}],\n      `;
  if (bannedDays.length > 0)  inj += `"toxicDays": [${bannedDays.join(", ")}],\n      `;
  if (inj) block = block.replace(/"session":/, `${inj}"session":`);

  return content.substring(0, blockStart) + block + content.substring(blockEnd + 1);
}

export async function runSeerToxicFilterInjection() {
  console.log(`\n======================================================`);
  console.log(`☠️  SEER TOXIC HOURS & TOXIC DAYS DYNAMIC INJECTOR ☠️`);
  console.log(`======================================================`);
  console.log(`   Criteria: Hour NetR < ${HOUR_MIN_NET_R}R, Day NetR < ${DAY_MIN_NET_R}R, losingRatio >= ${(LOSING_RATIO_MIN * 100).toFixed(0)}%, activeMonths >= ${ACTIVE_MONTHS_MIN}\n`);

  const seerPairs = Object.keys(SEER_PAIR_CONFIG).filter(p => !p.includes("BTC") && !p.includes("ETH"));
  const bans: Array<{ pair: string; bot: "SEER"; index: number; bannedHours: number[]; bannedDays: number[] }> = [];

  const csvDir = path.join(process.cwd(), "data", "csv");

  for (const pair of seerPairs) {
    const configs = PairConfigManager.getSeerConfigs(pair);
    if (!configs || configs.length === 0) continue;

    const baseSym = pair.replace(".Daily", "").split("_")[0];
    const csvFiles = fs.readdirSync(csvDir).filter(f => f.startsWith(baseSym) && f.endsWith(".csv"));
    if (csvFiles.length === 0) {
      console.warn(`  ⚠️  No CSV found for ${pair} — skipping toxic analysis`);
      continue;
    }

    const csvPath = path.join(csvDir, csvFiles[0]);
    const optCfg = OPTIMIZER_CONFIG[baseSym];
    const isForex = PairConfigManager.isForex(baseSym);
    const pipSize = optCfg ? optCfg.pipSize : (isForex ? 0.0001 : 0.01);
    const spread = optCfg ? optCfg.spread : 1.0;
    const spreadPts = spread * pipSize;

    console.log(`\n------------------------------------------------------`);
    console.log(`  Auditing SEER Pair: ${pair} (${csvFiles[0]})`);
    console.log(`------------------------------------------------------`);

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const label = `SEER_${pair}_${i}`;
      console.log(`\n  [SEER #${i}] session:${cfg.session ?? "?"} minBody:${cfg.minBodyPips ?? 4} minSL:${cfg.minSlDist} maxSL:${cfg.maxSlDist}`);
      
      const hS = freshHourlyStats();
      const dS = freshDailyStats();
      let hasData = false;

      try {
        // Run WITHOUT toxic filters to discover which hours/days naturally underperform
        const cleanCfg = { ...cfg, toxicHours: undefined, toxicDays: undefined };
        const res = await runSeerMathBacktest(pair, undefined, undefined, true, {}, [cleanCfg]);

        const records = res.records || [];
        for (const rec of records) {
          accumulateRecord(rec, hS, dS);
          if (rec.outcome !== "SKIPPED") hasData = true;
        }
      } catch (e: any) {
        console.warn(`  ⚠️  SEER error [${label}]: ${e.message}`);
      }

      if (hasData) {
        const bH = detectToxicHours(hS);
        const bD = detectToxicDays(dS);
        bans.push({ pair, bot: "SEER", index: i, bannedHours: bH, bannedDays: bD });
        console.log(`  → [${label}] Toxic Hours=[${bH.join(", ")}] Toxic Days=[${bD.map(d => DAY_NAMES[d]).join(", ")}]`);
      } else {
        bans.push({ pair, bot: "SEER", index: i, bannedHours: [], bannedDays: [] });
        console.log(`  → [${label}] no trades — clearing`);
      }
    }
  }

  // ── Write to PairConfig.ts ────────────────────────────────────────────────
  const PAIR_CONFIG_PATH = path.join(process.cwd(), "server", "trading", "config", "PairConfig.ts");
  if (!fs.existsSync(PAIR_CONFIG_PATH)) {
    console.error("❌ PairConfig.ts not found!");
    process.exit(1);
  }

  let content = fs.readFileSync(PAIR_CONFIG_PATH, "utf8");
  let injected = 0;

  const byPair = new Map<string, typeof bans>();
  for (const b of bans) {
    if (!byPair.has(b.pair)) byPair.set(b.pair, []);
    byPair.get(b.pair)!.push(b);
  }

  for (const [, pairBans] of byPair.entries()) {
    // Apply descending index order to preserve offsets within the block
    for (const ban of pairBans.slice().sort((a, b) => b.index - a.index)) {
      content = updateConfigByPairIndex(content, ban.pair, ban.index, ban.bannedHours, ban.bannedDays, "SEER_PAIR_CONFIG");
      if (ban.bannedHours.length > 0 || ban.bannedDays.length > 0) {
        console.log(`✅ [SEER_${ban.pair}_${ban.index}] H:[${ban.bannedHours.join(", ")}] D:[${ban.bannedDays.map(d => DAY_NAMES[d]).join(", ")}]`);
        injected++;
      } else {
        console.log(`🧹 [SEER_${ban.pair}_${ban.index}] cleared`);
      }
    }
  }

  safeWriteFileSync(PAIR_CONFIG_PATH, content);
  console.log(`\n✅ PairConfig.ts updated. ${injected} SEER config(s) received toxic filters.`);
  console.log(`🎉 SEER Toxic Filter Injection Complete!\n`);
}

runSeerToxicFilterInjection().catch(console.error);
