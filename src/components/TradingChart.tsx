import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';

interface TradingChartProps {
  symbol: string;
  activeTrades?: any[];
  dailyPnl?: number;
}

export default function TradingChart({ symbol, activeTrades = [], dailyPnl = 0 }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize Chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid' as any, color: '#030508' }, // Pitch black Sniper theme
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.4)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.4)' },
      },
      crosshair: {
        mode: 0, // Normal crosshair
        vertLine: { color: '#d4af37', labelBackgroundColor: '#d4af37' },
        horzLine: { color: '#d4af37', labelBackgroundColor: '#d4af37' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#1e293b',
      },
      rightPriceScale: {
        borderColor: '#1e293b',
      }
    });

    // Configure Candlestick Series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981',      // Emerald 500
      downColor: '#e11d48',    // Rose 600
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#e11d48',
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;
    setChartReady(true);

    // Handle Resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    // Fetch Data
    setLoading(true);
    fetch(`/api/market/chart/${encodeURIComponent(symbol)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data && data.data.length > 0) {
          // lightweight-charts requires strictly ascending time order and no duplicates
          const validData = data.data.filter((item: any) => typeof item.time === 'number' && !isNaN(item.time));
          const sortedData = validData.sort((a: any, b: any) => a.time - b.time);
          
          const uniqueData = [];
          const seen = new Set();
          for (const item of sortedData) {
            if (!seen.has(item.time)) {
              seen.add(item.time);
              uniqueData.push(item);
            }
          }

          if (uniqueData.length > 0) {
            candlestickSeries.setData(uniqueData);
            chart.timeScale().fitContent();
          } else {
            setError("No valid chart data available");
          }
        } else {
          setError("No chart data available");
        }
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      setChartReady(false);
    };
  }, [symbol]);

  useEffect(() => {
    if (!chartReady || !seriesRef.current) return;

    // Clear existing price lines
    priceLinesRef.current.forEach(line => {
      try { seriesRef.current?.removePriceLine(line); } catch (e) {}
    });
    priceLinesRef.current = [];

    activeTrades.forEach(trade => {
      if (trade.openPrice) {
        priceLinesRef.current.push(seriesRef.current.createPriceLine({
          price: trade.openPrice,
          color: trade.type === 'BUY' ? '#3b82f6' : '#8b5cf6',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `Entry ${trade.type} (${trade.volume})`,
        }));
      }

      if (trade.stopLoss) {
        priceLinesRef.current.push(seriesRef.current.createPriceLine({
          price: trade.stopLoss,
          color: '#e11d48',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'SL',
        }));
      }

      if (trade.takeProfit) {
        priceLinesRef.current.push(seriesRef.current.createPriceLine({
          price: trade.takeProfit,
          color: '#10b981',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'TP',
        }));
      }
    });

  }, [activeTrades, chartReady]);

  // Calculate total floating PnL
  const floatingPnl = activeTrades.reduce((sum, t) => sum + (t.profit || 0), 0);

  return (
    <div className="w-full h-full min-h-[300px] sm:min-h-[400px] relative rounded-lg overflow-hidden border border-slate-800 shadow-inner">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#030508]/80 backdrop-blur-sm">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#030508]/80 backdrop-blur-sm text-slate-400 font-mono text-sm">
          {error}
        </div>
      )}
      <div ref={chartContainerRef} className="w-full h-full absolute inset-0" />
      <div className="absolute top-4 left-4 z-20 pointer-events-none">
         <span className="font-display font-black tracking-widest uppercase text-xl text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
           {symbol.replace('=X','').replace('=F','')}
         </span>
         <span className="ml-2 font-mono text-xs text-[#d4af37] bg-black/50 px-2 py-1 rounded shadow">M15</span>
      </div>

      <div className="absolute top-4 right-4 z-20 pointer-events-none flex flex-col items-end gap-2">
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-lg px-3 py-1.5 shadow-lg flex items-center gap-3">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Floating PnL</span>
          <span className={`font-mono font-bold text-sm ${floatingPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {floatingPnl >= 0 ? '+' : ''}{floatingPnl.toFixed(2)}
          </span>
        </div>
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-lg px-3 py-1.5 shadow-lg flex items-center gap-3">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Today's PnL</span>
          <span className={`font-mono font-bold text-sm ${dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {dailyPnl >= 0 ? '+' : ''}{dailyPnl.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
