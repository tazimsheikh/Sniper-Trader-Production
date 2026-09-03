import * as fs from 'fs';
import * as path from 'path';
import { MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG, SEER_PAIR_CONFIG } from '../../config/PairConfig.js';

function convertNyTimeToIst(nyHour: number, nyMin: number): { istHour: number; istMin: number; istStr: string; totalIstMins: number } {
  // Use Intl.DateTimeFormat to calculate the exact dynamic offset between NY and India (DST-aware)
  const formatterIST = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false });
  const formatterEST = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false });
  
  const testDate = new Date();
  const istStr = formatterIST.format(testDate);
  const estStr = formatterEST.format(testDate);
  
  const parseDate = (str: string) => {
    const [dPart, tPart] = str.split(", ");
    const [mon, dy, yr] = dPart.split("/");
    const [hr, mn] = tPart.split(":");
    return new Date(parseInt(yr), parseInt(mon) - 1, parseInt(dy), parseInt(hr), parseInt(mn));
  };
  
  const diffMs = parseDate(istStr).getTime() - parseDate(estStr).getTime();
  const diffMins = Math.round(diffMs / 60000); 
  
  const totalMins = nyHour * 60 + nyMin + diffMins;
  const rawIstHour = Math.floor(totalMins / 60) % 24;
  const istHour = rawIstHour < 0 ? rawIstHour + 24 : rawIstHour;
  const istMin = totalMins % 60;
  
  const ampm = istHour >= 12 ? 'PM' : 'AM';
  const displayHour = istHour % 12 === 0 ? 12 : istHour % 12;
  const displayMinStr = istMin.toString().padStart(2, '0');
  const displayIstStr = `${displayHour.toString().padStart(2, '0')}:${displayMinStr} ${ampm} IST`;
  const totalIstMins = istHour * 60 + istMin;

  return { istHour, istMin, istStr: displayIstStr, totalIstMins };
}

function formatISTTime(hour: number, min: number) {
  return convertNyTimeToIst(hour, min).istStr;
}

function getMinutesFromMidnightIST(hour: number, min: number) {
  return convertNyTimeToIst(hour, min).totalIstMins;
}

function formatToxicHoursIST(hours?: number[]): string {
  if (!hours || hours.length === 0) return "None";
  return hours.map(h => `${formatISTTime(h, 0)}`).join(", ");
}

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatToxicDays(days?: (number | string)[]): string {
  if (!days || days.length === 0) return "None";
  return days.map(d => (typeof d === "number" && DOW_NAMES[d] ? DOW_NAMES[d] : d)).join(", ");
}

function formatArray(arr?: any[]): string {
  if (!arr || arr.length === 0) return "None";
  return arr.join(", ");
}

interface ScheduleEntry {
  istTradeStartStr: string;
  istMins: number;
  nySession: string;
  nyStartHour: number;
  nyStartMin: number;
  nyEndHour: number;
  nyEndMin: number;
  symbol: string;
  bot: string;
  strategyType: string;
  orbDuration: number;
  actionWindow: number;
  slBounds: string;
  riskPct: string;
  toxicHoursStr: string;
  toxicDaysStr: string;
  toxicMonthsStr: string;
}

const entries: ScheduleEntry[] = [];

function processConfigs(configs: Record<string, any[]>, botName: string) {
  for (const [symbol, pairCfgs] of Object.entries(configs || {})) {
    for (const cfg of pairCfgs) {
      let strategyType = "Unknown";
      let orbDuration = cfg.orbMinutes || 0;
      let nyStartHour = cfg.orbStartHour || 0;
      let nyStartMin = cfg.orbStartMin || 0;
      let nyEndHour = 0;
      let nyEndMin = 0;
      let actionWindow = cfg.actionMinutes || 0;

      if (botName === "Mage") {
        if (!cfg.orbEnabled) continue;
        strategyType = "ORB Breakout";
        const startMins = nyStartHour * 60 + nyStartMin;
        const delayMins = 6;
        const endMins = (startMins + orbDuration + delayMins) % 1440;
        nyEndHour = Math.floor(endMins / 60);
        nyEndMin = endMins % 60;
      } else if (botName === "Sage") {
        if (!cfg.orbEnabled) continue;
        strategyType = "Liquidity Sweep";
        const startMins = nyStartHour * 60 + nyStartMin;
        const delayMins = 1;
        const endMins = (startMins + orbDuration + delayMins) % 1440;
        nyEndHour = Math.floor(endMins / 60);
        nyEndMin = endMins % 60;
      } else if (botName === "Seer") {
        strategyType = "Liquidity Hunt (Pin Bar)";
        const sess = (cfg.session || (cfg.sessions && cfg.sessions[0]) || "london").toLowerCase();
        if (sess.includes("asia")) {
          nyStartHour = 20; // 8:00 PM NY
          nyStartMin = 0;
        } else if (sess.includes("london")) {
          nyStartHour = 2; // 2:00 AM NY
          nyStartMin = 0;
        } else if (sess.includes("ny")) {
          nyStartHour = 8; // 8:00 AM NY
          nyStartMin = 0;
        }
        nyEndHour = nyStartHour;
        nyEndMin = nyStartMin;
        orbDuration = 0;
        actionWindow = 240;
      }

      // Stamp time at exact moment when live engine registers and begins active scan/execution
      const istTradeStartStr = formatISTTime(nyEndHour, nyEndMin);
      const istMins = getMinutesFromMidnightIST(nyEndHour, nyEndMin);

      const nySession = cfg.session || (cfg.sessions && cfg.sessions[0]) || "london";
      const slBounds = `${cfg.minSlDist} – ${cfg.maxSlDist} pips`;
      const riskPct = cfg.riskPct !== undefined ? (cfg.riskPct * 100).toFixed(1) + "%" : "N/A";

      const toxicHoursStr = formatToxicHoursIST(cfg.toxicHours);
      const toxicDaysStr = formatToxicDays(cfg.toxicDays);
      const toxicMonthsStr = formatArray(cfg.toxicMonths);

      entries.push({
        istTradeStartStr,
        istMins,
        nySession,
        nyStartHour,
        nyStartMin,
        nyEndHour,
        nyEndMin,
        symbol,
        bot: botName,
        strategyType,
        orbDuration,
        actionWindow,
        slBounds,
        riskPct,
        toxicHoursStr,
        toxicDaysStr,
        toxicMonthsStr
      });
    }
  }
}

processConfigs(MAGE_PAIR_CONFIG, "Mage");
processConfigs(SAGE_PAIR_CONFIG, "Sage");
processConfigs(SEER_PAIR_CONFIG, "Seer");

// Sort chronologically by ORB completion time in IST
entries.sort((a, b) => a.istMins - b.istMins);

let markdown = `# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **${entries.length} active setups** in \`server/trading/config/PairConfig.ts\`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
`;

for (const entry of entries) {
  const sessionStr = `\`${entry.nySession}\``;
  markdown += `| **${entry.istTradeStartStr}** | ${sessionStr} | \`${entry.symbol}\` | ${entry.bot} | ${entry.strategyType} | ${entry.orbDuration} Mins | ${entry.actionWindow} Mins | ${entry.slBounds} | **${entry.riskPct}** | ${entry.toxicHoursStr} | ${entry.toxicDaysStr} | ${entry.toxicMonthsStr} |\n`;
}

const asiaEntries = entries.filter(e => e.nySession.toLowerCase().includes('asia'));
const londonEntries = entries.filter(e => e.nySession.toLowerCase().includes('london'));
const nyEntries = entries.filter(e => e.nySession.toLowerCase().includes('ny'));

markdown += `
---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - ${asiaEntries.map(e => `${e.symbol} (${e.bot}) - ${e.istTradeStartStr}`).join(', ')}

2. **London Open Trade Cluster**
   - ${londonEntries.map(e => `${e.symbol} (${e.bot}) - ${e.istTradeStartStr}`).join(', ')}

3. **New York Pre-Market & Open Trade Cluster**
   - ${nyEntries.map(e => `${e.symbol} (${e.bot}) - ${e.istTradeStartStr}`).join(', ')}
`;

const outputPath = path.join(process.cwd(), "server", "trading", "optimizer", "chronological_ist_trade_schedule.md");
fs.writeFileSync(outputPath, markdown, 'utf8');

console.log(`✅ Successfully generated ${outputPath}`);
