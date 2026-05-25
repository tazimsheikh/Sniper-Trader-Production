import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Zap, Shield, Key } from 'lucide-react';

interface Props {
  onLoginSuccess: (user: any) => void;
}

export default function LoginScreen({ onLoginSuccess }: Props) {
  const [isLogin, setIsLogin]   = useState(true);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation (server validates too — defense in depth)
    if (!email || !password) { setError('Email and password are required.'); return; }
    if (!isLogin && password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email address.'); return; }

    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', // Send/receive cookies
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (data.success) {
        // Cookie is set by server — no token to store locally
        onLoginSuccess(data.user);
      } else {
        setError(data.error || 'Authentication failed. Please try again.');
      }
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070913] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#070913] to-[#070913] pointer-events-none" />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-md">
        <div className="bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-slate-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)] ring-1 ring-white/5">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg ring-1 ring-white/20 relative overflow-hidden">
              <Zap size={32} className="relative z-10" />
              <div className="absolute inset-0 bg-white/20 blur-xl" />
            </div>
          </div>

          <h2 className="text-2xl font-display font-black text-white text-center tracking-tight mb-2 uppercase">
            {isLogin ? 'Access Terminal' : 'Initialize Account'}
          </h2>
          <p className="text-slate-400 text-center text-sm font-mono mb-8 uppercase tracking-widest">
            Sniper Trader
          </p>

          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 p-3 bg-red-950/50 border border-red-500/50 rounded-lg text-red-400 text-sm font-mono text-center">
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Secure Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Shield size={16} className="text-slate-500" />
                </div>
                <input
                  type="email" required autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600 font-mono text-sm"
                  placeholder="operative@domain.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Access Key</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Key size={16} className="text-slate-500" />
                </div>
                <input
                  type="password" required autoComplete={isLogin ? 'current-password' : 'new-password'}
                  value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600 font-mono text-sm"
                  placeholder="••••••••"
                />
              </div>
              {!isLogin && (
                <p className="mt-1.5 ml-1 text-[9px] font-mono text-slate-600 uppercase tracking-wider">
                  Minimum 8 characters
                </p>
              )}
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm font-display"
            >
              {loading ? 'Processing...' : (isLogin ? 'Engage Systems' : 'Create Identity')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button onClick={() => { setIsLogin(!isLogin); setError(''); }} className="text-slate-400 hover:text-indigo-400 text-xs font-mono transition-colors">
              {isLogin ? 'Need an account? Initialize here.' : 'Already have access? Engage here.'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
