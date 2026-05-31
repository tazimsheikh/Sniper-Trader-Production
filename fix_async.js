import fs from 'fs';

function replaceInFile(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content, 'utf8');
}

// Revert accidental addition in candleProvider.ts
let candleContent = fs.readFileSync('server/candleProvider.ts', 'utf8');
candleContent = candleContent.replace('export async function initBotManagerSchema() {\n  return BROKER_SYMBOL_MAP;\n}\n\n', '');
fs.writeFileSync('server/candleProvider.ts', candleContent, 'utf8');

// Fix actual signatures
replaceInFile('server/auth.ts', "authRouter.get('/me', requireAuth, (req: AuthRequest, res) => {", "authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {");
replaceInFile('server/botManager.ts', "export function initBotManagerSchema() {", "export async function initBotManagerSchema() {");
replaceInFile('server/settings.ts', "router.get('/keys', requireAuth, (req: AuthRequest, res: Response) => {", "router.get('/keys', requireAuth, async (req: AuthRequest, res: Response) => {");

// Now we need to find calls to getProviderForProfile and initBotManagerSchema and await them
let serverContent = fs.readFileSync('server.ts', 'utf8');
serverContent = serverContent.replace(/getProviderForProfile\(/g, 'await getProviderForProfile(');
fs.writeFileSync('server.ts', serverContent, 'utf8');

let botContent = fs.readFileSync('server/botManager.ts', 'utf8');
botContent = botContent.replace(/getProviderForProfile\(/g, 'await getProviderForProfile(');
fs.writeFileSync('server/botManager.ts', botContent, 'utf8');
