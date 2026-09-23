const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { rateLimit, clearRateLimitBuckets } = require('../src/middleware/rateLimit');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('auth limiter returns 429 with Retry-After after the configured budget', () => {
  clearRateLimitBuckets();
  const middleware = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 'test' });
  const req = { ip: '198.51.100.10', headers: {}, socket: {} };
  let passed = 0;
  middleware(req, response(), () => { passed += 1; });
  const limited = response();
  middleware(req, limited, () => { passed += 1; });
  assert.equal(passed, 1);
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['Retry-After']) >= 1);
});

test('public registration does not contain an admin role assignment or recovery path', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  assert.doesNotMatch(source, /role:\s*isReservedAdmin\s*\?\s*['"]admin['"]/);
  assert.doesNotMatch(source, /recovered:\s*true/);
});