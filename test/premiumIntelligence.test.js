const assert = require('node:assert/strict');
const { buildPremiumIntelligence, buildMarketBoard } = require('../src/services/premiumIntelligenceService');
const { calculateHalfMarkets, calculateMarketProbabilities, estimateCornerMetrics } = require('../src/services/poissonService');
const { calculateMatchDominance } = require('../src/services/liveXgService');

const sufficientMarketEvidence = Object.fromEntries([
  'home','draw','away','over25','under25','bttsYes','bttsNo','over15','over35','under35',
  'homeScores','awayScores','homeOver15','homeOver25','homeOver35','awayOver15','awayOver25','awayOver35',
  'cornersOver95','cornersUnder95','fhHome','fhDraw','fhAway','fhHomeScores','fhAwayScores','fhOver05',
  'shHome','shDraw','shAway','shHomeScores','shAwayScores','shOver05','mostGoalsFirst','mostGoalsEqual','mostGoalsSecond',
].map(key => [key, {
  evidenceLevel:'SUFFICIENT',
  effectiveSample:8,
  evidenceSource:['test-history'],
  priorUsed:false,
  strongPickEligible:true,
}]));
const sufficientHomeEvidence = {
  home:{evidenceLevel:'SUFFICIENT',effectiveSample:8,evidenceSource:['test-history'],priorUsed:false,strongPickEligible:true},
  draw:{evidenceLevel:'SUFFICIENT',effectiveSample:8,evidenceSource:['test-history'],priorUsed:false,strongPickEligible:true},
  away:{evidenceLevel:'SUFFICIENT',effectiveSample:8,evidenceSource:['test-history'],priorUsed:false,strongPickEligible:true},
};

const strong = buildPremiumIntelligence({
  marketEvidence:sufficientHomeEvidence,
  modelProbabilities: { homeWinProbability: 60, drawProbability: 23, awayWinProbability: 17 },
  marketProbabilities: { home: 52, draw: 27, away: 21 },
  matchOdds: { home: 1.82, draw: 3.5, away: 4.2 },
  homePlayed: 8,
  awayPlayed: 8,
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

assert.equal(earlySeason.status, 'UNAVAILABLE');
assert.equal(earlySeason.selection, null);
assert.ok(earlySeason.blockers.includes('SMALL_SAMPLE'));

const noOdds = buildPremiumIntelligence({
  marketEvidence:sufficientHomeEvidence,
  modelProbabilities: { homeWinProbability: 45, drawProbability: 30, awayWinProbability: 25 },
  homePlayed: 8,
  awayPlayed: 8,
  hasStandings: true,
  injuriesAvailable: true,
  h2hCount: 1,
});

assert.equal(noOdds.status, 'PICK');
assert.equal(noOdds.selection, 'home');
assert.equal(noOdds.bestEdge.modelProbability, 45);
assert.equal(noOdds.bestEdge.edgePoints, null);
assert.ok(noOdds.blockers.includes('NO_MARKET_ODDS'));

const evidenceLimitedPick=buildPremiumIntelligence({
  modelProbabilities:{homeWinProbability:80,drawProbability:12,awayWinProbability:8},
  homePlayed:7,awayPlayed:7,hasStandings:true,
  marketEvidence:{home:{evidenceLevel:'LIMITED',effectiveSample:7,strongPickEligible:false}},
});
assert.equal(evidenceLimitedPick.status,'UNAVAILABLE');
assert.equal(evidenceLimitedPick.selection,null);
assert.ok(evidenceLimitedPick.blockers.includes('INSUFFICIENT_MARKET_EVIDENCE'));

console.log('premiumIntelligence tests passed');

const board = buildMarketBoard({
  marketEvidence:sufficientMarketEvidence,
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
assert.ok(board.topPredictions.length >= 1);
assert.ok(board.valuePicks.every(item => item.verifiedOdds > 1));
assert.ok(board.valuePicks.every(item => item.expectedValuePercent > 0));
assert.ok(board.valuePicks.every(item => item.edgePoints >= item.valueThresholdPoints));
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
  marketEvidence:sufficientMarketEvidence,
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
  marketEvidence:sufficientMarketEvidence,
  modelProbabilities:{homeWinProbability:34,drawProbability:33,awayWinProbability:33},
  goalMarkets:{over25GoalsPercent:50,bttsPercent:50,totalGoals:{'1.5':{over:60,under:40},'3.5':{over:30,under:70}},teamGoals:{home:{'1.5':{over:30},'2.5':{over:10},'3.5':{over:3}},away:{'1.5':{over:30},'2.5':{over:10},'3.5':{over:3}}},scoring:{home:60,away:60}},
  halfMarkets:{firstHalf:{home:30,draw:45,away:25,homeScores:40,awayScores:40,over05:60},secondHalf:{home:35,draw:35,away:30,homeScores:55,awayScores:55,over05:91},mostGoalsHalf:{first:30,equal:25,second:45}},
  cornerMetrics:{over95Percent:50,under95Percent:50},
  dataHealth:{score:90}, evidenceStrength:.9,
  marketOddsBoard:{bookmakers:[{bookmaker:'Book A',h2h:{home:2.75,draw:3.05,away:2.75},totals:{over25:1.90,under25:1.90}}]}
});
assert.ok(noValueBoard.topPredictions.length>0);
assert.ok(noValueBoard.best);
assert.equal(noValueBoard.valuePicks.length,0);
assert.equal(noValueBoard.selectionPolicy.noBetCustomerFacing,false);
assert.equal(noValueBoard.selectionPolicy.topPicksRequireOdds,false);
assert.ok(!noValueBoard.allMarkets.find(x=>x.key==='shOver05').isBettingValue);
console.log('analysis-first Top Picks and value separation tests passed');


const dominance = calculateMatchDominance(
  {shotsOnTarget:6,bigChances:3,shotsInsideBox:9,dangerousAttacks:42,corners:5,blockedShots:4,attacks:58},
  {shotsOnTarget:2,bigChances:1,shotsInsideBox:4,dangerousAttacks:30,corners:3,blockedShots:2,attacks:50},
  {possessionHome:43,possessionAway:57}
);
assert.equal(dominance.available,true);
assert.ok(dominance.home>dominance.away);
assert.ok(dominance.home>55);
const possessionOnly = calculateMatchDominance(
  {shotsOnTarget:null,bigChances:null,shotsInsideBox:null,dangerousAttacks:null,corners:null,blockedShots:null,attacks:null},
  {shotsOnTarget:null,bigChances:null,shotsInsideBox:null,dangerousAttacks:null,corners:null,blockedShots:null,attacks:null},
  {possessionHome:70,possessionAway:30}
);
assert.equal(possessionOnly.available,true);
assert.equal(possessionOnly.confidence,5);
assert.equal(calculateMatchDominance({}, {}, {}).available,false);
console.log('live match dominance tests passed');

const evidenceHalves = calculateHalfMarkets(2.0,1.0,{
  source:'test-verified-halftime',homeFirstRate:1.1,homeSecondRate:.7,awayFirstRate:.25,awaySecondRate:.75,homeSample:10,awaySample:10
});
assert.equal(evidenceHalves.evidence.source,'test-verified-halftime');
assert.ok(evidenceHalves.evidence.homeFirstShare>45);
assert.ok(evidenceHalves.evidence.awayFirstShare<45);
assert.ok(evidenceHalves.firstHalf.homeScores>halves.firstHalf.homeScores-20);
const sparseHalves=calculateHalfMarkets(2,1,{homeFirstRate:2,homeSecondRate:.2,awayFirstRate:.2,awaySecondRate:2,homeSample:1,awaySample:1});
assert.ok(sparseHalves.evidence.homeFirstShare<50);
assert.ok(sparseHalves.evidence.awayFirstShare>40);
console.log('half-specific evidence tests passed');

const unhealthyBoard=buildMarketBoard({
 marketEvidence:sufficientMarketEvidence,
 modelProbabilities:{homeWinProbability:72,drawProbability:16,awayWinProbability:12},
 goalMarkets:{over25GoalsPercent:65,bttsPercent:55,totalGoals:{'1.5':{over:80},'3.5':{over:35,under:65}},scoring:{home:82,away:55},teamGoals:{home:{'1.5':{over:60},'2.5':{over:35},'3.5':{over:15}},away:{'1.5':{over:25},'2.5':{over:10},'3.5':{over:4}}}},
 cornerMetrics:{over95Percent:50,under95Percent:50},halfMarkets:halves,dataHealth:{score:85},premium:{},
 evidenceStrength:.8,modelAgreementScore:80,
 marketOddsBoard:{bookmakers:[{bookmaker:'test',fresh:true,h2h:{home:1.6,draw:4.5,away:8},totals:{over25:1.9,under25:2.05}}]},
 modelHealth:{readiness:'decision-ready',healthy:false,drift:[{market:'home',severity:'high'}],bucketAlerts:[]}
});
const gatedHome=unhealthyBoard.allMarkets.find(x=>x.key==='home');
assert.equal(gatedHome.isBettingValue,false);
assert.equal(gatedHome.topPickExclusion,'MODEL_HEALTH_GATE');
assert.equal(unhealthyBoard.selectionPolicy.modelHealthGate,true);
console.log('model health gate tests passed');

const staleOddsBoard=buildMarketBoard({
 marketEvidence:sufficientMarketEvidence,
 modelProbabilities:{homeWinProbability:75,drawProbability:15,awayWinProbability:10},
 goalMarkets:{over25GoalsPercent:70,bttsPercent:55,totalGoals:{'1.5':{over:85},'3.5':{over:40,under:60}},scoring:{home:85,away:50},teamGoals:{home:{'1.5':{over:65},'2.5':{over:40},'3.5':{over:20}},away:{'1.5':{over:20},'2.5':{over:8},'3.5':{over:3}}}},
 cornerMetrics:{over95Percent:50,under95Percent:50},halfMarkets:halves,dataHealth:{score:90},premium:{},evidenceStrength:.9,modelAgreementScore:90,
 marketOddsBoard:{bookmakers:[{bookmaker:'stale',fresh:false,h2h:{home:1.7,draw:4.5,away:8},totals:{over25:2,under25:1.9}}]}
});
assert.ok(staleOddsBoard.topPredictions.length>0);
assert.equal(staleOddsBoard.valuePicks.length,0);
assert.equal(staleOddsBoard.selectionPolicy.valueRequiresFreshOdds,true);
console.log('stale odds value gate tests passed');

const extendedValueBoard=buildMarketBoard({
 marketEvidence:sufficientMarketEvidence,
 modelProbabilities:{homeWinProbability:58,drawProbability:24,awayWinProbability:18},
 goalMarkets:{over25GoalsPercent:60,bttsPercent:72,totalGoals:{'1.5':{over:78},'3.5':{over:32,under:68}},scoring:{home:80,away:68},teamGoals:{home:{'1.5':{over:55},'2.5':{over:30},'3.5':{over:12}},away:{'1.5':{over:38},'2.5':{over:16},'3.5':{over:6}}}},
 cornerMetrics:{over95Percent:52,under95Percent:48},
 halfMarkets:{...halves,firstHalf:{...halves.firstHalf,homeScores:74,awayScores:48,over05:79}},
 dataHealth:{score:88},premium:{},evidenceStrength:.85,modelAgreementScore:85,
 extendedOddsBoard:{bookmakers:[{bookmaker:'testbook',fresh:true,btts:{yes:1.55,no:2.55},firstHalf:{home:2.2,draw:2.6,away:5.2},firstHalfTotal05:{over:1.4,under:3.0},firstHalfTeam05:{home:{over:1.55,under:2.45},away:{over:2.25,under:1.65}}}]}
});
assert.ok(extendedValueBoard.allMarkets.find(x=>x.key==='bttsYes')?.verifiedOdds>1);
assert.ok(extendedValueBoard.allMarkets.find(x=>x.key==='fhHomeScores')?.verifiedOdds>1);
assert.equal(extendedValueBoard.allMarkets.find(x=>x.key==='fhHomeScores')?.oddsFresh,true);
console.log('extended odds Top Picks tests passed');
