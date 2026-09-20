const Prediction=require('../models/PredictionSnapshot');
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
function adjustedCandidate(z,picks){
 let penalty=0,reasons=[];
 for(const x of picks){const p=pairPenalty(z,x);penalty+=p.penalty;reasons.push(...p.reasons)}
 return{adjusted:+(z.strength-penalty).toFixed(2),penalty:+penalty.toFixed(2),reasons:[...new Set(reasons)]};
}
async function buildCoupon({legs=3,risk='medium',league=''}={}){
 legs=clamp(Number(legs)||3,2,6);risk=['low','medium','high'].includes(risk)?risk:'medium';
 let rows=await available();if(league)rows=rows.filter(x=>String(x.league||'').toLowerCase().includes(String(league).toLowerCase()));
 const pool=rows.map(x=>candidateStrength(x,x.strongestPick||{},risk)).filter(Boolean);
 const picks=[],usedFixtures=new Set();
 while(picks.length<legs){
  let best=null;
  for(const z of pool){
   if(usedFixtures.has(z.row.fixtureId))continue;
   const adj=adjustedCandidate(z,picks);
   if(adj.adjusted<PROFILE[risk].score)continue;
   if(!best||adj.adjusted>best.adj.adjusted||(adj.adjusted===best.adj.adjusted&&z.prob>best.z.prob))best={z,adj};
  }
  if(!best)break;
  const z=best.z;usedFixtures.add(z.row.fixtureId);z.correlationPenalty=best.adj.penalty;z.correlationReasons=best.adj.reasons;picks.push(z);
 }
 const output=picks.map(z=>({fixtureId:z.row.fixtureId,kickoff:z.row.kickoff,league:z.row.league,match:z.row.homeTeam+' - '+z.row.awayTeam,key:z.p.key,market:z.p.market,label:z.p.label,probability:z.prob,score:z.score,dataQualityScore:z.q,strength:z.strength,correlationPenalty:z.correlationPenalty,correlationReasons:z.correlationReasons,simulationRuns:z.simulation?z.simulation.runs:0,simulationProbability:z.simulationProbability,modelSimulationGap:z.modelSimulationGap,simulationPenalty:z.simulationPenalty}));
 const rawJoint=output.length?output.reduce((v,x)=>v*(Number(x.probability)/100),1):0;
 // Conservative model-only adjustment for shared league/market/time exposures. This is not a statistical
 // correlation estimate; it is a selection-risk haircut until enough joint-outcome data is available.
 const totalPenalty=output.reduce((v,x)=>v+(Number(x.correlationPenalty)||0),0);
 const adjustedJoint=rawJoint*Math.max(.75,1-(totalPenalty/100));
 const avgProb=output.length?output.reduce((v,x)=>v+Number(x.probability),0)/output.length:0;
 const avgQuality=output.length?output.reduce((v,x)=>v+Number(x.dataQualityScore),0)/output.length:0;
 const confidence=output.length===legs?(avgProb>=70&&avgQuality>=70?'high':avgProb>=62&&avgQuality>=58?'medium':'guarded'):'incomplete';
 return{risk,requestedLegs:legs,count:output.length,complete:output.length===legs,estimatedCombinedHitPercent:+(rawJoint*100).toFixed(1),riskAdjustedCombinedHitPercent:+(adjustedJoint*100).toFixed(1),couponConfidence:confidence,correlationPenalty:+totalPenalty.toFixed(2),picks:output,selectionPolicy:{defaultLegs:3,weakFillerAllowed:false,oddsFilterApplied:false,correlationAware:true,simulationCrossCheck:'50000 deterministic Monte Carlo runs per eligible fixture',reason:'No verified live bookmaker odds feed is connected to Premium Lab yet.'},note:output.length===legs?'Model-only coupon estimate with diversification risk adjustment; market odds/EV are not used yet.':'Not enough individually qualifying picks. No weak leg was added just to complete the coupon.'};
}
async function simulateFixture(fixtureId){const row=await Prediction.findOne({fixtureId:String(fixtureId),status:'pending'}).sort({capturedAt:-1}).lean();if(!row){const e=new Error('fixture_not_in_prospective_ledger');e.status=404;throw e}if(!(Number(row.homeLambda)>0)||!(Number(row.awayLambda)>0)){const e=new Error('expected_goals_unavailable');e.status=422;throw e}return{fixtureId:row.fixtureId,match:row.homeTeam+' - '+row.awayTeam,kickoff:row.kickoff,league:row.league,simulation:simulationFromLambdas(row.homeLambda,row.awayLambda),modelSnapshot:row.probabilities}}
module.exports={available,buildCoupon,simulateFixture,simulationFromLambdas,monteCarlo50k};
