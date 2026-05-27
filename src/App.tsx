import React, { useState, useEffect, useRef } from 'react';
import { MarketData, TrapSignal, ChatMessage } from './types';
import WatchList from './components/WatchList';
import AlertFeed from './components/AlertFeed';
import TutorPanel from './components/TutorPanel';
import VoiceTutorCall from './components/VoiceTutorCall';
import EconomicCalendar from './components/EconomicCalendar';
import SimpleAlertFeed from './components/SimpleAlertFeed';
import AutomateDashboard from './components/AutomateDashboard';
import LoginScreen from './components/LoginScreen';
import { GraduationCap, Clock, HelpCircle, Activity, Award, CheckCircle, Presentation, Zap, Radio, MessageSquare, AlertTriangle, LogOut, Settings, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useEconomicNews } from './hooks/useEconomicNews';

// ── Global fetch wrapper — handles 401 session expiry silently ───────────────
async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    // Session expired — force re-login by reloading the page
    console.warn('[Auth] Session expired — redirecting to login.');
    window.location.reload();
  }
  return res;
}

export default function App() {
  const { activeWarning } = useEconomicNews();

  // ── Auth state: null = not logged in, object = logged in, undefined = checking ──
  const [authUser, setAuthUser]   = useState<any | null | undefined>(undefined);
  const [appMode, setAppMode]     = useState<'signal' | 'education' | 'automation'>('education');
  const [markets, setMarkets]     = useState<MarketData[]>([]);
  const [alerts, setAlerts]       = useState<TrapSignal[]>([]);
  const [userProgress, setUserProgress] = useState<any>({});

  const [selectedAssetSymbol, setSelectedAssetSymbol] = useState('NQ=F');
  const [activeSignal, setActiveSignal]               = useState<TrapSignal | null>(null);
  const [chatMessages, setChatMessages]               = useState<ChatMessage[]>([]);
  const chatMessagesRef = useRef<ChatMessage[]>([]);    // FIX: Ref to always have latest value
  chatMessagesRef.current = chatMessages;

  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [newTokenInput, setNewTokenInput] = useState('');
  const [tokenUpdateStatus, setTokenUpdateStatus] = useState('');

  const [isThinking, setIsThinking]     = useState(false);
  const [activeView, setActiveView]     = useState<'monitor' | 'calendar' | 'ai-assistant'>('monitor');
  const [selectedTimezone, setSelectedTimezone] = useState<string>('IST');
  const [showMonitorAlerts, setShowMonitorAlerts]     = useState(true);
  const [showMonitorWatchlist, setShowMonitorWatchlist] = useState(true);

  const [metaApiMode, setMetaApiMode] = useState<'demo' | 'live'>('demo');
  const [metaApiStatus, setMetaApiStatus] = useState<'offline' | 'syncing' | 'connected'>('offline');

  const currentMarket = markets.find(m => m.symbol === selectedAssetSymbol) || markets[0];

  const [timeState, setTimeState] = useState({
    londonActive: false, comexActive: false, ny10Active: false, utcClock: '',
  });

  // ── Check auth status on mount (cookie-based — no localStorage) ─────────────
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then(data => {
        if (data?.success && data.user) {
          setAuthUser(data.user);
          if (data.user.hasMetaApiToken) {
            setMetaApiMode('live');
          }
        } else {
          setAuthUser(null);
        }
      })
      .catch(() => setAuthUser(null));
  }, []);

  // ── Market data polling with AbortController (FIX: no memory leaks) ─────────
  useEffect(() => {
    if (!authUser && authUser !== undefined) return; // Don't poll if not logged in

    const controller = new AbortController();
    let mounted = true;

    const poll = async () => {
      try {
        const [mRes, aRes, sRes] = await Promise.all([
          fetch('/api/market',  { signal: controller.signal, credentials: 'same-origin' }),
          fetch('/api/alerts',  { signal: controller.signal, credentials: 'same-origin' }),
          fetch('/api/auth/metaapi/status', { signal: controller.signal, credentials: 'same-origin' }),
        ]);
        if (mounted && mRes.ok) {
          const mData = await mRes.json();
          if (mData?.success) setMarkets(mData.data);
        }
        if (mounted && aRes.ok) {
          const aData = await aRes.json();
          if (aData?.success) setAlerts(aData.data);
        }
        if (mounted && sRes.ok) {
          const sData = await sRes.json();
          if (sData?.success) setMetaApiStatus(sData.status);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') { /* silent backoff */ }
      }
      updateGatesClocks();
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => { mounted = false; controller.abort(); clearInterval(interval); };
  }, [authUser, selectedTimezone]);

  // ── Progress fetch (once on login) ──────────────────────────────────────────
  useEffect(() => {
    if (!authUser) return;
    fetch('/api/progress', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => { if (d?.success) setUserProgress(d.data); })
      .catch(() => {});
  }, [authUser]);

  const updateGatesClocks = () => {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const totalMin = utcHours * 60 + utcMinutes;

    const londonActive = totalMin >= 420 && totalMin <= 570;
    const comexActive  = totalMin >= 740 && totalMin <= 810;
    const ny10Active   = totalMin >= 840 && totalMin <= 930;

    let tzString = 'UTC';
    if (selectedTimezone === 'IST')  tzString = 'Asia/Kolkata';
    else if (selectedTimezone === 'EST') tzString = 'America/New_York';
    else if (selectedTimezone === 'GMT') tzString = 'Europe/London';
    else if (selectedTimezone === 'JST') tzString = 'Asia/Tokyo';
    else if (selectedTimezone === 'AEDT') tzString = 'Australia/Sydney';

    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, timeZone: tzString }) + ' ' + selectedTimezone;
    setTimeState({ londonActive, comexActive, ny10Active, utcClock: timeStr });
  };

  // ── Logout (FIX: clears HttpOnly cookie server-side) ────────────────────────
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      setAuthUser(null);
    }
  };

  const handleTriggerSimulation = async (symbol: string, pattern: string) => {
    try {
      const res = await apiFetch('/api/alerts/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, pattern }),
      });
      const data = await res.json();
      if (data?.success) {
        await fetch('/api/alerts').then(r => r.json()).then(d => { if (d?.success) setAlerts(d.data); });
        if (data.data) handleSelectSignal(data.data);
      }
    } catch (e) {
      alert('Failed to trigger simulated trap alert');
    }
  };

  const handleSelectSignal = async (signal: TrapSignal) => {
    setActiveSignal(signal);
    setSelectedAssetSymbol(signal.symbol);
    setActiveView('ai-assistant');

    const introPrompt = `Why did the system trigger this high-probability ${signal.pattern} setup on ${signal.displayName}?`;
    const newUserMsg: ChatMessage = {
      id: `usr-${Date.now()}`, role: 'user', content: introPrompt,
      timestamp: new Date().toISOString(), relatedSignalId: signal.id,
    };

    setChatMessages(prev => [...prev, newUserMsg]);
    setIsThinking(true);

    try {
      const res = await apiFetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // FIX: Use ref to get latest chat messages (avoids stale closure)
        body: JSON.stringify({ prompt: introPrompt, history: [...chatMessagesRef.current, newUserMsg], relatedSignalId: signal.id }),
      });
      const data = await res.json();
      if (data?.success) {
        setChatMessages(prev => [...prev, {
          id: `asst-${Date.now()}`, role: 'assistant', content: data.response,
          timestamp: new Date().toISOString(), relatedSignalId: signal.id,
        }]);
      }
    } catch (err) { /* Fallback handled in backend */ }
    finally { setIsThinking(false); }
  };

  const handleSendMessage = async (text: string) => {
    const newUserMsg: ChatMessage = {
      id: `usr-${Date.now()}`, role: 'user', content: text,
      timestamp: new Date().toISOString(), relatedSignalId: activeSignal?.id,
    };
    setChatMessages(prev => [...prev, newUserMsg]);
    setIsThinking(true);

    try {
      const res = await apiFetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, history: [...chatMessagesRef.current, newUserMsg], relatedSignalId: activeSignal?.id }),
      });
      const data = await res.json();
      if (data?.success) {
        setChatMessages(prev => [...prev, {
          id: `asst-${Date.now()}`, role: 'assistant', content: data.response,
          timestamp: new Date().toISOString(), relatedSignalId: activeSignal?.id,
        }]);
      }
    } catch (err) { /* Fallback in backend */ }
    finally { setIsThinking(false); }
  };

  const handleClearSignalContext = () => setActiveSignal(null);

  const handleAddTrade = async (trade: any) => {
    try {
      const res = await apiFetch('/api/progress/add-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trade),
      });
      const data = await res.json();
      if (data?.success) setUserProgress(data.data);
    } catch (e) { /* quiet */ }
  };

  const handleTakeQuiz = async (score: number) => {
    try {
      const res = await apiFetch('/api/progress/quiz', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      });
      const data = await res.json();
      if (data?.success) setUserProgress(data.data);
    } catch (e) { /* quiet */ }
  };

  const handleSelectEducationMode = (signal: TrapSignal) => {
    setAppMode('education');
    handleSelectSignal(signal);
  };

  // ── Auth loading state ───────────────────────────────────────────────────────
  if (authUser === undefined) {
    return (
      <div className="min-h-screen bg-[#070913] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Not logged in → show login screen ───────────────────────────────────────
  if (!authUser) {
    return <LoginScreen onLoginSuccess={setAuthUser} />;
  }

  return (
    <div className={`min-h-screen ${activeWarning ? 'bg-red-950/80 transition-colors duration-1000' : 'bg-[#070913]'} text-slate-300 font-sans antialiased pb-12 selection:bg-indigo-500/30 relative overflow-x-hidden`}>
      <div className={`fixed inset-0 z-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] ${activeWarning ? 'from-red-900/30 via-red-950/80 to-[#2e0404] transition-colors duration-1000' : 'from-indigo-900/15 via-slate-950 to-[#070913]'}`} />

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

        <AnimatePresence>
          {activeWarning && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 0, opacity: 0 }} exit={{ height: 0, opacity: 0 }}
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
              <div className="relative group cursor-pointer" onClick={() => setAppMode(appMode === 'signal' ? 'education' : appMode === 'education' ? 'automation' : 'signal')}>
                <div className="absolute inset-0 bg-indigo-500 rounded-xl blur opacity-20 group-hover:opacity-40 transition-opacity" />
                <div className="relative w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-md ring-1 ring-white/20">
                  <span className="font-black tracking-tight text-sm">TR</span>
                </div>
              </div>
              <div>
                <h1 className="font-display font-extrabold text-xs sm:text-sm tracking-tight text-white uppercase flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                  <span className="flex items-center gap-2">Sniper Trader</span>
                  <span className="text-[10px] sm:hidden text-slate-400 font-medium normal-case tracking-normal">Multi Asset Scanner, Educator and Trading Automator</span>
                  <button className={`text-[9px] cursor-default uppercase tracking-widest font-black px-2 py-0.5 border rounded shadow-[0_0_10px_rgba(99,102,241,0.2)] transition-colors ${
                    metaApiStatus === 'connected' ? 'text-emerald-300 border-emerald-400/30 bg-emerald-950/50' : 
                    metaApiStatus === 'syncing' ? 'text-amber-300 border-amber-400/30 bg-amber-950/50' :
                    'text-rose-300 border-rose-400/30 bg-rose-950/50'
                  }`}>
                    {metaApiStatus === 'connected' ? '🟢 API Connected' : metaApiStatus === 'syncing' ? '🟡 API Syncing' : '🔴 API Offline'}
                  </button>
                  <div className="flex bg-slate-950/80 p-0.5 rounded-full border border-slate-800 shadow-inner ml-2 gap-0.5">
                    {[
                      { id: 'signal', label: 'Signal', icon: Radio },
                      { id: 'education', label: 'Education', icon: GraduationCap },
                      { id: 'automation', label: 'Automation', icon: Zap },
                    ].map(mode => {
                      const Icon = mode.icon;
                      const active = appMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => setAppMode(mode.id as any)}
                          className={`relative px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all duration-300 flex items-center gap-1 cursor-pointer ${
                            active
                              ? 'bg-indigo-500 text-white shadow-[0_2px_8px_rgba(99,102,241,0.4)] border border-indigo-400/20'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50 border border-transparent'
                          }`}
                        >
                          <Icon size={9} className={active ? 'text-white' : 'text-slate-500'} />
                          <span>{mode.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </h1>
                <p className={`text-[10px] ${activeWarning ? 'text-red-300/80 font-bold' : 'text-slate-500'} font-mono mt-0.5 uppercase tracking-wide`}>
                  Multi Asset Scanner, Educator and Trading Automator
                </p>
              </div>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <div className="bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2 font-mono text-[11px] text-indigo-300 shadow-inner">
                <Clock size={13} className="text-indigo-400" />
                <span>{timeState.utcClock || 'Synching GMT...'}</span>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-3 py-1 rounded-lg shadow-inner">
                <span className="text-[9.5px] font-mono text-slate-500 font-bold uppercase">TZ:</span>
                <select value={selectedTimezone} onChange={e => setSelectedTimezone(e.target.value)} className="bg-transparent text-indigo-300 font-mono text-[11px] font-bold border-none outline-none cursor-pointer focus:ring-0">
                  <option value="UTC"  className="bg-slate-950 text-indigo-300">UTC (GMT+0)</option>
                  <option value="IST"  className="bg-slate-950 text-indigo-300">IST (GMT+5:30)</option>
                  <option value="EST"  className="bg-slate-950 text-indigo-300">EST (GMT-5)</option>
                  <option value="GMT"  className="bg-slate-950 text-indigo-300">BST (GMT+1)</option>
                  <option value="JST"  className="bg-slate-950 text-indigo-300">JST (GMT+9)</option>
                  <option value="AEDT" className="bg-slate-950 text-indigo-300">AEDT (GMT+11)</option>
                </select>
              </div>

              {[
                { key: 'london', active: timeState.londonActive, label: 'London', color: 'cyan' },
                { key: 'comex',  active: timeState.comexActive,  label: 'COMEX',  color: 'emerald' },
                { key: 'ny10',   active: timeState.ny10Active,   label: '10:00 AM', color: 'indigo' },
              ].map(({ key, active, label, color }) => (
                <div key={key} className={`px-2.5 py-1 text-[10px] font-mono rounded-lg border flex items-center gap-1.5 transition-all duration-500 ${active ? `bg-${color}-500/10 text-${color}-400 border-${color}-500/30` : 'bg-slate-900/30 text-slate-500 border-slate-800/60'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? `bg-${color}-400 animate-pulse` : 'bg-slate-600'}`} />
                  <span>{label} {active && '(ACTIVE)'}</span>
                </div>
              ))}

              {/* FIX: Global Settings & Logout buttons ───────────────────────────────────── */}
              <button
                onClick={() => setShowGlobalSettings(true)}
                title="Global Settings"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 hover:bg-slate-700/80 hover:border-slate-500/50 text-slate-400 hover:text-slate-200 text-[10px] font-mono uppercase tracking-wider transition-all"
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

        {/* ── GLOBAL SETTINGS MODAL ── */}
        <AnimatePresence>
          {showGlobalSettings && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowGlobalSettings(false)} />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-md relative z-10 shadow-2xl">
                <button onClick={() => setShowGlobalSettings(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
                  <X size={20} />
                </button>
                <h3 className="text-xl font-display font-black text-white mb-4 flex items-center gap-2 uppercase tracking-wide">
                  <Settings className="text-indigo-400" />
                  Global Settings
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Update Meta API Token</label>
                    <input
                      type="password"
                      value={newTokenInput}
                      onChange={e => setNewTokenInput(e.target.value)}
                      className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600 font-mono text-sm"
                      placeholder="Paste new Meta API Token..."
                    />
                    {tokenUpdateStatus && (
                      <p className={`mt-2 text-xs font-mono ml-1 ${tokenUpdateStatus.includes('Success') ? 'text-emerald-400' : tokenUpdateStatus === 'Verifying...' ? 'text-indigo-400 animate-pulse' : 'text-red-400'}`}>
                        {tokenUpdateStatus}
                      </p>
                    )}
                  </div>
                  
                  <button
                    onClick={handleUpdateMetaApiToken}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl transition-colors font-display tracking-wide uppercase text-sm"
                  >
                    Save Changes
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {appMode === 'signal' ? (
            <motion.div key="signal-mode" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.4, ease: 'easeOut' }}>
              <SimpleAlertFeed alerts={alerts} onSelectAdvanced={handleSelectEducationMode} />
            </motion.div>
          ) : appMode === 'automation' ? (
            <motion.main key="automation-mode" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4, ease: 'easeOut' }} className="max-w-7xl mx-auto px-4 mt-6 sm:px-6 lg:px-8">
              <div className="mb-8">
                <AutomateDashboard />
              </div>
            </motion.main>
          ) : (
            <motion.main key="education-mode" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4, ease: 'easeOut' }} className="max-w-7xl mx-auto px-4 mt-6 sm:px-6 lg:px-8">
              <div className="flex flex-wrap bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800/60 mb-8 gap-1 w-fit shadow-inner">
                {[
                  { id: 'monitor',      label: '📊 Scanner Monitor' },
                  { id: 'calendar',     label: '📅 Economic Calendar' },
                  { id: 'ai-assistant', label: '🤖 AI Assistant' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveView(tab.id as any)}
                    className={`relative px-5 py-2.5 text-xs font-display font-black tracking-wide rounded-xl cursor-pointer transition-all duration-300 ${activeView === tab.id ? 'text-white shadow-[0_4px_12px_rgba(0,0,0,0.5)] bg-slate-800 ring-1 ring-slate-700/50' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}
                  >
                    {activeView === tab.id && (
                      <motion.div layoutId="activeTabIndicator" className={`absolute inset-0 bg-gradient-to-b ${activeWarning ? 'from-red-500/20 to-rose-500/5 border-red-500/30' : 'from-indigo-500/20 to-purple-500/5 border-indigo-500/30'} rounded-xl border`} initial={false} transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }} />
                    )}
                    <span className="relative z-10">{tab.label}</span>
                  </button>
                ))}
              </div>

              <div className="mb-8">
                {activeView === 'monitor' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {showMonitorAlerts ? (
                      <section className={`lg:col-span-12 ${showMonitorWatchlist ? 'xl:col-span-7' : 'xl:col-span-12'} space-y-6 relative group pt-5`}>
                        <div className="absolute top-0 left-0 right-0 z-10 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setShowMonitorAlerts(false)} className="w-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 h-5 rounded-t-xl border-t border-l border-r border-slate-700 shadow-md flex items-center justify-center cursor-pointer transition-colors">
                            <span className="block w-20 h-1.5 bg-slate-500 rounded-full" />
                          </button>
                        </div>
                        <AlertFeed alerts={alerts} onSelectSignal={handleSelectSignal} activeSignalId={activeSignal?.id} selectedTimezone={selectedTimezone} />
                      </section>
                    ) : (
                      <div className="lg:col-span-12 flex justify-center">
                        <button onClick={() => setShowMonitorAlerts(true)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-6 py-2 rounded-lg border border-slate-700 shadow-lg font-mono flex items-center justify-center cursor-pointer transition-colors w-full border-dashed">
                          + EXPAND SIGNAL FEED
                        </button>
                      </div>
                    )}

                    {showMonitorWatchlist ? (
                      <section className={`lg:col-span-12 ${showMonitorAlerts ? 'xl:col-span-5' : 'xl:col-span-12'} space-y-6 relative group pt-5`}>
                        <div className="absolute top-0 left-0 right-0 z-10 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setShowMonitorWatchlist(false)} className="w-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 h-5 rounded-t-xl border-t border-l border-r border-slate-700 shadow-md flex items-center justify-center cursor-pointer transition-colors">
                            <span className="block w-20 h-1.5 bg-slate-500 rounded-full" />
                          </button>
                        </div>
                        <WatchList markets={markets} onTriggerSimulation={handleTriggerSimulation} selectedAssetSymbol={selectedAssetSymbol} onSelectAsset={symbol => setSelectedAssetSymbol(symbol)} />
                      </section>
                    ) : (
                      <div className="lg:col-span-12 flex justify-center">
                        <button onClick={() => setShowMonitorWatchlist(true)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-6 py-2 rounded-lg border border-slate-700 shadow-lg font-mono flex items-center justify-center cursor-pointer transition-colors w-full border-dashed">
                          + SHOW WATCHLIST
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeView === 'calendar' && (
                  <div className="max-w-6xl mx-auto">
                    <EconomicCalendar selectedTimezone={selectedTimezone} />
                  </div>
                )}

                {activeView === 'ai-assistant' && (
                  <div className="max-w-7xl mx-auto space-y-6">
                    <div className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)] ring-1 ring-white/5 relative overflow-hidden">
                      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
                      <h3 className="font-display font-extrabold text-xs text-indigo-400 uppercase tracking-widest mb-6 flex items-center gap-2 relative z-10">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                        </span>
                        TUTOR HUD & CO-PILOT VOICE CALL COACH
                      </h3>
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in relative z-10">
                        <div className="lg:col-span-5">
                          {currentMarket && <VoiceTutorCall market={currentMarket} activeSignal={activeSignal} />}
                        </div>
                        <div className="lg:col-span-7">
                          <TutorPanel messages={chatMessages} activeSignal={activeSignal} onClearSignalContext={handleClearSignalContext} onSendMessage={handleSendMessage} isThinking={isThinking} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.main>
          )}
        </AnimatePresence>

        <footer className="mt-12 text-center text-[11px] text-slate-600 font-mono">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2 border-t border-slate-900 pt-6">
            <p>© 2026 Sniper Trader - by Tazim Sheikh Smart Money Mechanical Lab.</p>
            <div className="flex gap-4">
              <span className="text-slate-500 border-r border-slate-800 pr-4">Zero Indicators</span>
              <span className="text-slate-500 border-r border-slate-800 pr-4">Zero Retail Noise</span>
              <span className="text-emerald-500 font-bold">100% Math Rejections</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
