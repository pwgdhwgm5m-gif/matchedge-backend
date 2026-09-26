const test=require('node:test');
const assert=require('node:assert/strict');
const {selectPrecomputeFixtures,dedupePrecomputeFixtures}=require('../src/cron/precomputeJob');
const {precomputedKey}=require('../src/services/prematchArchiveService');

test('precomputed cache keys separate same numeric event ID by match identity',()=>{
  const fixture={fixtureId:'123',homeTeam:'FC Emmen',awayTeam:'TOP Oss',kickoff:'2026-09-26T18:00:00Z'};
  assert.notEqual(precomputedKey(fixture),precomputedKey({...fixture,homeTeam:'Slovenia',awayTeam:'Scotland'}));
  assert.equal(precomputedKey({...fixture,kickoff:null}),null);
});

test('BSD fixture wins a matching SportsDB event in Dutch and UEFA competitions',()=>{
  for(const leagueName of ['Dutch Eerste Divisie','UEFA Nations League']){
    const fixture={fixtureId:'123',homeTeamName:'FC Emmen',awayTeamName:'TOP Oss',kickoff:'2026-09-26T18:00:00Z',leagueName};
    const result=dedupePrecomputeFixtures([{...fixture,canonicalProvider:'bsd'},
      {...fixture,fixtureId:'456',canonicalProvider:'sportsdb'}]);
    assert.equal(result.length,1);
    assert.equal(result[0].canonicalProvider,'bsd');
  }
});

test('precompute quota reserves UEFA/Dutch and core fixtures',()=>{
  const make=(id,leagueName)=>({fixtureId:String(id),canonicalProvider:'bsd',homeTeamName:'Home',awayTeamName:'Away',
    kickoff:'2026-09-26T18:00:00Z',leagueName});
  const fixtures=[...Array.from({length:10},(_,i)=>make(i,'Portugal Primeira Liga')),
    ...Array.from({length:7},(_,i)=>make(i+20,'UEFA Nations League')),
    ...Array.from({length:8},(_,i)=>make(i+40,'England Premier League'))];
  const selected=selectPrecomputeFixtures(fixtures,15);
  assert.equal(selected.length,15);
  assert.equal(selected.filter(x=>x.leagueName==='UEFA Nations League').length,6);
  assert.ok(selected.filter(x=>x.leagueName==='England Premier League').length>=6);
});
