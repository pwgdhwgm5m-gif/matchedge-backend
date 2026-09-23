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

  const todayKey = new Date().toISOString().slice(0,10);
  const liveResult = date === todayKey
    ? await cache.getOrFetch('live:v2:all', config.cache.ttlLive, () => sportsDb.getLiveScores())
    : {ok:false,error:'not_today'};



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

  // The canonical result feeds intentionally omit some competitions that are
  // present in the real-time TheSportsDB feed (notably women's cups). For
  // today's page, add only genuinely live rows that are missing from the
  // canonical list; existing rows keep their provider ownership and receive
  // the live score/clock overlay.
  const normTeam=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const teamKey=m=>normTeam(m.homeTeam)+'|'+normTeam(m.awayTeam);
  const isCloseKickoff=(a,b)=>{
    const at=new Date(a?.kickoff||a?.date||0).getTime(),bt=new Date(b?.kickoff||b?.date||0).getTime();
    return Number.isFinite(at)&&Number.isFinite(bt)&&Math.abs(at-bt)<=6*60*60*1000;
  };
  const canonicalMatches=[...sportmonksMatches,...bsdMatches];
  const liveRows=(liveResult?.ok?(liveResult.data?.livescore||[]):[])
    .filter(e=>String(e.strSport||'').toLowerCase()==='soccer')
    .map(e=>sportsDb.transformLiveEvent(e))
    .filter(m=>m?.isLive)
    .map(m=>({...m,canonicalProvider:'thesportsdb',providerIds:{thesportsdb:String(m.fixtureId)},dataSource:'thesportsdb'}));
  for(const live of liveRows){
    const index=canonicalMatches.findIndex(m=>
      (String(m.canonicalProvider||'')==='thesportsdb' && String(m.fixtureId)===String(live.fixtureId)) ||
      (teamKey(m)===teamKey(live) && isCloseKickoff(m,live))
    );
    if(index<0){canonicalMatches.push(live);continue;}
    const old=canonicalMatches[index];
    canonicalMatches[index]={...old,
      homeScore:live.homeScore??old.homeScore, awayScore:live.awayScore??old.awayScore,
      minute:live.minute??old.minute, statusShort:live.statusShort||old.statusShort,
      isLive:true
    };
  }
  const matches=canonicalMatches.sort((a,b)=>new Date(a.kickoff||a.date||0)-new Date(b.kickoff||b.date||0));
  res.json({
    date,matches,
    canonicalPolicy:'sportmonks-6-else-bsd-plus-today-live',
    sportmonksCount:sportmonksMatches.length,
    bsdCount:bsdMatches.length,
    liveCount:liveRows.length,
    bsdRegistryAvailable:!!bsdResult?.registryAvailable
  });
})
module.exports = router;
