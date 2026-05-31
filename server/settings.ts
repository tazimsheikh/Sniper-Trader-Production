import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth';
import db from './db';
import { encrypt, decrypt, isEncrypted } from './crypto';
import { verifyMetaApiAccount, clearApiCacheForToken, clearAllSharedConnections } from './metaApiHandler';
import { safetyStatusMap } from './botManager';

export const settingsRouter = Router();

// GET /api/settings/keys
settingsRouter.get('/keys', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.prepare('SELECT metaapi_token, metaapi_account_id, openrouter_api_key FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let metaapi_token = '';
    let metaapi_account_id = '';
    let openrouter_api_key = '';
    
    if (user.metaapi_token) {
      metaapi_token = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    }
    if (user.metaapi_account_id) {
      metaapi_account_id = isEncrypted(user.metaapi_account_id) ? decrypt(user.metaapi_account_id) : user.metaapi_account_id;
    }
    if (user.openrouter_api_key) {
      openrouter_api_key = isEncrypted(user.openrouter_api_key) ? decrypt(user.openrouter_api_key) : user.openrouter_api_key;
    }

    res.json({
      success: true,
      keys: {
        metaapiToken: metaapi_token ? '••••••••••••••••' + metaapi_token.slice(-4) : '',
        metaapiAccountId: metaapi_account_id,
        openrouterApiKey: openrouter_api_key ? '••••••••••••••••' + openrouter_api_key.slice(-4) : ''
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/keys
settingsRouter.post('/keys', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { metaapiToken, metaapiAccountId, openrouterApiKey } = req.body;
    
    const user = await db.prepare('SELECT metaapi_token, metaapi_account_id, openrouter_api_key FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let finalMetaToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
    let finalMetaAccount = isEncrypted(user.metaapi_account_id) ? decrypt(user.metaapi_account_id) : user.metaapi_account_id;
    let finalOpenrouterKey = user.openrouter_api_key ? (isEncrypted(user.openrouter_api_key) ? decrypt(user.openrouter_api_key) : user.openrouter_api_key) : null;

    if (metaapiToken && !metaapiToken.startsWith('••••')) finalMetaToken = metaapiToken;
    if (metaapiAccountId) finalMetaAccount = typeof metaapiAccountId === 'string' ? metaapiAccountId.trim().replace(/[^a-zA-Z0-9\-]/g, '') : metaapiAccountId;
    if (openrouterApiKey && !openrouterApiKey.startsWith('••••')) finalOpenrouterKey = openrouterApiKey;

    await db.prepare(`
      UPDATE users 
      SET metaapi_token = ?, metaapi_account_id = ?, openrouter_api_key = ? 
      WHERE id = ?
    `).run(
      finalMetaToken ? encrypt(finalMetaToken.trim()) : null,
      finalMetaAccount ? encrypt(finalMetaAccount.trim()) : null,
      finalOpenrouterKey ? encrypt(finalOpenrouterKey.trim()) : null,
      req.user.id
    );

    if (metaapiToken && !metaapiToken.startsWith('••••') && user.metaapi_token) {
      const oldToken = isEncrypted(user.metaapi_token) ? decrypt(user.metaapi_token) : user.metaapi_token;
      clearApiCacheForToken(oldToken);
      clearAllSharedConnections();
    }

    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/settings/status
settingsRouter.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.prepare('SELECT metaapi_token, metaapi_account_id, openrouter_api_key FROM users WHERE id = ?').get(req.user.id) as any;
    
    const status = {
      metaapi: 'offline',
      openrouter: 'offline'
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

    // Test OpenRouter
    try {
      let gKey = user.openrouter_api_key || process.env.OPENROUTER_API_KEY;
      if (gKey && isEncrypted(gKey)) gKey = decrypt(gKey);
      if (gKey) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`https://openrouter.ai/api/v1/auth/key`, { 
          method: 'GET',
          headers: { 'Authorization': `Bearer ${gKey}` },
          signal: controller.signal 
        });
        clearTimeout(timeout);
        if (res.ok) status.openrouter = 'connected';
      }
    } catch(e) {}

    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/settings/account
settingsRouter.delete('/account', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    // Delete user (cascade will delete profiles, pending signals etc if foreign keys are set properly)
    await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.clearCookie('auth_token', { httpOnly: true, sameSite: 'strict' });
    res.json({ success: true, message: 'Account deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/settings/safety
settingsRouter.get('/safety', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.query.profileId;
    if (!profileId) {
      return res.status(400).json({ success: false, error: 'profileId is required' });
    }

    const profile = await db.prepare('SELECT safety_settings FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id) as any;
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    let settings = {};
    if (profile.safety_settings) {
      try {
        settings = JSON.parse(profile.safety_settings);
      } catch (e) {}
    }

    // Default values
    const defaultSettings = {
      dailyLossLimit: 5,
      maxDrawdownLimit: 20,
      unprofitablePairLookback: 10,
      unprofitablePairMinTrades: 5,
      unprofitablePairMinWinRate: 40,
      unprofitablePairMinProfitPips: 0,
      volatilityFilterEnabled: true,
      volatilityFilterMinAdrPips: 15
    };

    res.json({
      success: true,
      settings: { ...defaultSettings, ...settings }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/settings/safety/status
settingsRouter.get('/safety/status', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.query.profileId;
    if (!profileId) {
      return res.status(400).json({ success: false, error: 'profileId is required' });
    }

    const status = safetyStatusMap.get(Number(profileId)) || {
      circuitBreakerActive: false,
      circuitBreakerReason: '',
      drawdownPct: 0,
      dailyProfitPct: 0,
      blockedPairs: {}
    };

    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/safety
settingsRouter.post('/safety', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { profileId, settings } = req.body;
    if (!profileId) {
      return res.status(400).json({ success: false, error: 'profileId is required' });
    }
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, error: 'settings object is required' });
    }

    if (settings.maxDrawdownLimit !== undefined) {
      const maxDD = Number(settings.maxDrawdownLimit);
      if (isNaN(maxDD) || maxDD < 0 || maxDD > 100) {
        return res.status(400).json({ success: false, error: 'maxDrawdownLimit must be between 0 and 100' });
      }
      settings.maxDrawdownLimit = maxDD;
    }

    if (settings.dailyLossLimit !== undefined) {
      const dailyLoss = Number(settings.dailyLossLimit);
      if (isNaN(dailyLoss) || dailyLoss <= 0) {
        return res.status(400).json({ success: false, error: 'dailyLossLimit must be greater than 0' });
      }
      settings.dailyLossLimit = dailyLoss;
    }

    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    await db.prepare('UPDATE trading_profiles SET safety_settings = ? WHERE id = ?').run(
      JSON.stringify(settings),
      profileId
    );

    res.json({ success: true, message: 'Safety settings updated successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/safety/reset-peak
settingsRouter.post('/safety/reset-peak', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { profileId } = req.body;
    if (!profileId) {
      return res.status(400).json({ success: false, error: 'profileId is required' });
    }

    const profile = await db.prepare('SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?').get(profileId, req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    // Set peak_balance to 0 so the next bot tick instantly overwrites it with the current live balance
    await db.prepare('UPDATE trading_profiles SET peak_balance = 0 WHERE id = ?').run(profileId);

    res.json({ success: true, message: 'Peak balance watermark has been successfully reset.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
