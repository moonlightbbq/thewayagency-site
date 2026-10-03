/**
 * Hero CTA labels use the right article (CONV-04: "Get a Auto Insurance Quote").
 *
 *   node --test tests/          (npm test)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { quoteCtaLabel } = require('../scripts/builders/pages');

const products = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'));
  const out = [];
  (function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') { if (typeof v.name === 'string' && v.id) out.push(v.name); Object.values(v).forEach(walk); }
  })(raw);
  return out;
})();

test('every product name gets a grammatical article', () => {
  assert.ok(products.length > 20, `expected the product list, got ${products.length}`);
  for (const name of products) {
    const label = quoteCtaLabel(name);
    assert.doesNotMatch(label, /^Get a [AEIOaeio]/, label);
    assert.doesNotMatch(label, /^Get an [^AEIOUaeiou]/, label);
  }
});

test('the five audited heroes', () => {
  assert.equal(quoteCtaLabel('Auto Insurance'), 'Get an Auto Insurance Quote');
  assert.equal(quoteCtaLabel('Umbrella Insurance'), 'Get an Umbrella Insurance Quote');
  assert.equal(quoteCtaLabel('Earthquake Insurance'), 'Get an Earthquake Insurance Quote');
  assert.equal(quoteCtaLabel('Individual Health'), 'Get an Individual Health Quote');
  assert.match(quoteCtaLabel('Annuities'), /^Get an Annuit/);
});

test('consonant and "yoo" sounds keep "a"', () => {
  assert.equal(quoteCtaLabel('Home Insurance'), 'Get a Home Insurance Quote');
  assert.equal(quoteCtaLabel('Universal Life'), 'Get a Universal Life Quote');
  assert.equal(quoteCtaLabel('Usage-Based Auto'), 'Get a Usage-Based Auto Quote');
});
