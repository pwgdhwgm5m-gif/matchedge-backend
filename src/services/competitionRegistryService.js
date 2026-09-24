const sourcePolicy = require('./sourcePolicyService');

function makeCompetition(
  canonicalCompetitionKey,
  displayName,
  country,
  type,
  priority,
  homePageRank,
  providerIds = {},
  aliases = [],
  mappingStatus = 'verified',
  coverage = {}
) {
  const ids = {
    sportmonks: null,
    sportsdb: null,
    bsd: null,
    oddsApi: null,
    ...providerIds
  };
  const hasProviderId = Object.values(ids).some(value =>
    Array.isArray(value) ? value.some(Boolean) : value != null && String(value).trim() !== ''
  );
  const fixtureCoverage = coverage.fixtureCoverage ||
    (mappingStatus === 'unverified' ? 'unverified' : 'not-observed');
  const resultCoverage = coverage.resultCoverage ||
    (mappingStatus === 'unverified' ? 'unverified' : 'not-observed');
  const visibleInCompetitionFilter = coverage.visibleInCompetitionFilter ??
    (mappingStatus === 'verified' && homePageRank < 99);
  const eligibleForHomePriority = coverage.eligibleForHomePriority ??
    (mappingStatus === 'verified' && homePageRank < 99);
  return Object.freeze({
    canonicalCompetitionKey,
    displayName,
    country,
    type,
    priority,
    homePageRank,
    providerIds: Object.freeze(ids),
    aliases: Object.freeze([...new Set([displayName, ...aliases])]),
    configured: hasProviderId,
    mappingStatus,
    fixtureCoverage,
    resultCoverage,
    visibleInCompetitionFilter,
    eligibleForHomePriority,
    // `active` is intentionally narrower than "has a provider key": it now
    // means a fixture-producing path was verified for this competition.
    active: fixtureCoverage === 'fixture-producing'
  });
}

function pending(key, name, country, type, homePageRank, aliases = [], priority = 2) {
  return makeCompetition(
    key, name, country, type, priority, homePageRank, {}, aliases, 'unverified'
  );
}

const COMPETITIONS = Object.freeze([
  // The six SportMonks primaries are mirrored for identity/display only.
  // sourcePolicyService remains the authority for their provider routing.
  makeCompetition('england-premier-league', 'England Premier League', 'England', 'league', 1, 1,
    { sportmonks: '8', sportsdb: '4328', oddsApi: 'soccer_epl' },
    ['Premier League', 'English Premier League', 'EPL'],
    'verified', { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),
  makeCompetition('spain-la-liga', 'Spain La Liga', 'Spain', 'league', 1, 1,
    { sportmonks: '564', sportsdb: '4335', oddsApi: 'soccer_spain_la_liga' },
    ['La Liga', 'Primera División', 'Spanish La Liga'],
    'verified', { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),
  makeCompetition('italy-serie-a', 'Italy Serie A', 'Italy', 'league', 1, 1,
    { sportmonks: '384', sportsdb: '4332', oddsApi: 'soccer_italy_serie_a' },
    ['Serie A', 'Italian Serie A'],
    'verified', { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),
  makeCompetition('germany-bundesliga', 'Germany Bundesliga', 'Germany', 'league', 1, 1,
    { sportmonks: '82', sportsdb: '4331', oddsApi: 'soccer_germany_bundesliga' },
    ['Bundesliga', 'German Bundesliga'],
    'verified', { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),
  makeCompetition('france-ligue-1', 'France Ligue 1', 'France', 'league', 1, 1,
    { sportmonks: '301', sportsdb: '4334', oddsApi: 'soccer_france_ligue_one' },
    ['Ligue 1', 'Ligue One', 'French Ligue 1'],
    'verified', { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),
  makeCompetition('turkey-super-lig', 'Turkey Süper Lig', 'Turkey', 'league', 1, 1,
    { sportmonks: '600', sportsdb: '4339', oddsApi: 'soccer_turkey_super_league' },
    ['Süper Lig', 'Super Lig', 'Turkish Super Lig', 'Turkey Super League'],
    'verified', { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),

  // Requested European first divisions with verified TheSportsDB IDs.
  makeCompetition('portugal-primeira-liga', 'Portugal Primeira Liga', 'Portugal', 'league', 2, 3,
    { sportsdb: '4344', oddsApi: 'soccer_portugal_primeira_liga' },
    ['Primeira Liga', 'Liga Portugal', 'Portuguese Primeira Liga', 'Portugal Liga Portugal']),
  makeCompetition('netherlands-eredivisie', 'Netherlands Eredivisie', 'Netherlands', 'league', 2, 3,
    { sportsdb: '4337', oddsApi: 'soccer_netherlands_eredivisie' },
    ['Eredivisie', 'Dutch Eredivisie', 'Netherlands Eredivisie']),
  makeCompetition('belgium-pro-league', 'Belgium Pro League', 'Belgium', 'league', 2, 3,
    { sportsdb: '4338', oddsApi: 'soccer_belgium_first_div' },
    ['Pro League', 'Belgian Pro League', 'Belgian First Division A']),
  makeCompetition('greece-super-league', 'Greece Super League', 'Greece', 'league', 2, 3,
    { sportsdb: '4336', oddsApi: 'soccer_greece_super_league' },
    ['Greek Super League', 'Greek Super League 1', 'Greece Super League 1']),
  makeCompetition('scotland-premiership', 'Scotland Premiership', 'Scotland', 'league', 2, 3,
    { sportsdb: '4330', oddsApi: 'soccer_spl' },
    ['Scottish Premiership', 'Scottish Premier League', 'Scotland Premiership']),
  makeCompetition('czechia-first-league', 'Czechia First League', 'Czechia', 'league', 2, 3,
    { sportsdb: '4631' },
    ['Czech Republic First League', 'Czech First League']),
  makeCompetition('poland-ekstraklasa', 'Poland Ekstraklasa', 'Poland', 'league', 2, 3,
    { sportsdb: '4422', oddsApi: 'soccer_poland_ekstraklasa' },
    ['Ekstraklasa', 'Polish Ekstraklasa']),
  makeCompetition('austria-bundesliga', 'Austria Bundesliga', 'Austria', 'league', 2, 3,
    { sportsdb: '4621', oddsApi: 'soccer_austria_bundesliga' },
    ['Austrian Bundesliga']),
  makeCompetition('switzerland-super-league', 'Switzerland Super League', 'Switzerland', 'league', 2, 3,
    { sportsdb: '4675', oddsApi: 'soccer_switzerland_superleague' },
    ['Swiss Super League']),
  makeCompetition('denmark-superliga', 'Denmark Superliga', 'Denmark', 'league', 2, 3,
    { sportsdb: '4340', oddsApi: 'soccer_denmark_superliga' },
    ['Danish Superliga', 'Superligaen']),
  makeCompetition('norway-eliteserien', 'Norway Eliteserien', 'Norway', 'league', 2, 3,
    { sportsdb: '4358', oddsApi: 'soccer_norway_eliteserien' },
    ['Eliteserien', 'Norwegian Eliteserien']),
  makeCompetition('sweden-allsvenskan', 'Sweden Allsvenskan', 'Sweden', 'league', 2, 3,
    { sportsdb: '4347', oddsApi: 'soccer_sweden_allsvenskan' },
    ['Allsvenskan', 'Swedish Allsvenskan']),
  makeCompetition('romania-superliga', 'Romania SuperLiga', 'Romania', 'league', 2, 3,
    { sportsdb: '4691' },
    ['Romanian SuperLiga', 'Romanian Liga I', 'Liga I']),
  makeCompetition('croatia-hnl', 'Croatia HNL', 'Croatia', 'league', 2, 3,
    { sportsdb: '4629' },
    ['HNL', 'Croatian HNL', 'Croatian First Football League']),
  makeCompetition('serbia-superliga', 'Serbia SuperLiga', 'Serbia', 'league', 2, 3,
    { sportsdb: '4671' }, ['Serbian SuperLiga', 'Serbian Super League'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('ukraine-premier-league', 'Ukraine Premier League', 'Ukraine', 'league', 2, 3,
    { sportsdb: '4354' }, ['Ukrainian Premier League'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('russia-premier-league', 'Russia Premier League', 'Russia', 'league', 2, 3,
    { sportsdb: '4355', oddsApi: 'soccer_russia_premier_league' },
    ['Russian Premier League', 'Russian Football Premier League']),
  makeCompetition('hungary-nb-i', 'Hungary NB I', 'Hungary', 'league', 2, 3,
    { sportsdb: '4690' }, ['NB I', 'Hungarian NB I', 'Nemzeti Bajnokság I'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('finland-veikkausliiga', 'Finland Veikkausliiga', 'Finland', 'league', 2, 3,
    { sportsdb: '4636', oddsApi: 'soccer_finland_veikkausliiga' },
    ['Veikkausliiga', 'Finnish Veikkausliiga']),
  makeCompetition('ireland-premier-division', 'Ireland Premier Division', 'Ireland', 'league', 2, 3,
    { sportsdb: '4643' }, ['League of Ireland Premier Division', 'Irish Premier Division'],
    'verified', { fixtureCoverage: 'fixture-producing' }),

  // Americas and Asia / Oceania.
  makeCompetition('usa-mls', 'USA Major League Soccer', 'United States', 'league', 2, 4,
    { sportsdb: '4346', bsd: '18' },
    ['MLS', 'American Major League Soccer', 'Major League Soccer', 'USA MLS']),
  makeCompetition('japan-j1-league', 'Japan J1 League', 'Japan', 'league', 2, 4,
    { sportsdb: '4633', oddsApi: 'soccer_japan_j_league' },
    ['J1 League', 'Japanese J1 League']),
  makeCompetition('south-korea-k-league-1', 'South Korea K League 1', 'South Korea', 'league', 2, 4,
    { sportsdb: '4689', bsd: '50', oddsApi: 'soccer_korea_kleague1' },
    ['K League 1', 'K League 1', 'South Korean K League 1']),
  makeCompetition('china-super-league', 'China Chinese Super League', 'China', 'league', 2, 4,
    { sportsdb: '4359', bsd: '52', oddsApi: 'soccer_china_superleague' },
    ['Chinese Super League', 'China Super League'], 'verified',
    { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),
  makeCompetition('australia-a-league-men', 'Australia A-League Men', 'Australia', 'league', 2, 4,
    { oddsApi: 'soccer_australia_aleague' },
    ['A-League Men', 'A-League', 'Australian A-League'], 'verified',
    {
      fixtureCoverage: 'observed-intermittently',
      resultCoverage: 'not-observed',
      visibleInCompetitionFilter: true,
      eligibleForHomePriority: false
    }),

  // UEFA stages resolve to their parent competition, never to a fake league.
  makeCompetition('uefa-champions-league', 'UEFA Champions League', 'Europe', 'continental', 1, 2,
    { sportsdb: '4480', bsd: '7', oddsApi: ['soccer_uefa_champs_league', 'soccer_uefa_champs_league_qualification'] },
    ['Champions League', 'UCL', 'UEFA Champions League Qualification',
      'UEFA Champions League Qualifying', 'Champions League Qualification',
      'Champions League Qualifying', 'UEFA Champions League First Qualifying Round',
      'UEFA Champions League Second Qualifying Round', 'UEFA Champions League Third Qualifying Round',
      'Champions League First Qualifying Round', 'Champions League Second Qualifying Round',
      'Champions League Third Qualifying Round', 'UEFA Champions League Play-offs',
      'UEFA Champions League Knockout Play-offs', 'UEFA Champions League League Phase',
      'UEFA Champions League Round of 16', 'UEFA Champions League Quarter-finals',
       'UEFA Champions League Semi-finals', 'UEFA Champions League Final'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('uefa-europa-league', 'UEFA Europa League', 'Europe', 'continental', 1, 2,
    { sportsdb: '4481', oddsApi: 'soccer_uefa_europa_league' },
    ['Europa League', 'UEFA Europa League Qualification', 'UEFA Europa League Qualifying',
      'Europa League Qualification', 'Europa League Qualifying',
      'UEFA Europa League First Qualifying Round', 'UEFA Europa League Second Qualifying Round',
      'UEFA Europa League Third Qualifying Round', 'Europa League First Qualifying Round',
      'Europa League Second Qualifying Round', 'Europa League Third Qualifying Round',
      'UEFA Europa League Play-offs',
      'UEFA Europa League Knockout Play-offs', 'UEFA Europa League League Phase',
      'UEFA Europa League Round of 16', 'UEFA Europa League Quarter-finals',
      'UEFA Europa League Semi-finals', 'UEFA Europa League Final']),
  makeCompetition('uefa-conference-league', 'UEFA Conference League', 'Europe', 'continental', 1, 2,
    { sportsdb: '5071', oddsApi: 'soccer_uefa_europa_conference_league' },
    ['Conference League', 'UEFA Europa Conference League', 'UEFA Conference League Qualification',
      'UEFA Conference League Qualifying', 'Conference League Qualification',
      'Conference League Qualifying', 'UEFA Conference League First Qualifying Round',
      'UEFA Conference League Second Qualifying Round', 'UEFA Conference League Third Qualifying Round',
      'Conference League First Qualifying Round', 'Conference League Second Qualifying Round',
      'Conference League Third Qualifying Round', 'UEFA Conference League Play-offs',
      'UEFA Conference League Knockout Play-offs', 'UEFA Conference League League Phase',
      'UEFA Conference League Round of 16', 'UEFA Conference League Quarter-finals',
      'UEFA Conference League Semi-finals', 'UEFA Conference League Final']),
  makeCompetition('uefa-super-cup', 'UEFA Super Cup', 'Europe', 'continental', 2, 5,
    { bsd: '90' }, ['European Super Cup', 'UEFA Supercup'],
    'verified', { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),

  // Major European domestic cups.
  makeCompetition('england-fa-cup', 'FA Cup', 'England', 'domestic-cup', 2, 5,
    { sportsdb: '4482', oddsApi: 'soccer_fa_cup' },
    ['English FA Cup', 'The FA Cup']),
  makeCompetition('england-efl-cup', 'EFL Cup', 'England', 'domestic-cup', 2, 5,
    { sportsdb: '4570', oddsApi: 'soccer_england_efl_cup' },
    ['League Cup', 'English League Cup', 'Carabao Cup']),
  makeCompetition('spain-copa-del-rey', 'Copa del Rey', 'Spain', 'domestic-cup', 2, 5,
    { sportsdb: '4483', bsd: '41', oddsApi: 'soccer_spain_copa_del_rey' },
    ['Spanish Copa del Rey']),
  makeCompetition('italy-coppa-italia', 'Coppa Italia', 'Italy', 'domestic-cup', 2, 5,
    { sportsdb: '4506', oddsApi: 'soccer_italy_coppa_italia' },
    ['Italian Coppa Italia']),
  makeCompetition('germany-dfb-pokal', 'DFB-Pokal', 'Germany', 'domestic-cup', 2, 5,
    { sportsdb: '4485', oddsApi: 'soccer_germany_dfb_pokal' },
    ['DFB Pokal', 'German DFB-Pokal']),
  makeCompetition('france-coupe-de-france', 'Coupe de France', 'France', 'domestic-cup', 2, 5,
    { sportsdb: '4484', oddsApi: 'soccer_france_coupe_de_france' },
    ['French Coupe de France']),
  makeCompetition('turkey-turkish-cup', 'Türkiye Kupası', 'Turkey', 'domestic-cup', 2, 5,
    { sportsdb: '4960' },
    ['Turkish Cup', 'Turkiye Kupasi', 'Turkey Cup']),
  makeCompetition('portugal-taca-de-portugal', 'Taça de Portugal', 'Portugal', 'domestic-cup', 2, 5,
    { sportsdb: '4510', bsd: '92' },
    ['Taca de Portugal', 'Portuguese Cup', 'Taça de Portugal']),
  makeCompetition('netherlands-knvb-beker', 'KNVB Beker', 'Netherlands', 'domestic-cup', 2, 5,
    { sportsdb: '4902' },
    ['Dutch KNVB Cup', 'KNVB Cup']),
  makeCompetition('belgium-cup', 'Belgian Cup', 'Belgium', 'domestic-cup', 2, 5,
    { sportsdb: '5831' }, ['Croky Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('greece-cup', 'Greek Cup', 'Greece', 'domestic-cup', 2, 5,
    { sportsdb: '5830' }, ['Greece Cup', 'Greek Football Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('scotland-cup', 'Scottish Cup', 'Scotland', 'domestic-cup', 2, 5,
    { sportsdb: '4723' }, ['Scottish FA Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('switzerland-cup', 'Swiss Cup', 'Switzerland', 'domestic-cup', 2, 5,
    { sportsdb: '5489' }, ['Schweizer Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('austria-cup', 'Austrian Cup', 'Austria', 'domestic-cup', 2, 5,
    { sportsdb: '5883' }, ['ÖFB-Cup', 'OFB Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  pending('denmark-cup', 'Danish Cup', 'Denmark', 'domestic-cup', 5,
    ['Danish Cup', 'DBU Pokalen']),
  makeCompetition('norway-cup', 'Norwegian Cup', 'Norway', 'domestic-cup', 2, 5,
    { sportsdb: '5634' }, ['NM Cup', 'Norwegian Cupen'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('sweden-cup', 'Svenska Cupen', 'Sweden', 'domestic-cup', 2, 5,
    { sportsdb: '4756' }, ['Swedish Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('poland-cup', 'Polish Cup', 'Poland', 'domestic-cup', 2, 5,
    { sportsdb: '5838', bsd: '46' }, ['Puchar Polski'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  pending('czechia-cup', 'Czech Cup', 'Czechia', 'domestic-cup', 5,
    ['Czech Republic Cup', 'MOL Cup']),
  pending('romania-cup', 'Romanian Cup', 'Romania', 'domestic-cup', 5,
    ['Romanian Cup', 'Cupa României', 'Cupa Romaniei']),
  pending('croatia-cup', 'Croatian Cup', 'Croatia', 'domestic-cup', 5,
    ['Croatian Cup', 'Croatian Football Cup']),
  pending('serbia-cup', 'Serbian Cup', 'Serbia', 'domestic-cup', 5,
    ['Serbian Cup', 'Serbia Cup']),
  pending('ukraine-cup', 'Ukrainian Cup', 'Ukraine', 'domestic-cup', 5,
    ['Ukrainian Cup', 'Ukraine Cup']),
  makeCompetition('russia-cup', 'Russian Cup', 'Russia', 'domestic-cup', 2, 5,
    { sportsdb: '5193' }, ['Russian Football Cup'],
    'verified', { fixtureCoverage: 'not-observed' }),

  // America / Asia / Oceania cups and continental competitions.
  makeCompetition('usa-us-open-cup', 'US Open Cup', 'United States', 'domestic-cup', 2, 5,
    { sportsdb: '5199' }, ['Lamar Hunt U.S. Open Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  pending('usa-leagues-cup', 'Leagues Cup', 'United States', 'domestic-cup', 5,
    ['MLS Leagues Cup']),
  pending('usa-mls-playoffs', 'MLS Playoffs / MLS Cup', 'United States', 'domestic-cup', 5,
    ['MLS Cup', 'MLS Playoffs']),
  makeCompetition('japan-emperors-cup', "Japan Emperor's Cup", 'Japan', 'domestic-cup', 2, 5,
    { sportsdb: '5637', bsd: '51' },
    ["Emperor's Cup", 'Japanese Emperor Cup', 'Japan Emperors Cup', 'Emperors Cup', 'Emperor Cup'],
    'verified', { fixtureCoverage: 'fixture-producing', resultCoverage: 'result-producing' }),
  pending('japan-j-league-cup', 'Japan J.League Cup', 'Japan', 'domestic-cup', 5,
    ['J.League Cup', 'J League Cup', 'YBC Levain Cup']),
  makeCompetition('south-korea-korea-cup', 'South Korea Korea Cup', 'South Korea', 'domestic-cup', 2, 5,
    { sportsdb: '5635' }, ['Korea Cup', 'Korean FA Cup'],
    'verified', { fixtureCoverage: 'not-observed' }),
  makeCompetition('china-fa-cup', 'China Chinese FA Cup', 'China', 'domestic-cup', 2, 5,
    { sportsdb: '5525' }, ['Chinese FA Cup', 'China FA Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  makeCompetition('australia-cup', 'Australia Cup', 'Australia', 'domestic-cup', 2, 5,
    { sportsdb: '5180' }, ['Australian Cup', 'FFA Cup'],
    'verified', { fixtureCoverage: 'fixture-producing' }),
  pending('afc-champions-league-elite', 'AFC Champions League Elite', 'Asia', 'continental', 5,
    ['AFC Champions League', 'AFC Champions League Elite']),
  pending('afc-champions-league-two', 'AFC Champions League Two', 'Asia', 'continental', 5,
    ['AFC Champions League 2', 'AFC Champions League Two']),

  // Existing competitions outside the new master list remain resolvable so
  // current fixtures are neither hidden nor split into duplicate headers.
  makeCompetition('uefa-nations-league', 'UEFA Nations League', 'Europe', 'continental', 2, 99,
    { sportsdb: '4490', bsd: '64', oddsApi: 'soccer_uefa_nations_league' },
    ['UEFA Nations League', 'Nations League', 'soccer_uefa_nations_league'],
    'verified', { visibleInCompetitionFilter: false, eligibleForHomePriority: false }),
  makeCompetition('concacaf-nations-league', 'CONCACAF Nations League', 'North America', 'continental', 2, 99,
    { bsd: '65' }, ['CONCACAF Nations League'],
    'verified', { visibleInCompetitionFilter: false, eligibleForHomePriority: false }),
  makeCompetition('mexico-liga-mx', 'Mexico Liga MX', 'Mexico', 'league', 2, 99,
    { sportsdb: '4350', bsd: '19' },
    ['Liga MX', 'Liga MX Apertura', 'Mexican Primera League'],
    'verified', { visibleInCompetitionFilter: false, eligibleForHomePriority: false })
]);

const BY_KEY = new Map(COMPETITIONS.map(item => [item.canonicalCompetitionKey, item]));
const BY_ALIAS = new Map();
const BY_PROVIDER_ID = new Map();

function normalizeCompetitionName(value) {
  let key = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  for (const prefix of ['soccer', 'football', 'sportsmonks', 'apifootball']) {
    if (key.startsWith(prefix) && key.length > prefix.length) {
      key = key.slice(prefix.length);
      break;
    }
  }
  return key;
}

function providerKind(value) {
  const key = normalizeCompetitionName(value);
  if (!key) return null;
  if (key.includes('sportmonks')) return 'sportmonks';
  if (key === 'bsd' || key.includes('bzzoiro')) return 'bsd';
  if (key.includes('oddsapi') || key.includes('theoddsapievents')) return 'oddsApi';
  if (key.includes('sportsdb') || key.includes('thesportsdb')) return 'sportsdb';
  return null;
}

function idValues(value) {
  return (Array.isArray(value) ? value : [value])
    .filter(item => item != null && String(item).trim() !== '')
    .map(String);
}

for (const competition of COMPETITIONS) {
  for (const alias of competition.aliases) {
    const key = normalizeCompetitionName(alias);
    if (key && !BY_ALIAS.has(key)) BY_ALIAS.set(key, competition);
  }
  for (const [provider, value] of Object.entries(competition.providerIds)) {
    for (const id of idValues(value)) {
      const mapKey = `${provider}:${id}`;
      if (!BY_PROVIDER_ID.has(mapKey)) BY_PROVIDER_ID.set(mapKey, competition);
    }
  }
}

function resolveCompetition({
  canonicalCompetitionKey,
  provider,
  canonicalProvider,
  source,
  dataSource,
  leagueId,
  competitionId,
  sportKey,
  leagueName,
  league,
  displayName,
  providerIds
} = {}) {
  if (canonicalCompetitionKey && BY_KEY.has(String(canonicalCompetitionKey))) {
    return BY_KEY.get(String(canonicalCompetitionKey));
  }

  const providerName = provider || canonicalProvider || source || dataSource;
  const kind = providerKind(providerName);
  if (kind) {
    const id = sportKey ?? leagueId ?? competitionId ?? providerIds?.[kind];
    if (id != null) {
      const found = BY_PROVIDER_ID.get(`${kind}:${String(id)}`);
      if (found) return found;
    }
  }

  const name = leagueName || league || displayName;
  return BY_ALIAS.get(normalizeCompetitionName(name)) || null;
}

function decorateMatch(match, provider) {
  if (!match || typeof match !== 'object') return match;
  const competition = resolveCompetition({
    provider,
    canonicalProvider: match.canonicalProvider,
    source: match.source,
    dataSource: match.dataSource,
    leagueId: match.leagueId,
    competitionId: match.competitionId,
    sportKey: match.sportKey,
    leagueName: match.leagueName || match.league,
    displayName: match.displayName,
    providerIds: match.providerIds
  });
  const rawName = String(match.displayName || match.leagueName || match.league || '').trim();
  const fallbackKey = normalizeCompetitionName(rawName);
  return {
    ...match,
    canonicalCompetitionKey: competition?.canonicalCompetitionKey ||
      (fallbackKey ? `unmapped:${fallbackKey}` : null),
    displayName: competition?.displayName || rawName,
    competitionCountry: competition?.country || match.competitionCountry || match.leagueCountry || null,
    competitionType: competition?.type || match.competitionType || null,
    competitionPriority: competition?.priority ?? match.competitionPriority ?? 99,
    homePageRank: competition?.homePageRank ?? match.homePageRank ?? 99,
    competitionActive: competition?.active ?? false,
    competitionConfigured: competition?.configured ?? false,
    mappingStatus: competition?.mappingStatus || 'unverified',
    fixtureCoverage: competition?.fixtureCoverage || 'unverified',
    resultCoverage: competition?.resultCoverage || 'unverified',
    visibleInCompetitionFilter: competition?.visibleInCompetitionFilter ?? false,
    eligibleForHomePriority: competition?.eligibleForHomePriority ?? false
  };
}

function normalizeTeamIdentity(value) {
  let key = String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(?:c|u|a|s|f|p)\.\s*(?:d|e|c|f|s|a|t)\.?\b/g, ' ')
    .replace(/\b(fc|cf|sc|afc|fk|sk|cd|ud|cp|ad|sd|ue|ae|ca|ft|calcio|football|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  const aliases = {
    republicofireland: 'ireland',
    nireland: 'northernireland',
    ublebrijana: 'lebrijana',
    '6dejunio': 'ceuta6dejunio',
    sportinghortaleza: 'sportingdehortaleza',
    tavernes: 'tavernesdelavalldigna',
    sanjosedesoria: 'sanjose'
  };
  return aliases[key] || key;
}

function sourceRank(match) {
  const provider = normalizeCompetitionName(match?.canonicalProvider || match?.source || match?.dataSource);
  if (provider.includes('sportmonks')) return 3;
  if (provider === 'bsd' || provider.includes('bzzoiro')) return 2;
  if (provider.includes('sportsdb')) return 1;
  return 0;
}

function mergeDuplicate(preferred, secondary) {
  const merged = { ...secondary, ...preferred };
  for (const field of [
    'homeScore', 'awayScore', 'halftimeHome', 'halftimeAway',
    'statusShort', 'minute', 'stage', 'stageName', 'roundLabel',
    'leagueCountry', 'homeTeamId', 'awayTeamId'
  ]) {
    if (merged[field] == null && secondary[field] != null) merged[field] = secondary[field];
  }
  merged.providerIds = {
    ...(secondary.providerIds || {}),
    ...(preferred.providerIds || {})
  };
  return merged;
}

function dedupeCompetitionFixtures(rows, options = {}) {
  const toleranceMs = options.toleranceMs || 15 * 60 * 1000;
  const kept = [];

  for (const raw of Array.isArray(rows) ? rows : []) {
    const match = raw;
    const home = normalizeTeamIdentity(match?.homeTeam);
    const away = normalizeTeamIdentity(match?.awayTeam);
    const teams = [home, away].filter(Boolean).sort();
    const competitionKey = match?.canonicalCompetitionKey ||
      decorateMatch(match, options.provider).canonicalCompetitionKey;
    const kickoffValue = match?.kickoff || match?.date;
    const kickoff = kickoffValue ? new Date(kickoffValue).getTime() : NaN;
    if (teams.length !== 2 || !competitionKey || !Number.isFinite(kickoff)) {
      kept.push(match);
      continue;
    }

    const duplicateIndex = kept.findIndex(existing => {
      const existingTeams = [
        normalizeTeamIdentity(existing?.homeTeam),
        normalizeTeamIdentity(existing?.awayTeam)
      ].filter(Boolean).sort();
      if (existingTeams.length !== 2 || existingTeams.join('|') !== teams.join('|')) return false;
      const existingCompetition = existing?.canonicalCompetitionKey ||
        decorateMatch(existing, options.provider).canonicalCompetitionKey;
      if (existingCompetition !== competitionKey) return false;
      const existingKickoffValue = existing?.kickoff || existing?.date;
      const existingKickoff = existingKickoffValue ? new Date(existingKickoffValue).getTime() : NaN;
      return Number.isFinite(existingKickoff) && Math.abs(existingKickoff - kickoff) <= toleranceMs;
    });

    if (duplicateIndex < 0) {
      kept.push(match);
      continue;
    }

    const previous = kept[duplicateIndex];
    const preferNew = sourceRank(match) > sourceRank(previous);
    kept[duplicateIndex] = preferNew
      ? mergeDuplicate(match, previous)
      : mergeDuplicate(previous, match);
  }

  return kept;
}

function getCompetitionRegistry({ includeInactive = true } = {}) {
  return includeInactive
    ? [...COMPETITIONS]
    : COMPETITIONS.filter(item => item.active);
}

function assertPrimaryMappingsUnchanged() {
  const byKey = new Map(COMPETITIONS.map(item => [item.canonicalCompetitionKey, item]));
  const keys = {
    'premier-league': 'england-premier-league',
    'la-liga': 'spain-la-liga',
    'serie-a': 'italy-serie-a',
    'bundesliga': 'germany-bundesliga',
    'ligue-1': 'france-ligue-1',
    'turkish-super-lig': 'turkey-super-lig'
  };
  const namedMappingsMatch = sourcePolicy.SPORTMONKS_PRIMARY.every(primary => {
    const competition = byKey.get(keys[primary.key]);
    return !!competition && competition.providerIds.sportmonks === primary.sportmonksId;
  });
  const expectedIds = sourcePolicy.SPORTMONKS_PRIMARY.map(item => String(item.sportmonksId)).sort();
  const registryIds = COMPETITIONS
    .map(item => item.providerIds.sportmonks)
    .filter(value => value != null)
    .map(String)
    .sort();
  return namedMappingsMatch && JSON.stringify(registryIds) === JSON.stringify(expectedIds);
}

module.exports = {
  COMPETITIONS,
  getCompetitionRegistry,
  normalizeCompetitionName,
  normalizeTeamIdentity,
  providerKind,
  resolveCompetition,
  decorateMatch,
  dedupeCompetitionFixtures,
  assertPrimaryMappingsUnchanged
};