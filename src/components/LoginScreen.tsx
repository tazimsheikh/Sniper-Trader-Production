import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Zap, Shield, Key, Lock, ArrowLeft, Database, DollarSign } from 'lucide-react';
import { useSound } from '../hooks/useSound';

interface Props {
  onLoginSuccess: (user: any) => void;
}

export default function LoginScreen({ onLoginSuccess }: Props) {
  const { playClick } = useSound();
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

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ 
          credential: credentialResponse.credential,
          metaapiToken: metaapiToken.trim() || undefined,
          accountId: accountId.trim() || undefined
        }),
      });
      const data = await res.json();
      if (data.success) {
        onLoginSuccess(data.user);
      } else {
        setError(data.error || 'Google Authentication failed.');
      }
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030508] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none" style={{
        backgroundImage: 'url(/images/hero_bg_1780109403064.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        opacity: 0.3
      }} />
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-900/20 via-[#030508]/80 to-[#030508] pointer-events-none" />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-md">
        <div className="bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-[#d4af37]/30 shadow-[0_0_40px_rgba(212,175,55,0.15)] ring-1 ring-white/5">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-[#d4af37] to-[#8a7322] rounded-2xl flex items-center justify-center text-[#030508] shadow-[0_0_20px_rgba(212,175,55,0.4)] ring-1 ring-[#d4af37]/50 relative overflow-hidden">
              <DollarSign size={32} className="relative z-10" />
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
              
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setError('Google Authentication is temporarily disabled in sandbox mode. Please use secure email login below.')}
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-900 font-bold py-2.5 px-4 rounded-full shadow transition-all active:scale-[0.98] text-sm cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  Continue with Google
                </button>
              </div>

              <div className="flex items-center gap-4">
                 <div className="flex-1 h-px bg-slate-800"></div>
                 <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">OR LOCAL</span>
                 <div className="flex-1 h-px bg-slate-800"></div>
              </div>

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
                onClick={playClick}
                className="w-full mt-6 bg-gradient-to-r from-[#d4af37] to-[#8a7322] hover:from-[#c29f2f] hover:to-[#78631b] text-[#030508] font-black py-3 px-4 rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm font-display"
              >
                {loading ? 'Processing...' : (isLogin ? 'Engage Systems' : 'Create Identity')}
              </button>

              <div className="mt-6 text-center">
                <button type="button" onClick={() => { playClick(); setIsLogin(!isLogin); setError(''); }} className="text-slate-400 hover:text-[#d4af37] text-xs font-mono transition-colors">
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
                onClick={playClick}
                className="w-full mt-6 bg-gradient-to-r from-[#d4af37] to-[#8a7322] hover:from-[#c29f2f] hover:to-[#78631b] text-[#030508] font-black py-3 px-4 rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm font-display"
              >
                {loading ? 'Verifying...' : 'Confirm Access'}
              </button>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => { playClick(); setStep('auth'); setError(''); setOtp(''); }}
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
