import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth';
import db from './db';
import { encrypt, decrypt, isEncrypted } from './crypto';
import { verifyMetaApiAccount } from './metaApiHandler';
import { GoogleGenAI } from '@google/genai';

export const settingsRouter = Router();

// GET /api/settings/keys
settingsRouter.get('/keys', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT metaapi_token, metaapi_account_id, gemini_api_key FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let metaapi_token = '';
    let metaapi_account_id = '';
    let gemini_api_key = '';
    
    if (user.metaapi_token) {
      metaapi_token = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    }
    if (user.metaapi_account_id) {
      metaapi_account_id = isEncrypted(user.metaapi_account_id) ? decrypt(user.metaapi_account_id) : user.metaapi_account_id;
    }
    if (user.gemini_api_key) {
      gemini_api_key = isEncrypted(user.gemini_api_key) ? decrypt(user.gemini_api_key) : user.gemini_api_key;
    }

    res.json({
      success: true,
      keys: {
        metaapiToken: metaapi_token ? '••••••••••••••••' + metaapi_token.slice(-4) : '',
        metaapiAccountId: metaapi_account_id,
        geminiApiKey: gemini_api_key ? '••••••••••••••••' + gemini_api_key.slice(-4) : ''
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/keys
settingsRouter.post('/keys', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { metaapiToken, metaapiAccountId, geminiApiKey } = req.body;
    
    const user = db.prepare('SELECT metaapi_token, metaapi_account_id, gemini_api_key FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let finalMetaToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    let finalMetaAccount = isEncrypted(user.metaapi_account_id) ? decrypt(user.metaapi_account_id) : user.metaapi_account_id;
    let finalGeminiKey = user.gemini_api_key ? (isEncrypted(user.gemini_api_key) ? decrypt(user.gemini_api_key) : user.gemini_api_key) : null;

    if (metaapiToken && !metaapiToken.startsWith('••••')) finalMetaToken = metaapiToken;
    if (metaapiAccountId) finalMetaAccount = metaapiAccountId;
    if (geminiApiKey && !geminiApiKey.startsWith('••••')) finalGeminiKey = geminiApiKey;

    db.prepare(`
      UPDATE users 
      SET metaapi_token = ?, metaapi_account_id = ?, gemini_api_key = ? 
      WHERE id = ?
    `).run(
      finalMetaToken ? encrypt(finalMetaToken.trim()) : null,
      finalMetaAccount ? encrypt(finalMetaAccount.trim()) : null,
      finalGeminiKey ? encrypt(finalGeminiKey.trim()) : null,
      req.user.id
    );

    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/settings/status
settingsRouter.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT metaapi_token, metaapi_account_id, gemini_api_key FROM users WHERE id = ?').get(req.user.id) as any;
    
    const status = {
      metaapi: 'offline',
      gemini: 'offline'
    };

    // Test MetaAPI
    try {
      if (user.metaapi_token && user.metaapi_account_id) {
        const token = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
        const accountId = isEncrypted(user.metaapi_account_id) ? decrypt(user.metaapi_account_id) : user.metaapi_account_id;
        const isValid = await verifyMetaApiAccount(token, accountId);
        if (isValid) status.metaapi = 'connected';
      }
    } catch(e) {}

    // Test Gemini
    try {
      let gKey = user.gemini_api_key || process.env.GEMINI_API_KEY;
      if (gKey && isEncrypted(gKey)) gKey = decrypt(gKey);
      if (gKey) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gKey}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) status.gemini = 'connected';
      }
    } catch(e) {}

    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/settings/account
settingsRouter.delete('/account', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    // Delete user (cascade will delete profiles, pending signals etc if foreign keys are set properly)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.clearCookie('auth_token', { httpOnly: true, sameSite: 'strict' });
    res.json({ success: true, message: 'Account deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
