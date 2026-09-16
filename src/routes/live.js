const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');

/**
 * GET /api/live
 * Su an oynanan tum maclarin listesi.
 * ONCE TheSportsDB'nin GERCEK canli skor endpoint'i (V2 livescore) denenir -
 * bu, gercek dakika (strProgress) ve gercek periyot (1H/HT/2H) verir.
 * Eskiden burada eventsday.php (gunun tum fikstur listesi) filtrelenerek
 * kullaniliyordu - o endpoint dakika bilgisi vermiyordu (hep null donuyordu)
 * ve "canli mi" tespiti gevsekti (dun oynanmis bitmis bir mac bile yanlislikla
 * canli gorunebiliyordu). V2 basarisiz olursa eski yontem yedek olarak devrede.
 */
router.get('/', async (req, res) => {
  const liveResult = await cache.getOrFetch('live:v2:all', config.cache.ttlLive, () =>
    sportsDb.getLiveScores()
  );

  if (liveResult.ok) {
    const rawLive = liveResult.data?.livescore || [];
    const simplified = rawLive
      .filter(e => String(e.strSport || '').toLowerCase() === 'soccer')
      .map(sportsDb.transformLiveEvent);
    return res.json({ matches: simplified, fromCache: liveResult.fromCache, source: 'livescore' });
  }

  // --- Fallback: eski yontem ---
  const today = new Date().toISOString().split('T')[0];
  const result = await cache.getOrFetch(`live:all:${today}`, config.cache.ttlLive, () =>
    sportsDb.getMatchesByDate(today)
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Canli veri alinamadi' });
  }

  const rawEvents = result.data?.events || [];
  const simplified = rawEvents.map(sportsDb.transformEvent).filter(m => m.isLive);

  res.json({ matches: simplified, fromCache: result.fromCache, source: 'eventsday-fallback' });
});

/**
 * GET /api/live/:fixtureId
 * Tek bir mac icin canli skor bilgisi. Once V2 canli skor listesinde aranir
 * (gercek dakika buradan gelir), bulunamazsa eski yontemle (eventsday.php)
 * aranir. NOT: TheSportsDB sut/korner/topa sahip olma gibi detayli istatistik
 * vermiyor - o yuzden xG/momentum/gole yakinlik su an icin varsayilan
 * (0/50-50) donuyor. Skor, dakika ve takim isimleri gercek ve gunceldir.
 */
router.get('/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;

  const liveResult = await cache.getOrFetch('live:v2:all', config.cache.ttlLive, () =>
    sportsDb.getLiveScores()
  );

  let match = null;
  let fromCacheFlag = false;

  if (liveResult.ok) {
    const rawLive = liveResult.data?.livescore || [];
    const rawMatch = rawLive.find(e => String(e.idEvent) === String(fixtureId));
    if (rawMatch) {
      match = sportsDb.transformLiveEvent(rawMatch);
      fromCacheFlag = liveResult.fromCache;
    }
  }

  if (!match) {
    const today = new Date().toISOString().split('T')[0];
    const result = await cache.getOrFetch(`live:all:${today}`, config.cache.ttlLive, () =>
      sportsDb.getMatchesByDate(today)
    );

    if (result.ok) {
      const rawEvents = result.data?.events || [];
      const raw = rawEvents.find(e => String(e.idEvent) === String(fixtureId));
      if (raw) {
        match = sportsDb.transformEvent(raw);
        fromCacheFlag = result.fromCache;
      }
    }
  }

  if (!match) {
    return res.status(404).json({ error: 'Mac bulunamadi' });
  }

  res.json({
    fixtureId,
    minute: match.minute,
    statusShort: match.statusShort,
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
    fromCache: { fixture: fromCacheFlag, stats: null },
  });
});

module.exports = router;
