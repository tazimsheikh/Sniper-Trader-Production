import fs from 'fs';

function replaceInFile(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content, 'utf8');
}

replaceInFile('server/settings.ts', "settingsRouter.delete('/account', requireAuth, (req: AuthRequest, res: Response) => {", "settingsRouter.delete('/account', requireAuth, async (req: AuthRequest, res: Response) => {");
replaceInFile('server/auth.ts', "authRouter.delete('/profiles/:id', requireAuth, (req: AuthRequest, res) => {", "authRouter.delete('/profiles/:id', requireAuth, async (req: AuthRequest, res) => {");
replaceInFile('server/botManager.ts', "function hasAnyOpenTradeOnSymbol(profileId: number, brokerSymbol: string): boolean {", "async function hasAnyOpenTradeOnSymbol(profileId: number, brokerSymbol: string): Promise<boolean> {");

let botContent = fs.readFileSync('server/botManager.ts', 'utf8');
botContent = botContent.replace(/if \(\!hasAnyOpenTradeOnSymbol/g, 'if (!(await hasAnyOpenTradeOnSymbol)');
fs.writeFileSync('server/botManager.ts', botContent, 'utf8');
