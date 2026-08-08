import { runParityCheck } from "../server/trading/testing/parity/core_parity_engine.js";

async function main() {
  console.log("Running NAS100 parity check for April 1-2 2026...");
  await runParityCheck(
    "NAS100",
    "2026-04-01",
    "2026-04-02",
    { enableMage: true, enableSage: false, enableSeer: false },
    true // enableTrace
  );
}

main().catch(console.error);
