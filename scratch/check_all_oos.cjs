const fs = require('fs');
const path = require('path');
const dumpDir = 'server/trading/optimizer/mage/mage_optimizer_dump';
const files = fs.readdirSync(dumpDir).filter(f => f.startsWith('wfa_') && f.endsWith('.json'));

console.log('=== OVERALL WFA OOS PERFORMANCE BY SYMBOL ===');
let totalIS = 0;
let totalOOS = 0;

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(dumpDir, file), 'utf8'));
  let symbolIS = 0;
  let symbolOOS = 0;
  // If data is an array (the raw WFA windows), aggregate them
  if (Array.isArray(data)) {
     // A typical wfa file for an optimizer run might store all window results or just top portfolios
     // Actually, a WFA dump might contain multiple configs. 
     // Let's just look at the BEST config overall? 
     // Wait, the data array contains objects with 'inSample' and 'outOfSample'.
     // For a true Walk-Forward, the OOS performance of the system is the SUM of the OOS windows for the chosen config per window.
     // But wait, the file seems to just be a list of "top configs" where each has trainNetR/testNetR?
     // In the array `[ { windowIndex: 0, session: 'asia', inSample: { netR: 42 }, outOfSample: { netR: -2 }, params: '...' } ]`,
     // this looks like the results of evaluating specific configs.
     // Wait, if it has `windowIndex: 0`, does it have `windowIndex: 1`, `windowIndex: 2`?
     // Let's print out how many windows there are per config.
     console.log(`\nFile: ${file}`);
     const windows = new Set(data.map(d => d.windowIndex));
     console.log(`Windows: ${[...windows].join(', ')}`);
     const topPerWindow = {};
     for (const w of windows) {
        const forWin = data.filter(d => d.windowIndex === w);
        const best = forWin.reduce((prev, curr) => (prev.inSample.netR > curr.inSample.netR) ? prev : curr);
        console.log(`  Window ${w}: IS = ${best.inSample.netR.toFixed(2)} R, OOS = ${best.outOfSample.netR.toFixed(2)} R | Sig: ${best.params}`);
        symbolIS += best.inSample.netR;
        symbolOOS += best.outOfSample.netR;
     }
     console.log(`  Total for ${file}: IS = ${symbolIS.toFixed(2)} R, OOS = ${symbolOOS.toFixed(2)} R`);
  }
}
