// GlobalTradeGate stub for shadow backtesting.
// 
// PARITY NOTE: In production, one trade per pair per session per day.
// In shadow testing, multiple configs per pair run independently and
// their trades are managed independently. The gate must allow this
// (configs that already have an open position don't re-fire due to the
// orbStates[sig].fired flag, so the gate doesn't need to block them).
// Gate still prevents the SAME config from double-firing within one bar.

export const globalTradeGate = {
  _activePairs: new Map<string, string>(), // tradeId -> pair
  _activeSigs: new Map<string, string>(),  // sig -> tradeId
  canTrade: function(profileId: number, pair: string, direction: string, traderType: string, sig?: string) {
    // If a specific sig is provided, only block if that exact sig already has an active trade
    // (covers the MageEngine preRegKey-based check)
    for (const [tradeId, p] of this._activePairs.entries()) {
      if (p === pair) {
        // Only block if this is the same signature re-firing
        if (sig && tradeId.includes(sig)) {
          return { approved: false, reason: 'Duplicate Engine Execution' };
        }
        // Without sig: allow (multiple configs per pair run concurrently in shadow)
      }
    }
    return { approved: true };
  },
  register: function(profileId: number, tradeId: string, pair: string, direction: string, traderType: string) {
    this._activePairs.set(tradeId, pair);
  },
  release: function(profileId: number, tradeId: string) {
    this._activePairs.delete(tradeId);
    this._activeSigs.delete(tradeId);
  },
  markDiscEvaluating: (..._args: any[]) => {},
  clearDiscEvaluating: (..._args: any[]) => {},
  checkSessionDirection: () => ({ approved: true }),
  registerSessionDirection: (..._args: any[]) => {},
  getActiveLeadTrade: () => undefined,
  onLeadTrade: (..._args: any[]) => {},
  markLeadTradeFilled: (..._args: any[]) => {},
  clearOldSessionLocks: () => {},
};
export default { globalTradeGate };
