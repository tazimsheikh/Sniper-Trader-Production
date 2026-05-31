import db, { incrementSessionLoss } from './db';
import { getSharedConnection, getSymbolSpec, clearSharedConnection } from './metaApiHandler';
import { decrypt, isEncrypted } from './crypto';
import { closeTrade, logToDiary } from './botManager.js';

// A map to track internal state of positions we're managing
// positionId -> { entryTime, brokeEven }
const positionState = new Map<any, Map<string, { entryTime: number, brokeEven: boolean, session: string }>>();

export function deleteProfileTradeState(profileId: number) {
  positionState.delete(profileId);
}

export async function monitorOpenTrades(currentSession: string) {
  const activeProfiles = await db.prepare(
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
      const openDbTrades = await db.prepare('SELECT meta_order_id FROM bot_trade_states WHERE profile_id = ? AND status = ?').all(profile.id, 'OPEN') as any[];
      const botOrderIds = new Set(openDbTrades.map(t => t.meta_order_id));
      const positions = allPositions.filter((p: any) => botOrderIds.has(p.id) || p.clientId === 'AI_SNIPER_TP1' || p.clientId === 'AI_SNIPER_TP2' || p.clientId?.startsWith('AI_SNIPER'));
      
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
            if (e.message && (e.message.includes('Invalid Stops') || e.message.includes('Invalid stops'))) {
              state.brokeEven = true;
              await db.prepare('UPDATE bot_trade_states SET sl_price = ? WHERE meta_order_id = ?').run(bePrice, pos.id);
            }
          }
        }

        // ── Time Ejection Removed ─────────────────────────
        // The 45-minute strict time ejection has been removed to align with the backtest engine.
        // Trades will now hit SL, TP, or EOD closure (23:55).

        // ── 3. Lockout Tracking (Stop Loss hit) ─────────────────────────
        // In MetaAPI, if a position is closed, it won't appear in getPositions().
        // So how do we know if it hit SL?
        // We need to check closed positions or deals.
      }
      
      // Check for positions that disappeared (closed)
      const currentPosIds = new Set(positions.map((p: any) => p.id));
      
      // DB Reconciliation
      const openReconcileTrades = await db.prepare("SELECT meta_order_id FROM bot_trade_states WHERE profile_id = ? AND status = 'OPEN'").all(profile.id) as any[];
      for (const dbTrade of openReconcileTrades) {
        if (!currentPosIds.has(dbTrade.meta_order_id)) {
          await closeTrade(dbTrade.meta_order_id, 'CLOSED');
        }
      }

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
              
              const dbState = await db.prepare('SELECT * FROM bot_trade_states WHERE meta_order_id = ?').get(id) as any;

              if (closingDeal) {
                if (closingDeal.profit < 0) {
                  const symbolToLock = dbState ? dbState.broker_symbol : closingDeal.symbol;
                  console.log(`[TradeManager] Profile ${profile.id} Position ${id} (${symbolToLock}) closed in LOSS. Updating Lockout Rule for session ${state.session}.`);
                  incrementSessionLoss(profile.id, symbolToLock, state.session);
                }

                // ── RECONCILE DB (Ghost Trade Prevention) ─────────────────────
                // Whether closed manually by user, hit SL/TP on broker, or EOD:
                if (dbState && dbState.status === 'OPEN') {
                  await closeTrade(id, 'CLOSED');
                  console.log(`[TradeManager] Reconciled DB state to CLOSED for missing MetaAPI position ${id}`);

                  const spec = getSymbolSpec(dbState.broker_symbol);
                  const pips = dbState.direction === 'BUY' 
                    ? (closingDeal.price - dbState.entry_price) / spec.pipSize
                    : (dbState.entry_price - closingDeal.price) / spec.pipSize;
                  
                  const status = closingDeal.profit >= 0 ? 'WON' : 'LOST';
                  
                  await logToDiary(dbState.user_id, profile.id, dbState.bot_id, dbState.broker_symbol, dbState.direction, dbState.entry_price, closingDeal.price, dbState.lots, pips, closingDeal.profit, status, dbState.open_time);
                }
              }
            } catch (e: any) {
               console.warn(`[TradeManager] Could not fetch deal history for closed pos ${id}`);
               // Failsafe close in DB just in case history fetch fails, so we don't stay locked forever
               const dbState = await db.prepare('SELECT status FROM bot_trade_states WHERE meta_order_id = ?').get(id) as any;
               if (dbState && dbState.status === 'OPEN') {
                 await closeTrade(id, 'CLOSED');
               }
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
