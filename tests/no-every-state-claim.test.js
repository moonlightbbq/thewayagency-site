/**
 * CONT-01: "Every state requires registered vehicles to carry minimum liability
 * coverage" was untrue (New Hampshire requires proof of financial responsibility
 * only after an accident or conviction, RSA 264:3 and 264:20-21) and was removed
 * from /personal/auto. This keeps the sentence, and any "every state requires"
 * variant, out of the product data and hand-made pages.
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
  }
});

test('the /personal/auto direct answer keeps its corrected wording', () => {
  const auto = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content-personal.json'), 'utf8')).auto;
  assert.match(auto.direct_answer, /Where the law sets a minimum amount of liability coverage/);
});
