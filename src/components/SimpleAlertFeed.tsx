import React from 'react';
import { TrapSignal } from '../types';
import { Star, AlertCircle, ArrowRight, TrendingUp, TrendingDown, Clock, MoveRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SimpleAlertFeedProps {
  alerts: TrapSignal[];
  onSelectAdvanced: (signal: TrapSignal) => void;
}

export default function SimpleAlertFeed({ alerts, onSelectAdvanced }: SimpleAlertFeedProps) {

  const [isGapTime, setIsGapTime] = React.useState(false);

  React.useEffect(() => {
    const checkTiming = () => {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: 'numeric',
        minute: 'numeric'
      });
      const timeString = formatter.format(new Date());
      const [nyHoursStr, nyMinutesStr] = timeString.split(':');
      const nyHours = parseInt(nyHoursStr, 10);
      const nyMinutes = parseInt(nyMinutesStr, 10);
      const nyTotalMinutes = (nyHours === 24 ? 0 : nyHours) * 60 + nyMinutes;

      const isAsianSession = nyTotalMinutes >= (20 * 60) && nyTotalMinutes < (23 * 60);
      const isLondonSession = nyTotalMinutes >= (2 * 60) && nyTotalMinutes < (5 * 60);
      const isNYSession = nyTotalMinutes >= (8 * 60) && nyTotalMinutes < (11 * 60);

      setIsGapTime(!(isAsianSession || isLondonSession || isNYSession));
    };

    checkTiming();
    const interval = setInterval(checkTiming, 60000);
    return () => clearInterval(interval);
  }, []);

  const uniqueAlerts = React.useMemo(() => {
    const uniqueAlertsMap = new Map<string, TrapSignal>();
    for (const alert of alerts) {
      if (!uniqueAlertsMap.has(alert.symbol)) {
        uniqueAlertsMap.set(alert.symbol, alert);
      } else {
        const existing = uniqueAlertsMap.get(alert.symbol)!;
        const alertIsPreload = alert.id.startsWith('preload-');
        const existingIsPreload = existing.id.startsWith('preload-');

        if (alertIsPreload && !existingIsPreload) {
          uniqueAlertsMap.set(alert.symbol, alert);
        } else if (!alertIsPreload && existingIsPreload) {
          // Keep existing preload
        } else if (alert.grade > existing.grade) {
          uniqueAlertsMap.set(alert.symbol, alert);
        }
      }
    }
    
    // Sort by highest probability (grade) then by timestamp. Ensure preloads get a slight boost or keep as is.
    return Array.from(uniqueAlertsMap.values()).sort((a, b) => {
      if (b.grade !== a.grade) {
        return b.grade - a.grade;
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [alerts]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] w-full px-4 py-12">
      <div className="w-full max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12 text-slate-100 font-display space-y-3"
        >
          <div className="inline-flex items-center justify-center p-3 w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-[0_0_40px_rgba(99,102,241,0.4)] mb-4 ring-2 ring-indigo-400/50 ring-offset-4 ring-offset-slate-950">
            <AlertCircle size={32} className="text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-white to-slate-400">
            Active Setups
          </h1>
          <p className="text-slate-400 font-mono text-sm max-w-xl mx-auto uppercase tracking-widest">
            High-Conviction Structural Traps
          </p>
        </motion.div>

        {isGapTime ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-16 rounded-3xl bg-slate-900/40 border border-slate-800/60 backdrop-blur-xl text-center shadow-2xl"
          >
            <Clock size={48} className="text-slate-600 mx-auto mb-6" />
            <h3 className="text-2xl font-black tracking-widest text-slate-300 uppercase mb-2">No Signal</h3>
            <p className="text-slate-500 max-w-sm mx-auto font-mono text-sm leading-relaxed">
              MARKET IS OUTSIDE ACTIVE TRADING WINDOW. STRICT EXECUTION HALT.
            </p>
          </motion.div>
        ) : alerts.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-16 rounded-3xl bg-slate-900/40 border border-slate-800/60 backdrop-blur-xl text-center shadow-2xl"
          >
            <Clock size={48} className="text-slate-600 mx-auto mb-6" />
            <h3 className="text-xl font-bold text-slate-300">Searching for Setups</h3>
            <p className="text-slate-500 mt-2 max-w-sm mx-auto">
              Scanning the market for high-probability structural traps. Waiting for timing windows...
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AnimatePresence>
              {uniqueAlerts.map((alert, idx) => {
                const isBuy = alert.direction === 'BUY';
                
                // Animated styles based on status
                const isTradeNow = alert.status === 'Trade Now';
                const statusColor = isTradeNow 
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.2)]'
                  : alert.status === 'Get Ready'
                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-300 shadow-[0_0_30px_rgba(251,191,36,0.15)]'
                  : 'border-blue-500/30 bg-blue-500/5 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.1)]';

                return (
                  <motion.div
                    key={alert.symbol}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: idx * 0.1 }}
                    className={`relative overflow-hidden rounded-3xl border-2 backdrop-blur-xl ${statusColor} group transition-all duration-300 hover:-translate-y-1`}
                  >
                    {/* Glass glare effect */}
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                    <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent"></div>
                    
                    <div className="p-8">
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-2xl font-black text-white">{alert.displayName}</span>
                            <span className={`px-3 py-1 rounded-full text-xs font-black tracking-widest uppercase ${
                              isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                            }`}>
                              {alert.direction}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 font-mono">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                size={14}
                                className={i < alert.grade ? 'text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]' : 'text-slate-700/50'}
                              />
                            ))}
                          </div>
                        </div>

                        <div className={`flex flex-col items-end text-right p-3 rounded-2xl ${isTradeNow ? 'bg-emerald-500/20 ring-1 ring-emerald-500/30' : 'bg-slate-900/50 ring-1 ring-slate-800'}`}>
                          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-1">Status</span>
                          <span className={`font-black uppercase tracking-wider ${
                            isTradeNow ? 'text-emerald-400 animate-pulse' : 'text-white'
                          }`}>
                            {alert.status}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-4 mb-8">
                        <div>
                          <span className="text-xs font-mono text-slate-400 uppercase tracking-widest block mb-1">Pattern</span>
                          <span className="text-lg font-bold text-slate-200">{alert.pattern}</span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/50">
                            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-0.5">Trigger</span>
                            <span className="text-lg font-mono font-bold text-white">
                              {alert.triggerPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/50">
                            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-0.5">Key Level</span>
                            <span className="text-lg font-mono font-bold text-indigo-300">
                              {alert.levelType}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => onSelectAdvanced(alert)}
                        className="w-full relative overflow-hidden group/btn bg-slate-100 text-slate-900 font-bold text-sm py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-white transition-colors"
                      >
                        <span>Analyze in Education Mode</span>
                        <ArrowRight size={16} className="transition-transform group-hover/btn:translate-x-1" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
