import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { RefreshCw } from 'lucide-react';

export default function TradeAnalytics({ diary, bots, selectedBotId, onSelectBot, analyticsData, onRefresh, isRefreshing }: any) {
  // Filter diary based on selected bot (or all)
  const filteredDiary = useMemo(() => {
    const sorted = [...diary].sort((a, b) => a.open_time - b.open_time); // Chronological
    if (selectedBotId === 'all') return sorted;
    return sorted.filter(t => t.bot_id === selectedBotId);
  }, [diary, selectedBotId]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (filteredDiary.length === 0) return { totalProfit: 0, winRate: 0, totalTrades: 0, maxDD: 0, chartData: [] };

    let totalProfit = 0;
    let wins = 0;
    let peak = 0;
    let maxDD = 0;
    
    const chartData = filteredDiary.map((trade, idx) => {
      totalProfit += trade.profit;
      if (trade.profit > 0) wins++;
      if (totalProfit > peak) peak = totalProfit;
      
      const drawdown = peak > 0 ? ((peak - totalProfit) / peak) * 100 : 0;
      if (drawdown > maxDD) maxDD = drawdown;

      return {
        name: `Trade ${idx + 1}`,
        profit: totalProfit,
        rawProfit: trade.profit,
        date: new Date(trade.close_time).toLocaleDateString()
      };
    });

    // Start with 0 point for chart
    chartData.unshift({ name: 'Start', profit: 0, rawProfit: 0, date: '' });

    return {
      totalProfit,
      winRate: ((wins / filteredDiary.length) * 100).toFixed(1),
      totalTrades: filteredDiary.length,
      maxDD: maxDD.toFixed(1),
      chartData
    };
  }, [filteredDiary]);

  return (
    <div className="space-y-6">
      {/* Filters & Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-display font-bold uppercase tracking-wider text-white">Performance Analytics</h3>
            <span className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              analyticsData?.status === 'connected' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 
              analyticsData?.status === 'syncing' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
              'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                analyticsData?.status === 'connected' ? 'bg-emerald-400 animate-pulse' : 
                analyticsData?.status === 'syncing' ? 'bg-amber-400 animate-pulse' :
                'bg-red-400'
              }`} />
              {analyticsData?.status === 'connected' ? 'MetaAPI Sync Active' : 
               analyticsData?.status === 'syncing' ? 'Connecting...' : 'Offline'}
            </span>
            {onRefresh && (
              <button 
                onClick={onRefresh}
                disabled={isRefreshing}
                className="p-1.5 hover:bg-slate-800 rounded-md transition-colors text-slate-400 hover:text-white disabled:opacity-50 flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider ml-2 border border-slate-700/50"
                title="Refresh Live Data"
              >
                <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">Detailed statistics and equity curves based on your live trade diary.</p>
        </div>
        
        <select
          value={selectedBotId}
          onChange={(e) => onSelectBot(e.target.value)}
          className="bg-slate-800/80 border border-slate-700 text-sm text-slate-200 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 min-w-[200px]"
        >
          <option value="all">Overall Portfolio</option>
          {bots.map((b: any) => (
            <option key={b.id} value={b.id}>{b.name} ({b.symbols.join(', ')})</option>
          ))}
        </select>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {analyticsData?.status === 'connected' && (
          <>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Live Balance</p>
              <p className="text-xl font-mono font-bold text-white">${analyticsData.account.balance?.toFixed(2)}</p>
            </div>
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Live Equity</p>
              <p className="text-xl font-mono font-bold text-white">${analyticsData.account.equity?.toFixed(2)}</p>
            </div>
          </>
        )}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Total Net Profit</p>
          <p className={`text-xl font-mono font-bold ${stats.totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${stats.totalProfit.toFixed(2)}
          </p>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Win Rate</p>
          <p className="text-xl font-mono font-bold text-white">{stats.winRate}%</p>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Total Trades</p>
          <p className="text-xl font-mono font-bold text-white">{stats.totalTrades}</p>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Max Drawdown</p>
          <p className="text-xl font-mono font-bold text-rose-400">{stats.maxDD}%</p>
        </div>
      </div>

      {/* Equity Curve Graph */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-6 h-[400px]">
        {stats.chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickMargin={10} minTickGap={30} />
              <YAxis stroke="#64748b" fontSize={10} tickFormatter={(val) => `$${val}`} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                itemStyle={{ color: '#fff', fontSize: '12px' }}
                labelStyle={{ color: '#94a3b8', fontSize: '10px', marginBottom: '4px' }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative Profit']}
              />
              <Area 
                type="monotone" 
                dataKey="profit" 
                stroke="#818cf8" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorProfit)" 
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
            <svg className="w-12 h-12 mb-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p>No trades logged yet.</p>
            <p className="text-xs mt-1">The equity curve will appear once trades are closed.</p>
          </div>
        )}
      </div>

      {/* Live Positions from MetaAPI */}
      {analyticsData?.status === 'connected' && analyticsData.positions?.length > 0 && (
        <div className="mt-6">
          <p className="text-slate-400 font-mono text-[10px] uppercase tracking-widest mb-3">Live Active Positions</p>
          <div className="space-y-2">
            {analyticsData.positions.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between bg-slate-800/40 border border-slate-700/50 p-3 rounded-xl">
                 <div className="flex items-center gap-3">
                   <span className={`text-[10px] font-bold px-2 py-1 rounded ${p.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                     {p.type}
                   </span>
                   <span className="text-white font-bold text-sm">{p.symbol}</span>
                   <span className="text-slate-500 text-xs font-mono">{p.volume} Lots @ {p.openPrice}</span>
                 </div>
                 <div className={`font-mono text-sm font-bold ${p.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                   {p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)} {analyticsData.account?.currency || 'USD'}
                 </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
