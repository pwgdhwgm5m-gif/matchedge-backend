const cache = require('../utils/cache');
const sportsDb = require('./sportsDbService');
const bsd = require('./bsdService');
const { acceptsLiveFixture, providerKey } = require('./liveFixtureIdentity');
const providerIdentity = require('./providerIdentityCache');

function chooseVerifiedCandidate(choices, preferred) {
  if (choices.length===1) return choices[0];
  if (choices.length>1 && providerKey(preferred)) return choices.find(x=>x.provider===providerKey(preferred))||null;
  return null;
}

async function verifiedFixtureProvider({fixtureId,homeTeamName,awayTeamName,leagueName,kickoff,provider,sportmonksId}) {
  // A matched SportMonks fixture can be a cross-provider alias. It does not
  // establish that the requested numeric event ID belongs to SportMonks.
  if (sportmonksId && String(sportmonksId)===String(fixtureId)) return {provider:'sportmonks',id:String(fixtureId)};
  if (!fixtureId || !homeTeamName || !awayTeamName || !kickoff) return null;
  const context={homeTeamName,awayTeamName,leagueName,kickoff};
  const preferred=providerKey(provider);
  // Numeric IDs are scoped to one provider. Never probe the same ID at both
  // endpoints to guess its owner; absent provenance must remain unresolved.
  if(!preferred)return null;
  const competition=require('./competitionRegistryService').resolveCompetition({leagueName});
  const known=await providerIdentity.lookup({homeTeam:homeTeamName,awayTeam:awayTeamName,
    kickoff,canonicalCompetitionKey:competition?.canonicalCompetitionKey,
    canonicalProvider:preferred,providerIds:{[preferred]:String(fixtureId)}}).catch(()=>null);
  if(known?.providerIds?.[preferred]===String(fixtureId))return {provider:preferred,id:String(fixtureId)};
  const key=`verified-fixture-provider:v2:${preferred}:${fixtureId}:${leagueName}:${homeTeamName}:${awayTeamName}:${kickoff}`;
  const result=await cache.getOrFetch(key,600,async()=>{
    const timeout=p=>Promise.race([p,new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
    const tsdbResult=preferred==='sportsdb' ? await timeout(sportsDb.getEventById(fixtureId)).catch(()=>null) : null;
    const bsdResult=preferred==='bsd' ? await timeout(bsd.getEventById(fixtureId)).catch(()=>null) : null;
    const raw=tsdbResult?.data?.events?.find(e=>String(e.idEvent)===String(fixtureId));
    const sportsdb=raw && acceptsLiveFixture(sportsDb.transformEvent(raw),'sportsdb',context);
    const bsdMatch=bsdResult?.available && String(bsdResult.match?.bsdEventId||bsdResult.match?.fixtureId)===String(fixtureId) &&
      acceptsLiveFixture(bsdResult.match,'bsd',context);
    return {ok:true,choices:[sportsdb && {provider:'sportsdb',id:String(fixtureId)},bsdMatch && {provider:'bsd',id:String(fixtureId)}].filter(Boolean)};
  });
  return chooseVerifiedCandidate(result.choices||[],preferred);
}

module.exports={verifiedFixtureProvider,chooseVerifiedCandidate};
