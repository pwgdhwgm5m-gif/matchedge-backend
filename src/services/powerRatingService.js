const BASE=1500;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const expected=(a,b)=>1/(1+Math.pow(10,(b-a)/400));
const score=(gf,ga)=>gf>ga?1:gf===ga?.5:0;
function buildElo(fixtures,options={}){
 const K=Number(options.k||24),homeAdv=Number(options.homeAdvantage||55);
 const rows=[...(fixtures||[])].filter(f=>f?.goals?.home!=null&&f?.goals?.away!=null&&Number.isFinite(Number(f.goals.home))&&Number.isFinite(Number(f.goals.away))).sort((a,b)=>new Date(a.fixture?.date||0)-new Date(b.fixture?.date||0));
 const ratings=new Map(),games=new Map(),get=id=>ratings.get(String(id))||BASE;
 for(const f of rows){const h=String(f.teams?.home?.id??''),a=String(f.teams?.away?.id??'');if(!h||!a)continue;const rh=get(h),ra=get(a),eh=expected(rh+homeAdv,ra),s=score(Number(f.goals.home),Number(f.goals.away)),margin=Math.abs(Number(f.goals.home)-Number(f.goals.away)),mult=1+Math.min(.55,Math.log1p(margin)*.28),delta=K*mult*(s-eh);ratings.set(h,rh+delta);ratings.set(a,ra-delta);games.set(h,(games.get(h)||0)+1);games.set(a,(games.get(a)||0)+1);}
 return {rating:id=>+get(id).toFixed(1),games:id=>games.get(String(id))||0};
}
function matchupMultiplier(hr,ar,hg=0,ag=0){const sample=Math.min(1,Math.min(hg,ag)/12),gap=clamp((Number(hr)-Number(ar))/400,-1,1),effect=.07*sample*gap;return {home:+clamp(1+effect,.93,1.07).toFixed(4),away:+clamp(1-effect,.93,1.07).toFixed(4),sample:+sample.toFixed(3),gap:+gap.toFixed(3)};}
module.exports={buildElo,matchupMultiplier,BASE};

async function loadPersistent(league,teamId){
 try{const PowerRating=require('../models/PowerRating');return await PowerRating.findOne({league:String(league||''),teamId:String(teamId)}).lean();}catch(_){return null;}
}
async function persistFromMatch({league,season,fixtureId,kickoff,home,away,homeGoals,awayGoals,homeXg=null,awayXg=null}){
 try{
  const PowerRating=require('../models/PowerRating'); if(!home?.id||!away?.id||homeGoals==null||awayGoals==null)return null;
  const PowerRatingEvent=require('../models/PowerRatingEvent');
  const eventKey={league:String(league||''),fixtureId:String(fixtureId)};
  try{await PowerRatingEvent.create({...eventKey,kickoff:kickoff?new Date(kickoff):null,homeTeamId:String(home.id),awayTeamId:String(away.id)});}
  catch(e){if(e?.code===11000)return {skipped:true,reason:'already_processed'};throw e;}
  const [h,a]=await Promise.all([PowerRating.findOne({league:String(league),teamId:String(home.id)}),PowerRating.findOne({league:String(league),teamId:String(away.id)})]);
  if((h?.lastFixtureId&&String(h.lastFixtureId)===String(fixtureId))||(a?.lastFixtureId&&String(a.lastFixtureId)===String(fixtureId)))return {skipped:true,reason:'already_processed'};
  const hr=h?.elo||BASE,ar=a?.elo||BASE,eh=expected(hr+55,ar),resultScore=score(Number(homeGoals),Number(awayGoals));
  const xgReady=homeXg!=null&&awayXg!=null&&Number.isFinite(Number(homeXg))&&Number.isFinite(Number(awayXg));
  const performanceScore=xgReady?score(Number(homeXg),Number(awayXg)):resultScore;
  const blendedScore=.80*resultScore+.20*performanceScore;
  const margin=Math.abs(Number(homeGoals)-Number(awayGoals)),delta=24*(1+Math.min(.55,Math.log1p(margin)*.28))*(blendedScore-eh);
  const update=(doc,team,elo,gf,ga,xgf,xga)=>{const n=doc?.games||0,priorGames=6,validXgf=xgf!=null&&Number.isFinite(Number(xgf)),validXga=xga!=null&&Number.isFinite(Number(xga)),attackObs=clamp(((validXgf?Number(xgf):gf)+.35)/1.7,.45,1.8),defenseObs=clamp(1.7/((validXga?Number(xga):ga)+.35),.45,1.8);return {league:String(league),teamId:String(team.id),teamName:team.name||'',elo:+elo.toFixed(1),attack:+clamp(((doc?.attack||1)*(n+priorGames)+attackObs)/(n+priorGames+1),.45,1.8).toFixed(3),defense:+clamp(((doc?.defense||1)*(n+priorGames)+defenseObs)/(n+priorGames+1),.45,1.8).toFixed(3),games:n+1,lastFixtureId:String(fixtureId),lastMatchAt:kickoff?new Date(kickoff):new Date(),season:String(season||'')};};
  const hu=update(h,home,hr+delta,Number(homeGoals),Number(awayGoals),homeXg,awayXg),au=update(a,away,ar-delta,Number(awayGoals),Number(homeGoals),awayXg,homeXg);
  await Promise.all([PowerRating.findOneAndUpdate({league:hu.league,teamId:hu.teamId},{$set:hu},{upsert:true,new:true}),PowerRating.findOneAndUpdate({league:au.league,teamId:au.teamId},{$set:au},{upsert:true,new:true})]);return {home:hu,away:au};
 }catch(e){
  try{if(fixtureId){const PowerRatingEvent=require('../models/PowerRatingEvent');await PowerRatingEvent.deleteOne({league:String(league||''),fixtureId:String(fixtureId)});}}catch(_){}
  return null;
 }
}
module.exports.loadPersistent=loadPersistent;module.exports.persistFromMatch=persistFromMatch;

async function backfillFromSportmonks({league,teamId,days=365}){
 try{
  const sportmonks=require('./sportmonksService'),r=await sportmonks.getTeamFixtureHistory(teamId,days);
  if(!r?.ok)return {ok:false,error:r?.error||'history_unavailable',processed:0};
  const rows=[...(r.fixtures||[])].filter(x=>x.homeTeamId&&x.awayTeamId&&x.homeScore!=null&&x.awayScore!=null).sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff));
  let processed=0,skipped=0;
  for(const x of rows){const out=await persistFromMatch({league:league||String(x.leagueId||''),season:x.seasonId,fixtureId:x.sportmonksId,kickoff:x.kickoff,home:{id:x.homeTeamId,name:x.homeTeam},away:{id:x.awayTeamId,name:x.awayTeam},homeGoals:x.homeScore,awayGoals:x.awayScore});if(out?.skipped)skipped++;else if(out)processed++;}
  return {ok:true,processed,skipped,total:rows.length};
 }catch(e){return {ok:false,error:e.message,processed:0};}
}

module.exports.backfillFromSportmonks=backfillFromSportmonks;

async function backfillLeagueFromSportmonks({leagueId,leagueName,days=365}){
 try{
  const sportmonks=require('./sportmonksService'),r=await sportmonks.getLeagueTeamsFromRecentFixtures(leagueId,days);
  if(!r?.ok)return {ok:false,error:r?.error||'league_history_unavailable',processed:0};
  const seen=new Set(),rows=(r.fixtures||[]).filter(x=>x.homeTeamId&&x.awayTeamId&&x.homeScore!=null&&x.awayScore!=null).sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff));
  let processed=0,skipped=0;
  for(const x of rows){const id=String(x.sportmonksId);if(seen.has(id)){skipped++;continue;}seen.add(id);const out=await persistFromMatch({league:leagueName||String(leagueId),season:x.seasonId,fixtureId:id,kickoff:x.kickoff,home:{id:x.homeTeamId,name:x.homeTeam},away:{id:x.awayTeamId,name:x.awayTeam},homeGoals:x.homeScore,awayGoals:x.awayScore});if(out?.skipped)skipped++;else if(out)processed++;}
  return {ok:true,leagueId:String(leagueId),league:leagueName||String(leagueId),teams:r.teams?.length||0,totalFixtures:rows.length,processed,skipped};
 }catch(e){return {ok:false,error:e.message,processed:0};}
}

module.exports.backfillLeagueFromSportmonks=backfillLeagueFromSportmonks;

async function seedLeagueEventsFromSportmonks({leagueId,leagueName,days=365}){
 try{
  if(!leagueId||!leagueName)return {ok:false,error:'leagueId_and_leagueName_required'};
  const sportmonks=require('./sportmonksService'),PowerRatingEvent=require('../models/PowerRatingEvent');
  const r=await sportmonks.getLeagueTeamsFromRecentFixtures(leagueId,days);
  if(!r?.ok)return {ok:false,error:r?.error||'league_history_unavailable'};
  const rows=(r.fixtures||[]).filter(x=>x.sportmonksId&&x.homeTeamId&&x.awayTeamId&&x.homeScore!=null&&x.awayScore!=null);
  const ops=rows.map(x=>({updateOne:{filter:{league:String(leagueName),fixtureId:String(x.sportmonksId)},update:{$setOnInsert:{league:String(leagueName),fixtureId:String(x.sportmonksId),kickoff:x.kickoff?new Date(x.kickoff):null,homeTeamId:String(x.homeTeamId),awayTeamId:String(x.awayTeamId),processedAt:new Date()}},upsert:true}}));
  if(!ops.length)return {ok:true,league:leagueName,totalFixtures:0,seeded:0,existing:0};
  const out=await PowerRatingEvent.bulkWrite(ops,{ordered:false});
  const seeded=Number(out.upsertedCount||0);
  return {ok:true,league:leagueName,totalFixtures:rows.length,seeded,existing:rows.length-seeded};
 }catch(e){return {ok:false,error:e.message};}
}
module.exports.seedLeagueEventsFromSportmonks=seedLeagueEventsFromSportmonks;

function simulateLeagueRatings(rows,leagueName){
 const states=new Map(),get=(id,name)=>{id=String(id);if(!states.has(id))states.set(id,{league:String(leagueName),teamId:id,teamName:name||'',elo:BASE,attack:1,defense:1,games:0,lastFixtureId:null,lastMatchAt:null,season:''});return states.get(id)};
 for(const x of rows){
  const h=get(x.homeTeamId,x.homeTeam),a=get(x.awayTeamId,x.awayTeam),eh=expected(h.elo+55,a.elo),rs=score(Number(x.homeScore),Number(x.awayScore));
  const margin=Math.abs(Number(x.homeScore)-Number(x.awayScore)),delta=24*(1+Math.min(.55,Math.log1p(margin)*.28))*(rs-eh);
  const upd=(s,elo,gf,ga)=>{const n=s.games,priorGames=6,attackObs=clamp((gf+.35)/1.7,.45,1.8),defenseObs=clamp(1.7/(ga+.35),.45,1.8);s.elo=+elo.toFixed(1);s.attack=+clamp((s.attack*(n+priorGames)+attackObs)/(n+priorGames+1),.45,1.8).toFixed(3);s.defense=+clamp((s.defense*(n+priorGames)+defenseObs)/(n+priorGames+1),.45,1.8).toFixed(3);s.games=n+1;s.lastFixtureId=String(x.sportmonksId);s.lastMatchAt=x.kickoff?new Date(x.kickoff):new Date();s.season=String(x.seasonId||'')};
  upd(h,h.elo+delta,Number(x.homeScore),Number(x.awayScore));upd(a,a.elo-delta,Number(x.awayScore),Number(x.homeScore));
 }
 return [...states.values()];
}
async function rebuildLeagueFromSportmonks({leagueId,leagueName,days=365}){
 try{
  if(!leagueId||!leagueName)return {ok:false,error:'leagueId_and_leagueName_required'};
  const sportmonks=require('./sportmonksService'),PowerRating=require('../models/PowerRating'),PowerRatingEvent=require('../models/PowerRatingEvent');
  const r=await sportmonks.getLeagueTeamsFromRecentFixtures(leagueId,days);if(!r?.ok)return {ok:false,error:r?.error||'league_history_unavailable'};
  const uniq=new Map();for(const x of (r.fixtures||[]))if(x.sportmonksId&&x.homeTeamId&&x.awayTeamId&&x.homeScore!=null&&x.awayScore!=null)uniq.set(String(x.sportmonksId),x);
  const rows=[...uniq.values()].sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff));if(!rows.length)return {ok:false,error:'no_completed_fixtures'};
  const ratings=simulateLeagueRatings(rows,leagueName);
  const ratingOps=ratings.map(x=>({updateOne:{filter:{league:String(leagueName),teamId:x.teamId},update:{$set:x},upsert:true}}));
  const eventOps=rows.map(x=>({updateOne:{filter:{league:String(leagueName),fixtureId:String(x.sportmonksId)},update:{$set:{league:String(leagueName),fixtureId:String(x.sportmonksId),kickoff:x.kickoff?new Date(x.kickoff):null,homeTeamId:String(x.homeTeamId),awayTeamId:String(x.awayTeamId),processedAt:new Date()}},upsert:true}}));
  await PowerRating.bulkWrite(ratingOps,{ordered:false});await PowerRatingEvent.bulkWrite(eventOps,{ordered:false});
  const keep=ratings.map(x=>x.teamId);await PowerRating.deleteMany({league:String(leagueName),teamId:{$nin:keep}});
  return {ok:true,league:leagueName,teams:ratings.length,totalFixtures:rows.length,rebuild:true};
 }catch(e){return {ok:false,error:e.message};}
}
module.exports.rebuildLeagueFromSportmonks=rebuildLeagueFromSportmonks;
