const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const freeFootballApi = require('../services/freeFootballApiService');

/**
 * GET /api/live
 * Su an oynanan tum maclarin listesi. Bugunun tum maclarini cekip
 * sadece "isLive: true" olanlari filtreliyoruz (bu kaynakta ayri bir
 * "sadece canlilar" endpoint'i yok).
 */
router.get('/', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const result = await cache.getOrFetch(`live:all:${today}`, config.cache.ttlLive, () =>
    freeFootballApi.getMatchesByDate(today)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Canli veri alinamadi' });
  }

  const rawMatches = result.data?.response?.matches || [];
  const simplified = rawMatches.map(freeFootballApi.transformMatch).filter(m => m.isLive);

  res.json({ matches: simplified, fromCache: result.fromCache });
});

/**
 * GET /api/live/:fixtureId
 * Tek bir mac icin canli skor bilgisi. NOT: bu kaynak sut/korner/topa
 * sahip olma gibi detayli istatistik vermiyor - o yuzden xG/momentum/
 * gole yakinlik su an icin varsayilan (0/50-50) donuyor. Skor ve takim
 * isimleri gercek ve gunceldir.
 */
router.get('/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;
  const today = new Date().toISOString().split('T')[0];

  const result = await cache.getOrFetch(`live:all:${today}`, config.cache.ttlLive, () =>
    freeFootballApi.getMatchesByDate(today)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Canli mac verisi alinamadi' });
  }

  const rawMatches = result.data?.response?.matches || [];
  const raw = rawMatches.find(m => String(m.id) === String(fixtureId));

  if (!raw) {
    return res.status(404).json({ error: 'Mac bulunamadi' });
  }

  const match = freeFootballApi.transformMatch(raw);

  res.json({
    fixtureId,
    minute: match.minute,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeLiveXg: 0,
    awayLiveXg: 0,
    momentum: { home: 50, away: 50 },
    goalProximity: { home: 0, away: 0 },
    possession: { home: 50, away: 50 },
    stats: {
      shotsOnTargetHome: 0,
      shotsOnTargetAway: 0,
      cornersHome: 0,
      cornersAway: 0,
      dangerousAttacksHome: 0,
      dangerousAttacksAway: 0,
    },
    valueAlert: { triggered: false },
    fromCache: { fixture: result.fromCache, stats: null },
  });
});

module.exports = router;
