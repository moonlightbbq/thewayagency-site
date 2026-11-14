/**
 * Y-89 (Luke 11/15): a printed flyer's QR adds ?src=flyer-xx, and the lead SAGE
 * receives is filed under that flyer, however the visitor reaches a form.
 *
 *   - a flyer code, or a producer's ?agent= link, counts as a TOUCH and is written
 *     to twa_ft / twa_lt like a UTM ("src and agent alone never set the hit flag"
 *     was the bug); a site button's src (hero, sticky, inline, ...) never does, so
 *     an in-site click never replaces a visitor's last-touch UTM or click id;
 *   - the flyer code also rides a session cookie (twa_cs) as attribution.campaign_src;
 *   - TWA.leadSource() gives the flyer code before any button name, and the intake
 *     wizard, the inline quote (through the wizard) and the quick lead send it as
 *     lead_source. Contact and chat get it through SAGE PR 1 (Y0 11/15).
 *   - a held agent rides attribution.agent only; the routing `agent` stays the
 *     wizard's own ?agent= (HELD_AGENT_ROUTES false, Luke's call).
 *
 * Each "page" is a fresh jsdom window running the REAL src/js/attribution.js,
 * sharing one CookieJar, so page changes and new tabs behave like a browser. The
 * intake page and /contact run their own inline scripts. All codes are invented.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const ATTR = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8');
const INTAKE = fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');
const CONTACT = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'contact.html'), 'utf8');
const SITE = 'https://www.thewayagency.com';

/** One page view: attribution.js runs and captureAttribution() fires, as app.js and intake.html do. */
function visit(jar, url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url, cookieJar: jar, runScripts: 'dangerously' });
  const s = dom.window.document.createElement('script');
  s.textContent = ATTR;
  dom.window.document.head.appendChild(s);
  assert.ok(dom.window.TWA, 'attribution.js did not define window.TWA');
  dom.window.TWA.captureAttribution();
  return dom.window;
}
const attr = (w) => JSON.parse(JSON.stringify(w.TWA.getAttribution()));
// Fallbacks so the must-fail on main is an assertion, not a TypeError.
const leadSourceOf = (w, pageSrc) => (typeof w.TWA.leadSource === 'function' ? w.TWA.leadSource(pageSrc) : `(no leadSource) ${pageSrc}`);
const campaignOf = (w) => JSON.parse(JSON.stringify((w.TWA.getCampaign || (() => ({ missing: 'getCampaign' })))()));
const cookie = (jar, key) => jar.getCookiesSync(SITE + '/').find((c) => c.key === key);
const touch = (jar, key) => { const c = cookie(jar, key); return c ? JSON.parse(decodeURIComponent(c.value)) : null; };

/** The real intake page, with attribution.js inline where its script tag is, and the jar's cookies. */
async function intakePage(jar, url) {
  const html = INTAKE.replace('<script src="/src/js/attribution.js"></script>', () => '<script>' + ATTR + '</script>');
  assert.notEqual(html, INTAKE, 'attribution.js script tag not found on /intake/');
  const dom = new JSDOM(html, {
    url, cookieJar: jar, runScripts: 'dangerously', virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  return dom.window;
}
const intakeLead = (w) => (typeof w.intakeLeadSource === 'function' ? w.intakeLeadSource() : `(no intakeLeadSource) ${new w.URLSearchParams(w.location.search).get('src')}`);

describe("Luke's test: a flyer landing, a click-through, and the lead is the flyer's", () => {
  test('MUST-FAIL: land on /personal/home?src=flyer-test, click Get a Quote: the wizard sends lead_source flyer-test', async () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/home?src=flyer-test');
    // The hero button: /intake/?src=hero (the sticky bar and the exit popup are the same shape).
    for (const button of ['/intake/?src=hero', '/intake/?product=homeowners&src=sticky', '/intake/?src=exit-intent']) {
      const w = await intakePage(jar, SITE + button);
      assert.equal(intakeLead(w), 'flyer-test', button);
    }
  });

  test('MUST-FAIL: the inline quote form on the page hands off to the wizard, which still sends the flyer code', async () => {
    const jar = new CookieJar();
    const page = visit(jar, SITE + '/personal/home?src=flyer-test');
    const handoff = page.TWA.buildIntakeHandoff({ product: 'homeowners', name: 'Tst Example', email: 'tst@example.com' }, page.location.search);
    assert.match(handoff.url, /src=inline/, 'the form still marks itself inline');
    assert.equal(intakeLead(await intakePage(jar, SITE + handoff.url)), 'flyer-test');
  });

  test('MUST-FAIL: the quick lead and the final submit use the same lead_source as the autosave', () => {
    const uses = INTAKE.match(/const leadSrc = intakeLeadSource\(\);\n\s+if \(leadSrc\) formData\.lead_source = leadSrc;/g) || [];
    assert.equal(uses.length, 2, 'the quick lead and the final submit');
    assert.match(INTAKE, /lead_source: intakeLeadSource\(\) \|\| _cookieAttr\.src \|\| undefined,/, 'the /track autosave');
    assert.doesNotMatch(INTAKE, /if \(srcParam\) formData\.lead_source = srcParam;/, 'no path sends the button name over the flyer');
  });

  test('MUST-FAIL: a later browser session (the session cookie gone) still files the lead under the flyer from the last touch', async () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/home?src=flyer-test');
    // Closing the browser drops session cookies; the 30-day last touch stays.
    jar.setCookieSync('twa_cs=; Path=/; Secure; Max-Age=0', SITE + '/');
    assert.equal(cookie(jar, 'twa_cs'), undefined);
    assert.equal(intakeLead(await intakePage(jar, SITE + '/intake/?src=hero')), 'flyer-test');
  });

  test('without a flyer, the button that opened the wizard is the lead_source, as before', async () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/home');
    assert.equal(intakeLead(await intakePage(jar, SITE + '/intake/?src=hero')), 'hero');
  });

  test('the quick lead sends the attribution object (it sent none)', () => {
    const start = INTAKE.indexOf("const formData = { quick_lead: 'true' };");
    assert.ok(start > 0, 'quick-lead sender not found');
    const block = INTAKE.slice(start, INTAKE.indexOf('if (!res.ok)', start));
    assert.match(block, /fetch\(SAGE_API \+ '\/api\/intake', \{/);
    assert.match(block, /attribution: TWA\.getAttribution\(\)/);
  });
});

describe('a flyer code or an agent link is a touch; a site button is not', () => {
  test('MUST-FAIL: a flyer-only landing writes the touch cookies with the flyer as src', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/home?src=flyer-ho');
    assert.equal((touch(jar, 'twa_lt') || {}).src, 'flyer-ho');
    assert.equal((touch(jar, 'twa_ft') || {}).src, 'flyer-ho');
    assert.equal(attr(visit(jar, SITE + '/about')).src, 'flyer-ho', 'a page change keeps it');
  });

  test('MUST-FAIL: a visitor who arrived with utm_source and gclid and then clicks a site button keeps them in last touch', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/auto?utm_source=newsletter&utm_medium=email&gclid=TST-gclid-1');
    for (const b of ['/intake/?src=hero', '/intake/?src=sticky', '/intake/?src=inline', '/intake/?src=exit-intent', '/intake/?src=coverage-review', '/intake/?src=bday-card']) visit(jar, SITE + b);
    const lt = touch(jar, 'twa_lt');
    assert.equal(lt.utm_source, 'newsletter');
    assert.equal(lt.gclid, 'TST-gclid-1');
    assert.equal(lt.src, undefined, 'no button name in the last touch');
  });

  test('MUST-FAIL: an agent-only landing survives a page change and a click-through, in attribution.agent', async () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/home?agent=tst-producer');
    assert.equal(attr(visit(jar, SITE + '/about')).agent, 'tst-producer');
    const w = await intakePage(jar, SITE + '/intake/?src=hero');
    assert.equal(attr(w).agent, 'tst-producer', 'sent with the lead as attribution.agent');
  });

  test('a held agent does not route: the wizard sends its own ?agent= only (HELD_AGENT_ROUTES false, Luke\'s call)', async () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/home?agent=tst-producer');
    const w = await intakePage(jar, SITE + '/intake/?src=hero');
    const routing = (win) => (typeof win.routingAgent === 'function' ? win.routingAgent() : '(no routingAgent)');
    assert.equal(routing(w), '', 'a held agent is not sent as the routing agent');
    const own = await intakePage(jar, SITE + '/intake/?agent=tst-other');
    assert.equal(routing(own), 'tst-other', "the wizard's own quote link still routes, as today");
    assert.match(INTAKE, /\nconst HELD_AGENT_ROUTES = false;\n/, 'one guarded line decides');
  });

  test('an agent value that is not a slug is no touch and is not kept', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/?agent=' + encodeURIComponent('<b>x</b>'));
    assert.equal(cookie(jar, 'twa_lt'), undefined);
    assert.equal(attr(visit(jar, SITE + '/about')).agent, '');
  });
});

describe('the flyer code is kept for the session (twa_cs, attribution.campaign_src)', () => {
  test('a flyer landing, a new tab: campaign_src is there', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/?src=flyer-ho');
    assert.equal(attr(visit(jar, SITE + '/contact')).campaign_src, 'flyer-ho');
  });

  test('twa_cs is a session cookie: no expiry, Secure, SameSite=Lax, Path=/', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/?src=flyer-ho');
    const c = cookie(jar, 'twa_cs');
    assert.ok(c, 'twa_cs was not written');
    assert.equal(c.expires, 'Infinity');
    assert.equal(c.maxAge, null);
    assert.equal(c.secure, true);
    assert.equal(String(c.sameSite).toLowerCase(), 'lax');
    assert.equal(c.path, '/');
  });

  test('a later click on a site button never replaces the flyer code; the latest flyer wins', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/?src=flyer-ho');
    visit(jar, SITE + '/intake/?src=hero');
    assert.equal(leadSourceOf(visit(jar, SITE + '/intake/?src=inline'), 'inline'), 'flyer-ho');
    visit(jar, SITE + '/?src=flyer-au');
    assert.equal(attr(visit(jar, SITE + '/about')).campaign_src, 'flyer-au');
  });

  test('a new flyer code needs no code change (any flyer-[a-z0-9]{2,8})', () => {
    for (const code of ['flyer-pl', 'flyer-clm', 'flyer-stm', 'flyer-test', 'flyer-new2026']) {
      assert.equal(attr(visit(new CookieJar(), SITE + '/?src=' + code)).campaign_src, code);
    }
  });

  test('Y-76: a landing on /personal/rv?src=flyer-rv is captured like any flyer landing', () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/personal/rv?src=flyer-rv');
    assert.equal(attr(visit(jar, SITE + '/intake/?product=rv')).campaign_src, 'flyer-rv');
  });

  test('rep is gone (Luke 11/15: use agent=): no rep anywhere in what is sent', () => {
    const a = attr(visit(new CookieJar(), SITE + '/?src=flyer-ho&rep=JS'));
    assert.equal(a.rep, undefined);
    assert.doesNotMatch(ATTR, /\brep\b/);
  });
});

describe('only a valid code is kept', () => {
  test('invalid flyer values are ignored: no session cookie, no touch, no lead_source', () => {
    const bad = ['hero', 'inline', 'FLYER-HO', 'flyer-h', 'flyer-123456789', 'flyer-', 'flyer-<b>x</b>', 'flyer-ho"><img src=x>'];
    for (const v of bad) {
      const jar = new CookieJar();
      const w = visit(jar, SITE + '/?src=' + encodeURIComponent(v));
      assert.equal(attr(w).campaign_src, undefined, v);
      assert.equal(cookie(jar, 'twa_cs'), undefined, v);
      assert.equal(cookie(jar, 'twa_lt'), undefined, `${v}: not a touch`);
      assert.equal(leadSourceOf(w, ''), '', v);
    }
  });

  test('a cookie edited by hand is checked again on read', () => {
    const jar = new CookieJar();
    jar.setCookieSync('twa_cs=' + encodeURIComponent(JSON.stringify({ campaign_src: 'flyer-<script>' })) + '; Path=/; Secure', SITE + '/');
    jar.setCookieSync('twa_lt=' + encodeURIComponent(JSON.stringify({ src: 'flyer-<b>', agent: '<i>x</i>' })) + '; Path=/; Secure', SITE + '/');
    const w = visit(jar, SITE + '/');
    assert.deepEqual(campaignOf(w), {});
    assert.equal(attr(w).campaign_src, undefined);
    assert.equal(attr(w).agent, '');
    assert.equal(leadSourceOf(w, 'hero'), 'hero');
  });
});

describe('/contact preselects "I want a coverage review" for the coverage-review flyer', () => {
  // The page's own HTML and inline scripts. app.js (deferred, carries window.TWA)
  // is stood in for by attribution.js inline at the same place, which also runs
  // before DOMContentLoaded.
  function contactPage(jar, url, html = CONTACT) {
    // A probe counts change events on the select, as the page's own listeners see them.
    const probe = '<script>window.__changes = 0; document.getElementById("subject").addEventListener("change", function () { window.__changes += 1; });</script>';
    const page = html.replace('<script src="/src/js/app.js" defer></script>', () => probe + '<script>' + ATTR + '\nwindow.TWA.captureAttribution();</script>');
    assert.notEqual(page, html, 'app.js script tag not found on /contact');
    const dom = new JSDOM(page, { url, cookieJar: jar, runScripts: 'dangerously', virtualConsole: new VirtualConsole() });
    return new Promise((resolve) => {
      const done = () => setTimeout(() => resolve(dom.window), 0);
      if (dom.window.document.readyState === 'loading') dom.window.document.addEventListener('DOMContentLoaded', done);
      else done();
    });
  }
  const subject = (w) => w.document.getElementById('subject');

  test('a landing on /contact?src=flyer-stm has "review" chosen and the callback time hidden', async () => {
    const w = await contactPage(new CookieJar(), SITE + '/contact?src=flyer-stm');
    assert.equal(subject(w).value, 'review');
    assert.equal(subject(w).selectedOptions[0].textContent, 'I want a coverage review');
    assert.equal(w.document.getElementById('callback-time-group').style.display, 'none');
    assert.equal(w.__changes, 1, 'the page\'s change listeners run once for the preselect');
  });

  test('flyer-stm seen on an earlier page also preselects it', async () => {
    const jar = new CookieJar();
    visit(jar, SITE + '/?src=flyer-stm');
    assert.equal(subject(await contactPage(jar, SITE + '/contact')).value, 'review');
  });

  test('any other flyer, or none, leaves the choice empty', async () => {
    const other = await contactPage(new CookieJar(), SITE + '/contact?src=flyer-ho');
    assert.equal(subject(other).value, '');
    assert.equal(other.__changes, 0);
    assert.equal(subject(await contactPage(new CookieJar(), SITE + '/contact')).value, '');
    assert.equal(subject(await contactPage(new CookieJar(), SITE + '/contact?src=stm')).value, '');
  });

  test('a choice the visitor already made is kept', async () => {
    const chosen = CONTACT.replace('<option value="quote">', '<option value="quote" selected>');
    assert.notEqual(chosen, CONTACT);
    assert.equal(subject(await contactPage(new CookieJar(), SITE + '/contact?src=flyer-stm', chosen)).value, 'quote');
  });
});
