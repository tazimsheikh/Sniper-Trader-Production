const fs = require('fs');
const path = require('path');
const currDir = 'server/trading/optimizer/mage/mage_optimizer_dump';
const prevDir = path.join(currDir, 'last_optimization_run');

const pairs = fs.readdirSync(currDir)
  .filter(f => f.startsWith('state_') && f.endsWith('.json'))
  .map(f => f.replace('state_', '').replace('.json', ''));

let out = [];

for (let p of pairs) {
  try {
    const currData = JSON.parse(fs.readFileSync(path.join(currDir, `state_${p}.json`)));
    const prevData = JSON.parse(fs.readFileSync(path.join(prevDir, `state_${p}.json`)));
    
    const currBest = currData.reduce((max, c) => c.totalNetR > max.totalNetR ? c : max, currData[0]);
    const prevBest = prevData.reduce((max, c) => c.totalNetR > max.totalNetR ? c : max, prevData[0]);
    
    out.push({
      Pair: p,
      PrevNetR: parseFloat(prevBest.totalNetR.toFixed(2)),
      CurrNetR: parseFloat(currBest.totalNetR.toFixed(2)),
      Diff: parseFloat((currBest.totalNetR - prevBest.totalNetR).toFixed(2)),
      PrevTrades: prevBest.trades,
      CurrTrades: currBest.trades
    });
  } catch(e) {
    // skip if file doesn't exist in prev
  }
}

out.sort((a,b) => b.Diff - a.Diff);
console.table(out);
