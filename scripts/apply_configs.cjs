const fs = require('fs');
const path = require('path');

const optimalConfigs = JSON.parse(fs.readFileSync(path.join(__dirname, '../optimal_forex_configs.json'), 'utf-8'));

// 1. Update gen_bots.cjs
const genBotsPath = path.join(__dirname, 'gen_bots.cjs');
let genBotsContent = fs.readFileSync(genBotsPath, 'utf-8');

// Sort configs by score descending
optimalConfigs.sort((a, b) => b.bestResult.score - a.bestResult.score);

const optimalArrayStr = 'const optimal = [\n' + optimalConfigs.map((c, index) => {
  const d = c.bestResult;
  let name = c.pair + (d.hr >= 12 ? ' Ny Fade' : ' London Fade');
  let tier = 'Scout';
  if (index < 4) tier = 'Apex';
  else if (index < 8) tier = 'Institutional';
  else if (index < 12) tier = 'Prop';
  
  return `  { "pair": "${c.pair}", "name": "${name}", "hr": ${d.hr}, "min": ${d.min}, "sl": ${d.sl}, "tp": ${d.tp}, "ret": "${d.profit.toFixed(1)}", "wr": ${d.winRate.toFixed(1)}, "dd": ${d.maxDD.toFixed(1)}, "tier": "${tier}" }`;
}).join(',\n') + '\n];';

genBotsContent = genBotsContent.replace(/const optimal = \[[\s\S]*?\];/, optimalArrayStr);
fs.writeFileSync(genBotsPath, genBotsContent);
console.log('Updated gen_bots.cjs');

// 2. Update SniperSystemAI.ts
const sniperPath = path.join(__dirname, '../server/bots/SniperSystemAI.ts');
let sniperContent = fs.readFileSync(sniperPath, 'utf-8');

const sniperConfigStr = 'const OPTIMAL_CONFIGS: Record<string, any> = {\n' + optimalConfigs.map(c => {
  const d = c.bestResult;
  return `  "${c.pair}": { "hr": ${d.hr}, "min": ${d.min}, "reverse": ${d.reverse}, "sl": ${d.sl}, "tp": ${d.tp}, "ema": ${d.emaPeriod}, "breakeven": ${d.breakeven}, "manualCloseHrs": ${d.manualCloseHrs}, "confirmation": "${d.confirmation}" }`;
}).join(',\n') + '\n};';

sniperContent = sniperContent.replace(/const OPTIMAL_CONFIGS: Record<string, any> = \{[\s\S]*?\};/, sniperConfigStr);

// I also need to update SniperSystemAI.ts to use the specific ema for each pair!
sniperContent = sniperContent.replace(/private htfEma: Record<string, number> = \{\};[\s\S]*?private readonly EMA_PERIOD = 240;/, 'private htfEma: Record<string, number> = {};');

// Update generateSignal logic
const newLogic = `
    if (!this.htfEma[brokerSymbol]) {
      this.htfEma[brokerSymbol] = currentPrice;
    } else {
      const alpha = 2 / (c.ema + 1);
      this.htfEma[brokerSymbol] = currentPrice * alpha + this.htfEma[brokerSymbol] * (1 - alpha);
    }
`;
sniperContent = sniperContent.replace(/if \(\!this\.htfEma\[brokerSymbol\]\) \{[\s\S]*?this\.htfEma\[brokerSymbol\] \* \(1 \- alpha\);\n    \}/, newLogic.trim());

fs.writeFileSync(sniperPath, sniperContent);
console.log('Updated SniperSystemAI.ts');
