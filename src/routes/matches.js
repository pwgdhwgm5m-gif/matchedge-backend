const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');
const cupFixtures = require('../services/cupFixtureService');
const oddsApi = require('../services/oddsApiService');

/** GET /api/matches?date=2026-09-16 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  // NOT: fikstur listesi (eventsday.php, 15dk cache) ile gercek zamanli
  // livescore AYNI ANDA cekiliyor - canli maclarin skoru/dakikasi guncel
  // livescore kaynagiyla "bindiriliyor" (bkz. results.js'deki ayni desen /
  // sportsDbService.applyLiveOverlay). Aksi halde bugunun listesindeki canli
  // bir mac, uzun cache suresi boyunca eski skorla kalabiliyordu.
  const [result, liveResult, supplemental, oddsFallback] = await Promise.all([
    cache.getOrFetch(
      `fixtures:${date}`,
      config.cache.ttlStatic,
      () => sportsDb.getMatchesByDate(date)
    ),
    cache.getOrFetch('live:v2:all', config.cache.ttlLive, () => sportsDb.getLiveScores()),
    cache.getOrFetch(`cup-fixtures:${date}`, config.cache.ttlStatic, () => cupFixtures.getSupplementalMatches(date)),
    cache.getOrFetch(`odds-events:${date}`, config.cache.ttlStatic, () => oddsApi.getFixtureEventsByDate(date)),
  ]);

  const rawEvents = result && result.ok ? (result.data?.events || []) : [];
  let simplified = rawEvents
    .map(sportsDb.transformEvent)
    .filter(m => sportsDb.isWhitelistedLeague(m.leagueId));

  // cupFixtureService dizi dondurur; eski kod bunu {ok,matches} sanip
  // supplemental fiksturleri sessizce atiyordu.
  const supplementalMatches = Array.isArray(supplemental)
    ? supplemental
    : (Array.isArray(supplemental?.matches) ? supplemental.matches : []);
  simplified = cupFixtures.mergeUnique(simplified, supplementalMatches);

  // TheSportsDB hata verirse veya whitelist sonrasi liste bos kalirsa,
  // kota harcamayan The Odds API /events verisini fikstur fallback'i olarak kullan.
  if (simplified.length === 0 && oddsFallback?.ok && Array.isArray(oddsFallback.matches)) {
    simplified = oddsFallback.matches;
  }

  if (simplified.length === 0 && (!result || !result.ok) && (!oddsFallback || !oddsFallback.ok)) {
    return res.status(502).json({ error: 'Fikstur verisi alinamadi' });
  }

  if (liveResult.ok) {
    const rawLive = (liveResult.data?.livescore || []).filter(
      e => String(e.strSport || '').toLowerCase() === 'soccer'
    );
    simplified = sportsDb.applyLiveOverlay(simplified, rawLive);
  }

  res.json({ date, matches: simplified, fromCache: !!result?.fromCache });
});

module.exports = router;
