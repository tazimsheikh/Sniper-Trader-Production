import fs from 'fs';

function replaceInFile(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content, 'utf8');
}

replaceInFile('server/settings.ts', "settingsRouter.get('/safety', requireAuth, (req: AuthRequest, res: Response) => {", "settingsRouter.get('/safety', requireAuth, async (req: AuthRequest, res: Response) => {");
replaceInFile('server/auth.ts', "authRouter.get('/profiles/:id/bots', requireAuth, (req: AuthRequest, res) => {", "authRouter.get('/profiles/:id/bots', requireAuth, async (req: AuthRequest, res) => {");
replaceInFile('server/botManager.ts', "export function saveTradeState(state: BotTradeState, orderId?: string) {", "export async function saveTradeState(state: BotTradeState, orderId?: string) {");

