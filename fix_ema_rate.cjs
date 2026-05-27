/**
 * FIX BUG #2: EMA Rate Limiter
 * 
 * The EMA was being updated every 30s (polling interval) instead of once per M1 candle.
 * This caused the EMA to converge 2x faster than backtested, producing wrong trade directions.
 * 
 * Fix: Add a `lastEmaUpdateMinute` tracker to each bot. The EMA is only updated ONCE per
 * UTC minute, matching the M1 candle resolution used in backtests.
 */

const fs = require('fs');
const path = require('path');
const botsDir = 'C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh\\server\\bots';

const botFiles = fs.readdirSync(botsDir).filter(f => f.endsWith('.ts') && f !== 'BotInterface.ts' && f !== 'oldIsGold.ts');

let updatedCount = 0;

for (const file of botFiles) {
  const filePath = path.join(botsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Only patch files that use the EMA pattern
  if (!content.includes('emaLoaded') || !content.includes('EMA_PERIOD')) {
    console.log(`Skipping ${file} (no EMA pattern)`);
    continue;
  }

  // Check if already patched
  if (content.includes('lastEmaUpdateMinute')) {
    console.log(`Skipping ${file} (already patched)`);
    continue;
  }

  // 1. Add lastEmaUpdateMinute field after emaLoaded
  content = content.replace(
    /private emaLoaded: boolean = false;/,
    `private emaLoaded: boolean = false;\n  private lastEmaUpdateMinute: number = -1; // BUG FIX #2: rate-limit EMA to once per M1 candle`
  );

  // 2. Replace the EMA update block to add rate limiting
  // Pattern: else { const alpha = ... this.htfEma = ... saveEmaState ... }
  content = content.replace(
    /} else \{\s*const alpha = 2 \/ \(this\.EMA_PERIOD \+ 1\);\s*this\.htfEma = currentPrice \* alpha \+ this\.htfEma \* \(1 - alpha\);\s*saveEmaState\(this\.config\.id, this\.htfEma\);\s*\}/,
    `} else {\n      // BUG FIX #2: Only update EMA once per UTC minute (matches M1 candle resolution used in backtest)\n      const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();\n      if (currentMinute !== this.lastEmaUpdateMinute) {\n        const alpha = 2 / (this.EMA_PERIOD + 1);\n        this.htfEma = currentPrice * alpha + this.htfEma * (1 - alpha);\n        saveEmaState(this.config.id, this.htfEma);\n        this.lastEmaUpdateMinute = currentMinute;\n      }\n    }`
  );

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Patched ${file}`);
  updatedCount++;
}

console.log(`\nDone. Updated ${updatedCount} bot files.`);
