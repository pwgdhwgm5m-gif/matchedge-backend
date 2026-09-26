const test = require('node:test');
const assert = require('node:assert/strict');
const { calibrationScopes, requiredSample, fit, MARKET_POLICY } = require('../src/services/modelCalibrationService');

test('UEFA and Dutch snapshots only train their own competition', () => {
  assert.deepEqual(calibrationScopes('UEFA Nations League'), ['UEFA Nations League']);
  assert.deepEqual(calibrationScopes('Dutch Eerste Divisie'), ['Dutch Eerste Divisie']);
  assert.deepEqual(calibrationScopes('England Premier League'), ['England Premier League','all']);
  assert.deepEqual(calibrationScopes('Ireland Premier Division'), ['Ireland Premier Division']);
});

test('a sparse league cannot activate calibration without chronological validation', () => {
  const rows=Array.from({length:40},(_,i)=>({p:.6,y:i%2}));
  assert.equal(fit(rows,MARKET_POLICY.over25.minTrain,MARKET_POLICY.over25.minValidation),null);
  assert.equal(requiredSample('over25'),80);
  assert.equal(requiredSample('over25',true),107);
});
