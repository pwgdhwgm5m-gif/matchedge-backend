const test=require('node:test');
const assert=require('node:assert/strict');
const {liveMinute,signalTiming}=require('../src/services/liveSignalTiming');
const kickoff=Date.parse('2026-09-29T18:45:00Z')/1000;

test('missing or zero 5Dollar minute does not discard a verified live fixture',()=>{
  const f={minute:null,time:{minute:null},kickoff_ts:kickoff};
  assert.equal(liveMinute(f),null);
  assert.deepEqual(signalTiming(f,Date.parse('2026-09-29T19:56:00Z')),{eligible:true,minute:null});
  assert.deepEqual(signalTiming({...f,minute:0},Date.parse('2026-09-29T19:56:00Z')),{eligible:true,minute:null});
  assert.equal(signalTiming(f,Date.parse('2026-09-29T18:49:00Z')).eligible,false);
  assert.equal(signalTiming(f,Date.parse('2026-09-29T20:50:00Z')).eligible,false);
});

test('observed match minute is used without estimating an alternative',()=>{
  const f={minute:null,time:{minute:56},kickoff_ts:kickoff};
  assert.deepEqual(signalTiming(f,Date.parse('2026-09-29T19:56:00Z')),{eligible:true,minute:56});
  assert.equal(signalTiming({...f,minute:90},Date.parse('2026-09-29T19:56:00Z')).eligible,false);
});
