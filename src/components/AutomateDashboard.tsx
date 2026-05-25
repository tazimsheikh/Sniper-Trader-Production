import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings, Shield, Link, Power, Crosshair, AlertTriangle, Save,
  Loader, CheckCircle2, Bot, TrendingUp, BarChart2, Zap, RefreshCw,
  Lock, ChevronRight, Activity, Target, Clock, DollarSign, Database, Wifi
} from 'lucide-react';

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
};

// ── Bot Card Component ────────────────────────────────────────────────────────
function BotCard({ bot, onToggle, disabled }: { bot: BotCardData; onToggle: (id: string, active: boolean) => void | Promise<void>; disabled: boolean; key?: React.Key }) {
  const colors = COLOR_MAP[bot.color] || COLOR_MAP.indigo;
  const [expanded, setExpanded] = useState(false);

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
            {bot.isActive && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
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
            {bot.returnBacktest}
          </span>
        </div>
        <div className={`rounded-xl p-3 ${bot.isActive ? colors.bg : 'bg-slate-800/50'}`}>
          <div className="flex items-center gap-1 mb-1">
            <Activity size={10} className={bot.isActive ? colors.text : 'text-slate-500'} />
            <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">Max DD</span>
          </div>
          <span className={`text-lg font-display font-black ${bot.isActive ? colors.text : 'text-slate-400'}`}>
            {bot.maxDDBacktest}%
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
  const [bots, setBots]                         = useState<BotCardData[]>([]);
  const [metaapiToken, setMetaapiToken]         = useState('');
  const [metaapiAccountId, setMetaapiAccountId] = useState('');
  const [automationActive, setAutomationActive] = useState(false);
  const [aiSniperActive, setAiSniperActive]     = useState(false);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [dataSource, setDataSource]             = useState<'yahoo' | 'metaapi'>('yahoo');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [diary, setDiary]       = useState<TradeDiaryEntry[]>([]);
  const [message, setMessage]   = useState('');
  const [messageType, setMessageType] = useState<'success'|'error'>('success');

  const showMsg = (msg: string, type: 'success'|'error' = 'success') => {
    setMessage(msg); setMessageType(type);
    setTimeout(() => setMessage(''), 5000);
  };

  // Load user data + bots
  const loadData = useCallback(async () => {
    try {
      const [meRes, botsRes, diaryRes, dsRes] = await Promise.all([
        fetch('/api/auth/me', { credentials: 'same-origin' }),
        fetch('/api/auth/bots', { credentials: 'same-origin' }),
        fetch('/api/auth/diary', { credentials: 'same-origin' }),
        fetch('/api/data-source'),
      ]);
      const meData   = await meRes.json();
      const botsData = await botsRes.json();
      const dsData   = await dsRes.json();

      if (meData.success && meData.user) {
        setMetaapiAccountId(meData.user.metaapi_account_id || '');
        setAutomationActive(meData.user.automation_active === 1);
        setAiSniperActive(meData.user.ai_sniper_active === 1);
        setHasExistingToken(meData.user.hasMetaApiToken || false);
      }
      if (botsData.success) {
        setBots(botsData.bots);
      }
      if (dsData.success) {
        setDataSource(dsData.source);
      }
      const diaryData = await diaryRes.json();
      if (diaryData.success) {
        setDiary(diaryData.trades || []);
      }
    } catch (e) {
      console.error('[AutomateDashboard] Load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleResetDiary = async () => {
    if (!window.confirm("Are you sure you want to reset your trade diary? This will hide all past trades and give you a clean slate.")) return;
    
    try {
      const res = await fetch('/api/auth/diary/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (data.success) {
        showMsg('Trade diary has been reset!', 'success');
        loadData(); // refresh diary
      } else {
        showMsg(data.error || 'Failed to reset diary', 'error');
      }
    } catch (e: any) {
      showMsg('Network error resetting diary', 'error');
    }
  };

  useEffect(() => { loadData(); }, [loadData]);

  // Save connection settings
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken     = metaapiToken.trim();
    const cleanAccountId = metaapiAccountId.trim().replace(/[^a-zA-Z0-9\-]/g, '');

    if (cleanToken && cleanToken.length < 20) {
      return showMsg('MetaAPI token appears too short.', 'error');
    }
    if (cleanAccountId && cleanAccountId.length < 8) {
      return showMsg('Account ID appears invalid.', 'error');
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/automate-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          metaapi_token: cleanToken || undefined,
          metaapi_account_id: cleanAccountId,
          automation_active: automationActive,
          ai_sniper_active: aiSniperActive,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg('Configuration saved — verifying connection…', 'success');
        setMetaapiToken('');
        setHasExistingToken(true);

        // Trigger server-side data-source switch to MetaAPI
        try {
          const dsRes = await fetch('/api/refresh-data-source', {
            method: 'POST',
            credentials: 'same-origin',
          });
          const dsData = await dsRes.json();
          if (dsData.success) {
            setDataSource(dsData.source);
            const srcLabel = dsData.source === 'metaapi' ? '🟢 Switched to MetaAPI Live Data' : '📡 Using Yahoo Finance (fallback)';
            showMsg(`Configuration saved. ${srcLabel}`, 'success');
          }
        } catch {
          // Non-fatal — config was saved, data-source refresh is best-effort
        }
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
    if (!automationActive) {
      showMsg('Enable the Master Automation Switch first to arm bots.', 'error');
      return;
    }
    setToggling(botId);
    try {
      const res = await fetch('/api/auth/bots/toggle', {
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

      {/* ── Section 1: Connection Settings ── */}
      <div className="bg-slate-900/40 backdrop-blur-xl p-7 rounded-3xl border border-slate-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)] ring-1 ring-white/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-indigo-500/8 rounded-full blur-[80px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center gap-4 mb-7">
          <div className="w-11 h-11 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/50">
            <Link size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-display font-black text-white tracking-tight uppercase">Connection & Risk</h2>
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
          {/* Token + Account ID */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
                MetaAPI Token {hasExistingToken && <span className="text-emerald-500 ml-2">✓ Encrypted & saved</span>}
              </label>
              <input
                type="password" value={metaapiToken} onChange={e => setMetaapiToken(e.target.value)}
                placeholder={hasExistingToken ? 'Enter new token to replace' : 'Paste your MetaAPI token'}
                className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-sm placeholder:text-slate-600 transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Account ID</label>
              <input
                type="text" value={metaapiAccountId} onChange={e => setMetaapiAccountId(e.target.value)}
                placeholder="e.g. 1eda5cc4-3ad8-4f6e-a3cf"
                className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-sm placeholder:text-slate-600 transition-all"
              />
            </div>
          </div>

          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3.5 flex gap-3 items-center">
            <Shield size={14} className="text-indigo-400 shrink-0" />
            <p className="text-slate-500 text-[11px] font-mono">
              Token encrypted with AES-256-GCM — never returned to browser. Find it at <span className="text-indigo-400">app.metaapi.cloud → API Access</span>
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center shadow-lg ring-1 ring-white/10">
              <Bot size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-display font-black text-white tracking-tight uppercase">Trading Bots</h2>
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

        {/* Bot cards grid */}
        {bots.length === 0 ? (
          <div className="text-center py-16 text-slate-600 font-mono text-sm">
            <Bot size={40} className="mx-auto mb-4 opacity-30" />
            No bots loaded. Check server connection.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {bots.map(bot => (
              <BotCard
                key={bot.id}
                bot={bot}
                onToggle={handleBotToggle}
                disabled={!automationActive || toggling !== null}
              />
            ))}

            {/* Discretionary Sniper Notice Card */}
            <div className="relative rounded-2xl border border-slate-700/50 bg-slate-900/60 backdrop-blur-xl overflow-hidden opacity-70">
              <div className="p-5 flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 bg-slate-800">🎯</div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-display font-black text-lg tracking-tight">Sniper System</h3>
                  <p className="text-xs font-mono uppercase tracking-wider text-slate-500">AI-Augmented Logic</p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <div className="px-2 py-1 bg-indigo-900/40 text-indigo-400 border border-indigo-500/30 rounded text-[9px] font-mono uppercase tracking-wider">AI Filtered Execution (5% Risk)</div>
                  <button
                    onClick={() => setAiSniperActive(!aiSniperActive)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-300 ${aiSniperActive ? 'bg-indigo-500' : 'bg-slate-700'} shadow-inner mt-1`}
                  >
                    <span className={`absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform duration-300 shadow-md ${aiSniperActive ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
              </div>
              <div className="px-5 pb-5 text-slate-400 text-xs font-mono leading-relaxed border-t border-slate-800/50">
                <p className="mt-3 text-red-400 font-bold">EXPERIMENTAL !!! This method is not meant for discretionary trading.</p>
                <p className="mt-2 text-indigo-300">Sniper signals are directly intercepted by Google Gemini 2.5 AI. The AI analyzes structural context and geometry in real-time. Approved signals are executed strictly at 5% risk.</p>
              </div>
            </div>

            {/* Coming Soon Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative rounded-2xl border border-slate-700/30 bg-slate-900/30 backdrop-blur-xl overflow-hidden p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[200px]"
            >
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(99,102,241,0.05)_0%,_transparent_70%)]" />
              <div className="w-12 h-12 rounded-xl bg-slate-800/80 flex items-center justify-center text-xl">⚙️</div>
              <div>
                <p className="text-slate-500 font-display font-bold uppercase text-sm tracking-wider">More Bots Coming</p>
                <p className="text-slate-600 font-mono text-xs mt-1">Asian Scalper · News Trader · Swing Catcher</p>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-700 border border-slate-800 rounded-full px-3 py-1">In Development</span>
            </motion.div>
          </div>
        )}
      </div>

      {/* ── Section 3: Live Status ── */}
      {activeBotCount > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-700/50 ring-1 ring-white/5"
        >
          <div className="flex items-center gap-3 mb-4">
            <Activity size={16} className="text-emerald-400" />
            <h3 className="text-sm font-display font-bold uppercase tracking-wider text-white">Live Engine Status</h3>
            <span className="ml-auto text-[10px] font-mono text-slate-500">Polls every 30s</span>
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

      {/* ── Section 4: Trade Diary ── */}
      <div className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-700/50 ring-1 ring-white/5">
        <div className="flex items-center gap-3 mb-4">
          <Clock size={16} className="text-slate-400" />
          <h3 className="text-sm font-display font-bold uppercase tracking-wider text-white">Trade Diary</h3>
          <span className="ml-auto text-[10px] font-mono text-slate-500">{diary.length} Trades Logged</span>
          <button 
            onClick={handleResetDiary}
            className="ml-4 px-3 py-1 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-md text-xs font-medium font-mono transition-colors"
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
                {diary.map((trade) => (
                  <tr key={trade.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-2 text-slate-400">{new Date(trade.close_time).toLocaleString()}</td>
                    <td className="py-3 px-2 text-slate-300">{trade.bot_id}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
