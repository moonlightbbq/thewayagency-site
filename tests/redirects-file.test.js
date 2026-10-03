/**
 * The real _redirects (TECH-07): syntax, order and one-hop destinations, and
 * one /life-health/<product> rule per life and health product in
 * data/products.json, above the /life-health/* catch-all. Whether each
 * destination is a built page is checked after the build by
 * scripts/validate-build.js (section 9b).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { redirectProblems, parseRedirects } = require('../scripts/lib/url-hygiene');

const REPO = path.join(__dirname, '..');
const text = fs.readFileSync(path.join(REPO, '_redirects'), 'utf8');
const rules = parseRedirects(text);
const products = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'products.json'), 'utf8'));

test('_redirects has no host rule, no .html destination, no chain and no unreachable rule', () => {
  assert.deepEqual(redirectProblems(text, null, null), []);
});

test('every life and health product has a one-hop /life-health/<slug> rule above the catch-all', () => {
  const catchAll = rules.findIndex((r) => r.source === '/life-health/*');
  assert.ok(catchAll >= 0, 'the /life-health/* catch-all stays');
  assert.equal(rules[catchAll].destination, '/life/');
  let n = 0;
  for (const line of ['life', 'health']) {
    for (const p of products[line] || []) {
      const i = rules.findIndex((r) => r.source === `/life-health/${p.slug}`);
      assert.ok(i >= 0, `/life-health/${p.slug} has a rule`);
      assert.ok(i < catchAll, `/life-health/${p.slug} sits above /life-health/*`);
      assert.equal(rules[i].destination, `/${line}/${p.slug}`);
      assert.equal(rules[i].status, 301);
      n++;
    }
  }
  assert.equal(n, 12);
});

test('the SPA rewrites are unchanged', () => {
  for (const dir of ['intake', 'portal', 'partner']) {
    const r = rules.find((x) => x.source === `/${dir}/*`);
    assert.ok(r, dir);
    assert.equal(r.destination, `/${dir}/index.html`);
    assert.equal(r.status, 200);
  }
});
