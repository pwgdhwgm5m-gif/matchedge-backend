const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptsLiveFixture } = require('../src/services/liveFixtureIdentity');
const { chooseVerifiedCandidate } = require('../src/services/fixtureProviderIdentityService');

test('numeric event IDs cannot cross provider namespaces or team identities', () => {
  const fixture = {homeTeam:'FC Emmen',awayTeam:'TOP Oss',league:'Dutch Eerste Divisie',kickoff:'2026-09-26T18:00:00Z'};
  const context = {provider:'sportsdb',homeTeamName:'FC Emmen',awayTeamName:'TOP Oss',leagueName:'Dutch Eerste Divisie',kickoff:fixture.kickoff};
  assert.equal(acceptsLiveFixture(fixture,'sportsdb',context),true);
  assert.equal(acceptsLiveFixture(fixture,'bsd',context),false);
  assert.equal(acceptsLiveFixture({...fixture,awayTeam:'Other Team'},'sportsdb',context),false);
  assert.equal(acceptsLiveFixture({...fixture,kickoff:'2026-09-27T18:00:00Z'},'sportsdb',context),false);
  assert.equal(acceptsLiveFixture({...fixture,league:'Netherlands Eredivisie'},'sportsdb',context),false);
});

test('an ambiguous cross-provider ID cannot enter the prediction ledger without a verified source hint', () => {
  const choices=[{provider:'bsd',id:'123'},{provider:'sportsdb',id:'123'}];
  assert.equal(chooseVerifiedCandidate(choices,null),null);
  assert.deepEqual(chooseVerifiedCandidate(choices,'thesportsdb'),choices[1]);
  assert.deepEqual(chooseVerifiedCandidate([choices[0]],null),choices[0]);
});

test('UEFA national-team match keeps the same verified fixture identity', () => {
  const fixture={homeTeam:'England',awayTeam:'Spain',league:'UEFA Nations League',kickoff:'2026-09-26T18:00:00Z'};
  assert.equal(acceptsLiveFixture(fixture,'bsd',{homeTeamName:'England',awayTeamName:'Spain',leagueName:'UEFA Nations League',kickoff:fixture.kickoff}),true);
  assert.equal(acceptsLiveFixture({...fixture,league:'UEFA Champions League'},'bsd',{homeTeamName:'England',awayTeamName:'Spain',leagueName:'UEFA Nations League'}),false);
});
