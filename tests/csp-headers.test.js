/**
 * TECH-08: the site-wide Content-Security-Policy in _headers allows what
 * Google's tag CSP guide (2026-09-18) lists for GA4 with Google signals and
 * for GTM Preview mode, and never 'unsafe-eval'.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HEADERS = fs.readFileSync(path.join(__dirname, '..', '_headers'), 'utf8');

function csp() {
  const lines = HEADERS.split('\n').filter((l) => /^\s+Content-Security-Policy:/.test(l));
  assert.equal(lines.length, 1, 'expected exactly one Content-Security-Policy header');
  const out = {};
  for (const d of lines[0].replace(/^\s+Content-Security-Policy:\s*/, '').split(';')) {
    const [name, ...sources] = d.trim().split(/\s+/);
    if (name) out[name] = sources;
  }
  return out;
}

describe('CSP (TECH-08)', () => {
  const p = csp();
  const want = {
    'script-src': ['https://tagmanager.google.com'],
    'style-src': ['https://tagmanager.google.com'],
    'font-src': ['data:'],
    'connect-src': ['https://*.g.doubleclick.net', 'https://*.google-analytics.com', 'https://www.googletagmanager.com'],
    // https://c.bing.com: Clarity's Bing sync, allowed by owner decision D10 (OA-29).
    'img-src': ['https://*.g.doubleclick.net', 'https://*.google-analytics.com', 'https://c.bing.com'],
  };
  for (const [dir, tokens] of Object.entries(want)) {
    test(`${dir} allows ${tokens.join(', ')}`, () => {
      assert.ok(p[dir], `${dir} missing`);
      for (const t of tokens) assert.ok(p[dir].includes(t), `${dir} lacks ${t}`);
    });
  }

  test("no directive allows 'unsafe-eval'", () => {
    for (const [dir, sources] of Object.entries(p)) assert.ok(!sources.includes("'unsafe-eval'"), `${dir} allows 'unsafe-eval'`);
    assert.doesNotMatch(HEADERS.split('\n').find((l) => /Content-Security-Policy:/.test(l)), /unsafe-eval/);
  });

  test('the sources that were there before are kept', () => {
    for (const t of ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com', 'https://www.googletagmanager.com', 'https://*.clarity.ms', 'https://connect.facebook.net']) {
      assert.ok(p['script-src'].includes(t), `script-src lost ${t}`);
    }
    for (const t of ['https://sage.thewayagency.com', 'https://region1.google-analytics.com', 'https://*.clarity.ms', 'https://www.facebook.com']) {
      assert.ok(p['connect-src'].includes(t), `connect-src lost ${t}`);
    }
    assert.ok(p['font-src'].includes('https://fonts.gstatic.com'));
    assert.deepEqual(p['frame-ancestors'], ["'none'"]);
    assert.deepEqual(p['default-src'], ["'self'"]);
  });
});
