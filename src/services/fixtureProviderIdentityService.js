const cache = require('../utils/cache');
const sportsDb = require('./sportsDbService');
const bsd = require('./bsdService');
const { acceptsLiveFixture, providerKey } = require('./liveFixtureIdentity');

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
  const key=`verified-fixture-provider:v1:${fixtureId}:${leagueName}:${homeTeamName}:${awayTeamName}:${kickoff}`;
  const result=await cache.getOrFetch(key,600,async()=>{
    const timeout=p=>Promise.race([p,new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
    const [tsdbResult,bsdResult]=await Promise.all([
      timeout(sportsDb.getEventById(fixtureId)).catch(()=>null),
      timeout(bsd.getEventById(fixtureId)).catch(()=>null)
    ]);
    const raw=tsdbResult?.data?.events?.find(e=>String(e.idEvent)===String(fixtureId));
    const sportsdb=raw && acceptsLiveFixture(sportsDb.transformEvent(raw),'sportsdb',context);
    const bsdMatch=bsdResult?.available && String(bsdResult.match?.bsdEventId||bsdResult.match?.fixtureId)===String(fixtureId) &&
      acceptsLiveFixture(bsdResult.match,'bsd',context);
    return {ok:true,choices:[sportsdb && {provider:'sportsdb',id:String(fixtureId)},bsdMatch && {provider:'bsd',id:String(fixtureId)}].filter(Boolean)};
  });
  return chooseVerifiedCandidate(result.choices||[],preferred);
}

module.exports={verifiedFixtureProvider,chooseVerifiedCandidate};
