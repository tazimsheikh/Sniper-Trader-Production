import { isNewsForceClose } from '../../market/historicalNews.js';

function getFixedEstDate(date = new Date()) {
  if ((global as any).__SIM_TIME_PROVIDER__) return (global as any).__SIM_TIME_PROVIDER__(date);
  const estStr = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(estStr + " UTC");
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
