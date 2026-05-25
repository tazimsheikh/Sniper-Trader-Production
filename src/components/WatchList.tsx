import React from 'react';
import { MarketData } from '../types';
import { Play, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, HelpCircle } from 'lucide-react';

interface WatchListProps {
  markets: MarketData[];
  onTriggerSimulation: (symbol: string, pattern: string) => void;
  selectedAssetSymbol: string;
  onSelectAsset: (symbol: string) => void;
}

export default function WatchList({
  markets,
  onTriggerSimulation,
  selectedAssetSymbol,
  onSelectAsset,
}: WatchListProps) {
  return (
    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-700/50 rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.5)] ring-1 ring-white/5">
      <div className="p-4 bg-slate-950/80 border-b border-slate-800/65 flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-bold tracking-tight text-white flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Watchlist
          </h2>
        </div>
      </div>

      <div className="divide-y divide-slate-800/50 max-h-[585px] overflow-y-auto bg-slate-900/15">
        {markets.map((market) => {
          const isSelected = market.symbol === selectedAssetSymbol;
          const isUp = market.change >= 0;
          
          // Math for the Chop Zone visualization
          // HOD to LOD range
          const totalRange = market.hod - market.lod;
          // Percentage location of current price (0% = LOD, 100% = HOD)
          const pricePercent = totalRange > 0 
            ? Math.max(0, Math.min(100, ((market.currentPrice - market.lod) / totalRange) * 100))
            : 50;

          // Inside Chop zone? Typically middle 20% to 80% is the 50/50 death zone
          const isInChopZone = pricePercent >= 15 && pricePercent <= 85;

          return (
            <div
              key={market.symbol}
              onClick={() => onSelectAsset(market.symbol)}
              className={`p-4 transition-all cursor-pointer select-none ${
                isSelected 
                  ? 'bg-indigo-600/10 border-l-4 border-indigo-500 shadow-[inset_4px_0_12px_rgba(99,102,241,0.05)]' 
                  : 'hover:bg-slate-900/60 border-l-4 border-transparent'
              }`}
              id={`watchlist-card-${market.symbol.replace('=','')}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold text-slate-100">{market.displayName}</span>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800/50">
                      {market.symbol}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {market.signalDay === 'FRD' && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold font-mono tracking-wider bg-rose-500/15 text-rose-400 rounded ring-1 ring-rose-500/35">
                        DAY 2 SHORT (POST-FRD)
                      </span>
                    )}
                    {market.signalDay === 'FGD' && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold font-mono tracking-wider bg-emerald-500/15 text-emerald-400 rounded ring-1 ring-emerald-500/35">
                        DAY 2 LONG (POST-FGD)
                      </span>
                    )}
                    {market.signalDay === 'Inside Day' && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold font-mono tracking-wider bg-amber-500/15 text-amber-400 rounded ring-1 ring-amber-500/35">
                        POST-INSIDE DAY
                      </span>
                    )}
                    {market.signalDay === 'Normal' && (
                      <span className="px-1.5 py-0.5 text-[9px] font-medium font-mono text-slate-500 bg-slate-950/60 rounded">
                        No Daily Anchor
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono font-bold text-slate-50 text-[15px] tracking-tight">
                    {market.currentPrice.toLocaleString(undefined, { minimumFractionDigits: market.symbol.includes('NQ=F') || market.symbol.includes('GC=F') ? 2 : 4, maximumFractionDigits: market.symbol.includes('NQ=F') || market.symbol.includes('GC=F') ? 2 : 4 })}
                  </div>
                  <div className={`flex items-center justify-end gap-1 text-[11px] font-mono mt-0.5 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    <span>{isUp ? '+' : ''}{market.changePercent.toFixed(2)}%</span>
                  </div>
                </div>
              </div>

              {/* Sniper Analyst Liquidity Meter (HOD vs LOD) */}
              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-slate-400 font-mono mb-1.5">
                  <span className="text-rose-400 font-medium">LOD: {market.lod.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  {isInChopZone ? (
                    <span className="text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded text-[9px] flex items-center gap-1">
                      <AlertTriangle size={10} className="text-amber-400" />
                      50/50 CHOP ZONE - DO NOT TOUCH
                    </span>
                  ) : (
                    <span className="text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded text-[9px] flex items-center gap-1 font-bold">
                      <ShieldCheck size={10} />
                    	STRIKE ZONE REJECTION GROUND
                    </span>
                  )}
                  <span className="text-emerald-400 font-medium">HOD: {market.hod.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>

                {/* Range Bar */}
                <div className="w-full h-1.5 bg-slate-950 rounded-full relative overflow-visible">
                  <div 
                    className="absolute top-0 bottom-0 left-[15%] right-[15%] bg-rose-500/20 border-x border-slate-800"
                    title="Chop Zone limit boundaries"
                  />
                  <div 
                    className={`absolute -top-1 w-3.5 h-3.5 rounded-full border-2 border-slate-950 shadow-md ${
                      isInChopZone ? 'bg-amber-500' : 'bg-emerald-400 animate-pulse'
                    }`}
                    style={{ left: `${pricePercent}%`, transform: 'translateX(-50%)' }}
                  />
                </div>
                <div className="flex justify-between text-[8px] text-slate-600 font-mono mt-0.5">
                  <span>OUTER LIQUIDITY</span>
                  <span>MIDDLE RANGE</span>
                  <span>OUTER LIQUIDITY</span>
                </div>
              </div>

              {/* Dynamic Interactive Setup Simulators */}
              <div className="mt-3.5 pt-2.5 border-t border-slate-800/40 flex items-center justify-between gap-1">
                <span className="text-[10px] font-mono text-slate-500 font-medium">Inject Study Trap:</span>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {market.signalDay === 'FRD' || market.signalDay === 'Normal' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTriggerSimulation(market.symbol, 'FRD');
                      }}
                      className="px-2 py-1 text-[9px] font-mono bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 rounded border border-rose-800/40 flex items-center gap-1 transition-all"
                      id={`btn-sim-frd-${market.symbol.replace('=','')}`}
                    >
                      <Play size={8} fill="currentColor" />
                      Sim FRD Dump
                    </button>
                  ) : null}

                  {market.signalDay === 'FGD' || market.signalDay === 'Normal' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTriggerSimulation(market.symbol, 'FGD');
                      }}
                      className="px-2 py-1 text-[9px] font-mono bg-emerald-950/40 hover:bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 flex items-center gap-1 transition-all"
                      id={`btn-sim-fgd-${market.symbol.replace('=','')}`}
                    >
                      <Play size={8} fill="currentColor" />
                      Sim FGD Peak
                    </button>
                  ) : null}

                  {market.signalDay === 'Inside Day' || market.signalDay === 'Normal' ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTriggerSimulation(market.symbol, 'Inside Day');
                        }}
                        className="px-2 py-1 text-[9px] font-mono bg-amber-950/40 hover:bg-amber-900/40 text-amber-300 rounded border border-amber-800/50 flex items-center gap-1 transition-all"
                        id={`btn-sim-id-buy-${market.symbol.replace('=','')}`}
                      >
                        <Play size={8} fill="currentColor" />
                        Sim ID Break Long
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTriggerSimulation(market.symbol, 'Inside Day Sell');
                        }}
                        className="px-2 py-1 text-[9px] font-mono bg-orange-950/40 hover:bg-orange-900/40 text-orange-300 rounded border border-orange-850/50 flex items-center gap-1 transition-all"
                        id={`btn-sim-id-sell-${market.symbol.replace('=','')}`}
                      >
                        <Play size={8} fill="currentColor" />
                        Sim ID Break Short
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
