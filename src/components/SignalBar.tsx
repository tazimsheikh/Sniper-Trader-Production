import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, Zap, TrendingUp, LogOut, CheckCircle, AlertTriangle } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketContext';

interface BotState {
  id: string;
  symbol: string;
  status: 'watching' | 'ready' | 'in_trade' | 'exiting' | 'closed';
  details: string;
}

export default function SignalBar() {
  const [bots, setBots] = useState<BotState[]>([]);

  const { socket } = useWebSocket();

  const fetchBotStates = async () => {
    try {
      const res = await fetch('/api/bots/live-status');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setBots(data.data);
        }
      }
    } catch (err) {
      // silent fail
    }
  };

  useEffect(() => {
    fetchBotStates();

    if (socket) {
      // Event-driven refetching instead of constant polling
      socket.on('trade_opened', fetchBotStates);
      socket.on('trade_closed', fetchBotStates);
      // We can also poll gently every 30s just in case, instead of every 2s
      const fallback = setInterval(fetchBotStates, 30000);
      
      return () => {
        socket.off('trade_opened', fetchBotStates);
        socket.off('trade_closed', fetchBotStates);
        clearInterval(fallback);
      };
    }
  }, [socket]);

  if (bots.length === 0) {
    return null;
  }

  const getStatusConfig = (status: BotState['status']) => {
    switch (status) {
      case 'watching': return { icon: Eye, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
      case 'ready': return { icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' };
      case 'in_trade': return { icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
      case 'exiting': return { icon: LogOut, color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30' };
      case 'closed': return { icon: CheckCircle, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30' };
      default: return { icon: AlertTriangle, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30' };
    }
  };

  return (
    <div className="bg-slate-950 border-y border-slate-800 py-2 px-4 overflow-hidden relative flex items-center shadow-inner">
      <div className="text-[9px] font-black uppercase text-indigo-500 tracking-widest mr-4 shrink-0 flex items-center gap-1.5">
        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
        LIVE BOT FEED
      </div>
      
      {/* Ticker / Bar */}
      <div className="flex-1 flex gap-3 overflow-x-auto no-scrollbar scroll-smooth items-center">
        <AnimatePresence>
          {bots.map(bot => {
            const config = getStatusConfig(bot.status);
            const Icon = config.icon;
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`flex shrink-0 items-center gap-2 px-2.5 py-1 rounded-md border ${config.bg} ${config.border}`}
              >
                <Icon size={12} className={config.color} />
                <span className="font-bold text-[10px] text-slate-200">{bot.symbol}</span>
                <span className={`text-[9px] uppercase tracking-wider font-mono ${config.color}`}>
                  {bot.status.replace('_', ' ')}
                </span>
                {bot.details && (
                  <span className="text-[9px] text-slate-400 ml-1 truncate max-w-[150px]">
                    - {bot.details}
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
