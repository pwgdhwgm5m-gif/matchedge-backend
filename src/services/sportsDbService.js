/**
 * sportsDbService.js
 * MatchEdge — TheSportsDB (Premium) veri kaynağı.
 * free-api-live-football-data aylık kotasını doldurdugu icin
 * /api/matches ve diger liglerin form verisi bu kaynaga tasindi.
 */

const { normalizeTeamName } = require('../utils/textNormalize');

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json';
const API_KEY = process.env.SPORTSDB_API_KEY || '123';

// free-api-live-football-data (FotMob) semasindaki leagueId -> TheSportsDB idLeague.
// Premier League ve Süper Lig (TFF uzerinden ayri islenir) haric digerleri
// henuz gercek veriyle dogrulanmadi - test edildikce netlesecek.
const LEAGUE_ID_MAP = {
  '47': 4328,   // Premier League
  '87': 4335,   // La Liga
  '55': 4332,   // Serie A
  '54': 4331,   // Bundesliga
  '53': 4334,   // Ligue 1
  '57': 4337,   // Eredivisie
  '135': 4336,  // Yunanistan Super League
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
 * TheSportsDB'nin ham event nesnesini, transformMatch'in (freeFootballApiService)
 * urettigi ile ayni sekle cevirir - route/frontend hicbir sey degistirmeden calisir.
 */
function transformEvent(e) {
  const finished = e.strStatus === 'FT' || e.strStatus === 'Match Finished';
  const started = !!e.intHomeScore || !!e.intAwayScore || finished;
  const isLive = started && !finished && e.strStatus !== 'NS';

  return {
    fixtureId: e.idEvent,
    league: e.strLeague || '',
    leagueId: e.idLeague,
    kickoff: e.strTimestamp || (e.dateEvent + 'T' + (e.strTime || '00:00:00')),
    statusShort: e.strStatus || 'NS',
    minute: null,
    isLive: isLive,
    homeTeam: e.strHomeTeam || '',
    awayTeam: e.strAwayTeam || '',
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

/**
 * analysisEngine.js'in beklendigi {ok, data:{response:[...]}, teamId} formatinda
 * bir takimin son N macini doner. leagueFormService.js ile ayni sozlesme.
 * @param {string} teamName
 * @param {number|string} fotmobLeagueId - analysisEngine'den gelen "league" parametresi
 */
async function getTeamFixturesForAnalysis(teamName, fotmobLeagueId, count) {
  const n = count || 15;
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

  let resolvedTeamId = null;
  for (let i = 0; i < teamEvents.length; i++) {
    const e = teamEvents[i];
    if (isMatch(e.strHomeTeam)) { resolvedTeamId = e.idHomeTeam; break; }
    if (isMatch(e.strAwayTeam)) { resolvedTeamId = e.idAwayTeam; break; }
  }

  const lastEvents = teamEvents.slice(-n);

  const response = lastEvents.map(function (e) {
    return {
      fixture: { id: e.idEvent, date: e.strTimestamp || e.dateEvent },
      teams: {
        home: { id: e.idHomeTeam, name: e.strHomeTeam },
        away: { id: e.idAwayTeam, name: e.strAwayTeam },
      },
      goals: {
        home: e.intHomeScore !== null ? parseInt(e.intHomeScore, 10) : null,
        away: e.intAwayScore !== null ? parseInt(e.intAwayScore, 10) : null,
      },
      score: { halftime: { home: null, away: null } },
    };
  });

  return {
    ok: true,
    data: { response: response },
    teamId: resolvedTeamId,
  };
}

module.exports = {
  getMatchesByDate,
  transformEvent,
  getTeamFixturesForAnalysis,
  getLeaguePastEvents,
  LEAGUE_ID_MAP,
};
