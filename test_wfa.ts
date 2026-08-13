import { WalkForwardEngine } from './server/trading/optimizer/core/WalkForwardEngine.js';

const m1 = { timestamp: [] as number[], open: new Float64Array(), high: new Float64Array(), low: new Float64Array(), close: new Float64Array(), length: 0 };
let t = new Date('2023-08-01').getTime();
const end = new Date('2026-08-01').getTime();
while (t < end) {
  m1.timestamp.push(t);
  t += 60000; // 1 min steps
}
m1.length = m1.timestamp.length;

// @ts-ignore
WalkForwardEngine.findIndex = (arr, val) => arr.findIndex(x => x >= val);

const windows = WalkForwardEngine.generateWindows(m1 as any);
console.log(`Generated ${windows.length} windows`);
for (const w of windows) {
  console.log(`Window ${w.windowIndex}: IS: ${w.inSampleStart.toISOString()} -> ${w.inSampleEnd.toISOString()} | OOS: ${w.outOfSampleStart.toISOString()} -> ${w.outOfSampleEnd.toISOString()}`);
}
