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
  marketOddsBoard: { bookmakers:[
    {bookmaker:'Book A',h2h:{home:2.65,draw:3.4,away:3.1},totals:{over25:1.75,under25:2.12}},
    {bookmaker:'Book B',h2h:{home:2.60,draw:3.5,away:3.0},totals:{over25:1.72,under25:2.15}}
  ]},
});
assert.ok(board.allMarkets.some(item => item.key === 'homeOver15'));
assert.ok(board.allMarkets.some(item => item.key === 'homeScores'));
assert.ok(board.topPredictions.length >= 1);
assert.ok(board.topPredictions.every(item => item.verifiedOdds > 1));
assert.ok(board.topPredictions.every(item => item.expectedValuePercent > 0));
assert.ok(board.topPredictions.every(item => item.edgePoints >= item.valueThresholdPoints));
assert.ok(board.topPredictions.some(item => item.key === 'over25'));
assert.ok(!board.topPredictions.some(item => item.key === 'shOver05'));

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


// A 90% high-base-rate market without a verified price must never beat a
// lower-probability positive-EV market into Top Picks.
const valueBoard = buildMarketBoard({
  modelProbabilities:{homeWinProbability:62,drawProbability:23,awayWinProbability:15},
  goalMarkets:{over25GoalsPercent:64,bttsPercent:58,totalGoals:{'1.5':{over:80,under:20},'3.5':{over:40,under:60}},teamGoals:{home:{'1.5':{over:55},'2.5':{over:25},'3.5':{over:10}},away:{'1.5':{over:25},'2.5':{over:8},'3.5':{over:2}}},scoring:{home:82,away:52}},
  halfMarkets:{firstHalf:{home:40,draw:40,away:20,homeScores:55,awayScores:30,over05:70},secondHalf:{home:50,draw:30,away:20,homeScores:75,awayScores:45,over05:90},mostGoalsHalf:{first:28,equal:25,second:47}},
  cornerMetrics:{over95Percent:51,under95Percent:49},
  dataHealth:{score:85}, evidenceStrength:.85,
  premium:{status:'PICK',selection:'home'},
  marketOddsBoard:{bookmakers:[{bookmaker:'Book A',h2h:{home:1.95,draw:3.7,away:5.5},totals:{over25:1.95,under25:1.95}}]}
});
assert.ok(valueBoard.topPredictions.some(x=>x.key==='home'||x.key==='over25'));
assert.ok(!valueBoard.topPredictions.some(x=>x.key==='shOver05'));
assert.equal(valueBoard.allMarkets.find(x=>x.key==='shOver05').verifiedOdds,null);
console.log('betting-value Top Picks tests passed');


const noValueBoard = buildMarketBoard({
  modelProbabilities:{homeWinProbability:34,drawProbability:33,awayWinProbability:33},
  goalMarkets:{over25GoalsPercent:50,bttsPercent:50,totalGoals:{'1.5':{over:60,under:40},'3.5':{over:30,under:70}},teamGoals:{home:{'1.5':{over:30},'2.5':{over:10},'3.5':{over:3}},away:{'1.5':{over:30},'2.5':{over:10},'3.5':{over:3}}},scoring:{home:60,away:60}},
  halfMarkets:{firstHalf:{home:30,draw:45,away:25,homeScores:40,awayScores:40,over05:60},secondHalf:{home:35,draw:35,away:30,homeScores:55,awayScores:55,over05:91},mostGoalsHalf:{first:30,equal:25,second:45}},
  cornerMetrics:{over95Percent:50,under95Percent:50},
  dataHealth:{score:90}, evidenceStrength:.9,
  marketOddsBoard:{bookmakers:[{bookmaker:'Book A',h2h:{home:2.75,draw:3.05,away:2.75},totals:{over25:1.90,under25:1.90}}]}
});
assert.equal(noValueBoard.topPredictions.length,0);
assert.equal(noValueBoard.best,null);
assert.equal(noValueBoard.selectionPolicy.noBetWhenEmpty,true);
assert.ok(!noValueBoard.allMarkets.find(x=>x.key==='shOver05').isBettingValue);
console.log('NO BET and high-base-rate guard tests passed');
