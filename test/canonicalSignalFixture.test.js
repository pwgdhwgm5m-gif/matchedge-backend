const test=require('node:test');
const assert=require('node:assert/strict');
const {canonicalSignalFixture}=require('../src/services/canonicalSignalFixture');
const {sportmonksGoalMatches}=require('../src/services/goalPushSourcePolicy');

const base={fixtureId:'sm-12',source:'sportmonks',homeTeam:'Home',awayTeam:'Away',kickoff:'2026-09-29T18:00:00Z',minute:67,
  isLive:true,homeScore:0,awayScore:0};

test('the subscribed provider live snapshot supplies native fixture identity and observed pressure',()=>{
  const f=canonicalSignalFixture({...base,liveStats:{dangerousAttacksHome:29,dangerousAttacksAway:14,
    shotsOnTargetHome:4,shotsOnTargetAway:1,shotsOffTargetHome:3,shotsOffTargetAway:2}});
  assert.equal(f.id,'sm-12');
  assert.deepEqual(f.normalizedStats.dangerousAttacks,{home:29,away:14});
  assert.deepEqual(f.normalizedStats.shotsOnTarget,{home:4,away:1});
  assert.equal(f.score.home,0);
});

test('SportMonks goal-feed transform preserves live stats for the signal monitor',()=>{
  const rows=sportmonksGoalMatches([{sportmonksId:12,leagueId:8,isLive:true,homeTeam:'Home',awayTeam:'Away',
    homeScore:0,awayScore:0,kickoff:base.kickoff,minute:67,stats:{dangerousAttacksHome:29,shotsOnTargetHome:4}}]);
  assert.equal(canonicalSignalFixture(rows[0]).normalizedStats.dangerousAttacks.home,29);
  assert.equal(rows[0].fixtureId,'12');
});

test('BSD nested observed stats are accepted while missing series cannot fabricate pressure',()=>{
  const b={...base,fixtureId:'bsd-31',source:'bsd',liveStats:{stats:{home:{dangerous_attacks:18,shots_on_target:3},away:{dangerous_attacks:10,shots_on_target:1}}}};
  assert.equal(canonicalSignalFixture(b).normalizedStats.shotsOnTarget.home,3);
  assert.equal(canonicalSignalFixture({...b,liveStats:{stats:{home:{possession:70},away:{possession:30}}}}),null);
  assert.equal(canonicalSignalFixture({...b,kickoff:'invalid'}),null);
  assert.equal(canonicalSignalFixture({...b,isLive:false}),null);
});
