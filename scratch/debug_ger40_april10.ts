import { runMathBacktest } from "../server/trading/backtester/MageMathBacktester";

async function main() {
  const d1 = "2026-04-09";
  const d2 = "2026-04-09";
  const evalRes = await runMathBacktest("GER40", d1, d2);
  for (const t of evalRes.records) {
    console.log(`[T1] ${t.date} | EntryTime: ${new Date(t.entryTimeMs).toISOString()} | ExitTime: ${new Date(t.exitTimeMs).toISOString()} | Outcome: ${t.outcome} | R: ${t.rMultiple}`);
  }
}
main().catch(console.error);
