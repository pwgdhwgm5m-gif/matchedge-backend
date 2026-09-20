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
