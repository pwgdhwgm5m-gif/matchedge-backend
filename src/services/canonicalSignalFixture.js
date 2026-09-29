// Adapt the already fetched goal feeds to the same cumulative live-stat shape
// used by the STRONG signal monitor. Missing measurements stay missing.
const value=(row,keys)=>{
  for(const key of keys){
    const raw=key.split('.').reduce((v,part)=>v?.[part],row);
    if(raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(Number(raw)))return Number(raw);
  }
  return null;
};
function canonicalSignalFixture(match){
  if(!['sportmonks','bsd'].includes(match?.source)||!match.liveStats)return null;
  const kickoff=match.kickoff||match.date;
  if(!Number.isFinite(Date.parse(kickoff||''))||match.minute==null||!match.isLive)return null;
  const s=match.liveStats?.stats||match.liveStats;
  const sides=match.source==='sportmonks'
    ? {home:{da:s.dangerousAttacksHome,sot:s.shotsOnTargetHome,soff:s.shotsOffTargetHome,att:s.attacksHome,poss:s.possessionHome},
       away:{da:s.dangerousAttacksAway,sot:s.shotsOnTargetAway,soff:s.shotsOffTargetAway,att:s.attacksAway,poss:s.possessionAway}}
    : Object.fromEntries(['home','away'].map(side=>[side,{
        da:value(s?.[side],['dangerous_attacks','dangerousAttacks']),
        sot:value(s?.[side],['shots_on_target','shotsOnTarget','shots.on_target']),
        soff:value(s?.[side],['shots_off_target','shotsOffTarget','shots.off_target']),
        att:value(s?.[side],['attacks','total_attacks']),
        poss:value(s?.[side],['possession','ball_possession','possession_percentage'])
      }]));
  // A missing pressure or shot series cannot establish a recent-window surge.
  if(sides.home.da==null&&sides.away.da==null)return null;
  if(sides.home.sot==null&&sides.away.sot==null)return null;
  const pair=key=>({home:sides.home[key],away:sides.away[key]});
  return {id:String(match.fixtureId),source:match.source,kickoff_utc:kickoff,minute:match.minute,
    teams:{home:{name:match.homeTeam},away:{name:match.awayTeam}},
    score:{home:match.homeScore,away:match.awayScore},
    normalizedStats:{dangerousAttacks:pair('da'),shotsOnTarget:pair('sot'),shotsOffTarget:pair('soff'),attacks:pair('att'),possession:pair('poss')}};
}
module.exports={canonicalSignalFixture};
