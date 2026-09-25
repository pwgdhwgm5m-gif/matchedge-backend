const test=require('node:test');
const assert=require('node:assert/strict');
const Archive=require('../src/models/PrematchAnalysisArchive');
const archive=require('../src/services/prematchArchiveService');

test('keeps the full pre-kickoff analysis and resolves a different live provider ID',async()=>{
  const originalUpdate=Archive.updateOne, originalFind=Archive.find;
  let saved;
  Archive.updateOne=async(_query,update)=>{saved=update.$set;return {upsertedCount:1};};
  Archive.find=query=>({sort:()=>({limit:()=>({lean:async()=>
    query.homeKey===saved?.homeKey&&query.awayKey===saved?.awayKey?[saved]:[]})})});
  try{
    const kickoff=new Date(Date.now()+60*60*1000).toISOString();
    const analysis={matchProbabilities:{homeWinProbability:47},marketBoard:{allMarkets:[{key:'bttsYes',probability:55}]}};
    assert.equal(await archive.capture(analysis,{fixtureId:'sportsdb-123',canonicalProvider:'sportsdb',
      homeTeam:'FC Dordrecht',awayTeam:'Almere City',league:'Eerste Divisie',kickoff}),true);
    analysis.marketBoard.allMarkets[0].probability=1;
    const found=await archive.find({fixtureId:'bsd-999',homeTeam:'Dordrecht',awayTeam:'Almere City',kickoff});
    assert.equal(found.source,'durable-prematch-cache');
    assert.equal(found.analysis.marketBoard.allMarkets[0].probability,55);
    assert.ok(found.capturedAt<new Date(kickoff));
    assert.equal(await archive.find({fixtureId:'bsd-999',homeTeam:'Dordrecht',awayTeam:'Different Club',kickoff}),null);
    assert.equal(await archive.capture(analysis,{fixtureId:'already-live',homeTeam:'Home',awayTeam:'Away',
      kickoff:new Date(Date.now()-1000).toISOString()}),false);
  }finally{Archive.updateOne=originalUpdate;Archive.find=originalFind;}
});
