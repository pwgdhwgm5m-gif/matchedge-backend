const test=require('node:test');
const assert=require('node:assert/strict');
const coupons=require('../src/routes/coupons');
const create=coupons.stack.find(l=>l.route?.path==='/'&&l.route.methods.post).route.stack[0].handle;
async function request(legs){const res={status(code){this.code=code;return this},json(body){this.body=body;return this}};await create({body:{legs}},res);return res;}
test('analysis-only picks reject the entire new slip before wallet or provider calls',async()=>{
 for(const key of ['over15','over35','under35','homeOver15','homeOver25','homeOver35','awayOver15','awayOver25','awayOver35','homeScores','awayScores','fhHome','fhAway','fhDraw','fhHomeScores','fhAwayScores','fhOver05','shHome','shDraw','shAway','shHomeScores','shAwayScores','shOver05','mostGoalsFirst','mostGoalsEqual','mostGoalsSecond']){
  const res=await request([{selection:{key:'home'}},{selection:{key}}]);
  assert.equal(res.code,422,key);assert.equal(res.body.code,'SELECTION_DISABLED',key);
 }
});
test('seven allowed markets pass the market gate and settle from full-time scores',async()=>{
 for(const [key,home,away,expected] of [['home',2,1,'won'],['draw',1,1,'won'],['away',1,2,'won'],['over25',2,1,'won'],['bttsYes',1,1,'won'],['over25',1,1,'lost'],['bttsYes',2,0,'lost'],['under25',1,1,'won'],['under25',2,1,'lost'],['bttsNo',2,0,'won'],['bttsNo',1,1,'lost']]){
  const res=await request([{selection:{key}}]);
  assert.equal(res.code,400,'missing fixture fields, not a disabled market');
  assert.equal(coupons.settleSelectionWithAvailableData(key,home,away,null,null,null),expected);
 }
});
test('previously saved non-core selections retain their settlement rules',()=>{
 assert.equal(coupons.settleSelectionWithAvailableData('homeOver25',3,1,null,null,null),'won');
 assert.equal(coupons.settleSelectionWithAvailableData('fhAway',0,3,null,0,1),'won');
 assert.equal(coupons.settleSelectionWithAvailableData('cornersOver95',0,3,10,null,null),'won');
});
