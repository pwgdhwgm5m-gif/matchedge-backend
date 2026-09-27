const test=require('node:test');
const assert=require('node:assert/strict');
const coupons=require('../src/routes/coupons');

test('new 9.5 and legacy 8.5 corner legs are rejected before wallet or provider calls',async()=>{
  const create=coupons.stack.find(layer=>layer.route?.path==='/'&&layer.route.methods.post).route.stack[0].handle;
  for(const key of ['cornersOver95','cornersUnder95','cornersOver85','cornersUnder85']){
    const req={body:{legs:[{fixtureId:'1',homeTeam:'A',awayTeam:'B',selection:{key}}]}};
    const response={status(code){this.code=code;return this},json(body){this.body=body;return this}};
    await create(req,response);
    assert.equal(response.code,422);
    assert.equal(response.body.code,'CORNER_SELECTION_DISABLED');
  }
});

test('previously played corner coupons still settle with recorded corner data',()=>{
  assert.equal(coupons.settleSelectionWithAvailableData('cornersOver95',1,0,10,null,null),'won');
  assert.equal(coupons.settleSelectionWithAvailableData('cornersUnder85',1,0,8,null,null),'won');
  assert.equal(coupons.settleSelectionWithAvailableData('cornersOver95',1,0,null,null,null),'pending');
});
