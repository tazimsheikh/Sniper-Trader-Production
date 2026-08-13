import * as fs from 'fs';

function parseMt5Date(dateStr, timeStr) {
    const [year, month, day] = dateStr.split('.');
    const [hour, min, sec] = timeStr.split(':');
    const eetDateStr = year + "-" + month + "-" + day + "T" + hour + ":" + min + ":" + sec + ".000";
    let dateObj = new Date(eetDateStr + "+02:00");
    if (month > '03' && month < '11') {
      dateObj = new Date(eetDateStr + "+03:00");
    }
    return dateObj.getTime();
}

const ts = parseMt5Date('2026.04.16', '17:30:00');
console.log('17:30 EET is timestamp:', ts, 'ISO:', new Date(ts).toISOString());
