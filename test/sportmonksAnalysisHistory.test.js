const test=require('node:test');
const assert=require('node:assert/strict');
const {verifiedFixture,toForm,preferredForm}=require('../src/services/sportmonksAnalysisHistoryService');
const stats=require('../src/services/statsService');

const context={homeTeamName:'Manchester City',awayTeamName:'Arsenal',
  kickoff:'2026-09-27T16:00:00Z',leagueId:'8'};
const fixture={sportmonksId:'sm:fixture',homeTeamId:'sm:home',awayTeamId:'sm:away',
  homeTeam:'Manchester City',awayTeam:'Arsenal',kickoff:context.kickoff,leagueId:'8'};

test('SportMonks fixture identity requires league, both teams and kickoff',()=>{
  assert.ok(verifiedFixture(fixture,context));
  assert.equal(verifiedFixture({...fixture,leagueId:'384'},context),false);
  assert.equal(verifiedFixture({...fixture,awayTeam:'Aston Villa'},context),false);
  assert.equal(verifiedFixture({...fixture,kickoff:'2026-09-27T18:00:00Z'},context),false);
  assert.equal(verifiedFixture({...fixture,awayTeamId:null},context),false);
});

test('SportMonks form counts only completed historical matches with its native team ID',()=>{
  const row={sportmonksId:'sm:past',homeTeamId:'sm:home',awayTeamId:'sm:other',
    homeTeam:'Manchester City',awayTeam:'Chelsea',kickoff:'2026-09-20T16:00:00Z',
    homeScore:2,awayScore:1,halftimeHome:1,halftimeAway:0,statusShort:'FT'};
  const result=toForm([row,{...row,sportmonksId:'sm:future',kickoff:context.kickoff},
    {...row,sportmonksId:'sm:live',statusShort:'LIVE'},
    {...row,sportmonksId:'sm:wrong',homeTeamId:'bsd:home'}],fixture.homeTeamId,context.kickoff);
  assert.equal(result.source,'sportmonks');
  assert.equal(result.teamId,'sm:home');
  assert.deepEqual(result.data.response.map(x=>x.fixture.id),['sm:past']);
  assert.equal(stats.summarizeMatches(result.data.response,result.teamId).played,1);
  assert.equal(stats.summarizeMatches(result.data.response,'bsd:home').played,0);
});

test('six-league team form uses SportMonks before requesting a fallback, independently per team',async()=>{
  let fallbacks=0;
  const fallback=()=>{fallbacks++;return {source:'bsd'};};
  const [home,away]=await Promise.all([
    preferredForm({source:'sportmonks',teamId:'sm:home'},fallback),
    preferredForm(null,fallback),
  ]);
  assert.equal(home.source,'sportmonks');
  assert.equal(away.source,'bsd');
  assert.equal(fallbacks,1);
});
