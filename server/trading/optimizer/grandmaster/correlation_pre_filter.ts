/**
 * 🔗 Correlation Pre-Filter
 * Groups trading pairs by currency cluster and caps cluster representation
 * before grandmaster synthesis to prevent correlated signal crowding.
 */

export interface AlphaItem {
  setup?: string;
  symbol?: string;
  totalNetR?: number;
  [key: string]: any;
}

export function extractCurrencies(symbol: string): string[] {
  const clean = symbol.replace(".Daily", "").toUpperCase();
  const currencies: string[] = [];
  const known = ["EUR", "GBP", "USD", "JPY", "AUD", "CAD", "NZD", "CHF", "XAU", "BTC", "ETH", "US30", "NAS100", "GER40"];

  for (const c of known) {
    if (clean.includes(c)) {
      currencies.push(c);
    }
  }
  return currencies;
}

export function filterCorrelatedClusters<T extends AlphaItem>(
  alphas: T[],
  maxClusterPct: number = 0.40
): T[] {
  if (!alphas || alphas.length === 0) return [];

  const maxPerCluster = Math.ceil(alphas.length * maxClusterPct);
  const clusterCounts: Record<string, number> = {};
  const filtered: T[] = [];

  for (const alpha of alphas) {
    const symbol = alpha.symbol || "";
    const currencies = extractCurrencies(symbol);
    let overLimit = false;

    for (const curr of currencies) {
      if ((clusterCounts[curr] || 0) >= maxPerCluster) {
        overLimit = true;
        break;
      }
    }

    if (!overLimit) {
      filtered.push(alpha);
      for (const curr of currencies) {
        clusterCounts[curr] = (clusterCounts[curr] || 0) + 1;
      }
    }
  }

  return filtered;
}
