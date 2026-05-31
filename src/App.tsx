import React, { useState, useEffect } from 'react';
import { Clock, Zap, MessageSquare, AlertTriangle, LogOut, Settings, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useEconomicNews } from './hooks/useEconomicNews';
import { useSound } from './hooks/useSound';

import AutomateDashboard from './components/AutomateDashboard';
import LoginScreen from './components/LoginScreen';
import GlobalSettings from './components/GlobalSettings';
import SignalBar from './components/SignalBar';
import MinimalAITutor from './components/MinimalAITutor';
import TopNavWidgets from './components/TopNavWidgets';
import AboutSection from './components/AboutSection';
import { WebSocketProvider } from './context/WebSocketContext';
import ErrorBoundary from './components/ErrorBoundary';

// ── Global fetch wrapper — handles 401 session expiry silently ───────────────
async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    console.warn('[Auth] Session expired — redirecting to login.');
    window.location.reload();
  }
  return res;
}

export default function App() {
  const { playClick } = useSound();
  const { activeWarning } = useEconomicNews();
  const [authUser, setAuthUser] = useState<any | null | undefined>(undefined);
  const [showAITutor, setShowAITutor] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then(data => {
        if (data?.success && data.user) {
          setAuthUser(data.user);
        } else {
          setAuthUser(null);
        }
      })
      .catch(() => setAuthUser(null));
  }, []);

  // Polling for MetaAPI status and clock has been moved to TopNavWidgets.tsx
  // to prevent the entire React app from re-rendering every 1 second.

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      setAuthUser(null);
    }
  };

  if (authUser === undefined) {
    return (
      <div className="min-h-screen bg-[#070913] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authUser) {
    return <LoginScreen onLoginSuccess={setAuthUser} />;
  }

  return (
    <ErrorBoundary>
      <WebSocketProvider authUser={authUser}>
        <div className={`min-h-screen ${activeWarning ? 'bg-red-950/80 transition-colors duration-1000' : 'bg-[#030508]'} text-slate-300 font-sans antialiased pb-12 selection:bg-emerald-500/30 relative overflow-x-hidden`}>
      <div className={`fixed inset-0 z-0 pointer-events-none transition-colors duration-1000 ${activeWarning ? 'bg-red-900/30' : ''}`} style={{
        backgroundImage: activeWarning ? 'none' : 'url(/images/sniper_math_bg_1780240055646.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
        opacity: 0.35
      }} />
      <div className={`fixed inset-0 z-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] ${activeWarning ? 'from-red-900/30 via-red-950/80 to-[#2e0404] transition-colors duration-1000' : 'from-emerald-900/10 via-[#030508]/80 to-[#030508]'}`} />

      <div className="relative z-10">
        <AnimatePresence>
          {activeWarning && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="bg-red-600 text-white overflow-hidden shadow-[0_0_30px_rgba(220,38,38,0.5)] border-b border-red-500 relative z-[60]"
            >
              <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex items-center justify-center gap-3">
                <AlertTriangle size={20} className="animate-ping" />
                <span className="font-display font-black tracking-widest uppercase text-sm sm:text-base">High-Impact News Alert</span>
                <span className="font-mono text-xs sm:text-sm bg-red-800/80 px-3 py-1 rounded-full border border-red-500 shadow-inner">
                  {activeWarning.event.event} ({activeWarning.event.currency})
                </span>
                <span className="font-bold text-sm hidden sm:inline-block">
                  — {activeWarning.status === 'UPCOMING' ? `in ${activeWarning.minutesLeft}m` : 'Recently active'}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div className={`${activeWarning ? 'bg-red-950/60 border-red-900/50' : 'bg-slate-900/50 border-slate-850'} border-b backdrop-blur-xl sticky top-0 z-50 transition-colors duration-1000`}>
          <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative group">
                <div className="absolute inset-0 bg-[rgba(212,175,55,1)] rounded-xl blur opacity-20 group-hover:opacity-40 transition-opacity" />
                <div className="relative w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md ring-1 ring-white/20 overflow-hidden">
                  <img src="/images/bot_sniper_1780109384823.png" alt="Sniper Trader" className="w-full h-full object-cover" />
                </div>
              </div>
              <div>
                <h1 className="font-display font-extrabold text-xs sm:text-sm tracking-tight text-white uppercase flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                  <span className="flex items-center gap-2">Sniper Trader</span>
                  <button className="text-[9px] cursor-default uppercase tracking-widest font-black px-2 py-0.5 border rounded shadow-[0_0_10px_rgba(99,102,241,0.2)] transition-colors text-emerald-300 border-emerald-400/30 bg-emerald-950/50 hidden">
                    Connected
                  </button>
                </h1>
                <p className={`text-[10px] ${activeWarning ? 'text-red-300/80 font-bold' : 'text-slate-500'} font-mono mt-0.5 uppercase tracking-wide`}>
                  Automated Trading Engine & AI Mentorship
                </p>
              </div>
            </div>
            
            <div className="flex gap-2 items-center flex-wrap">
              <TopNavWidgets />

              <button
                onClick={() => { playClick(); setShowAITutor(true); }}
                title="AI Tutor"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 hover:bg-[#d4af37]/20 hover:border-[#d4af37]/50 text-slate-400 hover:text-[#d4af37] text-[10px] font-mono uppercase tracking-wider transition-all"
              >
                <MessageSquare size={12} />
                AI Tutor
              </button>

              <button
                onClick={() => { playClick(); setShowAbout(true); }}
                title="About"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 hover:bg-[#d4af37]/20 hover:border-[#d4af37]/50 text-slate-400 hover:text-[#d4af37] text-[10px] font-mono uppercase tracking-wider transition-all"
              >
                <Info size={12} />
                About
              </button>

              <button
                onClick={() => { playClick(); setShowGlobalSettings(true); }}
                title="Global Settings"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 hover:bg-[#d4af37]/20 hover:border-[#d4af37]/50 text-slate-400 hover:text-[#d4af37] text-[10px] font-mono uppercase tracking-wider transition-all"
              >
                <Settings size={12} />
                Settings
              </button>

              <button
                onClick={handleLogout}
                title={`Logout (${authUser.email})`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 hover:bg-rose-900/40 hover:border-rose-700/50 text-slate-400 hover:text-rose-400 text-[10px] font-mono uppercase tracking-wider transition-all"
              >
                <LogOut size={12} />
                Logout
              </button>
            </div>
          </div>
        </div>
        
        {/* Signal Bar directly under header */}
        <SignalBar />

        <AnimatePresence>
          {showGlobalSettings && (
            <GlobalSettings 
              onClose={() => setShowGlobalSettings(false)} 
              onLogout={handleLogout} 
            />
          )}
        </AnimatePresence>

        <main className="max-w-7xl mx-auto px-4 mt-6 sm:px-6 lg:px-8">
          <div className="mb-8">
            <AutomateDashboard />
          </div>
        </main>

        <AnimatePresence>
          {showAITutor && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAITutor(false)} />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-slate-900 border border-slate-700 p-2 sm:p-6 rounded-2xl w-full max-w-5xl relative z-10 shadow-2xl max-h-[95vh] overflow-y-auto">
                <button onClick={() => setShowAITutor(false)} className="absolute top-4 right-4 z-50 text-slate-400 hover:text-white p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition-colors">
                  <X size={20} />
                </button>
                <MinimalAITutor />
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showAbout && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAbout(false)} />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-slate-900 border border-slate-700 p-2 sm:p-6 rounded-2xl w-full max-w-5xl relative z-10 shadow-2xl max-h-[95vh] overflow-y-auto">
                <button onClick={() => setShowAbout(false)} className="absolute top-4 right-4 z-50 text-slate-400 hover:text-white p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition-colors">
                  <X size={20} />
                </button>
                <AboutSection />
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <footer className="mt-12 text-center text-[11px] text-slate-600 font-mono">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2 border-t border-slate-900 pt-6 mb-4">
            <p>© 2026 Sniper Trader - by Tazim Sheikh Smart Money Mechanical Lab.</p>
            <div className="flex gap-4">
               <span className="text-slate-500 border-r border-slate-800 pr-4">Zero Indicators</span>
               <span className="text-slate-500 border-r border-slate-800 pr-4">Zero Retail Noise</span>
               <span className="text-emerald-500 font-bold">100% Math Rejections</span>
            </div>
          </div>
          <div className="max-w-5xl mx-auto px-4 pb-8 text-[9px] sm:text-[10px] text-slate-500/70 text-justify leading-relaxed">
            <p className="font-bold mb-1 text-slate-500">HIGH RISK INVESTMENT WARNING & LEGAL DISCLAIMER:</p>
            <p>
              Trading foreign exchange (Forex), cryptocurrencies, indices, and other financial instruments on margin carries a high level of risk and may not be suitable for all investors. The high degree of leverage can work against you as well as for you. Before deciding to invest, you should carefully consider your investment objectives, level of experience, and risk appetite. The possibility exists that you could sustain a loss of some or all of your initial investment; therefore, you should not invest money that you cannot afford to lose. 
            </p>
            <p className="mt-2">
              All statistics, win rates, analytics, and "bot metrics" displayed within the Sniper Trader application are derived from historical backtesting data or simulated algorithmic models and are provided strictly for educational and representational purposes. <strong>Past performance is never indicative of future results.</strong> The platform does not account for slippage, liquidity gaps, or catastrophic market anomalies perfectly. This application is an execution tool, not a financial advisor. By using this software, you acknowledge that all trading decisions are executed at your own risk. Tazim Sheikh and the developers of Sniper Trader are completely indemnified and hold no liability for any financial losses or damages incurred through the use of this software.
            </p>
          </div>
        </footer>
      </div>
          </div>
        </WebSocketProvider>
      </ErrorBoundary>
    );
}
