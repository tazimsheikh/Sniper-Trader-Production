const fs = require('fs');
const path = require('path');

const optimalConfigs = JSON.parse(fs.readFileSync(path.join(__dirname, '../optimal_forex_configs.json'), 'utf-8'));

// Delete stray old files in server/bots/
const botsDir = path.join(__dirname, '../server/bots');
const existingFiles = fs.readdirSync(botsDir);

const newBotFiles = optimalConfigs.map(c => {
  const d = c.bestResult;
  let name = c.pair + (d.hr >= 12 ? ' Ny Fade' : ' London Fade');
  const className = name.replace(/ /g, '') + 'Bot';
  const id = name.toLowerCase().replace(/ /g, '-');
  const filename = name.split(' ')[0].toLowerCase() + name.split(' ')[1] + 'Fade.ts';
  return { filename, className, id };
});

const keepFiles = ['SniperSystemAI.ts', 'BotInterface.ts', ...newBotFiles.map(b => b.filename)];

existingFiles.forEach(f => {
  if (!keepFiles.includes(f) && f.endsWith('.ts')) {
    fs.unlinkSync(path.join(botsDir, f));
    console.log('Deleted old bot:', f);
  }
});

let botManagerContent = fs.readFileSync(path.join(__dirname, '../server/botManager.ts'), 'utf-8');

// Generate imports
const importLines = newBotFiles.map(b => `import ${b.className.replace('Bot', '')} from './bots/${b.filename.replace('.ts', '.js')}';`).join('\n');

// Replace imports block (from import SniperSystemAI to empty line)
const importRegex = /import SniperSystemAI from '\.\/bots\/SniperSystemAI\.js';[\s\S]*?(?=\n\n\/\/ @ts-ignore)/;
botManagerContent = botManagerContent.replace(importRegex, "import SniperSystemAI from './bots/SniperSystemAI.js';\n" + importLines);

// Generate BOT_REGISTRY
const registryLines = newBotFiles.map(b => `  '${b.id}': ${b.className.replace('Bot', '')},`).join('\n');

const registryRegex = /export const BOT_REGISTRY: Record<string, TradingBot> = \{[\s\S]*?'sniper-system-ai': SniperSystemAI,[\s\S]*?(?=\};\n)/;
botManagerContent = botManagerContent.replace(registryRegex, "export const BOT_REGISTRY: Record<string, TradingBot> = {\n  'sniper-system-ai': SniperSystemAI,\n" + registryLines + "\n");

fs.writeFileSync(path.join(__dirname, '../server/botManager.ts'), botManagerContent);
console.log('Successfully patched botManager.ts imports and registry!');
