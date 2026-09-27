const test=require('node:test');
const assert=require('node:assert/strict');
const coupons=require('../src/routes/coupons');
const Coupon=require('../src/models/Coupon');
const bsd=require('../src/services/bsdService');
const sportsDb=require('../src/services/sportsDbService');
const identity=require('../src/services/fixtureIdentityService');
const kickoff=new Date(Date.now()-3*3600000).toISOString();
const date=kickoff.slice(0,10);
const match={fixtureId:'bsd-verified',homeTeam:'Israel',awayTeam:'Ireland',kickoff,statusShort:'FT',homeScore:0,awayScore:3,halftimeHome:null,halftimeAway:null};
function setup(t,detail){
 t.mock.method(identity,'lookup',async()=>null);
 t.mock.method(sportsDb,'getEventById',async()=>({ok:false}));
 t.mock.method(sportsDb,'getMatchesByDate',async()=>({ok:true,data:{events:[]}}));
 t.mock.method(bsd,'getRawFinalMatchesForDate',async()=>({ok:true,matches:[match]}));
 return t.mock.method(bsd,'getEventById',async id=>{assert.equal(id,'bsd-verified');return {available:true,match:detail};});
}
const resolve=keys=>coupons.canonicalResult(date,'legacy-id','Israel','Ireland',{},'',kickoff,null,keys);
test('half market enriches a final pool result from verified native detail',async t=>{
 setup(t,{...match,halftimeHome:0,halftimeAway:1});
 const result=await resolve(['fhAway']);
 assert.equal(result.match.halftimeAway,1);
 assert.equal(coupons.settleSelectionWithAvailableData('fhAway',0,3,null,result.match.halftimeHome,result.match.halftimeAway),'won');
 assert.equal(match.halftimeAway,null,'cached pool is not mutated');
});
test('full-time selection does not request extra halftime data',async t=>{
 const detail=setup(t,{...match,halftimeHome:0,halftimeAway:1});
 await resolve(['away']);
 assert.equal(detail.mock.callCount(),0);
});
test('mismatched detail cannot settle a half market',async t=>{
 setup(t,{...match,awayTeam:'Northern Ireland',homeScore:2,halftimeHome:0,halftimeAway:1});
 const result=await resolve(['fhAway']);
 assert.equal(result.match.halftimeAway,null);
 assert.equal(coupons.settleSelectionWithAvailableData('fhAway',0,3,null,null,null),'pending');
});
test('lost coupon continues to settle its remaining leg without a second reward',async t=>{
 setup(t,{...match,halftimeHome:0,halftimeAway:1});
 let saved=false;
 const coupon={status:'lost',rewardedAt:new Date(),legs:[{selection:{key:'home',result:'lost'}},{...match,matchDate:date,selection:{key:'fhAway',result:'pending'}}],markModified(){},async save(){saved=true;}};
 t.mock.method(Coupon,'find',query=>{
  assert.ok(query.$or.some(q=>q['legs.selection.result']==='pending'));
  return {sort(){return this},limit:async()=>[coupon]};
 });
 const rewards=t.mock.method(Coupon,'findOneAndUpdate',async()=>{throw Error('unexpected reward');});
 await coupons.settlePending('test-user');
 assert.equal(saved,true);
 assert.equal(coupon.status,'lost');
 assert.deepEqual(coupon.legs.map(l=>l.selection.result),['lost','won']);
 assert.equal(rewards.mock.callCount(),0);
});
