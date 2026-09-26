const test=require('node:test');
const assert=require('node:assert/strict');
const sourcePolicy=require('../src/services/sourcePolicyService');
const registry=require('../src/services/competitionRegistryService');
const {verifiedFixtureProvider}=require('../src/services/fixtureProviderIdentityService');
const sportsDb=require('../src/services/sportsDbService');
const {priceFreshness}=require('../src/services/fiveDollarFootballService');

test('all six subscribed competition display names route to their verified SportMonks league IDs',()=>{
  const core=registry.COMPETITIONS.filter(c=>c.providerIds.sportmonks);
  assert.equal(core.length,6);
  for(const league of core){
    assert.equal(sourcePolicy.policy({leagueName:league.displayName}).sportmonksLeagueId,league.providerIds.sportmonks);
    assert.equal(sourcePolicy.isBsdCoreLeague({leagueName:league.displayName,country:league.country}),true);
  }
  assert.equal(sourcePolicy.policy({leagueName:'UEFA Nations League',sportKey:'soccer_epl'}).sportmonks,false);
});

test('BSD wins a verified duplicate in score/live feeds while preserving both event IDs',()=>{
  const base={league:'England Premier League',homeTeam:'Arsenal',awayTeam:'Chelsea',kickoff:'2026-09-26T18:00:00Z'};
  const sm=registry.decorateMatch({...base,fixtureId:'101',canonicalProvider:'sportmonks',providerIds:{sportmonks:'101'}},'sportmonks');
  const bsd=registry.decorateMatch({...base,fixtureId:'202',canonicalProvider:'bsd',providerIds:{bsd:'202'}},'bsd');
  const selected=registry.dedupeCompetitionFixtures([sm,bsd],{preferBsd:true});
  assert.equal(selected.length,1);
  assert.equal(selected[0].fixtureId,'202');
  assert.deepEqual(selected[0].providerIds,{sportmonks:'101',bsd:'202'});
});

test('a cross-provider SportMonks alias does not relabel an unrelated numeric event ID',async()=>{
  const result=await verifiedFixtureProvider({fixtureId:'',sportmonksId:'101'});
  assert.equal(result,null);
});

test('SportsDB live overlay cannot overwrite the BSD score for the same numeric ID',()=>{
  const bsd={fixtureId:'202',canonicalProvider:'bsd',homeTeam:'Arsenal',awayTeam:'Chelsea',
    kickoff:'2026-09-26T18:00:00Z',homeScore:2,awayScore:1,statusShort:'FT'};
  const event={idEvent:'202',strSport:'Soccer',strHomeTeam:'Other',strAwayTeam:'Unknown',
    strTimestamp:bsd.kickoff,intHomeScore:'0',intAwayScore:'0',strStatus:'1H'};
  assert.deepEqual(sportsDb.applyLiveOverlay([bsd],[event]),[bsd]);
  const sportsdb={...bsd,canonicalProvider:'sportsdb'};
  assert.deepEqual(sportsDb.applyLiveOverlay([sportsdb],[event]),[sportsdb]);
});

test('a bookmaker price without a provider timestamp is not advertised as fresh value',()=>{
  assert.equal(priceFreshness({}).fresh,false);
  assert.equal(priceFreshness({updated_at:new Date(Date.now()-60_000).toISOString()}).fresh,true);
  assert.equal(priceFreshness({updated_at:new Date(Date.now()-7*60*60_000).toISOString()}).fresh,false);
});
