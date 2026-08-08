import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import db from "../../../core/db.js";
import { decrypt, isEncrypted } from "../../../core/crypto.js";

async function getApiKey(): Promise<string | null> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (apiKey) return apiKey;

  try {
    const user = (await db
      .prepare("SELECT gemini_api_key FROM users WHERE gemini_api_key IS NOT NULL AND gemini_api_key != '' ORDER BY id DESC")
      .get()) as any;
    if (user?.gemini_api_key) {
      return isEncrypted(user.gemini_api_key)
        ? decrypt(user.gemini_api_key)
        : user.gemini_api_key;
    }
  } catch (e: any) {
    console.warn("[NewsUpdater] Failed to fetch API key from DB:", e.message);
  }

  console.warn("[NewsUpdater] GEMINI_API_KEY is missing from environment and database. Cannot update historical news.");
  return null;
}

async function fetchHistoricalDates(yearStart: number, yearEnd: number) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  const prompt = `Use Google Search to find the exact historical release dates for the following major US economic events from the year ${yearStart} through the year ${yearEnd}:
1. US Non-Farm Payrolls (NFP)
2. US Consumer Price Index (CPI)
3. US FOMC Rate Decisions

Return the data STRICTLY as a JSON object matching this schema:
{
  "NFP_DATES": ["YYYY-MM-DD", "YYYY-MM-DD", ...],
  "CPI_DATES": ["YYYY-MM-DD", "YYYY-MM-DD", ...],
  "FOMC_DATES": ["YYYY-MM-DD", "YYYY-MM-DD", ...]
}

CRITICAL RULES:
- Use exact YYYY-MM-DD format.
- Ensure the data covers every single month for NFP and CPI for all requested years.
- Ensure the data covers all 8 FOMC meetings for each year.
- Do NOT include any markdown blocks, comments, or extra text. Output purely the JSON object.
`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`🧠 Querying Gemini for historical dates (${yearStart} - ${yearEnd})... (Attempt ${attempt}/3)`);
    try {
      const ai = new GoogleGenerativeAI(apiKey);
      const model = ai.getGenerativeModel({
        model: "gemini-2.5-flash",
      });

      const result = await model.generateContent(prompt);
      let text = result.response.text() || "";

      // Regex to strictly extract the JSON object
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }

      const data = JSON.parse(text.trim());
      
      // Basic validation
      if (data.NFP_DATES && data.CPI_DATES && data.FOMC_DATES) {
        return data;
      } else {
        console.error(`❌ Missing keys in response on attempt ${attempt}`);
      }
    } catch (error) {
      console.error(`❌ Failed to fetch historical news from Gemini on attempt ${attempt}:`, error);
    }
  }
  return null;
}

function parseExistingDates(filePath: string): { NFP: Set<string>; CPI: Set<string>; FOMC: Set<string> } {
  const result = { NFP: new Set<string>(), CPI: new Set<string>(), FOMC: new Set<string>() };
  if (!fs.existsSync(filePath)) return result;

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    
    const nfpMatch = content.match(/export const NFP_DATES = new Set\(\[([\s\S]*?)\]\);/);
    if (nfpMatch) {
      const dates = nfpMatch[1].match(/"\d{4}-\d{2}-\d{2}"/g);
      if (dates) dates.forEach(d => result.NFP.add(d.replace(/"/g, "")));
    }

    const cpiMatch = content.match(/export const CPI_DATES = new Set\(\[([\s\S]*?)\]\);/);
    if (cpiMatch) {
      const dates = cpiMatch[1].match(/"\d{4}-\d{2}-\d{2}"/g);
      if (dates) dates.forEach(d => result.CPI.add(d.replace(/"/g, "")));
    }

    const fomcMatch = content.match(/export const FOMC_DATES = new Set\(\[([\s\S]*?)\]\);/);
    if (fomcMatch) {
      const dates = fomcMatch[1].match(/"\d{4}-\d{2}-\d{2}"/g);
      if (dates) dates.forEach(d => result.FOMC.add(d.replace(/"/g, "")));
    }
  } catch (e: any) {
    console.error("⚠️ Failed to parse existing historicalNews.ts dates:", e.message);
  }

  return result;
}

function generateTsFile(nfp: Set<string>, cpi: Set<string>, fomc: Set<string>) {
  const sortedNfp = Array.from(nfp).sort();
  const sortedCpi = Array.from(cpi).sort();
  const sortedFomc = Array.from(fomc).sort();
  
  let content = `// ============================================================
// HISTORICAL EXACT NEWS DATES (Dynamically Updated via Gemini API)
// Used by Optimizers and Math Backtesters for perfect Tier 4 parity.
// ============================================================

export const NFP_DATES = new Set([
`;
  sortedNfp.forEach((d: string) => {
    content += `  "${d}",\n`;
  });
  content += `]);\n\nexport const CPI_DATES = new Set([\n`;
  
  sortedCpi.forEach((d: string) => {
    content += `  "${d}",\n`;
  });
  content += `]);\n\nexport const FOMC_DATES = new Set([\n`;
  
  sortedFomc.forEach((d: string) => {
    content += `  "${d}",\n`;
  });
  content += `]);\n\n`;
  
  content += `export function isHistoricalNews(dateStr: string): boolean {
  return (
    NFP_DATES.has(dateStr) ||
    CPI_DATES.has(dateStr) ||
    FOMC_DATES.has(dateStr)
  );
}

export function isNewsForceClose(dateStr: string, estHour: number, estMin: number): boolean {
  if (!isHistoricalNews(dateStr)) return false;
  // News blackout window (Live Engine parity): 8:00 AM - 2:30 PM EST
  if (estHour >= 8 && (estHour < 14 || (estHour === 14 && estMin <= 30))) {
    return true;
  }
  return false;
}
`;

  return content;
}

async function main() {
  const outPath = path.join(process.cwd(), "server", "trading", "market", "historicalNews.ts");
  
  // 1. Parse existing static history to ensure we NEVER lose or mutate past dates
  const existing = parseExistingDates(outPath);
  console.log(`📜 Parsed existing historicalNews.ts: ${existing.NFP.size} NFP, ${existing.CPI.size} CPI, ${existing.FOMC.size} FOMC dates.`);

  // 2. Fetch news dates only for the current year
  const currentYear = new Date().getFullYear();
  const data = await fetchHistoricalDates(currentYear, currentYear);
  if (!data || !data.NFP_DATES || !data.CPI_DATES || !data.FOMC_DATES) {
    console.error("⚠️ Invalid data received from Gemini after 3 retries. Skipping update to preserve existing historicalNews.ts.");
    process.exit(0);
  }

  // 3. Merge new current-year dates into existing sets (strictly current month only to avoid past/future hallucinations)
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const firstDayOfCurrentMonthStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const lastDayOfCurrentMonthStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  let addedNfp = 0, addedCpi = 0, addedFomc = 0;
  data.NFP_DATES.forEach((d: string) => {
    if (d >= firstDayOfCurrentMonthStr && d <= lastDayOfCurrentMonthStr) {
      if (!existing.NFP.has(d)) {
        existing.NFP.add(d);
        addedNfp++;
      }
    }
  });
  data.CPI_DATES.forEach((d: string) => {
    if (d >= firstDayOfCurrentMonthStr && d <= lastDayOfCurrentMonthStr) {
      if (!existing.CPI.has(d)) {
        existing.CPI.add(d);
        addedCpi++;
      }
    }
  });
  data.FOMC_DATES.forEach((d: string) => {
    if (d >= firstDayOfCurrentMonthStr && d <= lastDayOfCurrentMonthStr) {
      if (!existing.FOMC.has(d)) {
        existing.FOMC.add(d);
        addedFomc++;
      }
    }
  });

  console.log(`✅ Merged new dates: Added ${addedNfp} NFP, ${addedCpi} CPI, ${addedFomc} FOMC new dates.`);

  // 4. Generate and write merged file back
  const tsContent = generateTsFile(existing.NFP, existing.CPI, existing.FOMC);
  try {
    fs.writeFileSync(outPath, tsContent, "utf-8");
    console.log(`✅ Successfully wrote merged news dates to ${outPath}`);
  } catch (err: any) {
    console.warn(`⚠️ Could not overwrite historicalNews.ts due to file handle lock (${err.message}).`);
  }
}

main().catch((e) => {
  console.warn("⚠️ Historical news fetch skipped:", e.message);
  process.exit(0);
});
