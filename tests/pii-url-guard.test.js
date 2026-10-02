/**
 * Identity never rides a URL (TRUST-08).
 *
 * The inline quote form on 65 pages used to send the visitor to
 * /intake/?name=…&email=…&phone=…, and GA4, Clarity and the Meta Pixel collect
 * page URLs. The hand-off now carries page context in the URL and what the
 * visitor typed in this tab's sessionStorage, through window.TWA in
 * src/js/attribution.js. These tests drive the REAL attribution.js in jsdom and
 * render the REAL inline form markup; jsdom cannot follow a navigation, which is
 * why the URL building lives in TWA.buildIntakeHandoff().
 *
 * Synthetic values only (Zz Privacycheck, zz.privacycheck@example.com, 5555550123).
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const ATTR = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
const INTAKE = fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');

const NAME = 'Zz Privacycheck';
const EMAIL = 'zz.privacycheck@example.com';
const PHONE = '5555550123';

/** attribution.js running on a page at `url`. `blockStorage` makes sessionStorage throw. */
function loadTwa(url, { blockStorage = false } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url,
    runScripts: 'dangerously',
    beforeParse(w) {
      if (blockStorage) {
        Object.defineProperty(w, 'sessionStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
      }
    },
  });
  const s = dom.window.document.createElement('script');
  s.textContent = ATTR;
  dom.window.document.head.appendChild(s);
  assert.ok(dom.window.TWA, 'attribution.js did not define window.TWA');
  return dom.window;
}

describe('TWA.buildIntakeHandoff: page context in the URL, identity in storage', () => {
  const w = loadTwa('https://www.thewayagency.com/personal/auto?agent=test-agent');
  const data = {
    product: 'auto', line: 'personal', industry: 'general-contractors', city: 'Owensboro',
    county: 'Daviess County', state: 'KY', src: 'inline', name: NAME, email: EMAIL, phone: PHONE,
  };

  test('the URL has no name, email or phone and no typed value', () => {
    const { url } = w.TWA.buildIntakeHandoff(data, w.location.search);
    assert.ok(url.startsWith('/intake/?'));
    assert.doesNotMatch(url, /[?&](name|first_name|last_name|email|phone|t|token)=/);
    for (const v of [NAME, 'Privacycheck', EMAIL, encodeURIComponent(EMAIL), PHONE]) {
      assert.ok(!url.includes(v), `URL carries ${v}`);
    }
  });

  test('the URL keeps product, line, industry, city, county, state, agent and src=inline', () => {
    const q = new w.URLSearchParams(w.TWA.buildIntakeHandoff(data, w.location.search).url.split('?')[1]);
    assert.equal(q.get('product'), 'auto');
    assert.equal(q.get('line'), 'personal');
    assert.equal(q.get('industry'), 'general-contractors');
    assert.equal(q.get('city'), 'Owensboro');
    assert.equal(q.get('county'), 'Daviess County');
    assert.equal(q.get('state'), 'KY');
    assert.equal(q.get('agent'), 'test-agent');
    assert.equal(q.get('src'), 'inline');
    assert.deepEqual([...q.keys()].sort(), ['agent', 'city', 'county', 'industry', 'line', 'product', 'src', 'state']);
  });

  test('a legacy lineOfBusiness hidden field still lands as line=', () => {
    const { url } = w.TWA.buildIntakeHandoff({ product: 'cgl', lineOfBusiness: 'commercial' }, '');
    const q = new w.URLSearchParams(url.split('?')[1]);
    assert.equal(q.get('line'), 'commercial');
    assert.equal(q.get('src'), 'inline', 'src defaults to inline');
  });

  test('no utm_* is added to the hand-off (attribution rides the twa_ft/twa_lt cookies)', () => {
    const { url } = w.TWA.buildIntakeHandoff(data, '?utm_source=test&gclid=test-gclid&agent=test-agent');
    assert.doesNotMatch(url, /utm_|gclid/);
  });

  test('the prefill carries exactly what was typed', () => {
    assert.deepEqual({ ...w.TWA.buildIntakeHandoff(data, '').prefill }, { name: NAME, email: EMAIL, phone: PHONE });
  });
});

describe('TWA.stashPrefill / TWA.takePrefill', () => {
  test('round-trips once and removes the key', () => {
    const w = loadTwa('https://www.thewayagency.com/personal/auto');
    assert.equal(w.TWA.stashPrefill({ name: NAME, email: EMAIL, phone: PHONE }), true);
    const raw = JSON.parse(w.sessionStorage.getItem('twa_inline_prefill'));
    assert.equal(raw.v, 1);
    assert.equal(typeof raw.at, 'number');
    const rec = w.TWA.takePrefill();
    assert.equal(rec.name, NAME);
    assert.equal(rec.email, EMAIL);
    assert.equal(rec.phone, PHONE);
    assert.equal(w.sessionStorage.getItem('twa_inline_prefill'), null, 'one-shot: the key is gone');
    assert.equal(w.TWA.takePrefill(), null, 'a second read gets nothing');
  });

  test('empty values are not stored', () => {
    const w = loadTwa('https://www.thewayagency.com/personal/auto');
    w.TWA.stashPrefill({ name: NAME, email: '', phone: '' });
    const raw = JSON.parse(w.sessionStorage.getItem('twa_inline_prefill'));
    assert.deepEqual(Object.keys(raw).sort(), ['at', 'name', 'v']);
  });

  test('a stash older than 30 minutes is ignored, and still removed', () => {
    const w = loadTwa('https://www.thewayagency.com/intake/');
    w.sessionStorage.setItem('twa_inline_prefill', JSON.stringify({ v: 1, at: Date.now() - 31 * 60 * 1000, name: NAME }));
    assert.equal(w.TWA.takePrefill(), null);
    assert.equal(w.sessionStorage.getItem('twa_inline_prefill'), null);
  });

  test('a stash of another version or shape is ignored', () => {
    const w = loadTwa('https://www.thewayagency.com/intake/');
    w.sessionStorage.setItem('twa_inline_prefill', JSON.stringify({ v: 2, at: Date.now(), name: NAME }));
    assert.equal(w.TWA.takePrefill(), null);
    w.sessionStorage.setItem('twa_inline_prefill', 'not json');
    assert.equal(w.TWA.takePrefill(), null);
  });

  test('blocked sessionStorage: stashPrefill returns false and takePrefill returns null (no URL fallback)', () => {
    const w = loadTwa('https://www.thewayagency.com/personal/auto', { blockStorage: true });
    assert.equal(w.TWA.stashPrefill({ name: NAME, email: EMAIL, phone: PHONE }), false);
    assert.equal(w.TWA.takePrefill(), null);
  });
});

describe('TWA.stripSensitive and the attribution cookies', () => {
  test('removes all seven keys and keeps utm_*, gclid, src and agent', () => {
    const w = loadTwa('https://www.thewayagency.com/');
    const out = w.TWA.stripSensitive('?name=' + encodeURIComponent(NAME) + '&first_name=Zz&last_name=Privacycheck'
      + '&email=' + encodeURIComponent(EMAIL) + '&phone=' + PHONE + '&t=test-token-test-token-test-token-test-token'
      + '&token=test-token-test-token-test-token-test-token&utm_source=test&utm_campaign=test-campaign&gclid=test-gclid'
      + '&src=inline&agent=test-agent');
    assert.equal(out, '?utm_source=test&utm_campaign=test-campaign&gclid=test-gclid&src=inline&agent=test-agent');
    assert.equal(w.TWA.stripSensitive('?email=' + encodeURIComponent(EMAIL)), '', 'nothing left: no bare "?"');
    assert.deepEqual([...w.TWA.SENSITIVE_PARAMS], ['name', 'first_name', 'last_name', 'email', 'phone', 't', 'token']);
  });

  test('captureAttribution never stores identity in the 30/365-day landing_page cookies', () => {
    const w = loadTwa('https://www.thewayagency.com/intake/?utm_source=test&email=' + encodeURIComponent(EMAIL)
      + '&phone=' + PHONE + '&gclid=test-gclid');
    w.TWA.captureAttribution();
    for (const name of ['twa_lt', 'twa_ft']) {
      const touch = w.TWA.getCookie(name);
      assert.ok(touch, `${name} was not written`);
      assert.equal(touch.landing_page, '/intake/?utm_source=test&gclid=test-gclid');
      assert.ok(!JSON.stringify(touch).includes('privacycheck'), `${name} carries the email`);
      assert.ok(!JSON.stringify(touch).includes(PHONE), `${name} carries the phone`);
    }
  });
});

describe('source guards', () => {
  test('the twa-url-scrub key list in src/intake.html equals TWA.SENSITIVE_PARAMS', () => {
    const scrub = INTAKE.match(/twa-url-scrub[\s\S]*?var keys = (\[[^\]]*\])/);
    assert.ok(scrub, 'twa-url-scrub (or its keys array) not found in src/intake.html');
    const keys = JSON.parse(scrub[1].replace(/'/g, '"'));
    const w = loadTwa('https://www.thewayagency.com/');
    assert.deepEqual(keys, [...w.TWA.SENSITIVE_PARAMS]);
  });

  test('initInlineForms hands off through TWA and never sets name/email/phone on a URL', () => {
    const fn = APP.match(/function initInlineForms\(\) \{[\s\S]*?\n {2}\}\n/);
    assert.ok(fn, 'initInlineForms() not found in src/js/app.js');
    assert.match(fn[0], /TWA\.buildIntakeHandoff\(/);
    assert.match(fn[0], /TWA\.stashPrefill\(/);
    assert.doesNotMatch(fn[0], /URLSearchParams\(\)/, 'the old URL builder is back');
    assert.doesNotMatch(APP, /\.set\(\s*['"](name|email|phone)['"]/);
  });

  test('renderInlineForm(): GET to /intake/, data-field inputs, no name attribute on name/email/phone', () => {
    const { renderInlineForm } = require('../scripts/builders/pages.js');
    const html = renderInlineForm('auto', { product: 'auto', line: 'personal' });
    const open = html.match(/<form[^>]*>/)[0];
    assert.match(open, /class="inline-quote-form"/);
    assert.match(open, /\saction="\/intake\/"/);
    assert.match(open, /\smethod="get"/);
    for (const f of ['name', 'email', 'phone']) assert.match(html, new RegExp(`data-field="${f}"`));
    assert.doesNotMatch(html, /\sname="(name|email|phone)"/);
    for (const input of html.match(/<input\b[^>]*>/g)) {
      if (/data-field=/.test(input)) assert.doesNotMatch(input, /\sname=/, input);
    }
    // A submit before app.js binds its handler sends page context only.
    assert.match(html, /<input type="hidden" name="src" value="inline">/);
    assert.match(html, /<input type="hidden" name="line" value="personal">/);
    // Labels, placeholders and the required state are unchanged.
    assert.match(html, /placeholder="Your name" required/);
    assert.match(html, /placeholder="Email address" required/);
    assert.match(html, /placeholder="Phone \(optional\)" autocomplete="tel">/);
  });

  test('the product and industry call sites pass line=, not lineOfBusiness=', () => {
    const pages = fs.readFileSync(path.join(ROOT, 'scripts', 'builders', 'pages.js'), 'utf8');
    assert.doesNotMatch(pages, /lineOfBusiness/);
  });
});

describe('the inline form handler, end to end in jsdom', () => {
  // The real attribution.js + app.js (the build concatenates them in this order)
  // on a page carrying the real renderInlineForm() markup. jsdom cannot follow
  // location.href, so the navigation statement is swapped for a recorder.
  function loadInlinePage(url) {
    const { renderInlineForm } = require('../scripts/builders/pages.js');
    const form = renderInlineForm('auto', { product: 'auto', line: 'personal' })
      .replace('%%FORM_HEADING%%', 'h').replace('%%FORM_SUBTEXT%%', 's');
    const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${form}</body></html>`, {
      url,
      runScripts: 'dangerously',
      beforeParse(w) {
        w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
        w.scrollTo = () => {};
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      },
    });
    const w = dom.window;
    w.__navigations = [];
    w.__nav = (u) => w.__navigations.push(u);
    const bundle = ATTR + '\n;\n' + APP;
    const src = bundle.replace(/window\.location\.href = handoff\.url;/, 'window.__nav(handoff.url);');
    assert.notEqual(src, bundle, 'the navigation statement in initInlineForms changed shape');
    const s = w.document.createElement('script');
    s.textContent = src;
    w.document.body.appendChild(s);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    return w;
  }

  test('submitting stashes identity and navigates to a URL without it', () => {
    const w = loadInlinePage('https://www.thewayagency.com/personal/auto?agent=test-agent');
    try {
      const f = w.document.querySelector('.inline-quote-form');
      f.querySelector('[data-field="name"]').value = NAME;
      f.querySelector('[data-field="email"]').value = EMAIL;
      f.querySelector('[data-field="phone"]').value = PHONE;
      f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
      assert.deepEqual([...w.__navigations], ['/intake/?product=auto&line=personal&agent=test-agent&src=inline']);
      const stash = JSON.parse(w.sessionStorage.getItem('twa_inline_prefill'));
      assert.equal(stash.name, NAME);
      assert.equal(stash.email, EMAIL);
      assert.equal(stash.phone, PHONE);
      const pushed = JSON.stringify(w.dataLayer || []);
      for (const v of ['Privacycheck', EMAIL, PHONE]) assert.ok(!pushed.includes(v), `dataLayer carries ${v}`);
    } finally { w.close(); }
  });

  test('a missing name is stopped inline, with no stash and no navigation', () => {
    const w = loadInlinePage('https://www.thewayagency.com/personal/auto');
    try {
      const f = w.document.querySelector('.inline-quote-form');
      f.querySelector('[data-field="email"]').value = EMAIL;
      f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
      assert.equal(w.__navigations.length, 0);
      assert.equal(w.sessionStorage.getItem('twa_inline_prefill'), null);
      assert.equal(f.querySelector('[data-field="name"]').getAttribute('aria-invalid'), 'true', 'the error sits on the name input');
      assert.match(f.textContent, /Name is required/);
    } finally { w.close(); }
  });

  test('a filled honeypot is dropped silently', () => {
    const w = loadInlinePage('https://www.thewayagency.com/personal/auto');
    try {
      const f = w.document.querySelector('.inline-quote-form');
      f.querySelector('[data-field="name"]').value = NAME;
      f.querySelector('[data-field="email"]').value = EMAIL;
      f.querySelector('input[name="_hp_company"]').value = 'bot';
      f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
      assert.equal(w.__navigations.length, 0);
      assert.equal(w.sessionStorage.getItem('twa_inline_prefill'), null);
    } finally { w.close(); }
  });

  test('form_start reports the field name from data-field, never its value', () => {
    const w = loadInlinePage('https://www.thewayagency.com/personal/auto');
    try {
      const input = w.document.querySelector('.inline-quote-form [data-field="email"]');
      input.value = EMAIL;
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      const fs0 = (w.dataLayer || []).find((e) => e && e.event === 'form_start');
      assert.ok(fs0, 'form_start was not pushed');
      assert.equal(fs0.field, 'email');
      assert.ok(!JSON.stringify(w.dataLayer).includes('privacycheck'));
    } finally { w.close(); }
  });
});
