import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, IChartApi, ISeriesApi } from 'lightweight-charts';

export default function BacktestViewer() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 600,
      layout: {
        background: { color: '#111827' },
        textColor: '#D1D5DB',
      },
      grid: {
        vertLines: { color: '#374151' },
        horzLines: { color: '#374151' },
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
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    // Fetch backtest data
    const abortController = new AbortController();
    fetch('/backtest_results.json', { signal: abortController.signal })
      .then(res => res.json())
      .then(data => {
        setMetrics(data.metrics);
        
        // Map candles
        const chartData = data.candles.map((c: any) => ({
          time: Math.floor(c.time / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        }));
        candlestickSeries.setData(chartData);

        // Map trade markers
        const markers: any[] = [];
        data.trades.forEach((trade: any) => {
          markers.push({
            time: Math.floor(trade.entryTime / 1000),
            position: trade.direction === 'BUY' ? 'belowBar' : 'aboveBar',
            color: trade.direction === 'BUY' ? '#3B82F6' : '#F59E0B',
            shape: trade.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
            text: `ENTRY ${trade.direction} @ ${trade.entryPrice.toFixed(4)}`
          });
          
          if (trade.exitTime) {
            markers.push({
              time: Math.floor(trade.exitTime / 1000),
              position: trade.status === 'CLOSED_WON' ? 'aboveBar' : 'belowBar',
              color: trade.status === 'CLOSED_WON' ? '#10B981' : (trade.status === 'TIME_BAILOUT' ? '#6B7280' : '#EF4444'),
              shape: 'circle',
              text: `EXIT ${trade.status} @ ${trade.exitPrice?.toFixed(4)} (${trade.pips?.toFixed(1)} pips)`
            });
          }
        });
        
        // Sort markers by time
        markers.sort((a, b) => a.time - b.time);
        candlestickSeries.setMarkers(markers);
      })
      .catch(err => {
        if (err.name !== 'AbortError') console.error(err);
      });

    return () => {
      abortController.abort();
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-white mb-4">Backtest Analytics Visualizer</h2>
      
      {metrics && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-sm">Total Trades</p>
            <p className="text-white text-xl font-bold">{metrics.trades}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-sm">Win Rate</p>
            <p className="text-white text-xl font-bold">{metrics.winRate.toFixed(1)}%</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-sm">Max Drawdown</p>
            <p className="text-red-400 text-xl font-bold">-{metrics.maxDrawdown.toFixed(1)}%</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-sm">Final Balance</p>
            <p className="text-white text-xl font-bold">${metrics.balance.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-sm">Growth</p>
            <p className={metrics.growth >= 0 ? "text-green-400 text-xl font-bold" : "text-red-400 text-xl font-bold"}>
              {metrics.growth > 0 ? '+' : ''}{metrics.growth.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      <div 
        ref={chartContainerRef} 
        className="w-full rounded-xl overflow-hidden border border-gray-700 shadow-2xl"
      />
      
      <div className="mt-4 text-sm text-gray-400">
        <p><strong>Blue Arrow:</strong> BUY Entry &nbsp;|&nbsp; <strong>Orange Arrow:</strong> SELL Entry</p>
        <p><strong>Green Circle:</strong> Profitable Exit (TP1/TP2) &nbsp;|&nbsp; <strong>Red Circle:</strong> Stopped Out &nbsp;|&nbsp; <strong>Gray Circle:</strong> 45-Min Time Bailout</p>
      </div>
    </div>
  );
}
