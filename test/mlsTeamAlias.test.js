const test = require('node:test');
const assert = require('node:assert/strict');
const { teamNamesMatch } = require('../src/utils/textNormalize');
test('MLS alias St.Louis City matches St. Louis City SC',()=>assert.equal(teamNamesMatch('St.Louis City','St. Louis City SC'),true));
test('alias matching rejects unrelated clubs',()=>{assert.equal(teamNamesMatch('City','St. Louis City SC'),false);assert.equal(teamNamesMatch('New York City FC','New York Red Bulls'),false);});
