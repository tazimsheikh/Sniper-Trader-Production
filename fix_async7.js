import fs from 'fs';

function replaceInFile(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content, 'utf8');
}

replaceInFile('server/auth.ts', "authRouter.post('/profiles/:id/diary/reset', requireAuth, (req: AuthRequest, res: Response) => {", "authRouter.post('/profiles/:id/diary/reset', requireAuth, async (req: AuthRequest, res: Response) => {");

replaceInFile('server/botManager.ts', "export function logToDiary(", "export async function logToDiary(");

let botContent = fs.readFileSync('server/botManager.ts', 'utf8');
botContent = botContent.replace(/logToDiary\(/g, 'await logToDiary(');
fs.writeFileSync('server/botManager.ts', botContent, 'utf8');

let tradeContent = fs.readFileSync('server/tradeManager.ts', 'utf8');
tradeContent = tradeContent.replace(/logToDiary\(/g, 'await logToDiary(');
fs.writeFileSync('server/tradeManager.ts', tradeContent, 'utf8');
