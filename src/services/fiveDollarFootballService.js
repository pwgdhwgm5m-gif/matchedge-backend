const axios = require('axios');
const config = require('../config/config');
const { teamNamesMatch } = require('../utils/textNormalize');

const memory = new Map();
const DAY_TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 30 * 60 * 1000;
const RATE_BACKOFF_MS = 60 * 60 * 1000;
const AUTH_BACKOFF_MS = 15 * 60 * 1000;
let blockedUntil = 0;

function enabled(){ return Boolean(config.fiveDollarFootball?.key); }
function available(){ return enabled() && Date.now() >= blockedUntil; }
function headers(){ return { Authorization: `Bearer ${config.fiveDollarFootball.key}` }; }
function backoff(status,retryAfter){
  if(status===429){
    const retryMs=Math.max(60000,Number(retryAfter||0)*1000||RATE_BACKOFF_MS);
    blockedUntil=Math.max(blockedUntil,Date.now()+retryMs);
  } else if(status===401||status===403) blockedUntil=Math.max(blockedUntil,Date.now()+AUTH_BACKOFF_MS);
}
function rememberMiss(key){ memory.set(key,{data:null,miss:true,expires:Date.now()+MISS_TTL_MS}); }
function stage(block){
  if(!block)return null;
  // Provider payloads can expose a current/live snapshot as well as opening
  // and closing. Prefer the newest executable quote without fabricating one.
  return block.current || block.latest || block.closing || block.opening || block;
}
function fixed25(odds){
  const ladder=odds?.goal_line_fixed || odds?.goalline_fixed || odds?.totals || odds?.total_goals;
  let rows=Array.isArray(ladder)?ladder:(Array.isArray(ladder?.lines)?ladder.lines:Object.values(ladder||{}));
  let row=rows.find(x=>Number(x?.line??x?.handicap??x?.total)===2.5);
  if(!row&&ladder&&!Array.isArray(ladder))row=ladder['2.5']||ladder['2_5']||ladder.over_2_5||null;
  const p=stage(row);
  const over=p?.over??p?.over_odds??p?.over25??p?.['over_2.5'];
  const under=p?.under??p?.under_odds??p?.under25??p?.['under_2.5'];
  if(Number(over)>1&&Number(under)>1)return {over25:Number(over),under25:Number(under)};
  const main=stage(odds?.goal_line||odds?.goalline);
  if(main&&Number(main.line)===2.5&&Number(main.over)>1&&Number(main.under)>1)return {over25:Number(main.over),under25:Number(main.under)};
  return null;
}
function bttsPair(odds){
  const p=stage(odds?.btts||odds?.both_teams_to_score||odds?.bothTeamsToScore||odds?.both_teams_score);
  const yes=p?.yes??p?.both??p?.btts_yes??p?.Yes;
  const no=p?.no??p?.not_both??p?.btts_no??p?.No;
  return Number(yes)>1&&Number(no)>1?{yes:Number(yes),no:Number(no)}:null;
}
function priceFreshness(value){
  const raw=value?.updated_at||value?.updatedAt||value?.timestamp||value?.last_update||null;
  if(!raw)return {fresh:false,updatedAt:null};
  const ms=typeof raw==='number'?(raw>1e12?raw:raw*1000):Date.parse(raw);
  if(!Number.isFinite(ms))return {fresh:false,updatedAt:null};
  return {fresh:Date.now()-ms<=15*60*1000,updatedAt:new Date(ms).toISOString()};
}
function oddsBlock(f){
  if(!f)return {};
  if(f.odds?.['1x2']||f.odds?.goal_line||f.odds?.goalline||f.odds?.goal_line_fixed||f.odds?.goalline_fixed||f.odds?.totals||f.odds?.total_goals||f.odds?.btts||f.odds?.both_teams_to_score||f.odds?.bothTeamsToScore)return f.odds;
  const books=f.odds?.bookmakers||f.bookmakers||[];
  const b=Array.isArray(books)?(books.find(x=>String(x.slug||'').toLowerCase()==='bet365')||books[0]):null;
  return b?.odds||{};
}
function normalizeFixture(f,homeName,awayName,fetchedAt){
  if(!f||!teamNamesMatch(f.teams?.home?.name,homeName)||!teamNamesMatch(f.teams?.away?.name,awayName))return null;
  const odds=oddsBlock(f);
  const one=stage(odds['1x2'] || odds.match_result || odds.moneyline);
  const matchOdds=one&&Number(one.home)>1&&Number(one.draw)>1&&Number(one.away)>1
    ? {home:Number(one.home),draw:Number(one.draw),away:Number(one.away)}:null;
  const totals=fixed25(odds), btts=bttsPair(odds);
  const fresh=Date.now()-Number(fetchedAt||0)<=DAY_TTL_MS*1.5;
  const bookmaker={bookmaker:'market',h2h:matchOdds,totals,btts,fresh,updatedAt:fetchedAt?new Date(fetchedAt).toISOString():null};
  return {
    fixtureId:String(f.id), matchOdds, totals25:totals, btts,
    marketBoard:{bookmakers:[bookmaker],bookmakerCount:1},
    rawOdds:odds, source:'5dollarfootball-market', fetchedAt
  };
}
async function getDay(start){
  const key=`five-dollar-day-v2:${start}`;
  const cached=memory.get(key);
  if(cached&&cached.expires>Date.now())return cached;
  if(!available())return null;
  try{
    // Pro supports compound list requests. One request supplies every fixture
    // in the 24h window plus executable odds; never fan out one odds call/match.
    const response=await axios.get(`${config.fiveDollarFootball.baseUrl}/fixtures`,{
      headers:headers(),params:{start_time:start,end_time:start+86400,include:'odds',per_page:50},timeout:5000
    });
    const now=Date.now();
    const row={data:Array.isArray(response.data?.data)?response.data.data:[],expires:now+DAY_TTL_MS,fetchedAt:now,
      rate:{limit:response.headers?.['x-ratelimit-limit']||null,remaining:response.headers?.['x-ratelimit-remaining']||null,reset:response.headers?.['x-ratelimit-reset']||null}};
    memory.set(key,row);
    return row;
  }catch(e){
    const status=e.response?.status;
    backoff(status,e.response?.headers?.['retry-after']);
    console.warn('[5dollar]',status===429?'rate limit backoff':status===401||status===403?'auth/plan unavailable':'request failed');
    return null;
  }
}
async function getMatchOdds(homeName,awayName,kickoff){
  if(!available()||!homeName||!awayName||!kickoff)return null;
  const d=new Date(kickoff); if(Number.isNaN(d.getTime()))return null;
  const start=Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())/1000);
  const missKey=`five-dollar-miss-v2:${start}:${String(homeName).toLowerCase()}:${String(awayName).toLowerCase()}`;
  const miss=memory.get(missKey); if(miss?.expires>Date.now())return null;
  const day=await getDay(start); if(!day)return null;
  const fixture=day.data.find(x=>teamNamesMatch(x.teams?.home?.name,homeName)&&teamNamesMatch(x.teams?.away?.name,awayName));
  if(!fixture){rememberMiss(missKey);return null;}
  return normalizeFixture(fixture,homeName,awayName,day.fetchedAt);
}
module.exports={enabled,available,getMatchOdds,priceFreshness};
