/**
 * CONV-08: the intake's submit state and saved drafts.
 *
 * After a successful quick lead the wizard used to stay "unsubmitted": Chrome
 * still asked "Leave site?", intake_abandoned fired on every later tab switch,
 * a resumed draft paged a producer by itself, and the resume toast greeted the
 * next user of the device with the previous visitor's full name.
 *
 * Drives the REAL src/intake.html in jsdom with src/js/attribution.js inlined,
 * every fetch answered locally. Synthetic values only.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');
const ATTR = fs.readFileSync(path.join(ROOT, 'src', 'js', 'attribution.js'), 'utf8');
const ATTR_TAG = '<script src="/src/js/attribution.js"></script>';
const PAGE = HTML.replace(ATTR_TAG, '<script>' + ATTR + '</script>');

const FIRST = 'Zz', LAST = 'Privacycheck', EMAIL = 'zz.privacycheck@example.com', PHONE = '5555550123';
const RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  productLines: { auto: 'personal', homeowners: 'personal', term_life: 'life', medicare: 'health' },
  stateNames: { KY: 'Kentucky' }, declineTemplate: "We aren't licensed in {{STATE}}.", stateToken: '{{STATE}}',
};

async function loadIntake({ url = 'https://www.thewayagency.com/intake/?product=auto&src=inline', seed } = {}) {
  const calls = [];
  const dom = new JSDOM(PAGE, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      if (seed) seed(w);
      w.fetch = (input, init) => {
        const href = String(input);
        calls.push({ url: href, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
        if (href.includes('/api/intake/rules')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RULES) });
        if (href.includes('/api/intake/track')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, sessionId: 'test-session-test-session' }) });
        if (href.endsWith('/api/intake')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, reference: 'TEST' }) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
      // A loaded Turnstile with a token: the page never posts without one (CONV-10).
      w.turnstile = { render() { return 'w1'; }, reset() {} };
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (w.serviceStateNames && w.serviceStateNames()) break;
  }
  w.eval("_turnstileSiteKey = 'test-key-test-key-test-key'; turnstileToken = 'test-token-test-token-test-token-test-token'");
  w.__calls = calls;
  return w;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const set = (w, id, v) => { const el = w.document.getElementById(id); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const fillStep1 = (w) => { set(w, 'i_fname', FIRST); set(w, 'i_lname', LAST); set(w, 'i_email', EMAIL); set(w, 'i_phone', PHONE); w.document.getElementById('i_state').value = 'KY'; };
const abandons = (w) => (w.dataLayer || []).filter((e) => e && e[0] === 'event' && e[1] === 'intake_abandoned').length;
function hideAndShow(w) {
  for (const state of ['hidden', 'visible']) {
    Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => state });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
  }
}
function beforeUnloadPrevented(w) {
  const ev = new w.Event('beforeunload', { cancelable: true });
  w.dispatchEvent(ev);
  return ev.defaultPrevented;
}

describe('a successful submit ends the form (markSubmitted)', () => {
  test('quick lead: no Leave-site prompt, no abandonment, _submitted set, draft cleared', async () => {
    const w = await loadIntake();
    try {
      fillStep1(w);
      w.eval("selectedProducts = ['auto']");
      assert.equal(beforeUnloadPrevented(w), true, 'control: unsaved input does prompt');
      await w.submitQuickLead();
      assert.equal(w.document.getElementById('ref-number').textContent, 'Reference: #TEST');
      assert.equal(w.eval('_submitted'), true);
      assert.equal(beforeUnloadPrevented(w), false, 'the Leave-site prompt still fires after a successful quick lead');
      hideAndShow(w);
      w.dispatchEvent(new w.Event('pagehide'));
      assert.equal(abandons(w), 0, 'intake_abandoned after a successful quick lead');
      await sleep(700);
      assert.equal(w.localStorage.getItem('twa_intake_draft'), null, 'a draft was re-created after submit');
    } finally { w.close(); }
  });

  test('full submit: the same end state', async () => {
    const w = await loadIntake();
    try {
      fillStep1(w);
      w.eval("selectedProducts = ['auto']");
      await w.submitIntake();
      assert.equal(w.eval('_submitted'), true);
      assert.equal(beforeUnloadPrevented(w), false);
      hideAndShow(w);
      assert.equal(abandons(w), 0);
    } finally { w.close(); }
  });

  test('no exit flush to /api/intake/track after a submit', async () => {
    const w = await loadIntake();
    try {
      fillStep1(w);
      w.eval("selectedProducts = ['auto']; sessionId = 'test-session-test-session'");
      await w.submitQuickLead();
      set(w, 'i_fname', FIRST); // a stray input after the confirmation
      const before = w.__calls.filter((c) => c.url.includes('/api/intake/track')).length;
      w.dispatchEvent(new w.Event('pagehide'));
      assert.equal(w.__calls.filter((c) => c.url.includes('/api/intake/track')).length, before);
    } finally { w.close(); }
  });
});

describe('intake_abandoned: at most once per page load', () => {
  test('three hide/show cycles and a pagehide push exactly one event', async () => {
    const w = await loadIntake();
    try {
      set(w, 'i_fname', FIRST);
      hideAndShow(w); hideAndShow(w); hideAndShow(w);
      w.dispatchEvent(new w.Event('pagehide'));
      assert.equal(abandons(w), 1);
    } finally { w.close(); }
  });

  test('both listeners are still registered (visibilitychange first, pagehide as fallback)', () => {
    assert.match(HTML, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'hidden'\) trackAbandonment\(\); \}\);/);
    assert.match(HTML, /window\.addEventListener\('pagehide', trackAbandonment\);/);
  });

  test('pagehide alone (no visibilitychange) still reports once', async () => {
    const w = await loadIntake();
    try {
      w.dispatchEvent(new w.Event('pagehide'));
      w.dispatchEvent(new w.Event('pagehide'));
      assert.equal(abandons(w), 1);
    } finally { w.close(); }
  });
});

describe('resuming a draft', () => {
  // A draft as the pre-fix page wrote it (identity included); the D11 commit
  // changes what is stored, not this behaviour.
  const seedDraft = (win) => win.localStorage.setItem('twa_intake_draft', JSON.stringify({
    fields: { i_fname: FIRST, i_lname: LAST, i_email: EMAIL, i_phone: PHONE, i_state: 'KY' },
    products: ['auto'], vehicles: [], step: 2, hoSameAddr: true, savedAt: Date.now() - 5 * 60 * 1000,
  }));

  test('the resume toast shows no name', async () => {
    const w = await loadIntake({ seed: seedDraft });
    try {
      await sleep(400);
      const text = w.document.getElementById('draft-toast-detail').textContent;
      assert.ok(w.document.getElementById('draft-toast').classList.contains('visible'), 'toast not shown');
      assert.match(text, /^Saved \d+ minutes? ago\.$/);
      assert.ok(!text.includes(LAST) && !text.includes(FIRST + ' '), text);
    } finally { w.close(); }
  });

  test('restoring never pages a producer by itself (no /track with notify:true)', async () => {
    const w = await loadIntake({ seed: seedDraft });
    try {
      w.document.getElementById('draft-resume-btn').click();
      await sleep(2200); // past the old 500 ms auto-notify and the 1.5 s autosave debounce
      const notifies = w.__calls.filter((c) => c.url.includes('/api/intake/track') && c.body && c.body.notify === true);
      assert.equal(notifies.length, 0);
    } finally { w.close(); }
  });
});
