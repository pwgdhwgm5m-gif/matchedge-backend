const {estimateLiveXg,calculateGoalProximity}=require('./liveXgService');

// Use the same goal-proximity calculation as the live match screen. Missing
// observations remain null; possession and attacks alone do not create a goal signal.
function goalProximitySignal(stats,context={}){
  const sideStats=side=>Object.fromEntries(
    ['shotsOnTarget','shotsOffTarget','corners','dangerousAttacks','attacks','blockedShots','shotsInsideBox','bigChances']
      .map(field=>{
        const raw=stats?.[field]?.[side];
        return [field,raw==null||raw===''||!Number.isFinite(Number(raw))?null:Math.max(0,Number(raw))];
      }));
  const home=sideStats('home'),away=sideStats('away');
  const evidence=['shotsOnTarget','shotsOffTarget','corners','dangerousAttacks','blockedShots','shotsInsideBox','bigChances']
    .reduce((sum,field)=>sum+(home[field]||0)+(away[field]||0),0);
  if(!evidence)return {proximity:{home:null,away:null,available:false},qualified:{home:false,away:false}};
  const estimatedHome=estimateLiveXg(home),estimatedAway=estimateLiveXg(away);
  const proximity=calculateGoalProximity(home,away,
    estimatedHome.available?estimatedHome.value:null,
    estimatedAway.available?estimatedAway.value:null,{
      possessionHome:stats?.possession?.home==null?null:Number(stats.possession.home),
      possessionAway:stats?.possession?.away==null?null:Number(stats.possession.away),
      ...context
    });
  return {proximity,qualified:{home:proximity.available&&proximity.home>80,away:proximity.available&&proximity.away>80}};
}
function confirmedGoalProximity(previous,current,side){
  return Boolean(previous?.qualified?.[side]&&current?.qualified?.[side]&&previous.fetchedAt!==current.fetchedAt);
}
module.exports={goalProximitySignal,confirmedGoalProximity};
