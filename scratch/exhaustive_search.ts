import fs from "fs";
import path from "path";

const OPTIMIZER_DIR = path.join(process.cwd(), "server", "trading", "optimizer");
const MAGE_DUMP_DIR = path.join(OPTIMIZER_DIR, "mage", "mage_optimizer_dump");
const SAGE_DUMP_DIR = path.join(OPTIMIZER_DIR, "sage", "sage_optimizer_dump");
const OOS_START = "2026-02-01";

function calculateOOS(dailyNetR: Record<string, number>) {
  const dates = Object.keys(dailyNetR).filter(d => d >= OOS_START).sort();
  let netR = 0;
  let peak = 0;
  let maxDd = 0;
  let winDays = 0;
  let lossDays = 0;

  for (const d of dates) {
    const r = dailyNetR[d];
    netR += r;
    if (r > 0) winDays++;
    else if (r < 0) lossDays++;

    if (netR > peak) peak = netR;
    const dd = peak - netR;
    if (dd > maxDd) maxDd = dd;
  }
  return { netR, maxDd, activeDays: winDays + lossDays };
}

function searchStates(bot: string, dumpDir: string) {
  if (!fs.existsSync(dumpDir)) return [];
  const files = fs.readdirSync(dumpDir).filter(f => f.startsWith("state_") && f.endsWith(".json"));
  
  const results: any[] = [];
  
  for (const f of files) {
    const pair = f.replace("state_", "").replace(".json", "").replace(".Daily", "");
    const raw = fs.readFileSync(path.join(dumpDir, f), "utf8");
    let state = [];
    try {
      state = JSON.parse(raw);
    } catch(e) { continue; }
    
    if (Array.isArray(state)) {
      for (const chromosome of state) {
        if (chromosome.setup && chromosome.dailyNetR) {
          const oos = calculateOOS(chromosome.dailyNetR);
          results.push({
            bot, pair,
            setup: chromosome.setup,
            oosNetR: oos.netR,
            oosMaxDd: oos.maxDd,
            activeDays: oos.activeDays
          });
        }
      }
    }
  }
  
  return results;
}

const mageRes = searchStates("MAGE", MAGE_DUMP_DIR);
const sageRes = searchStates("SAGE", SAGE_DUMP_DIR);
const allRes = [...mageRes, ...sageRes];

// 1. Find a better CHFJPY
const chfJpyCands = allRes.filter(r => r.pair === "CHFJPY" && r.oosMaxDd < 8 && r.oosNetR > 1 && r.activeDays >= 5);
chfJpyCands.sort((a,b) => b.oosNetR - a.oosNetR);
console.log("--- BEST OOS ALTERNATIVES FOR CHFJPY (DD < 8R) ---");
for(let i=0; i<Math.min(5, chfJpyCands.length); i++) {
  const c = chfJpyCands[i];
  console.log(`NetR: ${c.oosNetR.toFixed(2)} | DD: ${c.oosMaxDd.toFixed(2)} | Days: ${c.activeDays} | ${c.setup}`);
}

// 2. Find sitting ducks
const holyGrailConfigs = [
  "USDJPY", "NAS100", "GER40", "EURUSD", "US30", // Mage
  "GBPUSD", "NZDUSD", "CHFJPY", "JPN225", "EURUSD", "AUDUSD", "USDCHF", "EURJPY" // Sage
];

const missingGood = allRes.filter(r => 
  !holyGrailConfigs.includes(r.pair) && 
  r.activeDays >= 10 && 
  r.oosMaxDd < 5 && 
  r.oosNetR > 5
);

// Group by pair to get the best for each missing pair
const bestMissing: Record<string, any> = {};
for (const m of missingGood) {
  const key = `${m.bot} ${m.pair}`;
  if (!bestMissing[key] || m.oosNetR > bestMissing[key].oosNetR) {
    bestMissing[key] = m;
  }
}

console.log("\n--- SITTING DUCKS: EXCELLENT UNTAPPED CONFIGS (DD < 5R, NetR > 5R) ---");
for (const key of Object.keys(bestMissing)) {
  const m = bestMissing[key];
  console.log(`${key.padEnd(15)} | NetR: ${m.oosNetR.toFixed(2)} | DD: ${m.oosMaxDd.toFixed(2)} | Days: ${m.activeDays} | ${m.setup}`);
}
