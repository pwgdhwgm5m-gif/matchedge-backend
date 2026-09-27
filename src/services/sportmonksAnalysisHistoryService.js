const cache = require('../utils/cache');
const sportmonks = require('./sportmonksService');
const {normalizeTeamIdentity} = require('./competitionRegistryService');

const bounded = (promise, ms) => Promise.race([
  promise.catch(() => ({ok:false})),
  new Promise(resolve => setTimeout(() => resolve({ok:false,error:'timeout'}),ms)),
]);

function verifiedFixture(match, {homeTeamName,awayTeamName,kickoff,leagueId}) {
  const expected=Date.parse(kickoff||'');
  const observed=Date.parse(match?.kickoff||'');
  return Boolean(match?.sportmonksId && match.homeTeamId && match.awayTeamId &&
    String(match.leagueId)===String(leagueId) &&
    normalizeTeamIdentity(match.homeTeam)===normalizeTeamIdentity(homeTeamName) &&
    normalizeTeamIdentity(match.awayTeam)===normalizeTeamIdentity(awayTeamName) &&
    Number.isFinite(expected) && Number.isFinite(observed) &&
    Math.abs(expected-observed)<=15*60000);
}

function toForm(fixtures, teamId, kickoff) {
  if(teamId==null)return null;
  const cutoff=Date.parse(kickoff||'');
  if(!Number.isFinite(cutoff))return null;
  const rows=(Array.isArray(fixtures)?fixtures:[]).filter(f=>{
    const time=Date.parse(f.kickoff||'');
    const home=String(f.homeTeamId||'')===String(teamId);
    const away=String(f.awayTeamId||'')===String(teamId);
    return home!==away && Number.isFinite(time) && time<cutoff && f.statusShort==='FT' &&
      Number.isFinite(Number(f.homeScore)) && Number.isFinite(Number(f.awayScore)) &&
      f.homeScore!=null && f.awayScore!=null;
  }).sort((a,b)=>Date.parse(b.kickoff)-Date.parse(a.kickoff)).slice(0,15);
  if(!rows.length)return null;
  return {ok:true,source:'sportmonks',teamId:String(teamId),fixtures:rows,
    data:{response:rows.map(f=>({
      fixture:{id:f.sportmonksId,date:f.kickoff},
      teams:{home:{id:f.homeTeamId,name:f.homeTeam},away:{id:f.awayTeamId,name:f.awayTeam}},
      goals:{home:Number(f.homeScore),away:Number(f.awayScore)},
      score:{halftime:{home:f.halftimeHome,away:f.halftimeAway}},
    }))},
    historyAudit:rows.slice(0,5).map(f=>({eventId:f.sportmonksId,date:f.kickoff,
      homeTeam:f.homeTeam,awayTeam:f.awayTeam,homeTeamId:f.homeTeamId,awayTeamId:f.awayTeamId,
      homeScore:f.homeScore,awayScore:f.awayScore,league:f.leagueName}))};
}

async function load({homeTeamName,awayTeamName,kickoff,leagueId}) {
  if(!homeTeamName||!awayTeamName||!kickoff||!leagueId)return null;
  const index=await bounded(cache.getOrFetch(
    `sportmonks:fixture-match:${leagueId}:${String(kickoff).slice(0,10)}:${homeTeamName}:${awayTeamName}`,300,
    () => sportmonks.getFixtureForMatch(homeTeamName,awayTeamName,kickoff,leagueId)),2500);
  const fixture=index.ok?index.fixture:null;
  if(!verifiedFixture(fixture,{homeTeamName,awayTeamName,kickoff,leagueId}))return null;
  const fetchHistory=id=>bounded(cache.getOrFetch(`sportmonks:history:${id}`,1800,
    () => sportmonks.getTeamFixtureHistory(id)),3000);
  const [home,away]=await Promise.all([fetchHistory(fixture.homeTeamId),fetchHistory(fixture.awayTeamId)]);
  return {fixture,
    home:home.ok?toForm(home.fixtures,fixture.homeTeamId,kickoff):null,
    away:away.ok?toForm(away.fixtures,fixture.awayTeamId,kickoff):null};
}

const preferredForm=(primary,fallback)=>primary || fallback();
module.exports={load,verifiedFixture,toForm,preferredForm};
