const test=require('node:test');
const assert=require('node:assert/strict');
const {SPORTMONKS_PRIMARY}=require('../src/services/sourcePolicyService');
const {hasTrackedSportmonksFixture,sportmonksGoalMatches}=require('../src/services/goalPushSourcePolicy');

test('all six subscribed leagues use SportMonks native fixture IDs for goal observations',()=>{
  const fixtures=SPORTMONKS_PRIMARY.map((league,i)=>({sportmonksId:10000+i,
    leagueId:Number(league.sportmonksId),isLive:true,homeTeam:'Home',awayTeam:'Away',
    homeScore:0,awayScore:1,kickoff:'2026-09-27T18:00:00Z'}));
  const result=sportmonksGoalMatches([...fixtures,{...fixtures[0],leagueId:9999,sportmonksId:30000}]);
  assert.equal(result.length,6);
  result.forEach((row,i)=>{
    assert.equal(row.source,'sportmonks');
    assert.equal(row.fixtureId,String(fixtures[i].sportmonksId));
    assert.deepEqual(row.providerIds,{sportmonks:String(fixtures[i].sportmonksId)});
  });
});

test('incomplete and non-live SportMonks scores never become a goal baseline',()=>{
  const fixture={sportmonksId:100,leagueId:8,isLive:true,homeTeam:'Home',awayTeam:'Away',
    homeScore:0,awayScore:0};
  assert.deepEqual(sportmonksGoalMatches([
    {...fixture,homeScore:null},{...fixture,awayScore:null},{...fixture,isLive:false},
    {...fixture,sportmonksId:null},{...fixture,homeScore:'unknown'}
  ]),[]);
  assert.equal(sportmonksGoalMatches([fixture]).length,1);
});

test('SportMonks live polling requires a recent tracked native identity',()=>{
  const now=Date.parse('2026-09-27T18:00:00Z');
  const row={providerIds:{sportmonks:'12345'},kickoff:new Date(now-2*60*60*1000)};
  assert.equal(hasTrackedSportmonksFixture([row],now),true);
  assert.equal(hasTrackedSportmonksFixture([{...row,providerIds:{bsd:'12345'}}],now),false);
  assert.equal(hasTrackedSportmonksFixture([{...row,kickoff:new Date(now-5*60*60*1000)}],now),false);
  assert.equal(hasTrackedSportmonksFixture([{...row,kickoff:new Date(now+60*60*1000)}],now),false);
});
