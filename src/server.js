const express = require('express');
const cors = require('cors');
const config = require('./config/config');
const { connectDB } = require('./db');
const { bootstrapAdmin } = require('./services/adminBootstrapService');

const matchesRoute = require('./routes/matches');
const analysisRoute = require('./routes/analysis');
const liveRoute = require('./routes/live');
const oddsHistoryRoute = require('./routes/oddsHistory');
const resultsRoute = require('./routes/results');
const marketOddsRoute = require('./routes/marketOdds');
const authRoute = require('./routes/auth');
const notesRoute = require('./routes/notes');
const favoritesRoute = require('./routes/favorites');
const adminRoute = require('./routes/admin');
const couponsRoute = require('./routes/coupons');
const chatRoute = require('./routes/chat');
const communityRoute = require('./routes/community');
const matchRoomRoute = require('./routes/matchRoom');
const messagesRoute = require('./routes/messages');
const pushRoute = require('./routes/push');
const { startPushGoalMonitor } = require('./services/pushGoalService');
const { startPrecomputeCron, startKeepAlive, startOddsSnapshotCron } = require('./cron/precomputeJob');

const app = express();
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.get('/admin', (req, res) => res.sendFile(require('path').join(process.cwd(), 'public', 'admin.html')));

// Basit istek loglama - performans sorunlarini gozlemlemek icin
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${Date.now() - start}ms`);
  });
  next();
});

// Keep-alive ping'in hedef aldigi endpoint - cok hafif olmali
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoute);
app.use('/api/notes', notesRoute);
app.use('/api/favorites', favoritesRoute);
app.use('/api/admin', adminRoute);
app.use('/api/coupons', couponsRoute);
app.use('/api/chat', chatRoute);
app.use('/api/community', communityRoute);
app.use('/api/match-room', matchRoomRoute);
app.use('/api/messages', messagesRoute);
app.use('/api/push', pushRoute);
app.use('/api/matches', matchesRoute);
app.use('/api/analysis', analysisRoute);
app.use('/api/live', liveRoute);
app.use('/api/odds-history', oddsHistoryRoute);
app.use('/api/results', resultsRoute);
app.use('/api/market-odds', marketOddsRoute);
app.get('/run-backfill', async (req, res) => {
  const providedSecret = req.headers['x-backfill-secret'] || req.query.secret;
  if (!config.backfillSecret || providedSecret !== config.backfillSecret) {
    return res.status(401).json({ error: 'Yetkisiz - gecerli backfill secret gerekli.' });
  }

  res.json({ status: 'started', message: 'Backfill arka planda calisiyor, loglardan takip et' });

  try {
    const { runBackfill } = require('./scripts/backfillMatches');
    await runBackfill();
    console.log('[backfill] Tamamlandi');
  } catch (err) {
    console.error('[backfill] Hata:', err.message);
  }
});

app.use((err, req, res, next) => {
  console.error('[server] Beklenmeyen hata:', err);
  res.status(500).json({ error: 'Sunucu hatasi' });
});

app.listen(config.port, async () => {
  console.log(`SoccerEdge Pro backend ${config.port} portunda calisiyor (${config.nodeEnv})`);
  await connectDB();
  try {
    await bootstrapAdmin();
  } catch (error) {
    console.error('[admin-bootstrap] Provisioning failed:', error.message);
  }
  startPrecomputeCron();
  startOddsSnapshotCron();
  startKeepAlive();
  startPushGoalMonitor();
  // CoinEdge coupons are settled in the background even if the user never opens Kuponum.
  const settleCoupons = async () => {
    try {
      const checked = await couponsRoute.settleAllPendingCoupons();
      if (checked) console.log('[coupons/auto-settle] users checked:', checked);
    } catch (error) {
      console.warn('[coupons/auto-settle]', error.message);
    }
  };
  setTimeout(settleCoupons, 30000);
  setInterval(settleCoupons, 10 * 60 * 1000);
});
