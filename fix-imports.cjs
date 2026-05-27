const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'server/bots');

fs.readdirSync(dir).filter(f => f.endsWith('Fade.ts')).forEach(f => {
  let p = path.join(dir, f);
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace(/from '\.\.\/botManager\.js';/g, "from '../db.js';");
  fs.writeFileSync(p, c);
  console.log('Fixed', f);
});
