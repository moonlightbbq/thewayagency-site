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
  test('no token scrub on the portals (that is D1 option B, not chosen)', () => {
    for (const src of ['src/portal.html', 'src/partner.html']) {
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, src), 'utf8'), /twa-token-scrub/);
    }
  });
});
