const { SPORTMONKS_PRIMARY } = require('./sourcePolicyService');

const subscribedLeagueIds = new Set(SPORTMONKS_PRIMARY.map(row=>String(row.sportmonksId)));

function hasTrackedSportmonksFixture(identities, now=Date.now()) {
  return (identities||[]).some(row=>{
    const kickoff=Date.parse(row.kickoff||'');
    return Boolean(row.providerIds?.sportmonks) && Number.isFinite(kickoff) &&
      kickoff>=now-4*60*60*1000 && kickoff<=now+15*60*1000;
  });
}

function sportmonksGoalMatches(fixtures) {
  return (fixtures||[]).filter(row=>
    subscribedLeagueIds.has(String(row.leagueId)) && row.isLive===true &&
    row.sportmonksId!=null && row.homeTeam && row.awayTeam &&
    row.homeScore!=null && row.awayScore!=null &&
    Number.isFinite(Number(row.homeScore)) && Number.isFinite(Number(row.awayScore))
  ).map(row=>({
    fixtureId:String(row.sportmonksId), source:'sportmonks',
    providerIds:{sportmonks:String(row.sportmonksId)},
    leagueId:row.leagueId, kickoff:row.kickoff,
    homeTeam:row.homeTeam, awayTeam:row.awayTeam,
    homeScore:Number(row.homeScore), awayScore:Number(row.awayScore),
    statusShort:row.statusShort||'LIVE', isLive:true
  }));
}

module.exports={hasTrackedSportmonksFixture,sportmonksGoalMatches};
