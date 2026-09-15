const cache = require('../utils/cache');
const config = require('../config/config');
const footballApi = require('./footballApiService');
const oddsApi = require('./oddsApiService');
const poisson = require('./poissonService');
const stats = require('./statsService');
const motivation = require('./motivationService');
const tffScraper = require('./tffScraper');

const LEAGUE_AVG_HOME_GOALS = 1.45;
const LEAGUE_AVG_AWAY_GOALS = 1.15;
const LEAGUE_ADVANTAGE_RATIO = LEAGUE_AVG_HOME_GOALS / LEAGUE_AVG_AWAY_GOALS;

// FotMob/free-api-live-football-data semasinda Trendyol Süper Lig'in ID'si.
// API-Football (footballApiService) askiya alindigi icin bu lig icin
// form verisi TFF.org scraper'indan (tffScraper) cekiliyor.
const SUPERLIG_LEAGUE_ID = '71';

/**
 * Tam analiz hesaplama motoru. Hem /api/analysis route'u (anlik istekte)
 * hem de precomputeJob.js (gunde 2 kez onden hesaplama) BU FONKSIYONU
 * cagirir - boylece iki yol da ayni gelismis modeli kullanir, biri
 * eski/basit bir hesapla kalmaz.
 */
async function computeFullAnalysis({ fixtureId, home, away, homeTeamName, awayTeamName, league, season, sportKey }) {
  const isSuperLig = String(league) === SUPERLIG_LEAGUE_ID;

  const homeFormFetcher = isSuperLig
    ? () => tffScraper.getTeamFixturesForAnalysis(homeTeamName, 15)
    : () => footballApi.getTeamForm(home, 15);
  const awayFormFetcher = isSuperLig
    ? () => tffScraper.getTeamFixturesForAnalysis(awayTeamName, 15)
    : () => footballApi.getTeamForm(away, 15);
  const homeFormCacheKey = isSuperLig ? `tff-form:${homeTeamName}` : `form:${home}`;
  const awayFormCacheKey = isSuperLig ? `tff-form:${awayTeamName}` : `form:${away}`;

  const [h2hResult, oddsResult, injuriesResult, homeFixturesResult, awayFixturesResult, standingsResult] =
    await Promise.allSettled([
      cache.getOrFetch(`h2h:${fixtureId}`, config.cache.ttlStatic, () =>
        footballApi.getH2H(home, away)
      ),
      cache.getOrFetch(`odds:${sportKey || 'soccer_epl'}`, config.cache.ttlStatic, () =>
        oddsApi.getOddsForLeague(sportKey || 'soccer_epl')
      ),
      cache.getOrFetch(`injuries:${fixtureId}`, config.cache.ttlStatic, () =>
        footballApi.getInjuries(fixtureId)
      ),
      cache.getOrFetch(homeFormCacheKey, config.cache.ttlStatic, homeFormFetcher),
      cache.getOrFetch(awayFormCacheKey, config.cache.ttlStatic, awayFormFetcher),
      league && season
        ? cache.getOrFetch(`standings:${league}:${season}`, config.cache.ttlStatic, () =>
            footballApi.getStandings(league, season)
          )
        : Promise.resolve({ ok: false }),
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
  const homeTeamFullSplit = stats.splitHomeAwayForm(homeFixtures, home, 5);
  const awayTeamFullSplit = stats.splitHomeAwayForm(awayFixtures, away, 5);
  const homeAwaySplit = {
    home: homeTeamFullSplit.home,
    away: awayTeamFullSplit.away,
  };

  let motivationHome = { label: 'Bilinmiyor', multiplier: 1.0 };
  let motivationAway = { label: 'Bilinmiyor', multiplier: 1.0 };
  if (standingsResult.status === 'fulfilled' && standingsResult.value.ok) {
    const standingsData = standingsResult.value.data;
    const homeRow = motivation.findTeamStanding(standingsData, home);
    const awayRow = motivation.findTeamStanding(standingsData, away);
    motivationHome = motivation.calculateMotivationFromDescription(homeRow?.description);
    motivationAway = motivation.calculateMotivationFromDescription(awayRow?.description);
  }

  const homeRestDays = stats.calculateRestDays(homeFixtures, home);
  const awayRestDays = stats.calculateRestDays(awayFixtures, away);
  const homeFatigue = stats.calculateFatigueMultiplier(homeRestDays);
  const awayFatigue = stats.calculateFatigueMultiplier(awayRestDays);

  const homeStreak = stats.calculateStreak(homeFixtures, home);
  const awayStreak = stats.calculateStreak(awayFixtures, away);
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

  const homeLambdaBase = poisson.calculateExpectedGoals(homeAttack, awayDefenseWeak, LEAGUE_AVG_HOME_GOALS, 1);
  const awayLambdaBase = poisson.calculateExpectedGoals(awayAttack, homeDefenseWeak, LEAGUE_AVG_AWAY_GOALS, 1);
  const homeLambda = +(homeLambdaBase * motivationHome.multiplier).toFixed(2);
  const awayLambda = +(awayLambdaBase * motivationAway.multiplier).toFixed(2);

  const matchProbabilities = poisson.calculateMatchProbabilities(homeLambda, awayLambda);
  const marketProbabilities = poisson.calculateMarketProbabilities(homeLambda, awayLambda);
  const cornerMetrics = poisson.estimateCornerMetrics(homeLambda, awayLambda);

  const oddsRaw = oddsResult.status === 'fulfilled' && oddsResult.value.ok
    ? oddsResult.value.data
    : null;
  const matchOdds = (oddsRaw && homeTeamName && awayTeamName)
    ? oddsApi.extractMatchOdds(oddsRaw, homeTeamName, awayTeamName)
    : null;
  const marketImpliedProbabilities = oddsApi.normalizeImpliedProbabilities(matchOdds);
  const blendedMatchProbabilities = oddsApi.blendWithMarket(matchProbabilities, marketImpliedProbabilities, 0.5);

  const homeFirstHalf = stats.calculateFirstHalfTendency(homeFixtures, home);
  const awayFirstHalf = stats.calculateFirstHalfTendency(awayFixtures, away);
  const h2hFixturesRaw = h2hResult.status === 'fulfilled' && h2hResult.value.ok
    ? h2hResult.value.data?.response || []
    : [];
  const h2hFirstHalf = stats.calculateH2HFirstHalfTendency(h2hFixturesRaw, home, away);
  const firstHalfProximity = stats.combineFirstHalfProximity(
    homeFirstHalf.firstHalfScoringRate,
    awayFirstHalf.firstHalfScoringRate,
    h2hFirstHalf
  );

  const successCount = [h2hResult, oddsResult, injuriesResult, homeFixturesResult, awayFixturesResult].filter(
    r => r.status === 'fulfilled' && r.value.ok !== false
  ).length;
  const dataQualityScore = poisson.calculateDataQualityScore(successCount, 5, 0);

  const strongestSignal = poisson.findStrongestSignal([
    { label: '2.5 Ust Gol', probability: marketProbabilities.over25GoalsPercent },
    { label: 'KG Var', probability: marketProbabilities.bttsPercent },
  ]);

  return {
    fixtureId,
    homeLambda,
    awayLambda,
    matchProbabilities: blendedMatchProbabilities,
    modelOnlyProbabilities: matchProbabilities,
    marketImpliedProbabilities,
    marketProbabilities,
    cornerMetrics,
    firstHalfProximity,
    dataQualityScore,
    strongestSignal,
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
    h2h: h2hResult.status === 'fulfilled' ? h2hResult.value : null,
    odds: oddsResult.status === 'ful
