# Project: Grandmaster Synthesizer Deep Analysis and Refactor

## Architecture
- **Synthesizer Core**: `server/trading/optimizer/grandmaster/`
  - `grandmaster_synthesizer.ts`: Main entry point for portfolio synthesis across optimizer dumps (Mage & Sage).
  - `GrandmasterGA.ts`: Genetic Algorithm engine for chromosome evolution, weight allocation, and constraint solving.
  - `GrandmasterPreProcessor.ts`: Ingests and standardizes dump candidates, filters toxic hours, processes IS/OOS metrics.
  - `GrandmasterMetrics.ts`: Computes portfolio Sharpe, Max Drawdown, Net R, correlation matrices, DCRP / risk parity allocation.
  - `grandmaster_cpcv.ts` / `grandmaster_plwfo.ts`: Combinatorial Purged Cross-Validation and Purged Walk-Forward Optimization.
  - `inject_grandmaster.ts`: Post-optimizer injection and live orchestrator config integration.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Grandmaster Pipeline & Dump Architecture Survey | Ingest Mage/Sage dumps, trace candidate filtering, and portfolio output formatting | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Post-Optimizer Toxic Hour Analysis | Trace how toxic hour filters are applied and their impact on candidate selection | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Root Cause of High-Efficiency OOS Config Rejections | Deeply analyze why high-efficiency configs (e.g. XAUUSD, low DD CHFJPY) are rejected | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Open-Source Portfolio Optimization & Sizing Research | Comprehensive web research on DCRP, HRP, CVaR, regime win rates, and OOS selection | M1 | ORIGINAL_REQUEST §R3 |
| 5 | Mathematical & Architectural Redesign Plan | Synthesize findings into optimal OOS-driven, regime-aware allocation framework | M2 | ORIGINAL_REQUEST §R2 |
| 6 | Automated Synthesizer Refactoring | Refactor `GrandmasterGA.ts`, `grandmaster_synthesizer.ts`, preprocessors, metrics | M3 | ORIGINAL_REQUEST §R2 |
| 7 | Portfolio Generation & Parity Execution | Execute refactored synthesizer, verify compilation, execution, and portfolio output | M4 | ORIGINAL_REQUEST Acceptance Criteria |
| 8 | Independent Multi-Agent Verification & Audit | 2 Reviewers, 2 Challengers, and 1 Forensic Auditor for rigorous validation | M5 | Verification Rubric |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Deep Survey & Web Research | Analyze codebase, root cause of rejections, and open-source portfolio research | none | DONE |
| M2 | Synthesizer Redesign Blueprint | Design mathematical model, scoring, regime weighting, and allocation architecture | M1 | DONE |
| M3 | Automated Synthesizer Refactor | Implement the refactored Grandmaster Synthesizer in target workspace | M2 | DONE |
| M4 | Execution & Empirical Verification | Compile, execute synthesizer on dumps, verify high-efficiency config retention | M3 | DONE |
| M5 | Multi-Perspective Review & Audit | 2 Reviewers, 2 Challengers, 1 Forensic Integrity Auditor | M4 | DONE |

## Interface Contracts
### Grandmaster Synthesizer Entry Points & Ingestion
- Ingestion: Reads `mage_optimizer_dump/` and `sage_optimizer_dump/` JSON candidates.
- Output: Structured portfolio configuration JSON with per-strategy risk allocation weights, post-filters, and expected OOS metrics (`grandmaster_holy_grail_portfolios.md` and `.json`).
- Compliance: Runs cleanly with `npx tsx server/trading/optimizer/grandmaster/grandmaster_synthesizer.ts` with 0 type errors and 15/15 CPCV validation pass.
