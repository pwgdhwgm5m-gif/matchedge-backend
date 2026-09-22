const assert = require('node:assert/strict');
const { buildPremiumIntelligence, buildMarketBoard } = require('../src/services/premiumIntelligenceService');
const { calculateHalfMarkets, calculateMarketProbabilities, estimateCornerMetrics } = require('../src/services/poissonService');

const strong = buildPremiumIntelligence({
  modelProbabilities: { homeWinProbability: 60, drawProbability: 23, awayWinProbability: 17 },
  marketProbabilities: { home: 52, draw: 27, away: 21 },
  matchOdds: { home: 1.82, draw: 3.5, away: 4.2 },
  homePlayed: 5,
  awayPlayed: 5,
  hasStandings: true,
  injuriesAvailable: true,
  h2hCount: 2,
  homeLambda: 1.9,
  awayLambda: 0.9,
  homeForm: { avgGoalsFor: 1.8, avgGoalsAgainst: 0.8 },
  awayForm: { avgGoalsFor: 0.9, avgGoalsAgainst: 1.7 },
});

assert.equal(strong.status, 'VALUE');
assert.equal(strong.selection, 'home');
assert.equal(strong.bestEdge.edgePoints, 8);
assert.equal(strong.dataHealth.score, 100);

const earlySeason = buildPremiumIntelligence({
  modelProbabilities: { homeWinProbability: 70, drawProbability: 20, awayWinProbability: 10 },
  marketProbabilities: { home: 50, draw: 30, away: 20 },
  matchOdds: { home: 1.9, draw: 3.2, away: 4.5 },
  homePlayed: 2,
  awayPlayed: 2,
  hasStandings: true,
  injuriesAvailable: false,
  h2hCount: 0,
});

assert.equal(earlySeason.status, 'PICK');
assert.equal(earlySeason.selection, 'home');
assert.ok(earlySeason.blockers.includes('SMALL_SAMPLE'));

const noOdds = buildPremiumIntelligence({
  modelProbabilities: { homeWinProbability: 45, drawProbability: 30, awayWinProbability: 25 },
  homePlayed: 5,
  awayPlayed: 5,
  hasStandings: true,
  injuriesAvailable: true,
  h2hCount: 1,
});

assert.equal(noOdds.status, 'PICK');
assert.equal(noOdds.selection, 'home');
assert.equal(noOdds.bestEdge.modelProbability, 45);
assert.equal(noOdds.bestEdge.edgePoints, null);
assert.ok(noOdds.blockers.includes('NO_MARKET_ODDS'));

console.log('premiumIntelligence tests passed');

const board = buildMarketBoard({
  modelProbabilities: { homeWinProbability: 44, drawProbability: 28, awayWinProbability: 28 },
  goalMarkets: { over25GoalsPercent: 68, bttsPercent: 61, totalGoals:{'1.5':{over:82,under:18},'3.5':{over:44,under:56}}, teamGoals:{home:{'1.5':{over:67},'2.5':{over:42},'3.5':{over:22}},away:{'1.5':{over:31},'2.5':{over:12},'3.5':{over:4}}}, scoring:{home:84,away:55} },
  cornerMetrics: { over95Percent: 62, under95Percent:38 },
  dataHealth: { score: 80 },
  premium: { status: 'PICK', selection: 'home', bestEdge: null },
});
assert.ok(board.allMarkets.some(item => item.key === 'homeOver15'));
assert.ok(board.allMarkets.some(item => item.key === 'homeScores'));
assert.equal(board.topPredictions.length, 3);
assert.ok(board.topPredictions.some(item => item.key === 'over25'));

const halves = calculateHalfMarkets(1.8, 0.9);
assert.ok(halves.firstHalf.home > halves.firstHalf.away);
assert.ok(halves.secondHalf.home > halves.secondHalf.away);
assert.ok(halves.mostGoalsHalf.second > halves.mostGoalsHalf.first);


const expanded = calculateMarketProbabilities(3.2, 0.8);
assert.ok(expanded.teamGoals.home['2.5'].over > expanded.teamGoals.away['2.5'].over);
assert.ok(expanded.totalGoals['1.5'].over > expanded.totalGoals['4.5'].over);
assert.ok(expanded.scoring.home > expanded.scoring.away);

const highGoalNoCornerData = estimateCornerMetrics(5.5, 1.2);
assert.equal(highGoalNoCornerData.source, 'league-prior-bounded-tempo');
assert.ok(highGoalNoCornerData.expectedTotal <= 10.3);
assert.ok(highGoalNoCornerData.over85Percent < 80);

assert.ok(halves.firstHalf.homeScores > halves.firstHalf.awayScores);
assert.ok(halves.secondHalf.homeScores > halves.secondHalf.awayScores);
console.log('expanded market probability tests passed');
