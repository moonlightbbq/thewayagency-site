/**
 * No third-party tags on token-bearing or staff-auth pages (TRUST-08; owner
 * decisions pii-and-privacy D1 option A and D4).
 *
 * /portal/?t=<token> and /partner/?token=<token> carry bearer tokens in the URL,
 * and GA4, Clarity and the GTM-loaded Meta Pixel collect page URLs: the audit
 * saw a client-portal token reach GA4 and Clarity. The build injects GTM and
 * Clarity into every page through createInjectVersion(); these tests drive that
 * real function with the real templates and page sources. The two token pages
 * also send only their origin as the referrer, so the logo click cannot hand
 * the token to the next page's tags.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createInjectVersion, isNoTagPage } = require('../scripts/builders/seo.js');
const { renderHead_GTM, renderBody_GTM } = require('../scripts/shared-templates.js');

const inject = createInjectVersion({
  buildVersion: 't', gitInfo: { branch: 't' }, buildDate: 't', reviews: { count: 1, rating: 5 },
  renderHead_GTM: () => '<!--GTM-HEAD-->', renderBody_GTM: () => '<!--GTM-BODY-->', criticalCss: '',
});
const PAGE = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>t</title></head><body><p>x</p></body></html>';

describe('isNoTagPage', () => {
  test('matches the portal, partner and login output paths', () => {
    for (const p of ['/portal/index.html', '/partner/index.html', '/login.html', '/login', '/login/']) {
      assert.equal(isNoTagPage(p), true, p);
    }
  });
  test('leaves every other page alone, intake included', () => {
    for (const p of ['/intake/index.html', '/personal/auto.html', '/index.html', '/loginx.html', '/blog/portal-tips.html', '/about/partners.html', '', undefined]) {
      assert.equal(isNoTagPage(p), false, String(p));
    }
  });
});

describe('createInjectVersion skips GTM and Clarity on token and auth pages', () => {
  for (const p of ['/portal/index.html', '/partner/index.html', '/login.html']) {
    test(`no tag snippet on ${p}`, () => {
      const out = inject(PAGE, p);
      assert.ok(!out.includes('GTM-HEAD') && !out.includes('GTM-BODY'), out);
      assert.match(out, /name="build-version"/, 'the rest of injectVersion still runs');
    });
  }
  for (const p of ['/intake/index.html', '/personal/auto.html', undefined]) {
    test(`tags still injected on ${p === undefined ? 'pages built without an output path (hubs, blog)' : p}`, () => {
      const out = inject(PAGE, p);
      assert.ok(out.includes('GTM-HEAD') && out.includes('GTM-BODY'));
    });
  }
});

describe('the real page sources through the real templates', () => {
  const realInject = createInjectVersion({
    buildVersion: 't', gitInfo: { branch: 't' }, buildDate: 't', reviews: { count: 1, rating: 5 },
    renderHead_GTM, renderBody_GTM, criticalCss: '',
  });
  const TAGS = /googletagmanager\.com\/(gtm\.js|ns\.html)|clarity\.ms\/tag|connect\.facebook\.net/;
  const pages = [
    ['src/portal.html', '/portal/index.html'],
    ['src/partner.html', '/partner/index.html'],
    ['src/pages/login.html', '/login.html'],
  ];
  for (const [src, out] of pages) {
    test(`${out}: built HTML loads no GTM, Clarity or Meta`, () => {
      const html = realInject(fs.readFileSync(path.join(ROOT, src), 'utf8'), out);
      assert.doesNotMatch(html, TAGS);
    });
  }
  test('/intake/index.html still gets GTM and Clarity (CONV-02 depends on it)', () => {
    const html = realInject(fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8'), '/intake/index.html');
    assert.match(html, /googletagmanager\.com\/gtm\.js/);
    assert.match(html, /clarity\.ms\/tag/);
  });
});

describe('strict-origin referrer on the token pages', () => {
  for (const src of ['src/portal.html', 'src/partner.html']) {
    test(`${src} sets <meta name="referrer" content="strict-origin"> before any subresource`, () => {
      const html = fs.readFileSync(path.join(ROOT, src), 'utf8');
      const at = html.indexOf('<meta name="referrer" content="strict-origin">');
      assert.ok(at > 0, 'missing');
      assert.ok(at < html.search(/<(link|script|img|iframe)\b/i), 'must precede every link, script, img and iframe');
      assert.ok(html.indexOf('<meta charset="UTF-8">') < at, '<meta charset> stays first');
      assert.doesNotMatch(html, /<meta name="referrer" content="no-referrer"/, 'no-referrer breaks origin checks (Maps keys, Turnstile)');
    });
  }
});

// twa-url-scrub on the portal (owner decision D1-A, 2026-11-28): the bearer
// token leaves the address bar before any other script runs and lives in this
// tab entry's own history.state. The partner page keeps its token in the URL on
// purpose (a dashboard partners bookmark and add to the home screen).
describe('token URL scrub on the portal', () => {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(ROOT, 'src/portal.html'), 'utf8');
  function scrubSource(h) {
    const m = h.match(/<script>\/\* twa-url-scrub[\s\S]*?<\/script>/);
    assert.ok(m, 'twa-url-scrub script present');
    return m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  }
  // Resolved inside each test, never at describe time: a throw in a describe
  // body is printed as "not ok" but node --test still exits 0 (seen 2026-11-28).
  const code = () => scrubSource(html);
  // The page's own token read, evaluated against a fake location/history.
  const readLine = () => { const m = html.match(/const TOKEN = [^\n]+/); assert.ok(m, 'TOKEN read line present'); return m[0]; };
  function makeHistory(initialState) {
    const h = { state: initialState, calls: [] };
    h.replaceState = (st, t, url) => { h.calls.push(url); h.state = st; };
    return h;
  }
  function scrub(href, history) {
    const loc = { href };
    vm.runInNewContext(code(), { URL, location: loc, history });
    return history;
  }
  function readToken(search, history) {
    return vm.runInNewContext(`const params = new URLSearchParams(search); ${readLine()}; TOKEN`, { URLSearchParams, search, history });
  }
  test('moves ?t= into history.state and out of the URL, keeping other params, the hash and existing state', () => {
    const h = scrub('https://www.thewayagency.com/portal/?a=1&t=tok-123&b=2#frag', makeHistory({ keep: 1 }));
    assert.deepEqual(h.calls, ['/portal/?a=1&b=2#frag']);
    assert.deepEqual(JSON.parse(JSON.stringify(h.state)), { keep: 1, twa_t: 'tok-123' }); // vm realm objects
  });
  test('drops the query string entirely when the token was the only param', () => {
    assert.deepEqual(scrub('https://h/portal/?t=tok', makeHistory(null)).calls, ['/portal/']);
  });
  test('needs no Web Storage (works when storage is blocked)', () => {
    assert.doesNotMatch(code(), /sessionStorage|localStorage/);
  });
  test('does nothing without a token', () => {
    assert.equal(scrub('https://h/portal/?a=1', makeHistory(null)).calls.length, 0);
  });
  test('the page reads the URL first, then this entry\'s history.state', () => {
    const h = scrub('https://h/portal/?t=tok-A', makeHistory(null));
    assert.equal(readToken('', h), 'tok-A', 'after the scrub, from history.state');
    assert.equal(readToken('?t=tok-B', h), 'tok-B', 'a token in the URL wins');
    assert.equal(readToken('?t=', h), '', 'an explicit empty ?t= does not fall back to a stored token');
    assert.equal(readToken('', makeHistory(null)), null, 'no URL token and no state: no token');
  });
  test('two links in one tab: each history entry keeps its own token (Back cannot load the newer one)', () => {
    const entryA = scrub('https://h/portal/?t=tok-A', makeHistory(null));
    const entryB = scrub('https://h/portal/?t=tok-B', makeHistory(null));
    assert.equal(readToken('', entryA), 'tok-A');
    assert.equal(readToken('', entryB), 'tok-B');
  });
  test('is the first script, right after the strict-origin referrer meta, before every subresource', () => {
    const metaAt = html.indexOf('<meta name="referrer" content="strict-origin">');
    const scrubAt = html.indexOf('<script>/* twa-url-scrub');
    assert.ok(metaAt > 0 && scrubAt > metaAt, 'after the referrer meta');
    assert.equal(html.search(/<script\b/i), scrubAt, 'first <script>');
    assert.ok(scrubAt < html.search(/<(link|img|iframe)\b/i), 'before every link, img and iframe');
  });
  test('the partner page keeps its token in the URL (bookmarks, home screen)', () => {
    const partner = fs.readFileSync(path.join(ROOT, 'src/partner.html'), 'utf8');
    assert.doesNotMatch(partner, /twa-url-scrub/);
  });
});
