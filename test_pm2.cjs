const fs = require('fs');
const os = require('os');
const path = require('path');
const pm2Dir = path.join(os.homedir(), '.pm2', 'logs');
if (fs.existsSync(pm2Dir)) {
  const files = fs.readdirSync(pm2Dir);
  console.log('PM2 log files:', files);
} else {
  console.log('No PM2 logs found');
}
