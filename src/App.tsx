import React, { useState, useEffect } from 'react';
import { Zap, AlertTriangle, LogOut, Settings, Info, X, Power } from 'lucide-react';
import { motion, AnimatePresence, useAnimation } from 'motion/react';
import { useEconomicNews } from './hooks/useEconomicNews';
import { useSound } from './hooks/useSound';

import LoginScreen from './components/LoginScreen';
import GlobalSettings from './components/GlobalSettings';
import { WebSocketProvider, useWebSocket } from './context/WebSocketContext';
import ErrorBoundary from './components/ErrorBoundary';

import BotDashboard from './components/BotDashboard';

export const MAGE_BOT = { 
  id: 'mage', 
  name: 'The Mage', 
  type: 'vision', 
  head: 'vision', 
  color: 'text-purple-400', 
  border: 'border-purple-500/30', 
  bg: 'bg-purple-900/30', 
  shadow: 'shadow-[0_0_20px_rgba(168,85,247,0.2)]', 
  image: '/images/mage_bg.png', 
  tag: 'Opening Range Specialist', 
  desc: 'Trades institutional breakouts from the opening range with extreme precision.' 
};

export const SEER_BOT = { 
  id: 'seer', 
  name: 'The Seer', 
  type: 'discretionary_trader', 
  head: 'vision', 
  color: 'text-rose-400', 
  border: 'border-rose-500/30', 
  bg: 'bg-rose-900/30', 
  shadow: 'shadow-[0_0_20px_rgba(244,63,94,0.2)]', 
  image: '/images/seer_bg.png', 
  tag: 'Unified Vision Engine', 
  desc: 'Executes Stacy Burke setups with deep AI pattern recognition.' 
};

export const SAGE_BOT = {
  id: 'sage',
  name: 'The Sage',
  type: 'discretionary_trader',
  head: 'vision',
  color: 'text-emerald-400',
  border: 'border-emerald-500/30',
  bg: 'bg-emerald-900/30',
  shadow: 'shadow-[0_0_20px_rgba(16,185,129,0.2)]',
  image: '/images/sage_bg.png',
  tag: 'Reversal Specialist',
  desc: 'Trades strict math-based reversals against retail breakout traps.'
};

const BotCard: React.FC<{ bot: any, onClick: () => void }> = ({ bot, onClick }) => {
  const { socket, isConnected } = useWebSocket();
  const { playClick } = useSound();
  const [isRunning, setIsRunning] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);

  useEffect(() => {
    const handleProfileChanged = async () => {
      try {
        const res = await fetch('/api/auth/profiles', { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.success || !data.profiles || data.profiles.length === 0) return;

        const savedId = localStorage.getItem('lastSelectedProfileId');
        let pId: number;
        if (savedId) {
          const parsedId = parseInt(savedId);
          const stillValid = data.profiles.find((x: any) => x.id === parsedId);
          pId = stillValid ? parsedId : data.profiles[0].id;
        } else {
          pId = data.profiles[0].id;
        }
        localStorage.setItem('lastSelectedProfileId', pId.toString());
        setProfileId(pId);
      } catch {
        setProfileId(null);
      }
    };
    handleProfileChanged();
    window.addEventListener('profileChanged', handleProfileChanged);
    return () => window.removeEventListener('profileChanged', handleProfileChanged);
  }, []);

  useEffect(() => {
    if (!socket || !profileId || !isConnected) return;
    
    // Join the profile socket room to receive broadcasts
    socket.emit('join_profile', profileId.toString());
    
    const eventPrefix = 'discretionary_trader';

    const handleStatus = (data: any) => {
      let isMeRunning = (data.activeBots || []).includes(bot.id);
      setIsRunning(isMeRunning);
    };

    socket.on(`${eventPrefix}:status`, handleStatus);
    socket.emit(`${eventPrefix}:get_status`, { profileId, botId: bot.id });

    return () => {
      socket.off(`${eventPrefix}:status`, handleStatus);
    };
  }, [socket, profileId, isConnected, bot.id]);

  const toggleEngine = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    playClick();
    if (!socket || !profileId) return;
    
    const newActive = !isRunning;
    setIsRunning(newActive); // Optimistic
    
    const eventPrefix = 'discretionary_trader';
    if (newActive) {
      socket.emit(`${eventPrefix}:start`, { profileId, botId: bot.id });
      socket.emit(`${eventPrefix}:toggle_bot`, { profileId, botId: bot.id, active: true });
      setTimeout(() => {
        setIsRunning(prev => {
          socket.emit(`${eventPrefix}:get_status`, { profileId, botId: bot.id });
          return prev;
        });
      }, 5000);
    } else {
      socket.emit(`${eventPrefix}:toggle_bot`, { profileId, botId: bot.id, active: false });
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 backdrop-blur-md p-8 text-left transition-all duration-500 hover:scale-[1.02] hover:-translate-y-2 cursor-pointer ${bot.shadow}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${bot.id === 'seer' ? 'from-rose-500/10 to-orange-500/10' : 'from-purple-500/10 to-indigo-500/10'} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex justify-between items-start mb-2">
          <h3 className={`text-3xl font-black font-display uppercase tracking-widest ${bot.color} drop-shadow-[0_0_10px_currentColor]`}>
            {bot.name}
          </h3>
          <button 
            onClick={toggleEngine}
            className={`p-2 rounded-full transition-all duration-300 shadow-lg border relative z-20 ${
              isRunning 
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]' 
                : 'bg-black/40 text-slate-500 border-white/10 hover:border-white/30 hover:text-white'
            }`}
            title={isRunning ? "Banish (Stop)" : "Awaken (Start)"}
          >
            <Power size={20} className={isRunning ? 'animate-pulse' : ''} />
          </button>
        </div>
        <div className={`inline-block px-3 py-1 rounded border border-white/10 bg-black/60 font-mono text-xs mb-6 text-slate-300 self-start`}>
          {bot.tag}
        </div>
        <p className="text-sm text-slate-400 font-mono leading-relaxed max-w-[90%] mt-auto">
          {bot.desc}
        </p>
      </div>
      <div className="absolute right-0 bottom-0 opacity-10 blur-[2px] pointer-events-none translate-x-1/4 translate-y-1/4 group-hover:blur-0 group-hover:opacity-30 transition-all duration-700">
        <img src={bot.image} alt="" className="w-64 h-64 object-cover rounded-full mix-blend-screen" />
      </div>
    </div>
  );
};

const LivingBackground = React.memo(({ src, activeBot }: { src: string, activeBot: boolean }) => {
  const controls = useAnimation();

  useEffect(() => {
    let isMounted = true;
    const animateBg = async () => {
      // Start slightly zoomed in so panning doesn't show edges
      await controls.set({ scale: 1.15, x: '0%', y: '0%' });
      
      let movingDown = true;
      while (isMounted) {
        // Mostly Y movement, with random X and Scale
        // Scale between 1.15 and 1.35
        const nextScale = 1.15 + Math.random() * 0.2; 
        
        // Sweep Y top-to-bottom or bottom-to-top (up to 10% translation)
        const nextY = movingDown ? (4 + Math.random() * 6) : -(4 + Math.random() * 6);
        
        // Random X drift
        const nextX = (Math.random() - 0.5) * 8; 

        // Random duration between 8s and 15s for much faster movement
        const duration = 8 + Math.random() * 7;

        await controls.start({
          scale: nextScale,
          x: `${nextX}%`,
          y: `${nextY}%`,
          transition: { duration, ease: "easeInOut" }
        });
        
        movingDown = !movingDown; // Alternate direction
      }
    };
    
    animateBg();
    
    return () => { isMounted = false; controls.stop(); };
  }, [controls]);

  const isVideo = src.endsWith('.mp4') || src.endsWith('.webm');

  if (isVideo) {
    return (
      <motion.video 
        src={src} 
        autoPlay 
        loop 
        muted 
        playsInline
        onLoadedData={(e) => {
          e.currentTarget.playbackRate = 0.70; // 70% speed as requested
        }}
        className={`w-full object-cover origin-center ${!activeBot ? 'h-full opacity-20' : 'h-auto min-h-screen opacity-80'}`}
      />
    );
  }

  return (
    <motion.img 
      src={src} 
      alt="Background" 
      animate={controls}
      className={`w-full object-cover origin-center ${!activeBot ? 'h-full opacity-20' : 'h-auto min-h-screen opacity-80'}`}
      onLoad={(e) => {
        const img = e.currentTarget;
        const wrapper = img.parentElement;
        if (activeBot && img.naturalWidth > 0) {
          const w = img.naturalWidth;
          const h = img.naturalHeight * 0.95; // Cut exactly 5%
          if (wrapper) wrapper.style.aspectRatio = `${w} / ${h}`;
        } else {
          if (wrapper) wrapper.style.aspectRatio = 'auto';
        }
      }}
    />
  );
});
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
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [metaApiStatus, setMetaApiStatus] = useState<'offline' | 'syncing' | 'connected'>('offline');

  const [activeBot, setActiveBot] = useState<any | null>(null);


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

  useEffect(() => {
    if (!authUser) return;
    const controller = new AbortController();
    let mounted = true;

    const pollStatus = async () => {
      try {
        const savedId = localStorage.getItem('lastSelectedProfileId');
        const url = savedId ? `/api/auth/metaapi/status?profileId=${savedId}` : '/api/auth/metaapi/status';
        const sRes = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
        if (mounted && sRes.ok) {
          const sData = await sRes.json();
          if (sData?.success) {
            setMetaApiStatus(prev => prev !== sData.status ? sData.status : prev);
          }
        }
      } catch (e: any) {
        // silent
      }
    };

    pollStatus();
    const intervalStatus = setInterval(pollStatus, 5000);

    return () => { 
        mounted = false; 
        controller.abort(); 
        clearInterval(intervalStatus); 
    };
  }, [authUser]);

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
        <div className={`w-full min-h-screen overflow-x-hidden bg-[#030508] text-slate-300 font-sans antialiased pb-12 selection:bg-emerald-500/30 relative`}>
      
      {/* Background Layer */}
      <div className={`absolute top-0 left-0 w-full z-0 pointer-events-none transition-all duration-1000 ${!activeBot ? 'inset-0 h-full overflow-hidden' : 'h-auto overflow-visible'} opacity-100`}>
        {activeBot && (
          <LivingBackground 
            key={activeBot.image}
            src={activeBot.image} 
            activeBot={true} 
          />
        )}
        <div className="absolute inset-0 animate-dust opacity-30 mix-blend-screen pointer-events-none" />
      </div>
      
      {/* Gradient Layer */}
      <div className={`fixed inset-0 z-0 pointer-events-none bg-gradient-to-t from-[#030508]/90 via-[#030508]/40 to-transparent`} />

      {/* Content Layer */}
      <div className="relative w-full z-10">
        <AnimatePresence>
          {activeWarning && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className={`text-white overflow-hidden border-b relative z-[60] ${
                activeWarning.event.impact === 'CRITICAL' 
                  ? 'bg-red-600 shadow-[0_0_30px_rgba(220,38,38,0.5)] border-red-500' 
                  : activeWarning.event.impact === 'HIGH'
                  ? 'bg-yellow-600 shadow-[0_0_30px_rgba(234,179,8,0.5)] border-yellow-500'
                  : 'bg-emerald-600 shadow-[0_0_30px_rgba(16,185,129,0.5)] border-emerald-500'
              }`}
            >
              <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex items-center justify-center gap-3">
                <AlertTriangle size={20} className="animate-ping" />
                <span className="font-display font-black tracking-widest uppercase text-sm sm:text-base">
                  {activeWarning.event.impact}-Impact News Alert
                </span>
                <span className={`font-mono text-xs sm:text-sm px-3 py-1 rounded-full border shadow-inner ${activeWarning.event.impact === 'CRITICAL' ? 'bg-red-800/80 border-red-500' : activeWarning.event.impact === 'HIGH' ? 'bg-yellow-800/80 border-yellow-500 text-yellow-100' : 'bg-emerald-800/80 border-emerald-500'}`}>
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
        <AnimatePresence>
          {activeBot && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className={`bg-black/20 border-white/5 border-b sticky top-0 z-50 transition-colors duration-1000`}>
              <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex flex-col items-center justify-center gap-1 relative min-h-[60px]">
                <button 
                  onClick={() => setActiveBot(null)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors text-xs font-mono border border-white/10 px-3 py-1.5 rounded-lg bg-black/40 hover:bg-black/60 cursor-pointer flex items-center gap-2"
                >
                  <X size={14} /> Close
                </button>
                {/* Centered Title */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
                  <h1 className={`text-xl sm:text-3xl font-black font-display tracking-[0.2em] uppercase transition-all duration-1000 ${
                    metaApiStatus === 'connected' ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 
                    metaApiStatus === 'syncing' ? 'text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.8)]' :
                    'text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.8)]'
                  }`}>
                    {activeBot.name}
                  </h1>
                  <span className={`inline-flex items-center text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-white/10 ${activeBot.color} font-mono bg-black/50 shadow-sm`}>
                    {activeBot.tag}
                  </span>
                </div>
                
                <button type="button"
                  onClick={() => { playClick(); setShowGlobalSettings(true); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-indigo-900/30 border border-indigo-500/30 rounded-lg text-indigo-300 hover:bg-indigo-900/50 hover:text-indigo-200 hover:shadow-[0_0_15px_rgba(99,102,241,0.3)] transition-all cursor-pointer"
                >
                  <Settings size={16} />
                  <span className="text-[10px] sm:text-xs font-bold tracking-widest uppercase hidden sm:block">Settings</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
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
            <AnimatePresence mode="wait">
              {!activeBot && !showGlobalSettings && (
                <motion.div
                  key="bot-hub"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                  className="min-h-[70vh] flex flex-col items-center justify-center pt-12"
                >
                  <h2 className="text-4xl font-display font-black tracking-widest uppercase mb-16 text-center text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                    Select Execution Head
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-16 w-full max-w-5xl mx-auto">
                    {[SEER_BOT, SAGE_BOT, MAGE_BOT].map((bot) => (
                      <BotCard key={bot.id} bot={bot} onClick={() => { playClick(); setActiveBot(bot); }} />
                    ))}
                  </div>
                  
                  <button onClick={() => { playClick(); setShowGlobalSettings(true); }} className="mt-20 flex items-center gap-2 text-slate-400 hover:text-white transition-colors cursor-pointer border border-white/10 px-6 py-3 rounded-xl bg-black/40 hover:bg-black/60">
                     <Settings size={18} /> Global System Settings
                  </button>
                </motion.div>
              )}
              {activeBot && !showGlobalSettings && (
                <motion.div
                  key="active-dashboard"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <BotDashboard bot={activeBot} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        <footer className="mt-12 text-center text-[11px] text-slate-600 font-mono">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2 border-t border-slate-900 pt-6 mb-4">
            <p>© 2026 The Coven — Advanced Algorithmic Execution · by Tazim Sheikh</p>
            <div className="flex gap-4">
               <span className="text-slate-500 border-r border-white/10 pr-4">Zero Indicators</span>
               <span className="text-slate-500 border-r border-white/10 pr-4">Zero Retail Noise</span>
               <span className="text-emerald-500 font-bold">100% Math Rejections</span>
            </div>
          </div>
          <div className="max-w-5xl mx-auto px-4 pb-8 text-[9px] sm:text-[10px] text-slate-500/70 text-justify leading-relaxed">
            <p className="font-bold mb-1 text-slate-500">HIGH RISK INVESTMENT WARNING & LEGAL DISCLAIMER:</p>
            <p>
              Trading foreign exchange (Forex), cryptocurrencies, indices, and other financial instruments on margin carries a high level of risk and may not be suitable for all investors. The high degree of leverage can work against you as well as for you. Before deciding to invest, you should carefully consider your investment objectives, level of experience, and risk appetite. The possibility exists that you could sustain a loss of some or all of your initial investment; therefore, you should not invest money that you cannot afford to lose. 
            </p>
            <p className="mt-2">
              All statistics, win rates, analytics, and strategy metrics displayed within the platform are derived from historical backtesting data using Walk-Forward Optimization and are provided strictly for educational and representational purposes. <strong>Past performance is never indicative of future results.</strong> The platform does not account for slippage, liquidity gaps, or catastrophic market anomalies. This application is an execution tool, not a financial advisor. By using this software, you acknowledge that all trading decisions are executed at your own risk. Tazim Sheikh and the developers are completely indemnified and hold no liability for any financial losses or damages incurred through the use of this software.
            </p>
          </div>
        </footer>
      </div>
          </div>
        </WebSocketProvider>
      </ErrorBoundary>
    );
}

