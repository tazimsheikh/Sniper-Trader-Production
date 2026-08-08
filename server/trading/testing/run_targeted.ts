import { runParityCheck } from "./core_parity_engine.js";

async function main() {
    const start = "2026-07-01";
    const end = "2026-07-31";

    console.log("Running Targeted Parity Check...");
    let mPass = await runParityCheck("MAGE", "NAS100", start, end, "targeted_parity_report.txt");
    console.log(`MAGE NAS100: ${mPass ? "PASS" : "FAIL"}`);

    let sPass = await runParityCheck("SAGE", "EURNZD", start, end, "targeted_parity_report.txt");
    console.log(`SAGE EURNZD: ${sPass ? "PASS" : "FAIL"}`);
}

main().catch(console.error);
