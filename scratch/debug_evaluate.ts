import fs from 'fs';
import path from 'path';
import { evaluateComponent } from '../server/trading/optimizer/grandmaster/GrandmasterMetrics.ts';

function getCoreSignature(setup, botType) {
  const parts = setup.split("_");
  let session = parts[0];
  if (parts[0] === "NY") session = `NY_${parts[1]}`;
  const fcPart = parts.find((p) => p.startsWith("FC")) || "NoFC";
  if (botType === "Sage") {
    const sweepPart = parts.find((p) => p.startsWith("Sweep")) || "NoSweep";
    const exitPart  = parts.find((p) => p.startsWith("Exit"))  || "NoExit";
    return `${session}_${sweepPart}_${exitPart}_${fcPart}`;
  } else {
    const bodyPart   = parts.find((p) => p.startsWith("Body")) || "NoBody";
    const bypassPart = parts.find((p) => p.endsWith("%"))      || "0%";
    return `${session}_${bypassPart}_${bodyPart}_${fcPart}`;
  }
}

function runTest() {
  const fPath = 'server/trading/optimizer/sage/sage_optimizer_dump/state_AUDUSD.json';
  const parsed = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
  const items = Array.isArray(parsed) ? parsed : (parsed.validAlphas ? parsed.validAlphas : []);
  
  const mergedMap = new Map();
  for (const item of items) {
    if (!item.setup) continue;
    const coreSig = getCoreSignature(item.setup, 'Sage');
    const existing = mergedMap.get(coreSig);
    if (existing) {
      existing.trades = (existing.trades || 0) + (item.trades || 0);
      existing.dailyNetR = { ...(existing.dailyNetR || {}), ...(item.dailyNetR || {}) };
    } else {
      mergedMap.set(coreSig, { ...item, dailyNetR: { ...(item.dailyNetR || {}) } });
    }
  }
  
  const stitched = Array.from(mergedMap.values());
  const item = stitched[0];
  
  const gd = Object.keys(item.dailyNetR).sort();
  const isDates = gd.filter(d => d < '2026-03-01');
  console.log("Stitched trades:", item.trades);
  console.log("isDates length:", isDates.length);
  
  const dailyRArray = new Float64Array(isDates.length);
  for(let i=0; i<isDates.length; i++) dailyRArray[i] = item.dailyNetR[isDates[i]] || 0;
  
  item.dailyRArray = dailyRArray;
  
  const result = evaluateComponent(item, 'AUDUSD', 'Sage', isDates, false);
  console.log(result ? 'PASSED' : 'FAILED');
}
runTest();
