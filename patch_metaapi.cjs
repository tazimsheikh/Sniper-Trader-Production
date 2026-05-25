const fs = require('fs');
let content = fs.readFileSync('server/metaApiHandler.ts', 'utf8');

const newFunc = `
export async function getUserTradeHistory(userId: number, daysBack: number = 30) {
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
    const start = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const deals = await connection.getDealsByTimeRange(start, now) as any[];
    if (!deals || !Array.isArray(deals)) return [];

    const positions = new Map<string, any>();

    for (const deal of deals) {
      if (!deal.positionId) continue;
      
      if (!positions.has(deal.positionId)) {
        positions.set(deal.positionId, {
          id: deal.positionId,
          user_id: userId,
          bot_id: (deal.comment || '').replace(/[\\[\\]]/g, ''),
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
`;

if (!content.includes('getUserTradeHistory')) {
  fs.writeFileSync('server/metaApiHandler.ts', content + '\n' + newFunc);
  console.log('Patched');
} else {
  console.log('Already patched');
}
