/**
 * CONV-05: the latest external referral survives internal navigation.
 *
 * A visitor who lands from Google or an AI assistant with no UTM and clicks
 * through to /intake/ used to reach SAGE with only the internal referrer of the
 * form page, so SAGE filed the lead as "direct". attribution.js now keeps the
 * external referrer host and an AI source in their own cookie (twa_rl) and sends
 * them as the top-level ref_host / ai_source pair and inside last_touch, which
 * is where SAGE's deriveChannel() (sage-server #980) reads them.
 *
 * Each "page" is a fresh jsdom window running the REAL src/js/attribution.js,
 * sharing one CookieJar, so navigation behaves like a browser tab. Nothing here
 * builds the site or writes build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, CookieJar } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const ATTR = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8');
const INTAKE = fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');
const CONTACT = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'contact.html'), 'utf8');
const SITE = 'https://www.thewayagency.com';

/** One page view: attribution.js runs and captureAttribution() fires, as app.js and intake.html do. */
function visit(jar, url, referrer) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url, cookieJar: jar, runScripts: 'dangerously', ...(referrer ? { referrer } : {}),
  });
  const s = dom.window.document.createElement('script');
  s.textContent = ATTR;
  dom.window.document.head.appendChild(s);
  assert.ok(dom.window.TWA, 'attribution.js did not define window.TWA');
  dom.window.TWA.captureAttribution();
  return dom.window;
}

/** The attribution object the intake page sends with step 1 (/track) and the final submit. */
function submitPayload(jar, referrer = SITE + '/personal/auto') {
  const w = visit(jar, SITE + '/intake/?product=auto', referrer);
  return JSON.parse(JSON.stringify(w.TWA.getAttribution()));
}

function cookieNames(jar, url = SITE + '/') {
  return jar.getCookiesSync(url).map((c) => c.key);
}

function assertStrings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') { assertStrings(v); continue; }
    assert.equal(typeof v, 'string', `${k} is not a string`);
    assert.ok(v.length <= 500, `${k} is over 500 characters`);
  }
}

describe('organic and AI referrals survive internal navigation', () => {
  test('Google referral, internal page, then intake submit: payload carries ref_host google.com', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/insurance/owensboro-ky', 'https://www.google.com/');
    visit(jar, SITE + '/personal/auto', SITE + '/insurance/owensboro-ky');
    const a = submitPayload(jar, SITE + '/personal/auto');
    assert.equal(a.ref_host, 'google.com');
    assert.equal(a.ai_source, undefined, 'Google is not an AI assistant');
    assert.equal(a.last_touch.ref_host, 'google.com');
    assert.equal(a.referrer, SITE + '/personal/auto', 'the flat referrer still reports the submit page');
    assert.equal(a.utm_source, '');
    assert.equal(a.gclid, '');
    assert.deepEqual(a.first_touch, {}, 'first_touch is untouched: the referral is a last touch only');
    assertStrings(a);
  });

  test('Perplexity referral gives ai_source perplexity', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/', 'https://www.perplexity.ai/');
    const a = submitPayload(jar);
    assert.equal(a.ref_host, 'perplexity.ai');
    assert.equal(a.ai_source, 'perplexity');
    assert.equal(a.last_touch.ai_source, 'perplexity');
    assert.equal(a.last_touch.ref_host, 'perplexity.ai');
    assertStrings(a);
  });

  test('utm_source=chatgpt.com with no referrer gives ai_source chatgpt, utm_source unchanged', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/home?utm_source=chatgpt.com', '');
    const a = submitPayload(jar);
    assert.equal(a.ai_source, 'chatgpt');
    assert.equal(a.ref_host, undefined, 'no referrer, so no host');
    assert.equal(a.utm_source, 'chatgpt.com');
    assert.equal(a.last_touch.utm_source, 'chatgpt.com');
    assert.equal(a.last_touch.ai_source, 'chatgpt');
    assertStrings(a);
  });

  test('a bare utm_source name is a campaign label, not an AI source', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/?utm_source=perplexity&utm_medium=email', '');
    const a = submitPayload(jar);
    assert.equal(a.ai_source, undefined);
    assert.ok(!cookieNames(jar).includes('twa_rl'));
    assert.equal(a.utm_source, 'perplexity');
  });

  test('an AI host on a subdomain still matches; a look-alike domain does not', () => {
    const jar = new CookieJar();
    const w = visit(jar, SITE + '/', '');
    assert.equal(w.TWA.aiSourceOfDomain('https://www.chatgpt.com/c/x'), 'chatgpt');
    assert.equal(w.TWA.aiSourceOfDomain('labs.perplexity.ai'), 'perplexity');
    assert.equal(w.TWA.aiSourceOfDomain('notperplexity.ai'), '');
    assert.equal(w.TWA.aiSourceOfDomain('google.com'), '');
    assert.equal(w.TWA.aiSourceOfDomain('perplexity'), '');
  });

  test('another referring site is kept as ref_host with no AI source', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/commercial/', 'https://www.example.org/some/page');
    visit(jar, SITE + '/contact', SITE + '/commercial/');
    const a = submitPayload(jar, SITE + '/contact');
    assert.equal(a.ref_host, 'example.org');
    assert.equal(a.ai_source, undefined);
  });

  test('a later external referral replaces the earlier one (latest wins)', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/', 'https://claude.ai/');
    visit(jar, SITE + '/', 'https://www.bing.com/');
    const a = submitPayload(jar);
    assert.equal(a.ref_host, 'bing.com');
    assert.equal(a.ai_source, undefined, 'the older AI source does not outlive the newer referral');
  });
});

describe('what never creates or overwrites a referral', () => {
  test('direct (no referrer, no UTM) writes nothing and sends no pair', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/', '');
    const a = submitPayload(jar, '');
    assert.ok(!cookieNames(jar).includes('twa_rl'));
    assert.equal(a.ref_host, undefined);
    assert.equal(a.ai_source, undefined);
    assert.deepEqual(a.last_touch, {});
    assert.equal(a.referrer, 'direct');
  });

  test('a missing referrer on the submit page keeps the stored touch', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/', 'https://www.perplexity.ai/');
    // Referrer stripped (a bookmark, a privacy extension, a new tab) on the form page.
    const a = submitPayload(jar, '');
    assert.equal(a.ai_source, 'perplexity');
    assert.equal(a.ref_host, 'perplexity.ai');
    assert.equal(a.referrer, 'direct');
  });

  test('internal referrers on the apex, a sage subdomain, a Pages preview and the page host are not sources', () => {
    for (const ref of ['https://thewayagency.com/', 'https://sage.thewayagency.com/portal/', 'https://abc123.thewayagency-site.pages.dev/', SITE + '/blog/']) {
      const jar = new CookieJar();
      visit(jar, SITE + '/', 'https://www.google.com/');
      visit(jar, SITE + '/about/', ref);
      assert.equal(submitPayload(jar).ref_host, 'google.com', `${ref} overwrote the stored referral`);
    }
    const local = new CookieJar();
    visit(local, 'http://localhost:8123/', 'https://www.google.com/');
    const w = visit(local, 'http://localhost:8123/intake/', 'http://localhost:8123/');
    assert.equal(w.TWA.getAttribution().ref_host, 'google.com', 'the serving host counts as internal');
  });
});

describe('campaign UTMs and click ids keep precedence and resolve exactly as before', () => {
  test('a paid landing (utm_medium=cpc, gclid) keeps twa_ft/twa_lt and the flat fields unchanged', () => {
    const url = SITE + '/personal/auto?utm_source=google&utm_medium=cpc&utm_campaign=test-campaign&gclid=test-gclid';
    const jar = new CookieJar();
    const w = visit(jar, url, 'https://www.google.com/');
    const ft = w.TWA.getCookie('twa_ft');
    const lt = w.TWA.getCookie('twa_lt');
    for (const touch of [ft, lt]) {
      assert.deepEqual(Object.keys(touch).sort(), ['date', 'gclid', 'landing_page', 'utm_campaign', 'utm_medium', 'utm_source']);
      assert.equal(touch.gclid, 'test-gclid');
      assert.equal(touch.ref_host, undefined, 'the referral is never written into the touch cookies');
    }
    const a = submitPayload(jar);
    assert.equal(a.gclid, 'test-gclid');
    assert.equal(a.utm_medium, 'cpc');
    assert.equal(a.utm_source, 'google');
    assert.equal(a.utm_campaign, 'test-campaign');
    assert.equal(a.last_touch.gclid, 'test-gclid');
    assert.equal(a.last_touch.utm_medium, 'cpc');
    assert.deepEqual(a.first_touch, JSON.parse(JSON.stringify(ft)), 'first_touch is exactly the stored cookie');
    // The referral rides alongside; SAGE checks gclid and paid mediums before it.
    assert.equal(a.ref_host, 'google.com');
  });

  test('existing UTM, fbclid, src and agent fixtures produce the same cookies and flat fields as before', () => {
    const url = SITE + '/?utm_source=newsletter&utm_medium=email&utm_campaign=oct&utm_content=a&utm_term=b&fbclid=test-fbclid&src=inline&agent=test-agent';
    const jar = new CookieJar();
    const w = visit(jar, url, '');
    const lt = w.TWA.getCookie('twa_lt');
    assert.deepEqual(Object.keys(lt).sort(), ['agent', 'date', 'fbclid', 'landing_page', 'src', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term']);
    const a = submitPayload(jar);
    assert.deepEqual(
      [a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.utm_term, a.fbclid, a.src, a.agent],
      ['newsletter', 'email', 'oct', 'a', 'b', 'test-fbclid', 'inline', 'test-agent']);
    assert.ok(!cookieNames(jar).includes('twa_rl'), 'no referrer and no AI utm_source: no referral cookie');
    assert.equal(a.ref_host, undefined);
  });
});

describe('cookie hygiene', () => {
  test('twa_rl holds only the host and the AI source, with the twa_lt attributes', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/?email=zz.privacycheck%40example.com&phone=5555550123', 'https://www.perplexity.ai/search?q=x');
    const c = jar.getCookiesSync(SITE + '/').find((k) => k.key === 'twa_rl');
    const lt = { maxAge: 30 * 86400, sameSite: 'lax', path: '/' };
    assert.ok(c, 'twa_rl not written');
    assert.deepEqual(JSON.parse(decodeURIComponent(c.value)), { ref_host: 'perplexity.ai', ai_source: 'perplexity' });
    assert.equal(c.maxAge, lt.maxAge);
    assert.equal(c.sameSite, lt.sameSite);
    assert.equal(c.path, lt.path);
    assert.equal(c.secure, true, 'Secure on https');
    assert.doesNotMatch(c.value, /privacycheck|5555550123|search/);
  });

  test('landing_page in twa_ft/twa_lt is stripped of identity and kept to 300 characters', () => {
    const jar = new CookieJar();
    const w = visit(jar, SITE + '/personal/auto?utm_source=test&name=Zz%20Privacycheck&email=zz.privacycheck%40example.com&utm_content=' + 'a'.repeat(600), '');
    for (const name of ['twa_ft', 'twa_lt']) {
      const lp = w.TWA.getCookie(name).landing_page;
      assert.ok(lp.length <= 300, `${name}.landing_page is ${lp.length} characters`);
      assert.ok(lp.startsWith('/personal/auto?utm_source=test&utm_content=aaa'));
      assert.doesNotMatch(lp, /privacycheck|name=|email=/i);
    }
  });

  test('a tampered or malformed cookie is dropped, never sent as-is', () => {
    const jar = new CookieJar();
    jar.setCookieSync('twa_rl=' + encodeURIComponent(JSON.stringify({ ref_host: { x: 1 }, ai_source: 'x'.repeat(300) })) + '; Path=/', SITE + '/');
    let a = submitPayload(jar, '');
    assert.equal(a.ref_host, undefined);
    assert.equal(a.ai_source, undefined);
    jar.setCookieSync('twa_rl=%7Bnot-json; Path=/', SITE + '/');
    a = submitPayload(jar, '');
    assert.equal(a.ref_host, undefined);
    jar.setCookieSync('twa_rl=' + encodeURIComponent(JSON.stringify({ ref_host: 'https://www.' + 'a'.repeat(300) + '.com/x' })) + '; Path=/', SITE + '/');
    a = submitPayload(jar, '');
    assert.ok(a.ref_host.length <= 100);
    assertStrings(a);
  });
});

describe('source guards', () => {
  test('the intake page sends TWA.getAttribution() with step 1 (/track) and the final submit; contact does too', () => {
    const bodies = INTAKE.match(/attribution: TWA\.getAttribution\(\)/g) || [];
    assert.ok(bodies.length >= 2, 'intake.html no longer sends the attribution object');
    assert.match(CONTACT, /payload\.attribution = TWA\.getAttribution\(\)/);
  });

  test('AI_HOSTS is exactly SAGE #980\'s list (sage-server src/services/attribution.js)', () => {
    const jar = new CookieJar();
    const w = visit(jar, SITE + '/', '');
    assert.deepEqual({ ...w.TWA.AI_HOSTS }, {
      'chatgpt.com': 'chatgpt',
      'chat.openai.com': 'chatgpt',
      'perplexity.ai': 'perplexity',
      'claude.ai': 'claude',
      'gemini.google.com': 'gemini',
      'copilot.microsoft.com': 'copilot',
      'chat.deepseek.com': 'deepseek',
      'grok.com': 'grok',
    });
  });
});
