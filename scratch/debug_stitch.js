const fs = require('fs');
const path = require('path');

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

function loadStateData(dumpDir, symbol) {
  const fPath = path.join(dumpDir, `state_${symbol}.json`);
  if (!fs.existsSync(fPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(fPath, "utf-8"));
    const items = Array.isArray(parsed) ? parsed
      : (parsed.validAlphas && Array.isArray(parsed.validAlphas)) ? parsed.validAlphas : [];
    return items.filter((item) => {
      if (!item || typeof item !== "object") return false;
      item.setup = item.setup || item.params || item.signature;
      return item.setup && typeof item.setup === "string"
        && item.dailyNetR && Object.keys(item.dailyNetR).length > 0;
    });
  } catch { return []; }
}

function stitchOOSSlices(rawData, botType) {
  const mergedMap = new Map();
  for (const item of rawData) {
    if (!item.setup) continue;
    const coreSig = getCoreSignature(item.setup, botType);
    const existing = mergedMap.get(coreSig);
    if (existing) {
      existing.trades    = (existing.trades    || 0) + (item.trades    || 0);
      existing.totalNetR = (existing.totalNetR || 0) + (item.totalNetR || 0);
      existing.oosNetR   = (existing.oosNetR   || 0) + (item.oosNetR   || 0);
      existing.dailyNetR = { ...(existing.dailyNetR || {}), ...(item.dailyNetR || {}) };
    } else {
      mergedMap.set(coreSig, { ...item, dailyNetR: { ...(item.dailyNetR || {}) } });
    }
  }
  return Array.from(mergedMap.values());
}

const mData = loadStateData("server/trading/optimizer/mage/mage_optimizer_dump", "GBPJPY");
const mStitched = stitchOOSSlices(mData, "Mage");
console.log(`Original count: ${mData.length}, Stitched count: ${mStitched.length}`);
if (mStitched.length > 0) {
  console.log(`Dates in first stitched item: ${Object.keys(mStitched[0].dailyNetR).length}`);
  console.log(`Trades in first stitched item: ${mStitched[0].trades}`);
}
