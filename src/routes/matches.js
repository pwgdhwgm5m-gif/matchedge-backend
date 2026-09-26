const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');
const cupFixtures = require('../services/cupFixtureService');
const oddsApi = require('../services/oddsApiService');
const sportmonks = require('../services/sportmonksService');
const bsdService = require('../services/bsdService');
const sourcePolicy = require('../services/sourcePolicyService');
const competitionRegistry = require('../services/competitionRegistryService');

/** GET /api/matches?date=YYYY-MM-DD
 * Fixture coverage stays broad. Provider ownership is applied as an overlay,
 * not as a destructive whitelist: SportMonks is authoritative for the six
 * subscribed leagues, BSD is preferred outside them, and the proven legacy
 * fixture feeds remain coverage fallbacks.
 */
router.get('/', async (req,res)=>{
  const date=req.query.date||new Date().toISOString().split('T')[0];
  const [legacy,live,supplemental,oddsEvents,turkeySm,smDay,bsdDay,bsdLive]=await Promise.all([
    cache.getOrFetch(`fixtures:${date}`,config.cache.ttlStatic,()=>sportsDb.getMatchesByDate(date)),
    cache.getOrFetch('live:v2:all',config.cache.ttlLive,()=>sportsDb.getLiveScores()),
    cache.getOrFetch(`cup-fixtures:${date}`,config.cache.ttlStatic,()=>cupFixtures.getSupplementalMatches(date)),
    cache.getOrFetch(`odds-events:${date}`,config.cache.ttlStatic,()=>oddsApi.getFixtureEventsByDate(date)),
    cache.getOrFetch(`sportmonks:tr:600:${date}`,config.cache.ttlLive,()=>sportmonks.getLeagueFixturesByDate(date,600)),
    Promise.race([cache.getOrFetch(`sportmonks:date:${date}`,config.cache.ttlLive,()=>sportmonks.getFixturesByDate(date)),new Promise(r=>setTimeout(()=>r({ok:false,error:'sportmonks_date_timeout'}),5000))]),
    cache.getOrFetch(`bsd:canonical-results:${date}`,300,()=>bsdService.getResultMatchesForDate(date)),
    cache.getOrFetch('bsd:fixture-live:canonical',20,()=>bsdService.getLiveResultMatches())
  ]);
  const candidates=[];
  const put=(m,provider)=>{
    if(!m?.homeTeam||!m?.awayTeam)return;
    const kind=provider||m.canonicalProvider||m.source||m.dataSource;
    let row=m;
    if(kind==='sportsdb'){
      row={
        ...m,
        canonicalProvider:m.canonicalProvider||'thesportsdb',
        providerIds:{...(m.providerIds||{}),sportsdb:String(m.fixtureId||'')}
      };
    }else if(kind==='bsd'){
      row={
        ...m,
        canonicalProvider:'bsd',
        providerIds:{...(m.providerIds||{}),bsd:String(m.bsdEventId||m.fixtureId||'')}
      };
    }else if(kind==='sportmonks'){
      row={
        ...m,
        canonicalProvider:'sportmonks',
        providerIds:{...(m.providerIds||{}),sportmonks:String(m.sportmonksId||m.fixtureId||'')}
      };
    }
    candidates.push(competitionRegistry.decorateMatch(row,kind));
  };

  // Proven broad coverage baseline.
  for(const e of (legacy?.ok?(legacy.data?.events||[]):[])){
    const m=sportsDb.transformEvent(e);
    if(sportsDb.isWhitelistedLeague(m.leagueId) &&
       sportsDb.isLeagueIdentityConsistent(m.leagueId,m.league))put(m,'sportsdb');
  }
  // The day feed can omit an in-progress fixture that is present in V2.
  // TheSportsDB remains a fallback when BSD has no row for that match.
  for(const e of (live?.ok?(live.data?.livescore||[]):[])){
    if(String(e.strSport||'').toLowerCase()!=='soccer')continue;
    const m=sportsDb.transformLiveEvent(e);
    const kickoff=new Date(m?.kickoff||m?.date);
    if(!m?.isLive||!Number.isFinite(kickoff.getTime())||kickoff.toISOString().slice(0,10)!==date)continue;
    if(sportsDb.isWhitelistedLeague(m.leagueId) && sportsDb.isLeagueIdentityConsistent(m.leagueId,m.league))put(m,'sportsdb');
  }
  const extra=Array.isArray(supplemental)?supplemental:(supplemental?.matches||[]);
  for(const m of extra)put(m);
  for(const m of (oddsEvents?.ok?oddsEvents.matches:[]))put(m,'oddsApi');

  // BSD owns scores/results across leagues. Retain SportMonks and SportsDB as
  // verified fallbacks for fixtures missing from BSD's day response.
  for(const m of (bsdDay?.ok?bsdDay.matches:[])){
    put({...m,canonicalProvider:'bsd',providerIds:{...(m.providerIds||{}),bsd:String(m.bsdEventId||m.fixtureId||'')}},'bsd');
  }
  // BSD's compact day feed and its live feed can contain different events.
  // Include same-day live events in the fixture backbone without altering
  // the live score/statistics pipeline itself.
  for(const m of (bsdLive?.ok?bsdLive.matches:[])){
    const kickoff = new Date(m.date || m.kickoff);
    if (!Number.isFinite(kickoff.getTime()) || kickoff.toISOString().slice(0,10)!==date) continue;
    put(m,'bsd');
  }

  // SportMonks owns the six subscribed leagues and replaces matching fallback rows.
  const smRaw=[...(turkeySm?.ok?turkeySm.fixtures:[]),...(smDay?.ok?smDay.fixtures:[])];
  const smUnique=new Map(smRaw.map(f=>[String(f.sportmonksId||f.fixtureId),f]));
  for(const m of sportmonks.toResultMatches([...smUnique.values()])){
    if(!sourcePolicy.resolve({leagueName:m.league||m.leagueName||''}))continue;
    put({...m,canonicalProvider:'sportmonks',providerIds:{...(m.providerIds||{}),sportmonks:String(m.sportmonksId||m.fixtureId||'')}},'sportmonks');
  }

  let matches=competitionRegistry.dedupeCompetitionFixtures(candidates,{preferBsd:true})
    .sort((a,b)=>new Date(a.kickoff||a.date||0)-new Date(b.kickoff||b.date||0));
  if(live?.ok){
    const raw=(live.data?.livescore||[]).filter(e=>String(e.strSport||'').toLowerCase()==='soccer');
    matches=sportsDb.applyLiveOverlay(matches,raw);
  }
  matches=competitionRegistry.dedupeCompetitionFixtures(matches.map(m=>
    competitionRegistry.decorateMatch(m,m.canonicalProvider||m.source||m.dataSource)
  ),{preferBsd:true});
  const providerIdentity=require('../services/providerIdentityCache');
  for(const match of matches)providerIdentity.remember(match).catch(err=>console.warn('[provider-identity/fixtures]',err.message));
  // Keep the complete fixture backbone here. Some provider rows do not carry
  // enough league metadata to resolve a registry key at this stage; filtering
  // them here can erase the whole day. Fixtures/Home apply the central registry
  // visibility after canonical metadata is available.
  if(!matches.length&&!legacy?.ok&&!bsdDay?.ok&&!smDay?.ok&&!oddsEvents?.ok)return res.status(502).json({error:'Fikstur verisi alinamadi'});
  res.json({date,matches,coveragePolicy:'broad-fallback-with-canonical-overlays'});
});
module.exports=router;
