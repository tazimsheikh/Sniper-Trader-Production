import fs from "fs";
import path from "path";
import { runSeerMathBacktest, clearSeerBacktestCache } from "../../backtester/SeerMathBacktester.js";
import paramsToConfig from "../grandmaster/utils/seer_params_parser.js";
import { loadAuditCache } from "../grandmaster/GrandmasterPreProcessor.js";


async function main() {
  console.log("================================================================");
  console.log("🔮 Hydrating Seer 3-Year Math Audit Cache");
  console.log("================================================================");

  const root = process.cwd();
  const seerDumpDir = path.join(root, "server", "trading", "optimizer", "seer", "seer_optimizer_dump");
  if (!fs.existsSync(seerDumpDir)) {
    console.error("Seer dump dir not found:", seerDumpDir);
    return;
  }

  const stateFiles = fs.readdirSync(seerDumpDir).filter(f => f.startsWith("state_") && f.endsWith(".json"));
  console.log(`Found ${stateFiles.length} state dump files in ${seerDumpDir}`);

  const auditCache = loadAuditCache();
  let addedCount = 0;
  let auditedCount = 0;

  for (const file of stateFiles) {
    const rawSym = file.replace(/^state_/, "").replace(/\.json$/, "");
    const cleanSym = rawSym.replace(/\.Daily$/i, "").toUpperCase();

    const filePath = path.join(seerDumpDir, file);
    let states: any[] = [];
    try {
      states = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      continue;
    }

    if (!Array.isArray(states) || states.length === 0) continue;

    // Deduplicate setups
    const setupMap = new Map<string, any>();
    for (const s of states) {
      if (!s.setup) continue;
      const score = ((s.totalNetR || 0) + (s.isNetR || 0));
      if (!setupMap.has(s.setup) || score > setupMap.get(s.setup).score) {
        setupMap.set(s.setup, { state: s, score });
      }
    }

    // Sort candidates descending by score and pick top 10 unique candidates per symbol
    const sortedCandidates = Array.from(setupMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    console.log(`\nAuditing ${sortedCandidates.length} Seer candidates for ${rawSym}...`);

    for (let i = 0; i < sortedCandidates.length; i++) {
      const { state } = sortedCandidates[i];
      const setupStr = state.setup.trim();

      // Check if already in cache
      const cacheKeyPrefix = `Seer_${rawSym}_${setupStr}`;
      const existingKey = Object.keys(auditCache).find(k => k.startsWith(cacheKeyPrefix));
      if (existingKey) {
        // already cached
        continue;
      }

      try {
        const config = paramsToConfig(setupStr, rawSym);
        const t0 = Date.now();
        const res = await runSeerMathBacktest(rawSym, undefined, undefined, true, {}, [config], false);
        const elapsed = (Date.now() - t0) / 1000;

        if (!res || !res.records || res.trades < 3) continue;

        const records = res.records || [];
        const traded = records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
        if (traded.length < 3) continue;

        // Sort chronologically
        traded.sort((a: any, b: any) => {
          const timeA = a.timestamp || (a.entryTimeMs ?? new Date(a.exitTime || a.entryTime || a.date || a.time).getTime());
          const timeB = b.timestamp || (b.entryTimeMs ?? new Date(b.exitTime || b.entryTime || b.date || b.time).getTime());
          return timeA - timeB;
        });

        const dailyNetR: Record<string, number> = {};
        const monthlyNetR: Record<string, number> = {};
        let peak = 0, runningR = 0, maxDD = 0;
        let grossWin = 0, grossLoss = 0, winCount = 0;
        const halfYearNetR: Record<string, number> = {};

        for (const r of traded) {
          const val = r.rMultiple || 0;
          const d = (r as any).date || ((r as any).timestamp ? new Date((r as any).timestamp).toISOString().split("T")[0] : null);
          if (d) {
            dailyNetR[d] = (dailyNetR[d] || 0) + val;
            const ym = d.substring(0, 7);
            monthlyNetR[ym] = (monthlyNetR[ym] || 0) + val;

            const y = d.substring(0, 4);
            const m = parseInt(d.substring(5, 7), 10);
            const halfKey = `${y}-H${m <= 6 ? 1 : 2}`;
            halfYearNetR[halfKey] = (halfYearNetR[halfKey] || 0) + val;
          }

          if (val > 0) {
            grossWin += val;
            winCount++;
          } else if (val < 0) {
            grossLoss += Math.abs(val);
          }

          runningR += val;
          if (runningR > peak) peak = runningR;
          const dd = peak - runningR;
          if (dd > maxDD) maxDD = dd;
        }

        const totalTrades = traded.length;
        const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
        const totalNetR = runningR;
        const profitFactor = grossLoss > 0 ? grossWin / grossLoss : 99.0;
        const avgWinR = winCount > 0 ? grossWin / winCount : 0;

        const totalHalfs = Object.keys(halfYearNetR).length;
        const profHalfs = Object.values(halfYearNetR).filter(v => v > 0).length;
        const regimeConsistency = totalHalfs > 0 ? (profHalfs / totalHalfs) * 100 : 0;

        const fullKey = `${cacheKeyPrefix}_${totalTrades}_${Math.round(winRate)}`;
        auditCache[fullKey] = {
          threeYearNetR: totalNetR,
          threeYearTrades: totalTrades,
          threeYearWinRate: winRate,
          threeYearMaxDrawdown: maxDD,
          threeYearProfitFactor: profitFactor,
          regimeConsistency,
          dailyReturns: dailyNetR,
          monthlyNetR,
          avgWinR,
        };

        addedCount++;
        auditedCount++;
        console.log(`  ✅ [${i + 1}/${sortedCandidates.length}] ${rawSym}: ${setupStr.substring(0, 40)}... -> NetR: +${totalNetR.toFixed(1)}R, MaxDD: ${maxDD.toFixed(1)}R, WR: ${winRate.toFixed(1)}% (${elapsed.toFixed(1)}s)`);
      } catch (err: any) {
        console.error(`  ❌ Error auditing ${setupStr}: ${err.message}`);
      }
    }

    clearSeerBacktestCache(rawSym);

    // Flush cache after each symbol
    if (addedCount > 0) {
      const cacheDir = path.join(root, "server", "trading", "optimizer", "grandmaster", ".cache");
      const cacheFile = path.join(cacheDir, "grandmaster_audit_cache.json");
      fs.writeFileSync(cacheFile, JSON.stringify(auditCache, null, 2), "utf-8");
      console.log(`  💾 Persisted cache (${Object.keys(auditCache).length} total keys).`);
    }
  }

  console.log(`\n🎉 Seer Audit Complete! Audited ${auditedCount} setups, added ${addedCount} new entries to cache.`);
}

main().catch(console.error);
