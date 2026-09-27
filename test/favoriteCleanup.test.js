const test=require('node:test');
const assert=require('node:assert/strict');
const {finishedFavoriteIds,istanbulMidnightUtc}=require('../src/services/favoriteCleanupService');

test('only confirmed finished favorites from a prior Istanbul day are removed',()=>{
  const cutoff=istanbulMidnightUtc('2026-09-28');
  const favorites=[
    {_id:'old',fixtureId:'bsd-10',homeTeam:'Norway',awayTeam:'Portugal'},
    {_id:'other-day',fixtureId:'bsd-10',homeTeam:'Other',awayTeam:'Portugal'},
    {_id:'current',fixtureId:'bsd-11',homeTeam:'Seattle',awayTeam:'Salt Lake'},
    {_id:'upcoming',fixtureId:'bsd-12',homeTeam:'Andorra',awayTeam:'Malta'}
  ];
  const results=[
    {fixtureId:'bsd-10',homeTeam:'Norway',awayTeam:'Portugal',date:'2026-09-27T19:00:00Z',statusShort:'FT',homeScore:1,awayScore:2},
    {fixtureId:'bsd-11',homeTeam:'Seattle',awayTeam:'Salt Lake',kickoff:'2026-09-27T22:00:00Z',statusShort:'FT',homeScore:1,awayScore:0},
    {fixtureId:'bsd-12',homeTeam:'Andorra',awayTeam:'Malta',kickoff:'2026-09-27T18:00:00Z',statusShort:'NS',homeScore:null,awayScore:null}
  ];
  assert.deepEqual(finishedFavoriteIds(favorites,results,[],cutoff),['old']);
});

test('provider aliases require both teams and a matching kickoff',()=>{
  const favorites=[{_id:'same',fixtureId:'sm-1',homeTeam:'Norway',awayTeam:'Portugal'}];
  const result={fixtureId:'bsd-1',homeTeam:'Norway',awayTeam:'Portugal',kickoff:'2026-09-27T18:00:00Z',statusShort:'FT',homeScore:1,awayScore:2};
  const identity={home:'Norway',away:'Portugal',kickoff:'2026-09-27T18:00:00Z',providerIds:{bsd:'bsd-1',sportmonks:'sm-1'}};
  const cutoff=istanbulMidnightUtc('2026-09-28');
  assert.deepEqual(finishedFavoriteIds(favorites,[result],[identity],cutoff),['same']);
  assert.deepEqual(finishedFavoriteIds(favorites,[result],[{...identity,kickoff:'2026-09-28T18:00:00Z'}],cutoff),[]);
  assert.deepEqual(finishedFavoriteIds(favorites,[result],[{...identity,away:'Other'}],cutoff),[]);
});
