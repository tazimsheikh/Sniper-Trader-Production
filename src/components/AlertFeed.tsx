import React, { useState, useEffect } from 'react';
import { TrapSignal } from '../types';
import { Award, Clock, ArrowRight, Star, AlertTriangle, Radio, Square } from 'lucide-react';

interface AlertFeedProps {
  alerts: TrapSignal[];
  onSelectSignal: (signal: TrapSignal) => void;
  activeSignalId?: string;
  selectedTimezone?: string;
}

const getMarketStatus = (tz: string = 'UTC') => {
  const now = new Date();
  const nyDate = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const nyDay = nyDate.getDay();
  const nyHour = nyDate.getHours();

  const istDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const istHour = istDate.getHours();

  const isWeekendClosure = (nyDay === 5 && nyHour >= 17) || (nyDay === 6) || (nyDay === 0 && nyHour < 17);
  const isISTMidnightClosure = (istHour === 23 || istHour === 0);

  if (isWeekendClosure) return { isOpen: false, reason: `Weekend Market Closure in ${tz}` };
  if (isISTMidnightClosure) return { isOpen: false, reason: `Midnight Trading Halt in ${tz}` };
  return { isOpen: true, reason: `Market Open` };
};

type TradePhase = 'pre-execution' | 'execution' | 'in-trade' | 'break-even' | 'closed';

const generateDynamicLifecycleUpdate = (alert: TrapSignal, newPhase: TradePhase, isFirstUpdateForPhase: boolean) => {
  const sl = alert.suggestedStopLoss || 15;
  const tp = alert.suggestedTakeProfit || 45;
  
  if (newPhase === 'pre-execution') {
    const scenarios = [
      `Price action is compressing near the ${alert.levelType || 'key'} trap level. Still waiting for the algorithmic trigger to execute.`,
      `Volume is drying up right at the trap boundary. The algorithmic entry is getting closer but no execution yet. Patience.`,
      `We remain in the pre-execution phase. Reviewing the plan: Stop loss will be placed at ${sl} pips and take profit at ${tp} pips once triggered.`,
      `The trap setup is taking a bit longer to form. This is normal. We wait for the breakout traders to be baited before stepping in.`
    ];
    return `Market update. ${scenarios[Math.floor(Math.random() * scenarios.length)]}`;
  }

  if (newPhase === 'execution' && isFirstUpdateForPhase) {
    return `EXECUTION TRIGGERED. The algorithmic trap has been set at the ${alert.levelType || 'extreme'}. We are now officially in the trade. Stop loss is active at ${sl} pips. Take profit is placed at ${tp} pips. Trade is ON.`;
  }

  if (newPhase === 'in-trade') {
    const scenarios = [
      "Trade is moving in our favor. The trapped traders are feeling the heat as price rotates.",
      "Price is consolidating inside the entry zone. This is normal algorithmic order collection.",
      "Momentum is pushing slightly against us, but our structural stop loss is safe behind the trap. Hold the line.",
      "The rotation is underway. Continuing to manage the trade and monitor volume signals."
    ];
    return `In-trade management update. ${scenarios[Math.floor(Math.random() * scenarios.length)]}`;
  }

  if (newPhase === 'break-even') {
    if (isFirstUpdateForPhase) {
      return `Management update. We have reached the 1-to-1 risk-reward threshold. Pulling stop loss to break even. All systemic risk is eliminated. Letting the remaining position run to final target of ${tp} pips.`;
    } else {
      return `Still holding break even. Price is attempting to push toward the final take profit of ${tp} pips.`;
    }
  }

  if (newPhase === 'closed' && isFirstUpdateForPhase) {
    const scenarios = [
      `Extreme volume spike! The retail liquidation cascade has hit our target. TRADE IS OFF. We just secured ${tp} pips. Great execution. Turning off broadcast for this setup.`,
      `Price cleanly rotated into our take profit level. TRADE IS OFF. Perfect algorithmic read. Broadcast will conclude now.`
    ];
    return scenarios[Math.floor(Math.random() * scenarios.length)];
  }

  return "Monitoring the market.";
};

export default function AlertFeed({
  alerts,
  onSelectSignal,
  activeSignalId,
  selectedTimezone = 'UTC'
}: AlertFeedProps) {
  const marketStatus = getMarketStatus(selectedTimezone);
  
  // Broadcast Integration State
  const [activeBroadcast, setActiveBroadcast] = useState<TrapSignal | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tradePhase, setTradePhase] = useState<TradePhase>('pre-execution');
  const [phaseTime, setPhaseTime] = useState(0);

  // Stop API on unmount
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);

  // Interval Engine
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (activeBroadcast && isPlaying) {
      interval = setInterval(() => {
        const ms = getMarketStatus(selectedTimezone);
        if (!ms.isOpen) {
          speakText(`Attention. Market is currently closed due to ${ms.reason}. Broadcast suspended.`);
          setIsPlaying(false);
          setActiveBroadcast(null);
          return;
        }

        setPhaseTime(p => p + 1);

        setTradePhase(currentPhase => {
          let nextPhase = currentPhase;
          let isFirst = false;
          
          if (currentPhase === 'pre-execution') {
            if (Math.random() > 0.4) { nextPhase = 'execution'; isFirst = true; }
          } else if (currentPhase === 'execution') {
            nextPhase = 'in-trade';
          } else if (currentPhase === 'in-trade') {
            if (Math.random() > 0.5) { nextPhase = 'break-even'; isFirst = true; }
          } else if (currentPhase === 'break-even') {
            if (Math.random() > 0.5) { nextPhase = 'closed'; isFirst = true; }
          } else if (currentPhase === 'closed') {
            return currentPhase;
          }

          const thesis = generateDynamicLifecycleUpdate(activeBroadcast, nextPhase, isFirst);
          speakText(thesis);
          
          if (nextPhase === 'closed' && isFirst) {
            setTimeout(() => setIsPlaying(false), 30000); 
          }
          return nextPhase;
        });
      }, 60000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [activeBroadcast, isPlaying, selectedTimezone]);

  const speakText = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const desiredVoice = voices.find(v => v.lang.startsWith('en-US')) || voices[0];
    if (desiredVoice) utterance.voice = desiredVoice;
    utterance.rate = 1.0;
    utterance.pitch = 0.95;
    utterance.onstart = () => setIsPlaying(true);
    utterance.onerror = () => setIsPlaying(false);
    
    // Slight delay so the sound plays better occasionally
    window.speechSynthesis.speak(utterance);
  };

  const handleTuneIn = (alert: TrapSignal) => {
    const ms = getMarketStatus(selectedTimezone);
    if (!ms.isOpen) {
       setActiveBroadcast(alert);
       speakText(`Tuning into ${alert.displayName}. However, the market is currently closed due to ${ms.reason}. Executions are currently halted.`);
       return;
    }

    setActiveBroadcast(alert);
    setIsPlaying(true);
    setTradePhase('pre-execution');
    setPhaseTime(0);
    
    const sl = alert.suggestedStopLoss || 15;
    const tp = alert.suggestedTakeProfit || 45;
    const announcement = `Tuning into ${alert.displayName} frequency. ${alert.details} The current setup is a ${alert.tutorAnalysis?.setupType || alert.status}. The grade is ${alert.grade} stars out of 5 for the ${alert.timingGate} timing gate. Market is open and active. Entering pre-execution monitoring phase. Projected stop loss is ${sl} units, and targeted take profit is ${tp} units. I will provide dynamic updates as algorithmic events trigger. Standby.`;
    speakText(announcement);
  };

  const stopBroadcast = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsPlaying(false);
    setActiveBroadcast(null);
  };

  return (
    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-700/50 rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.5)] ring-1 ring-white/5 flex flex-col h-full mt-4">
      <div className="p-4 bg-slate-950/80 border-b border-slate-800/65 flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-bold tracking-tight text-white flex items-center gap-2">
            {marketStatus.isOpen ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
            ) : (
              <AlertTriangle size={14} className="text-amber-500" />
            )}
            Signal
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 font-mono bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20">
          <span>{alerts.length} Detects</span>
        </div>
      </div>

      {activeBroadcast && isPlaying && (
          <div className="bg-emerald-950/30 border-b border-emerald-500/20 p-3 flex items-center justify-between px-4">
             <div className="flex items-center gap-3">
               <Radio size={16} className="text-emerald-400 animate-pulse" />
               <div>
                  <span className="text-xs font-bold text-emerald-400">LIVE BROADCAST: {activeBroadcast.displayName}</span>
                  <div className="text-[10px] text-emerald-500/70 font-mono uppercase">PHASE: {tradePhase.replace('-', ' ')}</div>
               </div>
             </div>
             <button
                onClick={stopBroadcast}
                className="px-3 py-1.5 bg-slate-900/40 border border-slate-700 rounded text-xs text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40 flex items-center gap-1.5 transition-colors"
             >
                <Square size={10} fill="currentColor" /> Stop
             </button>
          </div>
      )}

      <div className="flex-1 divide-y divide-slate-800/50 overflow-y-auto max-h-[520px]">
        {alerts.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <Award size={48} className="text-slate-700 mb-4" />
            <h3 className="text-sm font-bold text-slate-400 font-display">No valid setups detected</h3>
            <p className="text-xs text-slate-500 mt-2 font-mono">Algorithms are scanning for structural extremes.</p>
          </div>
        ) : (
          alerts.map((alert) => {
            const isSelected = alert.id === activeSignalId;
            const isBuy = alert.direction === 'BUY';
            const isThisPlaying = activeBroadcast?.id === alert.id && isPlaying;
            
            const timingColor = 
              alert.timingGate === '10:00 AM Club' ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20 shadow-[0_0_8px_rgba(99,102,241,0.05)]' :
              alert.timingGate === 'COMEX Open' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
              alert.timingGate === 'London Session' ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' :
              alert.timingGate === 'Asian Session' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' :
              alert.timingGate === 'Equity Open Box' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
              alert.timingGate === 'Major News Spike' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
              alert.timingGate === 'New York Session' ? 'text-sky-400 bg-sky-500/10 border-sky-500/20' :
              'text-slate-400 bg-slate-500/10 border-slate-500/20';

            const statusStyle = 
              alert.status === 'Trade Now' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-550/30 font-black animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.15)]' :
              alert.status === 'Get Ready' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20 font-bold' :
              alert.status === 'Wait' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/25' :
              'bg-slate-800/40 text-slate-500 border border-slate-800/70/50 opacity-60';

            return (
              <div
                key={alert.id}
                className={`p-4 transition-all ${
                  isSelected ? 'bg-indigo-600/10 border-r-4 border-indigo-550 shadow-[inset_-4px_0_12px_rgba(99,102,241,0.05)]' : 'hover:bg-slate-900/40'
                } ${isThisPlaying ? 'bg-emerald-950/20 border-l-2 border-emerald-500' : ''}`}
                id={`alert-card-${alert.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-display font-bold text-slate-100">{alert.displayName}</span>
                      <span className={`text-[9px] font-black font-mono px-2 py-0.5 rounded ${
                        isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                      }`}>
                        {alert.direction}
                      </span>
                      <span className={`text-[9px] font-semibold font-mono px-1.5 py-0.5 rounded border ${timingColor}`}>
                        {alert.timingGate}
                      </span>
                      {alert.status && (
                        <span className={`text-[9px] font-mono px-2 py-0.5 rounded border uppercase tracking-wider ${statusStyle}`}>
                          ● {alert.status}
                        </span>
                      )}
                    </div>

                    <h3 className="text-xs font-bold text-slate-105 mt-1.5 flex items-center gap-1.5">
                      {alert.pattern}
                    </h3>
                    
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">
                      {alert.details}
                    </p>

                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-[11px] font-mono text-slate-400">
                      <div>
                        <span className="text-slate-500">Trigger:</span>{' '}
                        <span className="text-slate-200 font-bold">
                          {alert.triggerPrice.toLocaleString(undefined, { minimumFractionDigits: alert.symbol.includes('NQ=F') || alert.symbol.includes('GC=F') ? 2 : 4 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">At Level:</span>{' '}
                        <span className="text-indigo-400 font-bold">
                          {alert.levelType} ({alert.keyLevel.toLocaleString(undefined, { minimumFractionDigits: alert.symbol.includes('NQ=F') || alert.symbol.includes('GC=F') ? 2 : 4 })})
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2.5">
                    {/* Star scale indicator */}
                    <div className="flex items-center gap-0.5 font-mono">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          size={11}
                          className={
                            i < alert.grade
                              ? 'text-amber-400 fill-amber-400'
                              : 'text-slate-800'
                          }
                        />
                      ))}
                      <span className="text-[10px] font-bold text-slate-400 ml-1">
                        {alert.grade === 5 ? 'ACB' : alert.grade === 4 ? 'Weekly' : alert.grade === 3 ? 'Signal' : alert.grade === 2 ? 'Base' : 'Scalp'}
                      </span>
                    </div>

                    <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                      <Clock size={11} />
                      {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>

                    <div className="flex items-center gap-2 mt-1">
                       {isThisPlaying ? (
                          <button
                           onClick={stopBroadcast}
                           className="px-2 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-rose-400 font-display rounded-lg shadow-md flex items-center justify-center transition-all cursor-pointer border border-rose-500/30"
                           title="Stop Broadcast"
                          >
                           <Square size={12} fill="currentColor" />
                          </button>
                       ) : (
                          <button
                           onClick={() => handleTuneIn(alert)}
                           className="px-2 py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-emerald-400 font-mono rounded-lg shadow-md flex items-center justify-center transition-all cursor-pointer border border-emerald-500/30"
                           title="Tune In"
                          >
                           <Radio size={14} className="" />
                          </button>
                       )}
                       
                      <button
                        onClick={() => onSelectSignal(alert)}
                        className="px-3 py-1.5 text-[11px] font-semibold bg-indigo-650 hover:bg-indigo-600 text-white font-display rounded-lg shadow-md shadow-indigo-600/10 flex items-center gap-1 transition-all cursor-pointer whitespace-nowrap"
                        id={`btn-tutor-select-${alert.id}`}
                      >
                        <span>Talk to coach</span>
                        <ArrowRight size={12} className="stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
