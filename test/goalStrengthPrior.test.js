const test=require('node:test');
const assert=require('node:assert/strict');
const {smoothedGoalStrength,temperedExpectedGoals}=require('../src/services/analysisEngine');
const {teamNamesMatch,normalizeTeamName}=require('../src/utils/textNormalize');

test('zero goals in a small history reduces strength without predicting impossible scoring',()=>{
  const attack=smoothedGoalStrength(0,5,1.15);
  assert.ok(attack>0 && attack<1);
  assert.ok(temperedExpectedGoals(attack,.8,1.15)>.25);
});

test('league-average teams retain the league goal prior and extremes remain bounded',()=>{
  assert.equal(smoothedGoalStrength(1.45,15,1.45),1);
  assert.equal(temperedExpectedGoals(1,1,1.45),1.45);
  assert.ok(temperedExpectedGoals(50,50,1.45)<=3.8);
  assert.ok(temperedExpectedGoals(0,0,1.15)>=.25);
});

test('the Czechia national-team alias is exact and does not merge clubs',()=>{
  assert.equal(normalizeTeamName('Czechia'),'czech republic');
  assert.equal(teamNamesMatch('Czechia','Czech Republic'),true);
  assert.equal(teamNamesMatch('Czechia U21','Czech Republic'),false);
  assert.equal(teamNamesMatch('Czechia FC','Czech Republic'),false);
});
