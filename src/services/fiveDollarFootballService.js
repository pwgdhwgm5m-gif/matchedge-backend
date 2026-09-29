const axios=require('axios');
const config=require('../config/config');
const {teamNamesMatch}=require('../utils/textNormalize');

const memory=new Map(),DAY_TTL_MS=10*60*1000,MISS_TTL_MS=30*60*1000,RATE_BACKOFF_MS=60*60*1000,AUTH_BACKOFF_MS=15*60*1000;
let blockedUntil=0;
const num=v=>{const n=Number(v);return n>1?n:null};
function enabled(){return Boolean(config.fiveDollarFootball?.key)}
function available(){return enabled()&&Date.now()>=blockedUntil}
function headers(){return {Authorization:`Bearer ${config.fiveDollarFootball.key}`}}
function backoff(status,retryAfter){if(status===429)blockedUntil=Math.max(blockedUntil,Date.now()+Math.max(60000,Number(retryAfter||0)*1000||RATE_BACKOFF_MS));else if(status===401||status===403)blockedUntil=Math.max(blockedUntil,Date.now()+AUTH_BACKOFF_MS)}
function priceFreshness(value){const raw=value?.updated_at||value?.updatedAt||value?.timestamp||value?.last_update||null;if(!raw)return {fresh:false,updatedAt:null};const ms=typeof raw==='number'?(raw>1e12?raw:raw*1000):Date.parse(raw);if(!Number.isFinite(ms))return {fresh:false,updatedAt:null};return {fresh:Date.now()-ms<=15*60*1000,updatedAt:new Date(ms).toISOString()}}
function stage(v){return v&&(v.inplay||v.closing||v.opening||v)}
function pair(v,a=['over','over_odds','over25','over_2.5'],b=['under','under_odds','under25','under_2.5']){const p=stage(v)||{};const pick=keys=>keys.map(k=>num(p[k])).find(Boolean)||null;const x=pick(a),y=pick(b);return x&&y?{a:x,b:y}:null}
function oddsRoot(f){const o=f?.odds||{};if(Array.isArray(o.bookmakers)){const book=o.bookmakers.find(x=>/bet365/i.test(String(x.slug||x.name||'')))||o.bookmakers[0];return book?.odds||book?.markets||{}}if(Array.isArray(f?.bookmakers)){const book=f.bookmakers.find(x=>/bet365/i.test(String(x.slug||x.name||'')))||f.bookmakers[0];return book?.odds||book?.markets||{}}return o}
function normalizeMarkets(root){
 const one=stage(root?.['1x2']||root?.match_result||root?.moneyline)||{};
 const h=num(one.home),d=num(one.draw),a=num(one.away);
 const h2h=h&&d&&a?{home:h,draw:d,away:a}:null;
 const ladder=root?.goal_line_fixed||root?.goalline_fixed||root?.totals||root?.total_goals;
 const rows=Array.isArray(ladder)?ladder:Array.isArray(ladder?.lines)?ladder.lines:Object.entries(ladder||{}).map(([k,v])=>typeof v==='object'?{_key:k,...v}:v);
 let row=rows.find(x=>Number(x?.line??x?.handicap??x?.total??x?._key)===2.5);
 if(!row&&ladder&&!Array.isArray(ladder))row=ladder['2.5']||ladder['2_5']||ladder.over_2_5;
 let t=pair(row);
 if(!t){const main=stage(root?.goal_line||root?.goalline);if(Number(main?.line)===2.5)t=pair(main)}
 const bp=stage(root?.btts||root?.both_teams_to_score||root?.bothTeamsToScore||root?.both_teams_score)||{};
 const yes=num(bp.yes??bp.Yes??bp.both??bp.btts_yes),no=num(bp.no??bp.No??bp.not_both??bp.btts_no);
 return {h2h,totals:t?{over25:t.a,under25:t.b}:null,btts:yes&&no?{yes,no}:null};
}
function normalizeFixture(f,homeName,awayName,fetchedAt){
 if(!f||!teamNamesMatch(f.teams?.home?.name,homeName)||!teamNamesMatch(f.teams?.away?.name,awayName))return null;
 const markets=normalizeMarkets(oddsRoot(f)),fresh=Date.now()-Number(fetchedAt||0)<=DAY_TTL_MS*1.5;
 return {fixtureId:String(f.id),providerIdentity:{competitionId:String(f.league?.id||f.competition?.id||''),fixtureId:String(f.id),homeTeamId:String(f.teams?.home?.id||''),awayTeamId:String(f.teams?.away?.id||'')},matchOdds:markets.h2h,totals25:markets.totals,btts:markets.btts,marketBoard:{bookmakers:[{bookmaker:'market',h2h:markets.h2h,totals:markets.totals,btts:markets.btts,fresh,updatedAt:fetchedAt?new Date(fetchedAt).toISOString():null}],bookmakerCount:1},source:'5dollarfootball-market',fetchedAt};
}
async function getDay(start){
 const key=`five-dollar-day-v3:${start}`,cached=memory.get(key);if(cached?.expires>Date.now())return cached;if(!available())return null;
 try{let data=[],page=1,lastHeaders={};while(page<=8){const r=await axios.get(`${config.fiveDollarFootball.baseUrl}/fixtures`,{headers:headers(),params:{start_time:start,end_time:start+86400,include:'odds',per_page:50,page},timeout:7000});lastHeaders=r.headers||{};const rows=Array.isArray(r.data?.data)?r.data.data:[];data.push(...rows);const more=r.data?.pagination?.has_more===true||r.data?.meta?.current_page<r.data?.meta?.last_page;if(!more||!rows.length)break;const rem=Number(lastHeaders['x-ratelimit-remaining']);if(Number.isFinite(rem)&&rem<=2)break;page++}
 const now=Date.now(),row={data,expires:now+DAY_TTL_MS,fetchedAt:now,rate:{limit:lastHeaders['x-ratelimit-limit']||null,remaining:lastHeaders['x-ratelimit-remaining']||null,reset:lastHeaders['x-ratelimit-reset']||null}};memory.set(key,row);return row;
 }catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);console.warn('[5dollar]',e.response?.status===429?'rate limit backoff':e.response?.status===401||e.response?.status===403?'auth/plan unavailable':'request failed');return null}
}

async function getFullOdds(fixtureId){
 const key=`five-dollar-full-odds-v1:${fixtureId}`,cached=memory.get(key);if(cached?.expires>Date.now())return cached.data;if(!available())return null;
 try{
  const r=await axios.get(`${config.fiveDollarFootball.baseUrl}/fixtures/${fixtureId}/odds`,{headers:headers(),params:{bookmakers:'bet365'},timeout:7000});
  const books=r.data?.data?.bookmakers||[];const book=books.find(x=>String(x.slug||'').toLowerCase()==='bet365')||books[0];
  const data=book?.odds||null;memory.set(key,{data,expires:Date.now()+DAY_TTL_MS});return data;
 }catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);console.warn('[5dollar/odds]',e.response?.status||'request failed');return null}
}
async function getMatchOdds(homeName,awayName,kickoff){
 if(!available()||!homeName||!awayName||!kickoff)return null;const d=new Date(kickoff);if(Number.isNaN(d.getTime()))return null;
 const start=Math.floor((d.getTime()-12*60*60*1000)/1000),missKey=`five-dollar-miss-v3:${start}:${String(homeName).toLowerCase()}:${String(awayName).toLowerCase()}`,miss=memory.get(missKey);if(miss?.expires>Date.now())return null;
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
module.exports={enabled,available,getMatchOdds,getFullOdds,priceFreshness,normalizeMarkets,normalizeFixture};
