const test=require('node:test');
const assert=require('node:assert/strict');
const svc=require('../src/services/fiveDollarFootballService');

test('native 5Dollar Bet365 JSON exposes closing 1X2, 2.5, BTTS and corner line',()=>{
 const root={
  '1x2':{opening:{home:2.1,draw:3.2,away:3.4},closing:{home:2.0,draw:3.3,away:3.6},inplay:null},
  goal_line_fixed:[{line:2.5,opening:{over:1.95,under:1.85},closing:{over:1.9,under:1.9},inplay:null}],
  btts:{opening:{yes:1.8,no:1.95},closing:{yes:1.75,no:2.0},inplay:null},
  corner_line:{opening:{line:9.5,over:1.85,under:1.85},closing:{line:10.5,over:1.9,under:1.8},inplay:null}
 };
 const m=svc.normalizeMarkets(root);assert.deepEqual(m.h2h,{home:2,draw:3.3,away:3.6});assert.deepEqual(m.totals,{over25:1.9,under25:1.9});assert.deepEqual(m.btts,{yes:1.75,no:2});
 const corner=svc.normalizeCornerMarket(root);assert.equal(corner.line,10.5);assert.equal(corner.over,1.9);assert.equal(corner.under,1.8);
});
