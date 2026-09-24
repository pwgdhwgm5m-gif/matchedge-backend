const assert = require('node:assert/strict');
const test = require('node:test');
const registry = require('../src/services/competitionRegistryService');
const sourcePolicy = require('../src/services/sourcePolicyService');
const config = require('../src/config/config');

test('registry preserves the six existing SportMonks primary IDs', () => {
  assert.equal(registry.assertPrimaryMappingsUnchanged(), true);
  for (const primary of sourcePolicy.SPORTMONKS_PRIMARY) {
    const entry = registry.getCompetitionRegistry().find(item =>
      item.providerIds.sportmonks === primary.sportmonksId
    );
    assert.ok(entry, `missing SportMonks mapping ${primary.sportmonksId}`);
  }
});

test('verified provider IDs resolve to the same canonical competition', () => {
  const cases = [
    ['sportsdb', '4483', 'Copa del Rey', 'spain-copa-del-rey'],
    ['bsd', '41', 'Copa del Rey', 'spain-copa-del-rey'],
    ['sportsdb', '4510', 'Taça de Portugal', 'portugal-taca-de-portugal'],
    ['bsd', '92', 'Taca de Portugal', 'portugal-taca-de-portugal'],
    ['sportsdb', '4346', 'American Major League Soccer', 'usa-mls'],
    ['bsd', '18', 'MLS', 'usa-mls'],
    ['bsd', '50', 'K League 1', 'south-korea-k-league-1'],
    ['sportsdb', '4689', 'K League 1', 'south-korea-k-league-1']
  ];
  for (const [provider, leagueId, leagueName, expected] of cases) {
    assert.equal(
      registry.resolveCompetition({ provider, leagueId, leagueName })?.canonicalCompetitionKey,
      expected
    );
  }
});

test('registry maps every existing Odds API tracked sport key without adding new keys', () => {
  const configured = (config.trackedLeagues || []).map(item =>
    typeof item === 'string' ? item : item.key
  ).filter(Boolean).sort();
  const registered = registry.getCompetitionRegistry().flatMap(item => {
    const value = item.providerIds.oddsApi;
    return (Array.isArray(value) ? value : [value]).filter(Boolean);
  }).sort();
  assert.deepEqual(registered, configured);
  for (const sportKey of configured) {
    assert.ok(
      registry.resolveCompetition({ provider: 'oddsApi', sportKey }),
      `missing registry mapping for ${sportKey}`
    );
  }
});

test('UEFA qualification and knockout labels resolve to their parent competition', () => {
  assert.equal(
    registry.resolveCompetition({ leagueName: 'UEFA Champions League First Qualifying Round' })
      ?.canonicalCompetitionKey,
    'uefa-champions-league'
  );
  assert.equal(
    registry.resolveCompetition({ leagueName: 'UEFA Champions League Qualification' })
      ?.canonicalCompetitionKey,
    'uefa-champions-league'
  );
  assert.equal(
    registry.resolveCompetition({ leagueName: 'UEFA Europa League Knockout Play-offs' })
      ?.canonicalCompetitionKey,
    'uefa-europa-league'
  );
  assert.equal(
    registry.resolveCompetition({ leagueName: 'UEFA Conference League Quarter-finals' })
      ?.canonicalCompetitionKey,
    'uefa-conference-league'
  );
});

test('unverified requested competitions contain no invented provider IDs', () => {
  const czechia = registry.resolveCompetition({ leagueName: 'Czech Republic First League' });
  assert.equal(czechia?.canonicalCompetitionKey, 'czechia-first-league');
  assert.equal(czechia?.active, false);
  assert.deepEqual(czechia?.providerIds, {
    sportmonks: null, sportsdb: null, bsd: null, oddsApi: null
  });
});

test('cross-provider duplicate aliases collapse while preserving source IDs', () => {
  const rows = [
    {
      fixtureId: 'tsdb-1', leagueId: '4483', league: 'Copa del Rey',
      homeTeam: 'Lebrijana', awayTeam: 'Ceuta 6 de Junio',
      kickoff: '2026-09-26T16:00:00Z', canonicalProvider: 'thesportsdb',
      providerIds: { sportsdb: 'tsdb-1' }
    },
    {
      fixtureId: 'bsd-1', leagueId: '41', league: 'Copa del Rey',
      homeTeam: 'UB Lebrijana', awayTeam: 'CD 6 de Junio',
      kickoff: '2026-09-26T16:00:00+00:00', canonicalProvider: 'bsd',
      providerIds: { bsd: 'bsd-1' }
    }
  ].map(row => registry.decorateMatch(row, row.canonicalProvider === 'bsd' ? 'bsd' : 'sportsdb'));

  const result = registry.dedupeCompetitionFixtures(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].canonicalProvider, 'bsd');
  assert.equal(result[0].providerIds.sportsdb, 'tsdb-1');
  assert.equal(result[0].providerIds.bsd, 'bsd-1');
});

test('observed MLS, Taça, and Ireland naming aliases share stable identities', () => {
  assert.equal(registry.normalizeTeamIdentity('Republic of Ireland'), 'ireland');
  assert.equal(registry.normalizeTeamIdentity('N. Ireland'), 'northernireland');
  for (const [providerName, bsdName] of [
    ['Anaitasuna', 'CD Anaitasuna FT'],
    ['Tedeón', 'CD Tedeon'],
    ['Baztán', 'CD Baztan'],
    ['Ribadesella', 'Ribadesella CF'],
    ['Noja', 'Noja SD'],
    ['Pinatar', 'UD Pinatar'],
    ['Atlético Melilla', 'Atletico Melilla CF'],
    ['Sant Rafel', 'CF Sant Rafel'],
    ['Prat', 'AE Prat'],
    ['Talayuela', 'CP Talayuela'],
    ['Maracena', 'UD Maracena'],
    ['Tavernes de la Valldigna', 'UE Tavernes'],
    ['San José de Soria', 'C.D. San José']
  ]) {
    assert.equal(registry.normalizeTeamIdentity(providerName), registry.normalizeTeamIdentity(bsdName));
  }

  const rows = [
    registry.decorateMatch({
      fixtureId: 'tsdb-cup', leagueId: '4510', league: 'Taca de Portugal',
      homeTeam: 'Camacha', awayTeam: 'Florgrade',
      kickoff: '2026-09-27T14:00:00Z', canonicalProvider: 'thesportsdb'
    }, 'sportsdb'),
    registry.decorateMatch({
      fixtureId: 'bsd-cup', leagueId: '92', league: 'Taça de Portugal',
      homeTeam: 'AD Camacha', awayTeam: 'Florgrade FC',
      kickoff: '2026-09-27T14:00:00Z', canonicalProvider: 'bsd'
    }, 'bsd')
  ];
  assert.equal(registry.dedupeCompetitionFixtures(rows).length, 1);
});

test('observed Copa del Rey provider aliases collapse without losing source IDs', () => {
  const pairs = [
    [['Anaitasuna', 'Tedeón'], ['CD Anaitasuna FT', 'CD Tedeon']],
    [['Atlético Calatayud', 'Baztán'], ['Atlético Calatayud', 'CD Baztan']],
    [['Ribadesella', 'Noja'], ['Ribadesella CF', 'Noja SD']],
    [['Pinatar', 'Atlético Melilla'], ['UD Pinatar', 'Atletico Melilla CF']],
    [['Sporting de Hortaleza', 'Atlético Unión Güímar'], ['Sporting Hortaleza', 'Atlético Unión Güímar']],
    [['Sant Rafel', 'Prat'], ['CF Sant Rafel', 'AE Prat']],
    [['Talayuela', 'Sporting de Alcázar'], ['CP Talayuela', 'Sporting de Alcazar CF']],
    [['Maracena', 'Tavernes de la Valldigna'], ['UD Maracena', 'UE Tavernes']],
    [['Auriense', 'San José de Soria'], ['Auriense CA', 'C.D. San José']]
  ];
  const rows = pairs.flatMap(([providerTeams, bsdTeams], index) => [
    registry.decorateMatch({
      fixtureId: `tsdb-copa-${index}`, leagueId: '4483', league: 'Copa del Rey',
      homeTeam: providerTeams[0], awayTeam: providerTeams[1],
      kickoff: `2026-09-26T${String(14 + index).padStart(2, '0')}:00:00Z`,
      providerIds: { sportsdb: `tsdb-copa-${index}` },
      canonicalProvider: 'thesportsdb'
    }, 'sportsdb'),
    registry.decorateMatch({
      fixtureId: `bsd-copa-${index}`, leagueId: '41', league: 'Copa del Rey',
      homeTeam: bsdTeams[0], awayTeam: bsdTeams[1],
      kickoff: `2026-09-26T${String(14 + index).padStart(2, '0')}:00:00Z`,
      providerIds: { bsd: `bsd-copa-${index}` },
      canonicalProvider: 'bsd'
    }, 'bsd')
  ]);
  const deduped = registry.dedupeCompetitionFixtures(rows);
  assert.equal(deduped.length, pairs.length);
  for (const match of deduped) {
    assert.ok(match.providerIds.sportsdb);
    assert.ok(match.providerIds.bsd);
  }
});

test('fixture identity keeps competition and kickoff in the dedupe check', () => {
  const base = {
    homeTeam: 'Seattle Sounders', awayTeam: 'Real Salt Lake',
    kickoff: '2026-09-24T19:00:00Z', canonicalProvider: 'bsd'
  };
  const rows = [
    registry.decorateMatch({ ...base, leagueId: '18', league: 'MLS' }, 'bsd'),
    registry.decorateMatch({
      ...base, fixtureId: 'different-match', league: 'MLS',
      kickoff: '2026-09-24T19:40:00Z', canonicalProvider: 'thesportsdb'
    }, 'sportsdb'),
    registry.decorateMatch({
      ...base, league: 'UEFA Nations League'
    }, 'bsd')
  ];
  assert.equal(registry.dedupeCompetitionFixtures(rows).length, 3);
});

test('fixtures without kickoff are not merged based only on team names', () => {
  const rows = [
    registry.decorateMatch({
      fixtureId: 'a', league: 'MLS', homeTeam: 'Seattle Sounders',
      awayTeam: 'Real Salt Lake', canonicalProvider: 'bsd'
    }, 'bsd'),
    registry.decorateMatch({
      fixtureId: 'b', league: 'American Major League Soccer', homeTeam: 'Seattle Sounders FC',
      awayTeam: 'Real Salt Lake', canonicalProvider: 'thesportsdb'
    }, 'sportsdb')
  ];
  assert.equal(registry.dedupeCompetitionFixtures(rows).length, 2);
});