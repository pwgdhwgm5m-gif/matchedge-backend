const express = require('express');
const cors = require('cors');
const config = require('./config/config');
const { connectDB } = require('./db');

const matchesRoute = require('./routes/matches');
const analysisRoute = require('./routes/analysis');
const liveRoute = require('./routes/live');
const oddsHistoryRoute = require('./routes/oddsHistory');
const resultsRoute = require('./routes/results');
const authRoute = require('./routes/auth');
const notesRoute = require('./routes/notes');
const favoritesRoute = require('./routes/favorites');
const { startPrecomputeCron, startKeepAlive, startOddsSnapshotCron } = require('./cron/precomputeJob');

const app = express();

app.use(cors());
app.use(express.json());

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
app.use('/api/matches', matchesRoute);
app.use('/api/analysis', analysisRoute);
app.use('/api/live', liveRoute);
app.use('/api/odds-history', oddsHistoryRoute);
app.use('/api/results', resultsRoute);
const tffScraper = require('./services/tffScraper');

app.get('/test-tff-standings', async (req, res) => {
  try {
    const data = await tffScraper.getStandings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.use((err, req, res, next) => {
  console.error('[server] Beklenmeyen hata:', err);
  res.status(500).json({ error: 'Sunucu hatasi' });
});

app.listen(config.port, async () => {
  console.log(`MatchEdge backend ${config.port} portunda calisiyor (${config.nodeEnv})`);
  await connectDB();
  startPrecomputeCron();
  startOddsSnapshotCron();
  startKeepAlive();
});
