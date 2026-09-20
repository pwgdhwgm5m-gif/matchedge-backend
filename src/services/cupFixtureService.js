// Legacy API-Football supplement disabled: subscription is suspended.
// The primary TheSportsDB/Sportmonks/football-data.org paths remain active.

// TheSportsDB gunluk akista Ziraat Turkiye Kupasi duzenli bulunmuyor.
// API-Football baglantisi varsa sadece bu eksik kupayi ikinci kaynaktan
// tamamlar. Ana kaynak calismaya devam eder; anahtar/kota yoksa bos dizi
// doner ve fikstur ekrani bozulmaz.
const SUPPLEMENTAL_LEAGUES = new Set(['206']); // API-Football: Turkish Cup

function normalizeStatus(short) {
  const status = String(short || 'NS').toUpperCase();
  const finished = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
  const live = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE']);
  return {
    statusShort: finished.has(status) ? 'FT' : status,
    isLive: live.has(status),
  };
}

function transformFixture(item) {
  const state = normalizeStatus(item.fixture && item.fixture.status && item.fixture.status.short);
  return {
    fixtureId: String(item.fixture.id),
    league: item.league.name || 'Turkish Cup',
    leagueId: String(item.league.id),
    kickoff: item.fixture.date || null,
    statusShort: state.statusShort,
    minute: item.fixture.status && item.fixture.status.elapsed != null ? Number(item.fixture.status.elapsed) : null,
    isLive: state.isLive,
    homeId: item.teams.home && item.teams.home.id,
    awayId: item.teams.away && item.teams.away.id,
    homeTeam: item.teams.home && item.teams.home.name || '',
    awayTeam: item.teams.away && item.teams.away.name || '',
    homeBadge: item.teams.home && item.teams.home.logo || null,
    awayBadge: item.teams.away && item.teams.away.logo || null,
    homeScore: item.goals && item.goals.home != null ? Number(item.goals.home) : 0,
    awayScore: item.goals && item.goals.away != null ? Number(item.goals.away) : 0,
    halftimeHome: item.score && item.score.halftime && item.score.halftime.home != null ? Number(item.score.halftime.home) : null,
    halftimeAway: item.score && item.score.halftime && item.score.halftime.away != null ? Number(item.score.halftime.away) : null,
    source: 'api-football-supplement',
  };
}

async function getSupplementalMatches(date) {
  // Never call the suspended API-Football provider. Returning an empty
  // supplement keeps results/fixtures fast and lets primary providers work.
  return [];
}

function mergeUnique(primary, supplemental) {
  const seen = new Set(primary.map(match => String(match.fixtureId)));
  return primary.concat(supplemental.filter(match => !seen.has(String(match.fixtureId))));
}

module.exports = { getSupplementalMatches, mergeUnique, transformFixture };
