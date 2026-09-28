const axios=require('axios');
const config=require('../config/config');
const {teamNamesMatch}=require('../utils/textNormalize');

const memory=new Map(),DAY_TTL_MS=10*60*1000,MISS_TTL_MS=30*60*1000,RATE_BACKOFF_MS=60*60*1000,AUTH_BACKOFF_MS=15*60*1000;
let blockedUntil=0,requestChain=Promise.resolve(),lastRequestAt=0;
const MIN_REQUEST_GAP_MS=6500;
function rateLimited(fn){const run=async()=>{const wait=Math.max(0,MIN_REQUEST_GAP_MS-(Date.now()-lastRequestAt));if(wait)await new Promise(r=>setTimeout(r,wait));lastRequestAt=Date.now();return fn()};const p=requestChain.then(run,run);requestChain=p.catch(()=>{});return p}
const num=v=>{const n=Number(v);return n>1?n:null};
function enabled(){return Boolean(config.fiveDollarFootball?.key)}
function available(){return enabled()&&Date.now()>=blockedUntil}
function headers(){return {Authorization:`Bearer ${config.fiveDollarFootball.key}`}}
function backoff(status,retryAfter){if(status===429)blockedUntil=Math.max(blockedUntil,Date.now()+Math.max(60000,Number(retryAfter||0)*1000||RATE_BACKOFF_MS));else if(status===401||status===403)blockedUntil=Math.max(blockedUntil,Date.now()+AUTH_BACKOFF_MS)}
function priceFreshness(value){const raw=value?.updated_at||value?.updatedAt||value?.timestamp||value?.last_update||null;if(!raw)return {fresh:false,updatedAt:null};const ms=typeof raw==='number'?(raw>1e12?raw:raw*1000):Date.parse(raw);if(!Number.isFinite(ms))return {fresh:false,updatedAt:null};return {fresh:Date.now()-ms<=15*60*1000,updatedAt:new Date(ms).toISOString()}}
function stage(v,{allowInplay=false}={}){return v&&((allowInplay&&v.inplay)||v.closing||v.opening||v)}
function marketStages(root){
 const one=root?.['1x2']||root?.match_result||root?.moneyline||{};
 const ladder=root?.goal_line_fixed||root?.goalline_fixed||root?.totals||root?.total_goals||{};
 const rows=Array.isArray(ladder)?ladder:Array.isArray(ladder?.lines)?ladder.lines:Object.entries(ladder).map(([k,v])=>typeof v==='object'?{_key:k,...v}:v);
 const total=rows.find(x=>Number(x?.line??x?.handicap??x?.total??x?._key)===2.5)||ladder['2.5']||ladder['2_5']||ladder.over_2_5||{};
 const btts=root?.btts||root?.both_teams_to_score||root?.bothTeamsToScore||root?.both_teams_score||{};
 const triplet=v=>{const p=v||{},h=num(p.home),d=num(p.draw),a=num(p.away);return h&&d&&a?{home:h,draw:d,away:a}:null};
 const binary=(v,yesKeys,noKeys)=>{const p=v||{},pick=ks=>ks.map(k=>num(p[k])).find(Boolean)||null,y=pick(yesKeys),n=pick(noKeys);return y&&n?{yes:y,no:n}:null};
 return {
  opening:{h2h:triplet(one.opening),totals:(()=>{const p=pair(total.opening);return p?{over25:p.a,under25:p.b}:null})(),btts:binary(btts.opening,['yes','Yes','both','btts_yes'],['no','No','not_both','btts_no'])},
  closing:{h2h:triplet(one.closing),totals:(()=>{const p=pair(total.closing);return p?{over25:p.a,under25:p.b}:null})(),btts:binary(btts.closing,['yes','Yes','both','btts_yes'],['no','No','not_both','btts_no'])},
  inplay:{h2h:triplet(one.inplay),totals:(()=>{const p=pair(total.inplay);return p?{over25:p.a,under25:p.b}:null})(),btts:binary(btts.inplay,['yes','Yes','both','btts_yes'],['no','No','not_both','btts_no'])}
 };
}
function pair(v,a=['over','over_odds','over25','over_2.5'],b=['under','under_odds','under25','under_2.5'],options={}){const p=stage(v,options)||{};const pick=keys=>keys.map(k=>num(p[k])).find(Boolean)||null;const x=pick(a),y=pick(b);return x&&y?{a:x,b:y}:null}
function oddsRoot(f){const o=f?.odds||{};if(Array.isArray(o.bookmakers)){const book=o.bookmakers.find(x=>/bet365/i.test(String(x.slug||x.name||'')))||o.bookmakers[0];return book?.odds||book?.markets||{}}if(Array.isArray(f?.bookmakers)){const book=f.bookmakers.find(x=>/bet365/i.test(String(x.slug||x.name||'')))||f.bookmakers[0];return book?.odds||book?.markets||{}}return o}
function normalizeMarkets(root,options={}){
 const one=stage(root?.['1x2']||root?.match_result||root?.moneyline,options)||{};
 const h=num(one.home),d=num(one.draw),a=num(one.away);
 const h2h=h&&d&&a?{home:h,draw:d,away:a}:null;
 const ladder=root?.goal_line_fixed||root?.goalline_fixed||root?.totals||root?.total_goals;
 const rows=Array.isArray(ladder)?ladder:Array.isArray(ladder?.lines)?ladder.lines:Object.entries(ladder||{}).map(([k,v])=>typeof v==='object'?{_key:k,...v}:v);
 let row=rows.find(x=>Number(x?.line??x?.handicap??x?.total??x?._key)===2.5);
 if(!row&&ladder&&!Array.isArray(ladder))row=ladder['2.5']||ladder['2_5']||ladder.over_2_5;
 let t=pair(row,undefined,undefined,options);
 if(!t){const main=stage(root?.goal_line||root?.goalline,options);if(Number(main?.line)===2.5)t=pair(main)}
 const bp=stage(root?.btts||root?.both_teams_to_score||root?.bothTeamsToScore||root?.both_teams_score,options)||{};
 const yes=num(bp.yes??bp.Yes??bp.both??bp.btts_yes),no=num(bp.no??bp.No??bp.not_both??bp.btts_no);
 return {h2h,totals:t?{over25:t.a,under25:t.b}:null,btts:yes&&no?{yes,no}:null};
}
function normalizeFixture(f,homeName,awayName,fetchedAt){
 if(!f||!teamNamesMatch(f.teams?.home?.name,homeName)||!teamNamesMatch(f.teams?.away?.name,awayName))return null;
 const root=oddsRoot(f),markets=normalizeMarkets(root),stages=marketStages(root),fresh=Date.now()-Number(fetchedAt||0)<=DAY_TTL_MS*1.5;
 return {fixtureId:String(f.id),providerIdentity:{competitionId:String(f.league?.id||f.competition?.id||''),fixtureId:String(f.id),homeTeamId:String(f.teams?.home?.id||''),awayTeamId:String(f.teams?.away?.id||'')},matchOdds:markets.h2h,totals25:markets.totals,btts:markets.btts,marketStages:stages,marketBoard:{bookmakers:[{bookmaker:'market',h2h:markets.h2h,totals:markets.totals,btts:markets.btts,fresh,updatedAt:fetchedAt?new Date(fetchedAt).toISOString():null}],bookmakerCount:1},source:'5dollarfootball-market',fetchedAt};
}
async function getDay(start){
 const key=`five-dollar-day-v3:${start}`,cached=memory.get(key);if(cached?.expires>Date.now())return cached;if(!available())return null;
 try{let data=[],page=1,lastHeaders={};while(page<=8){const r=await axios.get(`${config.fiveDollarFootball.baseUrl}/fixtures`,{headers:headers(),params:{start_time:start,end_time:start+86400,include:'odds,events',per_page:50,page},timeout:7000});lastHeaders=r.headers||{};const rows=Array.isArray(r.data?.data)?r.data.data:[];data.push(...rows);const more=r.data?.pagination?.has_more===true||r.data?.meta?.current_page<r.data?.meta?.last_page;if(!more||!rows.length)break;const rem=Number(lastHeaders['x-ratelimit-remaining']);if(Number.isFinite(rem)&&rem<=2)break;page++}
 const now=Date.now(),row={data,expires:now+DAY_TTL_MS,fetchedAt:now,rate:{limit:lastHeaders['x-ratelimit-limit']||null,remaining:lastHeaders['x-ratelimit-remaining']||null,reset:lastHeaders['x-ratelimit-reset']||null}};memory.set(key,row);return row;
 }catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);console.warn('[5dollar]',e.response?.status===429?'rate limit backoff':e.response?.status===401||e.response?.status===403?'auth/plan unavailable':'request failed');return null}
}

async function request(path,params={},timeout=9000){
 if(!available())return null;
 try{return await rateLimited(()=>axios.get(`${config.fiveDollarFootball.baseUrl}${path}`,{headers:headers(),params,timeout}))}
 catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);console.warn('[5dollar/request]',path,e.response?.status||'request failed');return null}
}
function normalizeStats(v){const s=v?.statistics||v?.stats||v||{},side=x=>({home:Number.isFinite(Number(x?.home))?Number(x.home):null,away:Number.isFinite(Number(x?.away))?Number(x.away):null});return {attacks:side(s.attacks),dangerousAttacks:side(s.dangerous_attacks||s.dangerousAttacks),shotsOnTarget:side(s.shots_on_target||s.shotsOnTarget),shotsOffTarget:side(s.shots_off_target||s.shotsOffTarget),possession:side(s.possession),firstHalf:s.first_half?normalizeStats(s.first_half):null}}
function normalizeEvents(v){return (v?.events||v||[]).map(e=>({type:e.type||null,minute:e.minute??null,team:e.team||null,count:e.count??null,period:e.period||null,score:e.score||null,playerIn:e.player_in||null,playerOut:e.player_out||null}));}
async function getLiveIntelligence(){const key='five-dollar-live-intel-v1',cached=memory.get(key);if(cached?.expires>Date.now())return cached.data;const r=await request('/fixtures',{status:'live',include:'odds,events,stats',per_page:50});if(!r)return {available:false,fixtures:[]};const fixtures=(r.data?.data||[]).map(f=>({...f,normalizedStats:normalizeStats(f.statistics),normalizedEvents:normalizeEvents(f.events),normalizedMarkets:normalizeMarkets(oddsRoot(f),{allowInplay:true}),marketStages:marketStages(oddsRoot(f))}));const data={available:true,fixtures,fetchedAt:Date.now()};memory.set(key,{data,expires:Date.now()+60*1000});return data;}
async function getHistoricalLeagueFixtures(leagueId,{startTime,endTime,page=1,includeOdds=true}={}){if(!leagueId)return null;const params={status:'finished',order:'asc',page,per_page:includeOdds?50:100};if(startTime)params.start_time=startTime;if(endTime)params.end_time=endTime;if(includeOdds)params.include='odds';const r=await request(`/leagues/${leagueId}/fixtures`,params,12000);return r?.data||null;}
async function getFullOdds(fixtureId){
 const key=`five-dollar-full-odds-v1:${fixtureId}`,cached=memory.get(key);if(cached?.expires>Date.now())return cached.data;if(!available())return null;
 try{
  const r=await request(`/fixtures/${fixtureId}/odds`,{bookmakers:'bet365'},7000);if(!r)return null;
  const books=r.data?.data?.bookmakers||[];const book=books.find(x=>String(x.slug||'').toLowerCase()==='bet365')||books[0];
  const data=book?.odds||null;memory.set(key,{data,expires:Date.now()+DAY_TTL_MS});return data;
 }catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);console.warn('[5dollar/odds]',e.response?.status||'request failed');return null}
}

function scoreNum(v){const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function extractScorePair(v){
 if(!v)return {home:null,away:null};
 if(Array.isArray(v)&&v.length>=2)return {home:scoreNum(v[0]),away:scoreNum(v[1])};
 if(typeof v==='string'){const m=v.match(/(\d+)\s*[-:]\s*(\d+)/);return m?{home:Number(m[1]),away:Number(m[2])}:{home:null,away:null}}
 return {home:scoreNum(v.home??v.home_score??v.homeScore),away:scoreNum(v.away??v.away_score??v.awayScore)}
}
function normalizeScoreFixture(f){
 const teams=f?.teams||{};
 const score=f?.scores||f?.score||{};
 const ft=extractScorePair(score.fulltime||score.full_time||score.ft||f?.fulltime||f?.result||{home:f?.home_score??f?.goals?.home,away:f?.away_score??f?.goals?.away});
 let ht=extractScorePair(score.halftime||score.half_time||score.ht||f?.halftime);
 if(ht.home==null||ht.away==null){
   const events=normalizeEvents(f?.events);
   // 5Dollar exposes the authoritative HT score as a period_score event with
   // period=first_half. Prefer it over reconstructing goals by minute.
   const period=events.find(e=>String(e.type||'').toLowerCase()==='period_score'&&
     ['first_half','1st_half','firsthalf','1h'].includes(String(e.period||'').toLowerCase()));
   const periodScore=extractScorePair(period?.score);
   if(periodScore.home!=null&&periodScore.away!=null) ht=periodScore;
   else {
     const firstHalf=events.filter(e=>Number.isFinite(Number(e.minute))&&Number(e.minute)<=45);
     let h=0,a=0,seen=false;
     for(const e of firstHalf){
       if(!/goal/i.test(String(e.type||'')))continue;
       if(String(e.team||'').toLowerCase()==='home'){h++;seen=true}
       else if(String(e.team||'').toLowerCase()==='away'){a++;seen=true}
     }
     if(seen)ht={home:h,away:a};
   }
 }
 const kickoffTs=Number(f?.kickoff_ts);
 return {
   fixtureId:String(f?.id||''), fiveDollarFixtureId:String(f?.id||''),
   leagueId:String(f?.league?.id||f?.competition?.id||''), league:f?.league?.name||f?.competition?.name||'',
   homeTeam:teams?.home?.name||f?.home_team?.name||f?.home_name||'',
   awayTeam:teams?.away?.name||f?.away_team?.name||f?.away_name||'',
   homeScore:ft.home,awayScore:ft.away,halftimeHome:ht.home,halftimeAway:ht.away,
   kickoff:Number.isFinite(kickoffTs)?new Date(kickoffTs*1000).toISOString():(f?.kickoff_utc||f?.start_time||null),
   statusShort:/finish|ended|full.?time|ft/i.test(String(f?.status?.name||f?.status||''))?'FT':(f?.status?.short||f?.status||null),
   isFinished:/finish|ended|full.?time|ft/i.test(String(f?.status?.name||f?.status||''))||Boolean(ft.home!=null&&ft.away!=null),
   source:'5dollarfootball-score'
 };
}
async function getScoreboardDay(date){
 const d=new Date(String(date)+'T00:00:00Z');if(Number.isNaN(d.getTime()))return {available:false,matches:[]};
 const start=Math.floor(d.getTime()/1000),day=await getDay(start);if(!day)return {available:false,matches:[]};
 return {available:true,matches:(day.data||[]).map(normalizeScoreFixture).filter(x=>x.homeTeam&&x.awayTeam),fetchedAt:day.fetchedAt};
}

async function getMatchOdds(homeName,awayName,kickoff){
 if(!available()||!homeName||!awayName||!kickoff)return null;const d=new Date(kickoff);if(Number.isNaN(d.getTime()))return null;
 const start=Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())/1000),missKey=`five-dollar-miss-v3:${start}:${String(homeName).toLowerCase()}:${String(awayName).toLowerCase()}`,miss=memory.get(missKey);if(miss?.expires>Date.now())return null;
 const day=await getDay(start);if(!day)return null;const target=d.getTime();
 const f=day.data.find(x=>{if(!teamNamesMatch(x.teams?.home?.name,homeName)||!teamNamesMatch(x.teams?.away?.name,awayName))return false;const k=Number(x.kickoff_ts)*1000||Date.parse(x.kickoff_utc||x.start_time||'');return !Number.isFinite(k)||Math.abs(k-target)<=4*60*60*1000});
 if(!f){memory.set(missKey,{miss:true,expires:Date.now()+MISS_TTL_MS});return null}
 // The list include is intentionally compact. The documented single-fixture
 // odds endpoint is the authoritative payload for BTTS and goal_line_fixed.
 let normalized=normalizeFixture(f,homeName,awayName,day.fetchedAt);
 if(!normalized?.totals25||!normalized?.btts){
   const full=await getFullOdds(f.id);
   if(full)normalized=normalizeFixture({...f,odds:full},homeName,awayName,Date.now());
 }
 return normalized;
}
module.exports={enabled,available,getMatchOdds,getFullOdds,getLiveIntelligence,getHistoricalLeagueFixtures,getScoreboardDay,normalizeScoreFixture,normalizeStats,normalizeEvents,priceFreshness,normalizeMarkets,normalizeFixture,marketStages};
