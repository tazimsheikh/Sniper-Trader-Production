import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG, SEER_PAIR_CONFIG } from '../config/PairConfig.js';

async function runAll() {
  let start = process.argv[2];
  let end = process.argv[3];

  if (!start || !end) {
    const csvDir = path.join(process.cwd(), "data", "csv");
    const csvFiles = fs.readdirSync(csvDir).filter((f) => f.endsWith(".csv") && f.includes("_M1_"));
    if (csvFiles.length > 0) {
      const { getLatestDate } = await import("../backtester/loadCsv.js");
      const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
      end = latestDate.toISOString().substring(0, 10);
      const sd = new Date(latestDate.getTime());
      sd.setMonth(sd.getMonth() - 1);
      start = sd.toISOString().substring(0, 10);
    } else {
      start = "2026-04-01";
      end = "2026-04-30";
    }
  }
  
  const botPairs = [
    { bot: "SAGE", pairs: Object.keys(SAGE_PAIR_CONFIG || {}) },
  ];
  
  console.log(`Starting Parity Check across ALL BOTS from ${start} to ${end}...`);
  
  let passed = 0;
  let failed = 0;
  const results: any[] = [];
  let fullReport = `PARITY REPORT: ${start} to ${end}\n======================================================\n`;
  
  for (const group of botPairs) {
    const { bot, pairs } = group;
    if (pairs.length === 0) continue;

    console.log(`\n======================================================`);
    console.log(` TESTING BOT: ${bot}`);
    console.log(`======================================================`);

    for (const pair of pairs) {
      console.log(`\n------------------------------------------------------`);
      console.log(`Testing ${bot} ${pair}...`);
      try {
        const output = execSync(`npx tsx server/trading/testing/core_parity_engine.ts ${bot} ${pair} ${start} ${end}`, { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 1024 * 1024 * 50 });
        
        fullReport += `\n\n=== [${bot}] ${pair} ===\n`;
        fullReport += output;

        const tier1Match = output.match(/TIER 1 \(Math\)\s*: Trades = (\d+)\s*\| Net R = ([\d\.\-]+)/);
        const tier2Match = output.match(/TIER 2 \(Shadow\)\s*: Trades = (\d+)\s*\| Net R = ([\d\.\-]+)/);
        
        const t1 = tier1Match ? `T1: ${tier1Match[1]}T, ${tier1Match[2]}R` : "T1: N/A";
        const t2 = tier2Match ? `T2: ${tier2Match[1]}T, ${tier2Match[2]}R` : "T2: N/A";
        
        const countMatch = output.includes("Trade Count Match : ✅") ? "✅" : "❌";
        const rMatch = output.includes("Net R Match       : ✅") ? "✅" : "❌";
        const microMatch = output.includes("Micro Details Match : ✅") ? "✅" : "❌";
        
        const checks = `Count: ${countMatch} | R: ${rMatch} | Micro: ${microMatch}`;
        const summaryStr = `${t1} | ${t2} | ${checks}`;

        if (output.includes("FULL PIPELINE PARITY CONFIRMED")) {
          passed++;
          results.push({ bot, pair, status: "PASS", summaryStr });
          console.log(`✅ PASS: ${bot} ${pair} | ${summaryStr}`);
        } else {
          failed++;
          results.push({ bot, pair, status: "FAIL", summaryStr });
          console.log(`❌ FAIL: ${bot} ${pair} | ${summaryStr}`);
          
          // Log trade tables and micro mismatch details directly to stdout for immediate debugging
          const tradeTablesMatch = output.match(/(=================== TIER 1 \(MATH\) TRADES ===================[\s\S]*?============================================================)/);
          if (tradeTablesMatch) {
            console.log(tradeTablesMatch[1]);
          }
          const mismatches = output.split('\n').filter(line => line.includes('[MICRO MISMATCH]') || line.includes('PARITY BROKEN') || line.includes('Trade Count Match') || line.includes('Net R Match') || line.includes('Micro Details Match'));
          if (mismatches.length > 0) {
            console.log(mismatches.join('\n'));
          }
        }
      } catch (e: any) {
        console.log(`Error running test for ${bot} ${pair}:`, e?.message || e, e?.stack);
        failed++;
        results.push({ bot, pair, status: "FAIL", summaryStr: "ERROR" });
      }
    }
  }
  
  const reportPath = path.join(process.cwd(), 'server', 'trading', 'testing', 'parity_report.txt');
  fs.writeFileSync(reportPath, fullReport, 'utf-8');
  console.log(`\n[i] Full detailed trade logs saved to: ${reportPath}`);

  console.log(`\n======================================================`);
  console.log(`FINAL RESULTS (${start} to ${end}):`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  results.forEach(r => {
    console.log(`[${r.bot}] ${r.pair.padEnd(15)}: ${r.status === "PASS" ? "✅ PASS" : "❌ FAIL"} | ${r.summaryStr}`);
  });

  if (failed > 0) process.exit(1);
}

runAll().catch(console.error);
