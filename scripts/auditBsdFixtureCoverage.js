// Run with BSD_API_KEY set: node scripts/auditBsdFixtureCoverage.js 2026-09-25
// Reports every BSD day-feed league and the fixtures hidden by competition mapping.
const bsd = require('../src/services/bsdService');
const registry = require('../src/services/competitionRegistryService');
const sourcePolicy = require('../src/services/sourcePolicyService');

async function main(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Provide a YYYY-MM-DD date');
  const response = await bsd.getResultMatchesForDate(date);
  if (!response.ok) throw new Error(`BSD day feed unavailable: ${response.error}`);
  const leagues = new Map();
  const appBase = process.env.SOCCEREDGE_API_BASE?.replace(/\/$/, '');
  let appIds = null;
  if (appBase) {
    const appResponse = await fetch(`${appBase}/api/matches?date=${date}`);
    if (!appResponse.ok) throw new Error(`App fixtures unavailable: HTTP ${appResponse.status}`);
    const appBody = await appResponse.json();
    appIds = new Set((appBody.matches || []).flatMap(row =>
      [row.bsdEventId, row.providerIds?.bsd].filter(Boolean).map(String)));
  }
  for (const match of response.matches) {
    if (sourcePolicy.isBsdCoreLeague({leagueName: match.league, country: match.leagueCountry})) continue;
    const mapped = registry.decorateMatch(match, 'bsd');
    const key = `${match.leagueId}|${match.leagueCountry}|${match.league}`;
    const row = leagues.get(key) || {
      bsdLeagueId: match.leagueId, country: match.leagueCountry, league: match.league,
      canonicalCompetitionKey: mapped.canonicalCompetitionKey,
      visible: mapped.visibleInCompetitionFilter, count: 0, missingFromApp: 0, examples: []
    };
    row.count++;
    if (appIds && !appIds.has(String(match.bsdEventId))) row.missingFromApp++;
    if ((!mapped.visibleInCompetitionFilter || (appIds && !appIds.has(String(match.bsdEventId)))) && row.examples.length < 3)
      row.examples.push(`${match.homeTeam} - ${match.awayTeam}`);
    leagues.set(key, row);
  }
  const rows = [...leagues.values()].sort((a,b) => Number(a.visible)-Number(b.visible) || a.league.localeCompare(b.league));
  console.log(JSON.stringify({date, registryAvailable: response.registryAvailable,
    providerFixtures: response.matches.length, excludedOrUnmapped: rows.filter(r => !r.visible),
    missingFromApp: appIds ? rows.filter(r => r.missingFromApp) : null,
    mappedLeagues: rows.filter(r => r.visible)}, null, 2));
}

main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
