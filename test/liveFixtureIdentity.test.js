const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptsLiveFixture } = require('../src/services/liveFixtureIdentity');
const { chooseVerifiedCandidate } = require('../src/services/fixtureProviderIdentityService');
const { verifiedFixtureProvider } = require('../src/services/fixtureProviderIdentityService');
const sportsDb = require('../src/services/sportsDbService');
const bsd = require('../src/services/bsdService');

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

test('a verified SportsDB fixture survives the identity cache wrapper', async () => {
  const originalTsdb=sportsDb.getEventById,originalBsd=bsd.getEventById;
  let bsdCalls=0;
  sportsDb.getEventById=async id=>({ok:true,data:{events:[{idEvent:id,strHomeTeam:'FC Emmen',
    strAwayTeam:'TOP Oss',strLeague:'Dutch Eerste Divisie',dateEvent:'2026-09-26',
    strTimestamp:'2026-09-26T18:00:00',strStatus:'NS'}]}});
  bsd.getEventById=async()=>{bsdCalls++;return {available:false};};
  try {
    const query={fixtureId:'cache-test-identity-2489842',provider:'sportsdb',homeTeamName:'FC Emmen',awayTeamName:'TOP Oss',
      leagueName:'Dutch Eerste Divisie',kickoff:'2026-09-26T18:00:00Z'};
    assert.deepEqual(await verifiedFixtureProvider(query),{provider:'sportsdb',id:query.fixtureId});
    assert.deepEqual(await verifiedFixtureProvider(query),{provider:'sportsdb',id:query.fixtureId});
    assert.equal(await verifiedFixtureProvider({...query,provider:null}),null);
    assert.equal(bsdCalls,0);
  } finally { sportsDb.getEventById=originalTsdb;bsd.getEventById=originalBsd; }
});

test('UEFA national-team match keeps the same verified fixture identity', () => {
  const fixture={homeTeam:'England',awayTeam:'Spain',league:'UEFA Nations League',kickoff:'2026-09-26T18:00:00Z'};
  assert.equal(acceptsLiveFixture(fixture,'bsd',{homeTeamName:'England',awayTeamName:'Spain',leagueName:'UEFA Nations League',kickoff:fixture.kickoff}),true);
  assert.equal(acceptsLiveFixture({...fixture,league:'UEFA Champions League'},'bsd',{homeTeamName:'England',awayTeamName:'Spain',leagueName:'UEFA Nations League'}),false);
});
