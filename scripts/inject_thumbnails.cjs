const fs = require('fs');
const path = require('path');

const botsDir = path.join(__dirname, '..', 'server', 'bots');
const files = fs.readdirSync(botsDir).filter(f => f.endsWith('.ts') && f !== 'BotInterface.ts');

files.forEach(file => {
  const filePath = path.join(botsDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  
  let thumb = 'bot_usd.png';
  if (file === 'oldIsGold.ts') thumb = 'bot_gold.png';
  else if (file.toLowerCase().includes('eur')) thumb = 'bot_eur.png';
  else if (file.toLowerCase().includes('gbp')) thumb = 'bot_gbp.png';
  else if (file.toLowerCase().includes('aud') || file.toLowerCase().includes('nzd')) thumb = 'bot_aud.png';
  else if (file.toLowerCase().includes('jpy')) thumb = 'bot_jpy.png';
  else thumb = 'bot_usd.png'; // Catch all for usd

  if (!content.includes('thumbnailUrl')) {
    content = content.replace(
      /(maxDDBacktest: [0-9.]+)/,
      `$1,\n    thumbnailUrl: '/thumbnails/${thumb}'`
    );
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${file} with ${thumb}`);
  }
});
