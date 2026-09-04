const fs = require('fs');
const content = fs.readFileSync('server/trading/engine/TickFeed.ts', 'utf8');

const match = content.match(/DiscretionaryTrader_PAIRS = \[([\s\S]*?)\];/);
if (match) {
  const pairs = match[1].match(/"([A-Z0-9]+)"/g).map(p => p.replace(/"/g, ''));
  console.log('--- TickFeed.ts DiscretionaryTrader_PAIRS ---');
  console.log('Total pairs:', pairs.length);
  console.log(pairs.join(', '));
  fs.writeFileSync('pairs.json', JSON.stringify(pairs));
}
