const test=require('node:test');
const assert=require('node:assert/strict');
const cache=require('../src/utils/cache');
const router=require('../src/routes/matches');

test('daily fixture route never requests legacy Odds API or BSD feeds',async()=>{
  const original=cache.getOrFetch; const requested=[];
  try{
    cache.getOrFetch=async key=>{requested.push(key);return key.startsWith('fixtures:')?{ok:true,data:{events:[]}}:{ok:false,fixtures:[],matches:[]}};
    const handler=router.stack.find(x=>x.route?.path==='/').route.stack[0].handle;
    const response={statusCode:200,status(n){this.statusCode=n;return this},json(data){this.body=data;return this}};
    await handler({query:{date:'2026-09-27'}},response);
    assert.equal(requested.some(k=>k.startsWith('odds-events:')),false);
    assert.equal(requested.some(k=>k.startsWith('bsd:')),false);
    assert.equal(requested.some(k=>k.startsWith('five-dollar:fixtures:')),true);
    assert.equal(requested.some(k=>k.startsWith('sportmonks:date:')),true);
  }finally{cache.getOrFetch=original;}
});
