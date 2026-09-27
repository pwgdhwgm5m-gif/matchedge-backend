const test=require('node:test');
const assert=require('node:assert/strict');
const {runGoalSources}=require('../src/services/goalSourceRunner');

test('a fast goal is processed while a slow provider remains pending',async()=>{
  let releaseSlow;
  const slow=new Promise(resolve=>{releaseSlow=resolve});
  const observed=[];
  const cycle=runGoalSources([
    {fetch:()=>slow,transform:r=>r.goals},
    {fetch:async()=>({ok:true,goals:['fast']}),transform:r=>r.goals}
  ],async goals=>observed.push(...goals));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(observed,['fast']);
  releaseSlow({ok:true,goals:['slow']});
  assert.equal((await cycle).every(row=>row.status==='fulfilled'),true);
  assert.deepEqual(observed,['fast','slow']);
});
