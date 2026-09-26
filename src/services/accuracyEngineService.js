const cache = require('../utils/cache');
const sportsDb = require('./sportsDbService');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function normalizeProviderMetric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function cachedEventStats(eventId) {
  if (!eventId) return null;
  return cache.getOrFetch('accuracy:eventstats:' + eventId, 6*60*60, async () => {
    const r = await sportsDb.getEventStatsFormatted(eventId);
    return r && r.available ? r.stats : null;
  });
}
async function teamAdvancedForm(fixtures, teamId, limit=8) {
  // Team schedules arrive newest first. Select the latest completed events,
  // independent of the provider's original ordering.
  const finished=(fixtures||[]).filter(f=>f?.fixture?.id && f?.goals?.home!=null)
    .sort((a,b)=>(Date.parse(b.fixture?.date)||0)-(Date.parse(a.fixture?.date)||0))
    .slice(0,limit);
  const rows=await Promise.all(finished.map(async f=>{
    const s=await cachedEventStats(f.fixture.id); if(!s) return null;
    const isHome=String(f.teams?.home?.id)===String(teamId);
    const pick=(obj,own)=>{ if(!obj)return null; const v=isHome?obj[own?'home':'away']:obj[own?'away':'home']; return normalizeProviderMetric(v); };
    return {xgFor:pick(s.xg,true),xgAgainst:pick(s.xg,false),cornersFor:pick(s.corners,true),cornersAgainst:pick(s.corners,false),shotsFor:pick(s.totalShots,true),sotFor:pick(s.shotsOnTarget,true)};
  }));
  const valid=rows.filter(Boolean);
  const avg=k=>{const v=valid.map(r=>r[k]).filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
  return {sample:valid.length,xgSample:valid.filter(r=>Number.isFinite(r.xgFor)&&Number.isFinite(r.xgAgainst)).length,cornerSample:valid.filter(r=>Number.isFinite(r.cornersFor)&&Number.isFinite(r.cornersAgainst)).length,avgXgFor:avg('xgFor'),avgXgAgainst:avg('xgAgainst'),avgCornersFor:avg('cornersFor'),avgCornersAgainst:avg('cornersAgainst'),avgShotsFor:avg('shotsFor'),avgSotFor:avg('sotFor')};
}
async function leagueBaselines(tsdbLeagueId,season){
  if(!tsdbLeagueId||!season)return null;
  return cache.getOrFetch('accuracy:league:'+tsdbLeagueId+':'+season,12*60*60,async()=>{
    const r=await sportsDb.getLeagueSeasonScheduleFormatted(tsdbLeagueId,season);
    const games=(r?.events||[]).filter(e=>e.finished&&Number.isFinite(e.homeScore)&&Number.isFinite(e.awayScore));
    if(games.length<10)return null;
    const h=games.reduce((n,e)=>n+e.homeScore,0)/games.length,a=games.reduce((n,e)=>n+e.awayScore,0)/games.length;
    return {sample:games.length,homeGoals:h,awayGoals:a,totalGoals:h+a};
  });
}
function blendLambda(goalLambda,own,opp,leagueGoalBase){
  if(!own||!opp||own.xgSample<3||opp.xgSample<3)return goalLambda;
  if(!Number.isFinite(own.avgXgFor)||!Number.isFinite(opp.avgXgAgainst))return goalLambda;
  const xg=clamp((own.avgXgFor+opp.avgXgAgainst)/2,.2,3.8),sample=Math.min(own.xgSample,opp.xgSample),w=sample>=7?.45:sample>=5?.35:.25;
  const normalized=leagueGoalBase?xg*clamp(goalLambda/leagueGoalBase,.8,1.2):xg;
  return +(goalLambda*(1-w)+normalized*w).toFixed(2);
}
function cornerProjection(home,away){
  if(!home||!away||home.cornerSample<3||away.cornerSample<3)return null;
  const h=(home.avgCornersFor+away.avgCornersAgainst)/2,a=(away.avgCornersFor+home.avgCornersAgainst)/2;
  if(![h,a].every(Number.isFinite))return null;
  return {homeExpected:+h.toFixed(2),awayExpected:+a.toFixed(2),totalExpected:+(h+a).toFixed(2),sample:Math.min(home.cornerSample,away.cornerSample)};
}
module.exports={teamAdvancedForm,leagueBaselines,blendLambda,cornerProjection,normalizeProviderMetric};
