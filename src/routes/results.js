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
const sourcePolicy = require('../services/sourcePolicyService');

/**
 * GET /api/results?date=2026-09-09
 * Belirli bir gunun tum mac sonuclarini, sadelestirilmis formatta dondurur.
 * Canli maclar da bu listede "isLive: true" olarak gorunur.
 *
 * NOT: Eskiden freeFootballApiService kullaniyordu - o kaynak aylik
 * kotasini doldurdugu icin artik sportsDbService (TheSportsDB) kullaniyor,
 * /api/matches route'uyla ayni kaynak.
 */
// BSD v2 production diagnostic; deliberately never returns API credentials.
router.get('/bsd-diagnostic', async (req,res)=>{ try { const date=String(req.query.date||new Date().toISOString().slice(0,10)); res.json(await bsdService.diagnostic(date)); } catch(e){ res.status(500).json({ok:false,error:e.message}); } });

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
  const [turkeySmResult, smResult, bsdResult] = await Promise.all([
    cache.getOrFetch(`sportmonks:tr:600:${date}`, config.cache.ttlLive, () => sportmonks.getLeagueFixturesByDate(date, 600)),
    Promise.race([
      cache.getOrFetch(`sportmonks:date:${date}`, config.cache.ttlLive, () => sportmonks.getFixturesByDate(date)),
      new Promise(resolve => setTimeout(() => resolve({ok:false,error:'sportmonks_date_timeout'}), 5000))
    ]),
    cache.getOrFetch(`bsd:canonical-results:${date}`, 300, () => bsdService.getResultMatchesForDate(date))
  ]);

  // Canonical ownership is intentionally strict:
  // six subscribed leagues => SportMonks; every other competition => BSD v2.
  const smRaw=[...(turkeySmResult?.ok?turkeySmResult.fixtures:[]),...(smResult?.ok?smResult.fixtures:[])];
  const smUnique=new Map();
  for(const f of smRaw){
    const leagueName=f.leagueName||f.league||'';
    if(!sourcePolicy.resolve({leagueName})) continue;
    smUnique.set(String(f.sportmonksId||f.fixtureId),f);
  }
  const sportmonksMatches=sportmonks.toResultMatches([...smUnique.values()]).map(m=>({
    ...m, canonicalProvider:'sportmonks',
    providerIds:{...(m.providerIds||{}),sportmonks:String(m.sportmonksId||m.fixtureId||'')}
  }));

  const bsdMatches=(bsdResult?.ok?bsdResult.matches:[]).filter(m=>!sourcePolicy.isBsdCoreLeague({leagueName:m.league,country:m.leagueCountry})).map(m=>({
    ...m, canonicalProvider:'bsd',
    providerIds:{...(m.providerIds||{}),bsd:String(m.bsdEventId||m.fixtureId||'')}
  }));

  const matches=[...sportmonksMatches,...bsdMatches].sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));
  res.json({
    date,matches,
    canonicalPolicy:'sportmonks-6-else-bsd',
    sportmonksCount:sportmonksMatches.length,
    bsdCount:bsdMatches.length,
    bsdRegistryAvailable:!!bsdResult?.registryAvailable
  });
})
module.exports = router;
