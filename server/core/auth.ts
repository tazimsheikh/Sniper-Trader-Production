import { Router, Request, Response, NextFunction } from 'express';

import bcrypt from 'bcrypt';
import * as jwtPkg from 'jsonwebtoken';
import fs from 'fs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import db from './db.js';
// import { metaApiSyncStatus } from './candleProvider.js';
import { OAuth2Client } from 'google-auth-library';
import { encrypt, decrypt, isEncrypted } from './crypto.js';
import { ALL_BOT_CONFIGS, BOT_REGISTRY, getProfileActiveBots, setProfileActiveBots, deleteProfileBotInstances } from '../manager/tradeUtils.js';
import { sendOtpEmail } from './email.js';

import { deleteProfileTradeState } from '../manager/tradeManager.js';
import { verifyMetaApiAccount, verifyMetaApiConnection, getSharedConnection, getProfileTradeHistory, clearSharedConnection } from '../trading/broker/metaApiHandler.js';
import { discoverBrokerSymbols } from '../utils/discoverSymbols.js';

const jwtLib = jwtPkg as any;

const generateOtp = (): string => crypto.randomInt(100000, 1000000).toString();

// ── Hard-fail on missing secrets (never fall back to defaults) ───────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
}
export const authRouter = Router();

// ==========================================
// 6. METAAPI STATUS
// ==========================================

export interface AuthRequest extends Request {
  user?: any;
}

// ── Rate limiter: 10 attempts per 15 minutes ─────────────────────────────────
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const calendarLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests for market data.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const tradeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many profile modification requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Promise Deduplication Cache to prevent DB locking from rapid concurrent requests ──
const requestCache = new Map<string, { promise: Promise<any>, timestamp: number }>();
async function deduplicateRequest<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = requestCache.get(key);
  if (cached && (now - cached.timestamp < ttlMs)) {
    return cached.promise;
  }
  const promise = fetcher().catch(e => {
    requestCache.delete(key);
    throw e;
  });
  requestCache.set(key, { promise, timestamp: now });
  // Prevent memory leaks if cache gets too large
  if (requestCache.size > 1000) {
     for (const [k, v] of requestCache.entries()) {
        if (now - v.timestamp > ttlMs) requestCache.delete(k);
     }
  }
  return promise;
}

// ── Cookie config ─────────────────────────────────────────────────────────────
const COOKIE_OPTIONS = {
  httpOnly: true,                                    // Invisible to JavaScript → XSS-proof
  // If testing on a raw HTTP IP address in production, secure must be false
  secure: process.env.NODE_ENV === 'production' && process.env.USE_HTTPS === 'true',
  sameSite: 'lax' as const,                          // Lax is required for Google OAuth redirect flows
  maxAge: 7 * 24 * 60 * 60 * 1000,                  // 7 days
};

// ── Auth middleware — reads HttpOnly cookie ───────────────────────────────────
export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.auth_token;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: No session found' });
  }

  try {
    const decoded = (jwtLib.default || jwtLib).verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('auth_token', COOKIE_OPTIONS);
    return res.status(401).json({ success: false, error: 'Unauthorized: Session expired. Please log in again.' });
  }
};

// ── POST /register ────────────────────────────────────────────────────────────
authRouter.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, metaapiToken, accountId } = req.body;

    if (!email || !password || !metaapiToken || !accountId) {
      return res.status(400).json({ success: false, error: 'Email, password, Meta API Token, and Account ID are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }
    if (metaapiToken.trim().length < 20 || accountId.trim().length < 5) {
      return res.status(400).json({ success: false, error: 'Invalid Meta API Token or Account ID length.' });
    }

    const isValid = await verifyMetaApiAccount(metaapiToken.trim(), accountId.trim());
    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Invalid Meta API Token or Account ID. Connection rejected.' });
    }

    const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    
    const tokenToSave = encrypt(metaapiToken.trim());
    const accountIdToSave = encrypt(accountId.trim());
    const result = await db.prepare('INSERT INTO users (email, password_hash, metaapi_token, metaapi_account_id) VALUES (?, ?, ?, ?)').run(email, hashedPassword, tokenToSave, accountIdToSave);
    const userId = result.lastInsertRowid;
    
    await db.prepare(`
      INSERT INTO trading_profiles (user_id, profile_name, metaapi_account_id, automation_active)
      VALUES (?, ?, ?, ?)
    `).run(userId, 'Default Profile', accountIdToSave, 1);

    const token = (jwtLib.default || jwtLib).sign(
      { id: userId, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    res.json({ success: true, user: { id: userId, email } });
  } catch (err: any) {
    console.error('[Auth] Register error:', err.message);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// ── Route removed: /register/confirm

// ── POST /login ───────────────────────────────────────────────────────────────
authRouter.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

    const dummyHash = '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const hashToCompare = user ? user.password_hash : dummyHash;
    const isMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Ensure they have a trading profile, just in case
    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? LIMIT 1').get(user.id) as any;
    if (!profile) {
      await db.prepare(`
        INSERT INTO trading_profiles (user_id, profile_name, metaapi_account_id, automation_active)
        VALUES (?, ?, ?, ?)
      `).run(user.id, 'Default Profile', user.metaapi_account_id, 1);
    }

    const token = (jwtLib.default || jwtLib).sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    const { password_hash: _omit, metaapi_token: _omitToken, ...safeUser } = user;
    res.json({ success: true, user: { ...safeUser, hasMetaApiToken: !!user.metaapi_token } });
  } catch (err: any) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/google (Google OAuth Login) ────────────────────────────────
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || 'dummy_client_id');

authRouter.post('/google', authLimiter, async (req, res) => {
  try {
    const { credential, metaapiToken, accountId } = req.body;
    if (!credential) return res.status(400).json({ success: false, error: 'Google credential missing.' });

    // Verify Google Token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID || 'dummy_client_id', 
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ success: false, error: 'Invalid Google token.' });
    }

    const email = payload.email.toLowerCase();

    // Check if user exists
    let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

    if (!user) {
      // Auto-register via Google
      const dummyHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      const encryptedToken = metaapiToken ? encrypt(metaapiToken.trim()) : null;
      const result = await db.prepare('INSERT INTO users (email, password_hash, metaapi_token) VALUES (?, ?, ?)').run(email, dummyHash, encryptedToken);
      
      user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as any;
    } else if (metaapiToken) {
      // Update token if provided during Google Login
      const encryptedToken = encrypt(metaapiToken.trim());
      await db.prepare('UPDATE users SET metaapi_token = ? WHERE id = ?').run(encryptedToken, user.id);
    }

    // Profile handling
    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? LIMIT 1').get(user.id) as any;
    if (!profile) {
      const accId = accountId ? encrypt(accountId.trim()) : null;
      await db.prepare(`
        INSERT INTO trading_profiles (user_id, profile_name, metaapi_account_id, automation_active)
        VALUES (?, ?, ?, ?)
      `).run(user.id, 'Default Profile', accId, 1);
    } else if (accountId) {
      await db.prepare('UPDATE trading_profiles SET metaapi_account_id = ?, automation_active = 1 WHERE id = ?').run(encrypt(accountId.trim()), profile.id);
    }

    // Sign session JWT
    const token = (jwtLib.default || jwtLib).sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    const { password_hash: _omit, metaapi_token: _omitToken, ...safeUser } = user;
    res.json({ success: true, user: { ...safeUser, hasMetaApiToken: !!user.metaapi_token } });
  } catch (e: any) {
    console.error('[Auth] Google login error:', e.message);
    res.status(500).json({ success: false, error: 'Google login failed. Are your Client IDs configured?' });
  }
});

// ── Route removed: /login/confirm

// ── POST /logout ──────────────────────────────────────────────────────────────
authRouter.post('/logout', (req, res) => {
  res.clearCookie('auth_token', COOKIE_OPTIONS);
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ── GET /me ───────────────────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.id;
    const user = await deduplicateRequest(`get_me_${userId}`, 2000, async () => {
      return await db.prepare(
        'SELECT id, email, metaapi_account_id, risk_multiplier, automation_active, metaapi_token FROM users WHERE id = ?'
      ).get(userId) as any;
    });

    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    // Never return the encrypted MetaAPI token — just whether it's set
    const hasMetaApiToken = !!(user.metaapi_token);

    const { metaapi_token, ...safeUser } = user;
    res.json({ success: true, user: { ...safeUser, hasMetaApiToken } });
  } catch (err: any) {
    console.error('[Auth Error] GET /me failed:', err.message);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

authRouter.get('/metaapi/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.id;
    const user = await deduplicateRequest(`metaapi_status_user_${userId}`, 2000, async () => {
      return await db.prepare('SELECT metaapi_token, metaapi_account_id FROM users WHERE id = ?').get(userId) as any;
    });
    const profileId = req.query.profileId;

    let activeAccountId = user?.metaapi_account_id;

    if (profileId) {
      const profile = await db.prepare("SELECT metaapi_account_id FROM trading_profiles WHERE id = ? AND user_id = ?").get(profileId, userId) as any;
      if (profile && profile.metaapi_account_id) {
        activeAccountId = profile.metaapi_account_id;
      }
    } else {
      const profile = await deduplicateRequest(`metaapi_status_profile_${userId}`, 2000, async () => {
        return await db.prepare('SELECT metaapi_account_id FROM trading_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1').get(userId) as any;
      });
      if (profile && profile.metaapi_account_id) {
        activeAccountId = profile.metaapi_account_id;
      }
    }
    if (activeAccountId && isEncrypted(activeAccountId)) {
      activeAccountId = decrypt(activeAccountId);
    }

    if (user?.metaapi_token && activeAccountId) {
      const { getMetaApiConnectionState, getSharedConnection } = await import('../trading/broker/metaApiHandler.js');
      const token = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
      
      let status = getMetaApiConnectionState(token, activeAccountId);
      if (status === 'offline') {
         getSharedConnection(token, activeAccountId, true).catch(() => {});
         status = 'syncing';
      }

      let account = null;
      if (status === 'connected' || status === 'syncing') {
         // getLiveAccountBalance is no longer available in metaApiHandler
         account = { accountId: activeAccountId, balance: 0 };
      }
      
      res.json({ success: true, status, account });
    } else {
      res.json({ success: true, status: 'offline', account: null });
    }
  } catch (err) {
    res.json({ success: true, status: 'offline' });
  }
});



// ── GET /profiles ─────────────────────────────────────────────────────────────
authRouter.get('/profiles', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.id;
    const profiles = await deduplicateRequest(`get_profiles_${userId}`, 2000, async () => {
      return await db.prepare('SELECT id, profile_name, metaapi_account_id, risk_multiplier, bot_risks, automation_active, ai_sniper_active, diary_reset_time, locked_pairs, created_at, base_risk_balance, dwcb_enabled, dwcb_peak_balance, institutional_enabled, institutional_daily_cap, institutional_peak_to_draw, institutional_daily_start_balance FROM trading_profiles WHERE user_id = ? ORDER BY created_at ASC').all(userId);
    });
    const enrichedProfiles = profiles.map((p: any) => ({
      ...p,
      locked_pairs: (() => { try { return JSON.parse(p.locked_pairs || '[]'); } catch { return []; } })(),
      bot_risks: (() => { try { return JSON.parse(p.bot_risks || '{}'); } catch { return {}; } })(),
      metaapi_account_id: p.metaapi_account_id && isEncrypted(p.metaapi_account_id) ? decrypt(p.metaapi_account_id) : p.metaapi_account_id,
      hasMetaApiToken: true // Token is now user-level, if they are here they have it
    }));

    res.json({ success: true, profiles: enrichedProfiles });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /profiles ────────────────────────────────────────────────────────────
authRouter.post('/profiles', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { profile_name, metaapi_account_id } = req.body;
    if (!profile_name || typeof profile_name !== 'string') {
      return res.status(400).json({ success: false, error: 'Profile name is required.' });
    }
    if (!metaapi_account_id || typeof metaapi_account_id !== 'string') {
      return res.status(400).json({ success: false, error: 'Meta API Account ID is required.' });
    }

    const cleanAccountId = metaapi_account_id.trim().replace(/[^a-zA-Z0-9\-]/g, '');

    const result = await db.prepare(`
      INSERT INTO trading_profiles (user_id, profile_name, metaapi_account_id) VALUES (?, ?, ?)
    `).run(req.user.id, profile_name.trim(), encrypt(cleanAccountId));

    const profileId = result.lastInsertRowid;

    // Auto-discover symbols immediately on profile creation
    const user = await db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;
    if (user && user.metaapi_token) {
      try {
        const rawToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
        // Run it completely in the background so it doesn't block the UI returning the profile ID
        discoverBrokerSymbols(Number(profileId), rawToken, cleanAccountId).catch((err: any) => {
          console.warn(`[AutoDiscover] Background fetch failed for new profile ${profileId}: ${err.message}`);
        });
      } catch (err: any) {
        console.warn(`[AutoDiscover] Crypto error during profile creation for ${profileId}: ${err.message}`);
      }
    }

    res.json({ success: true, profileId });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /profiles/:id ──────────────────────────────────────────────────────
authRouter.delete('/profiles/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileId = Number(req.params.id);
    
    const profile = await db.prepare('SELECT metaapi_account_id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    const user = await db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;
    
    if (profile && user && profile.metaapi_account_id && user.metaapi_token) {
      try {
        const rawToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
        const decryptedAccountId = isEncrypted(profile.metaapi_account_id) ? decrypt(profile.metaapi_account_id) : profile.metaapi_account_id;
        clearSharedConnection(rawToken, decryptedAccountId);
      } catch (e) {}
    }

    try {

      deleteProfileTradeState(profileId);
      deleteProfileBotInstances(profileId);
    } catch (e) {}

    await db.prepare('DELETE FROM trading_profiles WHERE id = ? AND user_id = ?').run(profileId, req.user.id);
    await db.prepare('DELETE FROM bot_trade_states WHERE profile_id = ?').run(profileId);
    await db.prepare('DELETE FROM trade_diary WHERE profile_id = ?').run(profileId);
    await db.prepare('DELETE FROM bot_logs WHERE profile_id = ?').run(profileId);
    await db.prepare('DELETE FROM ai_decisions WHERE profile_id = ?').run(profileId);
    
    analyticsHistoryCache.delete(profileId);
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /profiles/:id/settings ───────────────────────────────────────────────
authRouter.post('/profiles/:id/settings', requireAuth, tradeLimiter, async (req: AuthRequest, res) => {
  try {
    const profileId = Number(req.params.id);
    const existing = await db.prepare('SELECT profile_name, metaapi_account_id, risk_multiplier, automation_active, ai_sniper_active, base_risk_balance, institutional_enabled, dwcb_enabled, dwcb_peak_balance FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    
    if (!existing) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const user = await db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user || !user.metaapi_token) {
      return res.status(400).json({ success: false, error: 'User Meta API Token missing. Please log in again.' });
    }

    const { profile_name, metaapi_account_id, risk_multiplier, bot_risks, automation_active, ai_sniper_active, baseRiskBalance, institutional_enabled, institutional_daily_cap, institutional_peak_to_draw, dwcb_enabled } = req.body;

    const finalName = (profile_name !== undefined && profile_name !== null) 
      ? (String(profile_name).trim() !== '' ? String(profile_name).trim() : existing.profile_name) 
      : existing.profile_name;

    let finalAccountId = existing.metaapi_account_id ? (isEncrypted(existing.metaapi_account_id) ? decrypt(existing.metaapi_account_id) : existing.metaapi_account_id) : null;
    if (metaapi_account_id !== undefined && metaapi_account_id !== null) {
      finalAccountId = typeof metaapi_account_id === 'string' ? metaapi_account_id.trim().replace(/[^a-zA-Z0-9\-]/g, '') : null;
      if (finalAccountId === '') finalAccountId = null;
    }

    const finalRiskMultiplier = risk_multiplier !== undefined ? Math.max(0.1, Math.min(100, Number(risk_multiplier) || 5)) : existing.risk_multiplier;
    const finalAutomationActive = automation_active !== undefined ? (automation_active ? 1 : 0) : existing.automation_active;
    const finalAiSniperActive = ai_sniper_active !== undefined ? (ai_sniper_active ? 1 : 0) : existing.ai_sniper_active;
    
    const finalBaseRisk = baseRiskBalance !== undefined 
      ? (baseRiskBalance !== null && baseRiskBalance !== '' ? Math.max(0, Number(baseRiskBalance)) : null)
      : existing.base_risk_balance;

    const finalInstitutionalEnabled = institutional_enabled !== undefined ? (institutional_enabled ? 1 : 0) : existing.institutional_enabled;
    const finalInstitutionalDailyCap = institutional_daily_cap !== undefined ? Math.max(0.1, Math.min(100, Number(institutional_daily_cap))) : existing.institutional_daily_cap;
    const finalInstitutionalPeakToDraw = institutional_peak_to_draw !== undefined ? Math.max(0.1, Math.min(100, Number(institutional_peak_to_draw))) : existing.institutional_peak_to_draw;
    
    const finalDwcbEnabled = dwcb_enabled !== undefined ? (dwcb_enabled ? 1 : 0) : existing.dwcb_enabled;

    const tokenToUse = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;

    if (finalAutomationActive && !finalAccountId) {
      return res.status(400).json({ success: false, error: 'Account ID is required to arm the Master Switch.' });
    }

    if (tokenToUse && finalAccountId && metaapi_account_id !== undefined) {
      try {
        await verifyMetaApiConnection(tokenToUse, finalAccountId);
      } catch (err: any) {
        return res.status(400).json({ success: false, error: err.message });
      }
    }

    // Clean up old connection if account ID changed
    const storedAccountId = existing.metaapi_account_id ? (isEncrypted(existing.metaapi_account_id) ? decrypt(existing.metaapi_account_id) : existing.metaapi_account_id) : null;
    if (finalAccountId && finalAccountId !== storedAccountId && storedAccountId) {
      try {
        clearSharedConnection(tokenToUse, storedAccountId);
        console.log(`[Auth] Cleared old MetaAPI connection for profile ${profileId} due to account ID update.`);
      } catch (e) {
        console.warn(`[Auth] Failed to clear old connection:`, e);
      }
    }

    await db.prepare(`
      UPDATE trading_profiles
      SET profile_name = ?, metaapi_account_id = ?, risk_multiplier = ?, automation_active = ?, ai_sniper_active = ?, base_risk_balance = ?, institutional_enabled = ?, institutional_daily_cap = ?, institutional_peak_to_draw = ?, dwcb_enabled = ?
      WHERE id = ? AND user_id = ?
    `).run(
      finalName, 
      finalAccountId ? encrypt(finalAccountId) : null, 
      finalRiskMultiplier, 
      finalAutomationActive, 
      finalAiSniperActive, 
      finalBaseRisk,
      finalInstitutionalEnabled,
      finalInstitutionalDailyCap,
      finalInstitutionalPeakToDraw,
      finalDwcbEnabled,
      profileId, 
      req.user.id
    );

    // ✅ Initialize DWCB Peak Balance to live equity immediately if missing
    let newDwcbPeakBalance: number | null = null;
    if (finalDwcbEnabled && (!existing.dwcb_peak_balance || existing.dwcb_peak_balance === 0)) {
      if (tokenToUse && finalAccountId) {
         try {
           const { getSharedConnection } = await import("../trading/broker/metaApiHandler.js");
           const connection = await getSharedConnection(tokenToUse, finalAccountId, false);
           if (connection) {
             const info = await connection.getAccountInformation();
             if (info && info.balance) {
                await db.prepare("UPDATE trading_profiles SET dwcb_peak_balance = ? WHERE id = ?").run(info.balance, profileId);
                console.log(`[Auth] Initialized DWCB peak balance to ${info.balance} for profile ${profileId}`);
                newDwcbPeakBalance = info.balance;
             }
           }
         } catch (e) {
           console.warn("[Auth] Failed to fetch live balance for DWCB init:", e);
         }
      }
    }

    res.json({ success: true, message: 'Settings saved and connection verified.', newDwcbPeakBalance });
  } catch (err: any) {
    console.error('[Auth] Profile settings error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save settings. Please try again.' });
  }
});

// ── POST /profiles/:id/institutional-reset ────────────────────────────────────
authRouter.post('/profiles/:id/institutional-reset', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileId = Number(req.params.id);
    const existing = await db.prepare('SELECT metaapi_account_id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    if (!existing) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const user = await db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;
    const tokenToUse = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    const finalAccountId = existing.metaapi_account_id ? (isEncrypted(existing.metaapi_account_id) ? decrypt(existing.metaapi_account_id) : existing.metaapi_account_id) : null;

    if (!tokenToUse || !finalAccountId) {
      return res.status(400).json({ success: false, error: 'No MetaAPI connection configured for this profile.' });
    }

    let liveBalance = 0;
    try {
      const { getSharedConnection } = await import("../trading/broker/metaApiHandler.js");
      const connection = await getSharedConnection(tokenToUse, finalAccountId, false);
      if (connection) {
        const info = await connection.getAccountInformation();
        if (info && info.balance) liveBalance = info.balance;
      }
    } catch (e) {
      console.warn("[Auth] Failed to fetch live balance for Institutional Reset via API:", e);
    }

    if (liveBalance <= 0) {
      const { LiveOrchestrator } = await import("../trading/engine/LiveOrchestrator.js");
      const orch = LiveOrchestrator.getInstance(profileId);
      if (orch && orch.cachedEquity > 0) liveBalance = orch.cachedEquity;
    }

    if (liveBalance <= 0) {
      return res.status(400).json({ success: false, error: 'Could not fetch live balance. Please ensure broker is connected.' });
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    const today = `${year}-${month}-${day}`;

    await db.prepare("UPDATE trading_profiles SET institutional_daily_start_balance = ?, institutional_daily_date = ?, institutional_peak_balance = ? WHERE id = ?").run(liveBalance, today, liveBalance, profileId);

    res.json({ success: true, message: 'Institutional limits reset successfully.', newStartBalance: liveBalance });
  } catch (err: any) {
    console.error('[Auth] Institutional reset error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /profiles/:id/bots ────────────────────────────────────────────────────
authRouter.get('/profiles/:id/bots', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = Number(req.params.id);
    // Verify ownership
    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id);
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const activeBotIds: string[] = await getProfileActiveBots(profileId);
    console.log('[Auth] Fetch bots: ALL_BOT_CONFIGS length =', ALL_BOT_CONFIGS?.length);
    
    const bots = (ALL_BOT_CONFIGS || []).map((cfg: any) => {
      const pair = cfg.symbols?.[0];
      const isOptimizerLocked = false;
      const fleetMetrics = null;
      
      return {
        ...cfg,
        isActive: activeBotIds.includes(cfg.id) && !isOptimizerLocked,
        ...(isOptimizerLocked ? {
          winRateBacktest: 'LOCKED',
          returnBacktest: 'FAILED',
          maxDDBacktest: 'N/A',
          tradesPerYear: 0
        } : fleetMetrics ? {
          winRateBacktest: `${fleetMetrics.holdoutWR}%`,
          returnBacktest: `+${Math.round(fleetMetrics.holdoutNetPips * (5/30))}% / yr`,
          maxDDBacktest: fleetMetrics.holdoutMaxDrawdown ? `${fleetMetrics.holdoutMaxDrawdown} pips` : 'N/A',
          tradesPerYear: fleetMetrics.holdoutTrades
        } : {})
      };
    });
    
    res.json({ success: true, bots });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /profiles/:id/discover-symbols ─────────────────────────────────────
authRouter.post('/profiles/:id/discover-symbols', requireAuth, tradeLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = Number(req.params.id);
    const profile = await db.prepare('SELECT metaapi_account_id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const user = await db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user || !user.metaapi_token) {
      return res.status(400).json({ success: false, error: 'User Meta API Token missing.' });
    }

    const rawToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    const decryptedAccountId = isEncrypted(profile.metaapi_account_id) ? decrypt(profile.metaapi_account_id) : profile.metaapi_account_id;

    await discoverBrokerSymbols(profileId, rawToken, decryptedAccountId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /profiles/:id/bots/toggle ────────────────────────────────────────────
authRouter.post('/profiles/:id/bots/toggle', requireAuth, tradeLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = Number(req.params.id);
    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id);
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const { botId, active } = req.body;
    if (typeof botId !== 'string' || typeof active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Invalid payload.' });
    }
    if (botId !== 'master-fleet' && !BOT_REGISTRY[botId]) {
      return res.status(400).json({ success: false, error: `Unknown bot: ${botId}` });
    }

    const current: string[] = await getProfileActiveBots(profileId);
    
    let updated: string[] = [];
    if (botId === 'master-fleet') {
      const allBotIds = Object.keys(BOT_REGISTRY);
      updated = active ? allBotIds : [];
    } else {
      updated = active
        ? (current.includes(botId) ? current : [...current, botId])
        : current.filter((id: string) => id !== botId);
    }
    
    await setProfileActiveBots(profileId, updated);
    res.json({ success: true, activeBots: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /profiles/:id/diary ───────────────────────────────────────────────────
authRouter.get('/profiles/:id/diary', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = Number(req.params.id);
    const profileRow = await db.prepare('SELECT diary_reset_time FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    if (!profileRow) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const resetTime = profileRow.diary_reset_time || undefined;

    const liveHistory = await getProfileTradeHistory(profileId, 30, resetTime);
    if (liveHistory && liveHistory.length > 0) {
      res.json({ success: true, trades: liveHistory });
      return;
    }

    const trades = await db.prepare('SELECT * FROM trade_diary WHERE profile_id = ? ORDER BY close_time DESC').all(profileId);
    const filteredTrades = resetTime ? trades.filter((t: any) => new Date(t.close_time).getTime() >= new Date(resetTime).getTime()) : trades;
    
    res.json({ success: true, trades: filteredTrades });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// ── GET /profiles/:id/leaderboard ───────────────────────────────────────────
authRouter.get('/profiles/:id/leaderboard', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = Number(req.params.id);
    const profileRow = await db.prepare('SELECT diary_reset_time FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    if (!profileRow) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const resetTime = profileRow.diary_reset_time || undefined;
    const trades = await db.prepare('SELECT bot_id, broker_symbol, profit, close_time, open_time FROM trade_diary WHERE profile_id = ?').all(profileId) as any[];
    
    // Filter by resetTime if available
    const filteredTrades = resetTime ? trades.filter((t: any) => new Date(t.close_time || t.open_time || Date.now()).getTime() >= new Date(resetTime).getTime()) : trades;
    
    // Sort chronologically for drawdown calculation
    filteredTrades.sort((a, b) => (a.close_time || a.open_time || 0) - (b.close_time || b.open_time || 0));

    // Aggregate
    const stats: Record<string, { profit: number, wins: number, total: number, peak: number, maxDD: number }> = {};
    for (const t of filteredTrades) {
      const key = `${t.bot_id}_${t.broker_symbol}`;
      if (!stats[key]) stats[key] = { profit: 0, wins: 0, total: 0, peak: 0, maxDD: 0 };
      
      const s = stats[key];
      s.total++;
      s.profit += t.profit;
      if (t.profit > 0) s.wins++;
      
      if (s.profit > s.peak) s.peak = s.profit;
      
      const drawdown = s.peak > 0 ? ((s.peak - s.profit) / s.peak) * 100 : 0;
      if (drawdown > s.maxDD) s.maxDD = drawdown;
    }

    const leaderboard = Object.keys(stats).map(key => {
      const idx = key.lastIndexOf('_');
      const bot_id = key.substring(0, idx);
      const broker_symbol = key.substring(idx + 1);
      const s = stats[key];
      return {
        bot_id,
        broker_symbol,
        profit: s.profit,
        winRate: s.total > 0 ? (s.wins / s.total) * 100 : 0,
        totalTrades: s.total,
        maxDD: s.maxDD
      };
    });

    res.json({ success: true, leaderboard });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /profiles/:id/risk/force-1-percent ──────────────────────────────────
authRouter.post('/profiles/:id/risk/force-1-percent', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = Number(req.params.id);
    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id);
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    await db.prepare(`
      UPDATE trading_profiles 
      SET head1_risk_pct = 1.0, head2_risk_pct = 1.0, head3_risk_pct = 1.0
      WHERE id = ?
    `).run(profileId);

    // Also update profile_pair_configs for the vision/algo pairs
    await db.prepare(`
      UPDATE profile_pair_configs 
      SET head1_risk = 1.0, head2_risk = 1.0, head3_risk = 1.0, 
          discretionary_trader_risk = 1.0
      WHERE profile_id = ?
    `).run(profileId);



    const { LiveOrchestrator } = await import('../trading/index.js');
    const orch2 = LiveOrchestrator.getInstance(profileId);
    if (orch2) {
       orch2.force1PercentRisk();
       // broadcastStatus is already called inside force1PercentRisk for Discretionary
    }

    // Update socket clients so UI instantly updates
    const { getIO } = await import('./socket.js');
    const io = getIO();
    if (io) {
       io.to(`profile_${profileId}`).emit('risk_updated', { message: 'All systems forced to 1% risk' });
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
// ── GET /portfolio-metrics (Dynamic Trade Interleaving Simulation) ─────────
authRouter.get('/portfolio-metrics', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const pairsParam = req.query.pairs as string;
    if (!pairsParam) {
      return res.json({ success: true, metrics: { winRate: 0, netPips: 0, maxDrawdownPips: 0, returnBacktest: '0%', tradesPerYear: 0 } });
    }

    const pairs = pairsParam.split(',').map(p => p.trim().toUpperCase()).filter(p => p);
    
    let allTrades: any[] = [];
    const fs = await import('fs');
    const path = await import('path');

    // Load WFO trade dumps for selected pairs
    for (const pair of pairs) {
      const dumpPath = path.join(process.cwd(), 'server', 'config', 'dumps', `${pair}_WFO_macro_dump.json`);
      if (fs.existsSync(dumpPath)) {
        try {
          const trades = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
          allTrades = allTrades.concat(trades);
        } catch (e) {
          console.warn(`[PortfolioMetrics] Failed to parse ${dumpPath}`);
        }
      }
    }

    if (allTrades.length === 0) {
      return res.json({ success: true, metrics: { winRate: 0, netPips: 0, maxDrawdownPips: 0, returnBacktest: '0%', tradesPerYear: 0 } });
    }

    // Sort chronologically by exit time
    allTrades.sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime());

    // Simulate combined equity curve
    let equity = 0;
    let peak = 0;
    let maxDrawdownPips = 0;
    let wins = 0;
    let losses = 0;

    for (const tr of allTrades) {
      equity += tr.netPips;
      if (equity > peak) peak = equity;
      const drawdown = peak - equity;
      if (drawdown > maxDrawdownPips) maxDrawdownPips = drawdown;

      if (tr.netPips > 0) wins++;
      else if (tr.netPips < 0) losses++;
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    
    // Calculate span in years
    const firstTradeMs = new Date(allTrades[0].exitTime).getTime();
    const lastTradeMs = new Date(allTrades[allTrades.length - 1].exitTime).getTime();
    const msSpan = lastTradeMs - firstTradeMs;
    const yearsSpan = Math.max(msSpan / (1000 * 60 * 60 * 24 * 365), 0.1); // min 0.1 years to avoid div/0

    const tradesPerYear = Math.round(totalTrades / yearsSpan);
    
    // Calculate Returns based on a standardized 5% risk baseline
    // 5% risk per trade implies your SL hit = -5% balance.
    // We'll estimate typical SL size around 30 pips. 
    // So 1 pip = 5% / 30 = 0.1666% return.
    const estPipsReturnPercent = equity * (5 / 30);
    const annualizedReturn = estPipsReturnPercent / yearsSpan;
    const returnBacktest = `${annualizedReturn > 0 ? '+' : ''}${Math.round(annualizedReturn)}% / yr`;

    return res.json({
      success: true,
      metrics: {
        winRate: Number(winRate.toFixed(1)),
        netPips: Number(equity.toFixed(1)),
        maxDrawdownPips: Number(maxDrawdownPips.toFixed(1)),
        returnBacktest,
        tradesPerYear
      }
    });
  } catch (e: any) {
    console.error(`[PortfolioMetrics] Error:`, e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /profiles/:id/diary/reset ────────────────────────────────────────────
authRouter.post('/profiles/:id/diary/reset', requireAuth, tradeLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = Number(req.params.id);
    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id);
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const now = new Date().toISOString();
    await db.prepare('UPDATE trading_profiles SET diary_reset_time = ? WHERE id = ?').run(now, profileId);
    
    // Invalidate analytics cache on reset
    analyticsHistoryCache.delete(profileId);
    
    res.json({ success: true, message: 'Trade diary has been reset.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /profiles/:id/metaapi/analytics (Performance Dashboard) ───────────────
const analyticsHistoryCache = new Map<number, { timestamp: number, tradesTaken: number, winRate: number, profit: number }>();

authRouter.get('/profiles/:id/metaapi/analytics', requireAuth, async (req: AuthRequest, res: Response) => {
  if (analyticsHistoryCache.size > 1000) analyticsHistoryCache.clear();
  try {
    const profileId = Number(req.params.id);
    const profile = await db.prepare('SELECT metaapi_account_id, automation_active, diary_reset_time FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    
    const user = await db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;

    if (!profile || !profile.metaapi_account_id || !user || !user.metaapi_token) {
      return res.json({ success: true, status: 'offline' });
    }

    let rawToken = user.metaapi_token;
    try {
      rawToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    } catch(e) {}

    let rawAccountId = profile.metaapi_account_id;
    try {
      rawAccountId = isEncrypted(profile.metaapi_account_id) ? decrypt(profile.metaapi_account_id) : profile.metaapi_account_id;
    } catch(e) {}

    
    let connection: any;
    try {
      connection = await getSharedConnection(rawToken, rawAccountId);
    } catch (e: any) {
      if (e.message.includes('Fast fail')) {
        return res.json({ success: true, status: 'syncing' });
      }
      throw e;
    }

    // 1. Live Account Info
    const accountInfo = await connection.getAccountInformation();

    // 2. Live Open Positions
    const positions = await connection.getPositions();

    // 3. Historical Data (6-hour cache)
    if (req.query.force === 'true') {
      analyticsHistoryCache.delete(profileId);
    }
    let historyStats = analyticsHistoryCache.get(profileId);
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    
    if (!historyStats || Date.now() - historyStats.timestamp > SIX_HOURS) {
      
      // Pull last 30 days of deals, strictly filtered by diary_reset_time
      const trades = await getProfileTradeHistory(profileId, 30, profile.diary_reset_time || undefined);
      
      let tradesTaken = 0;
      let winRate = 0;
      let totalProfit = 0;

      if (trades && trades.length > 0) {
        // "pull the trades from only when bots were active" 
        // Filter out manual trades (bot_id would be empty, but getProfileTradeHistory sets it from comment)
        const botTrades = trades.filter((t: any) => t.bot_id && t.bot_id !== '');
        tradesTaken = botTrades.length;
        
        const wins = botTrades.filter((t: any) => t.profit > 0).length;
        winRate = tradesTaken > 0 ? (wins / tradesTaken) * 100 : 0;
        totalProfit = botTrades.reduce((sum: number, t: any) => sum + t.profit, 0);
      }

      historyStats = { timestamp: Date.now(), tradesTaken, winRate, profit: totalProfit };
      analyticsHistoryCache.set(profileId, historyStats);
    }

    res.json({
      success: true,
      status: 'connected',
      account: {
        balance: accountInfo.balance,
        equity: accountInfo.equity,
        margin: accountInfo.margin,
        freeMargin: accountInfo.freeMargin,
        currency: accountInfo.currency
      },
      positions: positions.map((p: any) => ({
        id: p.id,
        symbol: p.symbol,
        type: p.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
        volume: p.volume,
        openPrice: p.openPrice,
        currentPrice: p.currentPrice,
        stopLoss: p.stopLoss || null,
        takeProfit: p.takeProfit || null,
        profit: p.profit,
        swap: p.swap
      })),
      history: {
        tradesTaken: historyStats.tradesTaken,
        winRate: historyStats.winRate,
        profit: historyStats.profit
      }
    });

  } catch (e: any) {
    console.error(`[Auth] Analytics fetch error for Profile ${req.params.id}:`, e.message);
    // If anything fails, it's offline (red badge)
    res.json({ success: true, status: 'offline', error: e.message });
  }
});
