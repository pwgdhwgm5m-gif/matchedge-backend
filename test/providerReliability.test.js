const assert = require('assert');
const sportmonks = require('../src/services/sportmonksService');
const bsd = require('../src/services/bsdService');

function fixture(overrides = {}) {
  return {
    id: 101,
    state_id: 1,
    participants: [
      { id: 1, name: 'Home', meta: { location: 'home' } },
      { id: 2, name: 'Away', meta: { location: 'away' } },
    ],
    scores: [
      { type_id: 1, score: { participant: 'home', goals: 1 } },
      { type_id: 1, score: { participant: 'away', goals: 0 } },
      { description: 'CURRENT', score: { participant: 'home', goals: 2 } },
      { description: 'CURRENT', score: { participant: 'away', goals: 1 } },
    ],
    periods: [],
    ...overrides,
  };
}

[
  {
    name: 'numeric first-half score ids are accepted',
    input: fixture(),
    expected: { halftimeHome: 1, halftimeAway: 0, minute: null },
  },
  {
    name: 'future unstarted periods do not produce a minute',
    input: fixture({
      state_id: 1,
      periods: [{ type_id: 18, started_at: null, ended_at: null }],
      time: { minute: 45 },
    }),
    expected: { halftimeHome: 1, halftimeAway: 0, minute: null },
  },
  {
    name: 'ticking periods and live fixture time are accepted',
    input: fixture({
      state_id: 2,
      periods: [{ type_id: 18, ticking: true, minutes: 27, ended_at: null }],
    }),
    expected: { halftimeHome: 1, halftimeAway: 0, minute: 27 },
  },
].forEach(testCase => {
  const actual = sportmonks.transformFixture(testCase.input);
  assert.strictEqual(actual.halftimeHome, testCase.expected.halftimeHome, testCase.name);
  assert.strictEqual(actual.halftimeAway, testCase.expected.halftimeAway, testCase.name);
  assert.strictEqual(actual.minute, testCase.expected.minute, testCase.name);
});

[
  { input: { status_short: null, state: { short_name: 'FT' } }, expected: 'FT' },
  { input: { status_short: null, state: { short_name: 'LIVE' } }, expected: 'LIVE' },
  { input: { status_short: '', status: 'finished' }, expected: 'finished' },
].forEach(testCase => {
  assert.strictEqual(bsd.eventStatusText(testCase.input), testCase.expected);
});

[
  { status_short: null, state: { short_name: 'FT' }, expected: false },
  { status_short: null, state: { short_name: '2H' }, expected: true },
].forEach((status, index) => {
  const match = bsd.eventToResultMatch({
    id: index + 1,
    home: 'Home',
    away: 'Away',
    home_score: 1,
    away_score: 0,
    ...status,
  });
  assert.strictEqual(match.isLive, status.expected);
});

console.log('provider reliability tests passed');