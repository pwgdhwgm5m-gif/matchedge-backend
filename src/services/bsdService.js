/**
 * bsdService.js
 * MatchEdge — Bzzoiro Sports Data (BSD, sports.bzzoiro.com) entegrasyonu.
 *
 * NEDEN: TheSportsDB gercek xG'yi SADECE kendi Pro/Premium eslestirmesinin
 * kapsadigi buyuk liglerde saglıyor (bkz. sportsDbService.js). BSD ikinci
 * bir "gercek xG" kaynagi olarak eklendi - kapsadigi liglerde (kendi sut
 * verisinden geldigi icin TheSportsDB'den farkli bir lig seti olabilir)
 * asıl olcumu, kapsamadigi durumlarda ise kendi tahminini donuyor. BSD
 * cevabindaki "estimated"/"xg_estimated" bayragi bu ikisini ayirt ediyor -
 * biz SADECE bu bayrak false ise "gercek xG" olarak kullaniyoruz.
 *
 * ONEMLI KISIT: BSD kendi event ID sistemini kullaniyor, TheSportsDB'nin
 * fixtureId'siyle hicbir iliskisi yok. Bu yuzden once takim adi + mac
 * saatine gore BSD'deki karsilik gelen event'i "resolve" ediyoruz (asagida
 * resolveBsdEventId), sonra o ID ile xG verisini cekiyoruz. Bu eslestirme
 * takim adi yazim farkliliklarina (orn. "Man United" vs "Manchester United")
 * karsi gevsek (icerme bazli) yapiliyor, ayrica yanlis mac eslesmesini
 * onlemek icin kickoff saati de (3 saat tolerans) kontrol ediliyor.
 *
 * BSD'nin API dokumantasyonu tarayicida JS ile render edildigi icin bu
 * sandbox'tan otomatik okunamadi - endpoint yollari ve alan adlari,
 * kullanicinin docs sayfasindan elle paylastigi ekran goruntuleri/ornek
 * JSON'lara dayaniyor. GET /api/v2/events/{id}/stats/ icin alinan gercek
 * bir ornek yanitla (event_id, kok seviye xg_estimated, stats.home/away.xg
 * .actual/.estimated, shotmap, momentum, average_positions, xg_per_minute
 * alanlarinin hepsi TEK yanitta) asagidaki stats.home.xg.actual /
 * stats.home.xg.estimated yolu DOGRULANDI - bu yuzden eskiden yedek olarak
 * denenen, dogrulanamamis "kok seviyede home_xg_live/away_xg_live" cagrisi
 * kaldirildi (gercek ornekte boyle alanlar yoktu, hem gereksiz bir istek
 * daha atiliyordu). "Estimated mi" karari icin once kok seviye
 * xg_estimated'a bakiliyor (docs: "the one field to read"), o yoksa
 * stats.home/away.xg.estimated'a dusuluyor. Yine de beklenmedik bir sekilde
 * karsilasilirsa (BSD tarafinda API degisirse) her adim savunmaci: alan
 * bulunamazsa sessizce { available: false } doner, hicbir sey kirilmaz -
 * sadece o mac icin "gercek BSD xG'si" gorunmez, mevcut tahmini xG'ye
 * (liveXgService) dusulur.
 */

const { normalizeTeamName } = require('../utils/textNormalize');
const cache = require('../utils/cache');

const BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const API_KEY = process.env.BSD_API_KEY || '';

// GECICI TESHIS LOGLARI: BSD entegrasyonu hicbir macta devreye girmiyordu
// (hep "estimate"e dusuyordu) ama sessizce basarisiz oldugu icin sebebi
// gorunmuyordu. Bu loglar Render'in log ekraninda "[BSD]" ile aranarak
// bulunabilir - sorun cozulunce kaldirilacak.
console.log('[BSD] servis yuklendi, API_KEY tanimli mi:', !!API_KEY, API_KEY ? `(uzunluk: ${API_KEY.length})` : '');

async function fetchBsd(path, timeoutMs) {
  if (!API_KEY) {
    console.log('[BSD] fetchBsd cagrildi ama API_KEY yok, path:', path);
    return { ok: false, error: 'no_api_key' };
  }

  const ms = timeoutMs || 8000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  try {
    const res = await fetch(BASE_URL + path, {
      signal: controller.signal,
      headers: { 'Authorization': 'Token ' + API_KEY },
    });
    if (!res.ok) {
      let bodyText = '';
      try { bodyText = await res.text(); } catch (readErr) { bodyText = '(govde okunamadi: ' + readErr.message + ')'; }
      console.log('[BSD] http hata, path:', path, 'status:', res.status, 'govde:', bodyText.slice(0, 500));
      return { ok: false, error: 'http_' + res.status };
    }
    const json = await res.json();
    console.log('[BSD] basarili yanit, path:', path, 'anahtar sayisi:', Object.keys(json || {}).length);
    return { ok: true, data: json };
  } catch (err) {
    console.log('[BSD] istek hatasi, path:', path, 'hata:', err.message);
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

// DUZELTME: BSD'nin gercek /events/live/ ve /events/ endpoint'lerinde "sport"
// diye bir parametre yok (BSD zaten sadece futbol API'si - Render loglarindaki
// 400 govdesi bunu dogruladi: accepted_parameters = league_id/limit/offset/
// season_id/team_id (live) ve date_from/date_to/league_id/limit/offset/round/
// season_id/stage/status/team_id/team_name (gunluk liste). Tarih filtresi
// "date" degil "date_from"/"date_to" olarak isteniyor. "team_name" parametresi
// sayesinde gunun tum listesini cekip elle filtrelemek yerine dogrudan takim
// adina gore daraltilmis sonuc istenebiliyor - bu hem daha guvenilir (sayfalama
// yuzunden macimizin listede kaybolmasi ihtimalini azaltiyor) hem daha az veri
// cekiyor.
async function getLiveFootballEvents() {
  return fetchBsd('/events/live/', 8000);
}

async function getFootballEventsForDate(dateStr, teamName) {
  let path = '/events/?date_from=' + dateStr + '&date_to=' + dateStr;
  if (teamName) path += '&team_name=' + encodeURIComponent(teamName);
  return fetchBsd(path, 8000);
}

// BSD'nin ham event nesnesinde takim adi/kickoff alani hangi isimle
// geliyor tam bilinmedigi icin (docs'ta bu kisim goruntulenemedi), en
// olasi birkac aday alan adi sirayla deneniyor.
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
 * DUZELTME: Deplasman takiminin adi kaynaklar arasinda cok farkli olabiliyor
 * (gercek ornek: TheSportsDB "Racing de Santander" derken BSD ayni kulubu
 * "Real Racing Club" olarak adlandiriyor - ortak hicbir kelime yok, substring
 * eslesmesi hicbir zaman tutmaz). Bu yuzden asama asama gevseyen bir arama
 * yapiliyor: once iki takim adi da eslesirse (en guvenilir) onu kullan;
 * tutmazsa SADECE ev sahibi adina ve kickoff yakinligina guven - ayni gun
 * ayni ev sahibinin iki farkli resmi macinin olmasi son derece nadir. Birden
 * fazla aday cikarsa deplasman adiyla daraltmaya calisilir, o da tutmazsa
 * ilk aday (en yakin kickoff'lu olan zaten one gelir) kullanilir. En son
 * çare olarak sadece deplasman adi eslesmesi de denenir (ev/deplasman
 * kaynaklar arasinda yer degistirmis olabilir ihtimaline karsi).
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
 * tum maclari listesinden aranir. Sonuc (bulunsa da bulunmasa da) cache'lenir
 * - basarisiz aramayi her istekte tekrarlamamak icin.
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
    const liveList = extractList(liveResult.data);
    console.log('[BSD] canli liste alindi, mac sayisi:', liveList.length, 'aranan:', homeTeam, 'vs', awayTeam);
    const match = findMatchingEvent(liveList, homeTeam, awayTeam, kickoffIso);
    if (match) eventId = getEventId(match);
    else if (liveList.length) console.log('[BSD] canli listede ornek 1. eleman:', JSON.stringify(liveList[0]).slice(0, 300));
  } else {
    console.log('[BSD] canli liste cekilemedi:', liveResult.error);
  }

  if (!eventId) {
    const dayResult = await getFootballEventsForDate(dateKey, homeTeam);
    if (dayResult.ok) {
      const dayList = extractList(dayResult.data);
      console.log('[BSD] gunun listesi alindi, mac sayisi:', dayList.length, 'aranan:', homeTeam, 'vs', awayTeam);
      const match = findMatchingEvent(dayList, homeTeam, awayTeam, kickoffIso);
      if (match) eventId = getEventId(match);
      else if (dayList.length) console.log('[BSD] gunun listesinde ornek 1. eleman:', JSON.stringify(dayList[0]).slice(0, 300));
    } else {
      console.log('[BSD] gunun listesi cekilemedi:', dayResult.error);
    }
  }

  console.log('[BSD] resolve sonucu:', homeTeam, 'vs', awayTeam, '->', eventId);

  // Bulunduysa uzun sure (mac kimligi degismez), bulunamadiysa kisa sure
  // (BSD listesine birazdan dusebilir, tekrar denenebilsin) cache'leniyor.
  cache.set(cacheKey, eventId, eventId ? 60 * 60 * 6 : 5 * 60);
  return eventId;
}

/**
 * Bir BSD event'inin takim bazli gercek/tahmini xG'sini doner.
 * Dogrulanmis sekil (GET /events/{id}/stats/ - gercek ornek yanitla
 * teyit edildi): stats.home.xg.actual, stats.away.xg.actual. "Estimated"
 * karari icin once yanitin kok seviyesindeki xg_estimated'a bakiliyor
 * (docs: bu, verinin BSD'nin kendi tahmini mi yoksa gercek olcum mu
 * oldugunu gosteren asil alan), o alan yoksa stats.home/away.xg.estimated
 * degerlerinin herhangi biri true ise tahmini sayiliyor. Beklenen xG
 * alanlari bulunamazsa { available: false } donuyor.
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
