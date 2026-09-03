import React, { useState, useEffect } from 'react';
import { Settings, X, Save, Trash2, RefreshCw, Key, Shield, Zap, Activity, Terminal, LogOut } from 'lucide-react';
import { motion } from 'motion/react';
import { formatDateTime, getBrokerTradingDayStr } from '../utils/timezone';

interface GlobalSettingsProps {
  onClose: () => void;
  onLogout: () => void;
}

export default function GlobalSettings({ onClose, onLogout }: GlobalSettingsProps) {
  const [activeTab, setActiveTab] = useState<'api' | 'logs' | 'accounts'>('accounts');
  const [logs, setLogs] = useState<any[]>([]);
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  
  const [logFilterBot, setLogFilterBot] = useState<'ALL' | 'seer' | 'mage' | 'sage'>('ALL');
  const [logFilterPair, setLogFilterPair] = useState('ALL');
  const [logFilterAction, setLogFilterAction] = useState('ALL');
  

  const [keys, setKeys] = useState({
    metaapiToken: '',
    metaapiAccountId: '',
    geminiApiKey: '',
    hasMetaApiToken: false,
    hasGeminiApiKey: false
  });

  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  
  // -- Profile Risk Settings State --
  const [globalRisk, setGlobalRisk] = useState<number>(10);
  const [institutionalEnabled, setInstitutionalEnabled] = useState(false);
  const [institutionalStartBalance, setInstitutionalStartBalance] = useState<number | null>(null);
  const [institutionalDailyDate, setInstitutionalDailyDate] = useState<string | null>(null);
  const [institutionalDailyCap, setInstitutionalDailyCap] = useState<number>(2.5);
  const [institutionalPeakToDraw, setInstitutionalPeakToDraw] = useState<number>(5.5);
  const [isSavingRisk, setIsSavingRisk] = useState(false);
  
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileAccountId, setNewProfileAccountId] = useState('');
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [isSyncingSymbols, setIsSyncingSymbols] = useState(false);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);
  const [liveEquity, setLiveEquity] = useState<number | null>(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  
  const handleProfileChange = (pId: number) => {
    setSelectedProfileId(pId);
    localStorage.setItem('lastSelectedProfileId', pId.toString());
    
    // Clear live balance immediately to prevent cross-profile state bleed while fetching
    setLiveBalance(null);
    setLiveEquity(null);
    setIsBalanceLoading(true);
    
    // Sync risk state to the newly selected profile
    const p = profiles.find(x => x.id === pId);
    if (p) {
      setGlobalRisk(p.risk_multiplier || 10);
      setInstitutionalEnabled(p.institutional_enabled === 1);
      setInstitutionalStartBalance(p.institutional_daily_start_balance || null);
      setInstitutionalDailyDate(p.institutional_daily_date || null);
      setInstitutionalDailyCap(p.institutional_daily_cap || 2.5);
      setInstitutionalPeakToDraw(p.institutional_peak_to_draw || 5.5);
    }
    
    testConnections(pId);
    window.dispatchEvent(new Event('profileChanged'));
  };

  const handleSaveRiskSettings = async (updates: any) => {
    if (!selectedProfileId) return;
    setIsSavingRisk(true);
    try {
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      
      // Sync local profiles array so switching profiles doesn't revert to old state
      setProfiles(prev => prev.map(p => {
        if (p.id === selectedProfileId) {
          return {
            ...p,
            risk_multiplier: updates.risk_multiplier !== undefined ? updates.risk_multiplier : p.risk_multiplier,
            institutional_enabled: updates.institutional_enabled !== undefined ? (updates.institutional_enabled ? 1 : 0) : p.institutional_enabled,
            institutional_daily_cap: updates.institutional_daily_cap !== undefined ? updates.institutional_daily_cap : p.institutional_daily_cap,
            institutional_peak_to_draw: updates.institutional_peak_to_draw !== undefined ? updates.institutional_peak_to_draw : p.institutional_peak_to_draw,
          };
        }
        return p;
      }));
    } catch (e: any) {
      console.warn('[GlobalSettings] Failed to save risk settings:', e);
      alert(`Failed to save settings: ${e.message}`);
      // Re-sync from current valid profile state to revert UI
      const p = profiles.find(x => x.id === selectedProfileId);
      if (p) {
        setGlobalRisk(p.risk_multiplier || 10);
        setInstitutionalEnabled(p.institutional_enabled === 1);
        setInstitutionalDailyCap(p.institutional_daily_cap || 2.5);
        setInstitutionalPeakToDraw(p.institutional_peak_to_draw || 5.5);
      }
    } finally {
      setIsSavingRisk(false);
    }
  };

  const handleResetInstitutional = async () => {
    if (!selectedProfileId) return;
    try {
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}/institutional-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success && data.newStartBalance) {
        const nowEst = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
        const newDate = new Date(nowEst).toISOString().split('T')[0];
        setInstitutionalStartBalance(data.newStartBalance);
        setInstitutionalDailyDate(newDate);
        setProfiles(prev => prev.map(p => {
          if (p.id === selectedProfileId) {
            return {
              ...p,
              institutional_daily_start_balance: data.newStartBalance,
              institutional_daily_date: newDate,
            };
          }
          return p;
        }));
      }
    } catch(e) {}
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
        const newProfileObj = {
          id: data.profileId,
          profile_name: newProfileName,
          metaapi_account_id: newProfileAccountId,
        };
        setProfiles(prev => [...prev, newProfileObj]);
        setNewProfileName('');
        setNewProfileAccountId('');
        setTimeout(() => handleProfileChange(data.profileId), 50);
      } else {
        alert(data.error || 'Failed to create profile');
      }
    } catch (e) {
      alert('Network error');
    } finally {
      setCreatingProfile(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfileId) return;
    if (!confirm('Are you sure you want to permanently delete this trading profile? All configurations will be lost.')) return;
    try {
      setIsDeletingProfile(true);
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        const remaining = profiles.filter(p => p.id !== selectedProfileId);
        setProfiles(remaining);
        if (remaining.length > 0) {
          handleProfileChange(remaining[0].id);
        } else {
          setSelectedProfileId(null);
          localStorage.removeItem('lastSelectedProfileId');
          window.dispatchEvent(new Event('profileChanged'));
        }
      } else {
        alert('Failed to delete profile: ' + data.error);
      }
    } catch (e) {
      alert('Failed to delete profile.');
    } finally {
      setIsDeletingProfile(false);
    }
  };

  const handleSyncSymbols = async () => {
    if (!selectedProfileId) return;
    try {
      setIsSyncingSymbols(true);
      const res = await fetch(`/api/auth/profiles/${selectedProfileId}/discover-symbols`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        alert('Symbols synced successfully! Your broker mappings are now up to date.');
      } else {
        alert('Failed to sync symbols: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Network error while syncing symbols.');
    } finally {
      setIsSyncingSymbols(false);
    }
  };

  const [selectedTimezone, setSelectedTimezone] = useState(() => localStorage.getItem('sniper_tz') || 'IST');
  
  // Sync timezone from server on mount — ensures correct tz on new devices even if localStorage is empty
  useEffect(() => {
    fetch('/api/settings/timezone', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.timezone) {
          setSelectedTimezone(d.timezone);
          localStorage.setItem('sniper_tz', d.timezone);
        }
      })
      .catch(() => {});
  }, []);
  
  const [status, setStatus] = useState({
    metaapi: 'offline',
    gemini: 'offline'
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  

  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    try {
      const res = await fetch(`/api/settings/keys?t=${Date.now()}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (data.success) {
        setKeys({
          ...data.keys,
          metaapiToken: data.keys.hasMetaApiToken ? '••••••••••••••••' : '',
          geminiApiKey: data.keys.hasGeminiApiKey ? '••••••••••••••••' : ''
        });
      }
      
      const pRes = await fetch(`/api/auth/profiles?t=${Date.now()}`, { credentials: 'same-origin' });
      const pData = await pRes.json();
      if (pData.success && pData.profiles.length > 0) {
        setProfiles(pData.profiles);
        const savedId = localStorage.getItem('lastSelectedProfileId');
        let activeId: number;
        if (savedId) {
          const parsedId = parseInt(savedId);
          // Validate the saved ID still belongs to this user's profiles
          const stillValid = pData.profiles.find((p: any) => p.id === parsedId);
          activeId = stillValid ? parsedId : pData.profiles[0].id;
        } else {
          activeId = pData.profiles[0].id;
        }
        // Persist the resolved ID so new devices / BotDashboard always read it correctly
        localStorage.setItem('lastSelectedProfileId', activeId.toString());
        setSelectedProfileId(activeId);
        
        const actP = pData.profiles.find((p: any) => p.id === activeId);
        if (actP) {
          setGlobalRisk(actP.risk_multiplier || 10);
          setInstitutionalEnabled(actP.institutional_enabled === 1);
          setInstitutionalStartBalance(actP.institutional_daily_start_balance || null);
          setInstitutionalDailyDate(actP.institutional_daily_date || null);
          setInstitutionalDailyCap(actP.institutional_daily_cap || 2.5);
          setInstitutionalPeakToDraw(actP.institutional_peak_to_draw || 5.5);
        }
        testConnections(activeId);
      } else {
        testConnections();
      }
    } catch (e) {
      // Error ignored
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLogs = async () => {
    if (!selectedProfileId) return;
    setIsLogsLoading(true);
    try {
      const res = await fetch(`/api/settings/logs?profileId=${selectedProfileId}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs);
      }
    } catch (e) {
      // Error ignored
    } finally {
      setIsLogsLoading(false);
    }
  };

  const handleClearLogs = async () => {
    if (!selectedProfileId) return;
    if (!window.confirm("Are you sure you want to clear all system logs?")) return;
    try {
      const res = await fetch(`/api/settings/logs?profileId=${selectedProfileId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        setLogs([]);
      }
    } catch (e) {
      // Error ignored
    }
  };

  useEffect(() => {
    if (activeTab === 'logs' && selectedProfileId) {
      fetchLogs();
    }
  }, [activeTab, selectedProfileId]);

  const testConnections = async (overrideProfileId?: number) => {
    setIsTesting(true);
    setIsBalanceLoading(true);
    const pid = overrideProfileId !== undefined ? overrideProfileId : selectedProfileId;
    try {
      const url = pid ? `/api/settings/status?profileId=${pid}` : '/api/settings/status';
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json();
      if (data.success) {
        setStatus(data.status);
        if (data.account && (data.account.balance !== undefined || data.account.equity !== undefined)) {
          setLiveBalance(data.account.balance ?? data.account.equity);
          setLiveEquity(data.account.equity ?? data.account.balance);
        } else {
          setLiveBalance(null);
          setLiveEquity(null);
        }
      } else {
        setLiveBalance(null);
        setLiveEquity(null);
      }
    } catch (e) {
      setLiveBalance(null);
      setLiveEquity(null);
    } finally {
      setIsTesting(false);
      setIsBalanceLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');
    try {
      const res = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keys),
        credentials: 'same-origin'
      });
      const data = await res.json();
      
      if (data.success) {
        setSaveMessage('Settings saved successfully!');
        testConnections();
        setTimeout(() => setSaveMessage(''), 3000);
      } else {
        setSaveMessage('Error saving settings.');
      }
    } catch (e: any) {
      setSaveMessage('Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch('/api/settings/account', {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (data.success) {
        onLogout(); // This will clear local state and show login screen
      } else {
        alert('Failed to delete account: ' + data.error);
        setIsDeleting(false);
        setShowDeleteConfirm(false);
      }
    } catch (e) {
      alert('Failed to delete account.');
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const StatusBadge = ({ state }: { state: string }) => {
    if (state === 'connected') return <span className="bg-emerald-950/50 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-bold">CONNECTED</span>;
    if (state === 'syncing') return <span className="bg-amber-950/50 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded text-[10px] font-bold">SYNCING</span>;
    return <span className="bg-rose-950/50 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded text-[10px] font-bold">OFFLINE</span>;
  };

  const uniquePairs = Array.from(new Set(logs.map(l => l.symbol))).sort();

  const filteredLogs = logs.filter(log => {
    // 1. Bot Filter
    if (logFilterBot !== 'ALL' && log.bot_id !== logFilterBot) return false;
    
    // 2. Pair Filter
    if (logFilterPair !== 'ALL' && log.symbol !== logFilterPair) return false;
    
    // 3. Action / Result Filter
    if (logFilterAction !== 'ALL') {
      const act = log.action.toUpperCase();
      switch(logFilterAction) {
        case 'BUYS':
          if (!log.details.toUpperCase().includes('BUY')) return false;
          break;
        case 'SELLS':
          if (!log.details.toUpperCase().includes('SELL')) return false;
          break;
        case 'AI_ACCEPTED':
          if (!act.includes('APPROVED')) return false;
          break;
        case 'AI_REJECTED':
          if (!act.includes('REJECTED')) return false;
          break;
        case 'WINS':
          if (act !== 'TRADE_CLOSED_WIN') return false;
          break;
        case 'LOSSES':
          if (act !== 'TRADE_CLOSED_LOSS') return false;
          break;
        case 'ERRORS':
          if (!act.includes('ERROR') && !act.includes('KILLSWITCH') && !act.includes('LIQUIDATION')) return false;
          break;
      }
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-black/50 border border-white/10 p-6 rounded-2xl w-full max-w-2xl relative z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
          <X size={20} />
        </button>
        <h3 className="text-xl font-display font-black text-white mb-4 flex items-center gap-2 uppercase tracking-wide border-b border-white/10 pb-4">
          <Settings className="text-indigo-400" />
          Global Settings
        </h3>

        <div className="flex flex-wrap gap-4 border-b border-white/10 mb-6">
          
          <button type="button"
            onClick={() => setActiveTab('accounts')}
            className={`pb-2 text-sm font-bold uppercase tracking-wide transition-colors ${activeTab === 'accounts' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <span className="flex items-center gap-2"><Shield size={14} /> Accounts</span>
          </button>
          <button type="button"
            onClick={() => setActiveTab('api')}
            className={`pb-2 text-sm font-bold uppercase tracking-wide transition-colors ${activeTab === 'api' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <span className="flex items-center gap-2"><Key size={14} /> API Keys</span>
          </button>
          <button type="button"
            onClick={() => setActiveTab('logs')}
            className={`pb-2 text-sm font-bold uppercase tracking-wide transition-colors ${activeTab === 'logs' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <span className="flex items-center gap-2"><Terminal size={14} /> System Logs</span>
          </button>
        </div>
        
        {isLoading ? (
          <div className="flex justify-center py-10">
            <RefreshCw className="animate-spin text-indigo-500" />
          </div>
        ) : activeTab === 'accounts' ? (
          <div className="space-y-8">
            <div className="bg-black/50 p-6 rounded-2xl border border-white/10">
              <h4 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-4">Trading Profiles</h4>
              
              <div className="flex flex-col md:flex-row items-end gap-4 mb-6">
                <div className="flex-1 w-full">
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">Switch Active Profile</label>
                  <select
                    value={selectedProfileId || ''}
                    onChange={(e) => handleProfileChange(Number(e.target.value))}
                    className="w-full bg-slate-950/80 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-display font-bold text-sm transition-all cursor-pointer"
                  >
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.profile_name} ({p.metaapi_account_id})</option>
                    ))}
                  </select>
                </div>
                {selectedProfileId && profiles.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteProfile}
                      disabled={isDeletingProfile || isSyncingSymbols}
                      className="p-3 disabled:opacity-50 bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-400 rounded-xl transition-colors shrink-0"
                    title="Delete Profile"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                {selectedProfileId && profiles.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSyncSymbols}
                    disabled={isSyncingSymbols || isDeletingProfile}
                    className="p-3 disabled:opacity-50 bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-500/30 text-indigo-400 rounded-xl transition-colors shrink-0 flex items-center justify-center gap-2 font-bold uppercase text-xs tracking-widest"
                    title="Auto-Discover Symbols"
                  >
                    <RefreshCw size={18} className={isSyncingSymbols ? 'animate-spin' : ''} />
                    <span className="hidden sm:inline">Sync Symbols</span>
                  </button>
                )}
              </div>
              
              <div className="mb-6 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-center">
                 <p className="text-xs font-mono text-indigo-300 uppercase tracking-widest">
                   Current Global Active Profile: <span className="font-bold text-white">{profiles.find(p => p.id === selectedProfileId)?.profile_name || 'None'}</span>
                 </p>
              </div>

              {selectedProfileId && (
                <div className="mb-6 bg-slate-950/50 p-6 rounded-2xl border border-white/10">
                  <h4 className="text-sm font-bold text-fuchsia-400 flex items-center gap-2 uppercase tracking-widest mb-6">
                    <Shield size={16}/> Master Risk Management
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4 border-r border-white/5 pr-6">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-fuchsia-300 font-mono">Global Risk Multiplier</span>
                        <div className="flex items-center gap-2">
                          {isSavingRisk ? <span className="text-[10px] text-fuchsia-400 font-mono animate-pulse">saving...</span> : null}
                          <span className="text-xs text-fuchsia-400 font-mono font-bold">{globalRisk}x</span>
                        </div>
                      </div>
                      <div className="bg-black/30 border border-white/5 rounded-xl px-4 py-3 mt-4 mb-2">
                        <label className="text-slate-500 font-mono text-[9px] uppercase tracking-widest block mb-2">Multiplier Value (x)</label>
                        <input
                          type="number"
                          min="0.1" max="100" step="0.1"
                          value={globalRisk}
                          onChange={(e) => setGlobalRisk(parseFloat(e.target.value))}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val > 0) handleSaveRiskSettings({ risk_multiplier: val });
                          }}
                          className="w-full bg-transparent font-display font-bold text-base text-fuchsia-400 focus:outline-none"
                        />
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono">Applied universally across Mage, Sage, and Seer.</p>
                    </div>

                    <div className="space-y-4">
                      <div className="pt-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-fuchsia-300 font-mono">Institutional Mode</span>
                          <button 
                            onClick={() => {
                              const newVal = !institutionalEnabled;
                              setInstitutionalEnabled(newVal);
                              handleSaveRiskSettings({ institutional_enabled: newVal });
                            }} 
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${institutionalEnabled ? 'bg-fuchsia-900' : 'bg-slate-700'}`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${institutionalEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono leading-relaxed mt-2 mb-4">
                          Prop-Firm safety rules. Enforces a Daily Loss Limit and Absolute Drawdown Limit, alongside strict Session Lockouts.
                        </p>
                        
                        {institutionalEnabled && (
                          <>
                            <div className="grid grid-cols-2 gap-4 mt-4">
                              <div className="bg-black/30 border border-white/5 rounded-xl px-4 py-3">
                                <label className="text-slate-500 font-mono text-[9px] uppercase tracking-widest block mb-2">Daily Cap (%)</label>
                                <input
                                  type="number"
                                  min="0.1" max="100" step="0.1"
                                  value={institutionalDailyCap}
                                  onChange={(e) => setInstitutionalDailyCap(parseFloat(e.target.value))}
                                  onBlur={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val) && val > 0) handleSaveRiskSettings({ institutional_daily_cap: val });
                                  }}
                                  className="w-full bg-transparent font-display font-bold text-base text-fuchsia-400 focus:outline-none"
                                />
                              </div>
                              <div className="bg-black/30 border border-white/5 rounded-xl px-4 py-3">
                                <label className="text-slate-500 font-mono text-[9px] uppercase tracking-widest block mb-2">Peak to Draw (%)</label>
                                <input
                                  type="number"
                                  min="0.1" max="100" step="0.1"
                                  value={institutionalPeakToDraw}
                                  onChange={(e) => setInstitutionalPeakToDraw(parseFloat(e.target.value))}
                                  onBlur={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val) && val > 0) handleSaveRiskSettings({ institutional_peak_to_draw: val });
                                  }}
                                  className="w-full bg-transparent font-display font-bold text-base text-fuchsia-400 focus:outline-none"
                                />
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 bg-black/30 border border-white/5 rounded-xl px-4 py-3 mt-4">
                            <div className="flex flex-col flex-1">
                              <span className="text-slate-500 font-mono text-[9px] uppercase tracking-widest">Live Daily PnL</span>
                              {(() => {
                                if (isBalanceLoading) {
                                  return (
                                    <div className="flex items-baseline gap-2 mt-1">
                                      <span className="font-display font-bold text-sm text-slate-400 animate-pulse">
                                        Syncing live balance...
                                      </span>
                                    </div>
                                  );
                                }
                                if (liveBalance === null) {
                                  return (
                                    <div className="flex items-baseline gap-2 mt-1">
                                      <span className="font-display font-bold text-sm text-rose-500">
                                        MetaAPI Connection Failed
                                      </span>
                                    </div>
                                  );
                                }

                                const todayEstDate = getBrokerTradingDayStr(new Date());

                                const isToday = institutionalDailyDate === todayEstDate;
                                const effectiveCurrent = liveEquity ?? liveBalance;
                                const startBal = (isToday && institutionalStartBalance && institutionalStartBalance > 0) ? institutionalStartBalance : effectiveCurrent;
                                const diff = effectiveCurrent - startBal;
                                const pct = startBal > 0 ? (diff / startBal) * 100 : 0;
                                const isPositive = pct >= 0;
                                return (
                                  <div className="flex items-baseline gap-2">
                                    <span className={`font-display font-bold text-base ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {isPositive ? '+' : ''}${diff.toFixed(2)} ({isPositive ? '+' : ''}{pct.toFixed(2)}%)
                                    </span>
                                    <span className="text-slate-500 font-mono text-[10px]">
                                      (Base: ${startBal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})})
                                      {liveEquity !== null && Math.abs(liveEquity - (liveBalance || 0)) >= 0.01 && (
                                        <span className="text-emerald-300 ml-1">
                                          • Eq: ${liveEquity.toFixed(2)}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                );
                              })()}
                            </div>
                            <button onClick={handleResetInstitutional} title="Force Reset Daily Limit" className="bg-slate-800/80 hover:bg-slate-700 text-white rounded p-2 text-[10px] font-mono tracking-widest uppercase transition-colors">
                              Force Reset
                            </button>
                          </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-6 border-t border-white/10">
                <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2">Add New Profile</label>
                <form onSubmit={handleCreateProfile} className="flex flex-col sm:flex-row gap-3 w-full">
                  <input
                    type="text"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="Profile Name"
                    className="flex-1 bg-slate-950/80 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-xs placeholder:text-slate-600"
                  />
                  <input
                    type="text"
                    value={newProfileAccountId}
                    onChange={(e) => setNewProfileAccountId(e.target.value)}
                    placeholder="MetaAPI Account ID"
                    className="flex-1 bg-slate-950/80 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-xs placeholder:text-slate-600"
                  />
                  <button
                    type="submit"
                    disabled={creatingProfile || !newProfileName.trim() || !newProfileAccountId.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-display font-bold uppercase tracking-wider text-xs transition-colors disabled:opacity-50"
                  >
                    {creatingProfile ? '...' : 'Create'}
                  </button>
                </form>
              </div>
            </div>
            
            <div className="bg-red-950/20 p-6 rounded-2xl border border-red-900/50">
              <h4 className="text-sm font-bold text-red-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Shield size={16}/> Danger Zone</h4>
              <p className="text-xs text-slate-400 mb-4">Permanently delete your entire account and all associated data.</p>
              {!showDeleteConfirm ? (
                <button type="button" onClick={() => setShowDeleteConfirm(true)} className="px-4 py-2 bg-red-900/40 text-red-400 rounded-lg border border-red-500/30 hover:bg-red-900/60 transition-colors text-xs font-bold uppercase">Delete Account</button>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-red-400 font-bold">Are you sure?</span>
                  <button type="button" onClick={handleDeleteAccount} disabled={isDeleting} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors text-xs font-bold uppercase">{isDeleting ? 'Deleting...' : 'Yes, Delete'}</button>
                  <button type="button" onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-xs font-bold uppercase">Cancel</button>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'api' ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* API Keys Column */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-300 flex items-center gap-2"><Key size={14} /> API Credentials</h4>
                
                <div>
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Meta API Token</label>
                  <input
                    type="password"
                    value={keys.metaapiToken}
                    onChange={e => setKeys({...keys, metaapiToken: e.target.value})}
                    className="w-full bg-slate-950/50 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-mono text-xs placeholder:text-slate-600"
                    placeholder="Enter Meta API Token..."
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Meta API Account ID</label>
                  <input
                    type="text"
                    value={keys.metaapiAccountId}
                    onChange={e => setKeys({...keys, metaapiAccountId: e.target.value})}
                    className="w-full bg-slate-950/50 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-mono text-xs placeholder:text-slate-600"
                    placeholder="Enter Meta API Account ID..."
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Google Gemini API Key</label>
                  <input
                    type="password"
                    value={keys.geminiApiKey}
                    onChange={e => setKeys({...keys, geminiApiKey: e.target.value})}
                    className="w-full bg-slate-950/50 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-mono text-xs placeholder:text-slate-600"
                    placeholder="Enter Google Gemini API Key..."
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Dashboard Timezone</label>
                  <select
                    value={selectedTimezone}
                    onChange={(e) => {
                      const tz = e.target.value;
                      setSelectedTimezone(tz);
                      localStorage.setItem('sniper_tz', tz);
                      // Persist cross-device via server
                      fetch('/api/settings/timezone', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ timezone: tz })
                      }).catch(() => {});
                    }}
                    className="w-full bg-slate-950/50 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-mono text-xs cursor-pointer"
                  >
                    <option value="UTC">UTC (GMT+0)</option>
                    <option value="IST">IST (GMT+5:30)</option>
                    <option value="EST">EST (GMT-5)</option>
                    <option value="GMT">BST (GMT+1)</option>
                    <option value="JST">JST (GMT+9)</option>
                    <option value="AEDT">AEDT (GMT+11)</option>
                  </select>
                </div>

                <div className="pt-2">
                  <button type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-2 rounded-xl transition-colors font-display tracking-wide text-xs flex items-center justify-center gap-2"
                  >
                    {isSaving ? <RefreshCw className="animate-spin" size={14} /> : <Save size={14} />}
                    {isSaving ? 'Saving...' : 'Save Keys'}
                  </button>
                  {saveMessage && (
                    <p className={`mt-2 text-[10px] text-center font-mono ${saveMessage.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                      {saveMessage}
                    </p>
                  )}
                </div>
              </div>

              {/* Status & Danger Column */}
              <div className="space-y-4">
                <div className="pt-4 border-t border-white/10/50">
                  <h4 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-4"><Activity size={14} /> Connection Status</h4>
                  <div className="bg-slate-950/50 border border-white/10 rounded-xl p-4 space-y-4">
                    <div className="flex justify-between items-center border-b border-white/10 pb-3">
                      <div className="flex items-center gap-2">
                        <Zap size={14} className="text-slate-400" />
                        <span className="text-xs font-mono text-slate-300">Meta API</span>
                      </div>
                      <StatusBadge state={status.metaapi} />
                    </div>
                    

                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Zap size={14} className="text-slate-400" />
                        <span className="text-xs font-mono text-slate-300">Google Gemini</span>
                      </div>
                      <StatusBadge state={status.gemini} />
                    </div>
                  </div>

                  <button type="button"
                    onClick={() => testConnections()}
                    disabled={isTesting}
                    className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-white/10 text-white font-bold py-2 rounded-xl transition-colors font-display tracking-wide text-xs flex items-center justify-center gap-2 mt-4"
                  >
                    <RefreshCw className={isTesting ? "animate-spin" : ""} size={14} />
                    {isTesting ? 'Pinging APIs...' : 'Test Connections'}
                  </button>
                </div>

                <div className="pt-8 border-t border-white/10/50 mt-8">
                  <h4 className="text-xs font-bold text-rose-400 flex items-center gap-2 mb-3"><Trash2 size={12} /> Danger Zone</h4>
                  {!showDeleteConfirm ? (
                    <button type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="w-full bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-300 py-2 rounded-xl text-xs font-mono transition-colors"
                    >
                      Delete Account Permanently
                    </button>
                  ) : (
                    <div className="bg-rose-950/40 border border-rose-900/50 p-3 rounded-xl">
                      <p className="text-[10px] text-rose-200 mb-3 font-mono">This will delete your account and all data. Are you absolutely sure?</p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button type="button"
                          onClick={handleDeleteAccount}
                          disabled={isDeleting}
                          className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-1.5 rounded-lg text-xs font-bold transition-colors"
                        >
                          {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                        </button>
                        <button type="button"
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={isDeleting}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-1.5 rounded-lg text-xs transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  
                  <div className="mt-4 pt-4 border-t border-white/10/50">
                    <button type="button"
                      onClick={onLogout}
                      className="w-full bg-slate-800 hover:bg-slate-700 border border-white/10 text-white py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2"
                    >
                      <LogOut size={14} />
                      Sign Out Securely
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
             <div className="flex flex-col gap-2 mb-4">
               <div className="flex justify-between items-center">
                 <h4 className="text-sm font-bold text-slate-300">Recent Bot Activity</h4>
                 <div className="flex items-center gap-3">
                   <button type="button" onClick={handleClearLogs} className="text-slate-500 hover:text-rose-400 transition-colors flex items-center gap-1 text-[10px] uppercase font-mono tracking-wider">
                     <Trash2 size={12} /> Clear Logs
                   </button>
                   <button type="button" onClick={fetchLogs} className="text-slate-400 hover:text-indigo-400 transition-colors">
                     <RefreshCw size={14} className={isLogsLoading ? "animate-spin" : ""} />
                   </button>
                 </div>
               </div>
               
               {/* Advanced Filter Bar */}
               <div className="flex flex-wrap items-center gap-2 bg-slate-900/50 p-2 rounded-xl border border-white/5">
                 <select 
                   value={logFilterBot} 
                   onChange={e => setLogFilterBot(e.target.value as any)}
                   className="bg-black/50 text-xs font-mono text-slate-300 border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
                 >
                   <option value="ALL">All Bots</option>
                   <option value="sage">Sage</option>
                   <option value="seer">Seer</option>
                   <option value="mage">Mage</option>
                 </select>

                 <select 
                   value={logFilterPair} 
                   onChange={e => setLogFilterPair(e.target.value)}
                   className="bg-black/50 text-xs font-mono text-slate-300 border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
                 >
                   <option value="ALL">All Pairs</option>
                   {uniquePairs.map(p => <option key={p} value={p}>{p}</option>)}
                 </select>

                 <select 
                   value={logFilterAction} 
                   onChange={e => setLogFilterAction(e.target.value)}
                   className="bg-black/50 text-xs font-mono text-slate-300 border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
                 >
                   <option value="ALL">All Events</option>
                   <option value="BUYS">Buys</option>
                   <option value="SELLS">Sells</option>
                   <option value="AI_ACCEPTED">AI Accepted</option>
                   <option value="AI_REJECTED">AI Rejected</option>
                   <option value="WINS">Wins</option>
                   <option value="LOSSES">Losses</option>
                   <option value="ERRORS">Errors & System</option>
                 </select>
               </div>
             </div>

             {isLogsLoading && logs.length === 0 ? (
               <div className="flex justify-center py-10">
                 <RefreshCw className="animate-spin text-indigo-500" />
               </div>
             ) : logs.length === 0 ? (
               <div className="text-center py-10 text-slate-500 font-mono text-xs border border-white/10 rounded-xl bg-black/50">
                 No logs recorded yet.
               </div>
             ) : filteredLogs.length === 0 ? (
               <div className="text-center py-10 text-slate-500 font-mono text-xs border border-white/10 rounded-xl bg-black/50">
                 No logs match your current filters.
               </div>
             ) : (
               <div className="space-y-2">
                 {filteredLogs.map((log: any, i: number) => (
                   <div key={i} className="bg-slate-950/50 border border-white/10 rounded-lg p-3 text-xs font-mono">
                     <div className="flex justify-between items-start mb-1.5">
                       <div className="flex items-center gap-2">
                         <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                           log.action.includes('REJECTED') ? 'bg-rose-950/50 text-rose-400 border border-rose-900/50' :
                           log.action.includes('APPROVED') || log.action === 'TRADE_EXECUTED' ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-900/50' :
                           log.action.includes('SKIPPED') ? 'bg-amber-950/50 text-amber-400 border border-amber-900/50' :
                           'bg-indigo-950/50 text-indigo-400 border border-indigo-900/50'
                         }`}>{log.action}</span>
                         <span className="text-slate-300 font-bold">{log.symbol}</span>
                         {log.bot_id && (
                           <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider ${
                             log.bot_id === 'seer' ? 'bg-rose-900/30 text-rose-300 border border-rose-500/30' :
                             log.bot_id === 'mage' ? 'bg-purple-900/30 text-purple-300 border border-purple-500/30' :
                             'bg-slate-800 text-slate-300'
                           }`}>
                             {log.bot_id}
                           </span>
                         )}
                       </div>
                       <span className="text-slate-500 text-[10px]">
                         {formatDateTime(log.created_at)}
                       </span>
                     </div>
                     <p className="text-slate-400 leading-relaxed whitespace-pre-wrap">{log.details}</p>
                   </div>
                 ))}
               </div>
             )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
