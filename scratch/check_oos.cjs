const fs = require('fs');
const data = JSON.parse(fs.readFileSync('server/trading/optimizer/mage/mage_optimizer_dump/wfa_EURUSD.json', 'utf8'));
data.slice(0, 10).forEach((p, i) => {
  console.log(`Config ${i+1}: Train R: ${p.inSample.netR.toFixed(2)}, Test R: ${p.outOfSample.netR.toFixed(2)}, Sig: ${p.params}`);
});
