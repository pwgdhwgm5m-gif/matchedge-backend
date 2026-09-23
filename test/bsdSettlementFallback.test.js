const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BSD_API_KEY = 'regression-test-key';

const originalFetch = global.fetch;
const event = {
  id: 220182,
  home_team: { name: 'Independiente Santa Fe' },
  away_team: { name: 'Deportivo Cali' },
  date: '2026-09-23T01:00:00Z',
  status_short: 'FT',
  home_score: 0,
  away_score: 1,
  league: { name: 'Categoría Primera A', id: 80 },
};

global.fetch = async function mockedBsdFetch(url) {
  const path = String(url);
  if (path.includes('/events/220182/')) {
    return { ok: true, json: async () => ({ data: event }) };
  }
  if (path.includes('/events/?')) {
    return { ok: true, json: async () => ({ results: [event] }) };
  }
  if (path.includes('/leagues/')) {
    return { ok: true, json: async () => ({ results: [{ id: 80, name: 'Categoría Primera A' }] }) };
  }
  throw new Error(`Unexpected BSD URL in regression test: ${path}`);
};

const bsd = require('../src/services/bsdService');

test.after(() => {
  global.fetch = originalFetch;
});

test('BSD event-id final resolver returns a score without an undefined event reference', async () => {
  const result = await bsd.getFinalResultByEventId('220182');
  assert.equal(result.available, true);
  assert.deepEqual(
    { home: result.homeScore, away: result.awayScore },
    { home: 0, away: 1 },
  );
});

test('BSD team and kickoff final resolver returns a score without an undefined e reference', async () => {
  const result = await bsd.getFinalResultForMatch(
    'Independiente Santa Fe',
    'Deportivo Cali',
    '2026-09-23T01:00:00Z',
  );
  assert.equal(result.available, true);
  assert.equal(String(result.eventId), '220182');
  assert.equal(result.homeScore, 0);
  assert.equal(result.awayScore, 1);
});

test('BSD raw final result pool keeps finished matches with zero scores', async () => {
  const result = await bsd.getRawFinalMatchesForDate('2026-09-23');
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.matches.find(match => match.bsdEventId === '220182')?.homeScore,
    0,
  );
});
