const EVIDENCE_LEVELS = Object.freeze([
  'INSUFFICIENT',
  'VERY_LOW',
  'LIMITED',
  'SUFFICIENT',
]);

function sampleCount(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function probabilityValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? +n.toFixed(1) : null;
}

function complementProbability(value) {
  const probability = probabilityValue(value);
  return probability === null ? null : +(100 - probability).toFixed(1);
}

function classifyEvidence(sample) {
  const n = sampleCount(sample);
  if (n <= 2) return 'INSUFFICIENT';
  if (n <= 4) return 'VERY_LOW';
  if (n <= 7) return 'LIMITED';
  return 'SUFFICIENT';
}

function createMarketEvidence({
  probability,
  effectiveSample = 0,
  evidenceSource = [],
  priorUsed = false,
  forceInsufficient = false,
}) {
  const n = sampleCount(effectiveSample);
  const evidenceLevel = forceInsufficient ? 'INSUFFICIENT' : classifyEvidence(n);
  return {
    probability: probabilityValue(probability),
    evidenceLevel,
    effectiveSample: n,
    evidenceSource: [...new Set((evidenceSource || []).filter(Boolean))],
    priorUsed: Boolean(priorUsed),
    strongPickEligible: evidenceLevel === 'SUFFICIENT' && n >= 8,
  };
}

function buildMarketEvidence({
  matchProbabilities = {},
  goalMarkets = {},
  cornerMetrics = {},
  halfMarkets = {},
  homeHistory = {},
  awayHistory = {},
  homeAdvanced = {},
  awayAdvanced = {},
  hasStandings = false,
  hasOdds = false,
  homePowerGames = 0,
  awayPowerGames = 0,
  h2hCount = 0,
}) {
  const homeSample = sampleCount(homeHistory.played);
  const awaySample = sampleCount(awayHistory.played);
  const teamSample = Math.min(homeSample, awaySample);
  const xgSample = Math.min(sampleCount(homeAdvanced.xgSample), sampleCount(awayAdvanced.xgSample));
  const historicalSources = [];
  if (teamSample > 0) historicalSources.push('team-history', 'home-away-form');
  if (xgSample > 0) historicalSources.push('provider-xg');
  if (h2hCount > 0) historicalSources.push('h2h');
  const goalSources = [...historicalSources];
  if (teamSample === 0) goalSources.push('league-prior');

  const oneXTwoSources = [...goalSources];
  if (homePowerGames > 0 || awayPowerGames > 0) oneXTwoSources.push('team-strength');
  if (hasStandings) oneXTwoSources.push('standings');
  if (hasOdds) oneXTwoSources.push('market-odds');

  const evidence = {};
  const add = (keys, probability, sample, sources, options = {}) => {
    for (const key of keys) {
      evidence[key] = createMarketEvidence({
        probability,
        effectiveSample: sample,
        evidenceSource: sources,
        priorUsed: options.priorUsed ?? (sampleCount(sample) === 0),
        forceInsufficient: options.forceInsufficient === true,
      });
    }
  };

  add(['home'], matchProbabilities.homeWinProbability, teamSample, oneXTwoSources);
  add(['draw'], matchProbabilities.drawProbability, teamSample, oneXTwoSources);
  add(['away'], matchProbabilities.awayWinProbability, teamSample, oneXTwoSources);

  add(['over25'], goalMarkets.over25GoalsPercent, teamSample, goalSources);
  add(['under25'], goalMarkets.under25GoalsPercent ?? complementProbability(goalMarkets.over25GoalsPercent), teamSample, goalSources);
  add(['bttsYes'], goalMarkets.bttsPercent, teamSample, [
    ...goalSources,
    ...(teamSample > 0 ? ['team-scoring-history', 'team-conceding-history'] : []),
  ]);
  add(['bttsNo'], complementProbability(goalMarkets.bttsPercent), teamSample, [
    ...goalSources,
    ...(teamSample > 0 ? ['team-scoring-history', 'team-conceding-history'] : []),
  ]);
  add(['homeScores'], goalMarkets.scoring?.home, teamSample, [
    ...goalSources,
    ...(teamSample > 0 ? ['home-scoring-history', 'away-conceding-history'] : []),
  ]);
  add(['awayScores'], goalMarkets.scoring?.away, teamSample, [
    ...goalSources,
    ...(teamSample > 0 ? ['away-scoring-history', 'home-conceding-history'] : []),
  ]);

  for (const [line, values] of Object.entries(goalMarkets.totalGoals || {})) {
    const lineKey = line.replace('.', '');
    const keys = [];
    if (values?.over != null) keys.push(`over${lineKey}`);
    if (values?.under != null) keys.push(`under${lineKey}`);
    if (keys.includes(`over${lineKey}`)) add([`over${lineKey}`], values.over, teamSample, goalSources);
    if (keys.includes(`under${lineKey}`)) add([`under${lineKey}`], values.under, teamSample, goalSources);
  }

  for (const side of ['home', 'away']) {
    for (const [line, values] of Object.entries(goalMarkets.teamGoals?.[side] || {})) {
      const lineKey = line.replace('.', '');
      const keys = [];
      if (values?.over != null) keys.push(`${side}Over${lineKey}`);
      if (values?.under != null) keys.push(`${side}Under${lineKey}`);
      const sources=[
        ...goalSources,
        ...(teamSample > 0 ? [`${side}-scoring-history`, `${side === 'home' ? 'away' : 'home'}-conceding-history`] : []),
      ];
      if (keys.includes(`${side}Over${lineKey}`)) add([`${side}Over${lineKey}`], values.over, teamSample, sources);
      if (keys.includes(`${side}Under${lineKey}`)) add([`${side}Under${lineKey}`], values.under, teamSample, sources);
    }
  }

  const cornerSample = sampleCount(cornerMetrics.sample);
  const cornerSource = String(cornerMetrics.provenance || '');
  const cornerIsReal = cornerSource === 'REAL_PROVIDER_CORNERS' ||
    ['sportmonks-history-pressure', 'historical-corners'].includes(String(cornerMetrics.source || ''));
  let cornerEvidenceSource;
  if (cornerIsReal) {
    cornerEvidenceSource = ['REAL_PROVIDER_CORNERS', 'DERIVED_ESTIMATE'];
  } else if (cornerSource === 'LEAGUE_PRIOR' || String(cornerMetrics.source || '').includes('league-prior')) {
    cornerEvidenceSource = ['LEAGUE_PRIOR'];
  } else if (cornerSource === 'NO_DATA') {
    cornerEvidenceSource = ['NO_DATA'];
  } else {
    cornerEvidenceSource = ['DERIVED_ESTIMATE'];
  }
  const cornerBlocked = !cornerIsReal || cornerSample < 8;
  add(
    ['cornersOver95'],
    cornerMetrics.over95Percent,
    cornerSample,
    cornerEvidenceSource,
    { forceInsufficient: cornerBlocked, priorUsed: !cornerIsReal }
  );
  add(
    ['cornersUnder95'],
    cornerMetrics.under95Percent ?? complementProbability(cornerMetrics.over95Percent),
    cornerSample,
    cornerEvidenceSource,
    { forceInsufficient: cornerBlocked, priorUsed: !cornerIsReal }
  );

  const h = halfMarkets.evidence || {};
  const homeHt = sampleCount(h.homeHTSamples ?? h.homeSample);
  const awayHt = sampleCount(h.awayHTSamples ?? h.awaySample);
  const homeFirstScoring = sampleCount(h.homeFirstHalfScoringSamples ?? h.homeHTSamples ?? h.homeSample);
  const awayFirstScoring = sampleCount(h.awayFirstHalfScoringSamples ?? h.awayHTSamples ?? h.awaySample);
  const homeFirstConceding = sampleCount(h.homeFirstHalfConcedingSamples ?? h.homeHTSamples ?? h.homeSample);
  const awayFirstConceding = sampleCount(h.awayFirstHalfConcedingSamples ?? h.awayHTSamples ?? h.awaySample);
  const homeSecond = sampleCount(h.homeSecondHalfSamples ?? h.homeSample);
  const awaySecond = sampleCount(h.awaySecondHalfSamples ?? h.awaySample);
  const halfSource = Math.min(homeHt, awayHt) > 0
    ? ['real-halftime-history', String(h.source || 'team-fixture-history')]
    : ['league-prior'];
  const halfPrior = h.priorUsed ?? (Math.min(homeHt, awayHt) < 8);
  const firstHalfPrior = h.firstHalfPriorUsed ?? halfPrior;
  const secondHalfPrior = h.secondHalfPriorUsed ?? (Math.min(homeSecond, awaySecond) < 8);
  const addHalf = (key, probability, sample, sources = halfSource, priorUsed = halfPrior) => {
    if (probability === null || probability === undefined) return;
    evidence[key] = createMarketEvidence({
      probability,
      effectiveSample: sample,
      evidenceSource: sources,
      priorUsed,
    });
  };

  const first = halfMarkets.firstHalf || {};
  const second = halfMarkets.secondHalf || {};
  const most = halfMarkets.mostGoalsHalf || {};
  const bothHt = Math.min(homeHt, awayHt);
  addHalf('fhHome', first.home, bothHt, halfSource, firstHalfPrior);
  addHalf('fhDraw', first.draw, bothHt, halfSource, firstHalfPrior);
  addHalf('fhAway', first.away, bothHt, halfSource, firstHalfPrior);
  addHalf('fhOver05', first.over05, bothHt, halfSource, firstHalfPrior);
  addHalf('fhHomeScores', first.homeScores, Math.min(homeFirstScoring, awayFirstConceding),
    ['real-halftime-history', 'home-first-half-scoring', 'away-first-half-conceding'], firstHalfPrior);
  addHalf('fhAwayScores', first.awayScores, Math.min(awayFirstScoring, homeFirstConceding),
    ['real-halftime-history', 'away-first-half-scoring', 'home-first-half-conceding'], firstHalfPrior);
  addHalf('fhBttsYes', first.btts, Math.min(homeFirstScoring, awayFirstScoring), halfSource, firstHalfPrior);
  addHalf('fhBttsNo', first.btts == null ? null : 100 - Number(first.btts), Math.min(homeFirstScoring, awayFirstScoring), halfSource, firstHalfPrior);

  const bothSecond = Math.min(homeSecond, awaySecond);
  addHalf('shHome', second.home, bothSecond, halfSource, secondHalfPrior);
  addHalf('shDraw', second.draw, bothSecond, halfSource, secondHalfPrior);
  addHalf('shAway', second.away, bothSecond, halfSource, secondHalfPrior);
  addHalf('shOver05', second.over05, bothSecond, halfSource, secondHalfPrior);
  addHalf('shHomeScores', second.homeScores, Math.min(homeSecond, awaySecond),
    ['real-halftime-fulltime-split', 'home-second-half-scoring', 'away-second-half-conceding'], secondHalfPrior);
  addHalf('shAwayScores', second.awayScores, Math.min(awaySecond, homeSecond),
    ['real-halftime-fulltime-split', 'away-second-half-scoring', 'home-second-half-conceding'], secondHalfPrior);
  addHalf('mostGoalsFirst', most.first, bothSecond, halfSource, secondHalfPrior);
  addHalf('mostGoalsEqual', most.equal, bothSecond, halfSource, secondHalfPrior);
  addHalf('mostGoalsSecond', most.second, bothSecond, halfSource, secondHalfPrior);

  return evidence;
}

function buildQualityDimensions({
  sourceSuccessCount = 0,
  totalSources = 0,
  homeHistorySample = 0,
  awayHistorySample = 0,
  historyTargetPerTeam = 8,
  metricAvailability = {},
  marketEvidence = {},
}) {
  const total = Math.max(0, sampleCount(totalSources));
  const successes = Math.min(total, sampleCount(sourceSuccessCount));
  const home = sampleCount(homeHistorySample);
  const away = sampleCount(awayHistorySample);
  const target = Math.max(1, sampleCount(historyTargetPerTeam));
  const historyCoverageScore = Math.round(100 * Math.min(1, home / target, away / target));
  const availableMetrics = Object.keys(metricAvailability).filter(key => metricAvailability[key] === true);
  const missingMetrics = Object.keys(metricAvailability).filter(key => metricAvailability[key] !== true);
  const metricCoverageScore = Object.keys(metricAvailability).length
    ? Math.round(100 * availableMetrics.length / Object.keys(metricAvailability).length)
    : 0;

  return {
    sourceHealth: {
      score: total ? Math.round(100 * successes / total) : null,
      successfulSources: successes,
      totalSources: total,
    },
    dataFreshness: {
      score: null,
      status: 'NOT_MEASURED',
    },
    historicalSampleCoverage: {
      score: historyCoverageScore,
      homeSample: home,
      awaySample: away,
      effectiveSample: Math.min(home, away),
      targetPerTeam: target,
    },
    metricCoverage: {
      score: metricCoverageScore,
      availableCount: availableMetrics.length,
      totalCount: Object.keys(metricAvailability).length,
      availableMetrics,
      missingMetrics,
    },
    marketEvidence,
  };
}

function hasStrongEvidence(selection) {
  return selection?.strongPickEligible === true &&
    ['SUFFICIENT', 'STRONG'].includes(String(selection?.evidenceLevel || '').toUpperCase()) &&
    sampleCount(selection?.effectiveSample) >= 8;
}

function bttsDirection(yesProbability) {
  const yes = probabilityValue(yesProbability);
  if (yes === null) return null;
  const no = +(100 - yes).toFixed(1);
  return yes >= no
    ? { key:'bttsYes', direction:'YES', label:'KG Var', probability:yes }
    : { key:'bttsNo', direction:'NO', label:'KG Yok', probability:no };
}

// Keep the established 1X2 confidence shrinkage unchanged while exposing it
// as a pure function for regression tests and shared evidence metadata.
function shrinkMatchProbabilities(probabilities, evidenceStrength, agreementScore) {
  const h = Number(probabilities?.homeWinProbability);
  const d = Number(probabilities?.drawProbability);
  const a = Number(probabilities?.awayWinProbability);
  if (![h, d, a].every(Number.isFinite)) return probabilities;
  const strength = Number(evidenceStrength);
  const agreement = Number(agreementScore);
  const effectiveStrength = Math.max(
    0.30,
    Math.min(1, strength * (0.65 + 0.35 * agreement / 100))
  );
  const values = [h, d, a].map(p => 33.333 + effectiveStrength * (p - 33.333));
  const sum = values.reduce((s, x) => s + x, 0) || 100;
  return {
    ...probabilities,
    homeWinProbability: +(values[0] * 100 / sum).toFixed(1),
    drawProbability: +(values[1] * 100 / sum).toFixed(1),
    awayWinProbability: +(values[2] * 100 / sum).toFixed(1),
  };
}

module.exports = {
  EVIDENCE_LEVELS,
  sampleCount,
  classifyEvidence,
  createMarketEvidence,
  buildMarketEvidence,
  buildQualityDimensions,
  hasStrongEvidence,
  bttsDirection,
  shrinkMatchProbabilities,
};