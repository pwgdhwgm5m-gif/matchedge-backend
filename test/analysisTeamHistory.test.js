const test=require('node:test');
const assert=require('node:assert/strict');
const {verifiedHistory}=require('../src/services/analysisTeamHistoryService');
const {dedupeCompetitionFixtures}=require('../src/services/competitionRegistryService');
const {dedupePrecomputeFixtures}=require('../src/cron/precomputeJob');
const {teamIdsOf}=require('../src/services/providerIdentityCache');
const sportsDb=require('../src/services/sportsDbService');

const kickoff='2026-09-27T12:30:00Z';
const fixture=(id,home,away,homeId,awayId,date='2026-09-20T12:30:00Z')=>({
  fixture:{id,date},teams:{home:{id:homeId,name:home},away:{id:awayId,name:away}},
  goals:{home:2,away:1},score:{halftime:{home:1,away:0}}
});

test('BSD history is counted with its own team ID, never the SportsDB fixture/team ID',()=>{
  const bsd={ok:true,source:'bsd',data:{response:[fixture('bsd:1','FC Den Bosch','Helmond Sport','bsd:team:9','bsd:team:8')]}};
  const result=verifiedHistory(bsd,'Den Bosch',kickoff);
  assert.equal(result.teamId,'bsd:team:9');
  assert.equal(result.verifiedPlayed,1);
  assert.notEqual(result.teamId,'134236');
});

test('ambiguous IDs, unrelated names and future fixtures cannot become team history',()=>{
  const valid=fixture('1','FC Den Bosch','Helmond Sport','101','202');
  const conflicting=fixture('2','FC Den Bosch','TOP Oss','999','303');
  assert.equal(verifiedHistory({ok:true,data:{response:[valid,conflicting]}},'Den Bosch',kickoff),null);
  assert.equal(verifiedHistory({ok:true,data:{response:[valid]}},'Ajax',kickoff),null);
  assert.equal(verifiedHistory({ok:true,data:{response:[{...valid,fixture:{id:'3',date:kickoff}}]}},'Den Bosch',kickoff),null);
});

test('merged fixture keeps event and team IDs scoped to their own providers',()=>{
  const base={homeTeam:'De Graafschap',awayTeam:'Den Bosch',league:'Dutch Eerste Divisie',
    kickoff,canonicalCompetitionKey:'netherlands-eerste-divisie'};
  const rows=dedupeCompetitionFixtures([
    {...base,fixtureId:'bsd:fixture',canonicalProvider:'bsd',homeTeamId:'bsd:h',awayTeamId:'bsd:a',
      providerIds:{bsd:'bsd:fixture'}},
    {...base,fixtureId:'2489847',canonicalProvider:'sportsdb',homeTeamId:'133771',awayTeamId:'134236',
      providerIds:{sportsdb:'2489847'}}
  ],{preferBsd:true});
  assert.equal(rows.length,1);
  assert.equal(rows[0].providerIds.bsd,'bsd:fixture');
  assert.equal(rows[0].providerIds.sportsdb,'2489847');
  assert.deepEqual(teamIdsOf(rows[0]).bsd,{home:'bsd:h',away:'bsd:a'});
  assert.deepEqual(teamIdsOf(rows[0]).sportsdb,{home:'133771',away:'134236'});
});

test('precompute retains both event IDs when BSD wins the fixture',()=>{
  const base={homeTeamName:'De Graafschap',awayTeamName:'Den Bosch',leagueName:'Dutch Eerste Divisie',kickoff};
  const rows=dedupePrecomputeFixtures([
    {...base,fixtureId:'2489847',canonicalProvider:'sportsdb',home:'133771',away:'134236'},
    {...base,fixtureId:'bsd:fixture',canonicalProvider:'bsd'}]);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].providerIds,{sportsdb:'2489847',bsd:'bsd:fixture'});
  assert.deepEqual(rows[0].providerTeamIds.sportsdb,{home:'133771',away:'134236'});
  const rematch=dedupePrecomputeFixtures([
    {...base,fixtureId:'2489847',canonicalProvider:'sportsdb'},
    {...base,fixtureId:'2489900',canonicalProvider:'sportsdb',kickoff:'2026-09-27T18:30:00Z'}]);
  assert.equal(rematch.length,2);
});

test('six-league precompute retains SportMonks as the fixture and keeps provider-native team IDs',()=>{
  const base={homeTeamName:'Manchester City',awayTeamName:'Arsenal',leagueName:'Premier League',
    kickoff:'2026-09-27T16:00:00Z'};
  const rows=dedupePrecomputeFixtures([
    {...base,fixtureId:'sm:fixture',canonicalProvider:'sportmonks',home:'sm:h',away:'sm:a'},
    {...base,fixtureId:'db:fixture',canonicalProvider:'sportsdb',home:'db:h',away:'db:a'},
  ]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].canonicalProvider,'sportmonks');
  assert.deepEqual(rows[0].providerIds,{sportmonks:'sm:fixture',sportsdb:'db:fixture'});
  assert.deepEqual(rows[0].providerTeamIds.sportmonks,{home:'sm:h',away:'sm:a'});
  assert.deepEqual(rows[0].providerTeamIds.sportsdb,{home:'db:h',away:'db:a'});
});

test('SportsDB uses a cached league season for a missing team schedule without crossing team IDs',async()=>{
  const originalFetch=global.fetch,paths=[];
  global.fetch=async url=>{
    paths.push(String(url));
    const event={idEvent:'2489838',strTimestamp:'2026-09-18T18:00:00Z',
      idHomeTeam:'134236',idAwayTeam:'136191',strHomeTeam:'FC Den Bosch',strAwayTeam:'FC Emmen',
      intHomeScore:'2',intAwayScore:'1',strStatus:'FT'};
    const data=String(url).includes('/schedule/league/4641/') ? {schedule:[event]} :
      String(url).includes('eventspastleague.php') ? {events:[]} :
      String(url).includes('eventslast.php') ? {results:[]} : {schedule:[]};
    return {ok:true,json:async()=>data};
  };
  try{
    const r=await sportsDb.getTeamFixturesForAnalysis('Den Bosch',null,15,'4641',
      {verifiedTeamId:'134236',kickoff});
    assert.equal(r.source,'sportsdb-league-season');
    assert.equal(r.teamId,'134236');
    assert.equal(r.data.response.length,1);
    assert.equal(paths.filter(x=>x.includes('/schedule/league/4641/')).length,1);
    assert.equal(paths.some(x=>x.includes('searchteams.php')),false);
  }finally{global.fetch=originalFetch;}
});
