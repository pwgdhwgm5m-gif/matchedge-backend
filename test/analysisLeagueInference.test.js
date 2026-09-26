const test=require('node:test');
const assert=require('node:assert/strict');
const registry=require('../src/services/competitionRegistryService');
const sportsDb=require('../src/services/sportsDbService');

test('Dutch Eerste Divisie deep links can use a verified registered provider league ID',()=>{
  const competition=registry.resolveCompetition({leagueName:'Dutch Eerste Divisie'});
  assert.equal(competition.providerIds.sportsdb,'4641');
  assert.equal(sportsDb.isWhitelistedLeague(competition.providerIds.sportsdb),true);
});

test('unknown competition names do not invent a provider league ID',()=>{
  assert.equal(registry.resolveCompetition({leagueName:'Unverified League XYZ'}),null);
});
