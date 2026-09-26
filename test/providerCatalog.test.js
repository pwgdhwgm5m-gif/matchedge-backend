const test=require('node:test');
const assert=require('node:assert/strict');
const bsd=require('../src/services/bsdService');
const router=require('../src/routes/providerCatalog');
const handler=router.stack.find(x=>x.route?.path==='/').route.stack[0].handle;

test('catalog uses only live verified BSD league IDs and retains separate provider namespaces',async()=>{
  const original=bsd.getLeagueRegistry;
  bsd.getLeagueRegistry=async()=>({ok:true,map:{'83':{id:'83',name:'Eerste Divisie',country:'Netherlands'}}});
  try{
    const res={json(body){this.body=body;}};
    await handler({},res);
    const dutch=res.body.competitions.find(x=>x.key==='netherlands-eerste-divisie');
    const england=res.body.competitions.find(x=>x.key==='england-premier-league');
    assert.equal(dutch.providerIds.bsd,'83');
    assert.equal(dutch.providerIds.sportsdb,'4641');
    assert.equal(dutch.providerIds.sportmonks,null);
    assert.equal(england.providerIds.sportmonks,'8');
    assert.equal(england.providerIds.bsd,null);
  }finally{bsd.getLeagueRegistry=original;}
});
