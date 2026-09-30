const config = require('../config/config');
const { fetchT } = require('../utils/fetchWithTimeout');
const cache = require('../utils/cache');
const providerQuota = require('./providerQuotaService');

/**
 * "Free API Live Football Data" (RapidAPI) - gunun maclarini date bazli
 * ceken ikinci kaynak. API-Football hesap sorunlari (askiya alinma,
 * abonelik) nedeniyle /api/results, /api/matches ve /api/live BU kaynagi
 * kullaniyor - daha guvenilir calisiyor.
 *
 * @param {string} dateStr - 'YYYY-MM-DD' formatinda tarih
 */
async function getMatchesByDate(dateStr) {
  const key=`free-football:matches:${dateStr}`; const hit=cache.get(key); if(hit!==undefined)return {...hit,cached:true};
  if(!providerQuota.canCall('freeFootball'))return {ok:false,error:'quota_guard_free_football'};
  providerQuota.record('freeFootball');
  const compactDate = dateStr.replace(/-/g, ''); // '2026-09-15' -> '20260915'

  const result=await fetchT(
    {
      method: 'GET',
      url: `${config.freeFootballApi.baseUrl}/football-get-matches-by-date`,
      headers: {
        'x-rapidapi-host': config.freeFootballApi.host,
        'x-rapidapi-key': config.freeFootballApi.key,
      },
      params: { date: compactDate },
    },
    8000,
    'FreeFootballAPI Matches'
  );
  if(!result.ok){if(String(result.error||'').includes('429'))providerQuota.rateLimited('freeFootball',60000);return result;}
  cache.set(key,result,10*60); return result;
}

/**
 * Bu kaynagin ham mac nesnesini, frontend'in bekledigi sade formata cevirir.
 * Halftime skoru bu API'de yok (undefined kaliyor) - notlarim.html'deki
 * ilk yariya bagli otomatik kontroller bu yuzden calismayabilir, geri
 * kalan (mac sonu bazli) piyasalar sorunsuz calisir.
 */
function transformMatch(m) {
  const finished = !!m.status?.finished;
  const started = !!m.status?.started;
  const cancelled = !!m.status?.cancelled;
  const isLive = started && !finished && !cancelled;

  let statusShort = 'NS';
  if (cancelled) statusShort = m.status?.reason?.short || 'PST';
  else if (finished) statusShort = m.status?.reason?.short || 'FT';
  else if (isLive) statusShort = 'LIVE';

  return {
    fixtureId: m.id,
    league: '', // bu kaynak lig ISMI degil sadece leagueId veriyor
    leagueId: m.leagueId,
    kickoff: m.status?.utcTime || null,
    statusShort,
    minute: null, // bu endpoint canli dakika bilgisi vermiyor
    isLive,
    homeTeam: m.home?.name || m.home?.longName || '',
    awayTeam: m.away?.name || m.away?.longName || '',
    homeScore: m.home?.score ?? 0,
    awayScore: m.away?.score ?? 0,
    halftimeHome: null,
    halftimeAway: null,
  };
}

module.exports = { getMatchesByDate, transformMatch };
