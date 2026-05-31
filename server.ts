import 'dotenv/config'; // FIX: Load env vars before anything else — works in production too
import express from 'express';

// Global error handlers to prevent "Silent Death" crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  // Optional: Send alert to monitoring system
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

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
import http from 'http';
import { initSocket } from './server/socket.js';

export const app = express();
export const httpServer = http.createServer(app);
export const io = initSocket(httpServer);

async function startServer() {
  const { initDb } = await import('./server/db');
  await initDb();
  await ensureBotSchema();
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
      const profiles = await db.prepare('SELECT id FROM trading_profiles').all() as any[];

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
      const profiles = await db.prepare('SELECT id FROM trading_profiles WHERE automation_active = 1').all() as any[];
      const { getProfileMarkets, getProfileMarketSpreads } = await import('./server/marketStore');
      
      for (const profile of profiles) {
        try {
          const spreads = getProfileMarketSpreads(profile.id);
          const marketsSnapshot = Object.fromEntries(
            getProfileMarkets(profile.id).map(m => {
              const spread = spreads[m.symbol] || { bid: m.currentPrice, ask: m.currentPrice };
              return [m.symbol, { ...m, bid: spread.bid, ask: spread.ask }];
            })
          );
          await botManagerTick(profile.id, () => marketsSnapshot);
        } catch (e: any) {
          console.error(`[BotManager] Tick error for Profile ${profile.id}:`, e.message);
        }
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

  // ── News Calendar Background Polling ──────────────────────────────────────────
  // Fetch economic calendar periodically so the News Blocker is always primed
  // even if the frontend UI is not actively open.
  getCalendarData(true).catch(e => console.warn('[Server] Initial calendar fetch failed:', e.message));
  setInterval(() => {
    getCalendarData(true).catch(e => console.warn('[Server] Background calendar fetch failed:', e.message));
  }, 6 * 60 * 60 * 1000); // Every 6 hours

  // ── (Removed legacy in-memory practice ledger) ─────────────

  // ── API Endpoints ────────────────────────────────────────────────────────────
  
  // Helper to extract active profileId for the requesting user
  async function getProfileIdFromReq(req: any): Promise<number | null> {
    const userIdCookie = req.cookies?.auth_token;
    if (!userIdCookie) return null;
    try {
      const jwtLib = await import('jsonwebtoken');
      const decoded: any = (jwtLib.default || jwtLib).verify(userIdCookie, process.env.JWT_SECRET!);
      const db = (await import('./server/db')).default;
      const profile = await db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? AND automation_active = 1 LIMIT 1').get(decoded.id) as any;
      return profile ? profile.id : null;
    } catch (e) {
      return null;
    }
  }

  app.get('/api/market', async (req, res) => {
    try {
      const { getProfileMarkets } = await import('./server/marketStore');
      const profileId = await getProfileIdFromReq(req);
      if (!profileId) return res.status(401).json({ success: false, error: 'Authentication required' });
      res.json({ success: true, data: getProfileMarkets(profileId) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: 'Internal server error: ' + e.message });
    }
  });

  app.get('/api/market/chart/:symbol', async (req, res) => {
    try {
      const { getProfileM15Candles } = await import('./server/marketStore');
      const profileId = await getProfileIdFromReq(req);
      if (!profileId) return res.status(401).json({ success: false, error: 'Authentication required' });
      
      const symbol = req.params.symbol;
      let candles = getProfileM15Candles(profileId, symbol);
      
      // If cache is empty, fetch on-demand!
      if (!candles || candles.length === 0) {
        const { getProviderForProfile, toBrokerSymbol } = await import('./server/candleProvider');
        const provider = await getProviderForProfile(profileId);
        candles = await provider.get15MinuteCandles(symbol, toBrokerSymbol(symbol), 200);
      }
      
      // Map to lightweight-charts format: { time, open, high, low, close }
      const formatted = candles.map(c => ({
        time: Math.floor(new Date(c.date || c.time).getTime() / 1000), // UNIX timestamp in seconds
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
      
      res.json({ success: true, data: formatted });
    } catch (e: any) {
      res.status(500).json({ success: false, error: 'Internal server error: ' + e.message });
    }
  });

  app.get('/api/alerts', async (req, res) => {
    try {
      const { getProfileAlerts } = await import('./server/marketStore');
      const profileId = await getProfileIdFromReq(req);
      if (!profileId) return res.status(401).json({ success: false, error: 'Authentication required' });
      res.json({ success: true, data: getProfileAlerts(profileId) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: 'Internal server error: ' + e.message });
    }
  });

  // ── Bot Engine Health Status ──────────────────────────────────────────────
  app.get('/api/bot-health', async (req, res) => {
    try {
      const profileId = await getProfileIdFromReq(req);
      if (!profileId) return res.status(401).json({ success: false, error: 'Authentication required' });
      // TODO: Ideally bot manager tracks health per-profile. 
      // Using global for now since connection errors would be isolated inside `botManagerTick`.
      const blocked = isMetaApiTradeBlocked(profileId);
      const lastConnected = metaApiLastConnected.get(profileId) || 0;
      res.json({ 
        success: true, 
        health: metaApiExecutionHealth.get(profileId) || 'offline', 
        lastConnected: lastConnected,
        pendingSignals: 0,
        missedSignals: 0,
        tradingBlocked: blocked,
        offlineSince: blocked ? (lastConnected || null) : null,
        isConnecting: isMetaApiConnecting(),
        profileId
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: 'Internal server error: ' + e.message });
    }
  });

  // ── Data-source status (Yahoo vs MetaAPI) ────────────────────────────────
  app.get('/api/data-source', async (req, res) => {
    try {
      const { getProfileActiveDataSource } = await import('./server/marketStore');
      const profileId = await getProfileIdFromReq(req);
      if (!profileId) return res.status(401).json({ success: false, error: 'Authentication required' });
      res.json({ success: true, source: getProfileActiveDataSource(profileId) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: 'Internal server error: ' + e.message });
    }
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
      if (!profileId) return res.status(401).json({ success: false, error: 'Authentication required' });
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
          const profile = await db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? LIMIT 1').get(decoded.id) as any;
          if (profile) {
            await db.prepare('UPDATE users SET metaapi_token = ? WHERE id = ?')
              .run(encrypt(token), decoded.id);
            await db.prepare('UPDATE trading_profiles SET metaapi_account_id = ? WHERE id = ? AND user_id = ?')
              .run(encrypt(account._id), profile.id, decoded.id);
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

  // ── Live Bot Status Endpoint ──────────────────────────────────────────────────
  app.get('/api/bots/live-status', async (req, res) => {
    try {
      const profileId = await getProfileIdFromReq(req);
      if (!profileId) return res.status(401).json({ success: false, error: 'Authentication required' });
      const { getProfileActiveBots } = await import('./server/botManager');
      const activeBots = await getProfileActiveBots(profileId);
      
      const db = (await import('./server/db')).default;
      // Get all open trades for this profile to map to bots
      const openTrades = await db.prepare(`SELECT bot_id, broker_symbol, direction, entry_price FROM bot_trade_states WHERE profile_id = ? AND status = 'OPEN'`).all(profileId) as any[];

      const botStatusData = activeBots.map(botId => {
        // Find if this bot has an open trade
        const trade = openTrades.find(t => t.bot_id === botId);
        if (trade) {
          return {
            id: botId,
            symbol: trade.broker_symbol,
            status: 'in_trade',
            details: `${trade.direction} from ${trade.entry_price}`
          };
        } else {
          return {
            id: botId,
            symbol: 'ANY', // Scanning all assigned symbols
            status: 'watching',
            details: 'Scanning for setups'
          };
        }
      });
      
      res.json({ success: true, data: botStatusData });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Context-Aware AI Tutor Endpoint ───────────────────────────────────────────
  app.post('/api/tutor', async (req, res) => {
    const { prompt, history } = req.body;
    try {
      const profileId = await getProfileIdFromReq(req);
      if (!profileId) return res.status(401).json({ success: false, error: 'Authentication required' });
      const { getProfileActiveBots } = await import('./server/botManager');
      const activeBots = await getProfileActiveBots(profileId);
      
      const db = (await import('./server/db')).default;
      const openTrades = await db.prepare(`SELECT bot_id, broker_symbol, direction, entry_price FROM bot_trade_states WHERE profile_id = ? AND status = 'OPEN'`).all(profileId) as any[];

      const botStatusData = activeBots.map(botId => {
        const trade = openTrades.find(t => t.bot_id === botId);
        if (trade) {
          return { id: botId, symbol: trade.broker_symbol, status: 'in_trade', details: `${trade.direction} from ${trade.entry_price}` };
        } else {
          return { id: botId, symbol: 'scanning', status: 'watching', details: 'Scanning for setups' };
        }
      });

      const response = await askTutorAgent(prompt || '', history || [], { bots: botStatusData });
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
  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`\n========================================================`);
    console.log(`🚀 Sniper Trading Analyst is running!`);
    console.log(`👉 Local Address:  http://localhost:${PORT}`);
    console.log(`👉 Network:        http://0.0.0.0:${PORT}`);
    console.log(`========================================================\n`);
  });
}

startServer();
