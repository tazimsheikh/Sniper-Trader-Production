const fs = require('fs');
const path = require('path');

const dashPath = 'C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh\\src\\components\\AutomateDashboard.tsx';
let dashContent = fs.readFileSync(dashPath, 'utf8');

dashContent = dashContent.replace(/Platinum/g, 'Apex');
dashContent = dashContent.replace(/Advanced/g, 'Institutional');
dashContent = dashContent.replace(/Basic/g, 'Prop');
dashContent = dashContent.replace(/Free/g, 'Scout');

fs.writeFileSync(dashPath, dashContent, 'utf8');
console.log('Updated AutomateDashboard.tsx');

const ifacePath = 'C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh\\server\\bots\\BotInterface.ts';
let ifaceContent = fs.readFileSync(ifacePath, 'utf8');
ifaceContent = ifaceContent.replace(/'Free'\s*\|\s*'Basic'\s*\|\s*'Advanced'\s*\|\s*'Platinum'/g, "'Scout' | 'Prop' | 'Institutional' | 'Apex'");
fs.writeFileSync(ifacePath, ifaceContent, 'utf8');
console.log('Updated BotInterface.ts');

const extraBots = ['gbpusdNyFade.ts', 'usdjpyNyFade.ts'];
for (const b of extraBots) {
  const bPath = path.join('C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh\\server\\bots', b);
  let bContent = fs.readFileSync(bPath, 'utf8');
  bContent = bContent.replace(/tier:\s*'Platinum'/g, "tier: 'Apex'");
  fs.writeFileSync(bPath, bContent, 'utf8');
  console.log('Updated ' + b);
}
