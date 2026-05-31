import fs from 'fs';

let botContent = fs.readFileSync('server/botManager.ts', 'utf8');

// Make it async
botContent = botContent.replace(/function updateHighLow\(/g, 'async function updateHighLow(');

// Await the call
botContent = botContent.replace(/updateHighLow\(/g, 'await updateHighLow(');

fs.writeFileSync('server/botManager.ts', botContent, 'utf8');
