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
router.get('/sportmonks-turkey-diagnostic', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const result = await sportmonks.getLeagueFixturesByDate(date, 600);
  return res.json({
    date, leagueId:600, ok:!!result?.ok, error:result?.error||null,
    count:result?.fixtures?.length||0,
    fixtures:(result?.fixtures||[]).map(f=>({
      id:f.sportmonksId, leagueId:f.leagueId, league:f.leagueName,
      home:f.homeTeam, away:f.awayTeam, homeScore:f.homeScore, awayScore:f.awayScore,
      halftimeHome:f.halftimeHome, halftimeAway:f.halftimeAway,
      stateId:f.stateId, statusShort:f.statusShort
    }))
  });
});

router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const normTeam = value => String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i')
    .replace(/\b(fc|cf|afc|sc|fk|sk|ac|as)\b/g,'')
    .replace(/spor$/g,'').replace(/[^a-z0-9]/g,'');
  const sameMatch = (a,b) => normTeam(a.homeTeam)===normTeam(b.homeTeam) && normTeam(a.awayTeam)===normTeam(b.awayTeam);

  // SportsMonks-first: one subscribed daily feed is the canonical fixture,
  // score and half-time source. Legacy providers are used only when a
  // SportMonks match is unavailable; they never overwrite SportMonks data.
  const season=sportsDb.getCurrentSeasonString(new Date(date+'T12:00:00Z'));
  const [turkeySmResult, smResult, legacyResult, verifiedResult, supplemental, bsdResult, faCupSchedule] = await Promise.all([
    cache.getOrFetch(`sportmonks:tr:600:${date}`, config.cache.ttlLive, () => sportmonks.getLeagueFixturesByDate(date, 600)),
    Promise.race([
      cache.getOrFetch(`sportmonks:date:${date}`, config.cache.ttlLive, () => sportmonks.getFixturesByDate(date)),
      new Promise(resolve => setTimeout(() => resolve({ok:false,error:'sportmonks_date_timeout'}), 5000))
    ]),
    cache.getOrFetch(`results:${date}`, config.cache.ttlLive, () => sportsDb.getMatchesByDate(date)),
    cache.getOrFetch(`football-data-org:${date}`, 300, () => footballDataOrg.getMatchesByDate(date)),
    cache.getOrFetch(`cup-fixtures:${date}`, config.cache.ttlStatic, () => cupFixtures.getSupplementalMatches(date)),
    cache.getOrFetch(`bsd:results:${date}`, 300, () => bsdService.getResultMatchesForDate(date)),
    // eventsday can omit FA Cup qualifying/replays. The league-season schedule
    // is a separate TSDB source and is filtered back to the requested day.
    cache.getOrFetch(`sportsdb:facup:4482:${season}`, 1800, () => sportsDb.getLeagueSeasonScheduleFormatted(4482, season))
  ]);

  console.log('[results:sportmonks:turkey]', JSON.stringify({
    date,
    ok: !!turkeySmResult?.ok,
    error: turkeySmResult?.error || null,
    count: turkeySmResult?.fixtures?.length || 0,
    fixtures: (turkeySmResult?.fixtures || []).map(f => ({
      id:f.sportmonksId, leagueId:f.leagueId, league:f.leagueName,
      home:f.homeTeam, away:f.awayTeam, homeScore:f.homeScore, awayScore:f.awayScore,
      halftimeHome:f.halftimeHome, halftimeAway:f.halftimeAway, stateId:f.stateId
    }))
  }));
  const allSmFixtures = [...(turkeySmResult?.ok ? turkeySmResult.fixtures : []), ...(smResult?.ok ? smResult.fixtures : [])];
  const uniqueSm = new Map(allSmFixtures.map(f => [String(f.sportmonksId), f]));
  const sportmonksMatches = sportmonks.toResultMatches([...uniqueSm.values()]);
  let legacyMatches = legacyResult?.ok
    ? (legacyResult.data?.events || []).map(sportsDb.transformEvent).filter(m => sportsDb.isWhitelistedLeague(m.leagueId) && sportsDb.isLeagueIdentityConsistent(m.leagueId, m.league))
    : [];

  // Only fill fixtures absent from SportsMonks. Do not let legacy score/HT
  // fields overwrite a subscribed SportMonks fixture.
  let simplified = cupFixtures.mergeUnique(sportmonksMatches, legacyMatches);
  const supplementalMatches = Array.isArray(supplemental)
    ? supplemental : (Array.isArray(supplemental?.matches) ? supplemental.matches : []);
  simplified = cupFixtures.mergeUnique(simplified, supplementalMatches);

  // BSD is the broad result fallback, especially for cups/lower leagues that
  // are outside the six SportMonks subscriptions. SportMonks rows stay first
  // and therefore authoritative when the same fixture exists in both feeds.
  const bsdMatches = bsdResult?.ok && Array.isArray(bsdResult.matches) ? bsdResult.matches : [];
  simplified = cupFixtures.mergeUnique(simplified, bsdMatches);

  const faCupMatches = faCupSchedule?.available ? faCupSchedule.events.filter(e=>String(e.date||'').slice(0,10)===date).map(e=>({
    ...e, league:'FA Cup', leagueId:'4482', statusShort:e.finished?'FT':'NS', isLive:false,
    source:'sportsdb-fa-cup-season'
  })) : [];
  simplified = cupFixtures.mergeUnique(simplified, faCupMatches);

  // football-data.org is fallback verification only for matches that did not
  // arrive from SportMonks.
  if (verifiedResult?.ok) {
    const smIds = new Set(sportmonksMatches.map(m => String(m.sportmonksId || '')));
    const fallback = simplified.filter(m => !smIds.has(String(m.sportmonksId || '')));
    const verified = footballDataOrg.mergeVerifiedScores(fallback, verifiedResult.matches);
    let vi=0;
    simplified = simplified.map(m => smIds.has(String(m.sportmonksId || '')) ? m : verified[vi++]);
  }

  // The Turkish scoreboard must never become incomplete merely because
  // SportMonks daily entitlement returned only part of league 600. The legacy
  // fixture feed is already loaded above, so restore any missing Turkish
  // fixtures by team identity while keeping SportMonks authoritative where it
  // exists.
  const turkishLegacy = legacyMatches.filter(m =>
    String(m.leagueId || '') === '4339' || /turk|super lig|süper lig/i.test(String(m.league || m.leagueName || ''))
  );
  for (const m of turkishLegacy) {
    if (!simplified.some(x => sameMatch(x,m))) simplified.push(m);
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
    primarySource: (turkeySmResult?.ok || smResult?.ok) ? 'sportmonks' : 'fallback',
    sportmonksCount: sportmonksMatches.length,
    fallbackCount: Math.max(0, simplified.length - sportmonksMatches.length),
    bsdCount: bsdMatches.length,
    faCupScheduleCount: faCupMatches.length
  });
});
module.exports = router;
