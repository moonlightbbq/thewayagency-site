/**
 * The carrier strip is a static list that names each carrier once (PERF-09):
 * no endless animation, no duplicate names in the accessibility tree, readable
 * contrast. No carrier names or logos are added.
 *
 *   node --test tests/          (npm test)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pages = require('../scripts/builders/pages');

// The generator is internal; reach it through a product page, as the build does.
const carriers = JSON.parse(read('data/carriers.json'));
const names = (html) => [...html.matchAll(/<li class="carriers__logo">([^<]+)<\/li>/g)].map((m) => m[1]);

test('homepage: each carrier named once, same names as before, in a list', () => {
  const html = read('src/pages/index.html');
  const block = html.slice(html.indexOf('<section class="carriers"'), html.indexOf('</section>', html.indexOf('<section class="carriers"')));
  const list = names(block);
  assert.ok(list.length > 5);
  assert.equal(new Set(list).size, list.length, 'a name appears twice');
  assert.deepEqual(list, ['Adaptive', 'Aegis', 'Allstate', 'American Modern', 'Chubb', 'Foremost', 'Grange', 'Hagerty', 'Liberty Mutual', 'Obie', 'Progressive', 'Steadily', 'The Hartford', 'Travelers', 'Zurich']);
  assert.match(block, /<ul class="carriers__list">/);
  assert.doesNotMatch(block, /carriers__track|aria-hidden/);
});

test('product pages: the generated strip names each line carrier once', () => {
  const src = read('scripts/builders/pages.js');
  const fn = src.slice(src.indexOf('function generateCarrierMarquee('), src.indexOf('function getTestimonialsForLine('));
  assert.equal((fn.match(/\$\{carrierItems\}/g) || []).length, 1, 'the list is emitted once');
  assert.match(fn, /<ul class="carriers__list">/);
  // Same set the strip had before: the line's carriers minus intermediaries.
  const personal = (carriers.personal || []).filter((c) => c.type !== 'intermediary').map((c) => c.name);
  assert.ok(personal.length > 0);
  assert.equal(typeof pages.generateProductPage, 'function');
});

test('CSS: no marquee animation; names at --slate (7.46:1), no opacity or grayscale', () => {
  const css = read('src/css/components.css');
  assert.doesNotMatch(css, /carriers__track/);
  assert.doesNotMatch(css, /@keyframes scroll-left/);
  const rule = (css.match(/\.carriers__logo\{[^}]*\}/) || [''])[0];
  assert.match(rule, /color:var\(--slate\)/);
  assert.doesNotMatch(rule, /opacity|grayscale|animation/);
  assert.doesNotMatch(css, /\.carriers[\w-]*\{[^}]*animation/);
});
