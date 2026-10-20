'use strict';
// The 16-bit birthday card (/happy-birthday). The birthday person's name is read
// from the URL fragment at runtime, so no customer name is ever written into the
// page, the script, the build or git. Reads the source files; never builds.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'happy-birthday.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'birthday.js'), 'utf8');

// Run the script with no canvas on the page: init() returns early and only the
// public helpers are set up.
function load(hash) {
  const window = { location: { hash: hash || '' } };
  const context = {
    window, location: window.location,
    document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
  };
  vm.runInNewContext(js, context);
  return window.BdayCard;
}

test('birthday page is built, noindexed and canonical', () => {
  const assets = fs.readFileSync(path.join(ROOT, 'scripts', 'builders', 'assets.js'), 'utf8');
  assert.match(assets, /'happy-birthday\.html'/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.thewayagency\.com\/happy-birthday">/);
});

test('quote button hands off to the intake with attribution and no personal data', () => {
  const m = html.match(/id="bdQuote" href="([^"]+)"/);
  assert.ok(m, 'quote link present');
  const url = new URL(m[1].replace(/&amp;/g, '&'), 'https://www.thewayagency.com');
  assert.strictEqual(url.pathname, '/intake/');
  assert.strictEqual(url.searchParams.get('src'), 'bday-card');
  assert.strictEqual(url.searchParams.get('utm_source'), 'birthday-card');
  assert.strictEqual(url.searchParams.get('utm_campaign'), 'bday-card');
  for (const k of ['name', 'first_name', 'last_name', 'email', 'phone']) assert.strictEqual(url.searchParams.get(k), null);
});

test('page collects nothing: no form, no inputs, no tel link', () => {
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /<input\b/i);
  assert.doesNotMatch(html, /href="tel:/);
});

test('the name comes only from the URL fragment, cleaned to what the pixel font can draw', () => {
  assert.deepStrictEqual(Object.assign({}, load('').readName()), { full: '', first: 'CHAMP', given: '' });
  assert.deepStrictEqual(Object.assign({}, load('#jane-o%27neil').readName()), { full: 'JANE ONEIL', first: 'JANE', given: 'JANE' });
  assert.strictEqual(load('#%3Cscript%3Ealert(1)%3C%2Fscript%3E').readName().full, 'SCRIPTALERT1SCRIPT');
  assert.strictEqual(load('#' + 'a'.repeat(60)).readName().full.length, 24);
  assert.strictEqual(load('#%E0%A4%A').readName().full, '');   // malformed escape
});

test('every fixed line the scenes draw uses glyphs the 5x7 font has', () => {
  const { FONT } = load('');
  const calls = js.match(/\b(?:banner|subtitle|textO|textC|text)\(ctx,[^;]*?'([^']*)'/g) || [];
  assert.ok(calls.length > 15, 'found the scene text calls');
  for (const call of calls) {
    for (const lit of call.match(/'[^']*'/g)) {
      const s = lit.slice(1, -1);
      if (/^#|^rgba|^[a-z]/.test(s)) continue;          // colours and identifiers
      for (const ch of s) if (ch !== ' ') assert.ok(FONT[ch], `missing glyph ${JSON.stringify(ch)} in ${lit}`);
    }
  }
});

test('preview image exists at the size the meta tags claim', () => {
  const png = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'images', 'og-happy-birthday.png'));
  assert.strictEqual(png.readUInt32BE(16), 1200);
  assert.strictEqual(png.readUInt32BE(20), 630);
});
