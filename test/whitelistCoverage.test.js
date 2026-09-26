const test=require('node:test');
const assert=require('node:assert/strict');
const db=require('../src/services/sportsDbService');
const registry=require('../src/services/competitionRegistryService');
const sourcePolicy=require('../src/services/sourcePolicyService');
const cache=require('../src/utils/cache');
const resultsRouter=require('../src/routes/results');
const bsd=require('../src/services/bsdService');

test('every SportsDB whitelist ID has one visible registered competition and a safe analysis route',()=>{
  assert.equal(db.WHITELISTED_LEAGUE_IDS.size,64);
  const keys=new Set();
  for(const id of db.WHITELISTED_LEAGUE_IDS){
    const competition=registry.resolveCompetition({provider:'sportsdb',leagueId:id});
    assert.ok(competition,`unmapped league ${id}`);
    assert.equal(competition.visibleInCompetitionFilter,true,`hidden league ${id}`);
    assert.equal(competition.providerIds.sportsdb,id);
    assert.equal(db.isLeagueIdentityConsistent(id,competition.displayName),true,`name rejected ${id}`);
    assert.equal(db.isLeagueIdentityConsistent(id,'Unrelated League Name'),false,`unverified name accepted ${id}`);
    assert.equal(sourcePolicy.policy({leagueName:competition.displayName}).sportmonks,
      Boolean(competition.providerIds.sportmonks),`wrong model provider ${id}`);
    keys.add(competition.canonicalCompetitionKey);
  }
  assert.equal(keys.size,64);
});

test('cross-league numeric identity cannot turn a Brazilian row into Italian Serie A',()=>{
  assert.equal(db.isLeagueIdentityConsistent('4351','Italy Serie A'),false);
  assert.equal(db.isLeagueIdentityConsistent('4332','Brazilian Serie A'),false);
});

test('results use a whitelisted SportsDB fallback when BSD omits a match and keep BSD for a duplicate',async()=>{
  const route=resultsRouter.stack.find(x=>x.route?.path==='/').route.stack.find(x=>x.method==='get').handle;
  const original={getOrFetch:cache.getOrFetch,tsdbHt:db.attachHalftimeScores,bsdHt:bsd.attachHalftimeScores};
  const fixture={idEvent:'tsdb-brazil-1',idLeague:'4351',strLeague:'Brazilian Serie A',
    dateEvent:'2026-09-25',strTimestamp:'2026-09-25T18:00:00',strHomeTeam:'Flamengo',
    strAwayTeam:'Palmeiras',intHomeScore:'2',intAwayScore:'1',strStatus:'FT'};
  const bsdMatch={fixtureId:'bsd-brazil-1',bsdEventId:'bsd-brazil-1',league:'Brazilian Serie A',
    homeTeam:'Flamengo',awayTeam:'Palmeiras',date:'2026-09-25T18:00:00Z',
    homeScore:3,awayScore:1,statusShort:'FT'};
  let withBsd=false;
  try{
    cache.getOrFetch=async key=>key.startsWith('fixtures:')?{ok:true,data:{events:[fixture]}}:
      key.startsWith('bsd:canonical-results:')?{ok:true,matches:withBsd?[bsdMatch]:[]}:
      {ok:false,fixtures:[]};
    db.attachHalftimeScores=async()=>{};bsd.attachHalftimeScores=async()=>{};
    const respond=async()=>{
      const res={statusCode:200,json(body){this.body=body;return this},status(code){this.statusCode=code;return this}};
      await route({query:{date:'2026-09-25'}},res);return res.body.matches;
    };
    const fallback=await respond();
    assert.equal(fallback.length,1);assert.equal(fallback[0].fixtureId,'tsdb-brazil-1');
    withBsd=true;
    const preferred=await respond();
    assert.equal(preferred.length,1);assert.equal(preferred[0].fixtureId,'bsd-brazil-1');
    assert.equal(preferred[0].homeScore,3);
    assert.equal(preferred[0].providerIds.sportsdb,'tsdb-brazil-1');
  }finally{cache.getOrFetch=original.getOrFetch;db.attachHalftimeScores=original.tsdbHt;
    bsd.attachHalftimeScores=original.bsdHt;}
});
