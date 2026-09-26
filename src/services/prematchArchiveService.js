const Archive = require('../models/PrematchAnalysisArchive');
const cache = require('../utils/cache');
const {normalizeTeamIdentity} = require('./competitionRegistryService');

const TTL_SECONDS=48*60*60;
const keyForId=id=>`prematch-archive:id:${String(id)}`;
const precomputedKey=({fixtureId,homeTeam,awayTeam,kickoff})=>{
  const home=normalizeTeamIdentity(homeTeam),away=normalizeTeamIdentity(awayTeam);
  const time=kickoff?validDate(kickoff)?.toISOString()||'':'';
  return fixtureId&&home&&away&&time?`precomputed:v2:${String(fixtureId)}:${home}:${away}:${time}`:null;
};
const validDate=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date:null};
const matches=(row,context)=>{
  if(!row||!row.analysis||!row.kickoff||!row.capturedAt)return false;
  const kickoff=validDate(row.kickoff), captured=validDate(row.capturedAt);
  if(!kickoff||!captured||captured>kickoff)return false;
  if(context.homeTeam&&normalizeTeamIdentity(context.homeTeam)!==row.homeKey)return false;
  if(context.awayTeam&&normalizeTeamIdentity(context.awayTeam)!==row.awayKey)return false;
  const requested=validDate(context.kickoff);
  if(requested&&Math.abs(requested-kickoff)>3*60*60*1000)return false;
  return true;
};

async function capture(analysis,fixture){
  const kickoff=validDate(fixture.kickoff), now=new Date();
  const homeKey=normalizeTeamIdentity(fixture.homeTeam),awayKey=normalizeTeamIdentity(fixture.awayTeam);
  if(!analysis||!fixture.fixtureId||!homeKey||!awayKey||!kickoff||now>=kickoff)return false;
  const archived=JSON.parse(JSON.stringify(analysis));
  const row={sourceFixtureId:String(fixture.fixtureId),canonicalProvider:String(fixture.canonicalProvider||''),
    homeKey,awayKey,homeTeam:fixture.homeTeam,awayTeam:fixture.awayTeam,
    league:fixture.league||'',kickoff,capturedAt:now,analysis:archived};
  await Archive.updateOne({sourceFixtureId:row.sourceFixtureId,homeKey,awayKey,kickoff},{$set:row},{upsert:true});
  cache.set(keyForId(row.sourceFixtureId),row,TTL_SECONDS);
  return true;
}

async function find(context){
  const id=String(context.fixtureId||'');
  const cached=id&&cache.get(keyForId(id));
  if(matches(cached,context))return {...cached,source:'prematch-cache'};
  const kickoff=validDate(context.kickoff);
  const window=kickoff?{kickoff:{$gte:new Date(kickoff.getTime()-3*60*60*1000),
    $lte:new Date(kickoff.getTime()+3*60*60*1000)}}:{};
  const homeKey=normalizeTeamIdentity(context.homeTeam),awayKey=normalizeTeamIdentity(context.awayTeam);
  const pair=homeKey&&awayKey&&kickoff?{homeKey,awayKey,...window}:null;
  const queries=[id?{sourceFixtureId:id,...window}:null,pair].filter(Boolean);
  for(const query of queries){
    const rows=await Archive.find(query).sort({capturedAt:-1}).limit(10).lean();
    const row=rows.find(candidate=>matches(candidate,context));
    if(row){cache.set(keyForId(row.sourceFixtureId),row,TTL_SECONDS);return {...row,source:'durable-prematch-cache'};}
  }
  return null;
}

module.exports={capture,find,precomputedKey};
