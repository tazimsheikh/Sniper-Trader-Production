import fs from 'fs';

function replaceInFile(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content, 'utf8');
}

replaceInFile('server/settings.ts', "router.get('/keys', requireAuth, (req: AuthRequest, res) => {", "router.get('/keys', requireAuth, async (req: AuthRequest, res) => {");
replaceInFile('server/auth.ts', "authRouter.get('/profiles', requireAuth, (req: AuthRequest, res) => {", "authRouter.get('/profiles', requireAuth, async (req: AuthRequest, res) => {");
replaceInFile('server/botManager.ts', "export function ensureBotSchema() {", "export async function ensureBotSchema() {");

let botContent = fs.readFileSync('server/botManager.ts', 'utf8');
botContent = botContent.replace(/ensureBotSchema\(\);/g, 'await ensureBotSchema();');
fs.writeFileSync('server/botManager.ts', botContent, 'utf8');
