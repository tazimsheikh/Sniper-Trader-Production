import fs from 'fs';
import path from 'path';

function findFile(dir, targetName) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        findFile(fullPath, targetName);
      }
    } else {
      if (file.toLowerCase() === targetName.toLowerCase()) {
        console.log(`Found file at: ${fullPath}`);
      }
    }
  }
}

findFile(process.cwd(), 'simulationProvider.ts');
