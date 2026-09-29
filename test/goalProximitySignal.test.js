const test=require('node:test');
const assert=require('node:assert/strict');
const {goalProximitySignal,confirmedGoalProximity}=require('../src/services/goalProximitySignal');

test('one observed shot on target can qualify above 80 percent after two distinct snapshots',()=>{
  const stats={shotsOnTarget:{home:1,away:0},dangerousAttacks:{home:10,away:2},possession:{home:60,away:40}};
  const signal=goalProximitySignal(stats);
  assert.equal(signal.qualified.home,true);
  assert.ok(signal.proximity.home>80);
  const previous={...signal,fetchedAt:100};
  assert.equal(confirmedGoalProximity(previous,{...signal,fetchedAt:101},'home'),true);
  assert.equal(confirmedGoalProximity(previous,{...signal,fetchedAt:100},'home'),false);
});

test('exactly 80 percent, missing attacking data and a single qualifying reading do not fire',()=>{
  const threshold=goalProximitySignal({shotsOnTarget:{home:4,away:1}});
  assert.equal(threshold.proximity.home,80);
  assert.equal(threshold.qualified.home,false);
  const absent=goalProximitySignal({possession:{home:75,away:25}},
    {recentEvents:[{type:'goal',team:'home',minute:30}],minute:30});
  assert.equal(absent.proximity.available,false);
  assert.equal(confirmedGoalProximity({qualified:{home:false},fetchedAt:100},{...threshold,fetchedAt:101},'home'),false);
});
