const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../src/services/statsService');
const accuracy = require('../src/services/accuracyEngineService');
const sportsDb = require('../src/services/sportsDbService');
const sportmonks = require('../src/services/sportmonksService');
const poisson = require('../src/services/poissonService');
const marketEvidence = require('../src/services/marketEvidenceService');
const { buildMarketBoard } = require('../src/services/premiumIntelligenceService');
const premiumLab = require('../src/services/premiumLabService');

test('completed-match averages use only valid scored appearances as denominator', () => {
  const matches = [
    { teams:{home:{id:1},away:{id:2}}, goals:{home:2,away:0} },
    { teams:{home:{id:3},away:{id:1}}, goals:{home:1,away:1} },
    { teams:{home:{id:1},away:{id:4}}, goals:{home:null,away:null} },
    { teams:{home:{id:1},away:{id:5}}, goals:{home:2,away:null} },
    { teams:{home:{id:1},away:{id:8}}, goals:{home:'',away:'1'} },
    { teams:{home:{id:6},away:{id:7}}, goals:{home:4,away:0} },
  ];
  const summary = stats.summarizeMatches(matches, 1);
  assert.equal(summary.played, 2);
  assert.equal(summary.wins, 1);
  assert.equal(summary.draws, 1);
  assert.equal(summary.avgGoalsFor, 1.5);
  assert.equal(summary.avgGoalsAgainst, 0.5);
});

test('half-time and second-half sample counts require real score splits', () => {
  const fixtures = [
    { teams:{home:{id:1},away:{id:2}}, score:{halftime:{home:1,away:0}}, goals:{home:2,away:1} },
    { teams:{home:{id:1},away:{id:3}}, score:{halftime:{home:null,away:null}}, goals:{home:3,away:0} },
    { teams:{home:{id:1},away:{id:4}}, score:{halftime:{home:2,away:0}}, goals:{home:1,away:1} },
  ];
  const half = stats.calculateHalfHistory(fixtures, 1);
  assert.equal(half.halftimeSamples, 2);
  assert.equal(half.firstHalfScoringSamples, 2);
  assert.equal(half.secondHalfSamples, 1);
  assert.equal(half.firstHalfGoalsFor, 1.5);
  assert.equal(half.secondHalfGoalsFor, 1);
});

test('SportMonks history does not fabricate half samples or clamp invalid splits to zero', () => {
  const participants = [
    {id:1,meta:{location:'home'}},
    {id:2,meta:{location:'away'}},
  ];
  const history = sportmonks.aggregateTeamHistory([
    {raw:{participants},halftimeHome:1,halftimeAway:0,homeScore:2,awayScore:1,stats:{}},
    {raw:{participants},halftimeHome:null,halftimeAway:null,homeScore:2,awayScore:0,stats:{}},
    {raw:{participants},halftimeHome:2,halftimeAway:0,homeScore:1,awayScore:1,stats:{}},
  ], 1);
  assert.equal(history.halftimeSamples, 2);
  assert.equal(history.secondHalfSamples, 1);
  assert.equal(history.metricSamples.secondHalfScored, 1);
  assert.equal(history.averages.secondHalfScored, 1);
});

test('evidence categories use actual two-team samples and only sufficient samples qualify as Strong Picks', () => {
  assert.equal(marketEvidence.classifyEvidence(0), 'INSUFFICIENT');
  assert.equal(marketEvidence.classifyEvidence(2), 'INSUFFICIENT');
  assert.equal(marketEvidence.classifyEvidence(3), 'VERY_LOW');
  assert.equal(marketEvidence.classifyEvidence(4), 'VERY_LOW');
  assert.equal(marketEvidence.classifyEvidence(5), 'LIMITED');
  assert.equal(marketEvidence.classifyEvidence(7), 'LIMITED');
  assert.equal(marketEvidence.classifyEvidence(8), 'SUFFICIENT');

  const base = {
    matchProbabilities:{homeWinProbability:72,drawProbability:17,awayWinProbability:11},
    goalMarkets:{over25GoalsPercent:73,bttsPercent:67},
    halfMarkets:{firstHalf:{home:60,draw:25,away:15,homeScores:70,awayScores:40,over05:75,btts:35},secondHalf:{home:50,draw:30,away:20,homeScores:65,awayScores:45,over05:80},mostGoalsHalf:{first:30,equal:25,second:45},evidence:{homeHTSamples:0,awayHTSamples:0,homeSecondHalfSamples:0,awaySecondHalfSamples:0,priorUsed:true}},
  };
  const limited = marketEvidence.buildMarketEvidence({...base,homeHistory:{played:12},awayHistory:{played:5}});
  assert.equal(limited.home.effectiveSample, 5);
  assert.equal(limited.home.evidenceLevel, 'LIMITED');
  assert.equal(limited.home.strongPickEligible, false);
  const sufficient = marketEvidence.buildMarketEvidence({...base,homeHistory:{played:12},awayHistory:{played:8}});
  assert.equal(sufficient.home.effectiveSample, 8);
  assert.equal(sufficient.home.evidenceLevel, 'SUFFICIENT');
  assert.equal(sufficient.home.strongPickEligible, true);
});

test('high probabilities with no team history cannot become Top Picks or Strong Picks', () => {
  const goalMarkets = poisson.calculateMarketProbabilities(3.6, 0.25);
  const halfMarkets = poisson.calculateHalfMarkets(3.6, 0.25);
  const cornerMetrics = poisson.estimateCornerMetrics(3.6, 0.25);
  const modelProbabilities = {homeWinProbability:90,drawProbability:7,awayWinProbability:3};
  const marketMap = marketEvidence.buildMarketEvidence({
    matchProbabilities:modelProbabilities,
    goalMarkets,
    cornerMetrics,
    halfMarkets,
    homeHistory:{played:0},
    awayHistory:{played:0},
    hasStandings:true,
    hasOdds:true,
  });
  const board = buildMarketBoard({
    modelProbabilities,
    goalMarkets,
    cornerMetrics,
    halfMarkets,
    marketEvidence:marketMap,
    dataHealth:{score:100},
    evidenceStrength:1,
    modelAgreementScore:100,
    premium:{},
  });
  assert.equal(board.allMarkets.find(x=>x.key==='home').probability, 90);
  assert.equal(board.allMarkets.find(x=>x.key==='home').evidenceLevel, 'INSUFFICIENT');
  assert.equal(board.allMarkets.find(x=>x.key==='home').strongPickEligible, false);
  assert.equal(board.topPredictions.length, 0);
  assert.equal(board.best, null);

  const quality = marketEvidence.buildQualityDimensions({
    sourceSuccessCount:5,totalSources:5,homeHistorySample:0,awayHistorySample:0,
    metricAvailability:{goalsHistory:false,providerXg:false,providerCorners:false},
    marketEvidence:marketMap,
  });
  assert.equal(quality.sourceHealth.score, 100);
  assert.equal(quality.historicalSampleCoverage.score, 0);
  assert.equal(quality.dataFreshness.status, 'NOT_MEASURED');
});

test('half markets use half-specific evidence rather than full-time history counts', () => {
  const goalMarkets=poisson.calculateMarketProbabilities(1.8,1.0);
  const halfMarkets=poisson.calculateHalfMarkets(1.8,1.0,{
    source:'team-fixture-history',
    homeFirstRate:1.1,homeSecondRate:0.7,awayFirstRate:0.3,awaySecondRate:0.8,
    homeSample:1,awaySample:0,homeHTSamples:1,awayHTSamples:0,
    homeFirstHalfScoringSamples:1,awayFirstHalfScoringSamples:0,
    homeFirstHalfConcedingSamples:1,awayFirstHalfConcedingSamples:0,
    homeSecondHalfSamples:0,awaySecondHalfSamples:0,
  });
  const evidence=marketEvidence.buildMarketEvidence({
    matchProbabilities:{homeWinProbability:55,drawProbability:25,awayWinProbability:20},
    goalMarkets,halfMarkets,
    homeHistory:{played:15},awayHistory:{played:12},
  });
  assert.equal(evidence.home.evidenceLevel,'SUFFICIENT');
  assert.equal(evidence.fhHome.effectiveSample,0);
  assert.equal(evidence.fhHome.evidenceLevel,'INSUFFICIENT');
  assert.equal(evidence.fhHome.strongPickEligible,false);
  assert.equal(evidence.shHome.effectiveSample,0);
  assert.equal(evidence.fhHomeScores.effectiveSample,0);
  assert.equal(evidence.fhHome.priorUsed,true);
});

test('missing provider xG stays missing and does not count as a zero observation', async () => {
  assert.equal(accuracy.normalizeProviderMetric(null), null);
  assert.equal(accuracy.normalizeProviderMetric(undefined), null);
  assert.equal(accuracy.normalizeProviderMetric(''), null);
  assert.equal(accuracy.normalizeProviderMetric('0'), 0);

  const original = sportsDb.getEventStatsFormatted;
  sportsDb.getEventStatsFormatted = async () => ({
    available:true,
    stats:{xg:{home:null,away:null},corners:{home:null,away:null}},
  });
  try {
    const form=await accuracy.teamAdvancedForm([{
      fixture:{id:'phase2-no-xg-regression'},
      teams:{home:{id:'home'},away:{id:'away'}},
      goals:{home:1,away:0},
    }],'home',8);
    assert.equal(form.xgSample,0);
    assert.equal(form.avgXgFor,null);
    assert.equal(form.avgXgAgainst,null);
    assert.equal(form.cornerSample,0);
  } finally {
    sportsDb.getEventStatsFormatted=original;
  }
});

test('real corners below eight samples remain ineligible; league priors are not provider history', () => {
  const common={
    matchProbabilities:{homeWinProbability:55,drawProbability:25,awayWinProbability:20},
    goalMarkets:{over25GoalsPercent:55,bttsPercent:55},
    halfMarkets:{},
    homeHistory:{played:10},awayHistory:{played:10},
  };
  const seven=marketEvidence.buildMarketEvidence({...common,cornerMetrics:{sample:7,source:'historical-corners',provenance:'REAL_PROVIDER_CORNERS',over95Percent:55,under95Percent:45}});
  assert.equal(seven.cornersOver95.evidenceLevel,'INSUFFICIENT');
  assert.equal(seven.cornersOver95.strongPickEligible,false);
  assert.deepEqual(seven.cornersOver95.evidenceSource,['REAL_PROVIDER_CORNERS','DERIVED_ESTIMATE']);

  const eight=marketEvidence.buildMarketEvidence({...common,cornerMetrics:{sample:8,source:'historical-corners',provenance:'REAL_PROVIDER_CORNERS',over95Percent:55,under95Percent:45}});
  assert.equal(eight.cornersOver95.evidenceLevel,'SUFFICIENT');
  assert.equal(eight.cornersOver95.strongPickEligible,true);

  const prior=marketEvidence.buildMarketEvidence({...common,cornerMetrics:{sample:0,source:'league-prior-bounded-tempo',provenance:'LEAGUE_PRIOR',over95Percent:55,under95Percent:45}});
  assert.equal(prior.cornersOver95.evidenceLevel,'INSUFFICIENT');
  assert.deepEqual(prior.cornersOver95.evidenceSource,['LEAGUE_PRIOR']);
  assert.equal(prior.cornersOver95.priorUsed,true);
});

test('established 1X2 confidence shrinkage still pulls extreme probabilities toward neutral', () => {
  const first=marketEvidence.shrinkMatchProbabilities(
    {homeWinProbability:94.6,drawProbability:3,awayWinProbability:2.4},
    0.418,
    80
  );
  assert.ok(Math.abs(first.homeWinProbability-57.1)<0.2);
  assert.ok(first.homeWinProbability<94.6 && first.homeWinProbability>33.3);
  assert.ok(Math.abs(first.homeWinProbability+first.drawProbability+first.awayWinProbability-100)<0.2);

  const second=marketEvidence.shrinkMatchProbabilities(
    {homeWinProbability:90.2,drawProbability:6,awayWinProbability:3.8},
    0.495,
    80
  );
  assert.ok(Math.abs(second.homeWinProbability-59.5)<0.2);
  assert.ok(second.homeWinProbability<90.2 && second.homeWinProbability>33.3);
});

test('BTTS probability, analysis direction, displayed label and coupon key stay aligned without ledger writes', () => {
  const goalMarkets=poisson.calculateMarketProbabilities(0.7,1.9);
  const direction=marketEvidence.bttsDirection(goalMarkets.bttsPercent);
  const halfMarkets=poisson.calculateHalfMarkets(0.7,1.9);
  const marketMap=marketEvidence.buildMarketEvidence({
    matchProbabilities:{homeWinProbability:20,drawProbability:25,awayWinProbability:55},
    goalMarkets,halfMarkets,
    homeHistory:{played:10},awayHistory:{played:10},
  });
  const board=buildMarketBoard({
    modelProbabilities:{homeWinProbability:20,drawProbability:25,awayWinProbability:55},
    goalMarkets,halfMarkets,marketEvidence:marketMap,
    cornerMetrics:{over95Percent:50,under95Percent:50,sample:0,source:'league-prior-bounded-tempo'},
    dataHealth:{score:85},premium:{},evidenceStrength:0.8,modelAgreementScore:80,
  });
  const yes=board.allMarkets.find(x=>x.key==='bttsYes');
  const no=board.allMarkets.find(x=>x.key==='bttsNo');
  assert.equal(yes.probability+no.probability,100);
  assert.equal(board.bttsDirection.key,direction.key);
  assert.equal(board.bttsDirection.label,direction.label);
  assert.equal(board.bttsDirection.probability,board.allMarkets.find(x=>x.key===direction.key).probability);
  assert.equal(board.bttsDirection.key,'bttsNo');
  assert.equal(board.bttsDirection.label,'KG Yok');

  const couponPick={key:board.bttsDirection.key,market:'KG',label:board.bttsDirection.label};
  const simulation={bttsYes:35,bttsNo:65};
  assert.equal(premiumLab.simProbabilityForPick(couponPick,simulation),simulation.bttsNo);
  assert.equal(couponPick.key,'bttsNo');
});

test('Strong-pick automation rejects old or unassessed snapshots', () => {
  const row={dataQualityScore:100,homeLambda:0,awayLambda:0};
  assert.equal(premiumLab.candidateStrength(row,{key:'home',probability:90,score:90},'low'),null);
  assert.equal(premiumLab.candidateStrength(row,{
    key:'home',probability:90,score:90,evidenceLevel:'SUFFICIENT',effectiveSample:7,strongPickEligible:true,
  },'low'),null);
  const assessed=premiumLab.candidateStrength(row,{
    key:'home',probability:90,score:90,evidenceLevel:'SUFFICIENT',effectiveSample:8,strongPickEligible:true,
  },'low');
  assert.ok(assessed);
});