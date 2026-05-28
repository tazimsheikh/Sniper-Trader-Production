import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Zap, Shield, Key, Lock, ArrowLeft, Database } from 'lucide-react';

interface Props {
  onLoginSuccess: (user: any) => void;
}

export default function LoginScreen({ onLoginSuccess }: Props) {
  const [isLogin, setIsLogin]   = useState(true);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [metaapiToken, setMetaapiToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [otp, setOtp]           = useState('');
  const [step, setStep]         = useState<'auth' | 'otp'>('auth');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!email || !password || !metaapiToken || !accountId) { setError('Email, password, Meta API Token, and Account ID are required.'); return; }
    if (!isLogin && password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (metaapiToken.trim().length < 20 || accountId.trim().length < 5) { setError('A valid MetaAPI Token and Account ID are required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email address.'); return; }

    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password, metaapiToken: metaapiToken.trim(), accountId: accountId.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        if (data.requiresOtp) {
          setStep('otp');
          setOtp('');
        } else {
          onLoginSuccess(data.user);
        }
      } else {
        setError(data.error || 'Authentication failed. Please try again.');
      }
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedOtp = otp.trim();
    if (!trimmedOtp || trimmedOtp.length !== 6) {
      setError('Please enter a valid 6-digit verification code.');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login/confirm' : '/api/auth/register/confirm';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, otp: trimmedOtp }),
      });
      const data = await res.json();

      if (data.success) {
        onLoginSuccess(data.user);
      } else {
        setError(data.error || 'Invalid verification code.');
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
            {step === 'otp' ? 'Secure Verification' : (isLogin ? 'Access Terminal' : 'Initialize Account')}
          </h2>
          <p className="text-slate-400 text-center text-sm font-mono mb-8 uppercase tracking-widest">
            Sniper Trader
          </p>

          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 p-3 bg-red-950/50 border border-red-500/50 rounded-lg text-red-400 text-sm font-mono text-center">
              {error}
            </motion.div>
          )}

          {step === 'auth' ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Local Security Group */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
                <h3 className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest mb-1">Local Security</h3>
                
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
              </div>

              {/* MetaAPI Bridge Group */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
                <h3 className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest mb-1">MetaAPI Bridge</h3>
                
                <div>
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Meta API Token</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Zap size={16} className="text-slate-500" />
                    </div>
                    <input
                      type="password" required
                      value={metaapiToken} onChange={e => setMetaapiToken(e.target.value)}
                      className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600 font-mono text-sm"
                      placeholder="Enter Meta API Token..."
                    />
                  </div>
                  <p className="mt-1.5 ml-1 text-[9px] font-mono text-slate-600 uppercase tracking-wider">
                    Don't have one? Get it at <a href="https://app.metaapi.cloud/" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">app.metaapi.cloud</a>
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">MetaAPI Account ID</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                      <Database size={16} />
                    </div>
                    <input
                      type="text"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      placeholder="Enter MetaAPI Account ID"
                      className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600 font-mono text-sm"
                      required
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit" disabled={loading}
                className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm font-display"
              >
                {loading ? 'Processing...' : (isLogin ? 'Engage Systems' : 'Create Identity')}
              </button>

              <div className="mt-6 text-center">
                <button type="button" onClick={() => { setIsLogin(!isLogin); setError(''); }} className="text-slate-400 hover:text-indigo-400 text-xs font-mono transition-colors">
                  {isLogin ? 'Need an account? Initialize here.' : 'Already have access? Engage here.'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <p className="text-slate-400 text-center text-xs font-mono leading-relaxed mb-6">
                We sent a secure 6-digit access code to <span className="text-indigo-400 font-bold">{email}</span>. Please enter it below.
              </p>

              <div>
                <label className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Access Code (OTP)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock size={16} className="text-slate-500" />
                  </div>
                  <input
                    type="text" required maxLength={6} pattern="\d{6}"
                    value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-slate-950/50 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600 font-mono text-center text-lg tracking-[8px] font-bold"
                    placeholder="000000"
                  />
                </div>
              </div>

              <button
                type="submit" disabled={loading}
                className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm font-display"
              >
                {loading ? 'Verifying...' : 'Confirm Access'}
              </button>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => { setStep('auth'); setError(''); setOtp(''); }}
                  className="flex items-center justify-center gap-1.5 mx-auto text-slate-500 hover:text-slate-300 text-xs font-mono transition-colors"
                >
                  <ArrowLeft size={12} /> Back to credentials
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
