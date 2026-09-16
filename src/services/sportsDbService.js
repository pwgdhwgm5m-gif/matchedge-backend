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
    kickoff: e.strTimestamp || (e.dateEvent + 'T' + (e.strTime || '00:00:00')),
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
    kickoff: e.dateEvent && e.strEventTime ? e.dateEvent + 'T' + e.strEventTime : null,
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
  getTeamFixturesForAnalysis,
  getLeaguePastEvents,
  getFotmobIdForTsdbLeague,
  getLiveScores,
  transformLiveEvent,
  LEAGUE_ID_MAP,
};
