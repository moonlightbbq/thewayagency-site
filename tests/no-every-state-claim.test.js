/**
 * CONT-01: "Every state requires registered vehicles to carry minimum liability
 * coverage" was untrue (New Hampshire requires proof of financial responsibility
 * only after an accident or conviction, RSA 264:3 and 264:20-21) and was removed
 * from /personal/auto. The same page's "you are legally required to carry auto
 * insurance" was untrue for the same reason (and Kentucky also allows
 * self-insurance, KRS 304.39-080(5)); the motorcycle page's "legally required
 * ... in virtually every state" likewise. This keeps those sentences, and any
 * "every state requires" variant, out of the product data.
 *
 * Reads data/ and src/ only; never runs the build or reads build/.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  ...['content-personal.json', 'content-commercial.json', 'content-life.json', 'content-health.json', 'products.json', 'knowledge-base.json']
    .map((f) => path.join('data', f)),
];

test('no product data says "every state requires"', () => {
  for (const rel of FILES) {
    const fp = path.join(ROOT, rel);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf8');
    assert.doesNotMatch(text, /every state requires/i, `${rel} says "every state requires"`);
    assert.doesNotMatch(text, /legally required to carry (auto|liability) insurance/i, `${rel} says "legally required to carry"`);
    assert.doesNotMatch(text, /virtually every state/i, `${rel} says "virtually every state"`);
  }
});

test('the /personal/auto direct answer keeps its corrected wording', () => {
  const auto = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content-personal.json'), 'utf8')).auto;
  assert.match(auto.direct_answer, /Where the law sets a minimum amount of liability coverage/);
});

test('the auto and motorcycle "who needs it" text uses the proof-of-financial-responsibility wording', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content-personal.json'), 'utf8'));
  for (const k of ['auto', 'motorcycle']) {
    assert.match(d[k].who_needs_it, /likely requires liability coverage or other proof of financial responsibility/, k);
  }
});
