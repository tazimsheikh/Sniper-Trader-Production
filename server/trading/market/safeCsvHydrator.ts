import * as fs from "fs";
import * as readline from "readline";

const helsinkiFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatToEetLine(c: any): string {
  const cTime = new Date(c.time);
  const parts = helsinkiFmt.formatToParts(cTime);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  let hour = getPart("hour");
  if (hour === "24") hour = "00";
  const minute = getPart("minute");
  const datePart = `${year}.${month}.${day}`;
  const timePart = `${hour}:${minute}`;
  return `${datePart}\t${timePart}\t${c.open}\t${c.high}\t${c.low}\t${c.close}\t${c.tickVolume || c.volume || 1}\t0\t${c.spread || 15}`;
}

export function ensureTrailingNewline(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const fd = fs.openSync(filePath, "r");
  const stat = fs.fstatSync(fd);
  if (stat.size === 0) {
    fs.closeSync(fd);
    return false;
  }
  const readSize = Math.min(stat.size, 64);
  const buffer = Buffer.alloc(readSize);
  fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
  fs.closeSync(fd);

  const str = buffer.toString("utf-8");
  const lastChar = str[str.length - 1];
  return lastChar === "\n" || lastChar === "\r";
}

export async function appendCandlesSafely(filePath: string, candles: any[]): Promise<number> {
  if (!candles || candles.length === 0) return 0;

  candles.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const newLines: string[] = [];
  const seenTimes = new Set<number>();
  for (const c of candles) {
    const ts = new Date(c.time).getTime();
    if (!seenTimes.has(ts)) {
      seenTimes.add(ts);
      newLines.push(formatToEetLine(c));
    }
  }

  if (newLines.length === 0) return 0;

  const hasNewline = ensureTrailingNewline(filePath);
  let appendStr = newLines.join("\n") + "\n";
  if (!hasNewline && fs.existsSync(filePath)) {
    appendStr = "\n" + appendStr;
  }

  fs.appendFileSync(filePath, appendStr, "utf-8");

  await verifyAndSortIfCorrupted(filePath);
  return newLines.length;
}

export async function verifyAndSortIfCorrupted(filePath: string): Promise<boolean> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lastTs = -1;
  let hasInversion = false;
  let hasJoinedLine = false;

  for await (const line of rl) {
    if (!line || line.startsWith("<")) continue;
    if (line.match(/\d{4}\.\d{2}\.\d{2}.+\d{4}\.\d{2}\.\d{2}/)) {
      hasJoinedLine = true;
      break;
    }
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const dateStr = parts[0].replace(/\./g, "-");
    const timeStr = parts[1];
    const ts = new Date(`${dateStr}T${timeStr}:00Z`).getTime();
    if (!isNaN(ts)) {
      if (lastTs !== -1 && ts < lastTs) {
        hasInversion = true;
        break;
      }
      lastTs = ts;
    }
  }

  if (!hasInversion && !hasJoinedLine) {
    return true;
  }

  console.warn(`⚠️ Anomaly detected in ${filePath} (Inversion: ${hasInversion}, JoinedLine: ${hasJoinedLine}). Running auto-repair sort...`);

  const repairStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const repairRl = readline.createInterface({ input: repairStream, crlfDelay: Infinity });
  const rows: Array<{ ts: number; line: string }> = [];
  let header = "";

  for await (const line of repairRl) {
    if (!line) continue;
    if (line.startsWith("<")) {
      header = line;
      continue;
    }
    if (line.match(/\d{4}\.\d{2}\.\d{2}.+\d{4}\.\d{2}\.\d{2}/)) {
      const match = line.match(/^(.+?\t\d+\t\d+\t)(\d+)(2026\.\d{2}\.\d{2}\t.+)$/);
      if (match) {
        const line1 = match[1] + match[2];
        const line2 = match[3];
        [line1, line2].forEach((l) => {
          const p = l.split("\t");
          const ts = new Date(`${p[0].replace(/\./g, "-")}T${p[1]}:00Z`).getTime();
          if (!isNaN(ts)) rows.push({ ts, line: l });
        });
        continue;
      }
    }
    const p = line.split("\t");
    if (p.length >= 2) {
      const ts = new Date(`${p[0].replace(/\./g, "-")}T${p[1]}:00Z`).getTime();
      if (!isNaN(ts)) rows.push({ ts, line });
    }
  }

  rows.sort((a, b) => a.ts - b.ts);
  const deduped: Array<{ ts: number; line: string }> = [];
  let prevTs = -1;
  for (const r of rows) {
    if (r.ts !== prevTs) {
      deduped.push(r);
      prevTs = r.ts;
    }
  }

  const tmpPath = `${filePath}.repaired.tmp`;
  const out = fs.createWriteStream(tmpPath, { encoding: "utf-8" });
  if (header) out.write(header + "\n");
  for (const r of deduped) {
    out.write(r.line + "\n");
  }
  out.end();
  await new Promise<void>((resolve) => out.on("finish", () => resolve()));

  fs.unlinkSync(filePath);
  fs.renameSync(tmpPath, filePath);
  console.log(`✅ ${filePath} permanently auto-repaired and sorted (${deduped.length} rows).`);
  return true;
}
