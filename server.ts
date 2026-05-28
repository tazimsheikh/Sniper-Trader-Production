import 'dotenv/config'; // FIX: Load env vars before anything else — works in production too
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { manuallyTriggerTrap, getTimingGate } from './server/marketStore';
import { askTutorAgent, verifySignalWithAI } from './server/tutorAgent';
import { authRouter } from './server/auth';
import { settingsRouter } from './server/settings';
import { ensureBotSchema, botManagerTick, metaApiExecutionHealth, metaApiLastConnected, isMetaApiTradeBlocked, isMetaApiConnecting } from './server/botManager';
import { validateAllBots } from './server/botValidator';
import { getCalendarData, getSyntheticCalendarFallback } from './server/newsStore';
import { monitorOpenTrades } from './server/tradeManager';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(cookieParser()); // FIX: Required to read HttpOnly auth cookies

  // ── Auth routes ─────────────────────────────────────────────────────────────
  // ── Auth routes ─────────────────────────────────────────────────────────────
  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);

  // ── Market store init ────────────────────────────────────────────────────────
  // await validateAllBots(); // Deprecated: Validation logic is now obsolete since bots are just UI switches
  ensureBotSchema(); // Initialize bot tables (idempotent)

  // ── Market price polling — FIX: Mutex prevents overlapping async calls ──────
  let isUpdating = false;
  let tickCount  = 0;

  setInterval(async () => {
    if (isUpdating) return;
    isUpdating = true;
    try {
      const { getTimingGate, getProfileMarkets, getProfileActiveDataSource } = await import('./server/marketStore');
      const { gate } = getTimingGate();
      const isActiveSession = gate !== 'Gap Time';

      const db = (await import('./server/db')).default;
      const profiles = db.prepare('SELECT id FROM trading_profiles WHERE automation_active = 1').all() as any[];

      for (const profile of profiles) {
        let isNearKeyLevel = false;
        
        if (isActiveSession) {
          const markets = getProfileMarkets(profile.id);
          for (const m of markets) {
            if (m.currentPrice >= m.hod - 15 * m.pipSize || m.currentPrice <= m.lod + 15 * m.pipSize) {
              isNearKeyLevel = true;
              break;
            }
          }
        }

        const activeDataSource = getProfileActiveDataSource(profile.id);
        let shouldSync = false;
        if (activeDataSource === 'metaapi' || (isActiveSession && isNearKeyLevel)) {
          shouldSync = true;
        } else if (isActiveSession && !isNearKeyLevel) {
          shouldSync = (tickCount % 15 === 0);
        } else {
          shouldSync = (tickCount % 900 === 0);
        }

        if (tickCount % 900 === 0) shouldSync = true;
        
        // Dynamic import to avoid circular dependencies
        const { getOrCreateProfileStore } = await import('./server/marketStore');
        const store = await getOrCreateProfileStore(profile.id);
        await store.updatePrices(shouldSync);
      }
      tickCount++;
    } catch (e) {
      // Suppress background errors
    } finally {
      isUpdating = false;
    }
  }, 1000);

  // ── Bot Manager polling — runs every 30s, manages all user bots ─────────────
  let isBotTicking = false;
  setInterval(async () => {
    if (isBotTicking) return;
    isBotTicking = true;
    try {
      const db = (await import('./server/db')).default;
      const profiles = db.prepare('SELECT id FROM trading_profiles WHERE automation_active = 1').all() as any[];
      const { getProfileMarkets, getProfileMarketSpreads } = await import('./server/marketStore');
      
      for (const profile of profiles) {
        const spreads = getProfileMarketSpreads(profile.id);
        const marketsSnapshot = Object.fromEntries(
          getProfileMarkets(profile.id).map(m => {
            const spread = spreads[m.symbol] || { bid: m.currentPrice, ask: m.currentPrice };
            return [m.symbol, { ...m, bid: spread.bid, ask: spread.ask }];
          })
        );
        await botManagerTick(profile.id, () => marketsSnapshot);
      }
    } catch (e: any) {
      console.error('[BotManager] Tick error:', e.message);
    } finally {
      isBotTicking = false;
    }
  }, 30_000);

  // ── Trade Manager Loop (Break-even, Ejection, Lockout) ───────────────────────
  let isTradeManagerTicking = false;
  setInterval(async () => {
    if (isTradeManagerTicking) return;
    isTradeManagerTicking = true;
    try {
      const timingInfo = getTimingGate();
      await monitorOpenTrades(timingInfo.gate);
    } catch (e: any) {
      console.error('[TradeManager] Loop error:', e.message);
    } finally {
      isTradeManagerTicking = false;
    }
  }, 10_000); // Check open trades every 10 seconds

  // ── In-memory practice ledger (non-auth users / education mode) ─────────────
  const userProgress = {
    balance: 10000,
    reviewedSignalsCount: 5,
    quizScore: 92,
    quizTaken: 3,
    trades: [
      {
        id: 't1', symbol: 'GC=F', displayName: 'XAUUSD Gold',
        direction: 'BUY', entry: 4502.10, exit: 4517.10, profit: 1500, pips: 150,
        setupType: 'First Green Day Reversal',
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), status: 'CLOSED',
      },
      {
        id: 't2', symbol: 'NQ=F', displayName: 'NAS100 Futures',
        direction: 'SELL', entry: 29585.00, exit: 29555.00, profit: 3000, pips: 300,
        setupType: 'First Red Day Reversal',
        timestamp: new Date(Date.now() - 3600000 * 6).toISOString(), status: 'CLOSED',
      },
    ],
  };

  // ── API Endpoints ────────────────────────────────────────────────────────────
  
  // Helper to extract active profileId for the requesting user
  async function getProfileIdFromReq(req: any): Promise<number> {
    const userIdCookie = req.cookies?.auth_token;
    if (!userIdCookie) return 999; // Default/Simulation profile
    try {
      const jwtLib = await import('jsonwebtoken');
      const decoded: any = (jwtLib.default || jwtLib).verify(userIdCookie, process.env.JWT_SECRET!);
      const db = (await import('./server/db')).default;
      const profile = db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? AND automation_active = 1 LIMIT 1').get(decoded.id) as any;
      return profile ? profile.id : 999;
    } catch (e) {
      return 999;
    }
  }

  app.get('/api/market', async (req, res) => {
    const { getProfileMarkets } = await import('./server/marketStore');
    const profileId = await getProfileIdFromReq(req);
    res.json({ success: true, data: getProfileMarkets(profileId) });
  });

  app.get('/api/alerts', async (req, res) => {
    const { getProfileAlerts } = await import('./server/marketStore');
    const profileId = await getProfileIdFromReq(req);
    res.json({ success: true, data: getProfileAlerts(profileId) });
  });

  // ── Bot Engine Health Status ──────────────────────────────────────────────
  app.get('/api/bot-health', async (req, res) => {
    const profileId = await getProfileIdFromReq(req);
    // TODO: Ideally bot manager tracks health per-profile. 
    // Using global for now since connection errors would be isolated inside `botManagerTick`.
    const blocked = isMetaApiTradeBlocked();
    res.json({ 
      success: true, 
      health: metaApiExecutionHealth, 
      lastConnected: metaApiLastConnected,
      pendingSignals: 0,
      missedSignals: 0,
      tradingBlocked: blocked,
      offlineSince: blocked ? (metaApiLastConnected || null) : null,
      isConnecting: isMetaApiConnecting(),
      profileId
    });
  });

  // ── Data-source status (Yahoo vs MetaAPI) ────────────────────────────────
  app.get('/api/data-source', async (req, res) => {
    const { getProfileActiveDataSource } = await import('./server/marketStore');
    const profileId = await getProfileIdFromReq(req);
    res.json({ success: true, source: getProfileActiveDataSource(profileId) });
  });

  app.get('/api/economic-calendar', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const data = await getCalendarData(forceRefresh);
      if (!Array.isArray(data) || data.length === 0) throw new Error('AI returned empty calendar data');
      res.json(data);
    } catch (err: any) {
      console.warn('[Server] AI economic calendar fetch failed, using synthetic fallback:', err.message);
      const synthetic = getSyntheticCalendarFallback();
      res.json(synthetic);
    }
  });

  // ── Trigger a data-source refresh (called after user saves MetaAPI creds) ─
  app.post('/api/refresh-data-source', async (req, res) => {
    try {
      const profileId = await getProfileIdFromReq(req);
      const { getOrCreateProfileStore } = await import('./server/marketStore');
      const store = await getOrCreateProfileStore(profileId);
      // Wait for the next tick to rebuild it naturally, or force a reset:
      res.json({ success: true, source: 'metaapi' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/metaapi/verify', async (req, res) => {
    const { token, accountId } = req.body;
    if (!token || !accountId) return res.status(400).json({ success: false, error: 'Token and Account ID are required' });

    try {
      // @ts-ignore
      const MetaApiPkg = await import('metaapi.cloud-sdk/esm-node');
      const MetaApi = (MetaApiPkg as any).default || MetaApiPkg;
      const api = new MetaApi(token);
      
      const account = await api.metatraderAccountApi.getAccount(accountId);
      if (!account) {
        return res.status(400).json({ success: false, error: 'MetaTrader account not found for this Account ID.' });
      }
      
      // Update the user's first profile in the database
      const { encrypt } = await import('./server/crypto');
      const db = (await import('./server/db')).default;
      
      const userIdCookie = req.cookies?.auth_token;
      if (userIdCookie) {
        const jwtLib = await import('jsonwebtoken');
        try {
          const decoded: any = (jwtLib.default || jwtLib).verify(userIdCookie, process.env.JWT_SECRET!);
          const profile = db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? LIMIT 1').get(decoded.id) as any;
          if (profile) {
            db.prepare('UPDATE trading_profiles SET metaapi_token = ?, metaapi_account_id = ? WHERE id = ?')
              .run(encrypt(token), account._id, profile.id);
            const { getOrCreateProfileStore } = await import('./server/marketStore');
            const store = await getOrCreateProfileStore(profile.id);
            await store.updatePrices(true);
          }
        } catch (e) {
          console.warn('Failed to update user profile with Meta API key', e);
        }
      }

      res.json({ success: true, accountId: account._id });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/alerts/trigger', async (req, res) => {
    const { symbol, pattern } = req.body;
    if (!symbol || !pattern) {
      return res.status(400).json({ success: false, error: 'Missing symbol or pattern type' });
    }

    const verification = await verifySignalWithAI(symbol, pattern);
    if (!verification.approved) {
      return res.status(400).json({ success: false, error: 'Signal rejected by AI validation: ' + verification.reasoning });
    }

    const alert = manuallyTriggerTrap(symbol, pattern);
    res.json({ success: true, data: alert });
  });

  app.get('/api/progress', (_req, res) => {
    res.json({ success: true, data: userProgress });
  });

  app.post('/api/progress/add-trade', (req, res) => {
    const { symbol, displayName, direction, entry, exit, profit, pips, setupType } = req.body;
    const newTrade = {
      id: `t-${Date.now()}`, symbol, displayName: displayName || symbol,
      direction, entry: Number(entry), exit: Number(exit),
      profit: Number(profit), pips: Number(pips), setupType,
      timestamp: new Date().toISOString(), status: 'CLOSED',
    };
    userProgress.trades.unshift(newTrade);
    userProgress.balance += Number(profit);
    userProgress.reviewedSignalsCount += 1;
    res.json({ success: true, data: userProgress });
  });

  app.post('/api/progress/quiz', (req, res) => {
    const { score } = req.body;
    if (typeof score !== 'number') {
      return res.status(400).json({ success: false, error: 'Quiz score must be a number' });
    }
    userProgress.quizTaken += 1;
    userProgress.quizScore = Math.round(
      (userProgress.quizScore * (userProgress.quizTaken - 1) + score) / userProgress.quizTaken
    );
    res.json({ success: true, data: userProgress });
  });

  app.post('/api/tutor', async (req, res) => {
    const { prompt, history, relatedSignalId } = req.body;
    try {
      const { getProfileAlertById } = await import('./server/marketStore');
      const profileId = await getProfileIdFromReq(req);
      const activeSignal = relatedSignalId ? getProfileAlertById(profileId, relatedSignalId) : undefined;
      const response = await askTutorAgent(prompt || '', history || [], activeSignal);
      res.json({ success: true, response });
    } catch (err: any) {
      console.error('[Server] Tutor route failure:', err);
      res.status(500).json({ success: false, error: err.message || 'Failed to query tutor' });
    }
  });

  // ── Vite dev middleware or static production handler ────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  // ── Start listening ──────────────────────────────────────────────────────────
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`\n========================================================`);
    console.log(`🚀 Sniper Trading Analyst is running!`);
    console.log(`👉 Local Address:  http://localhost:${PORT}`);
    console.log(`👉 Network:        http://0.0.0.0:${PORT}`);
    console.log(`========================================================\n`);
  });
}

startServer();
