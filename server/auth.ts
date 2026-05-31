import { Router, Request, Response, NextFunction } from 'express';

import { getMetaApiSyncStatus } from './candleProvider.js';
import bcrypt from 'bcrypt';
import * as jwtPkg from 'jsonwebtoken';
import fs from 'fs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import db from './db';
// import { metaApiSyncStatus } from './candleProvider';
import { OAuth2Client } from 'google-auth-library';
import { encrypt, decrypt, isEncrypted } from './crypto';
import { ALL_BOT_CONFIGS, BOT_REGISTRY, getProfileActiveBots, setProfileActiveBots, deleteProfileBotInstances } from './botManager';
import { sendOtpEmail } from './email';
import { deleteProfileStore } from './marketStore';
import { deleteProfileTradeState } from './tradeManager';
import { verifyMetaApiAccount, verifyMetaApiConnection, getSharedConnection, getProfileTradeHistory, clearSharedConnection } from './metaApiHandler.js';

const jwtLib = jwtPkg as any;

const generateOtp = (): string => Math.floor(100000 + Math.random() * 900000).toString();

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
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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
    res.clearCookie('auth_token', { httpOnly: true, sameSite: 'strict' });
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

    // Register user directly (bypassing OTP)
    const result = await db.prepare(`
      INSERT INTO users (email, password_hash, metaapi_token, metaapi_account_id) 
      VALUES (?, ?, ?, ?)
    `).run(email, hashedPassword, encrypt(metaapiToken.trim()), encrypt(accountId.trim()));

    const userId = result.lastInsertRowid;
    
    await db.prepare(`
      INSERT INTO trading_profiles (user_id, profile_name, metaapi_account_id, automation_active)
      VALUES (?, ?, ?, ?)
    `).run(userId, 'Default Profile', encrypt(accountId.trim()), 1);

    const jwtToken = (jwtLib.default || jwtLib).sign({ id: userId, email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('auth_token', jwtToken, COOKIE_OPTIONS);

    

    res.json({ success: true, user: { id: userId, email, role: 'user', tier: 'Standard' } });
  } catch (err: any) {
    console.error('[Auth] Register error:', err.message);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// ── POST /register/confirm ─────────────────────────────────────────────────────
authRouter.post('/register/confirm', authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and verification code are required.' });
    }

    const otpRow = await db.prepare(
      "SELECT * FROM otps WHERE email = ? AND otp_code = ? AND purpose = 'register'"
    ).get(email, otp) as any;

    if (!otpRow) {
      return res.status(400).json({ success: false, error: 'Invalid verification code.' });
    }

    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'Verification code has expired.' });
    }

    // Double-check user doesn't already exist (race condition)
    const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    // Register user
    let parsedPayload;
    try {
      parsedPayload = JSON.parse(otpRow.payload);
    } catch(e) {
      // Fallback for old OTPs if any
      parsedPayload = { passwordHash: otpRow.payload, metaapiToken: null };
    }

    const tokenToSave = parsedPayload.metaapiToken ? (isEncrypted(parsedPayload.metaapiToken) ? parsedPayload.metaapiToken : encrypt(parsedPayload.metaapiToken)) : null;
    const result = await db.prepare('INSERT INTO users (email, password_hash, metaapi_token) VALUES (?, ?, ?)').run(email, parsedPayload.passwordHash, tokenToSave);

    // Delete used OTP
    await db.prepare('DELETE FROM otps WHERE id = ?').run(otpRow.id);

    const token = (jwtLib.default || jwtLib).sign(
      { id: result.lastInsertRowid, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    res.json({ success: true, user: { id: result.lastInsertRowid, email } });
  } catch (err: any) {
    console.error('[Auth] Register confirm error:', err.message);
    res.status(500).json({ success: false, error: 'Verification failed. Please try again.' });
  }
});

// ── POST /login ───────────────────────────────────────────────────────────────
authRouter.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password, metaapiToken, accountId } = req.body;
    if (!email || !password || !metaapiToken || !accountId) {
      return res.status(400).json({ success: false, error: 'Email, password, Meta API Token, and Account ID are required.' });
    }
    if (metaapiToken.trim().length < 20 || accountId.trim().length < 5) {
      return res.status(400).json({ success: false, error: 'Invalid Meta API Token or Account ID length.' });
    }

    
    const isValidToken = await verifyMetaApiAccount(metaapiToken.trim(), accountId.trim());
    if (!isValidToken) {
      return res.status(400).json({ success: false, error: 'Invalid Meta API Token or Account ID. Connection rejected.' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

    const dummyHash = '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const hashToCompare = user ? user.password_hash : dummyHash;
    const isMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const encryptedToken = encrypt(metaapiToken.trim());
    
    // Update user's token directly and log in
    await db.prepare('UPDATE users SET metaapi_token = ? WHERE id = ?').run(encryptedToken, user.id);

    // Sync account ID to default profile
    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? LIMIT 1').get(user.id) as any;
    if (profile) {
      await db.prepare('UPDATE trading_profiles SET metaapi_account_id = ?, automation_active = 1 WHERE id = ?').run(encrypt(accountId.trim()), profile.id);
    } else {
      await db.prepare(`
        INSERT INTO trading_profiles (user_id, profile_name, metaapi_account_id, automation_active)
        VALUES (?, ?, ?, ?)
      `).run(user.id, 'Default Profile', encrypt(accountId.trim()), 1);
    }

    const token = (jwtLib.default || jwtLib).sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    
    

    const { password_hash: _omit, ...safeUser } = user;
    res.json({ success: true, requiresOtp: false, user: safeUser });
  } catch (err: any) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/google (Google OAuth Login) ────────────────────────────────
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || 'dummy_client_id');

authRouter.post('/google', async (req, res) => {
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
    if (accountId) {
      const profile = await db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? LIMIT 1').get(user.id) as any;
      if (profile) {
         await db.prepare('UPDATE trading_profiles SET metaapi_account_id = ?, automation_active = 1 WHERE id = ?').run(encrypt(accountId.trim()), profile.id);
      } else {
         await db.prepare(`
          INSERT INTO trading_profiles (user_id, profile_name, metaapi_account_id, automation_active)
          VALUES (?, ?, ?, ?)
         `).run(user.id, 'Default Profile', encrypt(accountId.trim()), 1);
      }
    }

    // Sign session JWT
    const token = (jwtLib.default || jwtLib).sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    const { password_hash: _omit, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (e: any) {
    console.error('[Auth] Google login error:', e.message);
    res.status(500).json({ success: false, error: 'Google login failed. Are your Client IDs configured?' });
  }
});

// ── POST /login/confirm ────────────────────────────────────────────────────────
authRouter.post('/login/confirm', authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and verification code are required.' });
    }

    const otpRow = await db.prepare(
      "SELECT * FROM otps WHERE email = ? AND otp_code = ? AND purpose = 'login'"
    ).get(email, otp) as any;

    if (!otpRow) {
      return res.status(400).json({ success: false, error: 'Invalid verification code.' });
    }

    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'Verification code has expired.' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Update user's token on login
    let parsedPayload;
    try {
      parsedPayload = JSON.parse(otpRow.payload);
      if (parsedPayload.metaapiToken) {
        const tokenToSave = isEncrypted(parsedPayload.metaapiToken) ? parsedPayload.metaapiToken : encrypt(parsedPayload.metaapiToken);
        await db.prepare('UPDATE users SET metaapi_token = ? WHERE id = ?').run(tokenToSave, user.id);
        
      }
    } catch(e) {}

    // Delete used OTP
    await db.prepare('DELETE FROM otps WHERE id = ?').run(otpRow.id);

    const token = (jwtLib.default || jwtLib).sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    const { password_hash: _omit, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err: any) {
    console.error('[Auth] Login confirm error:', err.message);
    res.status(500).json({ success: false, error: 'Verification failed. Please try again.' });
  }
});

// ── POST /logout ──────────────────────────────────────────────────────────────
authRouter.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { httpOnly: true, sameSite: 'strict' });
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ── GET /me ───────────────────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const user = await db.prepare(
    'SELECT id, email, metaapi_account_id, risk_multiplier, automation_active, metaapi_token FROM users WHERE id = ?'
  ).get(req.user.id) as any;

  if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

  // Never return the encrypted MetaAPI token — just whether it's set
  const hasMetaApiToken = !!(user.metaapi_token);

  res.json({ success: true, user: { ...(user as any), hasMetaApiToken } });
});

authRouter.get('/metaapi/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await db.prepare('SELECT metaapi_token, metaapi_account_id FROM users WHERE id = ?').get(req.user.id) as any;
    const profile = await db.prepare('SELECT metaapi_account_id FROM trading_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1').get(req.user.id) as any;
    
    const activeAccountId = profile?.metaapi_account_id || user?.metaapi_account_id;

    if (user?.metaapi_token && activeAccountId) {
      const { getMetaApiConnectionState, getSharedConnection } = await import('./metaApiHandler.js');
      const token = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
      
      let status = getMetaApiConnectionState(token, activeAccountId);
      if (status === 'offline') {
         // Kickstart background sync if the price poller hasn't started it yet (e.g., during Gap Time)
         getSharedConnection(token, activeAccountId, true).catch(() => {});
         status = 'syncing'; // Set status to syncing immediately for the UI
      }
      
      res.json({ success: true, status });
    } else {
      res.json({ success: true, status: 'offline' });
    }
  } catch (err) {
    res.json({ success: true, status: 'offline' });
  }
});



// ── GET /profiles ─────────────────────────────────────────────────────────────
authRouter.get('/profiles', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profiles = await db.prepare('SELECT id, profile_name, metaapi_account_id, risk_multiplier, bot_risks, automation_active, ai_sniper_active, diary_reset_time, created_at FROM trading_profiles WHERE user_id = ? ORDER BY created_at ASC').all(req.user.id);
    
    const enrichedProfiles = profiles.map((p: any) => ({
      ...p,
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

    

    res.json({ success: true, profileId: result.lastInsertRowid });
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
        clearSharedConnection(rawToken, profile.metaapi_account_id);
      } catch (e) {}
    }

    try {
      deleteProfileStore(profileId);
      deleteProfileTradeState(profileId);
      deleteProfileBotInstances(profileId);
    } catch (e) {}

    await db.prepare('DELETE FROM trading_profiles WHERE id = ? AND user_id = ?').run(profileId, req.user.id);
    await db.prepare('DELETE FROM bot_trade_states WHERE profile_id = ?').run(profileId);
    await db.prepare('DELETE FROM trade_diary WHERE profile_id = ?').run(profileId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /profiles/:id/settings ───────────────────────────────────────────────
authRouter.post('/profiles/:id/settings', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileId = Number(req.params.id);
    const profile = await db.prepare('SELECT id, metaapi_account_id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const user = await db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user || !user.metaapi_token) {
      return res.status(400).json({ success: false, error: 'User Meta API Token missing. Please log in again.' });
    }

    const { profile_name, metaapi_account_id, risk_multiplier, bot_risks, automation_active, ai_sniper_active } = req.body;

    const rm = Number(risk_multiplier);
    // Allow any risk percentage between 0.1% and 100%
    const safeMultiplier = (rm >= 0.1 && rm <= 100) ? rm : 1;
    const cleanAccountId = typeof metaapi_account_id === 'string' ? metaapi_account_id.trim().replace(/[^a-zA-Z0-9\-]/g, '') : null;
    const cleanName = typeof profile_name === 'string' && profile_name.trim() !== '' ? profile_name.trim() : 'Unnamed Profile';
    
    let parsedBotRisks: Record<string, any> = {};
    if (typeof bot_risks === 'string') {
      try {
        parsedBotRisks = JSON.parse(bot_risks);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid bot_risks format.' });
      }
    } else if (typeof bot_risks === 'object' && bot_risks !== null) {
      parsedBotRisks = bot_risks;
    }
    
    for (const key in parsedBotRisks) {
      const val = Number(parsedBotRisks[key]);
      if (isNaN(val) || val < 0.1 || val > 100) {
        return res.status(400).json({ success: false, error: `Invalid risk value for bot ${key}. Must be between 0.1 and 100.` });
      }
      parsedBotRisks[key] = val;
    }
    const safeBotRisks = JSON.stringify(parsedBotRisks);

    const tokenToUse = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;

    if (automation_active && !cleanAccountId) {
      return res.status(400).json({ success: false, error: 'Account ID is required to arm the Master Switch.' });
    }

    if (tokenToUse && cleanAccountId) {
      try {
        await verifyMetaApiConnection(tokenToUse, cleanAccountId);
      } catch (err: any) {
        return res.status(400).json({ success: false, error: err.message });
      }
    }

    // Clean up old connection if account ID changed
    if (profile.metaapi_account_id) {
      const storedAccountId = profile.metaapi_account_id ? (isEncrypted(profile.metaapi_account_id) ? decrypt(profile.metaapi_account_id) : profile.metaapi_account_id) : null;
      if (cleanAccountId && cleanAccountId !== storedAccountId) {
        try {
          clearSharedConnection(tokenToUse, profile.metaapi_account_id);
          console.log(`[Auth] Cleared old MetaAPI connection for profile ${profileId} due to account ID update.`);
        } catch (e) {
          console.warn(`[Auth] Failed to clear old connection:`, e);
        }
      }
    }

    await db.prepare(`
      UPDATE trading_profiles
      SET profile_name = ?, metaapi_account_id = ?, risk_multiplier = ?, bot_risks = ?, automation_active = ?, ai_sniper_active = ?
      WHERE id = ? AND user_id = ?
    `).run(cleanName, cleanAccountId ? encrypt(cleanAccountId) : null, safeMultiplier, safeBotRisks, automation_active ? 1 : 0, ai_sniper_active ? 1 : 0, profileId, req.user.id);

    

    res.json({ success: true, message: 'Settings saved and connection verified.' });
  } catch (err: any) {
    console.error('[Auth] Profile settings error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save settings. Please try again.' });
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
    const bots = (ALL_BOT_CONFIGS || []).map((cfg: any) => ({
      ...cfg,
      isActive: activeBotIds.includes(cfg.id),
    }));
    res.json({ success: true, bots });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /profiles/:id/bots/toggle ────────────────────────────────────────────
authRouter.post('/profiles/:id/bots/toggle', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = Number(req.params.id);
    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id);
    if (!profile) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const { botId, active } = req.body;
    if (typeof botId !== 'string' || typeof active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Invalid payload.' });
    }
    if (!BOT_REGISTRY[botId]) {
      return res.status(400).json({ success: false, error: `Unknown bot: ${botId}` });
    }

    const current: string[] = await getProfileActiveBots(profileId);
    const updated = active
      ? (current.includes(botId) ? current : [...current, botId])
      : current.filter((id: string) => id !== botId);
    
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

// ── POST /profiles/:id/diary/reset ────────────────────────────────────────────
authRouter.post('/profiles/:id/diary/reset', requireAuth, async (req: AuthRequest, res: Response) => {
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
