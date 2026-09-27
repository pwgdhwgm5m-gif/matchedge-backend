const test=require('node:test');
const assert=require('node:assert/strict');
const cache=require('../src/utils/cache');
const router=require('../src/routes/matches');

test('slow Odds API fixture fallback does not hold the daily fixture response',async()=>{
  const original=cache.getOrFetch;
  let release;
  let calls=0;
  const pending=new Promise(resolve=>{release=resolve});
  try{
    cache.getOrFetch=(key)=>{
      if(key.startsWith('odds-events:')){calls++;return pending}
      if(key.startsWith('bsd:canonical-results:'))return Promise.resolve({ok:true,matches:[{
        fixtureId:'bsd-1',bsdEventId:'bsd-1',league:'Eerste Divisie',
        leagueCountry:'Netherlands',homeTeam:'Dordrecht',awayTeam:'Almere City',
        kickoff:'2026-09-27T18:00:00Z'
      }]});
      return Promise.resolve({ok:false,fixtures:[],matches:[]});
    };
    const handler=router.stack.find(x=>x.route?.path==='/').route.stack[0].handle;
    const response={statusCode:200,status(n){this.statusCode=n;return this},json(data){this.body=data;return this}};
    const start=Date.now();
    await handler({query:{date:'2026-09-27'}},response);
    assert.ok(Date.now()-start<2000,'fixture response must not wait for the full Odds API league scan');
    assert.equal(response.statusCode,200);
    assert.equal(response.body.matches.length,1);
    assert.equal(calls,1);
  }finally{
    release({ok:true,matches:[]});
    cache.getOrFetch=original;
  }
});
