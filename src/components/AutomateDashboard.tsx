import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings, Shield, Link, Power, Crosshair, AlertTriangle, Save,
  Loader, CheckCircle2, Bot, TrendingUp, BarChart2, Zap, RefreshCw,
  Lock, ChevronRight, ChevronDown, ChevronUp, Activity, Target, Clock, DollarSign, Database, Wifi, Settings2, ShieldAlert, Trash2
} from 'lucide-react';
import TradeAnalytics from './TradeAnalytics';

// ── Types ─────────────────────────────────────────────────────────────────────
interface BotCardData {
  id: string;
  name: string;
  tagline: string;
  description: string;
  symbols: string[];
  riskPct: number;
  strategyType: string;
  color: string;
  icon: string;
  winRateBacktest: number;
  returnBacktest: string;
  maxDDBacktest: number;
  tier?: string;
  isActive: boolean;
}

interface TradeDiaryEntry {
  id: number;
  user_id: number;
  bot_id: string;
  broker_symbol: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  lots: number;
  pips: number;
  profit: number;
  status: string;
  open_time: number;
  close_time: number;
}

const COLOR_MAP: Record<string, { glow: string; border: string; badge: string; toggle: string; text: string; bg: string }> = {
  amber: {
    glow:   'shadow-[0_0_40px_rgba(251,191,36,0.15)]',
    border: 'border-amber-500/40',
    badge:  'bg-amber-500/10 text-amber-400 border border-amber-500/30',
    toggle: 'bg-amber-500',
    text:   'text-amber-400',
    bg:     'bg-amber-500/10',
  },
  indigo: {
    glow:   'shadow-[0_0_40px_rgba(99,102,241,0.15)]',
    border: 'border-indigo-500/40',
    badge:  'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30',
    toggle: 'bg-indigo-500',
    text:   'text-indigo-400',
    bg:     'bg-indigo-500/10',
  },
  emerald: {
    glow:   'shadow-[0_0_40px_rgba(16,185,129,0.15)]',
    border: 'border-emerald-500/40',
    badge:  'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
    toggle: 'bg-emerald-500',
    text:   'text-emerald-400',
    bg:     'bg-emerald-500/10',
  },
  rose: {
    glow:   'shadow-[0_0_40px_rgba(244,63,94,0.15)]',
    border: 'border-rose-500/40',
    badge:  'bg-rose-500/10 text-rose-400 border border-rose-500/30',
    toggle: 'bg-rose-500',
    text:   'text-rose-400',
    bg:     'bg-rose-500/10',
  },
  sky: {
    glow:   'shadow-[0_0_40px_rgba(14,165,233,0.15)]',
    border: 'border-sky-500/40',
    badge:  'bg-sky-500/10 text-sky-400 border border-sky-500/30',
    toggle: 'bg-sky-500',
    text:   'text-sky-400',
    bg:     'bg-sky-500/10',
  },
  purple: {
    glow:   'shadow-[0_0_40px_rgba(168,85,247,0.15)]',
    border: 'border-purple-500/40',
    badge:  'bg-purple-500/10 text-purple-400 border border-purple-500/30',
    toggle: 'bg-purple-500',
    text:   'text-purple-400',
    bg:     'bg-purple-500/10',
  },
};

// ── Bot Card Component ────────────────────────────────────────────────────────
function BotCard({ bot, onToggle, disabled, riskPercentage = 5 }: { bot: BotCardData; onToggle: (id: string, active: boolean) => void | Promise<void>; disabled: boolean; riskPercentage?: number; key?: React.Key }) {
  let mappedColor = bot.color;
  if (bot.tier === 'Apex') mappedColor = 'indigo';
  else if (bot.tier === 'Institutional') mappedColor = 'purple';
  else if (bot.tier === 'Prop') mappedColor = 'sky';
  else if (bot.tier === 'Scout') mappedColor = 'amber';

  const colors = COLOR_MAP[mappedColor] || COLOR_MAP.indigo;
  const [expanded, setExpanded] = useState(false);

  const riskMultiplier = riskPercentage / 5;
  const numericReturn = parseInt(bot.returnBacktest.replace(/[^0-9-]/g, ''), 10);
  const adjustedReturn = isNaN(numericReturn) ? bot.returnBacktest : `+${Math.round(numericReturn * riskMultiplier)}%/yr`;
  const adjustedDD = (bot.maxDDBacktest * riskMultiplier).toFixed(1);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-2xl border bg-slate-900/60 backdrop-blur-xl overflow-hidden transition-all duration-500 ${
        bot.isActive
          ? `${colors.border} ${colors.glow}`
          : 'border-slate-700/50'
      }`}
    >
      {/* Active pulse border */}
      {bot.isActive && (
        <div className={`absolute inset-0 rounded-2xl opacity-20 ${colors.bg} pointer-events-none`} />
      )}

      {/* Header */}
      <div className="p-5 flex items-start gap-4">
        {/* Icon */}
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 ${
          bot.isActive ? colors.bg : 'bg-slate-800'
        } transition-colors duration-300`}>
          {bot.icon}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-display font-black text-lg tracking-tight">{bot.name}</h3>
            {bot.tier && (
               <span className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                 bot.tier === 'Apex' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' :
                 bot.tier === 'Institutional' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
                 bot.tier === 'Prop'    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' :
                 'bg-slate-700/30 text-slate-400 border-slate-600/50'
               }`}>
                 {bot.tier}
               </span>
            )}
            {bot.isActive && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 ml-auto"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </motion.span>
            )}
          </div>
          <p className={`text-xs font-mono uppercase tracking-wider ${colors.text}`}>{bot.tagline}</p>
        </div>

        {/* Toggle */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          <button
            disabled={disabled}
            onClick={() => onToggle(bot.id, !bot.isActive)}
            className={`relative w-14 h-7 rounded-full transition-all duration-300 ${
              bot.isActive ? colors.toggle : 'bg-slate-700'
            } disabled:opacity-40 disabled:cursor-not-allowed shadow-inner`}
          >
            <span className={`absolute top-0.5 left-0.5 bg-white w-6 h-6 rounded-full transition-transform duration-300 shadow-md ${
              bot.isActive ? 'translate-x-7' : 'translate-x-0'
            }`} />
          </button>
          <span className={`text-[9px] font-mono uppercase tracking-wider ${bot.isActive ? colors.text : 'text-slate-600'}`}>
            {bot.isActive ? 'Armed' : 'Off'}
          </span>
        </div>
      </div>

      {/* Stats bar */}
      <div className="px-5 pb-4 grid grid-cols-3 gap-3">
        <div className={`rounded-xl p-3 ${bot.isActive ? colors.bg : 'bg-slate-800/50'}`}>
          <div className="flex items-center gap-1 mb-1">
            <Target size={10} className={bot.isActive ? colors.text : 'text-slate-500'} />
            <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">Win Rate</span>
          </div>
          <span className={`text-lg font-display font-black ${bot.isActive ? colors.text : 'text-slate-400'}`}>
            {bot.winRateBacktest}%
          </span>
        </div>
        <div className={`rounded-xl p-3 ${bot.isActive ? colors.bg : 'bg-slate-800/50'}`}>
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp size={10} className={bot.isActive ? colors.text : 'text-slate-500'} />
            <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">Return</span>
          </div>
          <span className={`text-sm font-display font-black ${bot.isActive ? colors.text : 'text-slate-400'}`}>
            {adjustedReturn}
          </span>
        </div>
        <div className={`rounded-xl p-3 ${bot.isActive ? colors.bg : 'bg-slate-800/50'}`}>
          <div className="flex items-center gap-1 mb-1">
            <Activity size={10} className={bot.isActive ? colors.text : 'text-slate-500'} />
            <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">Max DD</span>
          </div>
          <span className={`text-lg font-display font-black ${bot.isActive ? colors.text : 'text-slate-400'}`}>
            {adjustedDD}%
          </span>
        </div>
      </div>

      {/* Symbol tags */}
      <div className="px-5 pb-4 flex flex-wrap gap-1.5">
        {bot.symbols.slice(0, 4).map(s => (
          <span key={s} className={`text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-lg ${colors.badge}`}>
            {s}
          </span>
        ))}
        {bot.symbols.length > 4 && (
          <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-lg bg-slate-800 text-slate-500">
            +{bot.symbols.length - 4} more
          </span>
        )}
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-3 flex items-center justify-between text-slate-600 hover:text-slate-400 border-t border-slate-800 transition-colors text-xs font-mono uppercase tracking-wider"
      >
        Strategy Details
        <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Expandable description */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 text-slate-400 text-xs font-mono leading-relaxed border-t border-slate-800/50">
              <p className="mt-3">{bot.description}</p>
              <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
                <DollarSign size={10} />
                Base risk per trade: <span className={colors.text}>{bot.riskPct}%</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function AutomateDashboard() {
  const [profiles, setProfiles]                 = useState<any[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [newProfileName, setNewProfileName]     = useState('');
  const [newProfileAccountId, setNewProfileAccountId] = useState('');
  const [creatingProfile, setCreatingProfile]   = useState(false);

  const [bots, setBots]                         = useState<BotCardData[]>([]);
  const [metaapiAccountId, setMetaapiAccountId] = useState('');
  const [automationActive, setAutomationActive] = useState(false);
  const [aiSniperActive, setAiSniperActive]     = useState(false);
  const [riskPercentage, setRiskPercentage]     = useState(5);
  const [dataSource, setDataSource]             = useState<'yahoo' | 'metaapi'>('yahoo');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [diary, setDiary]       = useState<TradeDiaryEntry[]>([]);
  const [analyticsTab, setAnalyticsTab] = useState<'diary' | 'analytics'>('analytics');
  const [selectedBotId, setSelectedBotId] = useState<string>('all');
  const [message, setMessage]   = useState('');
  const [messageType, setMessageType] = useState<'success'|'error'>('success');
  const [syncStatus, setSyncStatus] = useState<'offline' | 'syncing' | 'connected'>('offline');
  const [botHealth, setBotHealth] = useState<any>({ health: 'offline', pendingSignals: 0, missedSignals: 0 });
  const [analyticsData, setAnalyticsData] = useState<any>(null);

  // UI Collapse States
  const [botsSectionExpanded, setBotsSectionExpanded] = useState(true);
  const [expandedTiers, setExpandedTiers] = useState<Record<string, boolean>>({
    Apex: true, Institutional: true, Prop: true, Scout: true
  });

  const toggleTier = (tier: string) => {
    setExpandedTiers(prev => ({ ...prev, [tier]: !prev[tier] }));
  };

  const showMsg = (msg: string, type: 'success'|'error' = 'success') => {
    setMessage(msg); setMessageType(type);
    setTimeout(() => setMessage(''), 5000);
  };

  // Poll MetaAPI Analytics periodically
  useEffect(() => {
    if (!selectedProfileId) return;
    
    const fetchAnalytics = async () => {
      try {
        const res = await fetch(`/api/auth/profiles/${selectedProfileId}/metaapi/analytics`, { credentials: 'same-origin' });
        const data = await res.json();
        if (data.success) setAnalyticsData(data);
      } catch (e) {
        console.error('Analytics poll failed', e);
      }
    };
    
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 15000); // 15 seconds
    return () => clearInterval(interval);
  }, [selectedProfileId]);

  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);
  const handleRefreshAnalytics = async () => {
    if (!selectedProfileId) return;
    setRefreshingAnalytics(true);
    try {
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}/metaapi/analytics?force=true`, { credentials: 'same-origin' });
      const data = await res.json();
      if (data.success) {
        setAnalyticsData(data);
        showMsg('Live data refreshed from MetaAPI', 'success');
      }
    } catch (e) {
      showMsg('Failed to refresh data', 'error');
    } finally {
      setRefreshingAnalytics(false);
    }
  };

  const loadData = useCallback(async (forceProfileId?: number) => {
    setLoading(true);
    try {
      const profilesRes = await fetch('/api/auth/profiles', { credentials: 'same-origin' });
      const profilesData = await profilesRes.json();
      
      let pId = forceProfileId !== undefined ? forceProfileId : selectedProfileId;
      
      if (profilesData.success) {
        setProfiles(profilesData.profiles);
        if (!pId && profilesData.profiles.length > 0) {
          pId = profilesData.profiles[0].id;
          setSelectedProfileId(pId);
        }
      }

      if (!pId) {
        setLoading(false);
        return;
      }

      const [botsRes, diaryRes, dsRes, healthRes] = await Promise.all([
        fetch(`/api/auth/profiles/${pId}/bots`, { credentials: 'same-origin' }),
        fetch(`/api/auth/profiles/${pId}/diary`, { credentials: 'same-origin' }),
        fetch('/api/data-source'),
        fetch('/api/bot-health'),
      ]);
      
      const botsData = await botsRes.json();
      const dsData   = await dsRes.json();
      const diaryData = await diaryRes.json();
      const healthData = await healthRes.json();

      const profile = profilesData.profiles?.find((p: any) => p.id === pId);
      if (profile) {
        setMetaapiAccountId(profile.metaapi_account_id || '');
        setAutomationActive(profile.automation_active === 1);
        setAiSniperActive(profile.ai_sniper_active === 1);
        setRiskPercentage(profile.risk_multiplier === 1 ? 5 : (profile.risk_multiplier || 5));
      }

      if (botsData.success) setBots(botsData.bots);
      if (dsData.success) setDataSource(dsData.source);
      if (diaryData.success) setDiary(diaryData.trades || []);
      if (healthData.success) setBotHealth(healthData);
      
    } catch (e) {
      console.error('[AutomateDashboard] Load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    const checkSyncStatus = async () => {
      try {
        const res = await fetch('/api/auth/metaapi/status', { credentials: 'same-origin' });
        const data = await res.json();
        
        if (data.status === 'connected' && syncStatus === 'syncing') {
          showMsg('MetaAPI syncing completed successfully. Bots are now active!', 'success');
        } else if (data.status === 'offline' && syncStatus === 'syncing') {
          showMsg('MetaAPI sync timeout. Using Yahoo Data fallback.', 'error');
        }
        setSyncStatus(data.status);
        
        // Stop polling if connected or offline (only poll while syncing)
        if (data.status !== 'syncing') {
          clearInterval(interval);
        }
      } catch (e) {
        // Ignore fetch errors during polling
      }
    };

    if (syncStatus === 'syncing' || syncStatus === 'offline') {
      interval = setInterval(checkSyncStatus, 3000);
      checkSyncStatus(); // Initial check
    }

    return () => clearInterval(interval);
  }, [syncStatus]);

  useEffect(() => {
    loadData();
    const healthInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/bot-health');
        const data = await res.json();
        if (data.success) setBotHealth(data);
      } catch (e) {}
    }, 10000);
    return () => clearInterval(healthInterval);
  }, []); // eslint-disable-line

  const handleProfileChange = (pId: number) => {
    setSelectedProfileId(pId);
    
    const profile = profiles.find(p => p.id === pId);
    if (profile) {
      setMetaapiAccountId(profile.metaapi_account_id || '');
      setAutomationActive(profile.automation_active === 1);
      setAiSniperActive(profile.ai_sniper_active === 1);
      setRiskPercentage(profile.risk_multiplier === 1 ? 5 : (profile.risk_multiplier || 5));
    } else {
      setMetaapiAccountId('');
      setAutomationActive(false);
      setAiSniperActive(false);
      setRiskPercentage(5);
    }
    loadData(pId);
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim() || !newProfileAccountId.trim()) return;
    setCreatingProfile(true);
    try {
      const res = await fetch('/api/auth/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_name: newProfileName, metaapi_account_id: newProfileAccountId }),
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        showMsg('Profile created successfully', 'success');
        setNewProfileName('');
        setNewProfileAccountId('');
        handleProfileChange(data.profileId);
      } else {
        showMsg(data.error || 'Failed to create profile', 'error');
      }
    } catch (e) {
      showMsg('Network error', 'error');
    } finally {
      setCreatingProfile(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfileId) return;
    if (!window.confirm("Are you sure you want to delete this profile? This cannot be undone and will delete all bots and trade history linked to it.")) return;
    
    try {
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}`, { method: 'DELETE', credentials: 'same-origin' });
      const data = await res.json();
      if (data.success) {
        showMsg('Profile deleted successfully', 'success');
        const remaining = profiles.filter(p => p.id !== selectedProfileId);
        setProfiles(remaining);
        if (remaining.length > 0) {
          handleProfileChange(remaining[0].id);
        } else {
          setSelectedProfileId(null);
          setBots([]);
          setDiary([]);
          setMetaapiAccountId('');
          setAutomationActive(false);
          setAiSniperActive(false);
        }
      } else {
        showMsg(data.error || 'Failed to delete profile', 'error');
      }
    } catch (e) {
      showMsg('Network error', 'error');
    }
  };

  const handleResetDiary = async () => {
    if (!selectedProfileId) return;
    if (!window.confirm("Are you sure you want to reset your trade diary? This will hide all past trades and give you a clean slate.")) return;
    
    try {
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}/diary/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (data.success) {
        showMsg('Trade diary has been reset!', 'success');
        loadData(selectedProfileId); // refresh diary
      } else {
        showMsg(data.error || 'Failed to reset diary', 'error');
      }
    } catch (e: any) {
      showMsg('Network error resetting diary', 'error');
    }
  };

  // Save connection settings
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProfileId) return;

    const cleanAccountId = metaapiAccountId.trim().replace(/[^a-zA-Z0-9\-]/g, '');

    if (cleanAccountId && cleanAccountId.length < 8) {
      return showMsg('Account ID appears invalid.', 'error');
    }

    setSaving(true);
    try {
      const profile = profiles.find(p => p.id === selectedProfileId);
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          profile_name: profile?.profile_name,
          risk_multiplier: riskPercentage,
          metaapi_account_id: cleanAccountId,
          automation_active: automationActive,
          ai_sniper_active: aiSniperActive,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg('Configuration saved — verifying connection…', 'success');

        // Trigger server-side data-source switch to MetaAPI asynchronously
        fetch('/api/refresh-data-source', {
          method: 'POST',
          credentials: 'same-origin',
        }).then(r => r.json()).then(dsData => {
          if (dsData.success) {
            setDataSource(dsData.source);
            const srcLabel = dsData.source === 'metaapi' ? '🟢 Switched to MetaAPI Live Data' : '📡 Using Yahoo Finance (fallback)';
            showMsg(`Configuration saved. ${srcLabel}`, 'success');
          }
        }).catch(() => {});
      } else {
        showMsg(data.error || 'Failed to save.', 'error');
      }
    } catch {
      showMsg('Network error. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Toggle individual bot
  const handleBotToggle = async (botId: string, active: boolean) => {
    if (!selectedProfileId) return;
    if (!automationActive) {
      showMsg('Enable the Master Automation Switch first to arm bots.', 'error');
      return;
    }
    setToggling(botId);
    try {
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}/bots/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ botId, active }),
      });
      const data = await res.json();
      if (data.success) {
        setBots(prev => prev.map(b => b.id === botId ? { ...b, isActive: active } : b));
        showMsg(`${active ? '🟢 Bot armed' : '⬛ Bot disarmed'}: ${bots.find(b => b.id === botId)?.name}`, 'success');
      } else {
        showMsg(data.error || 'Failed to toggle bot.', 'error');
      }
    } catch {
      showMsg('Network error.', 'error');
    } finally {
      setToggling(null);
    }
  };

  const activeBotCount = bots.filter(b => b.isActive).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 gap-4">
        <Loader className="animate-spin text-indigo-400" size={32} />
        <p className="text-slate-500 font-mono text-xs uppercase tracking-widest">Initialising bot engine…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in relative z-10 pb-12">

      {/* ── Toast Notification ── */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16 }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3 rounded-2xl text-sm font-mono shadow-2xl border ${
              messageType === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300 shadow-emerald-900/50'
                : 'bg-red-950/90 border-red-500/50 text-red-300 shadow-red-900/50'
            } backdrop-blur-xl`}
          >
            {messageType === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Failsafe Lockout Banner ── */}
      {automationActive && botHealth?.tradingBlocked && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="bg-red-950/40 border border-red-500/50 rounded-2xl p-4 flex items-center justify-between shadow-[0_0_30px_-5px_rgba(239,68,68,0.3)] animate-pulse"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertTriangle className="text-red-500" size={20} />
            </div>
            <div>
              <h3 className="text-red-400 font-display font-black text-lg tracking-wider uppercase">MetaAPI Connection Lost : Trades Disabled</h3>
              <p className="text-red-300/70 font-mono text-xs">
                No active signal connection for over 5 minutes. All new trades are locked as a failsafe. 
                Open positions will still be managed. The system will automatically unlock when connection restores.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end">
             <span className="text-red-500 font-mono font-bold text-xs">STATUS: OFFLINE</span>
             <span className="text-red-400/50 font-mono text-[10px]">Since {new Date(botHealth.offlineSince).toLocaleTimeString()}</span>
          </div>
        </motion.div>
      )}

      {/* ── Section 0: Profile Selector ── */}
      <div className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-700/50 shadow-lg ring-1 ring-white/5 flex flex-col md:flex-row items-center gap-4">
        <div className="flex-1 w-full">
          <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
            Active Trading Profile
          </label>
          <div className="flex items-center gap-3">
            <select
              value={selectedProfileId || ''}
              onChange={(e) => handleProfileChange(Number(e.target.value))}
              className="flex-1 bg-slate-950/50 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-display font-bold text-sm transition-all"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.profile_name}</option>
              ))}
            </select>
            {selectedProfileId && profiles.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteProfile}
                className="p-3 bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-400 rounded-xl transition-colors shrink-0"
                title="Delete Profile"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="w-full md:w-auto h-full flex items-end">
          <form onSubmit={handleCreateProfile} className="flex gap-2 w-full">
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="New Profile Name"
              className="w-full md:w-48 bg-slate-950/50 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-xs placeholder:text-slate-600"
            />
            <input
              type="text"
              value={newProfileAccountId}
              onChange={(e) => setNewProfileAccountId(e.target.value)}
              placeholder="Account ID"
              className="w-full md:w-48 bg-slate-950/50 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-xs placeholder:text-slate-600"
            />
            <button
              type="submit"
              disabled={creatingProfile || !newProfileName.trim() || !newProfileAccountId.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-3 rounded-xl font-display font-bold uppercase tracking-wider text-xs transition-colors disabled:opacity-50"
            >
              {creatingProfile ? '...' : 'Add'}
            </button>
          </form>
        </div>
      </div>

      {/* ── Section 1: Connection Settings ── */}
      <div className="bg-slate-900/40 backdrop-blur-xl p-7 rounded-3xl border border-slate-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)] ring-1 ring-white/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-indigo-500/8 rounded-full blur-[80px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center gap-4 mb-7">
          <div className="w-11 h-11 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/50">
            <Link size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-display font-black text-white tracking-tight uppercase">MetaAPI bridge configuration</h2>
            <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest mt-0.5">MetaAPI Bridge Configuration</p>
          </div>
          {/* Status pills */}
          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            {/* Data source badge */}
            <span className={`flex items-center gap-2 text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-full border ${
              dataSource === 'metaapi'
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}>
              {dataSource === 'metaapi'
                ? <><Wifi size={12} /><span>MetaAPI Live</span></>
                : <><Database size={12} /><span>Yahoo Finance</span></>}
            </span>
            {/* Engine status badge */}
            <span className={`flex items-center gap-2 text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-full border ${
              automationActive
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}>
              <span className={`w-2 h-2 rounded-full ${automationActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              {automationActive ? 'Engine Armed' : 'Engine Off'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Account ID</label>
              <input
                type="text" value={metaapiAccountId} onChange={e => setMetaapiAccountId(e.target.value)}
                placeholder="e.g. 1eda5cc4-3ad8-4f6e-a3cf"
                className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-sm placeholder:text-slate-600 transition-all"
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-1.5 ml-1 mr-1">
                <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">Base Risk Per Trade</label>
                <span className="text-[10px] font-mono font-bold text-indigo-400">{riskPercentage}%</span>
              </div>
              <div className="bg-slate-950/50 border border-slate-700 rounded-xl px-4 py-3 h-[46px] flex items-center">
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={riskPercentage}
                  onChange={(e) => setRiskPercentage(Number(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              <p className="text-[9px] font-mono text-slate-600 mt-1.5 ml-1 uppercase">Recommended: 5% (Aggressive)</p>
            </div>
          </div>

          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3.5 flex gap-3 items-center">
            <Shield size={14} className="text-indigo-400 shrink-0" />
            <p className="text-slate-500 text-[11px] font-mono">
              Your MetaAPI Token is securely managed at the account level.
            </p>
          </div>


          {/* Master toggle + Save */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5 pt-4 border-t border-slate-800">
            <div className="flex items-center gap-4">
              <button
                type="button" onClick={() => setAutomationActive(!automationActive)}
                className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${automationActive ? 'bg-emerald-500' : 'bg-slate-700'} shadow-inner`}
              >
                <span className={`absolute top-1 left-1 bg-white w-6 h-6 rounded-full transition-transform duration-300 shadow-md ${automationActive ? 'translate-x-8' : ''}`} />
              </button>
              <div>
                <span className={`block font-display font-black uppercase tracking-wider text-sm ${automationActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {automationActive ? '🔴 Master Armed' : 'Master Disarmed'}
                </span>
                <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Required to activate bots</span>
              </div>
            </div>
            <button
              type="submit" disabled={saving}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-8 py-3 rounded-xl font-display font-bold uppercase tracking-wider text-sm transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-indigo-900/40"
            >
              {saving ? <Loader className="animate-spin" size={16} /> : <Save size={16} />}
              Save Configuration
            </button>
          </div>
        </form>
      </div>



      {/* ── Section 2: Bot Marketplace ── */}
      <div>
        <div className="flex items-center justify-between mb-6 cursor-pointer" onClick={() => setBotsSectionExpanded(!botsSectionExpanded)}>
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center shadow-lg ring-1 ring-white/10 overflow-hidden">
              <img src="/sniper_thumbnail.png" alt="The Sniper Trader" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-display font-black text-white tracking-tight uppercase">The Sniper Trader</h2>
                {botsSectionExpanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
              </div>
              <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest mt-0.5">
                {activeBotCount > 0
                  ? `${activeBotCount} bot${activeBotCount > 1 ? 's' : ''} active — running in parallel`
                  : 'Select one or more bots to deploy simultaneously'
                }
              </p>
            </div>
          </div>

          {activeBotCount > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2"
            >
              <Zap size={14} className="text-emerald-400" />
              <span className="text-emerald-400 font-mono text-xs uppercase tracking-wider">{activeBotCount} armed</span>
            </motion.div>
          )}
        </div>

        {/* Combined Matrix Panel */}
        {activeBotCount > 1 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-slate-950/60 border border-indigo-500/30 rounded-2xl p-5 shadow-[0_0_20px_rgba(99,102,241,0.1)] flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-500/20 text-indigo-400 rounded-xl flex items-center justify-center border border-indigo-500/30 shadow-inner">
                <BarChart2 size={20} />
              </div>
              <div>
                <h3 className="text-white font-display font-black tracking-tight text-lg">Combined Portfolio Matrix</h3>
                <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest">Aggregate Backtest Metrics</p>
              </div>
            </div>
            
            <div className="flex items-center gap-8">
              <div className="text-center">
                <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest mb-1">Avg Win Rate</p>
                <p className="text-white font-display font-bold text-xl">{
                  (bots.filter(b => b.isActive).reduce((a, b) => a + b.winRateBacktest, 0) / activeBotCount).toFixed(1)
                }%</p>
              </div>
              <div className="w-px h-8 bg-slate-800" />
              <div className="text-center">
                <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest mb-1">Combined Return</p>
                <p className="text-emerald-400 font-display font-bold text-xl">+{
                  Math.round(bots.filter(b => b.isActive).reduce((a, b) => {
                    const val = parseInt(b.returnBacktest.replace(/[^0-9-]/g, ''), 10);
                    return a + (isNaN(val) ? 0 : val);
                  }, 0) * (riskPercentage / 5))
                }%/yr</p>
              </div>
              <div className="w-px h-8 bg-slate-800" />
              <div className="text-center">
                <p className="text-slate-500 font-mono text-[10px] uppercase tracking-widest mb-1">Estimated Max DD</p>
                <p className="text-rose-400 font-display font-bold text-xl">{
                  (Math.max(...bots.filter(b => b.isActive).map(b => b.maxDDBacktest)) * (riskPercentage / 5)).toFixed(1)
                }%</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Warning if master not armed */}
        {!automationActive && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 flex items-center gap-3 bg-amber-950/40 border border-amber-500/30 rounded-xl px-5 py-3.5"
          >
            <Lock size={16} className="text-amber-400 shrink-0" />
            <p className="text-amber-400 text-xs font-mono">
              Master Automation Switch must be enabled above before you can arm individual bots.
            </p>
          </motion.div>
        )}

        {/* Bot cards grid - Expandable */}
        {botsSectionExpanded && (
          <AnimatePresence>
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              {bots.length === 0 ? (
                <div className="text-center py-16 text-slate-600 font-mono text-sm">
                  <Bot size={40} className="mx-auto mb-4 opacity-30" />
                  No bots loaded. Check server connection.
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {/* Tiers */}
                  {['Apex', 'Institutional', 'Prop', 'Scout'].map(tierName => {
                    const tierBots = bots.filter(b => b.tier === tierName || (tierName === 'Scout' && !b.tier && b.id === 'old-is-gold'));
                    if (tierBots.length === 0 && tierName !== 'Scout') return null;
                    
                    return (
                      <div key={tierName} className="mb-2">
                        <button 
                          onClick={() => toggleTier(tierName)} 
                          className="flex items-center gap-2 mb-4 w-full text-left focus:outline-none"
                        >
                          {expandedTiers[tierName] ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
                          <h3 className={`text-sm font-display font-bold uppercase tracking-wider ${
                              tierName === 'Apex' ? 'text-indigo-400' :
                              tierName === 'Institutional' ? 'text-purple-400' :
                              tierName === 'Prop' ? 'text-sky-400' : 'text-amber-400'
                          }`}>{tierName} Tier</h3>
                          <div className="h-px bg-slate-800 flex-1 ml-4" />
                        </button>
                        
                        <AnimatePresence>
                          {expandedTiers[tierName] && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
                                {tierBots.map(bot => (
                                  <BotCard
                                    key={bot.id}
                                    bot={bot}
                                    onToggle={handleBotToggle}
                                    disabled={!automationActive || toggling !== null}
                                    riskPercentage={riskPercentage}
                                  />
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}

                  {/* Removed Discretionary and Coming Soon Cards */}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* ── Section 3: Live Status ── */}
      {activeBotCount > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-700/50 ring-1 ring-white/5"
        >
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Activity size={16} className="text-emerald-400" />
            <h3 className="text-sm font-display font-bold uppercase tracking-wider text-white">Live Engine Status</h3>
            <div className="flex items-center gap-3 ml-4">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded flex items-center gap-1 ${
                botHealth.health === 'healthy' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 
                botHealth.isConnecting ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                'bg-red-500/10 text-red-400 border border-red-500/30'
              }`}>
                {botHealth.health === 'healthy' ? 'MetaAPI Healthy' : botHealth.isConnecting ? <><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Connecting...</> : 'MetaAPI Issues'}
              </span>
              {botHealth.pendingSignals > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                   <Clock size={10} /> {botHealth.pendingSignals} Pending Signals
                </span>
              )}
              {botHealth.missedSignals > 0 && (
                 <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 flex items-center gap-1">
                   <ShieldAlert size={10} /> {botHealth.missedSignals} Missed Signals
                 </span>
              )}
            </div>
            <span className="ml-auto text-[10px] font-mono text-slate-500 hidden sm:block">Polls every 30s</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {bots.filter(b => b.isActive).map(bot => {
              const colors = COLOR_MAP[bot.color] || COLOR_MAP.indigo;
              return (
                <div key={bot.id} className={`rounded-xl p-4 border ${colors.border} ${colors.bg}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{bot.icon}</span>
                    <span className={`text-[10px] font-mono uppercase tracking-wider ${colors.text}`}>{bot.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[9px] font-mono text-slate-500 uppercase">Scanning {bot.symbols[0]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Section 4: Analytics & Trade Diary ── */}
      <div className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-700/50 ring-1 ring-white/5 mt-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <BarChart2 size={16} className="text-indigo-400" />
            <h3 className="text-sm font-display font-bold uppercase tracking-wider text-white">Performance</h3>
          </div>
          <div className="flex items-center gap-2 bg-slate-800/80 p-1 rounded-lg border border-slate-700/50">
            <button
              onClick={() => setAnalyticsTab('analytics')}
              className={`px-4 py-1.5 rounded-md text-xs font-bold font-display uppercase tracking-wide transition-colors ${analyticsTab === 'analytics' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Analytics
            </button>
            <button
              onClick={() => setAnalyticsTab('diary')}
              className={`px-4 py-1.5 rounded-md text-xs font-bold font-display uppercase tracking-wide transition-colors ${analyticsTab === 'diary' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Trade Diary
            </button>
          </div>
        </div>
        
        {analyticsTab === 'analytics' && (
          <TradeAnalytics 
            diary={diary} 
            bots={bots} 
            selectedBotId={selectedBotId} 
            onSelectBot={setSelectedBotId} 
            analyticsData={analyticsData}
            onRefresh={handleRefreshAnalytics}
            isRefreshing={refreshingAnalytics}
          />
        )}

        {analyticsTab === 'diary' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-mono text-slate-500">{diary.length} Trades Logged</span>
              <button 
                onClick={handleResetDiary}
                className="px-3 py-1 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-md text-xs font-medium font-mono transition-colors"
              >
                Reset Diary
              </button>
            </div>
            {diary.length === 0 ? (
              <div className="text-center py-10 text-slate-600 font-mono text-xs">No trades logged yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-widest">
                      <th className="pb-3 px-2 font-medium">Date</th>
                      <th className="pb-3 px-2 font-medium">Bot</th>
                      <th className="pb-3 px-2 font-medium">Symbol</th>
                      <th className="pb-3 px-2 font-medium">Dir</th>
                      <th className="pb-3 px-2 font-medium">Entry</th>
                      <th className="pb-3 px-2 font-medium">Exit</th>
                      <th className="pb-3 px-2 font-medium">Pips</th>
                      <th className="pb-3 px-2 font-medium">Profit</th>
                      <th className="pb-3 px-2 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diary.map((trade) => {
                      const botCfg = bots.find(b => b.id === trade.bot_id);
                      return (
                        <tr key={trade.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 px-2 text-slate-400">{new Date(trade.close_time).toLocaleString()}</td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              {botCfg?.thumbnailUrl && (
                                <img src={botCfg.thumbnailUrl} alt={trade.bot_id} className="w-6 h-6 rounded-md object-cover border border-slate-700" />
                              )}
                              <span className="text-slate-300">{botCfg ? botCfg.name : trade.bot_id}</span>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-indigo-400">{trade.broker_symbol}</td>
                          <td className={`py-3 px-2 ${trade.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.direction}</td>
                          <td className="py-3 px-2 text-slate-400">{trade.entry_price.toFixed(3)}</td>
                          <td className="py-3 px-2 text-slate-400">{trade.exit_price.toFixed(3)}</td>
                          <td className="py-3 px-2 text-slate-300">{trade.pips.toFixed(1)}</td>
                          <td className={`py-3 px-2 ${trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${trade.profit.toFixed(2)}</td>
                          <td className="py-3 px-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] ${trade.profit >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                              {trade.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
