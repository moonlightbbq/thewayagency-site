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

test('the built page carries no analytics: GTM (and Clarity through it) never sees the name', () => {
  const { createInjectVersion } = require('../scripts/builders/seo');
  const inject = createInjectVersion({
    buildVersion: 't', gitInfo: { branch: 'b' }, buildDate: 'd', reviews: null,
    renderHead_GTM: () => '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script>',
    renderBody_GTM: () => '<noscript>gtm</noscript>',
  });
  const out = inject(html, '/happy-birthday.html');
  assert.doesNotMatch(out, /googletagmanager|gtm\.js|clarity\.ms/);
  // and the opt-out is specific: an ordinary page still gets GTM
  assert.match(inject('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>', '/x.html'), /gtm\.js/);
});

test('the quote box never says the named person is a client', () => {
  assert.doesNotMatch(html, /keeps ' \+|'s house and cars/);
  assert.doesNotMatch(html, /getElementById\('bdCtaText'\)/);   // the copy is never rewritten with the name
});

test('the quote box is inert until it opens, and its body is inert while minimized', () => {
  assert.match(html, /<section class="bd-cta" id="bdCta"[^>]*\binert\b/);
  assert.match(html, /cta\.inert = false/);
  assert.match(html, /querySelectorAll\('#bdCtaText, \.row, \.fine'\)[\s\S]*el\.inert = m/);
});

test('the name never goes into the tab title (an edge-injected Google tag records document.title)', () => {
  assert.doesNotMatch(html, /document\.title\s*=/);
  assert.doesNotMatch(js, /document\.title\s*=/);
});
