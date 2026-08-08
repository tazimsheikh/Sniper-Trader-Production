import * as fs from 'fs';

const logPath = 'C:/Users/tazim/.gemini/antigravity/brain/b2f5fb21-b306-4513-8cf6-5dacb6d1c255/.system_generated/tasks/task-29281.log';
if (!fs.existsSync(logPath)) {
    console.log("File not found:", logPath);
    process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');

for (const line of lines) {
    if (line.includes('2026-07-07')) {
        console.log(line);
    }
}
