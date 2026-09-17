const assert = require('node:assert/strict');
const { buildPremiumIntelligence } = require('../src/services/premiumIntelligenceService');

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
