const Prediction=require('../models/PredictionSnapshot');
const oddsApi=require('./oddsApiService');
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function poisson(l,k){let p=Math.exp(-l);for(let i=1;i<=k;i++)p*=l/i;return p}
function hashSeed(s){let h=2166136261;for(const ch of String(s||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function rng32(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
function samplePoisson(lambda,rng){const L=Math.exp(-lambda);let k=0,p=1;do{k++;p*=rng()}while(p>L);return k-1}
function monteCarlo50k(row,runs=50000){const h=clamp(Number(row.homeLambda)||0,.05,5),a=clamp(Number(row.awayLambda)||0,.05,5),rng=rng32(hashSeed(row.fixtureId+'|'+h+'|'+a));let home=0,draw=0,away=0,over25=0,btts=0;for(let n=0;n<runs;n++){const hg=samplePoisson(h,rng),ag=samplePoisson(a,rng);if(hg>ag)home++;else if(hg===ag)draw++;else away++;if(hg+ag>2)over25++;if(hg>0&&ag>0)btts++}const pct=x=>+(x*100/runs).toFixed(1);return{runs,home:pct(home),draw:pct(draw),away:pct(away),over25:pct(over25),under25:pct(runs-over25),bttsYes:pct(btts),bttsNo:pct(runs-btts)}}
function simProbabilityForPick(p,sim){const s=(String(p&&p.key||'')+' '+String(p&&p.market||'')+' '+String(p&&p.label||'')).toLowerCase();if(/bttsno|btts no|kg yok|both teams.*no/.test(s))return sim.bttsNo;if(/bttsyes|btts yes|kg var|both teams.*yes/.test(s))return sim.bttsYes;if(/under25|under 2.5|2.5 alt/.test(s))return sim.under25;if(/over25|over 2.5|2.5 üst|2.5 ust/.test(s))return sim.over25;if(/draw|\bx\b/.test(s))return sim.draw;if(/away|\b2\b/.test(s))return sim.away;if(/home|\b1\b/.test(s))return sim.home;return null}
function simulationFromLambdas(hl,al){const h=clamp(Number(hl)||0,.05,5),a=clamp(Number(al)||0,.05,5);let home=0,draw=0,away=0,over25=0,btts=0;const scores=[];for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){const p=poisson(h,i)*poisson(a,j);if(i>j)home+=p;else if(i===j)draw+=p;else away+=p;if(i+j>2)over25+=p;if(i>0&&j>0)btts+=p;scores.push({score:i+'-'+j,p})}scores.sort((x,y)=>y.p-x.p);const pct=x=>+(x*100).toFixed(1);return{home:pct(home),draw:pct(draw),away:pct(away),over25:pct(over25),btts:pct(btts),expectedGoals:{home:+h.toFixed(2),away:+a.toFixed(2),total:+(h+a).toFixed(2)},mostLikelyScores:scores.slice(0,5).map(x=>({score:x.score,probability:pct(x.p)}))}}
async function available(limit=160){return Prediction.find({status:'pending',kickoff:{$gt:new Date()},strongestPick:{$ne:null}}).select('fixtureId kickoff league homeTeam awayTeam homeLambda awayLambda strongestPick probabilities dataQualityScore').sort({kickoff:1}).limit(limit).lean()}

const PROFILE={
 low:{probability:64,quality:60,score:58},
 medium:{probability:59,quality:52,score:52},
 high:{probability:54,quality:45,score:46}
};
function marketFamily(p){const s=String((p&&p.market)||'')+' '+String((p&&p.key)||'');if(/corner/i.test(s))return'corners';if(/btts|kg/i.test(s))return'btts';if(/over|under|goal|gol/i.test(s))return'goals';if(/half|iy|1h|2h/i.test(s))return'halves';if(/home|draw|away|1x2|winner|result/i.test(s))return'result';return String((p&&p.market)||(p&&p.key)||'unknown')}
function candidateStrength(row,p,risk){
 const q=Number(row.dataQualityScore)||0,prob=Number(p.probability)||0,score=Number(p.score)||0,cfg=PROFILE[risk];
 if(prob<cfg.probability||q<cfg.quality||score<cfg.score)return null;
 const sim=(Number(row.homeLambda)>0&&Number(row.awayLambda)>0)?monteCarlo50k(row):null,simProb=sim?simProbabilityForPick(p,sim):null;
 const disagreement=simProb==null?0:Math.abs(prob-simProb),simPenalty=simProb==null?0:(disagreement>15?10:disagreement>10?6:disagreement>6?3:0),simBonus=simProb!=null&&disagreement<=4?2:0;
 const strength=(prob*.60)+(q*.22)+(score*.18)-simPenalty+simBonus;
 return{row,p,prob,q,score,strength:+strength.toFixed(2),family:marketFamily(p),simulation:sim,simulationProbability:simProb,modelSimulationGap:simProb==null?null:+disagreement.toFixed(1),simulationPenalty:simPenalty};
}
function pairPenalty(a,b){
 let penalty=0,reasons=[];
 if(String(a.row.league||'')===String(b.row.league||'')){penalty+=1.25;reasons.push('same-league')}
 if(a.family===b.family){penalty+=2.25;reasons.push('same-market-family')}
 const ta=new Date(a.row.kickoff).getTime(),tb=new Date(b.row.kickoff).getTime();
 if(Number.isFinite(ta)&&Number.isFinite(tb)&&Math.abs(ta-tb)<90*60*1000){penalty+=.5;reasons.push('same-time-window')}
 return{penalty,reasons};
}
function rejectReason(z,risk){const cfg=PROFILE[risk];if(z.q<cfg.quality)return'low-data-quality';if(z.modelSimulationGap!=null&&z.modelSimulationGap>15)return'model-simulation-conflict';if(z.simulationProbability!=null&&z.simulationProbability<50)return'simulation-below-50';if(z.evPercent!=null&&z.evPercent<0)return'negative-ev';if(z.similarCount>=10&&z.similarHitRate<40)return'similar-matches-negative';if(z.patternCount>=30&&z.patternHitRate<42)return'pattern-negative';return null}
function adjustedCandidate(z,picks){
 let penalty=0,reasons=[];
 for(const x of picks){const p=pairPenalty(z,x);penalty+=p.penalty;reasons.push(...p.reasons)}
 return{adjusted:+(z.strength-penalty).toFixed(2),penalty:+penalty.toFixed(2),reasons:[...new Set(reasons)]};
}
async function buildCoupon({legs=3,risk='medium',league=''}={}){
 legs=clamp(Number(legs)||3,2,6);risk=['low','medium','high'].includes(risk)?risk:'medium';
 let rows=await available();if(league)rows=rows.filter(x=>String(x.league||'').toLowerCase().includes(String(league).toLowerCase()));
 const pool=rows.map(x=>candidateStrength(x,x.strongestPick||{},risk)).filter(Boolean);
 // V3 evidence layers: similar historical matches + prospective pattern performance + verified live 1X2 price when available.
 const settled=await Prediction.find({status:'settled'}).select('fixtureId kickoff league homeTeam awayTeam homeLambda awayLambda dataQualityScore probabilities strongestPick actual').sort({kickoff:-1}).limit(1200).lean();
 const pattern=await patternFinder({minProbability:PROFILE[risk].probability,minQuality:PROFILE[risk].quality,maxGap:8,league});
 const patternByMarket=new Map((pattern.markets||[]).map(x=>[x.market,x]));
 let liveValue={matches:[]};try{liveValue=await valueFinder({limit:80})}catch(_){}
 const valueByFixture=new Map((liveValue.matches||[]).map(x=>[String(x.fixtureId),x]));
 for(const z of pool){
  const hist=settled.filter(h=>new Date(h.kickoff)<new Date(z.row.kickoff)).map(h=>({h,d:distance(z.row,h)})).filter(x=>x.d<.9).sort((a,b)=>a.d-b.d).slice(0,20);
  const graded=hist.map(x=>pickActualHit(z.p.key,x.h.actual)).filter(x=>x!==null),wins=graded.filter(Boolean).length;
  z.similarCount=graded.length;z.similarHitRate=graded.length?+(100*wins/graded.length).toFixed(1):null;
  const pm=patternByMarket.get(z.family);z.patternCount=pm?.count||0;z.patternHitRate=pm?.hitRatePercent??null;
  const priced=valueByFixture.get(String(z.row.fixtureId)),side=['home','draw','away'].includes(z.p.key)?z.p.key:null,vo=side?priced?.outcomes?.[side]:null;
  z.marketOdds=vo?.odds??null;z.edgePercent=vo?.edgePercent??null;z.evPercent=vo?.expectedValuePercent??null;
  const similarBonus=z.similarCount>=10?(z.similarHitRate>=70?4:z.similarHitRate>=60?2:z.similarHitRate<45?-4:0):0;
  const patternBonus=z.patternCount>=30?(z.patternHitRate>=68?4:z.patternHitRate>=58?2:z.patternHitRate<45?-4:0):0;
  const evBonus=z.evPercent==null?0:(z.evPercent>=8?6:z.evPercent>=3?3:z.evPercent<0?-8:0);
  z.evidenceAdjustment=similarBonus+patternBonus+evBonus;z.strength=+(z.strength+z.evidenceAdjustment).toFixed(2);z.rejectReason=rejectReason(z,risk);
 }
 const picks=[],usedFixtures=new Set();
 while(picks.length<legs){let best=null;for(const z of pool){if(usedFixtures.has(z.row.fixtureId)||z.rejectReason)continue;const adj=adjustedCandidate(z,picks);if(adj.adjusted<PROFILE[risk].score)continue;if(!best||adj.adjusted>best.adj.adjusted||(adj.adjusted===best.adj.adjusted&&z.prob>best.z.prob))best={z,adj}}if(!best)break;const z=best.z;usedFixtures.add(z.row.fixtureId);z.correlationPenalty=best.adj.penalty;z.correlationReasons=best.adj.reasons;picks.push(z)}
 const rejected=pool.filter(z=>z.rejectReason).map(z=>({fixtureId:z.row.fixtureId,match:z.row.homeTeam+' - '+z.row.awayTeam,label:z.p.label,reason:z.rejectReason}));
 const output=picks.map(z=>({fixtureId:z.row.fixtureId,kickoff:z.row.kickoff,league:z.row.league,match:z.row.homeTeam+' - '+z.row.awayTeam,key:z.p.key,market:z.p.market,label:z.p.label,probability:z.prob,score:z.score,dataQualityScore:z.q,strength:z.strength,evidenceAdjustment:z.evidenceAdjustment,similarMatches:{count:z.similarCount,hitRatePercent:z.similarHitRate},pattern:{count:z.patternCount,hitRatePercent:z.patternHitRate},market:{odds:z.marketOdds,edgePercent:z.edgePercent,expectedValuePercent:z.evPercent},correlationPenalty:z.correlationPenalty,correlationReasons:z.correlationReasons,simulationRuns:z.simulation?z.simulation.runs:0,simulationProbability:z.simulationProbability,modelSimulationGap:z.modelSimulationGap,simulationPenalty:z.simulationPenalty}));
 const rawJoint=output.length?output.reduce((v,x)=>v*(Number(x.probability)/100),1):0,totalPenalty=output.reduce((v,x)=>v+(Number(x.correlationPenalty)||0),0),adjustedJoint=rawJoint*Math.max(.75,1-(totalPenalty/100)),avgProb=output.length?output.reduce((v,x)=>v+Number(x.probability),0)/output.length:0,avgQuality=output.length?output.reduce((v,x)=>v+Number(x.dataQualityScore),0)/output.length:0,confidence=output.length===legs?(avgProb>=70&&avgQuality>=70?'high':avgProb>=62&&avgQuality>=58?'medium':'guarded'):'incomplete';
 return{engine:'premium-coupon-v3',risk,requestedLegs:legs,count:output.length,complete:output.length===legs,estimatedCombinedHitPercent:+(rawJoint*100).toFixed(1),riskAdjustedCombinedHitPercent:+(adjustedJoint*100).toFixed(1),couponConfidence:confidence,correlationPenalty:+totalPenalty.toFixed(2),picks:output,rejectedCount:rejected.length,rejected:rejected.slice(0,30),selectionPolicy:{defaultLegs:3,weakFillerAllowed:false,correlationAware:true,simulationCrossCheck:'50000 deterministic Monte Carlo runs',similarMatches:true,patternFinder:true,liveOddsWhenAvailable:true,oddsFilterApplied:(liveValue.pricedMatches||0)>0,reason:(liveValue.pricedMatches||0)>0?'Verified live bookmaker prices are included where the selected market is priced.':'No verified current bookmaker prices were available; model/simulation/history layers remain active and no value claim is made.'},note:output.length===legs?'V3 multi-signal coupon: model + 50K simulation + similar matches + prospective patterns + live EV when available.':'Not enough individually qualifying picks. No weak leg was added just to complete the coupon.'};
}

function pickActualHit(key,a={}){if(key==='home'||key==='draw'||key==='away')return a[key]===1;if(key==='over25')return a.over25===1;if(key==='under25')return a.over25===0;if(key==='bttsYes')return a.btts===1;if(key==='bttsNo')return a.btts===0;return null}
function distance(target,h){
 const tp=target.probabilities||{},hp=h.probabilities||{};
 const vals=[
  [Number(target.homeLambda),Number(h.homeLambda),1.5],
  [Number(target.awayLambda),Number(h.awayLambda),1.5],
  [Number(target.dataQualityScore),Number(h.dataQualityScore),35],
  [Number(tp.home),Number(hp.home),.30],[Number(tp.draw),Number(hp.draw),.25],[Number(tp.away),Number(hp.away),.30],
  [Number(tp.over25),Number(hp.over25),.30],[Number(tp.btts),Number(hp.btts),.30]
 ];
 let sum=0,n=0;for(const [a,b,scale] of vals){if(Number.isFinite(a)&&Number.isFinite(b)){sum+=Math.min(2,Math.abs(a-b)/scale);n++}}
 return n?sum/n:99;
}
async function similarMatches(fixtureId,{limit=20}={}){
 const target=await Prediction.findOne({fixtureId:String(fixtureId),status:'pending'}).sort({capturedAt:-1}).lean();
 if(!target){const e=new Error('fixture_not_in_prospective_ledger');e.status=404;throw e}
 const history=await Prediction.find({status:'settled',kickoff:{$lt:target.kickoff}}).select('fixtureId kickoff league homeTeam awayTeam homeLambda awayLambda dataQualityScore probabilities strongestPick actual').sort({kickoff:-1}).limit(1200).lean();
 const ranked=history.map(h=>({h,d:distance(target,h)})).filter(x=>x.d<.9).sort((a,b)=>a.d-b.d).slice(0,clamp(Number(limit)||20,5,50));
 const key=target.strongestPick?.key;
 const comparable=ranked.map(x=>{const hit=pickActualHit(key,x.h.actual);return{fixtureId:x.h.fixtureId,kickoff:x.h.kickoff,league:x.h.league,match:x.h.homeTeam+' - '+x.h.awayTeam,similarity:+(100*(1-Math.min(1,x.d))).toFixed(1),score:x.h.actual?.homeScore+'-'+x.h.actual?.awayScore,comparablePickHit:hit}});
 const graded=comparable.filter(x=>x.comparablePickHit!==null),wins=graded.filter(x=>x.comparablePickHit).length;
 return{fixtureId:target.fixtureId,match:target.homeTeam+' - '+target.awayTeam,targetPick:target.strongestPick||null,count:comparable.length,graded:graded.length,comparableHitRatePercent:graded.length?+(100*wins/graded.length).toFixed(1):null,matches:comparable,method:'pre-kickoff feature distance; historical rows are strictly earlier than target kickoff'};
}


async function patternFinder({minProbability=60,minQuality=50,maxGap=8,league=''}={}){
 minProbability=clamp(Number(minProbability)||60,50,90);minQuality=clamp(Number(minQuality)||50,0,100);maxGap=clamp(Number(maxGap)||8,0,30);
 const q={status:'settled',strongestPick:{$ne:null}};if(league)q.league={$regex:String(league),$options:'i'};
 const rows=await Prediction.find(q).select('fixtureId kickoff league homeTeam awayTeam homeLambda awayLambda dataQualityScore strongestPick actual').sort({kickoff:1}).limit(2000).lean();
 const evaluated=[];
 for(const row of rows){const p=row.strongestPick||{},prob=Number(p.probability)||0,quality=Number(row.dataQualityScore)||0;if(prob<minProbability||quality<minQuality)continue;let gap=null;if(Number(row.homeLambda)>0&&Number(row.awayLambda)>0){const sim=monteCarlo50k(row,5000),sp=simProbabilityForPick(p,sim);if(sp!=null)gap=Math.abs(prob-sp)}if(gap!=null&&gap>maxGap)continue;const hit=pickActualHit(p.key,row.actual);if(hit===null)continue;evaluated.push({fixtureId:row.fixtureId,kickoff:row.kickoff,league:row.league,market:marketFamily(p),probability:prob,quality,simulationGap:gap==null?null:+gap.toFixed(1),hit});}
 const wins=evaluated.filter(x=>x.hit).length,n=evaluated.length;
 const byMarket={};for(const x of evaluated){const g=byMarket[x.market]||(byMarket[x.market]={market:x.market,count:0,wins:0});g.count++;if(x.hit)g.wins++}
 return{filters:{minProbability,minQuality,maxSimulationGap:maxGap,league:league||'all'},count:n,wins,losses:n-wins,hitRatePercent:n?+(100*wins/n).toFixed(1):null,readiness:n<30?'collecting':n<100?'early-signal':'decision-ready',markets:Object.values(byMarket).map(x=>({...x,hitRatePercent:+(100*x.wins/x.count).toFixed(1)})),method:'settled prospective snapshots only; simulation is used as a robustness filter, not as historical input from after kickoff'};
}


const ODDS_LEAGUE_MAP=[
 [/premier|epl/i,'soccer_epl'],[/la liga|laliga/i,'soccer_spain_la_liga'],[/serie a/i,'soccer_italy_serie_a'],[/bundesliga/i,'soccer_germany_bundesliga'],[/ligue 1/i,'soccer_france_ligue_one'],[/eredivisie/i,'soccer_netherlands_eredivisie'],[/portugal|primeira/i,'soccer_portugal_primeira_liga'],[/belg/i,'soccer_belgium_first_div'],[/super lig|süper lig|turkey|türkiye/i,'soccer_turkey_super_league'],[/scott|premiership/i,'soccer_spl']
];
function oddsLeagueKey(league){const x=ODDS_LEAGUE_MAP.find(([re])=>re.test(String(league||'')));return x?x[1]:null}
async function valueFinder({limit=30}={}){
 const rows=await available(Math.min(80,Math.max(5,Number(limit)||30))),byLeague=new Map(),results=[],errors=[];
 for(const row of rows){const k=oddsLeagueKey(row.league);if(k&&!byLeague.has(k))byLeague.set(k,null)}
 for(const key of byLeague.keys()){const r=await oddsApi.getOddsForLeague(key);byLeague.set(key,r.ok?r.data:null);if(!r.ok)errors.push({leagueKey:key,error:String(r.error||'odds_unavailable')})}
 for(const row of rows){
  const key=oddsLeagueKey(row.league),data=key?byLeague.get(key):null;if(!data)continue;
  const odds=oddsApi.extractMatchOdds(data,row.homeTeam,row.awayTeam);if(!odds)continue;
  const market=oddsApi.shinImpliedProbabilities(odds)||oddsApi.normalizeImpliedProbabilities(odds),p=row.probabilities||{};
  const model={home:Number(p.home)*100,draw:Number(p.draw)*100,away:Number(p.away)*100};
  const outcomes={};
  for(const side of ['home','draw','away']){if(!Number.isFinite(model[side])||!Number.isFinite(Number(odds[side])))continue;const edge=+(model[side]-Number(market[side])).toFixed(1),ev=+((model[side]/100)*Number(odds[side])-1).toFixed(3);outcomes[side]={odds:Number(odds[side]),modelProbability:+model[side].toFixed(1),marketProbability:Number(market[side]),edgePercent:edge,expectedValuePercent:+(ev*100).toFixed(1),positiveEV:ev>0}}
  results.push({fixtureId:row.fixtureId,kickoff:row.kickoff,league:row.league,match:row.homeTeam+' - '+row.awayTeam,provider:'The Odds API',deVigMethod:market.method,overroundPercent:market.overroundPercent,outcomes});
 }
 return{provider:'The Odds API',providerAvailable:results.length>0||errors.length===0,pricedMatches:results.length,matches:results,errors:errors.length?errors:undefined,note:results.length?'Live bookmaker prices were fetched; EV is model probability versus current decimal price.':'No verified current bookmaker prices were returned; no value claim is produced.'};
}

async function simulateFixture(fixtureId){const row=await Prediction.findOne({fixtureId:String(fixtureId),status:'pending'}).sort({capturedAt:-1}).lean();if(!row){const e=new Error('fixture_not_in_prospective_ledger');e.status=404;throw e}if(!(Number(row.homeLambda)>0)||!(Number(row.awayLambda)>0)){const e=new Error('expected_goals_unavailable');e.status=422;throw e}return{fixtureId:row.fixtureId,match:row.homeTeam+' - '+row.awayTeam,kickoff:row.kickoff,league:row.league,simulation:simulationFromLambdas(row.homeLambda,row.awayLambda),modelSnapshot:row.probabilities}}
module.exports={available,buildCoupon,simulateFixture,simulationFromLambdas,monteCarlo50k,similarMatches,patternFinder,valueFinder};
