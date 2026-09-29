const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportsDb = require('../services/sportsDbService');
const oddsApi = require('../services/oddsApiService');
const sportmonks = require('../services/sportmonksService');
const bsdService = require('../services/bsdService');
const fiveDollarFootball = require('../services/fiveDollarFootballService');
const sourcePolicy = require('../services/sourcePolicyService');
const competitionRegistry = require('../services/competitionRegistryService');
const oddsFetches = new Map();

function fixtureOddsWithoutBlocking(date) {
  const key=`odds-events:${date}`;
  const hit=cache.get(key);
  if(hit!==undefined)return Promise.resolve(hit);
  let pending=oddsFetches.get(key);
  if(!pending){
    // Odds events are a fallback. Warm them once per date while canonical
    // providers serve the fixture page without waiting for every league.
    pending=cache.getOrFetch(key,config.cache.ttlStatic,
      ()=>oddsApi.getFixtureEventsByDate(date))
      .catch(error=>({ok:false,error:error.message}))
      .finally(()=>oddsFetches.delete(key));
    oddsFetches.set(key,pending);
  }
  return new Promise(resolve=>{
    const timer=setTimeout(()=>resolve({ok:false,error:'odds_warming'}),700);
    pending.then(result=>{clearTimeout(timer);resolve(result)});
  });
}

/** GET /api/matches?date=YYYY-MM-DD
 * Only the selected first divisions and UEFA competitions appear in Fixtures.
 * Provider ownership remains SportMonks for the six subscribed leagues and
 * BSD with verified fallbacks for the other selected competitions.
 */
router.get('/', async (req,res)=>{
  const date=req.query.date||new Date().toISOString().split('T')[0];
  const [legacy,live,oddsEvents,turkeySm,smDay,bsdDay,bsdLive,fiveDollarDay]=await Promise.all([
    cache.getOrFetch(`fixtures:${date}`,config.cache.ttlStatic,()=>sportsDb.getMatchesByDate(date)),
    cache.getOrFetch('live:v2:all',config.cache.ttlLive,()=>sportsDb.getLiveScores()),
    fixtureOddsWithoutBlocking(date),
    cache.getOrFetch(`sportmonks:tr:600:${date}`,config.cache.ttlLive,()=>sportmonks.getLeagueFixturesByDate(date,600)),
    Promise.race([cache.getOrFetch(`sportmonks:date:${date}`,config.cache.ttlLive,()=>sportmonks.getFixturesByDate(date)),new Promise(r=>setTimeout(()=>r({ok:false,error:'sportmonks_date_timeout'}),5000))]),
    cache.getOrFetch(`bsd:canonical-results:${date}`,300,()=>bsdService.getResultMatchesForDate(date)),
    cache.getOrFetch('bsd:fixture-live:canonical',20,()=>bsdService.getLiveResultMatches()),
    cache.getOrFetch(`five-dollar:fixtures:v1:${date}`,config.cache.ttlLive,()=>fiveDollarFootball.getFixturesByDate(date))
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
    }else if(kind==='5dollarfootball'){
      row={...m,canonicalProvider:'5dollarfootball',providerIds:{...(m.providerIds||{}),fiveDollar:String(m.fiveDollarFixtureId||m.fixtureId||'')},providerTeamIds:{...(m.providerTeamIds||{}),fiveDollar:{home:String(m.homeTeamId||''),away:String(m.awayTeamId||'')}}};
    }else if(kind==='sportmonks'){
      row={
        ...m,
        canonicalProvider:'sportmonks',
        providerIds:{...(m.providerIds||{}),sportmonks:String(m.sportmonksId||m.fixtureId||'')}
      };
    }
    const decorated=competitionRegistry.decorateMatch(row,kind);
    if(competitionRegistry.isFixtureCompetitionAllowed(decorated))candidates.push(decorated);
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
  for(const m of (oddsEvents?.ok?oddsEvents.matches:[]))put(m,'oddsApi');

  // Keep legacy provider rows as fallback candidates. Five Dollar rows below
  // outrank them for non-SportMonks competitions, but preserving these rows keeps
  // coverage when Five Dollar is unavailable.
  for(const m of (bsdDay?.ok?bsdDay.matches:[])) put(m,'bsd');
  for(const m of (bsdLive?.ok?bsdLive.matches:[])) put(m,'bsd');

  // Outside the six subscribed leagues Five Dollar is the canonical fixture backbone.
  // Its fixture ID, league ID and native team IDs travel together into analysis.
  for(const m of (fiveDollarDay?.ok?fiveDollarDay.matches:[])){
    if(sourcePolicy.resolve({leagueName:m.leagueName||m.league}))continue;
    put(m,'5dollarfootball');
  }

  // SportMonks owns the six subscribed leagues and replaces matching fallback rows.
  const smRaw=[...(turkeySm?.ok?turkeySm.fixtures:[]),...(smDay?.ok?smDay.fixtures:[])];
  const smUnique=new Map(smRaw.map(f=>[String(f.sportmonksId||f.fixtureId),f]));
  for(const m of sportmonks.toResultMatches([...smUnique.values()])){
    if(!sourcePolicy.resolve({leagueName:m.league||m.leagueName||''}))continue;
    put({...m,canonicalProvider:'sportmonks',providerIds:{...(m.providerIds||{}),sportmonks:String(m.sportmonksId||m.fixtureId||'')}},'sportmonks');
  }

  let matches=competitionRegistry.dedupeCompetitionFixtures(candidates,{preferBsd:false})
    .sort((a,b)=>new Date(a.kickoff||a.date||0)-new Date(b.kickoff||b.date||0));
  if(live?.ok){
    const raw=(live.data?.livescore||[]).filter(e=>String(e.strSport||'').toLowerCase()==='soccer');
    matches=sportsDb.applyLiveOverlay(matches,raw);
  }
  matches=competitionRegistry.dedupeCompetitionFixtures(matches.map(m=>
    competitionRegistry.decorateMatch(m,m.canonicalProvider||m.source||m.dataSource)
  ),{preferBsd:false}).filter(competitionRegistry.isFixtureCompetitionAllowed);
  const providerIdentity=require('../services/providerIdentityCache');
  const identityWrites=await Promise.allSettled(matches.map(match=>providerIdentity.remember(match)));
  for(const write of identityWrites)if(write.status==='rejected')console.warn('[provider-identity/fixtures]',write.reason?.message);
  if(!matches.length&&!legacy?.ok&&!fiveDollarDay?.ok&&!bsdDay?.ok&&!smDay?.ok&&!oddsEvents?.ok)return res.status(502).json({error:'Fikstur verisi alinamadi'});
  res.json({date,matches,coveragePolicy:'sportmonks-six-else-fivedollar-native-with-sportsdb-fallback'});
});
module.exports=router;
