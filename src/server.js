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
const adminPasskeyRoute = require('./routes/adminPasskey');
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
app.use('/api/admin-passkey', adminPasskeyRoute);
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
  // One-shot, credential-safe BSD v2 production smoke test on boot.
  setTimeout(async()=>{try{const bsd=require('./services/bsdService');const d=await bsd.diagnostic('2026-09-22');console.log('[bsd-v2-diagnostic]',JSON.stringify(d));}catch(e){console.warn('[bsd-v2-diagnostic]',e.message)}},15000);
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

  // Delete finished slips every day at 00:00 Europe/Istanbul.
  // Render runs in UTC, so calculate the next Istanbul midnight explicitly
  // (Turkey stays UTC+3 year-round) and reschedule after every run.
  const scheduleCouponMidnightCleanup = () => {
    const now = new Date();
    const istanbulNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const nextIstanbulMidnightUtc = Date.UTC(
      istanbulNow.getUTCFullYear(),
      istanbulNow.getUTCMonth(),
      istanbulNow.getUTCDate() + 1,
      0, 0, 0
    ) - 3 * 60 * 60 * 1000;
    const delay = Math.max(1000, nextIstanbulMidnightUtc - now.getTime());
    setTimeout(async () => {
      try {
        const deleted = await couponsRoute.cleanupFinishedCoupons();
        console.log('[coupons/midnight-cleanup] finished coupons deleted:', deleted);
      } catch (error) {
        console.warn('[coupons/midnight-cleanup]', error.message);
      } finally {
        scheduleCouponMidnightCleanup();
      }
    }, delay);
  };
  scheduleCouponMidnightCleanup();
  // Verified community picks settle independently from coupons. Analyst accuracy,
  // streak and tier source fields are rebuilt only from settled Verified Picks.
  const settleVerifiedPicks=async()=>{try{const svc=require('./services/communityPickSettlementService');const result=await svc.settlePending();if(result.settled)console.log('[verified-picks/auto-settle]',JSON.stringify(result))}catch(error){console.warn('[verified-picks/auto-settle]',error.message)}};
  setTimeout(async()=>{try{const svc=require('./services/communityPickSettlementService');const rebuilt=await svc.rebuildAllAnalystStats();console.log('[verified-picks/stats-rebuild] users:',rebuilt)}catch(error){console.warn('[verified-picks/stats-rebuild]',error.message)}await settleVerifiedPicks()}, 60000);
  setInterval(settleVerifiedPicks, 10 * 60 * 1000);

  // Prediction ledger settlement also trains persistent Elo/attack/defence ratings.
  const settlePredictions = async () => {
    try {
      const ledger=require('./services/predictionLedgerService');
      const settled=await ledger.settlePending();
      if(settled) {
        console.log('[prediction-ledger/auto-settle]',settled,'fixtures settled and power ratings updated');
        const calibration=require('./services/modelCalibrationService');
        const trained=await calibration.retrain();
        const rollback=await calibration.deactivateStaleOrRegressed();
        console.log('[model-calibration/after-settlement]',JSON.stringify({...trained,rollback}));
      }
    } catch(error){ console.warn('[prediction-ledger/auto-settle]',error.message); }
  };
  setTimeout(settlePredictions, 45000);
  setInterval(settlePredictions, 15 * 60 * 1000);
  // Prospectively tag future fixtures selected by Coupon V4. These tags are written before kickoff
  // and are later graded only after the prediction ledger settles the fixture.
  const captureV4Validation=async()=>{try{const premium=require('./services/premiumLabService');const r=await premium.captureValidation();if(r.tagged)console.log('[premium-v4/validation-capture]',JSON.stringify(r))}catch(error){console.warn('[premium-v4/validation-capture]',error.message)}};
  setTimeout(captureV4Validation, 90000);
  setInterval(captureV4Validation, 6 * 60 * 60 * 1000);
});
