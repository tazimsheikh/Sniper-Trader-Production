import fs from 'fs';
import path from 'path';

const filesToRefactor = [
  'server.ts',
  'server/auth.ts',
  'server/botManager.ts',
  'server/candleProvider.ts',
  'server/metaApiHandler.ts',
  'server/settings.ts',
  'server/tradeManager.ts'
];

for (const file of filesToRefactor) {
  const filePath = path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace db.prepare(...).get/all/run(...) with await db.prepare(...).get/all/run(...)
  // We match until the end of the method call. 
  // Be careful not to replace already awaited ones.
  content = content.replace(/(?<!await\s)db\.prepare\(/g, 'await db.prepare(');
  
  // Also we have db.exec(...) which should be await db.exec(...)
  content = content.replace(/(?<!await\s)db\.exec\(/g, 'await db.exec(');

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Refactored ${file}`);
}
