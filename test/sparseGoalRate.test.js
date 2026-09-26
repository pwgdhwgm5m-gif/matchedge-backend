const test = require('node:test');
const assert = require('node:assert/strict');
const { regularizeSparseGoalRate, goalRateCeiling } = require('../src/services/analysisEngine');

test('four venue matches temper an unsupported extreme while preserving direction', () => {
  assert.equal(regularizeSparseGoalRate(4.34, 1.45, 4, false), 2.61);
  assert.equal(regularizeSparseGoalRate(0.8, 1.15, 4, false), 1.01);
});

test('independent eight-match evidence prevents a low structural product from capping the goal ensemble',()=>{
  assert.ok(goalRateCeiling(.43,1.3,15,true)>1.3);
  assert.equal(goalRateCeiling(.43,1.3,4,true),.43*1.38);
  assert.equal(goalRateCeiling(.43,1.3,15,false),.43*1.38);
});

test('five venue matches or independent chance evidence keep the model rate', () => {
  assert.equal(regularizeSparseGoalRate(4.34, 1.45, 5, false), 4.34);
  assert.equal(regularizeSparseGoalRate(4.34, 1.45, 4, true), 4.34);
  assert.equal(regularizeSparseGoalRate(2.1, 1.45, 0, false), 2.1);
});
