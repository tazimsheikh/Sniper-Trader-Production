import * as fs from 'fs';
const file = fs.readFileSync('data/csv/NAS100.Daily_M1.csv', 'utf8');
const lines = file.split('\n');
const apr16 = lines.filter(l => l.includes('2026.04.16'));

let high = -Infinity;
let low = Infinity;

for (const line of apr16) {
    const time = line.split('\t')[1];
    if (time >= '15:00:00' && time < '15:45:00') {
        const parts = line.split('\t');
        const h = parseFloat(parts[3]);
        const l = parseFloat(parts[4]);
        if (h > high) high = h;
        if (l < low) low = l;
    }
}
console.log('ORB High:', high, 'ORB Low:', low, 'orPips:', (high - low).toFixed(1));
