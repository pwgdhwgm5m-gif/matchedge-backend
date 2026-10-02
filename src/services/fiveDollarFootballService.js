const axios=require('axios');
const config=require('../config/config');
const {teamNamesMatch}=require('../utils/textNormalize');
const providerQuota=require('./providerQuotaService');

const memory=new Map(),inflight=new Map(),DAY_TTL_MS=10*60*1000,IDENTITY_TTL_MS=24*60*60*1000,HISTORY_TTL_MS=6*60*60*1000,STANDINGS_TTL_MS=6*60*60*1000,ODDS_TTL_MS=10*60*1000,MISS_TTL_MS=30*60*1000,RATE_BACKOFF_MS=60*60*1000,AUTH_BACKOFF_MS=15*60*1000;
let blockedUntil=0,rateState={limit:null,remaining:null,reset:null};
function coalesce(key,fn){if(inflight.has(key))return inflight.get(key);const p=Promise.resolve().then(fn).finally(()=>inflight.delete(key));inflight.set(key,p);return p}
function updateRate(h={}){rateState={limit:Number(h['x-ratelimit-limit'])||null,remaining:Number(h['x-ratelimit-remaining']),reset:h['x-ratelimit-reset']||null};if(Number.isFinite(rateState.remaining)&&rateState.remaining<=2)blockedUntil=Math.max(blockedUntil,Date.now()+60000)}
function cacheRow(key,data,ttl){memory.set(key,{data,expires:Date.now()+ttl});return data}
const num=v=>{const n=Number(v);return n>1?n:null};
function enabled(){return Boolean(config.fiveDollarFootball?.key)}
function available(){return enabled()&&Date.now()>=blockedUntil&&providerQuota.canCall('bsd')}
function headers(){return {Authorization:`Bearer ${config.fiveDollarFootball.key}`}}
async function request5(path, options={}){
  if(!providerQuota.canCall('bsd')) throw Object.assign(new Error('bsd quota guard'),{code:'BSD_QUOTA_GUARD'});
  providerQuota.record('bsd');
  try{
    const r=await axios.get(`${config.fiveDollarFootball.baseUrl}${path}`,{...options,headers:{...headers(),...(options.headers||{})}});
    updateRate(r.headers||{});
    return r;
  }catch(e){
    backoff(e.response?.status,e.response?.headers?.['retry-after']);
    throw e;
  }
}
function backoff(status,retryAfter){if(status===429){const ms=Math.max(60000,Number(retryAfter||0)*1000||RATE_BACKOFF_MS);blockedUntil=Math.max(blockedUntil,Date.now()+ms);providerQuota.rateLimited('bsd',ms);}else if(status===401||status===403)blockedUntil=Math.max(blockedUntil,Date.now()+AUTH_BACKOFF_MS)}
function priceFreshness(value){const raw=value?.updated_at||value?.updatedAt||value?.timestamp||value?.last_update||null;if(!raw)return {fresh:false,updatedAt:null};const ms=typeof raw==='number'?(raw>1e12?raw:raw*1000):Date.parse(raw);if(!Number.isFinite(ms))return {fresh:false,updatedAt:null};return {fresh:Date.now()-ms<=15*60*1000,updatedAt:new Date(ms).toISOString()}}
function stage(v){return v&&(v.inplay||v.closing||v.opening||v)}
function pair(v,a=['over','over_odds','over25','over_2.5'],b=['under','under_odds','under25','under_2.5']){const p=stage(v)||{};const pick=keys=>keys.map(k=>num(p[k])).find(Boolean)||null;const x=pick(a),y=pick(b);return x&&y?{a:x,b:y}:null}
function oddsBook(f){
 const o=f?.odds||{};
 if(Array.isArray(o.bookmakers)){
   const book=o.bookmakers.find(x=>/bet365/i.test(String(x.slug||x.name||'')))||o.bookmakers[0];
   return {name:book?.name||book?.title||book?.slug||'Bet365',root:book?.odds||book?.markets||{}};
 }
 if(Array.isArray(f?.bookmakers)){
   const book=f.bookmakers.find(x=>/bet365/i.test(String(x.slug||x.name||'')))||f.bookmakers[0];
   return {name:book?.name||book?.title||book?.slug||'Bet365',root:book?.odds||book?.markets||{}};
 }
 return {name:'Bet365',root:o};
}
function oddsRoot(f){return oddsBook(f).root}
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
 const book=oddsBook(f),markets=normalizeMarkets(book.root),fresh=Date.now()-Number(fetchedAt||0)<=DAY_TTL_MS*1.5;
 const bookmaker=String(book.name||'Bet365').toLowerCase().includes('bet365')?'Bet365':String(book.name||'Bet365');
 return {fixtureId:String(f.id),providerIdentity:{competitionId:String(f.league?.id||f.competition?.id||''),fixtureId:String(f.id),homeTeamId:String(f.teams?.home?.id||''),awayTeamId:String(f.teams?.away?.id||'')},matchOdds:markets.h2h,totals25:markets.totals,btts:markets.btts,marketBoard:{bookmakers:[{bookmaker, name:bookmaker, h2h:markets.h2h,totals:markets.totals,btts:markets.btts,fresh,updatedAt:fetchedAt?new Date(fetchedAt).toISOString():null}],bookmakerCount:1},source:'5dollarfootball-bet365',fetchedAt};
}
async function getDay(start){
 const key=`five-dollar-day-v3:${start}`,cached=memory.get(key);if(cached?.expires>Date.now())return cached;if(!available())return cached||null;
 return coalesce(key,async()=>{try{let data=[],page=1,lastHeaders={};while(page<=8){const r=await request5('/fixtures',{params:{start_time:start,end_time:start+86400,include:'odds',per_page:50,page},timeout:7000});lastHeaders=r.headers||{};const rows=Array.isArray(r.data?.data)?r.data.data:[];data.push(...rows);const more=r.data?.pagination?.has_more===true||r.data?.meta?.current_page<r.data?.meta?.last_page;if(!more||!rows.length)break;const rem=Number(lastHeaders['x-ratelimit-remaining']);if(Number.isFinite(rem)&&rem<=2)break;page++}
 const now=Date.now(),row={data,expires:now+DAY_TTL_MS,fetchedAt:now,rate:{limit:lastHeaders['x-ratelimit-limit']||null,remaining:lastHeaders['x-ratelimit-remaining']||null,reset:lastHeaders['x-ratelimit-reset']||null}};memory.set(key,row);return row;
 }catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);console.warn('[5dollar]',e.response?.status===429?'rate limit backoff':e.response?.status===401||e.response?.status===403?'auth/plan unavailable':'request failed');return cached||null}})
}

function kickoffMs(f){return Number(f?.kickoff_ts)*1000||Date.parse(f?.kickoff_utc||f?.start_time||'')}
function toAnalysisFixture(f){
 const homeId=String(f?.teams?.home?.id||''),awayId=String(f?.teams?.away?.id||'');
 return {fixture:{id:String(f.id),date:f.kickoff_utc||f.start_time||null,status:{short:f.status==='finished'?'FT':String(f.status||'').toUpperCase()}},
  league:{id:String(f?.league?.id||''),name:f?.league?.name||''},teams:{home:{id:homeId,name:f?.teams?.home?.name||''},away:{id:awayId,name:f?.teams?.away?.name||''}},
  goals:{home:Number.isFinite(Number(f?.goals?.home))?Number(f.goals.home):null,away:Number.isFinite(Number(f?.goals?.away))?Number(f.goals.away):null},
  corners:{home:Number.isFinite(Number(f?.corners?.home))?Number(f.corners.home):null,away:Number.isFinite(Number(f?.corners?.away))?Number(f.corners.away):null},cards:f?.cards||null,_fiveDollar:true};
}
async function getFixturesByDate(date){
 const d=new Date(String(date)+'T12:00:00Z');if(Number.isNaN(d.getTime()))return {ok:false,error:'invalid_date',matches:[]};
 const start=Math.floor((d.getTime()-12*3600000)/1000),day=await getDay(start);if(!day)return {ok:false,error:'five_dollar_unavailable',matches:[]};
 return {ok:true,matches:day.data.map(f=>({fixtureId:String(f.id),fiveDollarFixtureId:String(f.id),homeTeam:f?.teams?.home?.name||'',awayTeam:f?.teams?.away?.name||'',homeTeamId:String(f?.teams?.home?.id||''),awayTeamId:String(f?.teams?.away?.id||''),league:f?.league?.name||'',leagueName:f?.league?.name||'',leagueId:String(f?.league?.id||''),kickoff:f?.kickoff_utc||f?.start_time||null,date:f?.kickoff_utc||f?.start_time||null,status:f?.status||null,homeScore:f?.goals?.home??null,awayScore:f?.goals?.away??null,canonicalProvider:'5dollarfootball',source:'5dollarfootball',providerIds:{fiveDollar:String(f.id)},providerTeamIds:{fiveDollar:{home:String(f?.teams?.home?.id||''),away:String(f?.teams?.away?.id||'')}},fiveDollarLeagueId:String(f?.league?.id||'')})),fetchedAt:day.fetchedAt};
}
async function resolveFixture(homeName,awayName,kickoff){
 if(!available()||!homeName||!awayName||!kickoff)return null;const d=new Date(kickoff);if(Number.isNaN(d.getTime()))return null;
 const start=Math.floor((d.getTime()-12*3600000)/1000),day=await getDay(start);if(!day)return null;const target=d.getTime();
 const candidates=day.data.filter(x=>teamNamesMatch(x.teams?.home?.name,homeName)&&teamNamesMatch(x.teams?.away?.name,awayName)).sort((a,b)=>Math.abs(kickoffMs(a)-target)-Math.abs(kickoffMs(b)-target));
 const f=candidates.find(x=>!Number.isFinite(kickoffMs(x))||Math.abs(kickoffMs(x)-target)<=4*3600000);if(!f)return null;
 return {raw:f,fixtureId:String(f.id),leagueId:String(f?.league?.id||''),homeTeamId:String(f?.teams?.home?.id||''),awayTeamId:String(f?.teams?.away?.id||''),homeTeam:f?.teams?.home?.name||homeName,awayTeam:f?.teams?.away?.name||awayName,kickoff:f?.kickoff_utc||f?.start_time||kickoff};
}
async function getFixtureContext(fixtureId){
 if(!fixtureId||!available())return null;const key=`five-dollar-fixture-v1:${fixtureId}`,hit=memory.get(key);if(hit?.expires>Date.now())return hit.data;
 return coalesce(key,async()=>{try{const r=await request5(`/fixtures/${fixtureId}`,{timeout:7000});const f=r.data?.data||null;if(!f)return null;const out={raw:f,fixtureId:String(f.id),leagueId:String(f?.league?.id||''),homeTeamId:String(f?.teams?.home?.id||''),awayTeamId:String(f?.teams?.away?.id||''),homeTeam:f?.teams?.home?.name||'',awayTeam:f?.teams?.away?.name||'',kickoff:f?.kickoff_utc||f?.start_time||null};return cacheRow(key,out,IDENTITY_TTL_MS)}catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);return null}})
}
async function getTeamFixtures(teamId,{leagueId=null,limit=15}={}){
 if(!available()||!teamId)return {ok:false,error:'missing_team_id',data:{response:[]}};const key=`five-dollar-team-v1:${teamId}:${leagueId||'all'}:${limit}`,hit=memory.get(key);if(hit?.expires>Date.now())return hit.data;
 return coalesce(key,async()=>{try{let rows=[],page=1;while(page<=4&&rows.length<Math.max(limit,15)){const r=await request5(`/teams/${teamId}/fixtures`,{params:{status:'finished',per_page:50,page},timeout:7000});const batch=Array.isArray(r.data?.data)?r.data.data:[];rows.push(...batch);if(r.data?.pagination?.has_more!==true||!batch.length)break;page++}
  if(leagueId)rows=rows.filter(x=>String(x?.league?.id||'')===String(leagueId));rows=rows.slice(0,limit);const out={ok:rows.length>0,source:'5dollarfootball-team-history',teamId:String(teamId),data:{response:rows.map(toAnalysisFixture)},raw:rows};memory.set(key,{data:out,expires:Date.now()+HISTORY_TTL_MS});return out;
 }catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);return hit?.data||{ok:false,error:`five_dollar_team_${e.response?.status||'failed'}`,data:{response:[]}}}})
}
async function getStandings(leagueId){
 if(!available()||!leagueId)return {ok:false,available:false,table:[]};const key=`five-dollar-standings-v1:${leagueId}`,hit=memory.get(key);if(hit?.expires>Date.now())return hit.data;
 return coalesce(key,async()=>{try{const r=await request5('/standings',{params:{league:leagueId,type:'total'},timeout:7000});const rows=Array.isArray(r.data?.data?.table)?r.data.data.table:[];const out={ok:true,available:rows.length>0,source:'5dollarfootball',table:rows.map(x=>({teamId:String(x?.team?.id||''),teamName:x?.team?.name||'',rank:Number(x.position),points:Number.isFinite(Number(x.points))?Number(x.points):null,played:Number.isFinite(Number(x.played))?Number(x.played):null,description:null}))};memory.set(key,{data:out,expires:Date.now()+STANDINGS_TTL_MS});return out;}catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);return hit?.data||{ok:false,available:false,error:`five_dollar_standings_${e.response?.status||'failed'}`,table:[]}}})
}
async function getFullOdds(fixtureId){
 const key=`five-dollar-full-odds-v1:${fixtureId}`,cached=memory.get(key);if(cached?.expires>Date.now())return cached.data;if(!available())return null;
 return coalesce(key,async()=>{try{
  const r=await request5(`/fixtures/${fixtureId}/odds`,{params:{bookmakers:'bet365'},timeout:7000});const books=r.data?.data?.bookmakers||[];const book=books.find(x=>String(x.slug||'').toLowerCase()==='bet365')||books[0];
  const data=book?.odds||null;memory.set(key,{data,expires:Date.now()+ODDS_TTL_MS});return data;
 }catch(e){backoff(e.response?.status,e.response?.headers?.['retry-after']);console.warn('[5dollar/odds]',e.response?.status||'request failed');return cached?.data||null}})
}
async function getFixtureOdds(fixtureId,{homeName='',awayName='',leagueId='',homeTeamId='',awayTeamId='',kickoff=null}={}){
 if(!fixtureId)return null;
 // Cache reads must never be blocked by the provider quota guard. A cached
 // bookmaker quote is already paid for and is safe to reuse; only a cache miss
 // may require a fresh provider call.
 if(homeName&&awayName&&kickoff){
   const cached=await getMatchOdds(homeName,awayName,kickoff);
   if(cached?.matchOdds||cached?.totals25||cached?.btts)return cached;
 }
 if(!available())return null;
 const full=await getFullOdds(fixtureId);if(!full)return null;
 const markets=normalizeMarkets(full),now=Date.now();
 return {fixtureId:String(fixtureId),providerIdentity:{competitionId:String(leagueId||''),fixtureId:String(fixtureId),homeTeamId:String(homeTeamId||''),awayTeamId:String(awayTeamId||'')},homeTeam:homeName,awayTeam:awayName,matchOdds:markets.h2h,totals25:markets.totals,btts:markets.btts,cornerLine:full?.corner_line||full?.cornerLine||null,marketBoard:{bookmakers:[{bookmaker:'bet365',h2h:markets.h2h,totals:markets.totals,btts:markets.btts,fresh:true,updatedAt:new Date(now).toISOString()}],bookmakerCount:1},source:'5dollarfootball-bet365',fetchedAt:now};
}
async function getMatchOdds(homeName,awayName,kickoff){
 if(!homeName||!awayName||!kickoff)return null;const d=new Date(kickoff);if(Number.isNaN(d.getTime()))return null;
 const start=Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())/1000),missKey=`five-dollar-miss-v3:${start}:${String(homeName).toLowerCase()}:${String(awayName).toLowerCase()}`,miss=memory.get(missKey);if(miss?.expires>Date.now())return null;
 const day=await getDay(start);if(!day)return null;const target=d.getTime();
 const f=day.data.find(x=>{if(!teamNamesMatch(x.teams?.home?.name,homeName)||!teamNamesMatch(x.teams?.away?.name,awayName))return false;const k=Number(x.kickoff_ts)*1000||Date.parse(x.kickoff_utc||x.start_time||'');return !Number.isFinite(k)||Math.abs(k-target)<=4*60*60*1000});
 if(!f){memory.set(missKey,{miss:true,expires:Date.now()+MISS_TTL_MS});return null}
 // If the shared day cache exists, never spend another BSD request merely to
 // read its bookmaker prices. Only the enrichment below can require a call.
 // The list include is intentionally compact. The documented single-fixture
 // odds endpoint is the authoritative payload for BTTS and goal_line_fixed.
 let normalized=normalizeFixture(f,homeName,awayName,day.fetchedAt);
 // Quota isolation: the day fixture feed already includes bookmaker odds and is
 // shared by every analysis on that date. Never spend one single-fixture odds
 // request merely because an optional BTTS/totals market is absent. Only enrich
 // when the cached day payload contains no usable bookmaker market at all.
 if(!normalized?.matchOdds && !normalized?.totals25 && !normalized?.btts){
   const full=await getFullOdds(f.id);
   if(full)normalized=normalizeFixture({...f,odds:full},homeName,awayName,Date.now());
 }
 return normalized;
}
function quotaState(){return {...rateState,blockedUntil:blockedUntil||null,blocked:Date.now()<blockedUntil,inflight:inflight.size,cacheEntries:memory.size}}
module.exports={enabled,available,quotaState,getFixturesByDate,resolveFixture,getFixtureContext,getTeamFixtures,getStandings,getMatchOdds,getFixtureOdds,getFullOdds,priceFreshness,normalizeMarkets,normalizeFixture,toAnalysisFixture};
