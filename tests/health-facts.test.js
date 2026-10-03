/**
 * data/health-facts.json and scripts/lib/health-facts.js (TRUST-04): dated
 * values that product copy reads as {{fact:<id>}} tokens, kept in one place.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveFacts, factProblems, factTokens } = require('../scripts/lib/health-facts');

const ROOT = path.join(__dirname, '..');
const FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'health-facts.json'), 'utf8'));
const fixture = { facts: [{ id: 'f_one', value: 'Value one', sources: [{ title: 'T', url: 'https://example.com/x' }], retrieved_on: '2026-10-02', review_by: '2026-10-31' }] };

describe('health facts', () => {
  test('tokens resolve deep in strings, arrays and objects; unknown tokens stay for the guard', () => {
    const out = resolveFacts({ a: 'x {{fact:f_one}} y', list: ['{{fact:f_one}}', 3], faq: [{ answer: '{{fact:missing}}' }] }, fixture);
    assert.deepEqual(out, { a: 'x Value one y', list: ['Value one', 3], faq: [{ answer: '{{fact:missing}}' }] });
    assert.deepEqual(factTokens('a {{fact:x}} b {{ fact : y }}'), ['{{fact:x}}', '{{ fact : y }}']);
  });

  test('validation: unknown tokens, unsafe values, missing sources and dates are problems; a passed review_by warns', () => {
    const ok = factProblems(fixture, { today: new Date('2026-10-02T12:00:00Z'), usedIn: [['x', '{{fact:f_one}}']] });
    assert.deepEqual(ok, { problems: [], warnings: [] });
    assert.ok(factProblems(fixture, { usedIn: [['x', '{{fact:nope}}']] }).problems.some((p) => /names no fact/.test(p)));
    const bad = { facts: [{ id: 'Bad Id', value: 'a <b>', sources: [], retrieved_on: 'today', review_by: '' }] };
    assert.ok(factProblems(bad).problems.length >= 4);
    assert.ok(factProblems(fixture, { today: new Date('2026-11-02T12:00:00Z') }).warnings.some((w) => /review_by/.test(w)));
  });

  test('the site file is valid and every token in data/content-*.json resolves', () => {
    const usedIn = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'data')).filter((n) => /^content-.*\.json$/.test(n))) {
      usedIn.push([f, fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')]);
    }
    assert.deepEqual(factProblems(FACTS, { today: new Date('2026-10-02T12:00:00Z'), usedIn }).problems, []);
  });

  test('plan year 2027 Marketplace dates: as of October 2026, Nov 1, 2026 to Jan 15, 2027, Dec 15 for January 1 coverage', () => {
    const f = FACTS.facts.find((x) => x.id === 'marketplace_oe_py2027');
    assert.ok(f, 'the fact exists');
    assert.match(f.value, /^As of October 2026, /);
    assert.ok(f.value.includes('November 1, 2026 to January 15, 2027'));
    assert.ok(f.value.includes('enroll by December 15, 2026 for coverage that starts January 1, 2027'));
    assert.ok(!/December 31/.test(f.value), 'the vacated end-by-December-31 rule is not stated');
  });

  test('the knowledge base carries no token (SAGE reads it as written)', () => {
    const kb = fs.readFileSync(path.join(ROOT, 'data', 'knowledge-base.json'), 'utf8');
    assert.deepEqual(factTokens(kb), []);
  });
});
