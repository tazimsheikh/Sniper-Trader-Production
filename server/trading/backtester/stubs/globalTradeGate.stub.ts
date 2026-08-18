// ── GLOBAL TRADE GATE STUB ──
export const globalTradeGate = {
  canTrade: () => ({ approved: true }),
  register: (..._args: any[]) => {},
  release: (..._args: any[]) => {},
  markDiscEvaluating: (..._args: any[]) => {},
  clearDiscEvaluating: (..._args: any[]) => {},
  checkSessionDirection: () => ({ approved: true }),
  registerSessionDirection: (..._args: any[]) => {},
  getActiveLeadTrade: () => undefined,
  clearOldSessionLocks: () => {},
};
export default { globalTradeGate };
