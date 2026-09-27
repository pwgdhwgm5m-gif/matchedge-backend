const test=require('node:test');
const assert=require('node:assert/strict');
const {attachAliases,goalMatchKey,nextGoalScore}=require('../src/services/goalNotificationIdentity');

const kickoff='2026-09-27T18:00:00.000Z';
const identity={canonicalKey:'match:de-graafschap-den-bosch:2026-09-27T18:00:00.000Z',
  kickoff:new Date(kickoff),home:'De Graafschap',away:'Den Bosch',
  providerIds:{bsd:'bsd-100',sportsdb:'tsdb-200',sportmonks:'sm-300'}};
const tracked={all:new Map([['bsd-100',new Set(['user-1'])]]),coupons:new Map(),matches:[],
  trackedRows:[{fixtureId:'bsd-100',homeTeam:'De Graafschap',awayTeam:'Den Bosch',
    userId:'user-1',coupon:false}]};

test('verified favorite ID maps to another feed while preserving provider-native IDs',()=>{
  const result=attachAliases(tracked,[identity],Date.parse(kickoff));
  assert.deepEqual([...result.all.get('tsdb-200')],['user-1']);
  assert.equal(result.coupons.size,0);
  assert.equal(goalMatchKey(result.identities,{fixtureId:'tsdb-200',source:'sportsdb',
    kickoff,homeTeam:'De Graafschap',awayTeam:'Den Bosch'}),identity.canonicalKey);
  assert.equal(goalMatchKey(result.identities,{fixtureId:'bsd-100',source:'bsd',
    date:kickoff,homeTeam:'De Graafschap',awayTeam:'Den Bosch'}),identity.canonicalKey);
});

test('numeric ID collisions and same-day rematches do not inherit another match identity',()=>{
  const wrong={...identity,kickoff:new Date('2026-09-27T21:00:00.000Z'),
    canonicalKey:'different',home:'Other FC',away:'Another FC'};
  const result=attachAliases(tracked,[wrong],Date.parse(kickoff));
  assert.equal(result.all.has('tsdb-200'),false);
  assert.equal(goalMatchKey([identity],{fixtureId:'tsdb-200',source:'sportsdb',
    kickoff:'2026-09-27T21:00:00.000Z',homeTeam:'De Graafschap',awayTeam:'Den Bosch'}),'sportsdb:tsdb-200');
  assert.equal(goalMatchKey([identity],{fixtureId:'tsdb-200',source:'sportsdb',
    kickoff,homeTeam:'Other FC',awayTeam:'Another FC'}),'sportsdb:tsdb-200');
});

test('coupon alias is verified for both sides and ambiguous identities do not expand',()=>{
  const coupon={all:new Map([['bsd-100',new Set(['user-2'])]]),
    coupons:new Map([['bsd-100',new Set(['user-2'])]]),matches:[],
    trackedRows:[{fixtureId:'bsd-100',homeTeam:'De Graafschap',awayTeam:'Den Bosch',
      kickoff,userId:'user-2',coupon:true}]};
  assert.deepEqual([...attachAliases(coupon,[identity],Date.parse(kickoff)).coupons.get('tsdb-200')],['user-2']);
  assert.equal(attachAliases(coupon,[identity,{...identity,canonicalKey:'ambiguous'}],Date.parse(kickoff)).all.has('tsdb-200'),false);
});

test('a stale provider score cannot reset the goal baseline and replay a push',()=>{
  let observed=nextGoalScore(null,0,0,true);
  assert.equal(observed.advanced,false);
  observed=nextGoalScore(observed.score,1,0,true);
  assert.equal(observed.advanced,true);
  observed=nextGoalScore(observed.score,0,0,true);
  assert.equal(observed.advanced,false);
  observed=nextGoalScore(observed.score,1,0,true);
  assert.equal(observed.advanced,false);
  observed=nextGoalScore(observed.score,2,0,true);
  assert.equal(observed.advanced,true);
});
