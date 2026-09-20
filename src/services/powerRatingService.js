const BASE=1500;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const expected=(a,b)=>1/(1+Math.pow(10,(b-a)/400));
const score=(gf,ga)=>gf>ga?1:gf===ga?.5:0;
function buildElo(fixtures,options={}){
 const K=Number(options.k||24),homeAdv=Number(options.homeAdvantage||55);
 const rows=[...(fixtures||[])].filter(f=>Number.isFinite(Number(f?.goals?.home))&&Number.isFinite(Number(f?.goals?.away))).sort((a,b)=>new Date(a.fixture?.date||0)-new Date(b.fixture?.date||0));
 const ratings=new Map(),games=new Map(),get=id=>ratings.get(String(id))||BASE;
 for(const f of rows){const h=String(f.teams?.home?.id??''),a=String(f.teams?.away?.id??'');if(!h||!a)continue;const rh=get(h),ra=get(a),eh=expected(rh+homeAdv,ra),s=score(Number(f.goals.home),Number(f.goals.away)),margin=Math.abs(Number(f.goals.home)-Number(f.goals.away)),mult=1+Math.min(.55,Math.log1p(margin)*.28),delta=K*mult*(s-eh);ratings.set(h,rh+delta);ratings.set(a,ra-delta);games.set(h,(games.get(h)||0)+1);games.set(a,(games.get(a)||0)+1);}
 return {rating:id=>+get(id).toFixed(1),games:id=>games.get(String(id))||0};
}
function matchupMultiplier(hr,ar,hg=0,ag=0){const sample=Math.min(1,Math.min(hg,ag)/12),gap=clamp((Number(hr)-Number(ar))/400,-1,1),effect=.07*sample*gap;return {home:+clamp(1+effect,.93,1.07).toFixed(4),away:+clamp(1-effect,.93,1.07).toFixed(4),sample:+sample.toFixed(3),gap:+gap.toFixed(3)};}
module.exports={buildElo,matchupMultiplier,BASE};

async function loadPersistent(league,teamId){
 try{const PowerRating=require('../models/PowerRating');return await PowerRating.findOne({league:String(league||''),teamId:String(teamId)}).lean();}catch(_){return null;}
}
async function persistFromMatch({league,season,fixtureId,kickoff,home,away,homeGoals,awayGoals}){
 try{
  const PowerRating=require('../models/PowerRating'); if(!home?.id||!away?.id)return null;
  const [h,a]=await Promise.all([PowerRating.findOne({league:String(league),teamId:String(home.id)}),PowerRating.findOne({league:String(league),teamId:String(away.id)})]);
  const hr=h?.elo||BASE,ar=a?.elo||BASE,eh=expected(hr+55,ar),s=score(Number(homeGoals),Number(awayGoals)),margin=Math.abs(Number(homeGoals)-Number(awayGoals)),delta=24*(1+Math.min(.55,Math.log1p(margin)*.28))*(s-eh);
  const update=(doc,team,elo,gf,ga)=>({league:String(league),teamId:String(team.id),teamName:team.name||'',elo:+elo.toFixed(1),attack:+clamp(((doc?.attack||1)*(doc?.games||0)+clamp((gf+0.35)/1.7,.45,1.8))/((doc?.games||0)+1),.45,1.8).toFixed(3),defense:+clamp(((doc?.defense||1)*(doc?.games||0)+clamp(1.7/(ga+0.35),.45,1.8))/((doc?.games||0)+1),.45,1.8).toFixed(3),games:(doc?.games||0)+1,lastFixtureId:String(fixtureId),lastMatchAt:kickoff?new Date(kickoff):new Date(),season:String(season||'')});
  const hu=update(h,home,hr+delta,Number(homeGoals),Number(awayGoals)),au=update(a,away,ar-delta,Number(awayGoals),Number(homeGoals));
  await Promise.all([PowerRating.findOneAndUpdate({league:hu.league,teamId:hu.teamId},{$set:hu},{upsert:true,new:true}),PowerRating.findOneAndUpdate({league:au.league,teamId:au.teamId},{$set:au},{upsert:true,new:true})]);return {home:hu,away:au};
 }catch(_){return null;}
}
module.exports.loadPersistent=loadPersistent;module.exports.persistFromMatch=persistFromMatch;
