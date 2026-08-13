import { isNewsForceClose } from '../../market/historicalNews.js';

function getFixedEstDate(date = new Date()) {
  if ((global as any).__SIM_TIME_PROVIDER__) {
    return (global as any).__SIM_TIME_PROVIDER__(date);
  }
  const y = date.getUTCFullYear();
  const marchFirst = new Date(Date.UTC(y, 2, 1));
  const daysToFirstSunday = (7 - marchFirst.getUTCDay()) % 7;
  const secondSundayMarch = new Date(Date.UTC(y, 2, 1 + daysToFirstSunday + 7, 7, 0, 0));
  const novFirst = new Date(Date.UTC(y, 10, 1));
  const daysToFirstSunNov = (7 - novFirst.getUTCDay()) % 7;
  const firstSundayNov = new Date(Date.UTC(y, 10, 1 + daysToFirstSunNov, 6, 0, 0));
  const t = date.getTime();
  const isDST = t >= secondSundayMarch.getTime() && t < firstSundayNov.getTime();
  const offsetHours = isDST ? -4 : -5;
  return new Date(t + offsetHours * 60 * 60 * 1000);
}

export function isNewsBlackout(_symbol: string, date: Date) {
  const estDate = getFixedEstDate(date);
  const dateStr = estDate.toISOString().split("T")[0];
  const estHour = estDate.getUTCHours();
  const minute = estDate.getUTCMinutes();
  const isBlocked = isNewsForceClose(dateStr, estHour, minute);

  return { blocked: isBlocked, reason: isBlocked ? "Macro News" : "" };
}

export default { isNewsBlackout };
