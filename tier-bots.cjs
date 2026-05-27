const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'server/bots');

const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'BotInterface.ts');

files.forEach(f => {
  let p = path.join(dir, f);
  let c = fs.readFileSync(p, 'utf8');
  
  if (c.includes('tier:')) return; // Already has tier

  let tier = 'Basic';
  if (f === 'oldIsGold.ts') {
    tier = 'Free';
  } else if (f.includes('jpy') || f.includes('chf')) {
    tier = 'Advanced';
  } else if (f.includes('aud') || f.includes('cad')) {
    tier = 'Basic';
  }
  
  // Distribute some to Platinum based on name
  if (f.includes('eurusd') || f.includes('gbpusd') || f.includes('usdjpy')) {
    tier = 'Platinum';
  }

  // Insert tier property after strategyType
  c = c.replace(/strategyType:\s*([^,]+),/g, `strategyType: $1,\n    tier: '${tier}',`);
  fs.writeFileSync(p, c);
  console.log('Tiered', f, 'as', tier);
});
