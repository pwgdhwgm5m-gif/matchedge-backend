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

/** GET /api/matches?date=YYYY-MM-DD
 * Fixture coverage stays broad. Provider ownership is applied as an overlay,
 * not as a destructive whitelist: SportMonks is authoritative for the six
 * subscribed leagues, BSD is preferred outside them, and the proven legacy
 * fixture feeds remain coverage fallbacks.
 */
router.get('/', async (req,res)=>{
  const date=req.query.date||new Date().toISOString().split('T')[0];
  const [legacy,live,supplemental,oddsEvents,turkeySm,smDay,bsdDay]=await Promise.all([
    cache.getOrFetch(`fixtures:${date}`,config.cache.ttlStatic,()=>sportsDb.getMatchesByDate(date)),
    cache.getOrFetch('live:v2:all',config.cache.ttlLive,()=>sportsDb.getLiveScores()),
    cache.getOrFetch(`cup-fixtures:${date}`,config.cache.ttlStatic,()=>cupFixtures.getSupplementalMatches(date)),
    cache.getOrFetch(`odds-events:${date}`,config.cache.ttlStatic,()=>oddsApi.getFixtureEventsByDate(date)),
    cache.getOrFetch(`sportmonks:tr:600:${date}`,config.cache.ttlLive,()=>sportmonks.getLeagueFixturesByDate(date,600)),
    Promise.race([cache.getOrFetch(`sportmonks:date:${date}`,config.cache.ttlLive,()=>sportmonks.getFixturesByDate(date)),new Promise(r=>setTimeout(()=>r({ok:false,error:'sportmonks_date_timeout'}),5000))]),
    cache.getOrFetch(`bsd:canonical-results:${date}`,300,()=>bsdService.getResultMatchesForDate(date))
  ]);
  const norm=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const key=m=>norm(m.homeTeam)+'|'+norm(m.awayTeam);
  const map=new Map();
  const put=(m,replace=false)=>{if(!m?.homeTeam||!m?.awayTeam)return;const k=key(m);if(replace||!map.has(k))map.set(k,m);};

  // Proven broad coverage baseline.
  for(const e of (legacy?.ok?(legacy.data?.events||[]):[])){
    const m=sportsDb.transformEvent(e);
    if(sportsDb.isWhitelistedLeague(m.leagueId))put(m);
  }
  const extra=Array.isArray(supplemental)?supplemental:(supplemental?.matches||[]);
  for(const m of extra)put(m);
  for(const m of (oddsEvents?.ok?oddsEvents.matches:[]))put(m);

  // BSD outside the subscribed six leagues: preferred identity/data, but it
  // augments rather than erases fixtures absent from BSD's day response.
  for(const m of (bsdDay?.ok?bsdDay.matches:[])){
    if(sourcePolicy.isBsdCoreLeague({leagueName:m.league,country:m.leagueCountry}))continue;
    put({...m,canonicalProvider:'bsd',providerIds:{...(m.providerIds||{}),bsd:String(m.bsdEventId||m.fixtureId||'')}},true);
  }

  // SportMonks owns the six subscribed leagues and replaces matching fallback rows.
  const smRaw=[...(turkeySm?.ok?turkeySm.fixtures:[]),...(smDay?.ok?smDay.fixtures:[])];
  const smUnique=new Map(smRaw.map(f=>[String(f.sportmonksId||f.fixtureId),f]));
  for(const m of sportmonks.toResultMatches([...smUnique.values()])){
    if(!sourcePolicy.resolve({leagueName:m.league||m.leagueName||''}))continue;
    put({...m,canonicalProvider:'sportmonks',providerIds:{...(m.providerIds||{}),sportmonks:String(m.sportmonksId||m.fixtureId||'')}},true);
  }

  let matches=[...map.values()].sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));
  if(live?.ok){
    const raw=(live.data?.livescore||[]).filter(e=>String(e.strSport||'').toLowerCase()==='soccer');
    matches=sportsDb.applyLiveOverlay(matches,raw);
  }
  if(!matches.length&&!legacy?.ok&&!bsdDay?.ok&&!smDay?.ok&&!oddsEvents?.ok)return res.status(502).json({error:'Fikstur verisi alinamadi'});
  res.json({date,matches,coveragePolicy:'broad-fallback-with-canonical-overlays'});
});
module.exports=router;
