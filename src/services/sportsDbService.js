/**
 * sportsDbService.js
 * MatchEdge — TheSportsDB (Premium) veri kaynağı.
 * free-api-live-football-data aylık kotasını doldurdugu icin
 * /api/matches ve diger liglerin form verisi bu kaynaga tasindi.
 */

const { normalizeTeamName } = require('../utils/textNormalize');
const cache = require('../utils/cache');

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json';
const V2_BASE_URL = 'https://www.thesportsdb.com/api/v2/json';
const API_KEY = process.env.SPORTSDB_API_KEY || '123';

// TheSportsDB'nin gercekten kullandigi durum kodlari (V2 canli skor ornek
// verisinden dogrulandi). "Match Finished" gibi baska API'lerden (orn.
// API-Football) kalma, TheSportsDB'de hic gorunmeyen degerler de guvenlik
// icin listede tutuluyor.
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'FT_PEN', 'Match Finished', 'AWARDED', 'WO', 'ABD', 'CANC', 'POSTP']);
const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE']);

// free-api-live-football-data (FotMob) semasindaki leagueId -> TheSportsDB idLeague.
const LEAGUE_ID_MAP = {
  '47': 4328,   // Premier League
  '87': 4335,   // La Liga
  '55': 4332,   // Serie A
  '54': 4331,   // Bundesliga
  '53': 4334,   // Ligue 1
  '57': 4337,   // Eredivisie
  '135': 4336,  // Yunanistan Super League
  '59': 4358,   // Norvec Eliteserien
  '67': 4347,   // Isvec Allsvenskan
  '196': 4422,  // Polonya Ekstraklasa
  '63': 4355,   // Rusya Premier Lig
  '61': 4344,   // Portekiz Liga Portugal
  '51': 4636,   // Finlandiya Veikkausliiga
  '40': 4338,   // Belcika First Division A
  '46': 4340,   // Danimarka Superligaen
  '64': 4330,   // Iskocya Premiership
};

/**
 * Sadece buyuk liglerin/kupalarin gosterilmesi icin TheSportsDB idLeague
 * beyaz listesi. Eskiden /api/matches, /api/results, /api/live gunun TUM
 * maclarini (kucuk alt ligler, amator kupa turlari, bilinmeyen bolgesel
 * ligler dahil - bazi gunler 90+ mac) donduruyordu, bu da uygulamayi
 * kullanilamaz derecede karisik hale getiriyordu. Artik bu liste disinda
 * kalan hicbir mac API yanitlarinda gorunmuyor.
 */
const WHITELISTED_LEAGUE_IDS = new Set([
  // --- Avrupa 1. Ligleri ---
  '4328', // Ingiltere Premier League
  '4335', // Ispanya La Liga
  '4332', // Italya Serie A
  '4331', // Almanya Bundesliga
  '4334', // Fransa Ligue 1
  '4337', // Hollanda Eredivisie
  '4344', // Portekiz Primeira Liga
  '4330', // Iskocya Premiership
  '4336', // Yunanistan Super League
  '4355', // Rusya Premier League
  '4422', // Polonya Ekstraklasa
  '4338', // Belcika First Division A
  '4340', // Danimarka Superligaen
  '4358', // Norvec Eliteserien
  '4347', // Isvec Allsvenskan
  '4636', // Finlandiya Veikkausliiga
  '4339', // Turkiye Super Lig
  '4621', // Avusturya Bundesliga
  '4675', // Isvicre Super League
  // --- Amerika 1. Ligleri ---
  '4346', // ABD MLS
  '4350', // Meksika Liga MX
  '4351', // Brezilya Serie A
  '4406', // Arjantin Primera Division
  // --- Asya 1. Ligleri ---
  '4633', // Japonya J1 League
  '4689', // Guney Kore K League 1
  // --- Buyuk Kupalar / Turnuvalar ---
  '4480', // UEFA Sampiyonlar Ligi
  '4481', // UEFA Avrupa Ligi
  '4482', // Ingiltere FA Cup
  '4483', // Ispanya Copa del Rey
  '4484', // Fransa Coupe de France
  '4485', // Almanya DFB-Pokal
  '4506', // Italya Coppa Italia
  '4501', // Copa Libertadores
  '4490', // UEFA Uluslar Ligi
  '5071', // UEFA Konferans Ligi
  '4503', // FIFA Kulupler Dunya Kupasi
]);

function isWhitelistedLeague(leagueId) {
  return WHITELISTED_LEAGUE_IDS.has(String(leagueId));
}

async function fetchT(url, timeoutMs) {
  const ms = timeoutMs || 10000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
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

/**
 * Belirli bir gunun tum futbol maclarini ceker.
 * @param {string} dateStr - 'YYYY-MM-DD'
 */
async function getMatchesByDate(dateStr) {
  const url = BASE_URL + '/' + API_KEY + '/eventsday.php?d=' + dateStr + '&s=Soccer';
  return fetchT(url, 10000);
}

/**
 * TheSportsDB'nin ham event nesnesini, eski freeFootballApiService ile
 * ayni sekle cevirir - route/frontend hicbir sey degistirmeden calisir.
 *
 * ONEMLI DUZELTME: Eskiden "bitti mi" kontrolu sadece strStatus alanina
 * bakiyordu (== 'FT'). eventsday.php gecmis tarihli maclarda bu alani
 * her zaman guvenilir doldurmuyor (bos/farkli deger donebiliyor) - bu
 * yuzden dun oynanmis, sonuclanmis bir mac hala "CANLI" gorunebiliyordu.
 * Simdi tarih de kontrol ediliyor: mac tarihi bugunden onceyse, statusShort
 * ne olursa olsun kesin olarak "bitti" kabul ediliyor. "Canli" ise artik
 * SADECE gercekten bilinen canli periyot kodlarindan biriyse (1H/HT/2H/ET
 * vb.) true donuyor - eskiden "NS degilse ve skor varsa canli say" gibi
 * cok gevsek bir kural vardi, bu yanlis pozitiflere yol aciyordu.
 */
/**
 * TheSportsDB zaman damgalari ("strTimestamp", dateEvent+strTime) UTC
 * olarak geliyor ama sonunda 'Z' YOK. Bu haliyle frontend'e gonderilince
 * tarayici bunu YEREL saat saniyor (JS spesifikasyonu geregi 'Z'siz
 * tarih-saat string'leri local olarak parse edilir) ve hicbir donusum
 * yapmadan oldugu gibi gosteriyor - Turkiye (UTC+3) icin gercek saatten
 * 3 saat erken gorunmesine yol aciyordu (orn. gercek 22:30 yerine 19:30).
 * 'Z' eklenince tarayici doğru sekilde UTC'den yerel saate ceviriyor.
 */
function toUtcIso(raw) {
  if (!raw) return null;
  return /Z$/i.test(raw) ? raw : raw + 'Z';
}

function transformEvent(e) {
  const status = String(e.strStatus || '').trim();
  const eventDateStr = String(e.dateEvent || (e.strTimestamp || '').slice(0, 10) || '');
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDate = eventDateStr && eventDateStr < todayStr;

  const finished = FINISHED_STATUSES.has(status) || isPastDate;
  const isLive = !finished && LIVE_STATUSES.has(status.toUpperCase());

  return {
    fixtureId: e.idEvent,
    league: e.strLeague || '',
    leagueId: e.idLeague,
    kickoff: toUtcIso(e.strTimestamp || (e.dateEvent + 'T' + (e.strTime || '00:00:00'))),
    statusShort: finished ? 'FT' : (status || 'NS'),
    minute: e.strProgress ? parseInt(e.strProgress, 10) : null,
    isLive: isLive,
    homeTeam: e.strHomeTeam || '',
    awayTeam: e.strAwayTeam || '',
    homeBadge: e.strHomeTeamBadge || null,
    awayBadge: e.strAwayTeamBadge || null,
    homeScore: e.intHomeScore !== null && e.intHomeScore !== undefined ? parseInt(e.intHomeScore, 10) : 0,
    awayScore: e.intAwayScore !== null && e.intAwayScore !== undefined ? parseInt(e.intAwayScore, 10) : 0,
    halftimeHome: null,
    halftimeAway: null,
  };
}

/**
 * V2 API icin header-tabanli istek (X-API-KEY). V1'den farkli olarak key
 * URL'de degil header'da gonderiliyor.
 */
async function fetchV2(path, timeoutMs) {
  const ms = timeoutMs || 8000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  try {
    const res = await fetch(V2_BASE_URL + path, {
      signal: controller.signal,
      headers: { 'X-API-KEY': API_KEY },
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

/**
 * TheSportsDB'nin GERCEK canli skor endpoint'i (V2, sadece premium).
 * eventsday.php'nin aksine gercek dakika (strProgress) ve gercek periyot
 * kodu (1H/HT/2H) doner - bu yuzden "kacinci dakikada" bilgisi ancak
 * buradan gelebiliyor.
 */
async function getLiveScores() {
  return fetchV2('/livescore/soccer', 8000);
}

/** V2 canli skor event'ini frontend'in bekledigi sekle cevirir */
function transformLiveEvent(e) {
  const status = String(e.strStatus || '').trim().toUpperCase();
  return {
    fixtureId: e.idEvent,
    league: e.strLeague || '',
    leagueId: e.idLeague,
    kickoff: e.dateEvent && e.strEventTime ? toUtcIso(e.dateEvent + 'T' + e.strEventTime) : null,
    statusShort: status || 'LIVE',
    minute: e.strProgress ? parseInt(e.strProgress, 10) : null,
    isLive: true,
    homeTeam: e.strHomeTeam || '',
    awayTeam: e.strAwayTeam || '',
    homeBadge: e.strHomeTeamBadge || null,
    awayBadge: e.strAwayTeamBadge || null,
    homeScore: e.intHomeScore !== null && e.intHomeScore !== undefined ? parseInt(e.intHomeScore, 10) : 0,
    awayScore: e.intAwayScore !== null && e.intAwayScore !== undefined ? parseInt(e.intAwayScore, 10) : 0,
    halftimeHome: null,
    halftimeAway: null,
  };
}

/**
 * Bir ligin gecmis maclarini ceker (premium key ile yuksek limit).
 * @param {number} tsdbLeagueId - TheSportsDB idLeague
 */
async function getLeaguePastEvents(tsdbLeagueId) {
  const url = BASE_URL + '/' + API_KEY + '/eventspastleague.php?id=' + tsdbLeagueId;
  return fetchT(url, 10000);
}

/** Ham TheSportsDB event nesnesini analysisEngine'in bekledigi sekle cevirir */
function toAnalysisFixture(e) {
  return {
    fixture: { id: e.idEvent, date: e.strTimestamp || e.dateEvent },
    teams: {
      home: { id: e.idHomeTeam, name: e.strHomeTeam },
      away: { id: e.idAwayTeam, name: e.strAwayTeam },
    },
    goals: {
      home: e.intHomeScore !== null && e.intHomeScore !== undefined ? parseInt(e.intHomeScore, 10) : null,
      away: e.intAwayScore !== null && e.intAwayScore !== undefined ? parseInt(e.intAwayScore, 10) : null,
    },
    score: { halftime: { home: null, away: null } },
  };
}

/**
 * Takim adindan TheSportsDB takim ID'sini bulur (searchteams.php).
 * ID'ler degismedigi icin 30 gun cache'leniyor - premium kotasini
 * (20 istek/dk) bosa harcamamak icin onemli.
 */
async function resolveTeamId(teamName) {
  const cacheKey = `tsdb-teamid:${normalizeTeamName(teamName)}`;
  const result = await cache.getOrFetch(cacheKey, 60 * 60 * 24 * 30, async () => {
    const url = BASE_URL + '/' + API_KEY + '/searchteams.php?t=' + encodeURIComponent(teamName);
    const res = await fetchT(url, 8000);
    if (!res.ok) return { ok: false };
    const teams = (res.data && res.data.teams) || [];
    if (!teams.length) return { ok: false };
    const normalized = normalizeTeamName(teamName);
    const exact = teams.find(function (t) { return normalizeTeamName(t.strTeam) === normalized; });
    return { ok: true, idTeam: (exact || teams[0]).idTeam };
  });
  return result.ok ? result.idTeam : null;
}

/**
 * Bir takimin son maclarini TAKIMA OZEL endpoint'ten ceker (premium: son
 * 10 mac, hem ev hem deplasman dahil). eventspastleague.php'nin aksine
 * (asagida, fallback olarak kalan eski yontem) bu, ligin dar bir "son
 * birkac mac" penceresine sikismiyor - o pencerede o takimin maci
 * olmasa bile (orn. lig lideri Barcelona gibi, arada UEFA/kupa maclari
 * araya girince ligdeki son maci pencerenin disinda kalabiliyordu)
 * dogru sonuc doner.
 */
async function getTeamLastEvents(teamId) {
  const url = BASE_URL + '/' + API_KEY + '/eventslast.php?id=' + teamId;
  return fetchT(url, 8000);
}

/**
 * analysisEngine.js'in beklendigi {ok, data:{response:[...]}, teamId} formatinda
 * bir takimin son N macini doner. Once takima ozel eventslast.php denenir
 * (daha guvenilir); o basarisiz/bos donerse eski yontem (ligin son
 * olaylarindan isimle filtreleme) fallback olarak calisir.
 * @param {string} teamName
 * @param {number|string} fotmobLeagueId
 */
async function getTeamFixturesForAnalysis(teamName, fotmobLeagueId, count) {
  const n = count || 15;

  const teamId = await resolveTeamId(teamName);
  if (teamId) {
    const lastResult = await getTeamLastEvents(teamId);
    if (lastResult.ok) {
      const rawEvents = (lastResult.data && (lastResult.data.results || lastResult.data.events)) || [];
      const finishedEvents = rawEvents.filter(function (e) {
        return e.strStatus === 'FT' || e.intHomeScore !== null && e.intHomeScore !== undefined;
      });
      if (finishedEvents.length > 0) {
        const lastEvents = finishedEvents.slice(-n);
        return {
          ok: true,
          data: { response: lastEvents.map(toAnalysisFixture) },
          teamId: teamId,
        };
      }
    }
  }

  // --- Fallback: eski yontem (ligin son olaylari icinden isimle filtrele) ---
  const tsdbLeagueId = LEAGUE_ID_MAP[String(fotmobLeagueId)];
  if (!tsdbLeagueId) {
    return { ok: false, error: 'league_not_mapped' };
  }

  const result = await getLeaguePastEvents(tsdbLeagueId);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const events = (result.data && result.data.events) || [];
  const normalized = normalizeTeamName(teamName);

  function isMatch(name) {
    return name && normalizeTeamName(name).indexOf(normalized) !== -1;
  }

  const teamEvents = events.filter(function (e) {
    return e.strStatus === 'FT' && (isMatch(e.strHomeTeam) || isMatch(e.strAwayTeam));
  });

  let resolvedTeamId = teamId || null;
  if (!resolvedTeamId) {
    for (let i = 0; i < teamEvents.length; i++) {
      const e = teamEvents[i];
      if (isMatch(e.strHomeTeam)) { resolvedTeamId = e.idHomeTeam; break; }
      if (isMatch(e.strAwayTeam)) { resolvedTeamId = e.idAwayTeam; break; }
    }
  }

  const lastEvents = teamEvents.slice(-n);

  return {
    ok: true,
    data: { response: lastEvents.map(toAnalysisFixture) },
    teamId: resolvedTeamId,
  };
}

// ============================================================================
// PRO/PREMIUM V2 EK VERILER: mac zaman cizelgesi, istatistikler, kadrolar,
// TV yayin bilgisi, one cikanlar (highlights), tam sezon fikstürleri.
// Onemli: bu veriler TheSportsDB'nin API-Football ile eslestirdigi buyuk
// liglerde mevcut - kucuk/az bilinen liglerdeki maclarda genelde BOS doner.
// Bu bir hata degil, TheSportsDB'nin kendi veri kapsamiyla ilgili bir sinir -
// asagidaki fonksiyonlarin hepsi bu durumda { available: false, ... } donup
// hicbir seyi kirmadan sessizce devam eder.
// ============================================================================

async function getEventTimeline(eventId) {
  return fetchV2('/lookup/event_timeline/' + eventId, 8000);
}

async function getEventStats(eventId) {
  return fetchV2('/lookup/event_stats/' + eventId, 8000);
}

async function getEventLineup(eventId) {
  return fetchV2('/lookup/event_lineup/' + eventId, 8000);
}

async function getEventTV(eventId) {
  return fetchV2('/lookup/event_tv/' + eventId, 8000);
}

async function getEventHighlights(eventId) {
  return fetchV2('/lookup/event_highlights/' + eventId, 8000);
}

async function getTeamSeasonSchedule(teamId) {
  return fetchV2('/schedule/full/team/' + teamId, 10000);
}

async function getLeagueSeasonSchedule(tsdbLeagueId, season) {
  return fetchV2('/schedule/league/' + tsdbLeagueId + '/' + encodeURIComponent(season), 10000);
}

/** strTimeline degerini (Goal/subst/Yellow Card/Red Card vb.) sabit bir tipe cevirir */
function normalizeTimelineType(rawType) {
  const raw = String(rawType || '').toLowerCase();
  if (raw.indexOf('goal') !== -1) return 'goal';
  if (raw.indexOf('subst') !== -1 || raw.indexOf('sub') !== -1) return 'substitution';
  if (raw.indexOf('yellow') !== -1) return 'yellow_card';
  if (raw.indexOf('red') !== -1) return 'red_card';
  return 'other';
}

function transformTimelineItem(item) {
  return {
    minute: item.intTime !== null && item.intTime !== undefined ? parseInt(item.intTime, 10) : null,
    type: normalizeTimelineType(item.strTimeline),
    detail: item.strTimelineDetail || '',
    isHome: item.strHome === 'Yes',
    team: item.strTeam || '',
    player: item.strPlayer || '',
    assist: item.strAssist || null,
  };
}

/**
 * Bir macin gol/kart/oyuncu degisikligi zaman cizelgesini doner.
 * @param {string|number} eventId
 */
async function getEventTimelineFormatted(eventId) {
  const result = await getEventTimeline(eventId);
  if (!result.ok) return { ok: true, available: false, events: [] };
  const raw = (result.data && result.data.lookup) || [];
  const events = raw.map(transformTimelineItem).sort(function (a, b) { return (a.minute || 0) - (b.minute || 0); });
  return { ok: true, available: events.length > 0, events: events };
}

// TheSportsDB'nin strStat metnini bizim sabit anahtarlarimiza esler.
const STAT_LABEL_MAP = {
  'shots on goal': 'shotsOnTarget',
  'total shots': 'totalShots',
  'corner kicks': 'corners',
  'ball possession': 'possession',
  fouls: 'fouls',
  offsides: 'offsides',
  'yellow cards': 'yellowCards',
  'red cards': 'redCards',
  'goalkeeper saves': 'saves',
  expected_goals: 'xg',
};

function transformStats(rawList) {
  const out = {};
  rawList.forEach(function (item) {
    const label = String(item.strStat || '').trim().toLowerCase();
    const key = STAT_LABEL_MAP[label];
    if (!key) return;
    const home = item.intHome !== null && item.intHome !== undefined ? parseFloat(item.intHome) : null;
    const away = item.intAway !== null && item.intAway !== undefined ? parseFloat(item.intAway) : null;
    out[key] = { home: home, away: away };
  });
  return out;
}

/**
 * Bir macin gercek istatistiklerini doner (sut, korner, top hakimiyeti,
 * faul, xG vb.) - onceden bunlar hep 0/50-50 sabitti, artik gercek.
 */
async function getEventStatsFormatted(eventId) {
  const result = await getEventStats(eventId);
  if (!result.ok) return { ok: true, available: false, stats: {} };
  const raw = (result.data && result.data.lookup) || [];
  if (!raw.length) return { ok: true, available: false, stats: {} };
  return { ok: true, available: true, stats: transformStats(raw) };
}

function transformLineupItem(item) {
  return {
    player: item.strPlayer || '',
    position: item.strPosition || '',
    positionShort: item.strPositionShort || '',
    squadNumber: item.intSquadNumber || null,
    isHome: item.strHome === 'Yes',
    isSubstitute: item.strSubstitute === 'Yes',
    photo: item.strCutout || null,
  };
}

/** Bir macin ilk 11 + yedek kadrolarini (ev/deplasman ayri) doner */
async function getEventLineupFormatted(eventId) {
  const result = await getEventLineup(eventId);
  if (!result.ok) return { ok: true, available: false, home: [], away: [], homeSubs: [], awaySubs: [] };
  const raw = (result.data && result.data.lookup) || [];
  if (!raw.length) return { ok: true, available: false, home: [], away: [], homeSubs: [], awaySubs: [] };

  const mapped = raw.map(transformLineupItem);
  return {
    ok: true,
    available: true,
    home: mapped.filter(function (p) { return p.isHome && !p.isSubstitute; }),
    away: mapped.filter(function (p) { return !p.isHome && !p.isSubstitute; }),
    homeSubs: mapped.filter(function (p) { return p.isHome && p.isSubstitute; }),
    awaySubs: mapped.filter(function (p) { return !p.isHome && p.isSubstitute; }),
  };
}

function transformTVItem(item) {
  return {
    channel: item.strChannel || '',
    country: item.strCountry || '',
    logo: item.strLogo || null,
    time: item.strTime || null,
    date: item.dateEvent || null,
  };
}

/** Bir macin hangi TV kanallarinda yayinlandigini/yayinlanacagini doner */
async function getEventTVFormatted(eventId) {
  const result = await getEventTV(eventId);
  if (!result.ok) return { ok: true, available: false, broadcasts: [] };
  const raw = (result.data && result.data.lookup) || [];
  return { ok: true, available: raw.length > 0, broadcasts: raw.map(transformTVItem) };
}

/** Bir macin YouTube one cikanlar (highlights) videosunu doner */
async function getEventHighlightsFormatted(eventId) {
  const result = await getEventHighlights(eventId);
  if (!result.ok) return { ok: true, available: false, videoUrl: null };
  const raw = (result.data && result.data.lookup) || [];
  const first = raw[0];
  const videoUrl = first && first.strVideo ? first.strVideo : null;
  return { ok: true, available: !!videoUrl, videoUrl: videoUrl };
}

function transformScheduleEvent(e) {
  const homeScore = e.intHomeScore !== null && e.intHomeScore !== undefined ? parseInt(e.intHomeScore, 10) : null;
  const awayScore = e.intAwayScore !== null && e.intAwayScore !== undefined ? parseInt(e.intAwayScore, 10) : null;
  return {
    fixtureId: e.idEvent,
    date: e.dateEvent || (e.strTimestamp || '').slice(0, 10),
    kickoff: toUtcIso(e.strTimestamp),
    league: e.strLeague || '',
    round: e.intRound || null,
    homeTeam: e.strHomeTeam || '',
    awayTeam: e.strAwayTeam || '',
    homeScore: homeScore,
    awayScore: awayScore,
    finished: homeScore !== null && awayScore !== null,
    video: e.strVideo || null,
  };
}

/**
 * Bir takimin TUM sezon fikstürünü doner (gecmis + gelecek maclar, max 250
 * kayit). eventslast.php'nin aksine (sadece son 10 mac) form disi analizler
 * icin (orn. gelecek fikstür yogunlugu, motivasyon) kullanislidir.
 */
async function getTeamSeasonScheduleFormatted(teamId) {
  const result = await getTeamSeasonSchedule(teamId);
  if (!result.ok) return { ok: true, available: false, events: [] };
  const raw = Array.isArray(result.data) ? result.data : ((result.data && result.data.schedule) || []);
  return { ok: true, available: raw.length > 0, events: raw.map(transformScheduleEvent) };
}

/**
 * Bir ligin TUM sezon fikstürünü doner (max 3000 kayit).
 * @param {number} tsdbLeagueId
 * @param {string} season - orn. '2025-2026'
 */
async function getLeagueSeasonScheduleFormatted(tsdbLeagueId, season) {
  const result = await getLeagueSeasonSchedule(tsdbLeagueId, season);
  if (!result.ok) return { ok: true, available: false, events: [] };
  const raw = Array.isArray(result.data) ? result.data : ((result.data && result.data.schedule) || []);
  return { ok: true, available: raw.length > 0, events: raw.map(transformScheduleEvent) };
}

// LEAGUE_ID_MAP'in tersi: TheSportsDB idLeague -> FotMob leagueId.
// Frontend TheSportsDB ID'sini biliyor (matches/results verisinden), ama
// analysisEngine FotMob ID'si bekliyor - bu fonksiyon ikisi arasinda koprudur.
function getFotmobIdForTsdbLeague(tsdbLeagueId) {
  for (const [fotmobId, tsdbId] of Object.entries(LEAGUE_ID_MAP)) {
    if (String(tsdbId) === String(tsdbLeagueId)) return fotmobId;
  }
  return null;
}

module.exports = {
  getMatchesByDate,
  transformEvent,
  toUtcIso,
  getTeamFixturesForAnalysis,
  getLeaguePastEvents,
  getFotmobIdForTsdbLeague,
  getLiveScores,
  transformLiveEvent,
  getEventTimelineFormatted,
  getEventStatsFormatted,
  getEventLineupFormatted,
  getEventTVFormatted,
  getEventHighlightsFormatted,
  getTeamSeasonScheduleFormatted,
  getLeagueSeasonScheduleFormatted,
  isWhitelistedLeague,
  WHITELISTED_LEAGUE_IDS,
  LEAGUE_ID_MAP,
};
