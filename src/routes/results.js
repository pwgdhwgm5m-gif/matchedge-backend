const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');
const footballDataOrg = require('../services/footballDataOrgService');
const cupFixtures = require('../services/cupFixtureService');
const sportmonks = require('../services/sportmonksService');

const normTeam = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i')
  .replace(/\b(fc|cf|afc|sc|fk|sk|ac|as)\b/g,'')
  .replace(/spor$/g,'').replace(/[^a-z0-9]/g,'');

const matchKey = m => normTeam(m.homeTeam) + '|' + normTeam(m.awayTeam);

function validMatch(m) {
  return !!(m && m.homeTeam && m.awayTeam);
}

function mergeMissing(primary, fallback) {
  const out = (primary || []).filter(validMatch);
  const seen = new Set(out.map(matchKey));
  for (const m of (fallback || []).filter(validMatch)) {
    const key = matchKey(m);
    if (!seen.has(key)) { seen.add(key); out.push(m); }
  }
  return out;
}

/**
 * Scores pipeline, deliberately simple:
 * 1. SportMonks daily fixtures are canonical.
 * 2. TheSportsDB only supplies matches absent from SportMonks.
 * 3. Supplemental/cup feed only supplies matches still absent.
 * 4. football-data.org may verify/enrich fallback rows only.
 * A fallback provider can never replace a SportMonks score, status or HT.
 */
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);

  const [smResult, legacyResult, supplementalResult, verifiedResult] = await Promise.all([
    cache.getOrFetch('scores:sm:'+date, config.cache.ttlLive, () => sportmonks.getFixturesByDate(date)),
    cache.getOrFetch('scores:legacy:'+date, config.cache.ttlLive, () => sportsDb.getMatchesByDate(date)),
    cache.getOrFetch('scores:supplemental:'+date, config.cache.ttlStatic, () => cupFixtures.getSupplementalMatches(date)),
    cache.getOrFetch('scores:verified:'+date, 300, () => footballDataOrg.getMatchesByDate(date))
  ]);

  const smMatches = smResult?.ok ? sportmonks.toResultMatches(smResult.fixtures || []) : [];
  const legacyMatches = legacyResult?.ok
    ? (legacyResult.data?.events || []).map(sportsDb.transformEvent).filter(m => sportsDb.isWhitelistedLeague(m.leagueId))
    : [];
  const supplementalMatches = Array.isArray(supplementalResult)
    ? supplementalResult : (Array.isArray(supplementalResult?.matches) ? supplementalResult.matches : []);

  let fallback = mergeMissing(legacyMatches, supplementalMatches);

  // Enrich only fallback rows. SportMonks remains untouched.
  if (verifiedResult?.ok && fallback.length) {
    fallback = footballDataOrg.mergeVerifiedScores(fallback, verifiedResult.matches);
  }
  if (fallback.length) fallback = await sportsDb.attachHalftimeScores(fallback);

  const matches = mergeMissing(smMatches, fallback);

  res.set('Cache-Control','no-store');
  return res.json({
    date,
    matches,
    primarySource: smMatches.length ? 'sportmonks' : 'fallback',
    sportmonksCount: smMatches.length,
    fallbackCount: Math.max(0, matches.length-smMatches.length),
    sourceOrder: ['sportmonks','thesportsdb','supplemental','football-data-org']
  });
});

module.exports = router;
