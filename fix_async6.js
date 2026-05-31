import fs from 'fs';

function replaceInFile(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content, 'utf8');
}

replaceInFile('server/settings.ts', "settingsRouter.post('/safety', requireAuth, (req: AuthRequest, res: Response) => {", "settingsRouter.post('/safety', requireAuth, async (req: AuthRequest, res: Response) => {");
replaceInFile('server/auth.ts', "authRouter.get('/profiles/:id/bots', requireAuth, (req: AuthRequest, res: Response) => {", "authRouter.get('/profiles/:id/bots', requireAuth, async (req: AuthRequest, res: Response) => {");

replaceInFile('server/botManager.ts', "export function closeTrade(metaOrderId: string, reason: string) {", "export async function closeTrade(metaOrderId: string, reason: string) {");

let botContent = fs.readFileSync('server/botManager.ts', 'utf8');
botContent = botContent.replace(/closeTrade\(/g, 'await closeTrade(');
fs.writeFileSync('server/botManager.ts', botContent, 'utf8');

let tradeContent = fs.readFileSync('server/tradeManager.ts', 'utf8');
tradeContent = tradeContent.replace(/closeTrade\(/g, 'await closeTrade(');
fs.writeFileSync('server/tradeManager.ts', tradeContent, 'utf8');
