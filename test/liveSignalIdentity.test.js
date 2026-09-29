const test=require('node:test');
const assert=require('node:assert/strict');
const {sameLiveFixture,uniqueLiveFixture}=require('../src/services/liveSignalIdentity');
const {signalFavoriteRecipients}=require('../src/services/goalNotificationIdentity');

const kickoff='2026-09-29T18:45:00Z';
const identity={canonicalKey:'fixture-a',home:'FC Bayern München',away:'Manchester Utd',kickoff:new Date(kickoff),
  providerIds:{sportmonks:'sm-123',bsd:'bsd-456'}};
const signal={homeTeam:'Bayern Munich',awayTeam:'Manchester United',kickoff,source:'5dollar'};

test('5Dollar live signal resolves verified aliases and keeps the favorite navigation ID',()=>{
  const tracked={identities:[identity],trackedRows:[{userId:'user-a',fixtureId:'sm-123',homeTeam:'FC Bayern München',awayTeam:'Manchester Utd',coupon:false}]};
  assert.equal(sameLiveFixture(identity,signal),true);
  assert.deepEqual([...signalFavoriteRecipients(tracked,signal,'five-999')],[['user-a','sm-123']]);
});

test('same teams at another kickoff and ambiguous identities never receive a signal',()=>{
  const rows=[identity,{...identity,canonicalKey:'fixture-b'}];
  assert.equal(uniqueLiveFixture(rows,signal),null);
  assert.equal(signalFavoriteRecipients({identities:rows,trackedRows:[{userId:'user-a',fixtureId:'sm-123',homeTeam:identity.home,awayTeam:identity.away,coupon:false}]},signal,'five-999').size,0);
  assert.equal(sameLiveFixture(identity,{...signal,kickoff:'2026-09-29T21:45:00Z'}),false);
  assert.equal(sameLiveFixture(identity,{...signal,awayTeam:'Manchester City'}),false);
});

test('UI match selection accepts one verified 5Dollar fixture and rejects a duplicate',()=>{
  const rows=[{id:1,teams:{home:{name:'Bayern Munich'},away:{name:'Manchester United'}},kickoff_ts:Date.parse(kickoff)/1000}];
  const project=f=>({homeTeam:f.teams.home.name,awayTeam:f.teams.away.name,kickoff:new Date(f.kickoff_ts*1000).toISOString()});
  assert.equal(uniqueLiveFixture(rows,signal,project)?.id,1);
  assert.equal(uniqueLiveFixture([...rows,{...rows[0],id:2}],signal,project),null);
});
