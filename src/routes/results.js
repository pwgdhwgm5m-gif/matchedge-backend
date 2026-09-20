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

  // NOT: gunun fikstur listesi (eventsday.php) ile gercek zamanli livescore
  // AYNI ANDA cekiliyor - liste eventsday.php'den geliyor ama canli maclarin
  // skoru/dakikasi, /api/live'in de kullandigi GUNCEL livescore kaynagiyla
  // "bindiriliyor" (asagida applyLiveOverlay). Aksi halde bu ekran, mac
  // detayina (canli simulator) gore eski/yanlis skor gosterebiliyordu.
  const [result, liveResult, verifiedResult, supplemental, sportmonksResult] = await Promise.all([
    cache.getOrFetch(
      `results:${date}`,
      config.cache.ttlLive,
      () => sportsDb.getMatchesByDate(date)
    ),
    cache.getOrFetch('live:v2:all', config.cache.ttlLive, () => sportsDb.getLiveScores()),
    cache.getOrFetch(`football-data-org:${date}`, 300, () => footballDataOrg.getMatchesByDate(date)),
    cache.getOrFetch(`cup-fixtures:${date}`, config.cache.ttlStatic, () => cupFixtures.getSupplementalMatches(date)),
    cache.getOrFetch(`odds-events:${date}`, config.cache.ttlStatic, () => oddsApi.getFixtureEventsByDate(date)),
    Promise.race([
      cache.getOrFetch(`sportmonks:date:${date}`, config.cache.ttlLive, () => sportmonks.getFixturesByDate(date)),
      new Promise(resolve => setTimeout(() => resolve({ok:false,error:'sportmonks_date_timeout'}), 2800))
    ]),
  ]);

  const rawEvents = result && result.ok ? (result.data?.events || []) : [];
  let simplified = rawEvents
    .map(sportsDb.transformEvent)
    .filter(m => sportsDb.isWhitelistedLeague(m.leagueId));

  const supplementalMatches = Array.isArray(supplemental)
    ? supplemental
    : (Array.isArray(supplemental?.matches) ? supplemental.matches : []);
  simplified = cupFixtures.mergeUnique(simplified, supplementalMatches);

  // Keep the screen usable if the primary fixture source is temporarily unavailable.
  // Odds events supply fixture identity; verified score sources below can still enrich matches.
  if (simplified.length===0 && (!result||!result.ok)) {
    const oddsFallback=await cache.getOrFetch(`odds-events:${date}`,config.cache.ttlStatic,()=>oddsApi.getFixtureEventsByDate(date));
    if(oddsFallback?.ok&&Array.isArray(oddsFallback.matches)) simplified=oddsFallback.matches;
  }

  if (liveResult.ok) {
    const rawLive = (liveResult.data?.livescore || []).filter(
      e => String(e.strSport || '').toLowerCase() === 'soccer'
    );
    simplified = sportsDb.applyLiveOverlay(simplified, rawLive);
  }

  // football-data.org is the primary score verifier for the competitions it
  // covers. It supplies explicit full-time and half-time score objects.
  // Unmatched leagues stay untouched and continue through TheSportsDB.
  if (verifiedResult.ok) {
    simplified = footballDataOrg.mergeVerifiedScores(simplified, verifiedResult.matches);
  }

  // For every league included in our SportMonks subscription, prefer its
  // verified current/full-time and first-half scores. Unsubscribed leagues
  // remain on the existing providers; no hard-coded league allow-list is needed.
  if (sportmonksResult?.ok) {
    simplified = sportmonks.enrichMatches(simplified, sportmonksResult.fixtures);
  }

  // Sonuclar ekraninda "Ilk Yari - Mac Sonu" skorunu gosterebilmek icin,
  // suresi dolmus (veya ilk yariyi gecmis canli) maclarin ilk yari skorunu
  // mac zaman cizelgesinden hesaplayip dolduruyoruz (bkz. sportsDbService).
  // Sonucu cache'lendigi icin bu sadece her mac icin ilk seferde maliyetli.
  simplified = await sportsDb.attachHalftimeScores(simplified);

  // Final HT fallback for matches that are already past half-time/finished.
  // This mirrors the live route: SportMonks/football-data/TheSportsDB stay
  // preferred, BSD is queried only when HT is still genuinely missing.
  await Promise.all(simplified.map(async m => {
    if (m.halftimeHome != null && m.halftimeAway != null) return;
    const finished = String(m.statusShort || '').toUpperCase() === 'FT';
    const pastHalf = m.isLive && Number(m.minute) > 45;
    if (!finished && !pastHalf) return;
    const ht = await Promise.race([
      bsdService.getHalftimeScoreForMatch(m.homeTeam, m.awayTeam, m.kickoff),
      new Promise(resolve => setTimeout(() => resolve({available:false}), 1800))
    ]);
    if (ht?.available) {
      m.halftimeHome = ht.home;
      m.halftimeAway = ht.away;
      m.halftimeSource = ht.source || 'bsd';
    }
  }));

  res.json({
    date,
    matches: simplified,
    fromCache: !!result?.fromCache,
    verificationSource: verifiedResult.ok ? 'football-data.org' : 'thesportsdb-fallback',
  });
});

module.exports = router;
