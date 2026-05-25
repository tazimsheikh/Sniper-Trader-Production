import React, { useState, useMemo } from 'react';
import { Clock, ShieldAlert, AlertTriangle, Info, Calendar, Target, CheckCircle2, ShieldCheck, Filter, MessageSquare, Play, Sparkles } from 'lucide-react';
import { useEconomicNews, NewsEvent } from '../hooks/useEconomicNews';

interface EconomicCalendarProps {
  selectedTimezone?: string;
}

export default function EconomicCalendar({ selectedTimezone = 'UTC' }: EconomicCalendarProps) {
  const { events, activeWarning, currentTime } = useEconomicNews();
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [impactFilter, setImpactFilter] = useState<'ALL' | 'HIGH' | 'MID' | 'LOW'>('ALL');
  
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activeSummaryUrl, setActiveSummaryUrl] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);

  const availableDates = useMemo(() => {
    const datesSet = new Set<string>();
    events.forEach(e => datesSet.add(e.date)); // e.date is YYYY-MM-DD
    return Array.from(datesSet).sort();
  }, [events]);

  React.useEffect(() => {
     if (availableDates.length > 0 && !selectedDateStr) {
        const todayStr = new Date().toISOString().split('T')[0];
        if (availableDates.includes(todayStr)) {
            setSelectedDateStr(todayStr);
        } else {
            // Find closest date to today
            const todayTime = new Date(todayStr).getTime();
            let closest = availableDates[0];
            let minDiff = Math.abs(new Date(closest).getTime() - todayTime);
            for (let i = 1; i < availableDates.length; i++) {
                const diff = Math.abs(new Date(availableDates[i]).getTime() - todayTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = availableDates[i];
                }
            }
            setSelectedDateStr(closest);
        }
     }
  }, [availableDates, selectedDateStr]);

  const formatDateLabel = (ds: string) => {
     const d = new Date(ds);
     return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
  };

  const formatEventTime = (timeUTC: string) => {
    const [hours, minutes] = timeUTC.split(':').map(Number);
    const date = new Date();
    date.setUTCHours(hours, minutes, 0, 0);

    let tzString = 'UTC';
    if (selectedTimezone === 'IST') tzString = 'Asia/Kolkata';
    else if (selectedTimezone === 'EST') tzString = 'America/New_York';
    else if (selectedTimezone === 'GMT') tzString = 'Europe/London';
    else if (selectedTimezone === 'JST') tzString = 'Asia/Tokyo';
    else if (selectedTimezone === 'AEDT') tzString = 'Australia/Sydney';

    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tzString
    });
  };

  const getImpactBadge = (impact: NewsEvent['impact']) => {
    switch (impact) {
      case 'HIGH':
        return (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-black animate-pulse">
            HIGH IMPACT
          </span>
        );
      case 'MID':
        return (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-bold">
            MID IMPACT
          </span>
        );
      default:
        return (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            LOW IMPACT
          </span>
        );
    }
  };

  const getDeviationStyle = (dev: NewsEvent['deviation']) => {
    if (dev === 'positive') return 'text-emerald-400 font-bold';
    if (dev === 'negative') return 'text-rose-400 font-bold';
    return 'text-white';
  };

  const filteredEvents = useMemo(() => {
    if (!selectedDateStr) return [];
    let result = events.filter(e => e.date === selectedDateStr);
    if (impactFilter !== 'ALL') {
      result = result.filter(e => e.impact === impactFilter);
    }
    // Sort chronologically ascending
    result.sort((a, b) => {
        const aT = parseInt(a.timeUTC.replace(':',''));
        const bT = parseInt(b.timeUTC.replace(':',''));
        return aT - bT;
    });
    return result;
  }, [events, selectedDateStr, impactFilter]);

  const handleAskAI = async (evt: NewsEvent) => {
     setActiveSummaryUrl(evt.id);
     setSummaryLoading(true);
     setSummaryText(null);
     
     try {
       const prompt = `Can you give a brief summary of what the ${evt.currency} ${evt.event} is, and how it will generally affect the financial market (especially the currency it is tied to)? Keep it under 4 sentences. Make it professional and objective.`;
       
       const res = await fetch('/api/tutor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, history: [] })
       });
       const data = await res.json();
       if (data.success && data.response) {
          setSummaryText(data.response);
       } else {
          setSummaryText("Failed to retrieve intelligence from AI core.");
       }
     } catch(e) {
       setSummaryText("Temporary connection block to AI core.");
     }
     setSummaryLoading(false);
  };

  return (
    <div id="economic-calendar-container" className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl shadow-[0_8px_30px_rgb(0,0,0,0.5)]">
      <div className="bg-slate-900/50 flex flex-col">
        {/* Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800/65 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
              <Calendar size={16} />
            </div>
            <div>
              <h2 className="font-display font-bold text-slate-100 text-sm">Economic & Macro Releases</h2>
              <p className="text-[10px] text-slate-500 font-mono">LIVE GMT/UTC ROTATIONS (WEEK VIEW)</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1.5">
                <Filter size={12}/> Filter:
             </div>
             <select 
               value={impactFilter}
               onChange={(e) => setImpactFilter(e.target.value as any)}
               className="bg-slate-800 border border-slate-700 text-indigo-300 rounded text-xs px-2 py-1 outline-none font-bold cursor-pointer"
             >
                <option value="ALL">ALL IMPACTS</option>
                <option value="HIGH">HIGH IMPACT</option>
                <option value="MID">MID IMPACT</option>
                <option value="LOW">LOW IMPACT</option>
             </select>
          </div>
        </div>
        
        {/* Dates Horizontal Tabs */}
        <div className="flex overflow-x-auto bg-slate-950/80 border-b border-slate-800 p-2 hide-scrollbar scroll-smooth" id="date-scroll-container">
           {availableDates.map(d => {
              const isSelected = selectedDateStr === d;
              const isToday = d === new Date().toISOString().split('T')[0];
              return (
              <button
                key={d}
                onClick={() => setSelectedDateStr(d)}
                ref={isSelected ? (el: HTMLButtonElement | null) => {
                   if (el && !el.dataset.scrolled) {
                       el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                       el.dataset.scrolled = 'true';
                   }
                } : undefined}
                className={`flex flex-col items-center justify-center px-4 py-1.5 mx-1 tracking-tight rounded-lg transition-colors whitespace-nowrap min-w-[90px] border ${
                    isSelected 
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-md' 
                      : isToday
                      ? 'bg-slate-900 border-slate-700 text-indigo-300 hover:bg-slate-800'
                      : 'bg-slate-950 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <span className={`text-[10px] font-mono leading-none mb-1 uppercase ${isSelected ? 'text-indigo-200' : isToday ? 'text-indigo-400/70' : 'text-slate-500'}`}>
                  {isToday ? 'TODAY' : new Date(d).toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                <span className="font-display font-bold text-xs leading-none">
                  {new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </button>
              );
           })}
        </div>

        {/* Warning Box overlay */}
        {activeWarning ? (
          <div className="p-3 bg-red-950/40 border-b border-red-500/20 flex items-start gap-2.5 animate-pulse">
            <AlertTriangle className="text-rose-500 flex-shrink-0 mt-0.5" size={16} />
            <div className="flex-1">
              <div className="text-[11px] font-bold text-rose-300 font-mono uppercase tracking-wider">
                🛑 {activeWarning.status === 'UPCOMING' ? `HIGH RISK NEWS INBOUND (${activeWarning.minutesLeft}m Left)` : `HIGH VOLATILITY WINDOW ACTIVE (${activeWarning.minutesPassed}m Passed)`}
              </div>
              <p className="text-[10.5px] text-slate-300 leading-relaxed mt-1">
                **{activeWarning.event.currency} {activeWarning.event.event}** is active at **{activeWarning.event.timeUTC} UTC**.
                <br />
                <span className="text-amber-400 font-semibold font-mono text-[9px] uppercase tracking-wide">
                  Sniper Warning: Zero trade entries on currencies with scheduled news within 30m before / 15m after the hour!
                </span>
              </p>
            </div>
          </div>
        ) : (
          <div className="p-2 bg-slate-950/40 border-b border-slate-800/40 flex items-center justify-center gap-2">
            <ShieldCheck className="text-emerald-500 flex-shrink-0" size={13} />
            <span className="text-[10px] text-slate-400 font-mono">
              Safe technical window active.
            </span>
          </div>
        )}

        {/* Calendar Items Table */}
        <div className="p-4 space-y-3 overflow-y-auto" style={{ height: 'max(400px, 60vh)' }}>
          {filteredEvents.length === 0 && (
             <div className="text-center py-10 font-mono text-slate-500 text-xs">
                 No {impactFilter !== 'ALL' ? impactFilter : ''} releases scheduled for {selectedDateStr ? formatDateLabel(selectedDateStr) : ''}.
             </div>
          )}
          {filteredEvents.map((evt) => {
            const isPassed = evt.actual !== null;

            return (
               <div key={evt.id} className="flex flex-col gap-2">
                  <div 
                    className={`p-3 rounded-lg border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isPassed 
                        ? 'bg-slate-950/20 border-slate-800/50 opacity-65' 
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Event descriptors */}
                    <div className="flex items-start gap-2.5">
                      <div className="text-center bg-slate-950/80 border border-slate-800 px-1.5 py-1 rounded font-mono">
                        <div className="text-[10px] font-bold text-white">{formatEventTime(evt.timeUTC)}</div>
                        <div className="text-[8px] text-indigo-400 font-bold uppercase tracking-wide">{selectedTimezone}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-black text-slate-200 font-mono bg-slate-800/10 px-1 py-0.5 rounded border border-slate-700">
                            {evt.currency}
                          </span>
                          <h4 className="text-xs font-bold text-white leading-tight cursor-default">
                            {evt.event}
                          </h4>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {getImpactBadge(evt.impact)}
                          <button 
                            onClick={() => handleAskAI(evt)}
                            className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
                          >
                            <Sparkles size={10} /> AI Summary
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Event indicators forecast / actual */}
                    <div className="flex items-center gap-4 bg-slate-950/60 border border-slate-900/40 px-3 py-1.5 rounded-lg select-none font-mono">
                      <div className="text-center">
                        <div className="text-[8px] text-slate-500">FORECAST</div>
                        <div className="text-[10px] font-bold text-slate-300">{evt.forecast}</div>
                      </div>
                      <div className="border-r border-slate-800/80 h-6" />
                      <div className="text-center">
                        <div className="text-[8px] text-slate-500">PREVIOUS</div>
                        <div className="text-[10px] font-bold text-slate-400">{evt.previous}</div>
                      </div>
                      <div className="border-r border-slate-800/80 h-6" />
                      <div className="text-center min-w-[45px]">
                        <div className="text-[8px] text-slate-500">ACTUAL</div>
                        <div className={`text-[11px] ${isPassed ? getDeviationStyle(evt.deviation) : 'text-slate-500 italic text-[9px]'}`}>
                          {isPassed ? evt.actual : 'Pending'}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* AI Summary Expansion Box */}
                  {activeSummaryUrl === evt.id && (
                     <div className="bg-slate-950/80 border border-indigo-500/30 rounded-lg p-3 ml-10 mb-2 relative animate-fade-in shadow-[inset_4px_0_0_#4f46e5]">
                        {summaryLoading ? (
                           <div className="flex items-center gap-2 text-indigo-400 text-[10px] font-mono animate-pulse">
                              <Sparkles size={12} className="opacity-50" />
                              Compiling intelligence report...
                           </div>
                        ) : (
                           <div>
                              <div className="text-[10px] flex items-center font-bold text-indigo-400 font-mono tracking-widest uppercase mb-1">
                                <MessageSquare size={10} className="mr-1.5" /> AI Impact Analysis
                              </div>
                              <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                                {summaryText}
                              </p>
                              <button onClick={() => setActiveSummaryUrl(null)} className="absolute top-2 right-2 text-slate-500 hover:text-slate-300">
                                 &times;
                              </button>
                           </div>
                        )}
                     </div>
                  )}
               </div>
            );
          })}
        </div>

        {/* News Restriction Rule Footnote */}
        <div className="p-3 mt-auto bg-slate-950 border-t border-slate-800 flex items-center gap-2">
          <Info className="text-indigo-400 flex-shrink-0" size={13} />
          <span className="text-[8px] font-mono text-slate-500 leading-snug uppercase">
            Rule 1: Never trade news. Let high-impact numbers clear existing stops, establish daily extremes, and enter of the 3-push correction!
          </span>
        </div>
      </div>
    </div>
  );
}
