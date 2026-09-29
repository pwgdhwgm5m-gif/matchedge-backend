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
    ? {home:{da:s.dangerousAttacksHome,sot:s.shotsOnTargetHome,soff:s.shotsOffTargetHome,att:s.attacksHome,poss:s.possessionHome,
        corners:s.cornersHome,blocked:s.blockedShotsHome,inside:s.shotsInsideBoxHome,chances:s.bigChancesHome},
       away:{da:s.dangerousAttacksAway,sot:s.shotsOnTargetAway,soff:s.shotsOffTargetAway,att:s.attacksAway,poss:s.possessionAway,
        corners:s.cornersAway,blocked:s.blockedShotsAway,inside:s.shotsInsideBoxAway,chances:s.bigChancesAway}}
    : Object.fromEntries(['home','away'].map(side=>[side,{
        da:value(s?.[side],['dangerous_attacks','dangerousAttacks']),
        sot:value(s?.[side],['shots_on_target','shotsOnTarget','shots.on_target']),
        soff:value(s?.[side],['shots_off_target','shotsOffTarget','shots.off_target']),
        att:value(s?.[side],['attacks','total_attacks']),
        poss:value(s?.[side],['possession','ball_possession','possession_percentage']),
        corners:value(s?.[side],['corners','corner_kicks']),
        blocked:value(s?.[side],['blocked_shots','blockedShots']),
        inside:value(s?.[side],['shots_inside_box','shotsInsideBox']),
        chances:value(s?.[side],['big_chances','bigChances'])
      }]));
  if(['home','away'].every(side=>['da','sot','soff','corners','blocked','inside','chances'].every(key=>sides[side][key]==null)))return null;
  const pair=key=>({home:sides.home[key],away:sides.away[key]});
  return {id:String(match.fixtureId),source:match.source,kickoff_utc:kickoff,minute:match.minute,
    teams:{home:{name:match.homeTeam},away:{name:match.awayTeam}},
    score:{home:match.homeScore,away:match.awayScore},
    normalizedStats:{dangerousAttacks:pair('da'),shotsOnTarget:pair('sot'),shotsOffTarget:pair('soff'),attacks:pair('att'),possession:pair('poss'),
      corners:pair('corners'),blockedShots:pair('blocked'),shotsInsideBox:pair('inside'),bigChances:pair('chances')}};
}
module.exports={canonicalSignalFixture};
