const Prediction=require('../models/PredictionSnapshot');
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function poisson(l,k){let p=Math.exp(-l);for(let i=1;i<=k;i++)p*=l/i;return p}
function simulationFromLambdas(hl,al){const h=clamp(Number(hl)||0,.05,5),a=clamp(Number(al)||0,.05,5);let home=0,draw=0,away=0,over25=0,btts=0;const scores=[];for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){const p=poisson(h,i)*poisson(a,j);if(i>j)home+=p;else if(i===j)draw+=p;else away+=p;if(i+j>2)over25+=p;if(i>0&&j>0)btts+=p;scores.push({score:i+'-'+j,p})}scores.sort((x,y)=>y.p-x.p);const pct=x=>+(x*100).toFixed(1);return{home:pct(home),draw:pct(draw),away:pct(away),over25:pct(over25),btts:pct(btts),expectedGoals:{home:+h.toFixed(2),away:+a.toFixed(2),total:+(h+a).toFixed(2)},mostLikelyScores:scores.slice(0,5).map(x=>({score:x.score,probability:pct(x.p)}))}}
async function available(limit=160){return Prediction.find({status:'pending',kickoff:{$gt:new Date()},strongestPick:{$ne:null}}).select('fixtureId kickoff league homeTeam awayTeam homeLambda awayLambda strongestPick probabilities dataQualityScore').sort({kickoff:1}).limit(limit).lean()}

const PROFILE={
 low:{probability:64,quality:60,score:58},
 medium:{probability:59,quality:52,score:52},
 high:{probability:54,quality:45,score:46}
};
function candidateStrength(row,p,risk){
 const q=Number(row.dataQualityScore)||0,prob=Number(p.probability)||0,score=Number(p.score)||0,cfg=PROFILE[risk];
 if(prob<cfg.probability||q<cfg.quality||score<cfg.score)return null;
 // Probability remains the main signal. Data quality and Strongest Pick score stop a weak
 // third leg from entering merely to complete a coupon.
 const strength=(prob*.60)+(q*.22)+(score*.18);
 return{row,p,prob,q,score,strength:+strength.toFixed(2),family:String(p.market||p.key||'unknown')};
}
async function buildCoupon({legs=3,risk='medium',league=''}={}){
 legs=clamp(Number(legs)||3,2,6);risk=['low','medium','high'].includes(risk)?risk:'medium';
 let rows=await available();if(league)rows=rows.filter(x=>String(x.league||'').toLowerCase().includes(String(league).toLowerCase()));
 const ranked=rows.map(x=>candidateStrength(x,x.strongestPick||{},risk)).filter(Boolean).sort((a,b)=>b.strength-a.strength||b.prob-a.prob);
 const picks=[],usedFixtures=new Set(),familyCount=new Map();
 for(const z of ranked){
  if(picks.length>=legs)break;
  if(usedFixtures.has(z.row.fixtureId))continue;
  const familyUsed=familyCount.get(z.family)||0;
  // Prefer diversification, but never replace a genuinely stronger leg with a weak filler.
  const diversificationPenalty=familyUsed*2.5;
  if(z.strength-diversificationPenalty<PROFILE[risk].score)continue;
  usedFixtures.add(z.row.fixtureId);familyCount.set(z.family,familyUsed+1);
  picks.push({fixtureId:z.row.fixtureId,kickoff:z.row.kickoff,league:z.row.league,match:z.row.homeTeam+' - '+z.row.awayTeam,key:z.p.key,market:z.p.market,label:z.p.label,probability:z.probability,score:z.score,dataQualityScore:z.q,strength:z.strength});
 }
 const combined=picks.length?picks.reduce((v,x)=>v*(Number(x.probability)/100),1):0;
 return{risk,requestedLegs:legs,count:picks.length,complete:picks.length===legs,estimatedCombinedHitPercent:+(combined*100).toFixed(1),picks,selectionPolicy:{defaultLegs:3,weakFillerAllowed:false,oddsFilterApplied:false,reason:'No verified live bookmaker odds feed is connected to Premium Lab yet.'},note:picks.length===legs?'Model-only coupon estimate; market odds/EV are not used until a verified odds feed is connected.':'Not enough individually qualifying picks. No weak leg was added just to complete the coupon.'};
}
async function simulateFixture(fixtureId){const row=await Prediction.findOne({fixtureId:String(fixtureId),status:'pending'}).sort({capturedAt:-1}).lean();if(!row){const e=new Error('fixture_not_in_prospective_ledger');e.status=404;throw e}if(!(Number(row.homeLambda)>0)||!(Number(row.awayLambda)>0)){const e=new Error('expected_goals_unavailable');e.status=422;throw e}return{fixtureId:row.fixtureId,match:row.homeTeam+' - '+row.awayTeam,kickoff:row.kickoff,league:row.league,simulation:simulationFromLambdas(row.homeLambda,row.awayLambda),modelSnapshot:row.probabilities}}
module.exports={available,buildCoupon,simulateFixture,simulationFromLambdas};
