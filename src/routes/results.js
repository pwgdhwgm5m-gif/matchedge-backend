const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');
const footballDataOrg = require('../services/footballDataOrgService');
const cupFixtures = require('../services/cupFixtureService');
const oddsApi = require('../services/oddsApiService');
const sportmonks = require('../services/sportmonksService');
const bsdService = require('../services/bsdService');

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

  // SportsMonks-first: one subscribed daily feed is the canonical fixture,
  // score and half-time source. Legacy providers are used only when a
  // SportMonks match is unavailable; they never overwrite SportMonks data.
  const [smResult, legacyResult, verifiedResult, supplemental] = await Promise.all([
    Promise.race([
      cache.getOrFetch(`sportmonks:date:${date}`, config.cache.ttlLive, () => sportmonks.getFixturesByDate(date)),
      new Promise(resolve => setTimeout(() => resolve({ok:false,error:'sportmonks_date_timeout'}), 5000))
    ]),
    cache.getOrFetch(`results:${date}`, config.cache.ttlLive, () => sportsDb.getMatchesByDate(date)),
    cache.getOrFetch(`football-data-org:${date}`, 300, () => footballDataOrg.getMatchesByDate(date)),
    cache.getOrFetch(`cup-fixtures:${date}`, config.cache.ttlStatic, () => cupFixtures.getSupplementalMatches(date))
  ]);

  const sportmonksMatches = smResult?.ok ? sportmonks.toResultMatches(smResult.fixtures) : [];
  let legacyMatches = legacyResult?.ok
    ? (legacyResult.data?.events || []).map(sportsDb.transformEvent).filter(m => sportsDb.isWhitelistedLeague(m.leagueId))
    : [];

  // Only fill fixtures absent from SportsMonks. Do not let legacy score/HT
  // fields overwrite a subscribed SportMonks fixture.
  let simplified = cupFixtures.mergeUnique(sportmonksMatches, legacyMatches);
  const supplementalMatches = Array.isArray(supplemental)
    ? supplemental : (Array.isArray(supplemental?.matches) ? supplemental.matches : []);
  simplified = cupFixtures.mergeUnique(simplified, supplementalMatches);

  // football-data.org is fallback verification only for matches that did not
  // arrive from SportMonks.
  if (verifiedResult?.ok) {
    const smIds = new Set(sportmonksMatches.map(m => String(m.sportmonksId || '')));
    const fallback = simplified.filter(m => !smIds.has(String(m.sportmonksId || '')));
    const verified = footballDataOrg.mergeVerifiedScores(fallback, verifiedResult.matches);
    let vi=0;
    simplified = simplified.map(m => smIds.has(String(m.sportmonksId || '')) ? m : verified[vi++]);
  }

  // HT fallback is deliberately restricted to non-SportMonks fixtures.
  const nonSm = simplified.filter(m => !m.sportmonksId);
  if (nonSm.length) {
    const enriched = await sportsDb.attachHalftimeScores(nonSm);
    let ei=0;
    simplified = simplified.map(m => m.sportmonksId ? m : enriched[ei++]);
  }

  res.json({
    date,
    matches: simplified,
    primarySource: smResult?.ok ? 'sportmonks' : 'fallback',
    sportmonksCount: sportmonksMatches.length,
    fallbackCount: Math.max(0, simplified.length - sportmonksMatches.length)
  });
});
module.exports = router;
