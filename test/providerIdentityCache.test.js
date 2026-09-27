const test=require('node:test');
const assert=require('node:assert/strict');
const identity=require('../src/services/providerIdentityCache');
const registry=require('../src/services/competitionRegistryService');

test('verified same-fixture providers retain separate event and team namespaces in cache',async()=>{
  const base={canonicalCompetitionKey:'netherlands-eerste-divisie',homeTeam:'FC Emmen',awayTeam:'TOP Oss',kickoff:'2026-09-26T18:00:00Z'};
  const db=registry.decorateMatch({...base,fixtureId:'2489842',canonicalProvider:'sportsdb',homeId:'db-h',awayId:'db-a'});
  const bsd=registry.decorateMatch({...base,fixtureId:'223100',canonicalProvider:'bsd',homeTeamId:'bsd-h',awayTeamId:'bsd-a'});
  await identity.remember(db);await identity.remember(bsd);
  const found=await identity.lookup(db);
  assert.deepEqual(found.providerIds,{sportsdb:'2489842',bsd:'223100'});
  assert.deepEqual(found.providerTeamIds,{sportsdb:{home:'db-h',away:'db-a'},bsd:{home:'bsd-h',away:'bsd-a'}});
});

test('different competition, kickoff or conflicting provider ID cannot reuse identity',async()=>{
  const base={canonicalCompetitionKey:'uefa-nations-league',homeTeam:'England',awayTeam:'Spain',kickoff:'2026-09-26T18:00:00Z',canonicalProvider:'bsd',fixtureId:'223999'};
  await identity.remember(base);
  assert.equal(await identity.lookup({...base,canonicalCompetitionKey:'uefa-champions-league'}),null);
  assert.equal(await identity.lookup({...base,kickoff:'2026-09-26T23:00:00Z'}),null);
  assert.equal(await identity.lookup({...base,fixtureId:'other-event'}),null);
});

test('same-day rematches retain separate event IDs while near-time provider aliases merge',async()=>{
  const base={canonicalCompetitionKey:'netherlands-eerste-divisie',homeTeam:'De Graafschap',awayTeam:'Den Bosch'};
  const first={...base,fixtureId:'db:first',canonicalProvider:'sportsdb',kickoff:'2026-09-27T12:30:00Z'};
  const alias={...base,fixtureId:'bsd:first',canonicalProvider:'bsd',kickoff:'2026-09-27T12:35:00Z'};
  const rematch={...base,fixtureId:'db:second',canonicalProvider:'sportsdb',kickoff:'2026-09-27T18:30:00Z'};
  await identity.remember(first);
  await identity.remember(alias);
  await identity.remember(rematch);
  assert.deepEqual((await identity.lookup(first)).providerIds,{sportsdb:'db:first',bsd:'bsd:first'});
  assert.deepEqual((await identity.lookup(rematch)).providerIds,{sportsdb:'db:second'});
  assert.notEqual(identity.keyOf(first),identity.keyOf(rematch));
});
