const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const coupons=require('../src/routes/coupons');
const communitySettlement=require('../src/services/communityPickSettlementService');
const Prediction=require('../src/models/PredictionSnapshot');
const CommunityPick=require('../src/models/CommunityPick');

const canonical={homeTeam:'Alpha FC',awayTeam:'Beta FC',kickoff:'2026-09-23T18:00:00Z'};

test('an exact provider id can never replace team and kickoff identity checks',()=>{
  assert.equal(coupons.verifiedFixtureMatch(
    {homeTeam:'Other',awayTeam:'Fixture',kickoff:canonical.kickoff},canonical.homeTeam,canonical.awayTeam,canonical.kickoff
  ),false);
  assert.equal(coupons.verifiedFixtureMatch(
    {homeTeam:'Alpha',awayTeam:'Beta',kickoff:'2026-09-24T18:00:00Z'},canonical.homeTeam,canonical.awayTeam,canonical.kickoff
  ),false);
  assert.equal(coupons.verifiedFixtureMatch(
    {homeTeam:'Alpha',awayTeam:'Beta',kickoff:'2026-09-23T18:05:00Z'},canonical.homeTeam,canonical.awayTeam,canonical.kickoff
  ),true);
  assert.equal(communitySettlement.identityMatch(
    {homeTeam:'Other',awayTeam:'Fixture',kickoff:canonical.kickoff},canonical
  ),false);
});

test('coupon publication and provider identity come from the snapshot, not the request',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/coupons.js'),'utf8');
  assert.match(source,/\['PICK','VALUE'\]\.includes\(snapshot\?\.publicationStatus\)/);
  assert.match(source,/leg\.providerIds=\{sportmonks:'',bsd:'',sportsdb:'',footballData:'',\[canonicalProvider\]:canonicalId\}/);
  assert.doesNotMatch(source,/providerIds:\{sportsdb:String\(leg\.providerIds/);
});

test('provider namespaces are part of durable unique identities',()=>{
  const predictionIndexes=Prediction.schema.indexes();
  assert.ok(predictionIndexes.some(([fields,options])=>fields.canonicalFixtureKey===1&&fields.modelVersion===1&&options.unique===true));
  assert.ok(!predictionIndexes.some(([fields,options])=>fields.fixtureId===1&&fields.modelVersion===1&&options.unique===true));
  const communityIndexes=CommunityPick.schema.indexes();
  assert.ok(communityIndexes.some(([fields,options])=>fields.userId===1&&fields.canonicalFixtureKey===1&&fields.key===1&&options.unique===true));
});

test('coupon refund is claimed by atomic deletion before wallet credit',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/coupons.js'),'utf8');
  const route=source.slice(source.indexOf("router.delete('/:id',"));
  assert.ok(route.indexOf('Coupon.findOneAndDelete')>=0);
  assert.ok(route.indexOf('Coupon.findOneAndDelete')<route.indexOf('edgeCoins:refund'));
  assert.doesNotMatch(route,/await coupon\.deleteOne\(\)/);
});
