import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import * as jwtPkg from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import db from './db';
import { encrypt, decrypt, isEncrypted } from './crypto';
import { ALL_BOT_CONFIGS, getUserActiveBots, setUserActiveBots, BOT_REGISTRY } from './botManager';

const jwtLib = jwtPkg as any;

// ── Hard-fail on missing secrets (never fall back to defaults) ───────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
}

const VALID_MULTIPLIERS = [1, 2, 4, 8];

export const authRouter = Router();

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
  secure: process.env.NODE_ENV === 'production',     // HTTPS only in prod
  sameSite: 'strict' as const,                       // CSRF protection
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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    // bcrypt cost factor 12 — strong enough, still < 400ms
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, passwordHash);

    const token = (jwtLib.default || jwtLib).sign(
      { id: result.lastInsertRowid, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    res.json({ success: true, user: { id: result.lastInsertRowid, email } });
  } catch (err: any) {
    console.error('[Auth] Register error:', err.message);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// ── POST /login ───────────────────────────────────────────────────────────────
authRouter.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

    // Constant-time comparison even if user doesn't exist — prevents timing attacks
    const dummyHash = '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const hashToCompare = user ? user.password_hash : dummyHash;
    const isMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const token = (jwtLib.default || jwtLib).sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    const { password_hash: _omit, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (err: any) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

// ── POST /logout ──────────────────────────────────────────────────────────────
authRouter.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { httpOnly: true, sameSite: 'strict' });
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ── GET /me ───────────────────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, (req: AuthRequest, res) => {
  const user = db.prepare(
    'SELECT id, email, metaapi_account_id, risk_multiplier, automation_active FROM users WHERE id = ?'
  ).get(req.user.id);

  if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

  // Never return the encrypted MetaAPI token — just whether it's set
  const rawUser = db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;
  const hasMetaApiToken = !!(rawUser?.metaapi_token);

  res.json({ success: true, user: { ...(user as any), hasMetaApiToken } });
});

import { verifyMetaApiConnection, getUserTradeHistory } from './metaApiHandler.js';

// ── POST /automate-settings ───────────────────────────────────────────────────
authRouter.post('/automate-settings', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { metaapi_token, metaapi_account_id, risk_multiplier, automation_active, ai_sniper_active } = req.body;

    // Validate risk multiplier against allowed set
    const rm = Number(risk_multiplier);
    const safeMultiplier = VALID_MULTIPLIERS.includes(rm) ? rm : 1;

    // Sanitize string inputs
    const cleanAccountId = typeof metaapi_account_id === 'string'
      ? metaapi_account_id.trim().replace(/[^a-zA-Z0-9\-]/g, '')
      : null;

    let tokenToUse: string | null = null;
    let tokenToStore: string | null = null;

    if (typeof metaapi_token === 'string' && metaapi_token.trim().length > 20) {
      tokenToUse = metaapi_token.trim();
      tokenToStore = encrypt(tokenToUse);
    } else {
      // If user cleared the field, keep existing token
      const existing = db.prepare('SELECT metaapi_token FROM users WHERE id = ?').get(req.user.id) as any;
      if (existing?.metaapi_token) {
        tokenToStore = existing.metaapi_token;
        tokenToUse = decrypt(tokenToStore);
      }
    }

    // Require both if enabling automation
    if (automation_active && (!tokenToUse || !cleanAccountId)) {
      return res.status(400).json({ success: false, error: 'Both Token and Account ID are required to arm the Master Switch.' });
    }

    // VERIFY CONNECTION HOOK (Always verify if credentials exist)
    if (tokenToUse && cleanAccountId) {
      try {
        await verifyMetaApiConnection(tokenToUse, cleanAccountId);
      } catch (err: any) {
        return res.status(400).json({ success: false, error: err.message });
      }
    }

    db.prepare(`
      UPDATE users
      SET metaapi_token = ?, metaapi_account_id = ?, risk_multiplier = ?, automation_active = ?, ai_sniper_active = ?
      WHERE id = ?
    `).run(tokenToStore, cleanAccountId || null, safeMultiplier, automation_active ? 1 : 0, ai_sniper_active ? 1 : 0, req.user.id);

    res.json({ success: true, message: 'Settings saved and connection verified.' });
  } catch (err: any) {
    console.error('[Auth] Automate settings error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save settings. Please try again.' });
  }
    });

// ── GET /api/bots — List all bots with the user's active state ──────────────
authRouter.get('/bots', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const activeBotIds: string[] = getUserActiveBots(req.user.id);
    const bots = ALL_BOT_CONFIGS.map((cfg: any) => ({
      ...cfg,
      isActive: activeBotIds.includes(cfg.id),
    }));
    res.json({ success: true, bots });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/bots/toggle — Enable or disable a single bot for this user ────
authRouter.post('/bots/toggle', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { botId, active } = req.body;
    if (typeof botId !== 'string' || typeof active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Invalid payload.' });
    }
    if (!BOT_REGISTRY[botId]) {
      return res.status(400).json({ success: false, error: `Unknown bot: ${botId}` });
    }
    const current: string[] = getUserActiveBots(req.user.id);
    const updated = active
      ? (current.includes(botId) ? current : [...current, botId])
      : current.filter((id: string) => id !== botId);
    setUserActiveBots(req.user.id, updated);
    res.json({ success: true, activeBots: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/auth/diary — List all logged trades for the user ───────────────
authRouter.get('/diary', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userRow = db.prepare('SELECT diary_reset_time FROM users WHERE id = ?').get(req.user.id) as any;
    const resetTime = userRow?.diary_reset_time || undefined;

    const liveHistory = await getUserTradeHistory(req.user.id, 30, resetTime);
    if (liveHistory && liveHistory.length > 0) {
      res.json({ success: true, trades: liveHistory });
      return;
    }

    const trades = db.prepare('SELECT * FROM trade_diary WHERE user_id = ? ORDER BY close_time DESC').all(req.user.id);
    
    // Filter local db fallback by reset_time too
    const filteredTrades = resetTime ? trades.filter((t: any) => new Date(t.close_time).getTime() >= new Date(resetTime).getTime()) : trades;
    
    res.json({ success: true, trades: filteredTrades });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/auth/diary/reset — Soft-reset the trade diary ───────────────
authRouter.post('/diary/reset', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET diary_reset_time = ? WHERE id = ?').run(now, req.user.id);
    res.json({ success: true, message: 'Trade diary has been reset.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
