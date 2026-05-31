import fs from 'fs';

function replaceInFile(file, search, replacement) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content, 'utf8');
}

// botManager.ts
replaceInFile('server/botManager.ts', "export function getProfileActiveBots(profileId: number): string[] {", "export async function getProfileActiveBots(profileId: number): Promise<string[]> {");
replaceInFile('server/botManager.ts', "export function setProfileActiveBots(profileId: number, botIds: string[]) {", "export async function setProfileActiveBots(profileId: number, botIds: string[]) {");

// server.ts
let serverContent = fs.readFileSync('server.ts', 'utf8');
serverContent = serverContent.replace(/getProfileActiveBots\(/g, 'await getProfileActiveBots(');
fs.writeFileSync('server.ts', serverContent, 'utf8');

// auth.ts
let authContent = fs.readFileSync('server/auth.ts', 'utf8');
authContent = authContent.replace(/getProfileActiveBots\(/g, 'await getProfileActiveBots(');
authContent = authContent.replace(/setProfileActiveBots\(/g, 'await setProfileActiveBots(');
fs.writeFileSync('server/auth.ts', authContent, 'utf8');
