import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, IChartApi, ISeriesApi } from 'lightweight-charts';

export default function BacktestViewer() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [backtestData, setBacktestData] = useState<any>(null);
  const [selectedPair, setSelectedPair] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/holy_backtest_results.json')
      .then(res => res.json())
      .then(data => {
        setBacktestData(data);
        const pairs = Object.keys(data);
        if (pairs.length > 0) {
          setSelectedPair(pairs[0]);
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error('Error loading backtest data:', err);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current || !backtestData || !selectedPair) return;

    if (!chartRef.current) {
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 600,
        layout: {
          background: { color: '#070913' }, // match theme
          textColor: '#94a3b8',
        },
        grid: {
          vertLines: { color: '#1e293b' },
          horzLines: { color: '#1e293b' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
      });
      chartRef.current = chart;

      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#10B981',
        downColor: '#EF4444',
        borderVisible: false,
        wickUpColor: '#10B981',
        wickDownColor: '#EF4444',
      });
      seriesRef.current = candlestickSeries;

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);
    }

    const pairData = backtestData[selectedPair];
    if (pairData && seriesRef.current) {
      // Map candles
      const chartData = pairData.dailyCandles.map((c: any) => ({
        time: Math.floor(new Date(c.date).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
      // ensure sorted unique times
      const uniqueData = chartData.filter((v: any, i: number, a: any[]) => a.findIndex(t => (t.time === v.time)) === i).sort((a: any, b: any) => a.time - b.time);
      seriesRef.current.setData(uniqueData);

      // Map trade markers
      const markers: any[] = [];
      pairData.trades.forEach((trade: any) => {
        const timeEntry = Math.floor(new Date(trade.entryTime).getTime() / 1000);
        
        // Ensure marker time matches exactly an existing candle or is very close
        markers.push({
          time: timeEntry,
          position: trade.direction === 'BUY' ? 'belowBar' : 'aboveBar',
          color: trade.direction === 'BUY' ? '#6366f1' : '#f59e0b',
          shape: trade.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `ENTRY ${trade.direction} @ ${trade.entryPrice.toFixed(4)}`
        });
        
        if (trade.exitTime) {
          const timeExit = Math.floor(new Date(trade.exitTime).getTime() / 1000);
          markers.push({
            time: timeExit,
            position: trade.status === 'WON' ? 'aboveBar' : 'belowBar',
            color: trade.status === 'WON' ? '#10B981' : (trade.status === 'TIMEOUT' ? '#6B7280' : '#EF4444'),
            shape: 'circle',
            text: `EXIT ${trade.status} @ ${trade.exitPrice?.toFixed(4)} (${trade.pips?.toFixed(1)} pips)`
          });
        }
      });
      
      // Sort markers by time
      markers.sort((a, b) => a.time - b.time);

      // Filter out markers with times not present in the candle data (lightweight charts throws error otherwise)
      const validTimes = new Set(uniqueData.map((d: any) => d.time));
      
      // Since trades happen intraday and we show daily candles, snap marker times to start of the day
      const snappedMarkers = markers.map(m => {
        const dateObj = new Date(m.time * 1000);
        // UTC start of day
        const snappedTime = Math.floor(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()) / 1000);
        return { ...m, time: validTimes.has(snappedTime) ? snappedTime : m.time };
      }).filter(m => validTimes.has(m.time));

      seriesRef.current.setMarkers(snappedMarkers);
      chartRef.current.timeScale().fitContent();
    }
  }, [backtestData, selectedPair]);

  if (isLoading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center h-96">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-indigo-400 font-mono tracking-widest uppercase animate-pulse">Loading 5-Year Data...</p>
      </div>
    );
  }

  if (!backtestData) {
    return <div className="p-6 text-red-400 font-mono">Failed to load backtest results. Please run the script first.</div>;
  }

  const pairData = backtestData[selectedPair];
  const winRate = pairData.totalTrades > 0 ? (pairData.won / pairData.totalTrades) * 100 : 0;
  const initialBalance = 100;
  const growth = ((pairData.finalBalance - initialBalance) / initialBalance) * 100;

  return (
    <div className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)]">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-display font-extrabold text-white flex items-center gap-2 uppercase tracking-wide">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          5-Year Holy Backtester
        </h2>
        
        <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 shadow-inner">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-bold">Select Pair:</span>
          <select 
            value={selectedPair} 
            onChange={e => setSelectedPair(e.target.value)}
            className="bg-transparent text-indigo-300 font-mono text-sm font-bold border-none outline-none cursor-pointer focus:ring-0"
          >
            {Object.keys(backtestData).map(pair => (
              <option key={pair} value={pair} className="bg-slate-900 text-indigo-300">{pair}</option>
            ))}
          </select>
        </div>
      </div>
      
      {pairData && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 shadow-inner relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-blue-500/10 rounded-full blur-xl pointer-events-none" />
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">Total Trades</p>
            <p className="text-white text-2xl font-display font-bold">{pairData.totalTrades}</p>
          </div>
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 shadow-inner relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">Win Rate</p>
            <p className="text-emerald-400 text-2xl font-display font-bold">{winRate.toFixed(1)}%</p>
          </div>
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 shadow-inner relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-slate-500/10 rounded-full blur-xl pointer-events-none" />
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">W / L</p>
            <p className="text-white text-xl font-display font-bold">
              <span className="text-emerald-400">{pairData.won}</span>
              <span className="text-slate-600 mx-1">/</span>
              <span className="text-rose-400">{pairData.lost}</span>
            </p>
          </div>
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 shadow-inner relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-purple-500/10 rounded-full blur-xl pointer-events-none" />
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">Final Balance</p>
            <p className="text-white text-2xl font-display font-bold">${pairData.finalBalance.toFixed(2)}</p>
          </div>
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 shadow-inner relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">Net Growth</p>
            <p className={growth >= 0 ? "text-emerald-400 text-2xl font-display font-bold" : "text-rose-400 text-2xl font-display font-bold"}>
              {growth > 0 ? '+' : ''}{growth.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      <div 
        ref={chartContainerRef} 
        className="w-full rounded-2xl overflow-hidden border border-slate-700/80 shadow-[0_0_20px_rgba(0,0,0,0.5)] bg-slate-950"
      />
      
      <div className="mt-4 flex flex-wrap gap-4 text-[10px] text-slate-500 font-mono tracking-wide">
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-500" /> BUY Entry</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> SELL Entry</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Profitable Exit</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" /> Stopped Out</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-500" /> 3-Hr Bailout</div>
      </div>
    </div>
  );
}
