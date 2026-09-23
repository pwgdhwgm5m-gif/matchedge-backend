const test = require('node:test');
const assert = require('node:assert/strict');
const { outcomes } = require('../src/services/predictionLedgerService');
const { grade } = require('../src/services/communityPickSettlementService');
const coupons = require('../src/routes/coupons');

test('canonical FT and HT outcomes use the same score rules', () => {
  const actual = outcomes({ homeScore: 2, awayScore: 1, halftimeHome: 1, halftimeAway: 1 });
  assert.equal(actual.home, 1);
  assert.equal(actual.over25, 1);
  assert.equal(actual.fhDraw, undefined);
  assert.equal(actual.fhOver05, 1);
  assert.equal(actual.shHomeScores, 1);
  assert.equal(grade('home', 2, 1, null, 1, 1), 'won');
  assert.equal(grade('fhDraw', 2, 1, null, 1, 1), 'won');
});

test('HT-dependent selections become void after the documented grace period', () => {
  assert.equal(coupons.settleSelectionWithAvailableData('fhOver05', 2, 1, null, null, null), 'pending');
  assert.equal(coupons.settleSelectionWithAvailableData('fhOver05', 2, 1, null, null, null, true), 'void');
});

test('final score remains usable for non-HT selections when HT is absent', () => {
  assert.equal(coupons.settleSelectionWithAvailableData('over25', 2, 1, null, null, null), 'won');
  const ungraded = outcomes({ homeScore: 2, awayScore: 1 }, { halftimeUnavailable: true });
  assert.equal(ungraded.settlementStatus, 'ungraded');
  assert.match(ungraded.settlementReason, /halftime_data_unavailable/);
});