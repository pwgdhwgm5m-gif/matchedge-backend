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
 * - GET /events/live/ ve GET /events/?date_from=...&date_to=...&team_name=...
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

function extractList(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  return data.results || data.events || data.data || [];
}

async function getLiveFootballEvents() {
  return fetchBsd('/events/live/', 8000);
}

async function getFootballEventsForDate(dateStr, teamName) {
  let path = '/events/?date_from=' + dateStr + '&date_to=' + dateStr;
  if (teamName) path += '&team_name=' + encodeURIComponent(teamName);
  return fetchBsd(path, 8000);
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

function getHomeTeamName(e) {
  return pickField(e, ['home_team', 'home.name', 'home_name', 'home']);
}
function getAwayTeamName(e) {
  return pickField(e, ['away_team', 'away.name', 'away_name', 'away']);
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

  // Bulunduysa uzun sure (mac kimligi degismez), bulunamadiysa kisa sure
  // (BSD listesine birazdan dusebilir, tekrar denenebilsin) cache'leniyor.
  cache.set(cacheKey, eventId, eventId ? 60 * 60 * 6 : 5 * 60);
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
  const statsResult = await fetchBsd('/events/' + bsdEventId + '/stats/', 8000);
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

module.exports = { getRealXgForMatch, resolveBsdEventId, getEventXg };
