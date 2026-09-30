const config = require('../config/config');
const { normalizeTeamName } = require('../utils/textNormalize');
const cache = require('../utils/cache');
const providerQuota = require('./providerQuotaService');

const CLUB_WORDS = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'calcio', 'club', 'de', 'football']);

function canonicalTeamName(name) {
  return normalizeTeamName(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word && !CLUB_WORDS.has(word))
    .join(' ');
}

function teamsMatch(left, right) {
  const a = canonicalTeamName(left);
  const b = canonicalTeamName(right);
  if (!a || !b) return false;
  return a === b || (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)));
}

function scoreNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

async function getMatchesByDate(date) {
  if (!config.footballDataOrg.token) return { ok: false, disabled: true, matches: [] };
  const key=`football-data-org:matches:${date}`;
  const hit=cache.get(key); if(hit!==undefined)return {...hit,cached:true};
  if(!providerQuota.canCall('footballDataOrg'))return {ok:false,error:'quota_guard_football_data',matches:[]};
  providerQuota.record('footballDataOrg');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `${config.footballDataOrg.baseUrl}/matches?dateFrom=${encodeURIComponent(date)}&dateTo=${encodeURIComponent(date)}`;
    const response = await fetch(url, {
      headers: { 'X-Auth-Token': config.footballDataOrg.token },
      signal: controller.signal,
    });
    if (!response.ok) { if(response.status===429)providerQuota.rateLimited('footballDataOrg',60000); return { ok: false, error: `http_${response.status}`, matches: [] }; }
    const data = await response.json();
    const out={ ok: true, matches: Array.isArray(data.matches) ? data.matches : [] }; cache.set(key,out,15*60); return out;
  } catch (error) {
    return { ok: false, error: error.message, matches: [] };
  } finally {
    clearTimeout(timer);
  }
}

function mergeVerifiedScores(matches, providerMatches) {
  if (!Array.isArray(providerMatches) || !providerMatches.length) return matches;

  return matches.map(match => {
    const verified = providerMatches.find(item =>
      teamsMatch(match.homeTeam, item.homeTeam?.name || item.homeTeam?.shortName) &&
      teamsMatch(match.awayTeam, item.awayTeam?.name || item.awayTeam?.shortName)
    );
    if (!verified) return match;

    const fullTime = verified.score?.fullTime || {};
    const halfTime = verified.score?.halfTime || {};
    const fullHome = scoreNumber(fullTime.home ?? fullTime.homeTeam);
    const fullAway = scoreNumber(fullTime.away ?? fullTime.awayTeam);
    const halfHome = scoreNumber(halfTime.home ?? halfTime.homeTeam);
    const halfAway = scoreNumber(halfTime.away ?? halfTime.awayTeam);
    const finished = verified.status === 'FINISHED';

    return {
      ...match,
      homeScore: fullHome ?? match.homeScore,
      awayScore: fullAway ?? match.awayScore,
      halftimeHome: halfHome ?? match.halftimeHome,
      halftimeAway: halfAway ?? match.halftimeAway,
      statusShort: finished ? 'FT' : match.statusShort,
      isLive: finished ? false : match.isLive,
      resultSource: 'football-data.org',
      resultVerified: fullHome !== null && fullAway !== null,
    };
  });
}

module.exports = { getMatchesByDate, mergeVerifiedScores, canonicalTeamName, teamsMatch };
