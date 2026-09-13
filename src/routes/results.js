const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const footballApi = require('../services/footballApiService');

/**
 * GET /api/results?date=2026-09-09
 * Belirli bir gunun tum mac sonuclarini, ilk yari skoru dahil,
 * sadelestirilmis formatta dondurur. Canli maclar da bu listede
 * "status: LIVE" olarak gorunur, frontend ayirt edip farkli gosterir.
 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const result = await cache.getOrFetch(
    `results:${date}`,
    // Canli maclar oldugu icin gunun verisini kisa TTL ile tutuyoruz,
    // gecmis gunler icin bu onemli degil (zaten degismiyor) ama
    // basitlik icin tek TTL kullaniyoruz.
    config.cache.ttlLive,
    () => footballApi.getFixturesByDate(date)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Sonuc verisi alinamadi' });
  }

  const fixtures = result.data?.response || [];

  const simplified = fixtures.map(f => ({
    fixtureId: f.fixture.id,
    league: f.league.name,
    leagueCountry: f.league.country,
    kickoff: f.fixture.date,
    statusShort: f.fixture.status.short, // NS, 1H, HT, 2H, FT, vs.
    minute: f.fixture.status.elapsed,
    isLive: ['1H', 'HT', '2H', 'ET', 'P', 'BT'].includes(f.fixture.status.short),
    homeTeam: f.teams.home.name,
    awayTeam: f.teams.away.name,
    homeCrest: f.teams.home.logo,
    awayCrest: f.teams.away.logo,
    homeScore: f.goals.home,
    awayScore: f.goals.away,
    halftimeHome: f.score.halftime.home,
    halftimeAway: f.score.halftime.away,
  }));

  res.json({ date, matches: simplified, fromCache: result.fromCache });
});

module.exports = router;
