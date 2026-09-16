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
 * JSON'lara dayaniyor (odds endpoint'i icin dogrulanmis ornek: GET
 * /api/v2/events/{id}/odds/, Authorization: Token <key>). Shotmap/stats
 * endpoint'lerinin TAM yolu bu sekilde dogrulanamadi, REST kalibina
 * (/events/{id}/<alt-kaynak>/) gore var sayildi. Bu yuzden her adim
 * savunmaci yazildi: beklenen alan/endpoint bulunamazsa sessizce
 * { available: false } doner, hicbir sey kirilmaz - sadece o mac icin
 * "gercek BSD xG'si" gorunmez, mevcut tahmini xG'ye (liveXgService)
 * dusulur.
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
  return fetchBsd('/events/live/?sport=football', 8000);
}

async function getFootballEventsForDate(dateStr) {
  return fetchBsd('/events/?sport=football&date=' + dateStr, 8000);
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

function findMatchingEvent(events, homeTeam, awayTeam, kickoffIso) {
  const kickoffMs = kickoffIso ? new Date(kickoffIso).getTime() : null;

  return events.find(function (e) {
    const namesMatch = isNameMatch(getHomeTeamName(e), homeTeam) && isNameMatch(getAwayTeamName(e), awayTeam);
    if (!namesMatch) return false;
    if (!kickoffMs) return true;

    const evKickoff = getKickoff(e);
    if (!evKickoff) return true;

    const diffMs = Math.abs(new Date(evKickoff).getTime() - kickoffMs);
    return diffMs < 3 * 60 * 60 * 1000; // 3 saat tolerans - farkli gunlerdeki rovans maclarini karistirmamak icin
  }) || null;
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
    const match = findMatchingEvent(extractList(liveResult.data), homeTeam, awayTeam, kickoffIso);
    if (match) eventId = getEventId(match);
  }

  if (!eventId) {
    const dayResult = await getFootballEventsForDate(dateKey);
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
 * Beklenen sekil (docs ekran goruntulerinden): stats.home.xg.actual,
 * stats.home.xg.estimated (ve away esdegeri). Bu sekil tutmazsa event
 * kokundeki home_xg_live/away_xg_live + xg_estimated alanlarina, o da
 * yoksa { available: false }'a dusuluyor.
 */
async function getEventXg(bsdEventId) {
  const statsResult = await fetchBsd('/events/' + bsdEventId + '/stats/', 8000);
  if (statsResult.ok) {
    const homeXg = pickField(statsResult.data, ['stats.home.xg.actual']);
    const awayXg = pickField(statsResult.data, ['stats.away.xg.actual']);
    if (homeXg !== null && awayXg !== null) {
      const homeEstimated = pickField(statsResult.data, ['stats.home.xg.estimated']);
      const awayEstimated = pickField(statsResult.data, ['stats.away.xg.estimated']);
      return {
        available: true,
        home: parseFloat(homeXg),
        away: parseFloat(awayXg),
        estimated: !!(homeEstimated || awayEstimated),
      };
    }
  }

  const rootResult = await fetchBsd('/events/' + bsdEventId + '/', 8000);
  if (rootResult.ok) {
    const homeXg = pickField(rootResult.data, ['home_xg_live']);
    const awayXg = pickField(rootResult.data, ['away_xg_live']);
    if (homeXg !== null && awayXg !== null) {
      const rootEstimated = pickField(rootResult.data, ['xg_estimated']);
      return {
        available: true,
        home: parseFloat(homeXg),
        away: parseFloat(awayXg),
        estimated: !!rootEstimated,
      };
    }
  }

  return { available: false };
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
