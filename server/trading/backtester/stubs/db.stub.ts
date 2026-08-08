// ── DB STUB ──
// Replaces the SQLite db module with no-ops for simulator mode.
let _simulatedTime: Date | null = null;
export function setSimulatedTime(d: Date) {
  _simulatedTime = d;
}
export function getSimulatedTime(): Date {
  return _simulatedTime || new Date();
}

const noop = () => {};
const noopRun = () => ({ lastInsertRowid: 1, changes: 1 });
const stmt = {
  run: noopRun,
  get: (arg?: any) => ({
    risk_multiplier: 1,
    metaapi_token: "MOCK_TOKEN",
    metaapi_account_id: "MOCK_ACC_ID",
    automation_active: 1,
    bot_risks: '{"mage":1,"sage":1,"seer":1}',
    dwcb_enabled: 0,
    dwcb_peak_balance: 0,
    base_risk_balance: null,
    institutional_enabled: 0,
    institutional_daily_start_balance: null,
    institutional_daily_date: null,
    institutional_peak_balance: null,
    broker_symbol_map: null,
  }),
  all: (arg?: any) => [],
  iterate: () => []
};

const db: any = {
  prepare: () => stmt,
  transaction: (fn: any) => fn,
  exec: noop,
  close: noop,
};

export function addBotLog(..._args: any[]) {}

export default db;
