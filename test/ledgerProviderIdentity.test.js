const test=require('node:test');
const assert=require('node:assert/strict');
const {exactProviderMatch,resultIdentityMatches}=require('../src/services/predictionLedgerService');

test('same numeric result ID from another provider cannot settle a prediction',()=>{
  const snapshot={providerIds:{bsd:'2489842'},homeTeam:'FC Emmen',awayTeam:'TOP Oss',
    league:'Dutch Eerste Divisie',kickoff:'2026-09-26T18:00:00Z'};
  const result={fixtureId:'2489842',homeTeam:'FC Emmen',awayTeam:'TOP Oss',
    league:'Dutch Eerste Divisie',kickoff:snapshot.kickoff,canonicalProvider:'sportsdb'};
  assert.equal(exactProviderMatch(result,snapshot,'bsd'),false);
  assert.equal(exactProviderMatch({...result,canonicalProvider:'bsd'},snapshot,'bsd'),true);
});

test('same teams and kickoff in a different registered competition do not settle',()=>{
  const snapshot={homeTeam:'FC Emmen',awayTeam:'TOP Oss',league:'Dutch Eerste Divisie',kickoff:'2026-09-26T18:00:00Z'};
  assert.equal(resultIdentityMatches({...snapshot,league:'Netherlands Eredivisie'},snapshot),false);
  assert.equal(resultIdentityMatches(snapshot,snapshot),true);
});
