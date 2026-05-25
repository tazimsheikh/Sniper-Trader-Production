// @ts-ignore
import MetaApiPkg from 'metaapi.cloud-sdk/esm-node';
const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;

import db from './db';
import { decrypt, isEncrypted } from './crypto';
import { TrapSignal } from '../src/types';

// ── Broker symbol map ─────────────────────────────────────────────────────────
const BROKER_SYMBOL_MAP: Record<string, string> = {
  'GC=F':     'XAUUSD',
  'NQ=F':     'USTEC',
  'CL=F':     'XTIUSD',
  'EURUSD=X': 'EURUSD',
  'GBPUSD=X': 'GBPUSD',
  'USDJPY=X': 'USDJPY',
  'AUDUSD=X': 'AUDUSD',
  'USDCAD=X': 'USDCAD',
  'GBPJPY=X': 'GBPJPY',
};

// ── Pip specification (single source of truth — must match marketStore.ts ASSET_MAP) ──
interface SymbolSpec {
  pipSize: number;         // Price units per 1 pip
  pipValuePerLot: number;  // USD per pip for 1.0 standard lot
  // NOTE: USTEC/NAS100 pipValuePerLot varies by broker contract spec.
  // Verify your broker's contract size before going live.
}

const SYMBOL_SPECS: Record<string, SymbolSpec> = {
  'XAUUSD': { pipSize: 0.01,   pipValuePerLot: 10  }, // Gold: 1 lot = 100 oz, $0.01/pip = $10
  'EURUSD': { pipSize: 0.0001, pipValuePerLot: 10  },
  'GBPUSD': { pipSize: 0.0001, pipValuePerLot: 10  },
  'AUDUSD': { pipSize: 0.0001, pipValuePerLot: 10  },
  'USDCAD': { pipSize: 0.0001, pipValuePerLot: 10  },
  'USDJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 }, // Approx — varies with JPY rate
  'GBPJPY': { pipSize: 0.01,   pipValuePerLot: 9.1 },
  'USTEC':  { pipSize: 1.0,    pipValuePerLot: 10  }, // ⚠️ Confirm with your broker's contract spec
  'XTIUSD': { pipSize: 0.01,   pipValuePerLot: 10  },
};
const DEFAULT_SPEC: SymbolSpec = { pipSize: 0.0001, pipValuePerLot: 10 };

function getSymbolSpec(brokerSymbol: string): SymbolSpec {
  return SYMBOL_SPECS[brokerSymbol] ?? DEFAULT_SPEC;
}

import { createHash } from 'crypto';

// ── MetaAPI SDK instance cache (reuse connections, avoid repeated handshakes) ─
const apiCache = new Map<string, any>();

function getApiInstance(token: string): any {
  // Cache by token hash (already decrypted at this point)
  const cacheKey = createHash('sha256').update(token).digest('hex');
  if (!apiCache.has(cacheKey)) {
    apiCache.set(cacheKey, new MetaApi(token));
  }
  return apiCache.get(cacheKey);
}

// ── Lot-size quantiser ───────────────────────────────────────────────────────
/**
 * Rounds a raw lot-size float to the nearest 0.01 lot (micro-lot step),
 * clamps to [0.01, 5.0], and eliminates IEEE 754 floating-point residuals
 * by routing through toFixed(2) before converting back to a number.
 *
 * Examples:
 *   quantizeLots(0.156)              → 0.16
 *   quantizeLots(0.14000000000000001) → 0.14   (no trailing garbage)
 *   quantizeLots(0.004)              → 0.01   (floor to minimum)
 *   quantizeLots(7.89)               → 5.00   (capped at safety max)
 */
function quantizeLots(raw: number): number {
  // Step 1 — round to 2 decimal places via string (immune to IEEE 754 drift)
  const rounded = parseFloat(raw.toFixed(2));
  // Step 2 — enforce [0.01, 5.0] range
  const clamped = Math.min(Math.max(rounded, 0.01), 5.0);
  // Step 3 — one final toFixed pass to guarantee the broker sees "0.14" not "0.14000000000000001"
  return parseFloat(clamped.toFixed(2));
}

// ── Verify Connection Hook ───────────────────────────────────────────────────
export async function verifyMetaApiConnection(token: string, accountId: string): Promise<boolean> {
  try {
    const api = getApiInstance(token);
    const account = await api.metatraderAccountApi.getAccount(accountId);
    if (!account) throw new Error("Account not found");
    return true;
  } catch (err: any) {
    throw new Error(`MetaAPI Connection Failed: ${err.message}`);
  }
}

// ── Robust connection with timeout and retry ─────────────────────────────────
const SYNC_TIMEOUT_MS   = 60_000;
const MAX_CONNECT_TRIES = 2;

async function getReadyConnection(account: any): Promise<any> {
  if (account.state !== 'DEPLOYED') {
    console.log(`[MetaAPI] Account not deployed — deploying now…`);
    await account.deploy();
    await account.waitConnected();
    console.log(`[MetaAPI] Account deployed.`);
  }

  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_CONNECT_TRIES; attempt++) {
    try {
      const connection = account.getRPCConnection();
      await connection.connect();

      await Promise.race([
        connection.waitSynchronized(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Sync timed out after ${SYNC_TIMEOUT_MS / 1000}s`)),
            SYNC_TIMEOUT_MS
          )
        ),
      ]);

      console.log(`[MetaAPI] Connection synchronized (attempt ${attempt}).`);
      return connection;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[MetaAPI] Connect attempt ${attempt}/${MAX_CONNECT_TRIES}: ${err.message}`);
      if (attempt < MAX_CONNECT_TRIES) await new Promise(r => setTimeout(r, 3000));
    }
  }

  throw new Error(`[MetaAPI] Could not synchronize after ${MAX_CONNECT_TRIES} attempts: ${lastErr?.message}`);
}

// ── Main trade execution entry point ──────────────────────────────────────────
export async function executeTradeForUsers(
  signal: TrapSignal,
  stopLossDistPips: number,
  takeProfitDistPips: number,
  forceRiskPct?: number
) {
  const activeUsers = db.prepare(
    'SELECT id, metaapi_token, metaapi_account_id, risk_multiplier FROM users WHERE automation_active = 1 AND ai_sniper_active = 1 AND metaapi_token IS NOT NULL AND metaapi_account_id IS NOT NULL'
  ).all() as any[];

  if (activeUsers.length === 0) return;

  console.log(`[MetaAPI] Signal ${signal.id} | ${signal.direction} ${signal.symbol} | Executing for ${activeUsers.length} user(s)`);

  const brokerSymbol = BROKER_SYMBOL_MAP[signal.symbol] ?? signal.symbol.replace('=X', '').replace('=F', '');
  const spec = getSymbolSpec(brokerSymbol);

  // Base risk from actual signal grade: grade 5 = 5%, grade 1 = 1%
  const baseRiskPct = signal.grade;

  const promises = activeUsers.map(async (user) => {
    try {
      // ── FIX: Guard null token ─────────────────────────────────────────────
      if (!user.metaapi_token) {
        console.warn(`[MetaAPI User ${user.id}] No token configured — skipping.`);
        return;
      }
      if (!user.metaapi_account_id) {
        console.warn(`[MetaAPI User ${user.id}] No account ID configured — skipping.`);
        return;
      }

      // ── FIX: Decrypt token before use ─────────────────────────────────────
      let rawToken: string;
      try {
        rawToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
      } catch (e: any) {
        console.error(`[MetaAPI User ${user.id}] Token decryption failed — skipping:`, e.message);
        return;
      }

      // ── FIX: Use cached SDK instance ───────────────────────────────────────
      const api = getApiInstance(rawToken);
      const account = await api.metatraderAccountApi.getAccount(user.metaapi_account_id);
      const connection = await getReadyConnection(account);

      // Account info & risk calculation
      const accountInfo = await connection.getAccountInformation();
      const balance: number = accountInfo.balance;
      
      const userRiskPct = forceRiskPct ? forceRiskPct : baseRiskPct;
      const riskAmount  = balance * (userRiskPct / 100);

      // Lot size formula: Lots = RiskAmount / (SL_pips × pipValuePerLot)
      // quantizeLots() guarantees a clean 0.01-multiple (no IEEE 754 residuals)
      const lotSize = quantizeLots(riskAmount / (stopLossDistPips * spec.pipValuePerLot));

      console.log(
        `[MetaAPI User ${user.id}] ${brokerSymbol} | Balance: $${balance.toFixed(2)} | ` +
        `Risk: ${userRiskPct}% ($${riskAmount.toFixed(2)}) | SL: ${stopLossDistPips} pips | Lots: ${lotSize}`
      );

      // ── FIX: Validate quote freshness before placing order ─────────────────
      // @ts-ignore
      const quote = await connection.getSymbolPrice(brokerSymbol);
      const quoteAgeMs = Date.now() - (quote?.time?.getTime?.() ?? 0);
      if (quoteAgeMs > 10_000) {
        throw new Error(`Stale quote for ${brokerSymbol}: ${quoteAgeMs}ms old. Trade aborted.`);
      }

      // Calculate SL / TP using symbol-accurate pipSize
      const slDistance = stopLossDistPips   * spec.pipSize;
      const tpDistance = takeProfitDistPips * spec.pipSize;

      let orderResult;
      if (signal.direction === 'BUY') {
        const slPrice = parseFloat((quote.ask - slDistance).toFixed(5));
        const tpPrice = parseFloat((quote.ask + tpDistance).toFixed(5));
        console.log(`[MetaAPI User ${user.id}] BUY @ ${quote.ask} | SL: ${slPrice} | TP: ${tpPrice} | Lots: ${lotSize}`);
        orderResult = await connection.createMarketBuyOrder(brokerSymbol, lotSize, slPrice, tpPrice);
      } else {
        const slPrice = parseFloat((quote.bid + slDistance).toFixed(5));
        const tpPrice = parseFloat((quote.bid - tpDistance).toFixed(5));
        console.log(`[MetaAPI User ${user.id}] SELL @ ${quote.bid} | SL: ${slPrice} | TP: ${tpPrice} | Lots: ${lotSize}`);
        orderResult = await connection.createMarketSellOrder(brokerSymbol, lotSize, slPrice, tpPrice);
      }

      console.log(`[MetaAPI User ${user.id}] ✅ Order placed: ${orderResult.orderId}`);

    } catch (err: any) {
      console.error(`[MetaAPI User ${user.id}] ❌ Trade failed:`, err.message);
    }
  });

  await Promise.allSettled(promises);
}


export async function getUserTradeHistory(userId: number, daysBack: number = 30, resetTimeStr?: string) {
  const user = db.prepare('SELECT metaapi_token, metaapi_account_id FROM users WHERE id = ?').get(userId) as any;
  if (!user || !user.metaapi_token || !user.metaapi_account_id) return null;

  try {
    let rawToken = user.metaapi_token;
    try {
      rawToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    } catch(e) {}
    
    const api = getApiInstance(rawToken);
    const account = await api.metatraderAccountApi.getAccount(user.metaapi_account_id);
    const connection = await getReadyConnection(account);

    const now = new Date();
    let start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    
    // 🛡️ DIARY RESET FILTER 🛡️
    // If the user has reset their diary, cap the lookback to the exact reset second.
    if (resetTimeStr) {
      const resetDate = new Date(resetTimeStr);
      if (resetDate.getTime() > start.getTime()) {
        start = resetDate;
      }
    }

    const deals = await connection.getDealsByTimeRange(start, now) as any[];
    if (!deals || !Array.isArray(deals)) return [];

    const positions = new Map<string, any>();

    for (const deal of deals) {
      if (!deal.positionId) continue;
      
      if (!positions.has(deal.positionId)) {
        positions.set(deal.positionId, {
          id: deal.positionId,
          user_id: userId,
          bot_id: (deal.comment || '').replace(/[\[\]]/g, ''),
          broker_symbol: deal.symbol,
          direction: deal.type === 'DEAL_TYPE_BUY' ? (deal.entryType === 'DEAL_ENTRY_IN' ? 'BUY' : 'SELL') : (deal.entryType === 'DEAL_ENTRY_IN' ? 'SELL' : 'BUY'),
          entry_price: 0,
          exit_price: 0,
          lots: deal.volume,
          pips: 0,
          profit: 0,
          status: 'OPEN',
          open_time: 0,
          close_time: null
        });
      }

      const pos = positions.get(deal.positionId);
      
      if (deal.entryType === 'DEAL_ENTRY_IN') {
        pos.entry_price = deal.price;
        pos.open_time = new Date(deal.time).getTime();
        pos.direction = deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL';
      } else if (deal.entryType === 'DEAL_ENTRY_OUT' || deal.entryType === 'DEAL_ENTRY_INOUT') {
        pos.exit_price = deal.price;
        pos.close_time = new Date(deal.time).getTime();
        pos.profit += (deal.profit || 0) + (deal.commission || 0) + (deal.swap || 0);
        pos.status = 'CLOSED';
      }
    }

    const closedTrades = Array.from(positions.values()).filter(p => p.status === 'CLOSED');
    
    for (const trade of closedTrades) {
      const spec = getSymbolSpec(trade.broker_symbol);
      const diff = trade.direction === 'BUY' ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price;
      trade.pips = parseFloat((diff / spec.pipSize).toFixed(1));
      trade.profit = parseFloat(trade.profit.toFixed(2));
    }

    return closedTrades.sort((a, b) => b.close_time - a.close_time);
  } catch (err: any) {
    console.error('[getUserTradeHistory] Error:', err.message);
    return null;
  }
}
