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
const competitionRegistry = require('../services/competitionRegistryService');

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
  const [turkeySmResult, smResult, bsdResult, sportsdbDay] = await Promise.all([
    cache.getOrFetch(`sportmonks:tr:600:${date}`, config.cache.ttlLive, () => sportmonks.getLeagueFixturesByDate(date, 600)),
    Promise.race([
      cache.getOrFetch(`sportmonks:date:${date}`, config.cache.ttlLive, () => sportmonks.getFixturesByDate(date)),
      new Promise(resolve => setTimeout(() => resolve({ok:false,error:'sportmonks_date_timeout'}), 5000))
    ]),
    cache.getOrFetch(`bsd:canonical-results:${date}`, 300, () => bsdService.getResultMatchesForDate(date)),
    cache.getOrFetch(`fixtures:${date}`,config.cache.ttlStatic,()=>sportsDb.getMatchesByDate(date))
  ]);

  const todayKey = new Date().toISOString().slice(0,10);
  const liveResult = date === todayKey
    ? await cache.getOrFetch('live:v2:all', config.cache.ttlLive, () => sportsDb.getLiveScores())
    : {ok:false,error:'not_today'};



  // BSD owns scores and results across leagues. SportMonks remains the
  // verified fallback in the six subscribed competitions.
  const smRaw=[...(turkeySmResult?.ok?turkeySmResult.fixtures:[]),...(smResult?.ok?smResult.fixtures:[])];
  const smUnique=new Map();
  for(const f of smRaw){
    const leagueName=f.leagueName||f.league||'';
    if(!sourcePolicy.resolve({leagueName})) continue;
    smUnique.set(String(f.sportmonksId||f.fixtureId),f);
  }
  const sportmonksMatches=sportmonks.toResultMatches([...smUnique.values()]).map(m=>
    competitionRegistry.decorateMatch({
      ...m, canonicalProvider:'sportmonks',
      providerIds:{...(m.providerIds||{}),sportmonks:String(m.sportmonksId||m.fixtureId||'')}
    },'sportmonks')
  );

  const bsdMatches=(bsdResult?.ok?bsdResult.matches:[])
    .map(m=>competitionRegistry.decorateMatch({
      ...m, canonicalProvider:'bsd',
      providerIds:{...(m.providerIds||{}),bsd:String(m.bsdEventId||m.fixtureId||'')}
    },'bsd'));
  const sportsdbMatches=(sportsdbDay?.ok?sportsdbDay.data?.events||[]:[])
    .filter(e=>sportsDb.isWhitelistedLeague(e.idLeague)&&
      sportsDb.isLeagueIdentityConsistent(e.idLeague,e.strLeague))
    .map(e=>sportsDb.transformEvent(e))
    .filter(m=>m?.homeTeam&&m?.awayTeam)
    .map(m=>competitionRegistry.decorateMatch({...m,canonicalProvider:'thesportsdb',
      providerIds:{...(m.providerIds||{}),sportsdb:String(m.fixtureId)}},'sportsdb'));

  // The canonical result feeds intentionally omit some competitions that are
  // present in the real-time TheSportsDB feed (notably women's cups). For
  // today's page, add only genuinely live rows that are missing from the
  // canonical list; existing rows keep their provider ownership and receive
  // the live score/clock overlay.
  const teamKey=m=>competitionRegistry.normalizeTeamIdentity(m.homeTeam)+'|'+
    competitionRegistry.normalizeTeamIdentity(m.awayTeam);
  const isCloseKickoff=(a,b)=>{
    const at=new Date(a?.kickoff||a?.date||0).getTime(),bt=new Date(b?.kickoff||b?.date||0).getTime();
    return Number.isFinite(at)&&Number.isFinite(bt)&&Math.abs(at-bt)<=6*60*60*1000;
  };
  const canonicalMatches=competitionRegistry.dedupeCompetitionFixtures(
    [...sportsdbMatches,...sportmonksMatches,...bsdMatches],{toleranceMs:6*60*60*1000,preferBsd:true});
  const liveRows=(liveResult?.ok?(liveResult.data?.livescore||[]):[])
    .filter(e=>String(e.strSport||'').toLowerCase()==='soccer')
    .map(e=>sportsDb.transformLiveEvent(e))
    .filter(m=>m?.isLive&&sportsDb.isWhitelistedLeague(m.leagueId)&&
      sportsDb.isLeagueIdentityConsistent(m.leagueId,m.league))
    .map(m=>competitionRegistry.decorateMatch({
      ...m,canonicalProvider:'thesportsdb',
      providerIds:{thesportsdb:String(m.fixtureId)},dataSource:'thesportsdb'
    },'sportsdb'));
  for(const live of liveRows){
    const index=canonicalMatches.findIndex(m=>
      m.canonicalCompetitionKey===live.canonicalCompetitionKey &&
      teamKey(m)===teamKey(live) &&
      isCloseKickoff(m,live)
    );
    if(index<0){canonicalMatches.push(live);continue;}
    const old=canonicalMatches[index];
    canonicalMatches[index]={...old,
      homeScore:old.homeScore??live.homeScore, awayScore:old.awayScore??live.awayScore,
      minute:old.minute??live.minute,
      statusShort:old.statusShort&&old.statusShort!=='NS'?old.statusShort:live.statusShort||old.statusShort,
      isLive:old.statusShort==='FT'?false:Boolean(old.isLive||live.isLive),
      providerIds:{...(live.providerIds||{}),...(old.providerIds||{})}
    };
  }
  await sportsDb.attachHalftimeScores(canonicalMatches.filter(m=>String(m.canonicalProvider||'')==='thesportsdb'));
  await bsdService.attachHalftimeScores(canonicalMatches.filter(m=>String(m.canonicalProvider||'')==='bsd'));
  const matches=canonicalMatches
    .map(m=>competitionRegistry.decorateMatch(m,m.canonicalProvider||m.source||m.dataSource))
    .sort((a,b)=>new Date(a.kickoff||a.date||0)-new Date(b.kickoff||b.date||0));
  res.json({
    date,matches,
    canonicalPolicy:'bsd-score-first-sportmonks-and-sportsdb-fallback',
    sportmonksCount:sportmonksMatches.length,
    bsdCount:bsdMatches.length,
    sportsdbFallbackCount:sportsdbMatches.length,
    liveCount:liveRows.length,
    bsdRegistryAvailable:!!bsdResult?.registryAvailable
  });
})
module.exports = router;
