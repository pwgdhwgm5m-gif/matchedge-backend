const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');

/**
 * GET /api/results?date=2026-09-09
 * Belirli bir gunun tum mac sonuclarini, sadelestirilmis formatta dondurur.
 * Canli maclar da bu listede "isLive: true" olarak gorunur.
 *
 * NOT: Eskiden freeFootballApiService kullaniyordu - o kaynak aylik
 * kotasini doldurdugu icin artik sportsDbService (TheSportsDB) kullaniyor,
 * /api/matches route'uyla ayni kaynak.
 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  // NOT: gunun fikstur listesi (eventsday.php) ile gercek zamanli livescore
  // AYNI ANDA cekiliyor - liste eventsday.php'den geliyor ama canli maclarin
  // skoru/dakikasi, /api/live'in de kullandigi GUNCEL livescore kaynagiyla
  // "bindiriliyor" (asagida applyLiveOverlay). Aksi halde bu ekran, mac
  // detayina (canli simulator) gore eski/yanlis skor gosterebiliyordu.
  const [result, liveResult] = await Promise.all([
    cache.getOrFetch(
      `results:${date}`,
      config.cache.ttlLive,
      () => sportsDb.getMatchesByDate(date)
    ),
    cache.getOrFetch('live:v2:all', config.cache.ttlLive, () => sportsDb.getLiveScores()),
  ]);

  if (!result.ok) {
    return res.status(502).json({ error: 'Sonuc verisi alinamadi' });
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
