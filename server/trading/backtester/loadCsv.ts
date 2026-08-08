import * as fs from "fs";
import * as readline from "readline";

import { M1Row } from "../config/types.js";

const helsinkiFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Helsinki",
  hour: "numeric",
  hour12: false,
});
const estFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hour12: false,
});

const csvCache = new Map<string, M1Row[]>();

export async function loadCsv(
  csvPath: string,
  maxSpreadPips: number,
  startDate?: Date,
  endDate?: Date,
): Promise<M1Row[]> {
  for (const key of Array.from(csvCache.keys())) {
    if (!key.startsWith(csvPath)) {
      csvCache.delete(key);
    }
  }

  const cacheKey = `${csvPath}_${maxSpreadPips}_${startDate?.getTime() || ""}_${endDate?.getTime() || ""}`;
  if (csvCache.has(cacheKey)) {
    return csvCache.get(cacheKey)!;
  }

  const rows: M1Row[] = [];
  const stream = fs.createReadStream(csvPath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let currentCachedDateStr = "";
  let currentEetOffsetHours = 2;
  let currentEstOffsetHours = -7;

  for await (const line of rl) {
    if (line.startsWith("<") || line.trim() === "") continue;
    let parts = line.split("\t");
    if (parts.length < 6) {
      parts = line.split(",");
    }
    if (parts.length < 6) {
      parts = line.split(";");
    }
    if (parts.length < 6) continue;

    if (
      isNaN(parseFloat(parts[2])) ||
      isNaN(parseFloat(parts[3])) ||
      isNaN(parseFloat(parts[4])) ||
      isNaN(parseFloat(parts[5]))
    ) {
      continue;
    }

    const dateStr = parts[0].replace(/\./g, "-");
    const timeStr = parts[1];
    const timeParts = timeStr.split(":");
    const hour = parseInt(timeParts[0]);
    const minute = parseInt(timeParts[1]);
    const month = parseInt(dateStr.split("-")[1]);
    const yr = parseInt(dateStr.split("-")[0]);
    const dy = parseInt(dateStr.split("-")[2]);

    if (dateStr !== currentCachedDateStr) {
      currentCachedDateStr = dateStr;
      // Calculate true offset at 12:00 PM broker time to avoid midnight DST transition edge cases
      const guessMs = Date.UTC(yr, month - 1, dy, 12, 0, 0);

      const parts = helsinkiFmt.formatToParts(new Date(guessMs));
      let formattedHour = parseInt(
        parts.find((p) => p.type === "hour")!.value,
        10,
      );
      if (formattedHour === 24) formattedHour = 0;
      let eetDiff = formattedHour - 12;
      if (eetDiff < -12) eetDiff += 24;
      if (eetDiff > 12) eetDiff -= 24;

      currentEetOffsetHours = eetDiff;

      const estParts = estFmt.formatToParts(new Date(guessMs));
      let estFormattedHour = parseInt(
        estParts.find((p) => p.type === "hour")!.value,
        10,
      );
      if (estFormattedHour === 24) estFormattedHour = 0;
      let nyDiff = estFormattedHour - 12;
      if (nyDiff < -12) nyDiff += 24;
      if (nyDiff > 12) nyDiff -= 24;

      currentEstOffsetHours = nyDiff;
    }

    const tsMs = Date.UTC(
      yr,
      month - 1,
      dy,
      hour - currentEetOffsetHours,
      minute,
    );

    if (startDate && tsMs < startDate.getTime()) continue;
    if (endDate && tsMs > endDate.getTime()) continue;

    const spread = parseInt(parts[8] || "15") / 10;

    const dow = new Date(tsMs).getUTCDay();

    const timestamp = tsMs;
    let estHour = hour - currentEetOffsetHours + currentEstOffsetHours;
    if (estHour < 0) estHour += 24;
    if (estHour >= 24) estHour -= 24;

    rows.push({
      dateStr,
      hour,
      minute,
      utcMonth: month,
      dow,
      open: parseFloat(parts[2]),
      high: parseFloat(parts[3]),
      low: parseFloat(parts[4]),
      close: parseFloat(parts[5]),
      tickVol: parseInt(parts[6]) || 1,
      spread,
      timestamp,
      estHour,
    });
  }
  csvCache.set(cacheKey, rows);
  return rows;
}

export function getLatestDate(csvPath: string): Date {
  const fd = fs.openSync(csvPath, "r");
  const stat = fs.fstatSync(fd);
  const chunkSize = Math.min(stat.size, 2048);
  const buffer = Buffer.alloc(chunkSize);
  fs.readSync(fd, buffer, 0, chunkSize, stat.size - chunkSize);
  fs.closeSync(fd);
  const content = buffer.toString("utf-8").trim();
  const lines = content.split("\n");
  const lastLine = lines[lines.length - 1];
  let parts = lastLine.indexOf('\t') !== -1 ? lastLine.split('\t') : lastLine.split(',');
  if (parts.length > 1) {
    let datePart = parts[0];
    let timePart = parts[1];
    let dateStr = "";
    if (lastLine.indexOf('\t') !== -1) {
       dateStr = datePart.replace(/\./g, "-") + "T" + timePart + "Z";
    } else {
       dateStr = datePart.replace(/\./g, "-").replace(" ", "T") + "Z";
    }
    return new Date(dateStr);
  }
  return new Date(); // fallback
}
