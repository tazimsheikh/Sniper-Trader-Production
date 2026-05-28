import React, { useState, useEffect } from 'react';
import { Settings, X, Save, Trash2, RefreshCw, Key, Shield, Zap, Activity } from 'lucide-react';
import { motion } from 'motion/react';

interface GlobalSettingsProps {
  onClose: () => void;
  onLogout: () => void;
}

export default function GlobalSettings({ onClose, onLogout }: GlobalSettingsProps) {
  const [keys, setKeys] = useState({
    metaapiToken: '',
    metaapiAccountId: '',
    geminiApiKey: ''
  });
  
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
    testConnections();
  }, []);

  const fetchKeys = async () => {
    try {
      const res = await fetch('/api/settings/keys', { credentials: 'same-origin' });
      const data = await res.json();
      if (data.success) {
        setKeys(data.keys);
      }
    } catch (e) {
      console.error('Failed to fetch keys', e);
    } finally {
      setIsLoading(false);
    }
  };

  const testConnections = async () => {
    setIsTesting(true);
    try {
      const res = await fetch('/api/settings/status', { credentials: 'same-origin' });
      const data = await res.json();
      if (data.success) {
        setStatus(data.status);
      }
    } catch (e) {
      console.error('Failed to test connections', e);
    } finally {
      setIsTesting(false);
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
        setSaveMessage('Error: ' + data.error);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-2xl relative z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
          <X size={20} />
        </button>
        <h3 className="text-xl font-display font-black text-white mb-6 flex items-center gap-2 uppercase tracking-wide border-b border-slate-800 pb-4">
          <Settings className="text-indigo-400" />
          Global Settings
        </h3>
        
        {isLoading ? (
          <div className="flex justify-center py-10">
            <RefreshCw className="animate-spin text-indigo-500" />
          </div>
        ) : (
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
                    className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-mono text-xs placeholder:text-slate-600"
                    placeholder="Enter Meta API Token..."
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Meta API Account ID</label>
                  <input
                    type="text"
                    value={keys.metaapiAccountId}
                    onChange={e => setKeys({...keys, metaapiAccountId: e.target.value})}
                    className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-mono text-xs placeholder:text-slate-600"
                    placeholder="Enter Meta API Account ID..."
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Gemini API Key (AI Tutor)</label>
                  <input
                    type="password"
                    value={keys.geminiApiKey}
                    onChange={e => setKeys({...keys, geminiApiKey: e.target.value})}
                    className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-mono text-xs placeholder:text-slate-600"
                    placeholder="Enter Gemini API Key..."
                  />
                </div>



                <div className="pt-2">
                  <button
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

              {/* Status Column */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-300 flex items-center gap-2"><Activity size={14} /> Connection Status</h4>
                
                <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-slate-400" />
                      <span className="text-xs font-mono text-slate-300">Meta API</span>
                    </div>
                    <StatusBadge state={status.metaapi} />
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-slate-400" />
                      <span className="text-xs font-mono text-slate-300">Gemini AI</span>
                    </div>
                    <StatusBadge state={status.gemini} />
                  </div>
                </div>

                <button
                  onClick={testConnections}
                  disabled={isTesting}
                  className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-white font-bold py-2 rounded-xl transition-colors font-display tracking-wide text-xs flex items-center justify-center gap-2 mt-4"
                >
                  <RefreshCw className={isTesting ? "animate-spin" : ""} size={14} />
                  {isTesting ? 'Pinging APIs...' : 'Test Connections'}
                </button>

                <div className="pt-8 border-t border-slate-800/50 mt-8">
                  <h4 className="text-xs font-bold text-rose-400 flex items-center gap-2 mb-3"><Trash2 size={12} /> Danger Zone</h4>
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="w-full bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-300 py-2 rounded-xl text-xs font-mono transition-colors"
                    >
                      Delete Account Permanently
                    </button>
                  ) : (
                    <div className="bg-rose-950/40 border border-rose-900/50 p-3 rounded-xl">
                      <p className="text-[10px] text-rose-200 mb-3 font-mono">This will delete your account and all data. Are you absolutely sure?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleDeleteAccount}
                          disabled={isDeleting}
                          className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-1.5 rounded-lg text-xs font-bold transition-colors"
                        >
                          {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={isDeleting}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-1.5 rounded-lg text-xs transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
