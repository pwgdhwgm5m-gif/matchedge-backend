const cache = require('../utils/cache');
const config = require('../config/config');
const footballApi = require('./footballApiService');
const oddsApi = require('./oddsApiService');
const poisson = require('./poissonService');
const stats = require('./statsService');
const motivation = require('./motivationService');
const tffScraper = require('./tffScraper');
const sportsDb = require('./sportsDbService');
const premiumIntelligence = require('./premiumIntelligenceService');
const modelCalibration = require('./modelCalibrationService');
const accuracy = require('./accuracyEngineService');

const LEAGUE_AVG_HOME_GOALS = 1.45;
const LEAGUE_AVG_AWAY_GOALS = 1.15;
const LEAGUE_ADVANTAGE_RATIO = LEAGUE_AVG_HOME_GOALS / LEAGUE_AVG_AWAY_GOALS;

const SUPERLIG_LEAGUE_ID = '71';

async function computeFullAnalysis({ fixtureId, home, away, homeTeamName, awayTeamName, league, leagueName, season, sportKey }) {
  const isSuperLig = String(league) === SUPERLIG_LEAGUE_ID;
  const leagueIdNum = league ? parseInt(league, 10) : null;
  const isMappedLeague = leagueIdNum && !!sportsDb.LEAGUE_ID_MAP[String(leagueIdNum)];
  const useOwnSource = isSuperLig || isMappedLeague;

  // API-Football (footballApiService) askida oldugu icin form verisi:
  // - Süper Lig -> TFF.org scraper
  // - Eslesmesi bilinen diger ligler -> TheSportsDB (Premium)
  // - Eslesmesi olmayan ligler -> eskisi gibi API-Football denenir (suspended
  //   oldugu icin muhtemelen bos doner, sistem yine de cokme, notr deger uretir)
  const homeFormFetcher = isSuperLig
    ? () => tffScraper.getTeamFixturesForAnalysis(homeTeamName, 15)
    : isMappedLeague
      ? () => sportsDb.getTeamFixturesForAnalysis(homeTeamName, leagueIdNum, 15)
      : () => footballApi.getTeamForm(home, 15);
  const awayFormFetcher = isSuperLig
    ? () => tffScraper.getTeamFixturesForAnalysis(awayTeamName, 15)
    : isMappedLeague
      ? () => sportsDb.getTeamFixturesForAnalysis(awayTeamName, leagueIdNum, 15)
      : () => footballApi.getTeamForm(away, 15);
  const homeFormCacheKey = isSuperLig
    ? `tff-form:${homeTeamName}`
    : isMappedLeague
      ? `tsdb-form:${leagueIdNum}:${homeTeamName}`
      : `form:${home}`;
  const awayFormCacheKey = isSuperLig
    ? `tff-form:${awayTeamName}`
    : isMappedLeague
      ? `tsdb-form:${leagueIdNum}:${awayTeamName}`
      : `form:${away}`;

  // H2H artik ayri bir API cagrisi degil - Süper Lig/eslesen liglerde zaten
  // cekilen "son N mac" form verisinden turetiliyor (asagida, fixture'lar
  // cozuldukten sonra). API-Football'un h2h endpoint'i askida/kota dolu
  // oldugu icin sadece eslesmeyen ligler icin fallback olarak kaliyor.
  const useDerivedH2H = isSuperLig || isMappedLeague;

  // Puan durumu (motivasyon icin): Süper Lig -> TFF scraper, eslesen
  // ligler -> TheSportsDB lookuptable.php, digerleri -> eski API-Football
  // yolu (kota dolu oldugu icin muhtemelen bos doner, notr deger uretir).
  const currentSeason = sportsDb.getCurrentSeasonString();
  const standingsFetcher = isSuperLig
    ? () => tffScraper.getStandings().then(table => ({
        ok: true,
        available: table.length > 0,
        table: table.map(r => ({ teamId: r.kulupID, teamName: r.name, rank: r.rank, points: r.points, description: null })),
      }))
    : isMappedLeague
      ? () => sportsDb.getLeagueStandingsFormatted(sportsDb.LEAGUE_ID_MAP[String(leagueIdNum)], currentSeason)
      : () => (league && season ? footballApi.getStandings(league, season) : Promise.resolve({ ok: false }));
  const standingsCacheKey = isSuperLig
    ? 'tff-standings'
    : isMappedLeague
      ? `tsdb-standings:${leagueIdNum}:${currentSeason}`
      : `standings:${league}:${season}`;

  const [h2hResult, oddsResult, injuriesResult, homeFixturesResult, awayFixturesResult, standingsResult] =
    await Promise.allSettled([
      useDerivedH2H
        ? Promise.resolve({ ok: true, skipped: true })
        : cache.getOrFetch(`h2h:${fixtureId}`, config.cache.ttlStatic, () =>
            footballApi.getH2H(home, away)
          ),
      config.oddsApi.key
        ? cache.getOrFetch(`odds:${sportKey || 'soccer_epl'}`, config.cache.ttlStatic, () => oddsApi.getOddsForLeague(sportKey || 'soccer_epl'))
        : Promise.resolve({ok:false,error:'odds_disabled'}),
      config.apiFootball.sources.length && !useOwnSource
        ? cache.getOrFetch(`injuries:${fixtureId}`, config.cache.ttlStatic, () => footballApi.getInjuries(fixtureId))
        : Promise.resolve({ok:false,error:'injuries_unavailable'}),
      cache.getOrFetch(homeFormCacheKey, config.cache.ttlStatic, homeFormFetcher),
      cache.getOrFetch(awayFormCacheKey, config.cache.ttlStatic, awayFormFetcher),
      cache.getOrFetch(standingsCacheKey, config.cache.ttlStatic, standingsFetcher),
    ]);

  const injuriesRaw = injuriesResult.status === 'fulfilled' && injuriesResult.value.ok
    ? injuriesResult.value.data?.response || []
    : [];
  const formatInjuries = (list) => list.map(item => ({
    player: item.player?.name,
    reason: item.player?.reason,
    teamId: item.team?.id,
  }));
  const allInjuries = formatInjuries(injuriesRaw);
  const injuries = {
    home: allInjuries.filter(p => String(p.teamId) === String(home)),
    away: allInjuries.filter(p => String(p.teamId) === String(away)),
  };

  const homeFixtures = homeFixturesResult.status === 'fulfilled' && homeFixturesResult.value.ok
    ? homeFixturesResult.value.data?.response || []
    : [];
  const awayFixtures = awayFixturesResult.status === 'fulfilled' && awayFixturesResult.value.ok
    ? awayFixturesResult.value.data?.response || []
    : [];

  const homeTeamIdForStats = useOwnSource && homeFixturesResult.status === 'fulfilled' && homeFixturesResult.value.teamId
    ? homeFixturesResult.value.teamId
    : home;
  const awayTeamIdForStats = useOwnSource && awayFixturesResult.status === 'fulfilled' && awayFixturesResult.value.teamId
    ? awayFixturesResult.value.teamId
    : away;

  const homeTeamFullSplit = stats.splitHomeAwayForm(homeFixtures, homeTeamIdForStats, 5);
  const awayTeamFullSplit = stats.splitHomeAwayForm(awayFixtures, awayTeamIdForStats, 5);
  const homeAwaySplit = {
    home: homeTeamFullSplit.home,
    away: awayTeamFullSplit.away,
  };

  let motivationHome = { label: 'Orta Sıra - Nötr', multiplier: 1.0 };
  let motivationAway = { label: 'Orta Sıra - Nötr', multiplier: 1.0 };
  // Ekranda gosterilecek ham puan durumu tablosu - sadece kendi kaynagimizdan
  // (TFF/TheSportsDB) gelen normallestirilmis tablo icin dolduruluyor; eski
  // API-Football yolu (askida) icin bos birakiliyor.
  let standingsTable = [];
  if (standingsResult.status === 'fulfilled' && standingsResult.value.ok) {
    const sv = standingsResult.value;
    if (isSuperLig || isMappedLeague) {
      const table = sv.table || [];
      standingsTable = table;
      const homeRow = motivation.findTeamStanding(table, homeTeamIdForStats);
      const awayRow = motivation.findTeamStanding(table, awayTeamIdForStats);
      if (homeRow) {
        motivationHome = homeRow.description
          ? motivation.calculateMotivationFromDescription(homeRow.description)
          : motivation.calculateMotivationFromRank(homeRow.rank, table.length);
      }
      if (awayRow) {
        motivationAway = awayRow.description
          ? motivation.calculateMotivationFromDescription(awayRow.description)
          : motivation.calculateMotivationFromRank(awayRow.rank, table.length);
      }
    } else if (sv.data) {
      const homeRow = motivation.findTeamStandingLegacy(sv.data, home);
      const awayRow = motivation.findTeamStandingLegacy(sv.data, away);
      motivationHome = motivation.calculateMotivationFromDescription(homeRow?.description);
      motivationAway = motivation.calculateMotivationFromDescription(awayRow?.description);
    }
  }

  const homeRestDays = isSuperLig ? null : stats.calculateRestDays(homeFixtures, homeTeamIdForStats);
  const awayRestDays = isSuperLig ? null : stats.calculateRestDays(awayFixtures, awayTeamIdForStats);
  const homeFatigue = stats.calculateFatigueMultiplier(homeRestDays);
  const awayFatigue = stats.calculateFatigueMultiplier(awayRestDays);

  const homeStreak = stats.calculateStreak(homeFixtures, homeTeamIdForStats);
  const awayStreak = stats.calculateStreak(awayFixtures, awayTeamIdForStats);
  const homeStreakMult = stats.streakMultiplier(homeStreak);
  const awayStreakMult = stats.streakMultiplier(awayStreak);

  const homeInjuryImpact = stats.calculateInjuryImpact(injuries.home.length);
  const awayInjuryImpact = stats.calculateInjuryImpact(injuries.away.length);

  const homeAdvantageMultiplier = stats.calculateTeamHomeAdvantageMultiplier(homeTeamFullSplit, LEAGUE_ADVANTAGE_RATIO);

  const homeForm = homeAwaySplit.home;
  const awayForm = homeAwaySplit.away;

  const homeAttackBase = homeForm.played > 0 ? homeForm.avgGoalsFor / LEAGUE_AVG_HOME_GOALS : 1.0;
  const homeDefenseWeakBase = homeForm.played > 0 ? homeForm.avgGoalsAgainst / LEAGUE_AVG_AWAY_GOALS : 1.0;
  const awayAttackBase = awayForm.played > 0 ? awayForm.avgGoalsFor / LEAGUE_AVG_AWAY_GOALS : 1.0;
  const awayDefenseWeakBase = awayForm.played > 0 ? awayForm.avgGoalsAgainst / LEAGUE_AVG_HOME_GOALS : 1.0;

  const homeAttack = homeAttackBase * homeInjuryImpact.attackMultiplier * homeFatigue * homeStreakMult * homeAdvantageMultiplier;
  const homeDefenseWeak = homeDefenseWeakBase * homeInjuryImpact.defenseWeaknessMultiplier;
  const awayAttack = awayAttackBase * awayInjuryImpact.attackMultiplier * awayFatigue * awayStreakMult;
  const awayDefenseWeak = awayDefenseWeakBase * awayInjuryImpact.defenseWeaknessMultiplier;

  const tsdbLeagueId = isSuperLig ? 4339 : (isMappedLeague ? sportsDb.LEAGUE_ID_MAP[String(leagueIdNum)] : null);
  const leagueBase = tsdbLeagueId ? await accuracy.leagueBaselines(tsdbLeagueId, currentSeason) : null;
  const leagueHomeGoals = leagueBase?.homeGoals || LEAGUE_AVG_HOME_GOALS;
  const leagueAwayGoals = leagueBase?.awayGoals || LEAGUE_AVG_AWAY_GOALS;

  const homeLambdaBase = poisson.calculateExpectedGoals(homeAttack, awayDefenseWeak, leagueHomeGoals, 1);
  const awayLambdaBase = poisson.calculateExpectedGoals(awayAttack, homeDefenseWeak, leagueAwayGoals, 1);
  let homeLambda = +(homeLambdaBase * motivationHome.multiplier).toFixed(2);
  let awayLambda = +(awayLambdaBase * motivationAway.multiplier).toFixed(2);

  // Premium TheSportsDB event stats: blend real historical xG into pre-match lambdas.
  // Falls back to the goal model whenever xG coverage/sample is insufficient.
  let advancedHomeFixtures = homeFixtures, advancedAwayFixtures = awayFixtures;
  let advancedHomeId = homeTeamIdForStats, advancedAwayId = awayTeamIdForStats;
  // Super Lig form is TFF-backed, whose event IDs are not TheSportsDB IDs.
  // Resolve a TSDB copy only for premium event-stat lookups so IDs can never cross sources.
  if (isSuperLig) {
    const [th, ta] = await Promise.all([
      sportsDb.getTeamFixturesForAnalysis(homeTeamName, 71, 10),
      sportsDb.getTeamFixturesForAnalysis(awayTeamName, 71, 10),
    ]);
    if (th?.ok) { advancedHomeFixtures = th.data?.response || []; advancedHomeId = th.teamId; }
    if (ta?.ok) { advancedAwayFixtures = ta.data?.response || []; advancedAwayId = ta.teamId; }
  }
  const [homeAdvanced, awayAdvanced] = await Promise.all([
    accuracy.teamAdvancedForm(advancedHomeFixtures, advancedHomeId, 8),
    accuracy.teamAdvancedForm(advancedAwayFixtures, advancedAwayId, 8),
  ]);
  homeLambda = accuracy.blendLambda(homeLambda, homeAdvanced, awayAdvanced, leagueHomeGoals);
  awayLambda = accuracy.blendLambda(awayLambda, awayAdvanced, homeAdvanced, leagueAwayGoals);

  const rawMatchProbabilities = poisson.calculateMatchProbabilities(homeLambda, awayLambda);
  const rawMarketProbabilities = poisson.calculateMarketProbabilities(homeLambda, awayLambda);
  const calibrated = await modelCalibration.apply({league: leagueName || String(league || ''), match: rawMatchProbabilities, goals: rawMarketProbabilities});
  const matchProbabilities = calibrated.match;
  const marketProbabilities = calibrated.goals;
  const cornerProjection = accuracy.cornerProjection(homeAdvanced, awayAdvanced);
  const cornerMetrics = cornerProjection
    ? Object.assign(poisson.estimateCornerMetricsFromExpected(cornerProjection.homeExpected, cornerProjection.awayExpected), { sample: cornerProjection.sample })
    : Object.assign(poisson.estimateCornerMetrics(homeLambda, awayLambda), { source: 'goal-intensity-fallback' });
  const halfMarkets = poisson.calculateHalfMarkets(homeLambda, awayLambda);

  const oddsRaw = oddsResult.status === 'fulfilled' && oddsResult.value.ok
    ? oddsResult.value.data
    : null;
  const matchOdds = (oddsRaw && homeTeamName && awayTeamName)
    ? oddsApi.extractMatchOdds(oddsRaw, homeTeamName, awayTeamName)
    : null;
  const marketImpliedProbabilities = oddsApi.normalizeImpliedProbabilities(matchOdds);
  const blendedMatchProbabilities = oddsApi.blendWithMarket(matchProbabilities, marketImpliedProbabilities, 0.5);

  const homeFirstHalf = isSuperLig
    ? { firstHalfScoringRate: null }
    : stats.calculateFirstHalfTendency(homeFixtures, homeTeamIdForStats);
  const awayFirstHalf = isSuperLig
    ? { firstHalfScoringRate: null }
    : stats.calculateFirstHalfTendency(awayFixtures, awayTeamIdForStats);
  const derivedH2HFixtures = useDerivedH2H
    ? stats.deriveH2HFromFixtures(homeFixtures, awayFixtures, homeTeamIdForStats, awayTeamIdForStats)
    : [];
  const h2hFixturesRaw = useDerivedH2H
    ? derivedH2HFixtures
    : (h2hResult.status === 'fulfilled' && h2hResult.value.ok ? h2hResult.value.data?.response || [] : []);
  const h2hFirstHalf = stats.calculateH2HFirstHalfTendency(h2hFixturesRaw, homeTeamIdForStats, awayTeamIdForStats);
  const firstHalfProximity = stats.combineFirstHalfProximity(
    homeFirstHalf.firstHalfScoringRate,
    awayFirstHalf.firstHalfScoringRate,
    h2hFirstHalf
  );

  const h2hSucceeded = useDerivedH2H
    ? h2hFixturesRaw.length > 0
    : (h2hResult.status === 'fulfilled' && h2hResult.value.ok);
  const successCount = [oddsResult, injuriesResult, homeFixturesResult, awayFixturesResult].filter(
    r => r.status === 'fulfilled' && r.value.ok !== false
  ).length + (h2hSucceeded ? 1 : 0);
  const dataQualityScore = poisson.calculateDataQualityScore(successCount, 5, 0);

  const premium = premiumIntelligence.buildPremiumIntelligence({
    modelProbabilities: matchProbabilities,
    marketProbabilities: marketImpliedProbabilities,
    matchOdds,
    homePlayed: homeForm.played,
    awayPlayed: awayForm.played,
    hasStandings: standingsTable.length > 0,
    injuriesAvailable: injuriesResult.status === 'fulfilled' && injuriesResult.value.ok === true,
    h2hCount: h2hFixturesRaw.length,
    homeLambda,
    awayLambda,
    homeForm,
    awayForm,
  });

  const strongestSignal = poisson.findStrongestSignal([
    { label: '2.5 Ust Gol', probability: marketProbabilities.over25GoalsPercent },
    { label: 'KG Var', probability: marketProbabilities.bttsPercent },
  ]);
  const marketBoard = premiumIntelligence.buildMarketBoard({
    modelProbabilities: matchProbabilities,
    goalMarkets: marketProbabilities,
    cornerMetrics,
    advancedStats: { home: homeAdvanced, away: awayAdvanced, leagueBaseline: leagueBase },
    dataHealth: premium.dataHealth,
    premium,
    halfMarkets,
  });

  return {
    fixtureId,
    homeLambda,
    awayLambda,
    matchProbabilities: blendedMatchProbabilities,
    modelOnlyProbabilities: matchProbabilities,
    rawModelProbabilities: rawMatchProbabilities,
    rawMarketProbabilities,
    calibrationApplied: calibrated.applied,
    marketImpliedProbabilities,
    marketProbabilities,
    cornerMetrics,
    halfMarkets,
    firstHalfProximity,
    dataQualityScore,
    strongestSignal,
    marketBoard,
    premium,
    injuries,
    homeAwayForm: homeAwaySplit,
    motivation: { home: motivationHome, away: motivationAway },
    fatigue: {
      home: { restDays: homeRestDays, multiplier: homeFatigue },
      away: { restDays: awayRestDays, multiplier: awayFatigue },
    },
    streak: {
      home: homeStreak,
      away: awayStreak,
    },
    homeAdvantageMultiplier,
    standings: {
      table: standingsTable,
      homeTeamId: homeTeamIdForStats,
      awayTeamId: awayTeamIdForStats,
    },
    h2h: useDerivedH2H
      ? { ok: true, derived: true, data: { response: derivedH2HFixtures } }
      : (h2hResult.status === 'fulfilled' ? h2hResult.value : null),
    odds: oddsResult.status === 'fulfilled' ? oddsResult.value : null,
    dataSource: isSuperLig ? 'tff' : (isMappedLeague ? 'thesportsdb' : 'api-football'),
  };
}

module.exports = { computeFullAnalysis, LEAGUE_AVG_HOME_GOALS, LEAGUE_AVG_AWAY_GOALS };
