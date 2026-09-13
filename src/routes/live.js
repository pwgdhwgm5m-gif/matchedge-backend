const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const footballApi = require('../services/footballApiService');
const liveXg = require('../services/liveXgService');

/**
 * GET /api/live
 * Su an oynanan tum maclarin listesi (mockup'taki "LIVE DATA" rozeti icin).
 * Kisa TTL ile cache'lenir - her istek disariya gitmez, 45 saniyede bir tazelenir.
 */
router.get('/', async (req, res) => {
  const result = await cache.getOrFetch('live:all', config.cache.ttlLive, () =>
    footballApi.getLiveFixtures()
  );

  if (!result.ok) {
    return res.status(502).json({ error: 'Canli veri alinamadi' });
  }

  res.json({ matches: result.data?.response || [], fromCache: result.fromCache });
});

/**
 * GET /api/live/:fixtureId
 * Tek bir mac icin canli skor, dakika, yaklasik xG, momentum,
 * "gole yakinlik" yuzdesi ve value alert - hepsi tek payload'da.
 * Frontend (canli-simulator.html) bu yapiyi bekliyor.
 */
router.get('/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;

  // Fikstur bilgisi (skor, dakika) ve istatistikler (sut, korner, atak)
  // birbirinden bagimsiz, ayni anda cekiliyor - biri gecikirse digerini bloklamaz
  const [fixtureResult, statsResult] = await Promise.allSettled([
    cache.getOrFetch(`live:fixture:${fixtureId}`, config.cache.ttlLive, () =>
      footballApi.getFixtureById(fixtureId)
    ),
    cache.getOrFetch(`live:stats:${fixtureId}`, config.cache.ttlLive, () =>
      footballApi.getLiveFixtureStats(fixtureId)
    ),
  ]);

  const fixtureOk = fixtureResult.status === 'fulfilled' && fixtureResult.value.ok;
  const statsOk = statsResult.status === 'fulfilled' && statsResult.value.ok;

  if (!fixtureOk && !statsOk) {
    return res.status(502).json({ error: 'Canli mac verisi alinamadi' });
  }

  const fixtureData = fixtureOk ? fixtureResult.value.data?.response?.[0] : null;
  const statsData = statsOk ? statsResult.value.data?.response || [] : [];

  const homeStats = extractStats(statsData[0]);
  const awayStats = extractStats(statsData[1]);

  const homeLiveXg = liveXg.estimateLiveXg(homeStats);
  const awayLiveXg = liveXg.estimateLiveXg(awayStats);
  const momentum = liveXg.calculateMomentum(homeStats, awayStats);
  const goalProximity = liveXg.calculateGoalProximity(homeStats, awayStats, homeLiveXg, awayLiveXg);

  // Topa sahip olma - API'den dogrudan gelen gercek veri, hesaplanmiyor
  const possession = (homeStats.possession || awayStats.possession)
    ? { home: homeStats.possession, away: awayStats.possession }
    : { home: 50, away: 50 };

  // Onceden hesaplanmis mac oncesi oran varsa (analysis endpoint'i cache'lemisse)
  // onunla karsilastirip value alert uretilir; yoksa alert atlanir.
  const precomputed = cache.get(`precomputed:${fixtureId}`);
  let valueAlert = { triggered: false };
  if (precomputed && precomputed.marketProbabilities) {
    const modelHomeProb = homeLiveXg / (homeLiveXg + awayLiveXg || 1);
    const alertCheck = liveXg.checkLiveValueAlert(
      modelHomeProb,
      precomputed.matchProbabilities?.homeWinProbability
        ? 100 / precomputed.matchProbabilities.homeWinProbability
        : 2,
      0.08
    );
    valueAlert = { triggered: alertCheck.triggered, message: alertCheck.message };
  }

  res.json({
    fixtureId,
    minute: fixtureData?.fixture?.status?.elapsed ?? null,
    homeTeam: fixtureData?.teams?.home?.name ?? null,
    awayTeam: fixtureData?.teams?.away?.name ?? null,
    homeScore: fixtureData?.goals?.home ?? 0,
    awayScore: fixtureData?.goals?.away ?? 0,
    homeLiveXg,
    awayLiveXg,
    momentum,
    goalProximity,
    possession,
    stats: {
      shotsOnTargetHome: homeStats.shotsOnTarget,
      shotsOnTargetAway: awayStats.shotsOnTarget,
      cornersHome: homeStats.corners,
      cornersAway: awayStats.corners,
      dangerousAttacksHome: homeStats.dangerousAttacks,
      dangerousAttacksAway: awayStats.dangerousAttacks,
    },
    valueAlert,
    fromCache: {
      fixture: fixtureOk ? fixtureResult.value.fromCache : null,
      stats: statsOk ? statsResult.value.fromCache : null,
    },
  });
});

/** API-Football'un istatistik formatindan bize gerekli alanlari cikarir */
function extractStats(teamStatBlock) {
  if (!teamStatBlock || !teamStatBlock.statistics) {
    return { shotsOnTarget: 0, shotsOffTarget: 0, corners: 0, dangerousAttacks: 0, possession: 0 };
  }
  const find = (type) =>
    teamStatBlock.statistics.find(s => s.type === type)?.value || 0;

  // "Ball Possession" API'den "58%" gibi string donuyor, sayiya ceviriyoruz
  const possessionRaw = find('Ball Possession');
  const possession = typeof possessionRaw === 'string'
    ? parseInt(possessionRaw.replace('%', ''), 10) || 0
    : 0;

  return {
    shotsOnTarget: find('Shots on Goal'),
    shotsOffTarget: find('Shots off Goal'),
    corners: find('Corner Kicks'),
    dangerousAttacks: find('Dangerous Attacks'),
    possession,
  };
}

module.exports = router;
