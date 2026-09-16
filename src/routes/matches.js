const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');

/** GET /api/matches?date=2026-09-16 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  // NOT: fikstur listesi (eventsday.php, 15dk cache) ile gercek zamanli
  // livescore AYNI ANDA cekiliyor - canli maclarin skoru/dakikasi guncel
  // livescore kaynagiyla "bindiriliyor" (bkz. results.js'deki ayni desen /
  // sportsDbService.applyLiveOverlay). Aksi halde bugunun listesindeki canli
  // bir mac, uzun cache suresi boyunca eski skorla kalabiliyordu.
  const [result, liveResult] = await Promise.all([
    cache.getOrFetch(
      `fixtures:${date}`,
      config.cache.ttlStatic,
      () => sportsDb.getMatchesByDate(date)
    ),
    cache.getOrFetch('live:v2:all', config.cache.ttlLive, () => sportsDb.getLiveScores()),
  ]);

  if (!result.ok) {
    return res.status(502).json({ error: 'Fikstur verisi alinamadi' });
  }

  const rawEvents = result.data?.events || [];
  let simplified = rawEvents
    .map(sportsDb.transformEvent)
    .filter(m => sportsDb.isWhitelistedLeague(m.leagueId));

  if (liveResult.ok) {
    const rawLive = (liveResult.data?.livescore || []).filter(
      e => String(e.strSport || '').toLowerCase() === 'soccer'
    );
    simplified = sportsDb.applyLiveOverlay(simplified, rawLive);
  }

  res.json({ date, matches: simplified, fromCache: result.fromCache });
});

module.exports = router;
