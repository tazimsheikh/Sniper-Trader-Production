const fs = require('fs');
const path = require('path');

const botsDir = path.join(__dirname, 'server', 'bots');
const files = fs.readdirSync(botsDir).filter(f => f.endsWith('.ts') && f !== 'BotInterface.ts' && f !== 'SniperSystemAI.ts' && f !== 'oldIsGold.ts');

files.forEach(file => {
  const filePath = path.join(botsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace `name: 'XXXXXX London Fade'` with `name: 'XXXXXX'`
  content = content.replace(/name:\s*'([A-Z0-9]+)\s+(Ny|London|Asia|Tokyo)\s+Fade'/g, "name: '$1'");
  
  fs.writeFileSync(filePath, content);
});

console.log('Bots renamed successfully!');
