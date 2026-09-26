const test=require('node:test');
const assert=require('node:assert/strict');
const {BsdRequestBudget}=require('../src/services/bsdRequestBudget');

test('BSD budget reserves before concurrent requests and resets at UTC midnight',()=>{
  let now=Date.parse('2026-09-26T23:59:58Z');
  const budget=new BsdRequestBudget({dailyBudget:2,remainingReserve:1,now:()=>now});
  assert.equal(budget.reserve(),true);
  assert.equal(budget.reserve(),true);
  assert.equal(budget.reserve(),false);
  now=Date.parse('2026-09-27T00:00:00Z');
  assert.equal(budget.reserve(),true);
});

test('BSD remaining header preserves a reserve and 429 obeys Retry-After',()=>{
  let now=Date.parse('2026-09-26T12:00:00Z');
  const budget=new BsdRequestBudget({dailyBudget:100,remainingReserve:4,now:()=>now});
  assert.equal(budget.reserve(),true);
  budget.observe({status:200,headers:{get:key=>key==='ratelimit'?'"football";r=5;t=43200':null}});
  assert.equal(budget.reserve(),true);
  assert.equal(budget.reserve(),false);
  budget.observe({status:429,headers:{get:key=>key==='retry-after'?'10':null}});
  now+=9000;
  assert.equal(budget.reserve(),false);
  now+=2000;
  // The account's last known daily reserve still blocks further calls.
  assert.equal(budget.reserve(),false);
});
