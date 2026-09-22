const express = require('express');
const router = express.Router();
const cache = require('../utils/cache');
const config = require('../config/config');
const sportmonks = require('../services/sportmonksService');
const bsdService = require('../services/bsdService');
const sourcePolicy = require('../services/sourcePolicyService');

/** GET /api/matches?date=2026-09-16
 * Canonical ownership: six subscribed leagues => SportMonks; all other
 * competitions => BSD v2. The fixture identity returned here is the same
 * identity used by results, analysis evidence resolution and coupon grading.
 */
router.get('/', async (req,res)=>{
  const date=req.query.date||new Date().toISOString().split('T')[0];
  const [turkeySmResult,smResult,bsdResult]=await Promise.all([
    cache.getOrFetch(`sportmonks:tr:600:${date}`,config.cache.ttlLive,()=>sportmonks.getLeagueFixturesByDate(date,600)),
    Promise.race([
      cache.getOrFetch(`sportmonks:date:${date}`,config.cache.ttlLive,()=>sportmonks.getFixturesByDate(date)),
      new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'sportmonks_date_timeout'}),5000))
    ]),
    cache.getOrFetch(`bsd:canonical-results:${date}`,300,()=>bsdService.getResultMatchesForDate(date))
  ]);
  const smRaw=[...(turkeySmResult?.ok?turkeySmResult.fixtures:[]),...(smResult?.ok?smResult.fixtures:[])];
  const smUnique=new Map();
  for(const f of smRaw){
    if(!sourcePolicy.resolve({leagueName:f.leagueName||f.league||''}))continue;
    smUnique.set(String(f.sportmonksId||f.fixtureId),f);
  }
  const sm=sportmonks.toResultMatches([...smUnique.values()]).map(m=>({
    ...m,canonicalProvider:'sportmonks',
    providerIds:{...(m.providerIds||{}),sportmonks:String(m.sportmonksId||m.fixtureId||'')}
  }));
  const bsd=(bsdResult?.ok?bsdResult.matches:[]).filter(m=>!sourcePolicy.resolve({leagueName:m.league})).map(m=>({
    ...m,canonicalProvider:'bsd',
    providerIds:{...(m.providerIds||{}),bsd:String(m.bsdEventId||m.fixtureId||'')}
  }));
  const matches=[...sm,...bsd].sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));
  if(!matches.length&&!smResult?.ok&&!turkeySmResult?.ok&&!bsdResult?.ok)return res.status(502).json({error:'Fikstur verisi alinamadi'});
  res.json({date,matches,canonicalPolicy:'sportmonks-6-else-bsd',sportmonksCount:sm.length,bsdCount:bsd.length});
});
module.exports=router;
