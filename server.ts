import 'dotenv/config'; // FIX: Load env vars before anything else — works in production too
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initMarketStore, updateMarketPrices, getMarkets, getAlerts, manuallyTriggerTrap, getAlertById, activeDataSource } from './server/marketStore';
import { refreshGlobalProvider } from './server/candleProvider';
import { askTutorAgent, verifySignalWithAI } from './server/tutorAgent';
import { authRouter } from './server/auth';
import { ensureBotSchema, botManagerTick } from './server/botManager';
import { validateAllBots } from './server/botValidator';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(cookieParser()); // FIX: Required to read HttpOnly auth cookies

  // ── Auth routes ─────────────────────────────────────────────────────────────
  app.use('/api/auth', authRouter);

  // ── Market store init ────────────────────────────────────────────────────────
  await validateAllBots(); // Run strict validation before starting
  await initMarketStore();
  ensureBotSchema(); // Initialize bot tables (idempotent)

  // ── Market price polling — FIX: Mutex prevents overlapping async calls ──────
  let isUpdating = false;
  let tickCount  = 0;

  setInterval(async () => {
    if (isUpdating) return; // Skip tick if previous one hasn't finished
    isUpdating = true;
    try {
      await updateMarketPrices(tickCount % 10 === 0);
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
      // Pass a snapshot of current market data into the bot engine
      const marketsSnapshot = Object.fromEntries(
        getMarkets().map(m => [m.symbol, { ...m, bid: m.currentPrice, ask: m.currentPrice }])
      );
      await botManagerTick(() => marketsSnapshot);
    } catch (e: any) {
      console.error('[BotManager] Tick error:', e.message);
    } finally {
      isBotTicking = false;
    }
  }, 30_000);

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
  app.get('/api/market', (_req, res) => {
    res.json({ success: true, data: getMarkets() });
  });

  app.get('/api/alerts', (_req, res) => {
    res.json({ success: true, data: getAlerts() });
  });

  // ── Data-source status (Yahoo vs MetaAPI) ────────────────────────────────
  app.get('/api/data-source', (_req, res) => {
    res.json({ success: true, source: activeDataSource });
  });

  // ── Trigger a data-source refresh (called after user saves MetaAPI creds) ─
  app.post('/api/refresh-data-source', async (_req, res) => {
    try {
      const newProvider = refreshGlobalProvider();
      // Re-run full market init with the newly selected provider
      await initMarketStore();
      res.json({ success: true, source: newProvider.source });
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
      const activeSignal = relatedSignalId ? getAlertById(relatedSignalId) : undefined;
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
