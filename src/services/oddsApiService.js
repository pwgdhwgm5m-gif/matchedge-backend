const config = require('../config/config');
const { fetchT } = require('../utils/fetchWithTimeout');
const cache = require('../utils/cache');
const { teamNamesMatch, normalizeTeamName } = require('../utils/textNormalize');

let oddsCircuitOpenUntil=0;
function oddsEnabled(){return Boolean(config.oddsApi.key)&&Date.now()>=oddsCircuitOpenUntil}
function markOddsFailure(result){const status=result?.status||result?.error?.status||result?.error?.response?.status;const err=String(result?.error||'');if(status===401||status===403||status===429||/http_(401|403|429)/.test(err)){oddsCircuitOpenUntil=Date.now()+(status===429||/429/.test(err)?6*60*60*1000:24*60*60*1000);console.warn('[odds-api] circuit breaker aktif; gereksiz istekler gecici olarak durduruldu.')}}
/** Belirli bir lig icin coklu bookmaker oranlari */
async function getOddsForLeague(sportKey = 'soccer_epl') {
  if(!oddsEnabled()) return {ok:false,error:'odds_api_disabled_or_circuit_open'};
  const result=await fetchT(
    {
      method: 'GET',
      url: `${config.oddsApi.baseUrl}/sports/${sportKey}/odds`,
      params: {
        apiKey: config.oddsApi.key,
        regions: 'eu',
        markets: 'h2h,totals',
        oddsFormat: 'decimal',
      },
    },
    6000,
    'The Odds API'
  );
  if(!result.ok) markOddsFailure(result);
  return result;
}

/**
 * Bir ligin bugun/yakinda maci var mi diye ucretsiz (kota harcamayan)
 * events endpoint'i ile kontrol eder. The Odds API dokumantasyonuna gore
 * /events endpoint'i kota tuketmiyor - sadece /odds tuketiyor.
 * Bu sayede 35 ligin hepsini degil, sadece gercekten mac gunu olanlari
 * gercek (kotali) oran istegiyle tariyoruz.
 */
async function getEventsForLeague(sportKey) {
  if (!oddsEnabled()) return { ok: false, error: 'odds_api_disabled_or_circuit_open' };
  const result=await fetchT(
    {
      method: 'GET',
      url: `${config.oddsApi.baseUrl}/sports/${sportKey}/events`,
      params: { apiKey: config.oddsApi.key },
    },
    5000,
    `The Odds API Events (${sportKey})`
  );
  if(!result.ok) markOddsFailure(result);
  return result;
}

async function getEventExtendedOdds(sportKey,eventId){
 if(!oddsEnabled()||!sportKey||!eventId)return {ok:false,error:'extended_odds_unavailable'};
 const cacheKey=`extendedOdds:${sportKey}:${eventId}`;
 const hit=cache.get(cacheKey);if(hit)return {ok:true,data:hit,cached:true};
 const result=await fetchT({method:'GET',url:`${config.oddsApi.baseUrl}/sports/${sportKey}/events/${eventId}/odds`,params:{
  apiKey:config.oddsApi.key,regions:'eu',markets:'btts,team_totals,alternate_team_totals,h2h_3_way_h1,totals_h1,team_totals_h1',oddsFormat:'decimal'
 }},6000,'The Odds API Extended');
 if(!result.ok){markOddsFailure(result);return result;}
 cache.set(cacheKey,result.data,5*60);
 return result;
}

async function getFixtureEventsByDate(dateStr) {
  if (!oddsEnabled()) return { ok:false,error:'odds_api_disabled_or_circuit_open',matches:[] };
  const keys=config.trackedLeagues||[]; const matches=[];
  // Fallback only: sequential and stop immediately when the provider rate-limits/auth-fails.
  for (const sportKey of keys) {
    if(!oddsEnabled()) break;
    const result=await getEventsForLeague(sportKey);
    if(!result.ok) { if(!oddsEnabled()) break; continue; }
    if(!Array.isArray(result.data)) continue;
    for(const event of result.data) if(String(event.commence_time||'').slice(0,10)===dateStr) matches.push({
      fixtureId:`odds:${event.id}`,league:sportKey,leagueId:sportKey,kickoff:event.commence_time||null,statusShort:'NS',minute:null,isLive:false,
      homeId:null,awayId:null,homeTeam:event.home_team||'',awayTeam:event.away_team||'',homeBadge:null,awayBadge:null,homeScore:0,awayScore:0,
      halftimeHome:null,halftimeAway:null,source:'the-odds-api-events'
    });
  }
  const seen=new Set();
  return {ok:true,matches:matches.filter(match=>{const key=[match.kickoff,normalizeTeamName(match.homeTeam),normalizeTeamName(match.awayTeam)].join('|');if(seen.has(key))return false;seen.add(key);return true;})};
}
async function hasMatchesToday(sportKey, windowHours = 30) {
  const result = await getEventsForLeague(sportKey);

  if (!result.ok || !Array.isArray(result.data)) return false;

  const now = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;

  return result.data.some(event => {
    const kickoff = new Date(event.commence_time).getTime();
    return kickoff - now < windowMs && kickoff - now > -3 * 60 * 60 * 1000; // gecmis 3 saat - ileri windowHours
  });
}

/**
 * Oran hareketi grafigi icin zaman ici anlik goruntu kaydeder.
 * Once ucretsiz events endpoint'i ile o ligde gercekten mac olup
 * olmadigi kontrol edilir - mac yoksa kotali /odds istegi hic yapilmaz.
 * The Odds API'nin ucretsiz plani gecmis oran vermiyor, bu yuzden
 * kendimiz periyodik olarak (cron ile) bu fonksiyonu cagirip
 * cache'e biriktiriyoruz. Sunucu yeniden baslarsa gecmis silinir -
 * kalici saklamak icin ileride bir DB'ye tasinmali.
 */
async function recordOddsSnapshot(sportKey) {
  const hasMatches = await hasMatchesToday(sportKey);
  if (!hasMatches) {
    console.log(`[odds-snapshot] ${sportKey} - bugun mac yok, atlaniyor (kota korunuyor)`);
    return;
  }

  const result = await getOddsForLeague(sportKey);
  if (!result.ok) return;

  const historyKey = `oddsHistory:${sportKey}`;
  const existing = cache.get(historyKey) || [];

  const snapshot = {
    timestamp: new Date().toISOString(),
    matches: (result.data || []).map(m => ({
      id: m.id,
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      // ilk bookmaker'in h2h oranini ornek olarak aliyoruz
      odds: m.bookmakers?.[0]?.markets?.find(mk => mk.key === 'h2h')?.outcomes || [],
    })),
  };

  existing.push(snapshot);
  // son 48 kayit tutulur (30 dk araliklarla yaklasik 24 saat)
  const trimmed = existing.slice(-48);
  cache.set(historyKey, trimmed, 60 * 60 * 30); // 30 saat TTL
}

/** Bir lig icin biriken oran gecmisini dondurur */
function getOddsHistory(sportKey) {
  return cache.get(`oddsHistory:${sportKey}`) || [];
}

/**
 * Kelly Criterion stake hesaplama
 * @param {number} modelProbability - modelin verdigi olasilik (0-1 arasi)
 * @param {number} decimalOdds - bahis sirketinin ondalik orani
 * @param {number} bankrollFraction - maksimum ne kadarlik dilim riske girsin (varsayilan tam Kelly'nin %25'i - guvenli)
 */
function calculateKellyStake(modelProbability, decimalOdds, bankrollFraction = 0.25) {
  const b = decimalOdds - 1; // net kazanc orani
  const q = 1 - modelProbability;
  const fullKelly = (b * modelProbability - q) / b;
  const safeKelly = Math.max(0, fullKelly * bankrollFraction);
  return {
    fullKellyPercent: +(fullKelly * 100).toFixed(2),
    recommendedStakePercent: +(safeKelly * 100).toFixed(2),
    hasValue: fullKelly > 0,
  };
}

/** Modelin tahmini ile piyasa orani arasindaki value farkini bulur */
function findValueBets(modelProbabilities, marketOdds) {
  // modelProbabilities: { home: 0.6, draw: 0.23, away: 0.17 }
  // marketOdds: { home: 1.75, draw: 3.8, away: 5.2 }
  const results = {};
  for (const outcome of Object.keys(modelProbabilities)) {
    const impliedProb = 1 / marketOdds[outcome];
    const edge = modelProbabilities[outcome] - impliedProb;
    results[outcome] = {
      modelProbability: modelProbabilities[outcome],
      impliedProbability: +impliedProb.toFixed(3),
      edge: +edge.toFixed(3),
      isValueBet: edge > 0.03, // %3 uzeri fark anlamli value kabul edilir
      kelly: calculateKellyStake(modelProbabilities[outcome], marketOdds[outcome]),
    };
  }
  return results;
}

/** Bir ligin oran yanitindan belirli bir mac icin 1X2 oranini bulur */
function extractMatchOdds(oddsResponse, homeTeamName, awayTeamName) {
  if (!Array.isArray(oddsResponse)) return null;

  // Exact-match yerine normalize edilmis karsilastirma kullaniyoruz -
  // Isvec/Norvec/Finlandiya/Isvicre gibi ulkelerde aksanli/aksansiz
  // yazim farklari yuzunden exact-match veri kacirabiliyordu.
  const match = oddsResponse.find(m =>
    teamNamesMatch(m.home_team, homeTeamName) && teamNamesMatch(m.away_team, awayTeamName)
  );
  if (!match || !match.bookmakers?.length) return null;

  const h2hMarket = match.bookmakers[0].markets?.find(mk => mk.key === 'h2h');
  if (!h2hMarket) return null;

  // Oran satirlarini da normalize edilmis isimle bulmamiz gerekiyor,
  // cunku bu satirlardaki isim de API-Football'dan gelen isimle
  // birebir ayni olmayabilir.
  const findOdd = (targetName) =>
    h2hMarket.outcomes.find(o => teamNamesMatch(o.name, targetName))?.price;

  const odds = {
    home: findOdd(homeTeamName),
    draw: h2hMarket.outcomes.find(o => normalizeTeamName(o.name) === 'draw')?.price,
    away: findOdd(awayTeamName),
  };

  if (!odds.home || !odds.draw || !odds.away) return null;
  return odds;
}


function extractMatchMarketOdds(oddsResponse,homeTeamName,awayTeamName){
 if(!Array.isArray(oddsResponse))return null;
 const match=oddsResponse.find(m=>teamNamesMatch(m.home_team,homeTeamName)&&teamNamesMatch(m.away_team,awayTeamName));if(!match||!match.bookmakers?.length)return null;
 const books=[];
 for(const b of match.bookmakers){const h2h=b.markets?.find(x=>x.key==='h2h'),tot=b.markets?.find(x=>x.key==='totals');
  const h2hOdds=h2h?{home:h2h.outcomes.find(o=>teamNamesMatch(o.name,homeTeamName))?.price,draw:h2h.outcomes.find(o=>normalizeTeamName(o.name)==='draw')?.price,away:h2h.outcomes.find(o=>teamNamesMatch(o.name,awayTeamName))?.price}:null;
  const line25=(tot?.outcomes||[]).filter(o=>Number(o.point)===2.5),totals=line25.length?{over25:line25.find(o=>/^over$/i.test(o.name))?.price,under25:line25.find(o=>/^under$/i.test(o.name))?.price}:null;
  const updatedAt=b.last_update||h2h?.last_update||tot?.last_update||null;
  const ageMs=updatedAt?Date.now()-new Date(updatedAt).getTime():null;
  const fresh=Number.isFinite(ageMs)&&ageMs>=0&&ageMs<=15*60*1000;
  books.push({bookmaker:b.title||b.key,h2h:h2hOdds,totals,updatedAt,ageSeconds:Number.isFinite(ageMs)?Math.round(ageMs/1000):null,fresh});
 }
 const best=(path)=>{const vals=books.map(b=>({bookmaker:b.bookmaker,price:path(b)})).filter(x=>Number(x.price)>1);return vals.sort((a,b)=>b.price-a.price)[0]||null};
 return{bookmakers:books.length,best:{home:best(b=>b.h2h?.home),draw:best(b=>b.h2h?.draw),away:best(b=>b.h2h?.away),over25:best(b=>b.totals?.over25),under25:best(b=>b.totals?.under25)},btts:null};
}

function extractExtendedMarketOdds(event,homeTeamName,awayTeamName){
 if(!event?.bookmakers?.length)return null;
 const books=[];
 for(const b of event.bookmakers){
  const market=k=>b.markets?.find(x=>x.key===k);
  const pair=(m,yes='Yes',no='No')=>m?{yes:m.outcomes?.find(o=>String(o.name).toLowerCase()===yes.toLowerCase())?.price,no:m.outcomes?.find(o=>String(o.name).toLowerCase()===no.toLowerCase())?.price}:null;
  const btts=pair(market('btts'));
  const h1=market('h2h_3_way_h1');
  const firstHalf=h1?{home:h1.outcomes?.find(o=>teamNamesMatch(o.name,homeTeamName))?.price,draw:h1.outcomes?.find(o=>normalizeTeamName(o.name)==='draw')?.price,away:h1.outcomes?.find(o=>teamNamesMatch(o.name,awayTeamName))?.price}:null;
  const t1=market('totals_h1'),line05=(t1?.outcomes||[]).filter(o=>Number(o.point)===0.5);
  const firstHalfTotal05=line05.length?{over:line05.find(o=>/^over$/i.test(o.name))?.price,under:line05.find(o=>/^under$/i.test(o.name))?.price}:null;
  // Full-time team totals: prefer alternate_team_totals because it can expose
  // 1.5/2.5/3.5 simultaneously; merge featured team_totals when available.
  const fullTeamLines={home:{},away:{}};
  for(const tm of [market('alternate_team_totals'),market('team_totals')].filter(Boolean)){
   for(const o of tm.outcomes||[]){
    const point=Number(o.point);if(![1.5,2.5,3.5].includes(point))continue;
    const desc=String(o.description||'');const side=teamNamesMatch(desc,homeTeamName)?'home':teamNamesMatch(desc,awayTeamName)?'away':null;if(!side)continue;
    const line=String(point);fullTeamLines[side][line]||(fullTeamLines[side][line]={});
    if(/^over$/i.test(o.name))fullTeamLines[side][line].over=o.price;
    if(/^under$/i.test(o.name))fullTeamLines[side][line].under=o.price;
   }
  }
  const tt=market('team_totals_h1');
  const team05={};
  for(const o of tt?.outcomes||[]){if(Number(o.point)!==0.5)continue;const desc=String(o.description||'');const side=teamNamesMatch(desc,homeTeamName)?'home':teamNamesMatch(desc,awayTeamName)?'away':null;if(side)team05[side]||(team05[side]={});if(/^over$/i.test(o.name))team05[side].over=o.price;if(/^under$/i.test(o.name))team05[side].under=o.price;}
  const times=[b.last_update,...(b.markets||[]).map(x=>x.last_update)].filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);
  const latest=times.length?Math.max(...times):null,ageMs=latest?Date.now()-latest:null,fresh=Number.isFinite(ageMs)&&ageMs>=0&&ageMs<=15*60*1000;
  books.push({bookmaker:b.title||b.key,fresh,updatedAt:latest?new Date(latest).toISOString():null,btts,teamTotals:fullTeamLines,firstHalf,firstHalfTotal05,firstHalfTeam05:team05});
 }
 return {bookmakers:books};
}

/**
 * Ondalik oranlari, bookmaker marjini (overround) cikarilmis gercek
 * olasiliklara cevirir. Oranlarin ham 1/oran toplami her zaman %100'u
 * gecer (bu fark bookmaker'in kar marjidir) - normalize ederek
 * gercek "piyasanin dusundugu" olasiligi elde ediyoruz.
 */
function normalizeImpliedProbabilities(decimalOdds) {
  if (!decimalOdds) return null;

  const impliedHome = 1 / decimalOdds.home;
  const impliedDraw = 1 / decimalOdds.draw;
  const impliedAway = 1 / decimalOdds.away;
  const overround = impliedHome + impliedDraw + impliedAway;

  return {
    home: +((impliedHome / overround) * 100).toFixed(1),
    draw: +((impliedDraw / overround) * 100).toFixed(1),
    away: +((impliedAway / overround) * 100).toFixed(1),
    overroundPercent: +((overround - 1) * 100).toFixed(1),
    method: 'normalized-overround',
  };
}

/**
 * Model tahminini piyasa (bookmaker) olasiligiyla harmanlar. Piyasa
 * oranlari halkin ve profesyonellerin toplu bilgisini zaten icerdigi
 * icin, tek basina herhangi bir modelden genelde daha iyi kalibre
 * olur - kendi modelimizle harmanlamak genelde ikisinden de iyi sonuc verir.
 * @param {object} modelProbs - calculateMatchProbabilities(...) ciktisi
 * @param {object} marketProbs - normalizeImpliedProbabilities(...) ciktisi
 * @param {number} modelWeight - 0-1 arasi, modelin agirligi (varsayilan %50)
 */
function blendWithMarket(modelProbs, marketProbs, modelWeight = 0.5) {
  if (!marketProbs) {
    return { ...modelProbs, blended: false };
  }

  const marketWeight = 1 - modelWeight;
  const blendedHome = modelProbs.homeWinProbability * modelWeight + marketProbs.home * marketWeight;
  const blendedDraw = modelProbs.drawProbability * modelWeight + marketProbs.draw * marketWeight;
  const blendedAway = modelProbs.awayWinProbability * modelWeight + marketProbs.away * marketWeight;
  const total = blendedHome + blendedDraw + blendedAway || 1;

  return {
    homeWinProbability: +((blendedHome / total) * 100).toFixed(1),
    drawProbability: +((blendedDraw / total) * 100).toFixed(1),
    awayWinProbability: +((blendedAway / total) * 100).toFixed(1),
    blended: true,
    modelWeight,
    marketWeight,
  };
}


function shinImpliedProbabilities(decimalOdds){
 if(!decimalOdds)return null;
 const q=[1/Number(decimalOdds.home),1/Number(decimalOdds.draw),1/Number(decimalOdds.away)];
 if(q.some(x=>!Number.isFinite(x)||x<=0))return null;
 const sum=q.reduce((a,b)=>a+b,0); if(sum<=1)return normalizeImpliedProbabilities(decimalOdds);
 let lo=0,hi=.99;
 const probs=z=>q.map(x=>(Math.sqrt(z*z+4*(1-z)*(x*x/sum))-z)/(2*(1-z)));
 const total=z=>probs(z).reduce((a,b)=>a+b,0);
 const fLo=total(lo)-1,fHi=total(hi)-1;
 // A valid Shin solution must bracket 1. If unusual/malformed odds do not,
 // fail safely to proportional de-vig instead of returning a forced root.
 if(!Number.isFinite(fLo)||!Number.isFinite(fHi)||fLo*fHi>0)return normalizeImpliedProbabilities(decimalOdds);
 for(let i=0;i<80;i++){const z=(lo+hi)/2,s=total(z);if(!Number.isFinite(s))return normalizeImpliedProbabilities(decimalOdds);if(s>1)lo=z;else hi=z;}
 const z=(lo+hi)/2,p=probs(z),s=p.reduce((a,b)=>a+b,0);
 if(!Number.isFinite(s)||Math.abs(s-1)>.001)return normalizeImpliedProbabilities(decimalOdds);
 return {home:+(100*p[0]/s).toFixed(1),draw:+(100*p[1]/s).toFixed(1),away:+(100*p[2]/s).toFixed(1),overroundPercent:+((sum-1)*100).toFixed(1),shinZ:+z.toFixed(4),method:'shin'};
}
function marketDivergence(model,market){
 if(!model||!market)return null;
 const d={home:+(Number(model.homeWinProbability)-Number(market.home)).toFixed(1),draw:+(Number(model.drawProbability)-Number(market.draw)).toFixed(1),away:+(Number(model.awayWinProbability)-Number(market.away)).toFixed(1)};
 const entries=Object.entries(d).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
 return {...d,largestOutcome:entries[0][0],largestGap:entries[0][1],material:Math.abs(entries[0][1])>=7};
}

module.exports = {
  getOddsForLeague,
  getEventExtendedOdds,
  getEventsForLeague,
  getFixtureEventsByDate,
  hasMatchesToday,
  recordOddsSnapshot,
  getOddsHistory,
  calculateKellyStake,
  findValueBets,
  extractMatchOdds,
  extractMatchMarketOdds,
  extractExtendedMarketOdds,
  normalizeImpliedProbabilities,
  shinImpliedProbabilities,
  marketDivergence,
  blendWithMarket,
};
