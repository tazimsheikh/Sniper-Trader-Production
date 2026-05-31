import fs from 'fs';

let botContent = fs.readFileSync('server/botManager.ts', 'utf8');

// Make them async
botContent = botContent.replace(/function markT1Hit\(/g, 'async function markT1Hit(');

// Await the calls
botContent = botContent.replace(/updateTradeSl\(/g, 'await updateTradeSl(');
botContent = botContent.replace(/updateTradeTp\(/g, 'await updateTradeTp(');
botContent = botContent.replace(/updateTradeEntry\(/g, 'await updateTradeEntry(');
botContent = botContent.replace(/markT1Hit\(/g, 'await markT1Hit(');

fs.writeFileSync('server/botManager.ts', botContent, 'utf8');
