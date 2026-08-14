import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, Eye, Activity, Settings, X, Trash2, ChevronDown, ChevronRight, Terminal, TrendingUp, BarChart2, DollarSign, TrendingDown, Database, Shield, RefreshCw } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketContext';
import { useSound } from '../hooks/useSound';
import TradeAnalytics from './TradeAnalytics';
import { formatTime, formatDateTime } from '../utils/timezone';
import { MAGE_BOT, SAGE_BOT, SEER_BOT } from '../App';

export default function BotDashboard({ bot }: { bot: any }) {
  const { socket, isConnected } = useWebSocket();
  const { playClick, playSuccess, playError } = useSound();
  const eventPrefix = 'discretionary_trader';
  
  const [isRunning, setIsRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Offline');
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [eyeFeed, setEyeFeed] = useState<any[]>([]);
  const [activePairs, setActivePairs] = useState<{ pair: string; enabled: boolean; riskPct: number; bias?: string; hasActiveTrade?: boolean; hasLimitOrder?: boolean; activeTradesList?: any[] }[]>([]);
  const [expandedPair, setExpandedPair] = useState<string | null>(null);
  const [inKillzone, setInKillzone] = useState(false);
  const [windowLabel, setWindowLabel] = useState('🌑 Outside Trading Window');
  
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const int = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(int);
  }, []);

  const [profileId, setProfileId] = useState<number | null>(null);
  const [profileInfo, setProfileInfo] = useState<{name: string, accountId: string} | null>(null);
  
  // Theme Variables
  const themeColor = 'purple';
  const themeColorMap: Record<string, string> = {
    'purple-300': 'text-purple-300',
  };
  const bgMap: Record<string, string> = {
    purple: 'bg-purple-900/80',
    'purple-500': 'bg-purple-500',
    'purple-600': 'bg-purple-600',
    'purple-700': 'bg-purple-700',
    'purple-900': 'bg-purple-900',
  };
  const borderMap: Record<string, string> = {
    purple: 'border-purple-500/50',
    'purple-400': 'border-purple-400/50',
    'purple-900': 'border-purple-900/30',
  };
  
  const shadowGlow = 'rgba(168,85,247,0.5)';
  const bgGradient = 'from-black/80 via-purple-900/20';

    
  // Account Management State
  const [mainTab, setMainTab] = useState<'vision' | 'analytics' | 'diary' | 'logs'>('vision');
  const [diary, setDiary] = useState<any[]>([]);
  const [allTrades, setAllTrades] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [diaryFilter, setDiaryFilter] = useState<'ALL' | 'WIN' | 'LOSS' | 'FAILED'>('ALL');
  const [diarySort, setDiarySort] = useState<'NEWEST' | 'OLDEST' | 'PROFIT_HIGH' | 'PROFIT_LOW'>('NEWEST');
  const [analyticsBotId, setAnalyticsBotId] = useState<string>(bot?.id || 'all');

  useEffect(() => {
    if (bot?.id) {
      setAnalyticsBotId(bot.id);
      setExpandedPair(null);
      setEyeFeed([]);
      setLogs([]);
    }
  }, [bot?.id]);

  const [isLogsLoading, setIsLogsLoading] = useState(false);

  const fetchLogs = useCallback(() => {
    if (!profileId) return;
    setIsLogsLoading(true);
    fetch(`/api/settings/logs?profileId=${profileId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.logs) {
          let filteredLogs = data.logs;
          if (bot?.id) {
            const currentBotId = bot.id.toLowerCase();
            filteredLogs = filteredLogs.filter((l: any) => {
              if (!l.bot_id) return true;
              const logBotId = l.bot_id.toLowerCase();
              if (logBotId === currentBotId) return true;
              if (currentBotId === 'seer' && (logBotId === 'discretionary_trader' || logBotId === 'seer')) return true;
              return false;
            });
          }
          setLogs(filteredLogs);
        }
      })
      .catch(console.error)
      .finally(() => setIsLogsLoading(false));
  }, [profileId, bot?.id]);

  useEffect(() => {
    if (mainTab === 'logs') {
      fetchLogs();
    }
  }, [mainTab, fetchLogs]);

  const handleClearLogs = async () => {
    if (!profileId) return;
    if (!confirm('Are you sure you want to clear all system logs for this account?')) return;
    try {
      playClick();
      const res = await fetch(`/api/settings/logs?profileId=${profileId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setLogs([]);
        playSuccess();
      } else {
        alert(data.error || 'Failed to clear logs');
        playError();
      }
    } catch (err: any) {
      alert(err.message || 'Error clearing logs');
      playError();
    }
  };

  const [botBalance, setBotBalance] = useState<number | null>(null);
  const [botCurrency, setBotCurrency] = useState<string>('USD');
  const [safetyStatus, setSafetyStatus] = useState<any>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    'Indices': true,
    'Commodity': true,
    'Forex Majors': true,
    'Forex Minors': false,
    'Forex Crosses': false,
  });

  
  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  
  const [botDailyPl, setBotDailyPl] = useState<number>(0);
  
  useEffect(() => {
    if (!botBalance || diary.length === 0) return;
    const now = new Date();
    const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const estDateString = estDate.toISOString().split('T')[0];
    
    // Filter for TODAY and for THIS SPECIFIC BOT
    let dailyProfit = 0;
    diary.forEach(trade => {
      // Must match active bot ID to filter P/L specifically to this bot
      if (trade.bot_id !== bot.id) return;
      
      const tradeCloseEst = new Date(new Date(trade.close_time).toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const tradeEstDateString = tradeCloseEst.toISOString().split('T')[0];
      if (tradeEstDateString === estDateString) {
        dailyProfit += trade.profit;
      }
    });
    
    // Convert to percentage
    const startingBalance = botBalance - dailyProfit; // rough estimate of start of day balance
    const pct = startingBalance > 0 ? (dailyProfit / startingBalance) * 100 : 0;
    setBotDailyPl(pct);
  }, [diary, botBalance, bot.id]);

  const categorizePair = (pair: string) => {
    const p = pair.split('.')[0].toUpperCase();
    if (['NAS100', 'US30', 'SPX500', 'UK100', 'GER40', 'GER30'].includes(p)) return 'Indices';
    if (['XAUUSD', 'XAGUSD', 'USOIL', 'UKOIL'].includes(p)) return 'Commodity';
    if (['BTCUSD', 'ETHUSD'].includes(p)) return 'Crypto';
    if (['EURUSD', 'GBPUSD', 'USDJPY'].includes(p)) return 'Forex Majors';
    if (['EURAUD', 'GBPAUD', 'GBPCAD'].includes(p)) return 'Forex Minors';
    return 'Forex Crosses';
  };

  const groupedPairs = useMemo(() => ({
    'Indices': activePairs.filter(p => categorizePair(p.pair) === 'Indices'),
    'Commodity': activePairs.filter(p => categorizePair(p.pair) === 'Commodity'),
    'Crypto': activePairs.filter(p => categorizePair(p.pair) === 'Crypto'),
    'Forex Majors': activePairs.filter(p => categorizePair(p.pair) === 'Forex Majors'),
    'Forex Minors': activePairs.filter(p => categorizePair(p.pair) === 'Forex Minors'),
    'Forex Crosses': activePairs.filter(p => categorizePair(p.pair) === 'Forex Crosses'),
  }), [activePairs, bot]);
  const categoryOrder = ['Indices', 'Commodity', 'Crypto', 'Forex Majors', 'Forex Minors', 'Forex Crosses'];
  
  useEffect(() => {
    const handleProfileChanged = async () => {
      try {
        // Always fetch profiles from the API — never rely solely on localStorage
        // This ensures new devices / fresh sessions always get a valid profileId
        const res = await fetch('/api/auth/profiles', { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.success || !data.profiles || data.profiles.length === 0) return;

        const savedId = localStorage.getItem('lastSelectedProfileId');
        let pId: number;

        if (savedId) {
          const parsedId = parseInt(savedId);
          // Validate the saved ID still exists in this user's profile list
          const stillValid = data.profiles.find((x: any) => x.id === parsedId);
          pId = stillValid ? parsedId : data.profiles[0].id;
        } else {
          // New device / cleared storage — default to first profile
          pId = data.profiles[0].id;
        }

        // Persist to localStorage so subsequent loads are instant
        localStorage.setItem('lastSelectedProfileId', pId.toString());

        const p = data.profiles.find((x: any) => x.id === pId);
        setProfileId(pId);
        setIsRunning(false);
        setStatusMsg('Offline');
        if (p) setProfileInfo({ name: p.profile_name, accountId: p.metaapi_account_id });

      } catch(e) {}
    };
    
    // Initial load
    handleProfileChanged();
    
    window.addEventListener('profileChanged', handleProfileChanged);
    return () => window.removeEventListener('profileChanged', handleProfileChanged);
  }, []);

  useEffect(() => {
    if (!profileId) {
      setDiary([]);
      setAllTrades([]);
      return;
    }
    // We no longer fetch logs, only trade diary
    fetch(`/api/auth/profiles/${profileId}/diary`, { credentials: 'same-origin' })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.trades) {
          setAllTrades(data.trades);
          const currentBotId = (bot?.id || '').toLowerCase();
          setDiary(data.trades.filter((t: any) => {
            const dbBotId = (t.bot_id || '').toLowerCase();
            if (dbBotId === currentBotId) return true;
            if (currentBotId === 'seer' && (dbBotId === 'discretionary_trader' || dbBotId === 'seer')) return true;
            if (currentBotId === 'mage' && dbBotId.startsWith('m_')) return true;
            if (currentBotId === 'sage' && dbBotId.startsWith('s_')) return true;
            return false;
          }));
        }
      })
      .catch(() => {});

    // Fetch account analytics for Live Balance
    fetch(`/api/auth/profiles/${profileId}/metaapi/analytics`, { credentials: 'same-origin' })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.account) {
          setAnalyticsData(data);
          if (data.account.balance) {
            setBotBalance(data.account.balance);
            setBotCurrency(data.account.currency || 'USD');
          }
        }
      })
      .catch(() => {});
  }, [profileId, mainTab, bot?.id]);

  // Poll Safety Status
  useEffect(() => {
    if (!profileId) return;
    const fetchSafety = async () => {
      try {
        const res = await fetch(`/api/settings/safety/status?profileId=${profileId}`, { credentials: 'same-origin' });
        const data = await res.json();
        if (data.success) setSafetyStatus(data.status);
      } catch(e) {}
    };
    fetchSafety();
    const interval = setInterval(fetchSafety, 15000); // 15 seconds
    return () => clearInterval(interval);
  }, [profileId]);

  useEffect(() => {
    if (!socket || !profileId || !isConnected) return;
    
    // Join the profile socket room to receive broadcasts
    socket.emit('join_profile', profileId.toString());
    
    // Request initial status
    socket.emit(`${eventPrefix}:get_status`, { profileId, botId: bot.id });

    const requestSync = () => {
      socket.emit(`${eventPrefix}:get_status`, { profileId, botId: bot.id });
    };

    const handleStatus = (data: any) => {
      if (data.botId && bot?.id && data.botId !== bot.id) return;
      let isMeRunning = (data.activeBots || []).includes(bot.id);
      setIsRunning(isMeRunning);

      if (isMeRunning) setStatusMsg(`${bot ? bot.name : 'The TheWitch'} is active and watching the markets.`);
      else setStatusMsg('Offline');
      
      let anyInWindow = false;
      const backendHour = data.pairBiases && data.pairs && data.pairs.length > 0 ? data.pairBiases[data.pairs[0]]?.estHour : '?';
      let currentWindowLabel = `🌑 Outside Trading Window (Backend Time: ${backendHour}:00 NY)`;

      if (data.pairs && data.pairs.length > 0) {
        // Synchronously calculate window state before async React setter
        data.pairs.forEach((p: string) => {
          if (data.pairState && data.pairState[p]?.inWindow) anyInWindow = true;
          if (data.pairBiases && data.pairBiases[p]?.inWindow) anyInWindow = true;
        });

        // Hydrate eye feed from backend memory
        if (data.recentEyeFeed && data.recentEyeFeed.length > 0) {
          setEyeFeed(data.recentEyeFeed.filter((ev: any) => !ev.bot_id || ev.bot_id === bot?.id).map((ev: any) => ({...ev, timestamp: ev.timestamp || new Date().toISOString()})).slice(0, 100));
        }

        setActivePairs(prev => {
          return data.pairs.map((p: string) => {
            const existing = prev.find(item => item.pair === p);
            const ps = data.pairStates ? data.pairStates[p] : null;
            const b = data.pairBiases ? data.pairBiases[p] : null;

            if (ps?.inWindow || b?.inWindow) {
              anyInWindow = true;
              currentWindowLabel = `🟢 Active`;
            }

            return {
              pair: p,
              bias: b?.bias || 'NONE',
              enabled: ps ? ps.enabled : true,
              riskPct: ps?.riskPct ?? data.botRisks?.[bot.id] ?? 1,
              hasActiveTrade: ps?.hasActiveTrade || false,
              hasLimitOrder: ps?.hasLimitOrder || false,
              activeTradesList: ps?.activeTradesList || []
            };
          });
        });
      }
      setInKillzone(anyInWindow);
      setWindowLabel(currentWindowLabel);
    };

    const handleStarted = () => requestSync();
    const handleStopped = () => requestSync();

    const handleBalanceUpdate = (data: any) => {
      setBotBalance(data.balance);
      if (data.currency) setBotCurrency(data.currency);
    };

    const handleError = (data: any) => {
      setStatusMsg(`Error: ${data.message}`);
      playError();
      setIsRunning(false);
    };
    
    const handleStatusMessage = (data: { message: string }) => {
      setStatusMsg(data.message);
    };

    const handleEyeFeed = (data: any) => {
      // Isolate Eye Feed so the Reaper doesn't see the Sage's thoughts
      if (data.bot_id && data.bot_id !== bot?.id) return;
      setEyeFeed(prev => [{...data, timestamp: new Date().toISOString()}, ...prev].slice(0, 100));
    };

    const handleSystemLog = (data: any) => {
      if (data.bot_id && bot?.id && data.bot_id !== bot.id) return;
      setLogs(prev => [{...data}, ...prev].slice(0, 1000));
    };

    socket.on(`${eventPrefix}:status`, handleStatus);
    socket.on(`${eventPrefix}:started`, handleStarted);
    socket.on(`${eventPrefix}:stopped`, handleStopped);
    socket.on(`${eventPrefix}:status_message`, handleStatusMessage);
    socket.on(`${eventPrefix}:eye_feed`, handleEyeFeed);
    socket.on(`${eventPrefix}:system_log`, handleSystemLog);
    socket.on(`${eventPrefix}:balance_update`, handleBalanceUpdate);
    socket.on(`${eventPrefix}:error`, handleError);

    return () => {
      socket.off(`${eventPrefix}:status`, handleStatus);
      socket.off(`${eventPrefix}:started`, handleStarted);
      socket.off(`${eventPrefix}:stopped`, handleStopped);
      socket.off(`${eventPrefix}:status_message`, handleStatusMessage);
      socket.off(`${eventPrefix}:eye_feed`, handleEyeFeed);
      socket.off(`${eventPrefix}:system_log`, handleSystemLog);
      socket.off(`${eventPrefix}:balance_update`, handleBalanceUpdate);
      socket.off(`${eventPrefix}:error`, handleError);
    };
  }, [socket, profileId, bot?.id]);

  const toggleEngine = () => {
    playClick();
    if (!socket || !profileId) return;
    
    const newActive = !isRunning;
    setIsRunning(newActive); // Optimistic update
    setStatusMsg(newActive ? 'Awakening...' : 'Banishment in progress...');
    
    // Single emit only — toggle_bot handles both start and stop
    socket.emit(`${eventPrefix}:toggle_bot`, { profileId, botId: bot.id, active: newActive });

    // After 6s, re-sync state from server to correct any optimistic mismatch
    setTimeout(() => {
      socket.emit(`${eventPrefix}:get_status`, { profileId, botId: bot.id });
    }, 6000);
  };

  const handleTogglePair = (pair: string, active: boolean) => {
    if (!socket || !profileId) return;
    
    // Save previous state for rollback
    const previousPairs = [...activePairs];
    
    setActivePairs(prev => {
      const idx = prev.findIndex(p => p.pair === pair);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx].enabled = active;
        return copy;
      }
      return prev;
    });

    socket.emit(`${eventPrefix}:toggle_pair`, {
      profileId,
      pair,
      enabled: active,
      botId: bot.id
    });
  };

  const handleSetPairRisk = (pair: string, riskPct: number) => {
    if (!socket || !profileId) return;

    setActivePairs(prev => {
      const idx = prev.findIndex(p => p.pair === pair);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx].riskPct = riskPct;
        return copy;
      }
      return prev;
    });

    socket.emit(`${eventPrefix}:set_pair_risk`, {
      profileId,
      pair,
      riskPct,
      botId: bot.id
    });
  };

  const currentState = useMemo(() => {
    if (!bot) return null;
    
    // Always get all recent events per pair
    if (eyeFeed.length > 0) {
      const recentEvents = [];
      const seenPairs = new Set();
      for (const ev of eyeFeed) {
        const eventTime = ev.timestamp ? new Date(ev.timestamp).getTime() : 0;
        if (now - eventTime < 20 * 60 * 1000) {
          const pairKey = ev.symbol || ev.data?.symbol;
          if (pairKey && !seenPairs.has(pairKey)) {
            recentEvents.push(ev);
            seenPairs.add(pairKey);
          }
        }
      }
      if (recentEvents.length > 0) {
        // limit to 15 to avoid huge UI overflow
        return { type: 'RECENT_EVENTS', events: recentEvents.slice(0, 15) };
      }
    }
    
    return { type: 'IDLE' };
  }, [eyeFeed, bot, now]);

  const staticBots = useMemo(() => [MAGE_BOT, SAGE_BOT, SEER_BOT], []);

  const masterTimeline = useMemo(() => diary.filter(t => {
    if (diaryFilter === 'WIN') return t.profit > 0 || t.status === 'CLOSED_WIN';
    if (diaryFilter === 'LOSS') return t.profit < 0 || t.status === 'CLOSED_LOSS';
    if (diaryFilter === 'FAILED') return t.status === 'FAILED';
    return true;
  }).map(t => ({...t, _type: 'TRADE'})).sort((a, b) => {
    if (diarySort === 'NEWEST') return new Date(b.close_time).getTime() - new Date(a.close_time).getTime();
    if (diarySort === 'OLDEST') return new Date(a.close_time).getTime() - new Date(b.close_time).getTime();
    if (diarySort === 'PROFIT_HIGH') return b.profit - a.profit;
    if (diarySort === 'PROFIT_LOW') return a.profit - b.profit;
    return 0;
  }), [diary, diaryFilter, diarySort]);

  return (
    <div className="relative space-y-6">
      
      {/* Top Header with Settings Gear */}
      <div className="flex justify-end mb-[-1rem] relative z-50">
        
      </div>

      {/* ── Settings / Profile Modal ── */}
      

      {/* Top Header Row (Mimicking TheWitch) */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-8 py-6 bg-black/50 border border-fuchsia-900/30 rounded-[2rem] shadow-xl mb-6 relative z-10 ">
        
        {/* Left: Profile Info */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-900/40 to-slate-900/80 border border-fuchsia-500/30 flex items-center justify-center text-2xl shadow-[0_0_20px_rgba(217,70,239,0.15)]">🔮</div>
          <div>
            <h3 className="font-display font-black text-white text-lg tracking-wider">
              {profileInfo ? profileInfo.name : `Trading Profile ${profileId || 'None'}`}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <Database size={12} className="text-fuchsia-400" />
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Account ID:</span>
              <span className="text-fuchsia-300 font-mono text-xs font-bold">{profileInfo ? profileInfo.accountId : 'Active Account'}</span>
            </div>
          </div>
        </div>

        {/* Right: Balance & Live Safety Metrics */}
        <div className="flex flex-wrap items-center gap-3 justify-end">
          
          {safetyStatus && (
            <>
              <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-2xl px-4 py-2 shadow-inner">
                <TrendingDown size={14} className={safetyStatus.drawdownPct > 10 ? 'text-rose-400' : 'text-emerald-400'} />
                <div className="flex flex-col">
                  <span className={`font-display font-bold text-sm leading-none ${safetyStatus.drawdownPct > 10 ? 'text-rose-400' : 'text-emerald-400'}`}>{safetyStatus.drawdownPct?.toFixed(2)}%</span>
                  <span className="text-slate-500 font-mono text-[8px] uppercase tracking-widest mt-0.5">Live DD</span>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-2xl px-4 py-2 shadow-inner">
                <Activity size={14} className={botDailyPl >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
                <div className="flex flex-col">
                  <span className={`font-display font-bold text-sm leading-none ${botDailyPl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{botDailyPl >= 0 ? '+' : ''}{botDailyPl.toFixed(2)}%</span>
                  <span className="text-slate-500 font-mono text-[8px] uppercase tracking-widest mt-0.5">Daily P/L</span>
                </div>
              </div>
            </>
          )}
          {botBalance !== null && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-5 py-3 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
              <DollarSign size={16} className="text-emerald-400" />
              <div className="flex flex-col">
                <span className="text-emerald-400 font-display font-bold text-lg leading-none">{botCurrency} {botBalance.toFixed(2)}</span>
                <span className="text-slate-500 font-mono text-[9px] uppercase tracking-widest mt-0.5">Live Balance</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Header & Controls */}
      <div className="bg-black/50 border border-fuchsia-900/40 rounded-3xl p-6 shadow-2xl relative overflow-hidden group">
        {bot && bot.image && (
          <div className="absolute inset-0 bg-cover bg-center opacity-20 pointer-events-none animate-living-bg" style={{ backgroundImage: `url(${bot.image})` }} />
        )}
        <div className="absolute inset-0 animate-dust opacity-30 mix-blend-screen pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-fuchsia-900/20 to-transparent pointer-events-none transition-opacity duration-1000 group-hover:opacity-100 opacity-80" />
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
          <div>
            <h2 className="text-3xl font-display font-black text-white flex items-center gap-4 tracking-wider drop-shadow-[0_0_10px_rgba(217,70,239,0.5)]">
              <span className="text-4xl filter drop-shadow-[0_0_15px_rgba(217,70,239,0.8)]">🔮</span> {bot ? bot.name : 'The DiscretionaryTrader'}
              {isRunning && (
                <span className="flex h-4 w-4 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-fuchsia-500 shadow-[0_0_15px_rgba(217,70,239,1)]"></span>
                </span>
              )}
            </h2>
            <p className="text-fuchsia-300/80 font-mono text-sm mt-1 uppercase tracking-widest">Vision AI Live Execution Engine</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-slate-500 font-mono uppercase">Status</div>
              <div className={`text-sm font-bold ${isRunning ? 'text-purple-400' : 'text-slate-400'}`}>
                {statusMsg}
              </div>
            </div>
            
            <button type="button"
              onClick={toggleEngine}
              disabled={!isConnected}
              className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-black uppercase tracking-widest transition-all duration-500 shadow-2xl ${
                !isConnected ? 'bg-black/50 text-slate-600 border border-white/10 cursor-not-allowed' :
                isRunning 
                  ? 'bg-black/50 text-rose-500 border border-rose-900/50 hover:bg-rose-950 hover:text-white hover:border-rose-500 shadow-[0_0_20px_rgba(225,29,72,0.2)]' 
                  : 'bg-fuchsia-900/80 text-white border border-fuchsia-400/50 hover:bg-fuchsia-700 shadow-[0_0_30px_rgba(217,70,239,0.4)] hover:shadow-[0_0_50px_rgba(217,70,239,0.8)]'
              }`}
            >
              {isRunning ? <><Square size={20} fill="currentColor" /> Banish</> : <><Play size={20} fill="currentColor" /> Awaken</>}
            </button>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex bg-black/50 p-1 rounded-2xl border border-fuchsia-900/30 mb-6 w-full overflow-x-auto custom-scrollbar shadow-xl">
        <button type="button"
          onClick={() => setMainTab('vision')}
          className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl text-xs font-display font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${mainTab === 'vision' ? 'bg-fuchsia-900/80 text-white shadow-[0_0_15px_rgba(217,70,239,0.4)] border border-fuchsia-500/50' : 'text-fuchsia-300/50 hover:bg-fuchsia-900/30 hover:text-fuchsia-200 border border-transparent'}`}
        >
          <Eye size={14} /> Vision Engine
        </button>
        <button type="button"
          onClick={() => setMainTab('analytics')}
          className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl text-xs font-display font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${mainTab === 'analytics' ? 'bg-fuchsia-900/80 text-white shadow-[0_0_15px_rgba(217,70,239,0.4)] border border-fuchsia-500/50' : 'text-fuchsia-300/50 hover:bg-fuchsia-900/30 hover:text-fuchsia-200 border border-transparent'}`}
        >
          <BarChart2 size={14} /> Analytics
        </button>
        <button type="button"
          onClick={() => setMainTab('diary')}
          className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl text-xs font-display font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${mainTab === 'diary' ? 'bg-fuchsia-900/80 text-white shadow-[0_0_15px_rgba(217,70,239,0.4)] border border-fuchsia-500/50' : 'text-fuchsia-300/50 hover:bg-fuchsia-900/30 hover:text-fuchsia-200 border border-transparent'}`}
        >
          <TrendingUp size={14} /> Trade Diary
        </button>
        <button type="button"
          onClick={() => setMainTab('logs')}
          className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl text-xs font-display font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${mainTab === 'logs' ? 'bg-fuchsia-900/80 text-white shadow-[0_0_15px_rgba(217,70,239,0.4)] border border-fuchsia-500/50' : 'text-fuchsia-300/50 hover:bg-fuchsia-900/30 hover:text-fuchsia-200 border border-transparent'}`}
        >
          <Database size={14} /> System Logs
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={mainTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {mainTab === 'vision' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Active Pairs */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-black/50 border border-fuchsia-900/30 rounded-3xl p-5 max-h-[800px] overflow-y-auto shadow-2xl custom-scrollbar">
            <div className="flex flex-col mb-6 gap-3">
              <h3 className="text-sm font-black text-fuchsia-200 uppercase tracking-widest flex items-center gap-3 drop-shadow-md">
                <Activity size={18} className="text-fuchsia-500" /> Tracked Instruments
              </h3>
              
            </div>
            <div className="space-y-4">
              {activePairs.length === 0 ? (
                <div className="text-xs text-slate-600 font-mono italic">Awaiting connection...</div>
              ) : (
                categoryOrder.map(cat => {
                  const pairsInCat = groupedPairs[cat as keyof typeof groupedPairs];
                  if (pairsInCat.length === 0) return null;
                  const isExpanded = expandedCategories[cat];

                  return (
                    <div key={cat} className="space-y-2">
                      <div 
                        className="flex items-center justify-between cursor-pointer p-3 rounded-xl hover:bg-fuchsia-900/20 transition-all border border-transparent hover:border-fuchsia-500/20"
                        onClick={() => toggleCategory(cat)}
                      >
                        <h4 className="text-xs font-black text-fuchsia-400 uppercase tracking-widest drop-shadow-md">{cat}</h4>
                        {isExpanded ? <ChevronDown size={16} className="text-fuchsia-500" /> : <ChevronRight size={16} className="text-slate-500" />}
                      </div>

                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="space-y-2 overflow-hidden pl-2 border-l-2 border-fuchsia-900/30 ml-2 mt-2"
                          >
                            {pairsInCat.map(p => (
                              <div key={p.pair} className={`rounded-xl border transition-all duration-300 ${p.enabled ? 'bg-black/50 border-fuchsia-500/40 shadow-[0_0_15px_rgba(217,70,239,0.1)]' : 'bg-black/30 border-white/10/50 opacity-50'}`}>
                                <div 
                                  className="p-3 flex items-center justify-between cursor-pointer"
                                  onClick={() => {
                                    if (p.enabled) {
                                      setExpandedPair(expandedPair === p.pair ? null : p.pair);
                                      playClick();
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-3">
                                    <div 
                                      className={`w-10 h-6 rounded-full flex items-center p-1 cursor-pointer transition-colors border border-fuchsia-900/50 ${p.enabled ? 'bg-fuchsia-600 shadow-[0_0_10px_rgba(217,70,239,0.5)]' : 'bg-slate-800'}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleTogglePair(p.pair, !p.enabled);
                                      }}
                                    >
                                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${p.enabled ? 'translate-x-4 shadow-sm' : 'translate-x-0'}`} />
                                    </div>
                                    <span className={`font-display font-black tracking-wider ${p.enabled ? 'text-white drop-shadow-md' : 'text-slate-500'}`}>{p.pair}</span>
                                    {p.activeTradesList && p.activeTradesList.length > 0 && (
                                      <div className="flex gap-1 ml-2 flex-wrap">
                                        {p.activeTradesList.map((tr: any) => (
                                          <span key={tr.id} className="text-[10px] font-bold text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded border border-green-500/50 truncate max-w-[100px]" title={tr.comment}>
                                            {tr.comment || 'Active'}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Per-Pair Risk Slider */}
                                  {p.enabled && (
                                  <div className="flex-1 max-w-[120px] flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                      <span className="text-[10px] font-mono text-fuchsia-400 font-bold">{p.riskPct}x</span>
                                      <input 
                                        type="range" 
                                        min="0.1" 
                                        max="50" 
                                        step="0.1"
                                        value={p.riskPct}
                                        onChange={(e) => handleSetPairRisk(p.pair, parseFloat(e.target.value))}
                                        className="w-full h-1 bg-black/50 rounded-lg appearance-none cursor-pointer accent-fuchsia-500"
                                        title={`${p.pair} Risk Multiplier: ${p.riskPct}x`}
                                      />
                                  </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: AI Evaluations ("The Eye") */}
        <div className="lg:col-span-2">
          <div className="bg-black/50 border border-fuchsia-900/30 rounded-3xl p-8 h-full min-h-[500px] flex flex-col shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-fuchsia-600/10 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-rose-600/10 rounded-full blur-[100px] pointer-events-none" />
            
            <div className="flex justify-between items-start mb-6 relative z-10">
              <h3 className="text-lg font-display font-black text-fuchsia-200 uppercase tracking-widest flex items-center gap-3 drop-shadow-md">
                <span className="relative flex h-5 w-5 mr-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-30"></span>
                  <Eye size={20} className="relative text-fuchsia-500" />
                </span>
                {bot ? `${bot.name}'s Eye` : "The DiscretionaryTrader's Eye"}
              </h3>

              {bot?.id === 'seer' && (
                <div className={`px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase shadow-lg border transition-all duration-1000 ${inKillzone ? 'bg-fuchsia-900/50 text-white border-fuchsia-500/50 shadow-[0_0_15px_rgba(217,70,239,0.3)]' : 'bg-black/50 text-slate-500 border-white/10'}`}>
                  {inKillzone ? '🟢 3-Hour Killzone Active' : windowLabel}
                </div>
              )}
            </div>

            {/* Daily Bias Ticker */}
            {bot?.id === 'seer' && (
              <div className="flex gap-2 overflow-x-auto pb-4 mb-2 custom-scrollbar relative z-10 w-full">
                {activePairs.filter(p => p.enabled && p.bias && p.bias !== 'NONE').length > 0 ? (
                  activePairs.filter(p => p.enabled && p.bias && p.bias !== 'NONE').map(p => (
                   <div key={p.pair} className={`flex-shrink-0 px-3 py-1.5 rounded-lg border text-xs font-mono font-bold whitespace-nowrap shadow-sm ${p.bias === 'FRD' || p.bias === 'DAY3_SHORT' || p.bias === 'LHF_SHORT' ? 'bg-rose-950/40 border-rose-900/50 text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.1)]' : p.bias === 'FGD' || p.bias === 'DAY3_LONG' || p.bias === 'LHF_LONG' ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-indigo-950/40 border-indigo-900/50 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.1)]'}`}>
                     {p.pair}: {p.bias === 'FRD' ? '🔴 FRD (SELL)' : p.bias === 'FGD' ? '🟢 FGD (BUY)' : `🔍 ${p.bias}`}
                   </div>
                  ))
                ) : (
                  <div className="text-xs font-mono text-slate-600 italic px-2">No daily bias context detected yet. Warming up...</div>
                )}
              </div>
            )}
            
            <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar relative z-10 border-t border-fuchsia-900/30 pt-6 mt-2">
              {currentState?.type === 'IDLE' ? (
                <div className="h-full flex flex-col items-center justify-center text-fuchsia-300/50 font-display font-bold tracking-widest text-sm gap-6">
                  <div className="w-24 h-24 rounded-full border border-fuchsia-900/50 flex items-center justify-center bg-fuchsia-900/10 shadow-[0_0_30px_rgba(217,70,239,0.1)] relative">
                    <div className="absolute inset-0 rounded-full border-t border-fuchsia-500/50 animate-spin" style={{ animationDuration: '3s' }} />
                    <Eye size={32} className="text-fuchsia-500/50" />
                  </div>
                  Scanning Markets...
                </div>
              ) : currentState?.type === 'RECENT_EVENTS' && currentState.events ? (
                <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {currentState.events.map((ev: any, i: number) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-black/50 border border-fuchsia-900/40 rounded-2xl p-4 shadow-xl relative overflow-hidden group"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-900/10 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
                      
                      {/* Header Row */}
                      <div className="flex justify-between items-start mb-2 relative z-10">
                        <div className="flex items-center gap-3">
                          {/* Bot Icon */}
                          <span className="text-lg opacity-80" title={ev.bot_id || 'System'}>
                            {ev.bot_id === 'mage' ? '🔮' : ev.bot_id === 'sage' ? '🦉' : ev.bot_id === 'seer' ? '👁️' : '⚙️'}
                          </span>
                          
                          {/* Event Type / Direction Badge */}
                          <span className={`px-2 py-1 rounded-md text-[10px] font-black tracking-widest uppercase shadow-lg ${
                            (ev.data?.decision?.includes('BUY') || ev.data?.direction === 'LONG' || ev.data?.direction === 'BUY') ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30' :
                            (ev.data?.decision?.includes('SELL') || ev.data?.direction === 'SHORT' || ev.data?.direction === 'SELL') ? 'bg-rose-950/80 text-rose-400 border border-rose-500/30' :
                            (ev.type?.includes('REJECT') || ev.type?.includes('CLOSE') || ev.data?.decision?.includes('NO_TRADE')) ? 'bg-amber-950/80 text-amber-400 border border-amber-500/30' :
                            'bg-black/50 text-slate-400 border border-white/10'
                          }`}>
                            {ev.data?.decision || ev.data?.direction || ev.type?.replace('_', ' ')}
                          </span>
                          
                          {/* Symbol */}
                          <span className="font-display font-black text-base text-white drop-shadow-md tracking-wider">{ev.symbol || ev.data?.symbol || 'SYS'}</span>
                          
                          {/* Setup Type */}
                          {ev.data?.setupType && <span className="text-[9px] text-fuchsia-300 font-mono bg-fuchsia-950/50 border border-fuchsia-900/50 px-1.5 py-0.5 rounded shadow-inner uppercase tracking-widest hidden sm:inline-block">{ev.data.setupType}</span>}
                        </div>
                        
                        {/* Timestamp & Confidence */}
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[9px] text-slate-500 font-mono">{formatTime(ev.timestamp)}</span>
                          {ev.data?.confidence && (
                            <div className="text-[10px] text-fuchsia-400/80 font-mono font-bold bg-black/50 px-2 py-1 rounded-md border border-fuchsia-900/30">
                              Conf: <span className="text-white">{ev.data.confidence}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Rich Data Grid */}
                      {ev.data && (ev.data.price || ev.data.sl || ev.data.tp || ev.data.volume) && (
                        <div className="grid grid-cols-4 gap-2 mb-3 mt-3 relative z-10">
                          {ev.data.price && (
                            <div className="flex flex-col bg-white/[0.02] border border-white/5 p-1.5 rounded-lg text-center">
                              <span className="text-[9px] text-slate-500 uppercase tracking-widest mb-0.5">Entry</span>
                              <span className="text-xs text-slate-200 font-mono font-medium">{ev.data.price}</span>
                            </div>
                          )}
                          {ev.data.sl && (
                            <div className="flex flex-col bg-white/[0.02] border border-rose-900/20 p-1.5 rounded-lg text-center">
                              <span className="text-[9px] text-rose-500/70 uppercase tracking-widest mb-0.5">Stop Loss</span>
                              <span className="text-xs text-rose-400 font-mono font-medium">{ev.data.sl}</span>
                            </div>
                          )}
                          {ev.data.tp && (
                            <div className="flex flex-col bg-white/[0.02] border border-emerald-900/20 p-1.5 rounded-lg text-center">
                              <span className="text-[9px] text-emerald-500/70 uppercase tracking-widest mb-0.5">Take Profit</span>
                              <span className="text-xs text-emerald-400 font-mono font-medium">{ev.data.tp}</span>
                            </div>
                          )}
                          {ev.data.volume && (
                            <div className="flex flex-col bg-white/[0.02] border border-white/5 p-1.5 rounded-lg text-center">
                              <span className="text-[9px] text-slate-500 uppercase tracking-widest mb-0.5">Volume</span>
                              <span className="text-xs text-fuchsia-300 font-mono font-medium">{ev.data.volume} Lots</span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Message / Reasoning */}
                      {(ev.data?.reasoning || ev.message || ev.data?.detail) && (
                        <p className="text-xs text-slate-300 font-serif leading-relaxed italic border-l-2 border-fuchsia-600/50 pl-3 relative z-10 drop-shadow-sm whitespace-pre-wrap mt-2">
                          "{ev.data?.reasoning || ev.data?.detail || ev.message}"
                        </p>
                      )}
                    </motion.div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
            </div>
          )}

          {mainTab === 'analytics' && (
            <TradeAnalytics 
              diary={allTrades} 
              bots={staticBots} 
              selectedBotId={analyticsBotId} 
              onSelectBot={setAnalyticsBotId} 
              analyticsData={analyticsData}
            />
          )}

          {mainTab === 'diary' && (() => {
            return (
              <div className="bg-black/50 border border-fuchsia-900/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <h3 className="text-sm font-black text-fuchsia-200 uppercase tracking-widest flex items-center gap-3 drop-shadow-md">
                    <TrendingUp size={18} className="text-fuchsia-500" /> Audit Ledger & Trade Diary
                  </h3>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button"
                      disabled={isResetting}
                        onClick={async () => {
                        if (!confirm('Are you sure you want to reset the trade diary? This cannot be undone.')) return;
                        try {
                          setIsResetting(true);
                          const res = await fetch(`/api/auth/profiles/${profileId}/diary/reset`, { method: 'POST', credentials: 'same-origin' });
                          setIsResetting(false);
                          const data = await res.json();
                          if (data.success) {
                            setDiary([]);
                            setAllTrades([]);
                            playSuccess();
                          } else {
                            playError();
                          }
                        } catch (e) {
                          playError();
                        }
                      }}
                      className="bg-black/50 border border-fuchsia-900/50 text-fuchsia-200 hover:text-white hover:bg-fuchsia-900/40 hover:border-fuchsia-500/50 text-xs font-mono rounded-xl px-3 py-1.5 focus:outline-none transition-all flex items-center gap-1"
                    >
                      <Trash2 size={12} />
                      Reset
                    </button>
                    <select
                      value={diaryFilter}
                      onChange={(e: any) => setDiaryFilter(e.target.value)}
                      className="bg-black/50 border border-fuchsia-900/50 text-fuchsia-200 text-xs font-mono rounded-xl px-3 py-1.5 focus:outline-none focus:border-fuchsia-500"
                    >
                      <option value="ALL">All Entries</option>
                      <option value="WIN">Winning Trades</option>
                      <option value="LOSS">Losing Trades</option>
                      <option value="FAILED">Failed Executions</option>
                    </select>
                    <select
                      value={diarySort}
                      onChange={(e: any) => setDiarySort(e.target.value)}
                      className="bg-black/50 border border-fuchsia-900/50 text-fuchsia-200 text-xs font-mono rounded-xl px-3 py-1.5 focus:outline-none focus:border-fuchsia-500"
                    >
                      <option value="NEWEST">Newest First</option>
                      <option value="OLDEST">Oldest First</option>
                      <option value="PROFIT_HIGH">Highest Profit</option>
                      <option value="PROFIT_LOW">Lowest Profit</option>
                    </select>
                    <span className="text-[10px] font-mono text-fuchsia-300/50 px-2">{masterTimeline.length} Entries</span>
                  </div>
                </div>
                
                {masterTimeline.length === 0 ? (
                  <div className="text-center py-10 text-fuchsia-300/50 font-mono text-xs">No entries match the selected filter.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-fuchsia-900/30 text-fuchsia-300/50 uppercase tracking-widest">
                          <th className="pb-3 px-2 font-medium">Date</th>
                          <th className="pb-3 px-2 font-medium">Symbol</th>
                          <th className="pb-3 px-2 font-medium">Action</th>
                          <th className="pb-3 px-2 font-medium">Entry</th>
                          <th className="pb-3 px-2 font-medium">Exit</th>
                          <th className="pb-3 px-2 font-medium">Pips</th>
                          <th className="pb-3 px-2 font-medium">Profit</th>
                          <th className="pb-3 px-2 font-medium">Details / Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {masterTimeline.map((item: any, idx: number) => {
                          const time = formatDateTime(item.close_time);
                          const symbol = item.broker_symbol;

                          return (
                            <tr key={`trade-${item.id}`} className="border-b border-fuchsia-900/20 hover:bg-fuchsia-900/10 transition-colors">
                              <td className="py-3 px-2 text-fuchsia-200/80">{time}</td>
                              <td className="py-3 px-2 text-fuchsia-400 font-bold">{symbol}</td>
                              <td className={`py-3 px-2 ${item.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{item.direction}</td>
                              <td className="py-3 px-2 text-fuchsia-200/60">{item.entry_price?.toFixed(3) || '---'}</td>
                              <td className="py-3 px-2 text-fuchsia-200/60">{item.exit_price?.toFixed(3) || '---'}</td>
                              <td className="py-3 px-2 text-white">{item.pips?.toFixed(1) || '0.0'}</td>
                              <td className={`py-3 px-2 ${item.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${item.profit?.toFixed(2) || '0.00'}</td>
                              <td className={`py-3 px-2 font-bold ${item.status === 'CLOSED_WIN' || item.status === 'WON' ? 'text-emerald-400' : item.status === 'CLOSED_LOSS' || item.status === 'LOST' ? 'text-rose-400' : 'text-amber-400'}`}>{item.status}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {mainTab === 'logs' && (
            <div className="bg-black/50 border border-fuchsia-900/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden h-[600px] flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <h3 className="text-sm font-black text-fuchsia-200 uppercase tracking-widest flex items-center gap-3 drop-shadow-md">
                  <Database size={18} className="text-fuchsia-500" /> System Logs Stream
                </h3>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-fuchsia-300/50 bg-fuchsia-950/30 px-3 py-1 rounded-full border border-fuchsia-900/30">
                    {logs.length} Entries
                  </span>
                  <button 
                    type="button" 
                    onClick={fetchLogs} 
                    title="Refresh Logs"
                    className="p-1.5 rounded-lg bg-fuchsia-950/40 border border-fuchsia-900/40 text-fuchsia-300 hover:text-white hover:bg-fuchsia-900/50 transition-colors"
                  >
                    <RefreshCw size={14} className={isLogsLoading ? "animate-spin" : ""} />
                  </button>
                  <button 
                    type="button" 
                    onClick={handleClearLogs} 
                    title="Delete All Logs"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:text-rose-200 hover:bg-rose-900/60 transition-colors text-[10px] font-mono uppercase tracking-wider font-bold"
                  >
                    <Trash2 size={12} /> Clear Logs
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar bg-black/40 rounded-xl border border-fuchsia-900/20 p-4 space-y-3 font-mono text-[11px]">
                {logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 italic">
                    <Terminal size={32} className="mb-3 opacity-20" />
                    No system logs available for this engine yet...
                  </div>
                ) : (
                  logs.map((log: any, idx: number) => {
                    const rawTime = log.timestamp || log.created_at || log.time;
                    const dateDisplay = formatDateTime(rawTime);
                    const isError = log.action?.includes('ERROR') || log.action?.includes('Aborted') || log.action?.includes('Failed');
                    const isEntered = log.action?.includes('ENTERED') || log.action?.includes('Placed') || log.action?.includes('BUY') || log.action?.includes('SELL');

                    return (
                      <div key={`log-${log.id || idx}`} className="group relative border-l-2 pl-3 hover:bg-white/[0.02] p-2.5 rounded-lg transition-colors bg-slate-950/30" style={{
                        borderColor: isError ? '#ef4444' : isEntered ? '#10b981' : '#a855f7'
                      }}>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] uppercase ${
                              isError ? 'bg-rose-950/80 text-rose-300 border border-rose-800/50' : 
                              isEntered ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50' : 
                              'bg-purple-950/80 text-purple-300 border border-purple-800/50'
                            }`}>
                              [{log.action}]
                            </span>
                            {log.symbol && (
                              <span className="text-fuchsia-300 font-bold bg-fuchsia-950/60 px-1.5 py-0.5 rounded border border-fuchsia-900/40">
                                {log.symbol}
                              </span>
                            )}
                            {log.bot_id && (
                              <span className="text-[9px] uppercase tracking-wider text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                {log.bot_id}
                              </span>
                            )}
                          </div>
                          <span className="text-slate-400 text-[10px]">
                            [{dateDisplay}]
                          </span>
                        </div>
                        <div className="text-slate-300 leading-relaxed whitespace-pre-wrap pl-0.5">{log.details}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      
    </div>
  );
}

