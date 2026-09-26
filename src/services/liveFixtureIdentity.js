const { normalizeTeamIdentity, resolveCompetition } = require('./competitionRegistryService');

function providerKey(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'tsdb' || key.startsWith('thesportsdb') || key.startsWith('sportsdb')) return 'sportsdb';
  if (key.startsWith('sportmonk')) return 'sportmonks';
  return key === 'bsd' ? 'bsd' : null;
}

function acceptsLiveFixture(match, provider, context = {}) {
  if (!match) return false;
  const expectedProvider = providerKey(context.provider);
  if (expectedProvider && expectedProvider !== providerKey(provider)) return false;
  const home = context.homeTeamName || context.home;
  const away = context.awayTeamName || context.away;
  if (home && normalizeTeamIdentity(home) !== normalizeTeamIdentity(match.homeTeam)) return false;
  if (away && normalizeTeamIdentity(away) !== normalizeTeamIdentity(match.awayTeam)) return false;
  const expectedTime = Date.parse(context.kickoff || '');
  const actualTime = Date.parse(match.kickoff || match.date || '');
  if (Number.isFinite(expectedTime) && (!Number.isFinite(actualTime) ||
      Math.abs(expectedTime - actualTime) > 6 * 60 * 60 * 1000)) return false;
  if (context.leagueName || context.league) {
    const requested = resolveCompetition({ leagueName:context.leagueName || context.league });
    const actual = resolveCompetition({ leagueName:match.leagueName || match.league });
    if (requested?.canonicalCompetitionKey && actual?.canonicalCompetitionKey &&
        requested.canonicalCompetitionKey !== actual.canonicalCompetitionKey) return false;
  }
  return true;
}

module.exports = { acceptsLiveFixture, providerKey };
