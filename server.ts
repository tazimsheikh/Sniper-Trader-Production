import 'dotenv/config'; // FIX: Load env vars before anything else — works in production too
import express from 'express';

import { logger } from './server/utils/logger.js';

// Global error handlers to prevent "Silent Death" crashes
process.on('uncaughtException', (err) => {
  logger.error('[FATAL] Uncaught Exception:', err);
  // Optional: Send alert to monitoring system
});
process.on('unhandledRejection', (reason: any) => {
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error(`[FATAL] Unhandled Rejection: ${msg}`);
});

import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { exec } from 'child_process';
import { initNewsStore, getCalendarData, getSyntheticCalendarFallback } from './server/news/newsStore.js';
import { monitorOpenTrades, cleanClosedTrades } from './server/manager/tradeManager.js';
import { ensureMetaApiReliability } from './server/utils/ensureMetaApiReliability.js';
import { authRouter, requireAuth, authLimiter, calendarLimiter } from './server/core/auth.js';
import { settingsRouter } from './server/core/settings.js';
import http from 'http';
import { initSocket, getIO, resumePersistedBots } from './server/core/socket.js';

export const app = express();
export const httpServer = http.createServer(app);
export const io = initSocket(httpServer);

async function startServer() {
  const { initDb } = await import('./server/core/db.js');
  await initDb();

  // ── Prime Profile Names for Clean Console Output ────────────────────────────
  try {
    const { default: db } = await import('./server/core/db.js');
    const { registerProfileName } = await import('./server/utils/logger.js');
    const profiles = await db.prepare("SELECT id, profile_name FROM trading_profiles").all() as any[];
    if (profiles && profiles.length > 0) {
      for (const p of profiles) {
        if (p.id && p.profile_name) {
          registerProfileName(Number(p.id), p.profile_name);
        }
      }
    }
  } catch (e: any) {
    console.warn('[Profile Names] Failed to prime profile names on boot:', e.message);
  }

  // ── MetaAPI High-Reliability Upgrade ─────────────────────────────────────────
  // Runs once at startup. Migrates all accounts to G2 redundant infrastructure
  // so the dashboard shows "Connected (redundancy)" instead of "no redundancy".
  // Fire-and-forget: a failure here never blocks server startup.
  ensureMetaApiReliability().catch(e =>
    console.warn('[MetaAPI Reliability] Startup upgrade failed silently:', e.message)
  );

  // ── Auto-Resume Bots ─────────────────────────────────────────────────────────
  // Wait 5s for MetaAPI connection pool to stabilize, then re-launch any bots
  // that were active when the server last shut down (read from DB active_bots).
  setTimeout(() => {
    resumePersistedBots().catch(e =>
      console.warn('[AutoResume] Bot resumption failed:', e.message)
    );
  }, 5000);

  // (AlgoTrader file watcher removed)
  const PORT = process.env.PORT || 3000;

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(cookieParser()); // FIX: Required to read HttpOnly auth cookies

  // ── Auth routes ─────────────────────────────────────────────────────────────
  // ── Auth routes ─────────────────────────────────────────────────────────────
  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);

  // ── Market store init ────────────────────────────────────────────────────────

  // ── Trade Manager Loop (Break-even, Ejection, Lockout) ───────────────────────
  let isTradeManagerTicking = false;
  setInterval(async () => {
    if (isTradeManagerTicking) return;
    isTradeManagerTicking = true;
    try {
      const currentDay = new Date().toISOString().split('T')[0];
      await monitorOpenTrades(currentDay);
    } catch (e: any) {
      console.error('[TradeManager] Loop error:', e.message);
    } finally {
      isTradeManagerTicking = false;
    }
  }, 10_000); // Check open trades every 10 seconds

  // ── Database Janitor Cron ────────────────────────────────────────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('[Database Janitor] Running scheduled cleanup of closed trades...');
      await cleanClosedTrades();
    } catch (e: any) {
      console.error('[Database Janitor] Cron error:', e.message);
    }
  });

  // ── News Calendar — Resilient Infrastructure ─────────────────────────────────
  // initNewsStore() does all three things:
  //   1. Immediate fetch on startup with retry every 5 mins on failure
  //   2. Daily midnight refresh (re-fetches each new trading day)
  //   3. Guardian check every 30 mins — if cache is stale/missing, re-fetches
  initNewsStore().catch(e => console.warn('[Server] News store init failed:', e.message));

  // (AlgoTrader WFO Cron Removed)
  // ── (Removed legacy in-memory practice ledger) ─────────────

  // ── Public Health Check (unauthenticated — required for GCP health probes) ──
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // ── API Endpoints ────────────────────────────────────────────────────────────
  
  // Helper to extract active profileId for the requesting user
  async function getProfileIdFromReq(req: any): Promise<number | null> {
    const userIdCookie = req.cookies?.auth_token;
    if (!userIdCookie) return null;
    try {
      const jwtLib = await import('jsonwebtoken');
      const decoded: any = (jwtLib.default || jwtLib).verify(userIdCookie, process.env.JWT_SECRET!);
      const userId = decoded.id;
      const db = (await import('./server/core/db.js')).default;
      
      const requestedId = req.params?.profileId || req.query?.profileId || req.body?.profileId;
      if (requestedId) {
        const profile = await db.prepare('SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?').get(requestedId, userId) as any;
        if (profile) return profile.id;
      }
      
      const profile = await db.prepare('SELECT id FROM trading_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1').get(userId) as any;
      return profile ? profile.id : null;
    } catch (e) {
      return null;
    }
  }

  // (AlgoTrader Engine Health Removed)


  app.get('/api/economic-calendar', requireAuth, calendarLimiter, async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const data = await getCalendarData(forceRefresh);
      if (!Array.isArray(data) || data.length === 0) throw new Error('AI returned empty calendar data');
      res.json(data);
    } catch (err: any) {
      const synthetic = getSyntheticCalendarFallback();
      res.json(synthetic);
    }
  });

  app.post('/api/metaapi/verify', requireAuth, authLimiter, async (req, res) => {
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
      const { encrypt } = await import('./server/core/crypto.js');
      const db = (await import('./server/core/db.js')).default;
      
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

  // (AlgoTrader Live Status, Portfolio Stats, Backtester, Risk Settings Removed)

  // ── Vite dev middleware or static production handler ────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      console.log(`[Express Incoming] ${req.method} ${req.url}`);
      next();
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
      logLevel: 'error',
    });
    app.use(vite.middlewares);
    
    // Explicitly serve index.html for any unmatched route in dev mode
    app.use('*', async (req, res, next) => {
      console.log(`[Vite Middleware] Catch-all route hit for ${req.originalUrl}`);
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        console.error(`[Vite Middleware] Error serving index.html for ${req.originalUrl}:`, e);
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  // ── Global Error Handler ─────────────────────────────────────────────────────
  // Catches URIError (e.g. from malformed URLs like /%c0) and other Express errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof URIError || (err.message && err.message.includes('Failed to decode param'))) {
      return res.status(400).send('Bad Request: Invalid URI');
    }
    console.error('[Express Error]', err);
    res.status(500).send('Internal Server Error');
  });

  // ── Start listening ──────────────────────────────────────────────────────────
  httpServer.listen(Number(PORT), () => {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║  🔮 THE COVEN TRADERS${' '.repeat(32)}║`);
    console.log(`║  $$$ Ten Covens. One Goal. Max Growth $$$${' '.repeat(12)}║`);
    console.log(`╠══════════════════════════════════════════════════════╣`);
    console.log(`║  Local:    http://localhost:${PORT}${' '.repeat(21)}║`);
    console.log(`║  Network:  http://0.0.0.0:${PORT}${' '.repeat(23)}║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);
  });
}

startServer();
