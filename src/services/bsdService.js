/**
 * bsdService.js
 * SoccerEdge Pro — Bzzoiro Sports Data (BSD, sports.bzzoiro.com) entegrasyonu.
 *
 * NEDEN: TheSportsDB gercek xG'yi SADECE kendi Pro/Premium eslestirmesinin
 * kapsadigi buyuk liglerde saglıyor (bkz. sportsDbService.js). BSD ikinci
 * bir "gercek xG" kaynagi olarak eklendi - kapsadigi liglerde (kendi sut
 * verisinden geldigi icin TheSportsDB'den farkli bir lig seti olabilir)
 * asıl olcumu, kapsamadigi durumlarda ise kendi tahminini donuyor. BSD
 * cevabindaki kok seviye "xg_estimated" bayragi bu ikisini ayirt ediyor -
 * biz SADECE bu bayrak false ise "gercek xG" olarak kullaniyoruz. Bayrak
 * true oldugunda (BSD'nin KENDISI de o mac icin gercek veri degil tahmin
 * sunuyor demektir) mevcut yerel istatistiksel tahmine (liveXgService)
 * dusuluyor - "tahminimi gercek gibi gosterme" ilkesi boyle korunuyor.
 *
 * ONEMLI KISIT: BSD kendi event ID sistemini kullaniyor, TheSportsDB'nin
 * fixtureId'siyle hicbir iliskisi yok. Bu yuzden once takim adi + mac
 * saatine gore BSD'deki karsilik gelen event'i "resolve" ediyoruz (asagida
 * resolveBsdEventId), sonra o ID ile xG verisini cekiyoruz. Takim adi
 * eslestirmesi kademeli gevser: once iki takim adi da eslesirse onu kullan,
 * tutmazsa sadece ev sahibi adina (+ kickoff yakinligina) guven - farkli
 * kaynaklar ayni kulubu cok farkli adlandirabiliyor (gercek ornek: ayni
 * kulup TheSportsDB'de "Racing de Santander", BSD'de "Real Racing Club" -
 * ortak hicbir kelime yok). Ayni gun ayni ev sahibinin iki farkli resmi
 * maci olmasi son derece nadir oldugu icin bu guvenli bir gevseme.
 *
 * Endpoint/alan adlari, BSD'nin gercek API yanitlariyla (Render loglarindan
 * ve kullanicinin docs sayfasindan paylastigi ornek JSON'lardan) dogrulandi:
 * - BSD v2: GET /events/live/ and GET /events/?date_from=...&date_to=...&team_name=...
 *   ("sport" diye bir parametre YOK - BSD zaten sadece futbol API'si; tarih
 *   filtresi "date" degil "date_from"/"date_to")
 * - GET /events/{id}/stats/ -> { xg_estimated, stats: { home: { xg: { actual,
 *   estimated } }, away: { ... } }, shotmap, momentum, ... }
 * Her adim yine de savunmaci: beklenen alan/endpoint bulunamazsa sessizce
 * { available: false } doner, hicbir sey kirilmaz - sadece o mac icin
 * "gercek BSD xG'si" gorunmez, mevcut tahmini xG'ye dusulur.
 */

const { normalizeTeamName } = require('../utils/textNormalize');
const cache = require('../utils/cache');
const fixtureIdentity = require('./fixtureIdentityService');

const BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const API_KEY = process.env.BSD_API_KEY || '';

async function fetchBsd(path, timeoutMs) {
  if (!API_KEY) return { ok: false, error: 'no_api_key' };

  const ms = timeoutMs || 8000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  try {
    const res = await fetch(BASE_URL + path, {
      signal: controller.signal,
      headers: { 'Authorization': 'Token ' + API_KEY },
    });
    if (!res.ok) {
      return { ok: false, error: 'http_' + res.status };
    }
    const json = await res.json();
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBsdCached(path, ttlSeconds, timeoutMs) {
  const key='bsd-http:'+path;
  const hit=cache.get(key);
  if(hit !== undefined) return {...hit,cached:true};
  const result=await fetchBsd(path,timeoutMs);
  // Cache successes normally and failures briefly so one unavailable BSD
  // endpoint cannot burn the daily allowance through repeated UI refreshes.
  cache.set(key,result,result.ok ? ttlSeconds : Math.min(60,ttlSeconds));
  return result;
}

async function fetchBsdAll(path, ttlSeconds, timeoutMs) {
  const sep=path.includes('?')?'&':'?'; let offset=0, all=[];
  while(true){
    const page=await fetchBsdCached(path+sep+'limit=200&offset='+offset,ttlSeconds,timeoutMs);
    if(!page.ok)return page;
    const rows=extractList(page.data); all.push(...rows);
    const count=Number(page.data?.count||0);
    if(rows.length<200 || (count && all.length>=count))break;
    offset+=200;
  }
  return {ok:true,data:{count:all.length,results:all}};
}

async function getLeagueRegistry(){
  const r=await fetchBsdAll('/leagues/?',6*60*60,10000);
  if(!r.ok)return r;
  const map={};
  for(const l of extractList(r.data)){
    const id=String(pickField(l,['id','league_id'])||'');
    const name=String(pickField(l,['name','league_name','title'])||'').trim();
    if(id&&name)map[id]={id,name,country:pickField(l,['country.name','country_name','country'])||'',raw:l};
  }
  return {ok:true,map};
}

function extractList(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  return data.results || data.events || data.data || [];
}

async function getLiveFootballEvents() {
  return fetchBsdCached('/events/live/', 20, 8000);
}

async function getFootballEventsForDate(dateStr, teamName) {
  let path = '/events/?date_from=' + dateStr + '&date_to=' + dateStr + '&limit=200';
  if (teamName) path += '&team_name=' + encodeURIComponent(teamName);
  return fetchBsdCached(path, 60, 8000);
}

function pickField(obj, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const val = candidates[i].split('.').reduce(function (acc, key) {
      return acc && acc[key] !== undefined ? acc[key] : undefined;
    }, obj);
    if (val !== undefined && val !== null) return val;
  }
  return null;
}

function teamValue(v){
  if(v&&typeof v==='object')return v.name||v.team_name||v.title||v.short_name||v.full_name||'';
  return v==null?'':String(v);
}
function getHomeTeamName(e) {
  return teamValue(pickField(e, ['home_team.name','home_team.team_name','home_team.title','home_team','home.name','home_name','home']));
}
function getAwayTeamName(e) {
  return teamValue(pickField(e, ['away_team.name','away_team.team_name','away_team.title','away_team','away.name','away_name','away']));
}
function getKickoff(e) {
  return pickField(e, ['kickoff', 'start_time', 'date', 'event_date']);
}
function getEventId(e) {
  return pickField(e, ['event_id', 'id']);
}

function isNameMatch(bsdName, ourName) {
  if (!bsdName || !ourName) return false;
  const a = normalizeTeamName(String(bsdName));
  const b = normalizeTeamName(String(ourName));
  if (!a || !b) return false;
  return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
}

function isWithinKickoffTolerance(e, kickoffMs) {
  if (!kickoffMs) return true;
  const evKickoff = getKickoff(e);
  if (!evKickoff) return true;
  const diffMs = Math.abs(new Date(evKickoff).getTime() - kickoffMs);
  return diffMs < 3 * 60 * 60 * 1000; // 3 saat tolerans - farkli gunlerdeki rovans maclarini karistirmamak icin
}

/**
 * Asama asama gevseyen mac arama: once iki takim adi da eslesirse (en
 * guvenilir) onu kullan; tutmazsa sadece ev sahibi adina ve kickoff
 * yakinligina guven. Birden fazla aday cikarsa deplasman adiyla daraltmaya
 * calisilir, o da tutmazsa ilk aday kullanilir. En son care olarak sadece
 * deplasman adi eslesmesi de denenir (ev/deplasman kaynaklar arasinda yer
 * degistirmis olabilir ihtimaline karsi).
 */
function findMatchingEvent(events, homeTeam, awayTeam, kickoffIso) {
  const kickoffMs = kickoffIso ? new Date(kickoffIso).getTime() : null;

  const bothMatch = events.filter(function (e) {
    return isNameMatch(getHomeTeamName(e), homeTeam) && isNameMatch(getAwayTeamName(e), awayTeam) && isWithinKickoffTolerance(e, kickoffMs);
  });
  if (bothMatch.length) return bothMatch[0];

  const homeOnlyMatch = events.filter(function (e) {
    return isNameMatch(getHomeTeamName(e), homeTeam) && isWithinKickoffTolerance(e, kickoffMs);
  });
  if (homeOnlyMatch.length === 1) return homeOnlyMatch[0];
  if (homeOnlyMatch.length > 1) {
    const narrowed = homeOnlyMatch.filter(function (e) { return isNameMatch(getAwayTeamName(e), awayTeam); });
    return narrowed[0] || homeOnlyMatch[0];
  }

  const awayOnlyMatch = events.filter(function (e) {
    return isNameMatch(getAwayTeamName(e), awayTeam) && isWithinKickoffTolerance(e, kickoffMs);
  });
  if (awayOnlyMatch.length === 1) return awayOnlyMatch[0];

  // Some providers reverse home/away or append FC/AFC suffixes in cup replays.
  // Only accept a reversed match when BOTH names match and kickoff is close.
  const reversed=events.filter(function(e){
    return isNameMatch(getHomeTeamName(e),awayTeam)&&isNameMatch(getAwayTeamName(e),homeTeam)&&isWithinKickoffTolerance(e,kickoffMs);
  });
  if(reversed.length===1)return reversed[0];
  return null;
}

/**
 * TheSportsDB'deki bir macin (takim adlari + kickoff), BSD'deki karsiligi
 * olan event_id'sini bulur. Once canli liste denenir, orada yoksa (mac
 * henuz baslamamis/BSD'ye gec dusmus ya da zaten bitmis olabilir) gunun
 * tum maclari listesinden (ev sahibi adina gore BSD tarafinda daraltilmis)
 * aranir. Sonuc (bulunsa da bulunmasa da) cache'lenir - basarisiz aramayi
 * her istekte tekrarlamamak icin.
 */
async function resolveBsdEventId(homeTeam, awayTeam, kickoffIso) {
  if (!API_KEY) return null;
  const mapped=await fixtureIdentity.lookup({date:kickoffIso,home:homeTeam,away:awayTeam,provider:'bsd'}).catch(()=>null);
  if(mapped?.id)return mapped.id;

  const dateKey = (kickoffIso || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const cacheKey = `bsd-resolve:${normalizeTeamName(homeTeam)}:${normalizeTeamName(awayTeam)}:${dateKey}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let eventId = null;

  const liveResult = await getLiveFootballEvents();
  if (liveResult.ok) {
    const match = findMatchingEvent(extractList(liveResult.data), homeTeam, awayTeam, kickoffIso);
    if (match) eventId = getEventId(match);
  }

  if (!eventId) {
    const dayResult = await getFootballEventsForDate(dateKey, homeTeam);
    if (dayResult.ok) {
      const match = findMatchingEvent(extractList(dayResult.data), homeTeam, awayTeam, kickoffIso);
      if (match) eventId = getEventId(match);
    }
  }
  // team_name can be stricter than our canonical-name matcher. If the
  // provider-side filter misses an alias (e.g. "Leamington FC"), inspect the
  // complete day feed and match locally instead.
  if (!eventId) {
    const allDay=await getFootballEventsForDate(dateKey);
    if(allDay.ok){
      const match=findMatchingEvent(extractList(allDay.data),homeTeam,awayTeam,kickoffIso);
      if(match)eventId=getEventId(match);
    }
  }

  // Bulunduysa uzun sure (mac kimligi degismez), bulunamadiysa kisa sure
  // (BSD listesine birazdan dusebilir, tekrar denenebilsin) cache'leniyor.
  cache.set(cacheKey, eventId, eventId ? 60 * 60 * 6 : 5 * 60);
  if(eventId){
    let providerHome='',providerAway='';
    const day=await getFootballEventsForDate(dateKey).catch(()=>({ok:false}));
    if(day.ok){const e=extractList(day.data).find(x=>String(getEventId(x))===String(eventId));if(e){providerHome=getHomeTeamName(e)||'';providerAway=getAwayTeamName(e)||''}}
    fixtureIdentity.remember({date:kickoffIso,home:homeTeam,away:awayTeam,provider:'bsd',id:eventId,providerHome,providerAway,confidence:providerHome&&providerAway?1:.85}).catch(()=>{});
  }
  return eventId;
}

/**
 * Bir BSD event'inin takim bazli gercek/tahmini xG'sini doner.
 * Dogrulanmis sekil: stats.home.xg.actual, stats.away.xg.actual.
 * "Estimated mi" karari icin once yanitin kok seviyesindeki xg_estimated'a
 * bakiliyor, o alan yoksa stats.home/away.xg.estimated degerlerinin
 * herhangi biri true ise tahmini sayiliyor. Beklenen xG alanlari
 * bulunamazsa { available: false } donuyor.
 */
async function getEventXg(bsdEventId) {
  const statsResult = await fetchBsdCached('/events/' + bsdEventId + '/stats/', 60, 8000);
  if (!statsResult.ok) return { available: false };

  const homeXg = pickField(statsResult.data, ['stats.home.xg.actual']);
  const awayXg = pickField(statsResult.data, ['stats.away.xg.actual']);
  if (homeXg === null || awayXg === null) return { available: false };

  const rootEstimated = pickField(statsResult.data, ['xg_estimated']);
  let estimated;
  if (rootEstimated !== null) {
    estimated = !!rootEstimated;
  } else {
    const homeEstimated = pickField(statsResult.data, ['stats.home.xg.estimated']);
    const awayEstimated = pickField(statsResult.data, ['stats.away.xg.estimated']);
    estimated = !!(homeEstimated || awayEstimated);
  }

  return {
    available: true,
    home: parseFloat(homeXg),
    away: parseFloat(awayXg),
    estimated,
  };
}

/**
 * Ust seviye fonksiyon - live.js bunu cagirir. TheSportsDB'de gercek xG
 * yoksa, ikinci bir gercek kaynak olarak bunu dener. API key tanimli
 * degilse ya da BSD'de bu mac/xG bulunamazsa sessizce { available: false }
 * doner - cagiran taraf mevcut istatistiksel tahmine duser.
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} kickoffIso
 * @param {boolean} isFinished
 */
async function getRealXgForMatch(homeTeam, awayTeam, kickoffIso, isFinished) {
  if (!API_KEY) return { available: false };

  const bsdEventId = await resolveBsdEventId(homeTeam, awayTeam, kickoffIso);
  if (!bsdEventId) return { available: false };

  const cacheKey = `bsd-xg:${bsdEventId}`;
  const ttl = isFinished ? 60 * 60 * 6 : 60;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const xg = await getEventXg(bsdEventId);
  cache.set(cacheKey, xg, ttl);
  return xg;
}


function toScoreNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseScorePair(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v) && v.length >= 2) {
    const h=toScoreNumber(v[0]), a=toScoreNumber(v[1]);
    return h !== null && a !== null ? {home:h,away:a} : null;
  }
  if (typeof v === 'string') {
    const m=v.match(/(\d+)\s*[-:]\s*(\d+)/);
    return m ? {home:Number(m[1]),away:Number(m[2])} : null;
  }
  if (typeof v === 'object') {
    const h=toScoreNumber(v.home ?? v.home_score ?? v.homeScore ?? v.h);
    const a=toScoreNumber(v.away ?? v.away_score ?? v.awayScore ?? v.a);
    return h !== null && a !== null ? {home:h,away:a} : null;
  }
  return null;
}

function extractHalftimeScore(e) {
  // BSD schemas seen across event feeds can expose HT as separate fields,
  // a nested score object, a "1-0" string, or period arrays.
  const directHome = pickField(e, ['halftime_home_score','half_time_home_score','ht_home_score','score.halftime.home','scores.halftime.home','scores.ht.home']);
  const directAway = pickField(e, ['halftime_away_score','half_time_away_score','ht_away_score','score.halftime.away','scores.halftime.away','scores.ht.away']);
  const dh=toScoreNumber(directHome), da=toScoreNumber(directAway);
  if (dh !== null && da !== null) return {home:dh,away:da};

  const pairCandidates=[
    pickField(e,['halftime_score']),
    pickField(e,['half_time_score']),
    pickField(e,['ht_score']),
    pickField(e,['score.halftime']),
    pickField(e,['scores.halftime']),
    pickField(e,['scores.ht'])
  ];
  for (const v of pairCandidates) { const p=parseScorePair(v); if(p) return p; }

  const periods=pickField(e,['periods','scores.periods','score.periods']);
  if (Array.isArray(periods)) {
    const first=periods.find(p=>String(p.period ?? p.name ?? p.type ?? '').toLowerCase().match(/^(1|1h|first|first_half|1st)$/)) || periods[0];
    const p=parseScorePair(first && (first.score ?? first));
    if(p) return p;
  }
  return null;
}
async function getHalftimeScoreForMatch(homeTeam, awayTeam, kickoffIso) {
  if (!API_KEY) return { available:false };
  const cacheKey='bsd-ht:'+normalizeTeamName(homeTeam)+':'+normalizeTeamName(awayTeam)+':'+String(kickoffIso||'').slice(0,10);
  const cached=cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let match=null;
  const live=await getLiveFootballEvents();
  if (live.ok) match=findMatchingEvent(extractList(live.data),homeTeam,awayTeam,kickoffIso);

  if (!match) {
    const dateKey=(kickoffIso||'').slice(0,10)||new Date().toISOString().slice(0,10);
    const day=await getFootballEventsForDate(dateKey,homeTeam);
    if (day.ok) match=findMatchingEvent(extractList(day.data),homeTeam,awayTeam,kickoffIso);
  }
  const ht=match ? extractHalftimeScore(match) : null;
  const result=ht ? {available:true,home:ht.home,away:ht.away,source:'bsd'} : {available:false};
  cache.set(cacheKey,result,ht ? 60*60*6 : 60);
  return result;
}


function eventStatusText(e) {
  const candidates=[
    pickField(e,['status_short']),pickField(e,['state.short_name']),pickField(e,['state.name']),
    pickField(e,['status.short_name']),pickField(e,['status.name']),pickField(e,['status']),pickField(e,['state'])
  ];
  for(const v of candidates){
    if(v==null)continue;
    if(typeof v==='object'){
      const nested=v.short_name||v.name||v.status||v.state;
      if(nested)return String(nested);
      continue;
    }
    if(String(v).trim())return String(v);
  }
  return '';
}

function eventToResultMatch(e) {
  const homeScore=toScoreNumber(pickField(e,['home_score','home_score_display','score.home','score.current.home','scores.fulltime.home','scores.current.home']));
  const awayScore=toScoreNumber(pickField(e,['away_score','away_score_display','score.away','score.current.away','scores.fulltime.away','scores.current.away']));
  const ht=extractHalftimeScore(e);
  const rawStatus=eventStatusText(e).toLowerCase();
  const finished=/finished|finish|ended|completed|complete|full.?time|\bft\b|after extra time|penalties/.test(rawStatus);
  const live=/live|in.?play|1st|2nd|\b[12]h\b|half.?time|ht/.test(rawStatus) && !finished;
  return {
    fixtureId:String(getEventId(e)||''),
    bsdEventId:String(getEventId(e)||''),
    date:getKickoff(e),
    homeTeam:getHomeTeamName(e)||'',
    awayTeam:getAwayTeamName(e)||'',
    homeScore, awayScore,
    halftimeHome:ht?.home??null, halftimeAway:ht?.away??null,
    league:String(e.__soccerEdgeLeagueName||pickField(e,['league.name','league_name','competition.name','competition_name','competition.title','competition_title','competition','league.title','league','tournament.name','tournament_name'])||''),
    leagueId:String(pickField(e,['league.id','league_id','competition.id','competition_id'])||''),
    statusShort:finished?'FT':(live?(eventStatusText(e)||'LIVE').toUpperCase():'NS'),
    minute:(()=>{const v=pickField(e,['minute','elapsed','time.elapsed','timer.minute','clock.minute','match_minute','time','timer','clock','status_detail','status_text']);const n=Number(String(v??'').replace(/[^0-9.]/g,''));return Number.isFinite(n)&&n>0?n:null;})(),
    isLive:live,
    source:'bsd'
  };
}

async function bsdCompetitionName(e, registry){
  const id=String(pickField(e,['league.id','league_id','competition.id','competition_id'])||'');
  const canonical=registry?.[id]?.name;
  if(canonical)return canonical;
  const explicit=String(pickField(e,['league.name','league_name','competition.name','competition_name','competition.title','competition_title','league.title','tournament.name','tournament_name'])||'').trim();
  return /^(league|competition|unknown|other)$/i.test(explicit)?'':explicit;
}

async function getResultMatchesForDate(dateStr) {
  if(!API_KEY)return {ok:false,error:'no_api_key',matches:[]};
  // BSD v2 is canonical outside the six SportMonks leagues. Pull both the
  // date feed and the explicit finished slice: some cup/replay rows can fall
  // out of the mixed-status day feed while still being present as finished.
  const base='/events/?date_from='+dateStr+'&date_to='+dateStr;
  const [day,finished,leagueRegistry]=await Promise.all([
    fetchBsdAll(base,5*60,10000),
    fetchBsdAll(base+'&status=finished',5*60,10000),
    getLeagueRegistry()
  ]);
  if(!day.ok && !finished.ok)return {ok:false,error:day.error||finished.error,matches:[]};
  const registry=leagueRegistry.ok?leagueRegistry.map:{};
  const rows=[...(day.ok?extractList(day.data):[]),...(finished.ok?extractList(finished.data):[])];
  const seen=new Set(), matches=[];
  for(const e of rows){
    const id=String(getEventId(e)||'');
    const key=id||[normalizeTeamName(getHomeTeamName(e)),normalizeTeamName(getAwayTeamName(e)),String(getKickoff(e)||'').slice(0,10)].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    const leagueId=String(pickField(e,['league.id','league_id','competition.id','competition_id'])||'');
    const league=await bsdCompetitionName(e,registry);
    if(!league)continue; // never manufacture League/Competition XX labels
    const m=eventToResultMatch({...e,__soccerEdgeLeagueName:league,__soccerEdgeLeagueId:leagueId});
    m.league=league; m.leagueId=leagueId;
    m.leagueCountry=String(registry?.[leagueId]?.country||'');
    m.homeTeamId=String(pickField(e,['home_team_id','home.id','home_team.id'])||'');
    m.awayTeamId=String(pickField(e,['away_team_id','away.id','away_team.id'])||'');
    m.stage=String(pickField(e,['stage'])||'');
    m.stageName=String(pickField(e,['stage_name'])||'');
    m.roundLabel=String(pickField(e,['round_label'])||'');
    m.providerIds={bsd:id};
    if(m.homeTeam&&m.awayTeam)matches.push(m);
  }
  return {ok:true,source:'bsd',matches,registryAvailable:leagueRegistry.ok};
}

// Settlement must not discard a final score just because the BSD league
// registry has no entry for the competition (notably cup fixtures).
async function getRawFinalMatchesForDate(dateStr){
  if(!API_KEY)return {ok:false,error:'no_api_key',matches:[]};
  const base='/events/?date_from='+dateStr+'&date_to='+dateStr;
  const [day,finished]=await Promise.all([
    fetchBsdAll(base,60,10000),
    fetchBsdAll(base+'&status=finished',60,10000)
  ]);
  if(!day.ok&&!finished.ok)return {ok:false,error:day.error||finished.error,matches:[]};
  const rows=[...(finished.ok?extractList(finished.data):[]),...(day.ok?extractList(day.data):[])];
  const matches=[],seen=new Set();
  for(const e of rows){
    const m=eventToResultMatch(e);
    if(!m.homeTeam||!m.awayTeam||m.homeScore==null||m.awayScore==null||m.statusShort!=='FT')continue;
    const key=m.bsdEventId||[m.homeTeam,m.awayTeam,m.date].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    matches.push({...m,isFinished:true,providerIds:{bsd:m.bsdEventId}});
  }
  return {ok:true,matches};
}

function eventToAnalysisFixture(e) {
  const homeId = pickField(e, ['home_team_id','home.id','home_team.id']);
  const awayId = pickField(e, ['away_team_id','away.id','away_team.id']);
  const homeScore = toScoreNumber(pickField(e, ['home_score','home_score_display','score.home','score.current.home','scores.fulltime.home','scores.current.home']));
  const awayScore = toScoreNumber(pickField(e, ['away_score','away_score_display','score.away','score.current.away','scores.fulltime.away','scores.current.away']));
  const ht = extractHalftimeScore(e);
  return {
    fixture: { id:getEventId(e), date:getKickoff(e) },
    teams: {
      home:{ id:homeId, name:getHomeTeamName(e) },
      away:{ id:awayId, name:getAwayTeamName(e) }
    },
    goals:{ home:homeScore, away:awayScore },
    score:{ halftime:ht ? {home:ht.home,away:ht.away} : {home:null,away:null} }
  };
}

async function getTeamFixturesForAnalysis(teamName, count) {
  if (!API_KEY || !teamName) return {ok:false,error:!API_KEY?'no_api_key':'missing_team'};
  const n=Math.max(5,Math.min(30,Number(count)||15));
  // A generous window avoids relying on BSD-specific team ids. The API's
  // fuzzy team_name filter keeps the response bounded.
  const to=new Date();
  const from=new Date(to.getTime()-370*24*60*60*1000);
  const date=v=>v.toISOString().slice(0,10);
  const result=await fetchBsdCached('/events/?team_name='+encodeURIComponent(teamName)+'&status=finished&date_from='+date(from)+'&date_to='+date(to)+'&limit='+Math.max(30,n*2),15*60,8000);
  if(!result.ok) return result;
  const events=extractList(result.data)
    .filter(e=>isNameMatch(getHomeTeamName(e),teamName)||isNameMatch(getAwayTeamName(e),teamName))
    .filter(e=>toScoreNumber(pickField(e,['home_score','home_score_display','score.home','score.current.home','scores.fulltime.home','scores.current.home']))!==null && toScoreNumber(pickField(e,['away_score','away_score_display','score.away','score.current.away','scores.fulltime.away','scores.current.away']))!==null)
    .sort((a,b)=>new Date(getKickoff(a)||0)-new Date(getKickoff(b)||0))
    .slice(-n);
  return {ok:true,source:'bsd',teamName,data:{response:events.map(eventToAnalysisFixture)}};
}

async function getPredictionForMatch(homeTeam,awayTeam,kickoffIso) {
  if(!API_KEY) return {available:false,error:'no_api_key'};
  const eventId=await resolveBsdEventId(homeTeam,awayTeam,kickoffIso);
  if(!eventId) return {available:false,error:'event_not_found'};
  const result=await fetchBsdCached('/events/'+eventId+'/prediction/',15*60,6000);
  if(!result.ok) return {available:false,error:result.error};
  const p=result.data||{};
  return {available:true,eventId,source:'bsd',markets:p.markets||null,recommendations:p.recommendations||null,model:p.model||null};
}

async function getConsensusOddsForMatch(homeTeam,awayTeam,kickoffIso) {
  if(!API_KEY) return {available:false,error:'no_api_key'};
  const eventId=await resolveBsdEventId(homeTeam,awayTeam,kickoffIso);
  if(!eventId) return {available:false,error:'event_not_found'};
  const result=await fetchBsdCached('/events/'+eventId+'/odds/',2*60,6000);
  if(!result.ok) return {available:false,error:result.error};
  return {available:true,eventId,source:'bsd-consensus',data:result.data};
}

async function getStatsForMatch(homeTeam,awayTeam,kickoffIso) {
  if(!API_KEY) return {available:false,error:'no_api_key'};
  const eventId=await resolveBsdEventId(homeTeam,awayTeam,kickoffIso);
  if(!eventId) return {available:false,error:'event_not_found'};
  const result=await fetchBsdCached('/events/'+eventId+'/stats/',5*60,6000);
  if(!result.ok) return {available:false,error:result.error};
  return {available:true,eventId,source:'bsd',data:result.data};
}


function normalizeConsensusOdds(payload) {
  const root=payload?.odds || payload?.data?.odds || payload || {};
  const n=v=>{const x=Number(v);return Number.isFinite(x)&&x>1?x:null;};
  const updatedAt=payload?.last_update_at || payload?.updated_at || payload?.data?.last_update_at || null;
  const ageMs=updatedAt ? Date.now()-new Date(updatedAt).getTime() : null;
  // BSD publishes its own refresh schedule. We preserve freshness rather than
  // pretending consensus is a live bookmaker quote.
  const fresh=Number.isFinite(ageMs)&&ageMs>=0&&ageMs<=6*60*60*1000;
  return {
    source:'bsd-consensus',
    executable:false,
    consensus:true,
    updatedAt,
    ageSeconds:Number.isFinite(ageMs)?Math.round(ageMs/1000):null,
    fresh,
    h2h:{home:n(root.home_win),draw:n(root.draw),away:n(root.away_win)},
    totals:{
      over15:n(root.over_15_goals),under15:n(root.under_15_goals),
      over25:n(root.over_25_goals),under25:n(root.under_25_goals),
      over35:n(root.over_35_goals),under35:n(root.under_35_goals)
    },
    btts:{yes:n(root.btts_yes),no:n(root.btts_no)}
  };
}

async function getFixtureDataBundle(homeTeam,awayTeam,kickoffIso) {
  if(!API_KEY) return {available:false,error:'no_api_key'};
  const eventId=await resolveBsdEventId(homeTeam,awayTeam,kickoffIso);
  if(!eventId) return {available:false,error:'event_not_found'};
  const bundleKey='bsd-bundle:'+eventId;
  const bundleHit=cache.get(bundleKey);
  if(bundleHit !== undefined) return {...bundleHit,cached:true};
  const [stats,lineups,h2h,prediction,odds]=await Promise.all([
    fetchBsdCached('/events/'+eventId+'/stats/',5*60,5000),
    fetchBsdCached('/events/'+eventId+'/lineups/',10*60,5000),
    fetchBsdCached('/events/'+eventId+'/h2h/',6*60*60,5000),
    fetchBsdCached('/events/'+eventId+'/prediction/',15*60,5000),
    fetchBsdCached('/events/'+eventId+'/odds/',2*60,5000)
  ]);
  const bundle={
    available:true,eventId,source:'bsd',
    stats:stats.ok?stats.data:null,
    lineups:lineups.ok?lineups.data:null,
    h2h:h2h.ok?h2h.data:null,
    prediction:prediction.ok?prediction.data:null,
    consensusOdds:odds.ok?normalizeConsensusOdds(odds.data):null,
    coverage:{stats:stats.ok,lineups:lineups.ok,h2h:h2h.ok,prediction:prediction.ok,odds:odds.ok}
  };
  // Bundle TTL follows odds (shortest pre-match component). Individual
  // endpoints retain their longer caches, so a refresh usually costs only
  // the field whose freshness window actually expired.
  cache.set(bundleKey,bundle,2*60);
  return bundle;
}


// Fill HT scores from the BSD event-detail endpoint when the day feed omits
// them. The detail response is cached by getEventById, so repeated scoreboard
// refreshes do not fan out indefinitely.
async function attachHalftimeScores(matches){
  const CONCURRENCY=4;
  const candidates=(matches||[]).filter(m=>
    (m.statusShort==='FT'||m.statusShort==='HT'||(m.isLive&&Number(m.minute)>=45)) &&
    (m.halftimeHome==null||m.halftimeAway==null) && (m.bsdEventId||m.fixtureId)
  );
  for(let i=0;i<candidates.length;i+=CONCURRENCY){
    await Promise.all(candidates.slice(i,i+CONCURRENCY).map(async m=>{
      const detail=await getEventById(String(m.bsdEventId||m.fixtureId)).catch(()=>({available:false}));
      const ht=detail?.available?detail.match:null;
      if(m.statusShort==='HT'&&m.homeScore!=null&&m.awayScore!=null){m.halftimeHome=Number(m.homeScore);m.halftimeAway=Number(m.awayScore);m.halftimeSource='bsd-live-ht-state';}
      else if(ht?.halftimeHome!=null&&ht?.halftimeAway!=null){m.halftimeHome=ht.halftimeHome;m.halftimeAway=ht.halftimeAway;m.halftimeSource='bsd-event-detail';}
    }));
  }
  return matches;
}

async function getFinalResultByEventId(eventId){
 if(!API_KEY||!eventId)return {available:false,error:'missing_event_id'};
 const result=await fetchBsdCached('/events/'+eventId+'/',60,6000);
 if(!result.ok)return {available:false,error:result.error};
 const e=result.data?.data||result.data?.event||result.data;
 const home=toScoreNumber(pickField(e,['home_score','home_score_display','score.home','score.current.home','scores.fulltime.home','scores.current.home']));
 const away=toScoreNumber(pickField(e,['away_score','away_score_display','score.away','score.current.away','scores.fulltime.away','scores.current.away']));
  const rawStatus=eventStatusText(e).toLowerCase();
 const finished=/finished|finish|ended|completed|complete|full.?time|\bft\b|after extra time|penalties/.test(rawStatus);
 if(!finished||home===null||away===null)return {available:false,error:'not_final',status:rawStatus};
 const ht=extractHalftimeScore(e);
 return {available:true,source:'bsd',eventId:String(eventId),homeScore:home,awayScore:away,halftimeHome:ht?.home??null,halftimeAway:ht?.away??null,status:'FT'};
}

async function getEventById(eventId){
 if(!API_KEY||!eventId)return {available:false,error:'missing_event_id'};
 const result=await fetchBsdCached('/events/'+eventId+'/',60,6000);
 if(!result.ok)return {available:false,error:result.error};
 const e=result.data?.data||result.data?.event||result.data;
 const match=eventToResultMatch(e);
 if(!match.fixtureId||!match.homeTeam||!match.awayTeam||!match.date)return {available:false,error:'invalid_event_payload'};
 return {available:true,source:'bsd',match:{...match,kickoff:match.date,canonicalProvider:'bsd',providerIds:{bsd:String(match.bsdEventId||eventId)}}};
}

async function getFinalResultForMatch(homeTeam,awayTeam,kickoffIso){
  if(!API_KEY)return {available:false,error:'no_api_key'};
  const dateKey=(kickoffIso||'').slice(0,10)||new Date().toISOString().slice(0,10);
  const day=await getFootballEventsForDate(dateKey,homeTeam);
  let event=day.ok?findMatchingEvent(extractList(day.data),homeTeam,awayTeam,kickoffIso):null;
  // Critical settlement fallback: provider team_name filtering can miss cup
  // aliases. Search the complete day result feed locally before giving up.
  if(!event){
    const allDay=await getFootballEventsForDate(dateKey);
    if(allDay.ok)event=findMatchingEvent(extractList(allDay.data),homeTeam,awayTeam,kickoffIso);
    else if(!day.ok)return {available:false,error:day.error||allDay.error};
  }
  if(!event)return {available:false,error:'event_not_found'};
  const home=toScoreNumber(pickField(event,['home_score','home_score_display','score.home','score.current.home','scores.fulltime.home','scores.current.home']));
  const away=toScoreNumber(pickField(event,['away_score','away_score_display','score.away','score.current.away','scores.fulltime.away','scores.current.away']));
  const rawStatus=eventStatusText(event).toLowerCase();
  const finished=/finished|finish|ended|completed|complete|full.?time|\bft\b|after extra time|penalties/.test(rawStatus);
  if(!finished||home===null||away===null)return {available:false,error:'not_final',status:rawStatus};
  const ht=extractHalftimeScore(event);
  return {available:true,source:'bsd',eventId:getEventId(event),homeScore:home,awayScore:away,halftimeHome:ht?.home??null,halftimeAway:ht?.away??null,status:'FT'};
}


async function diagnostic(dateStr) {
  const safe = async (name, fn) => {
    try {
      const r = await fn();
      const list = r && r.data ? extractList(r.data) : [];
      return { name, ok: !!r?.ok, error: r?.error || null, count: list.length,
        sample: list.slice(0,2).map(e=>({id:getEventId(e),home:getHomeTeamName(e),away:getAwayTeamName(e),kickoff:getKickoff(e),status:pickField(e,['status','state','status_short','state.name']),homeScore:pickField(e,['home_score','home_score_display','score.home','score.current.home','scores.fulltime.home','scores.current.home']),awayScore:pickField(e,['away_score','away_score_display','score.away','score.current.away','scores.fulltime.away','scores.current.away'])})) };
    } catch (e) { return {name,ok:false,error:e.message,count:0,sample:[]}; }
  };
  const base='/events/?date_from='+dateStr+'&date_to='+dateStr+'&limit=200';
  const tests=[];
  tests.push(await safe('events-day',()=>fetchBsdCached(base,1,8000)));
  tests.push(await safe('fa-cup-finished',()=>fetchBsdCached(base+'&league_id=39&status=finished',1,8000)));
  tests.push(await safe('live',()=>fetchBsdCached('/events/live/',1,8000)));
  const fa=await getResultMatchesForDate(dateStr);
  return {apiBase:BASE_URL,hasKey:!!API_KEY,date:dateStr,tests,resultSummary:{ok:fa.ok,error:fa.error||null,count:fa.matches?.length||0,faCupExplicit:!!fa.faCupExplicit,faCup:fa.matches?.filter(m=>/fa cup/i.test(m.league||'')).slice(0,20)||[]}};
}

module.exports = { fetchBsdAll, getLeagueRegistry, getLiveFootballEvents, extractList, eventStatusText, eventToResultMatch, getRealXgForMatch, resolveBsdEventId, getEventXg, getHalftimeScoreForMatch, getTeamFixturesForAnalysis, getPredictionForMatch, getConsensusOddsForMatch, getStatsForMatch, getFixtureDataBundle, normalizeConsensusOdds, getEventById, getFinalResultForMatch, getFinalResultByEventId, attachHalftimeScores, getResultMatchesForDate, getRawFinalMatchesForDate, diagnostic };
