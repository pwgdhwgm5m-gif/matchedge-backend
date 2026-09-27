const {normalizeTeamIdentity}=require('./competitionRegistryService');

const idsOf=row=>[...new Set(Object.values(row?.providerIds||{}).filter(Boolean).map(String))];
const kickoffOf=row=>Date.parse(row?.kickoff||row?.date||'');
function sameFixture(identity,match) {
  const left=kickoffOf(identity),right=kickoffOf(match);
  return Number.isFinite(left)&&Number.isFinite(right)&&Math.abs(left-right)<=15*60000 &&
    normalizeTeamIdentity(identity.home)===normalizeTeamIdentity(match.homeTeam) &&
    normalizeTeamIdentity(identity.away)===normalizeTeamIdentity(match.awayTeam);
}
function uniqueIdentity(rows,fixtureId,match) {
  const found=(rows||[]).filter(row=>idsOf(row).includes(String(fixtureId))&&sameFixture(row,match));
  return found.length===1?found[0]:null;
}
function uniqueTrackedIdentity(rows,row,now=Date.now()) {
  const found=(rows||[]).filter(identity=>{
    if(!idsOf(identity).includes(String(row.fixtureId)))return false;
    const kickoff=kickoffOf(identity),tracked=kickoffOf(row);
    if(!Number.isFinite(kickoff)||Math.abs(kickoff-now)>4*60*60*1000)return false;
    if(Number.isFinite(tracked)&&Math.abs(kickoff-tracked)>15*60000)return false;
    return normalizeTeamIdentity(identity.home)===normalizeTeamIdentity(row.homeTeam) &&
      normalizeTeamIdentity(identity.away)===normalizeTeamIdentity(row.awayTeam);
  });
  return found.length===1?found[0]:null;
}
function attachAliases(tracked,identities,now=Date.now()) {
  const all=new Map([...tracked.all].map(([id,users])=>[id,new Set(users)]));
  const coupons=new Map([...tracked.coupons].map(([id,users])=>[id,new Set(users)]));
  for(const row of tracked.trackedRows||[]){
    const identity=uniqueTrackedIdentity(identities,row,now);
    if(!identity)continue;
    for(const id of idsOf(identity)){
      if(!all.has(id))all.set(id,new Set());
      all.get(id).add(String(row.userId));
      if(row.coupon){if(!coupons.has(id))coupons.set(id,new Set());coupons.get(id).add(String(row.userId));}
    }
  }
  return {...tracked,all,coupons,identities};
}
function goalMatchKey(identities,match) {
  const identity=uniqueIdentity(identities,match.fixtureId,match);
  return identity?.canonicalKey || `${match.source||match.canonicalProvider||'unknown'}:${String(match.fixtureId)}`;
}
function nextGoalScore(previous,home,away,isLive) {
  const total=home+away;
  if(previous && total<previous.total)return {score:previous,advanced:false};
  return {score:{home,away,total,started:Boolean(previous?.started||isLive)},
    advanced:Boolean(previous&&total>previous.total)};
}
module.exports={sameFixture,uniqueIdentity,uniqueTrackedIdentity,attachAliases,goalMatchKey,nextGoalScore};
