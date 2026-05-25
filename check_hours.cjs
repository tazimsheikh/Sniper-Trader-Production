const fs = require('fs');
const readline = require('readline');
const hourStats = {};

const stream = fs.createReadStream('./data/XAUUSD_M1_202405010100_202605010159.csv');
const rl = readline.createInterface({ input: stream });

rl.on('line', (line) => {
  const parts = line.split('\t');
  if (parts.length < 6 || parts[0] === '<DATE>') return;
  const [dateStr, timeStr, open, high, low, close] = parts;
  const hour = parseInt(timeStr.split(':')[0]);
  const body = Math.abs(parseFloat(close) - parseFloat(open));
  if (!hourStats[hour]) hourStats[hour] = { count: 0, totalBody: 0, bigBodies: 0 };
  hourStats[hour].count++;
  hourStats[hour].totalBody += body;
  if (body > 0.30) hourStats[hour].bigBodies++;
});

rl.on('close', () => {
  console.log('Hour(broker) | AvgBody(pips) | BigBodyCount(>30p) | Volume(candles)');
  for (let h = 0; h <= 23; h++) {
    const s = hourStats[h];
    if (!s) continue;
    const avg = (s.totalBody / s.count / 0.01).toFixed(1);
    const line = String(h).padStart(2, '0') + ':00  |  ' + avg + '  |  ' + s.bigBodies + '  |  ' + s.count;
    console.log(line);
  }
});
