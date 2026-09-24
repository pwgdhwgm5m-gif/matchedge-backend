const assert = require('node:assert/strict');
const test = require('node:test');
const registry = require('../src/services/competitionRegistryService');
const sourcePolicy = require('../src/services/sourcePolicyService');
const config = require('../src/config/config');
const sportsDb = require('../src/services/sportsDbService');

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
    ['sportsdb', '4689', 'K League 1', 'south-korea-k-league-1'],
    ['sportsdb', '4631', 'Czech First League', 'czechia-first-league'],
    ['sportsdb', '4671', 'Serbian Super Liga', 'serbia-superliga'],
    ['sportsdb', '4354', 'Ukrainian Premier League', 'ukraine-premier-league'],
    ['sportsdb', '4690', 'Hungarian NB I', 'hungary-nb-i'],
    ['sportsdb', '4643', 'League of Ireland Premier Division', 'ireland-premier-division'],
    ['sportsdb', '4359', 'Chinese Super League', 'china-super-league'],
    ['sportsdb', '5831', 'Belgian Cup', 'belgium-cup'],
    ['sportsdb', '5830', 'Greek Football Cup', 'greece-cup'],
    ['sportsdb', '4723', 'Scottish FA Cup', 'scotland-cup'],
    ['sportsdb', '5489', 'Swiss Cup', 'switzerland-cup'],
    ['sportsdb', '5883', 'Austrian Cup', 'austria-cup'],
    ['sportsdb', '5838', 'Puchar Polski', 'poland-cup'],
    ['sportsdb', '5193', 'Russian Cup', 'russia-cup'],
    ['sportsdb', '5199', 'US Open Cup', 'usa-us-open-cup'],
    ['sportsdb', '5637', 'Emperor Cup', 'japan-emperors-cup'],
    ['sportsdb', '5635', 'Korea Cup', 'south-korea-korea-cup'],
    ['sportsdb', '5525', 'China FA Cup', 'china-fa-cup'],
    ['sportsdb', '5180', 'Australia Cup', 'australia-cup'],
    ['sportsdb', '4756', 'Svenska Cupen', 'sweden-cup'],
    ['sportsdb', '5634', 'Norwegian Cup', 'norway-cup'],
    ['bsd', '52', 'Chinese Super League', 'china-super-league'],
    ['bsd', '51', 'Emperor Cup', 'japan-emperors-cup'],
    ['bsd', '46', 'Puchar Polski', 'poland-cup'],
    ['bsd', '90', 'UEFA Super Cup', 'uefa-super-cup']
  ];
  for (const [provider, leagueId, leagueName, expected] of cases) {
    assert.equal(
      registry.resolveCompetition({ provider, leagueId, leagueName })?.canonicalCompetitionKey,
      expected
    );
  }
});

test('coverage metadata separates mapping, fixture, result, filter and home states', () => {
  const china = registry.resolveCompetition({ provider: 'bsd', leagueId: '52' });
  assert.equal(china.mappingStatus, 'verified');
  assert.equal(china.configured, true);
  assert.equal(china.fixtureCoverage, 'fixture-producing');
  assert.equal(china.resultCoverage, 'result-producing');
  assert.equal(china.active, true);
  assert.equal(china.visibleInCompetitionFilter, true);
  assert.equal(china.eligibleForHomePriority, true);

  const australia = registry.resolveCompetition({ provider: 'oddsApi', sportKey: 'soccer_australia_aleague' });
  assert.equal(australia.mappingStatus, 'verified');
  assert.equal(australia.configured, true);
  assert.equal(australia.fixtureCoverage, 'observed-intermittently');
  assert.equal(australia.resultCoverage, 'not-observed');
  assert.equal(australia.active, false);
  assert.equal(australia.visibleInCompetitionFilter, true);
  assert.equal(australia.eligibleForHomePriority, false);

  for (const key of ['uefa-nations-league', 'concacaf-nations-league', 'mexico-liga-mx']) {
    const legacy = registry.getCompetitionRegistry().find(item => item.canonicalCompetitionKey === key);
    assert.ok(legacy);
    assert.equal(legacy.visibleInCompetitionFilter, false);
    assert.equal(legacy.eligibleForHomePriority, false);
  }
  assert.equal(registry.resolveCompetition({ provider: 'sportsdb', leagueId: '4490' })?.canonicalCompetitionKey,
    'uefa-nations-league');
  assert.equal(registry.resolveCompetition({ provider: 'bsd', leagueId: '65' })?.canonicalCompetitionKey,
    'concacaf-nations-league');
  assert.equal(registry.resolveCompetition({ provider: 'sportsdb', leagueId: '4350' })?.canonicalCompetitionKey,
    'mexico-liga-mx');
  assert.ok(registry.getCompetitionRegistry({ includeInactive: false })
    .every(item => item.fixtureCoverage === 'fixture-producing'));
});

test('TheSportsDB whitelist IDs require consistent league identity', () => {
  for (const [id, name] of [
    ['4631', 'Czech First League'],
    ['4671', 'Serbian Super Liga'],
    ['4354', 'Ukrainian Premier League'],
    ['4690', 'Hungarian NB I'],
    ['4643', 'Irish Premier Division'],
    ['4359', 'Chinese Super League'],
    ['5831', 'Belgian Cup'],
    ['5830', 'Greek Football Cup'],
    ['4723', 'Scottish FA Cup'],
    ['5489', 'Swiss Cup'],
    ['5883', 'Austrian Cup'],
    ['5634', 'Norwegian Cupen'],
    ['4756', 'Svenska Cupen'],
    ['5838', 'Polish Cup'],
    ['5193', 'Russian Cup'],
    ['5199', 'US Open Cup'],
    ['5637', 'Japan Emperors Cup'],
    ['5635', 'Korea Cup'],
    ['5525', 'China FA Cup'],
    ['5180', 'Australia Cup']
  ]) {
    assert.equal(sportsDb.isWhitelistedLeague(id), true, `ID ${id} is whitelisted`);
    assert.equal(sportsDb.isLeagueIdentityConsistent(id, name), true, `${id} accepts ${name}`);
  }
  assert.equal(sportsDb.isLeagueIdentityConsistent('5831', 'English League One'), false);
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
  const czechCup = registry.resolveCompetition({ leagueName: 'MOL Cup' });
  assert.equal(czechCup?.canonicalCompetitionKey, 'czechia-cup');
  assert.equal(czechCup?.mappingStatus, 'unverified');
  assert.equal(czechCup?.active, false);
  assert.deepEqual(czechCup?.providerIds, {
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