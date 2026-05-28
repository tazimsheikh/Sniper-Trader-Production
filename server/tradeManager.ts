import db, { incrementSessionLoss } from './db';
import { getSharedConnection, getSymbolSpec, clearSharedConnection } from './metaApiHandler';
import { decrypt, isEncrypted } from './crypto';

// A map to track internal state of positions we're managing
// positionId -> { entryTime, brokeEven }
const positionState = new Map<string, Map<string, { entryTime: number, brokeEven: boolean, session: string }>>();

export async function monitorOpenTrades(currentSession: string) {
  const activeProfiles = db.prepare(
    `SELECT tp.id, u.metaapi_token, tp.metaapi_account_id 
     FROM trading_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.automation_active = 1 
       AND tp.ai_sniper_active = 1 
       AND u.metaapi_token IS NOT NULL 
       AND tp.metaapi_account_id IS NOT NULL
       AND u.metaapi_token != 'dummy_token'
       AND tp.metaapi_account_id != 'dummy_acc'`
  ).all() as any[];

  if (activeProfiles.length === 0) return;

  for (const profile of activeProfiles) {
    let rawToken: string;
    try {
      rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
    } catch (e: any) {
      continue;
    }

    try {
      const connection = await getSharedConnection(rawToken, profile.metaapi_account_id, true);
      const allPositions = await connection.getPositions();
      const positions = allPositions.filter((p: any) => p.clientId === 'AI_SNIPER_TP1' || p.clientId === 'AI_SNIPER_TP2' || p.clientId?.startsWith('AI_SNIPER'));
      
      for (const pos of positions) {
        if (!positionState.has(profile.id)) {
          positionState.set(profile.id, new Map());
        }
        const profileState = positionState.get(profile.id)!;

        // Initialize local tracking state if new position
        if (!profileState.has(pos.id)) {
          // Use MetaAPI pos.time for real open time
          const realOpenTime = pos.time ? new Date(pos.time).getTime() : Date.now();
          profileState.set(pos.id, { 
            entryTime: realOpenTime,
            brokeEven: false,
            session: currentSession
          });
        }

        const state = profileState.get(pos.id)!;
        const spec = getSymbolSpec(pos.symbol);

        // MetaAPI returns profit in account currency. 
        // We can approximate pip profit using price difference.
        const diff = pos.type === 'POSITION_TYPE_BUY' 
          ? pos.currentPrice - pos.openPrice 
          : pos.openPrice - pos.currentPrice;
        
        const floatingPips = diff / spec.pipSize;

        // ── 1. Break-Even Trigger (Free Ride) ───────────────────────────
        if (floatingPips >= 25 && !state.brokeEven) {
          console.log(`[TradeManager] ${pos.symbol} +${floatingPips.toFixed(1)} pips. Moving SL to Break Even.`);
          // User requested: "Entry price + 1 pip"
          const beDistance = 1 * spec.pipSize;
          const bePrice = pos.type === 'POSITION_TYPE_BUY'
            ? pos.openPrice + beDistance
            : pos.openPrice - beDistance;
          
          try {
            await connection.modifyPosition(pos.id, parseFloat(bePrice.toFixed(5)), pos.takeProfit);
            state.brokeEven = true;
          } catch (e: any) {
            console.error(`[TradeManager] Failed to modify position ${pos.id} to BE:`, e.message);
          }
        }

        // ── 2. Time Ejection (45 min = 2700000 ms) ─────────────────────────
        const openTimeMs = Date.now() - state.entryTime;
        if (openTimeMs > 45 * 60 * 1000) {
          console.log(`[TradeManager] Time Ejection triggered for ${pos.symbol} (Open > 45 min). Closing at market.`);
          try {
            await connection.closePosition(pos.id);
            profileState.delete(pos.id);
          } catch (e: any) {
            console.error(`[TradeManager] Failed to close position ${pos.id}:`, e.message);
          }
          continue;
        }

        // ── 3. Lockout Tracking (Stop Loss hit) ─────────────────────────
        // In MetaAPI, if a position is closed, it won't appear in getPositions().
        // So how do we know if it hit SL?
        // We need to check closed positions or deals.
      }
      
      // Check for positions that disappeared (closed)
      const currentPosIds = new Set(positions.map((p: any) => p.id));
      const profileState = positionState.get(profile.id);
      if (profileState) {
        for (const [id, state] of profileState.entries()) {
          if (!currentPosIds.has(id)) {
            // Position closed! Was it a loss?
            // We can query the deal history for this position
            try {
              const history = await connection.getDealsByPosition(id);
              // The last deal (entry_out) holds the final profit
              const closingDeal = history.find((d: any) => d.entryType === 'DEAL_ENTRY_OUT' || d.entryType === 'DEAL_ENTRY_INOUT');
              if (closingDeal && closingDeal.profit < 0) {
                console.log(`[TradeManager] Profile ${profile.id} Position ${id} closed in LOSS. Updating Lockout Rule for session ${state.session}.`);
                incrementSessionLoss(profile.id, state.session);
              }
            } catch (e: any) {
               console.warn(`[TradeManager] Could not fetch deal history for closed pos ${id}`);
            }
            profileState.delete(id);
          }
        }
      }

    } catch (err: any) {
      if (!err.message.includes('Fast fail')) {
        console.error(`[TradeManager Profile ${profile.id}] Error:`, err.message);
      }
    }
  }
}
