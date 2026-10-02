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
    },
  });
  const w = dom.window;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (w.serviceStateNames && w.serviceStateNames()) break;
  }
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
  // This tab's own draft (the session store), as the page writes it after a
  // Continue: identity plus the SAGE session.
  const seedSessionDraft = (win) => win.sessionStorage.setItem('twa_intake_draft_s', JSON.stringify({
    v: 2, fields: { i_fname: FIRST, i_lname: LAST, i_email: EMAIL, i_phone: PHONE, i_state: 'KY' },
    products: ['auto'], vehicles: [], step: 2, hoSameAddr: true, sessionId: 'test-session-test-session',
    savedAt: Date.now() - 5 * 60 * 1000,
  }));

  test('the resume toast shows no name', async () => {
    const w = await loadIntake({ seed: seedSessionDraft });
    try {
      await sleep(400);
      const text = w.document.getElementById('draft-toast-detail').textContent;
      assert.ok(w.document.getElementById('draft-toast').classList.contains('visible'), 'toast not shown');
      assert.match(text, /^Saved \d+ minutes? ago\.$/);
      assert.ok(!text.includes(LAST) && !text.includes(FIRST + ' '), text);
    } finally { w.close(); }
  });

  test('restoring never pages a producer by itself, and a same-tab draft keeps its SAGE session', async () => {
    const w = await loadIntake({ seed: seedSessionDraft });
    try {
      w.document.getElementById('draft-resume-btn').click();
      await sleep(2200); // past the old 500 ms auto-notify and the 1.5 s autosave debounce
      const tracks = w.__calls.filter((c) => c.url.includes('/api/intake/track'));
      assert.equal(tracks.filter((c) => c.body && c.body.notify === true).length, 0, 'a resume paged a producer');
      assert.ok(tracks.length >= 1, 'the resumed step autosaves');
      for (const t of tracks) assert.equal(t.body.sessionId, 'test-session-test-session', 'the autosave started a new SAGE session');
      assert.equal(w.document.getElementById('i_email').value, EMAIL, 'same-tab identity restored');
      assert.ok(!w.document.getElementById('step-2').classList.contains('hidden'), 'resumed at step 2');
    } finally { w.close(); }
  });

  test('a cross-visit draft resumes at step 1 with no identity and pages nobody', async () => {
    const w = await loadIntake({
      seed(win) {
        win.localStorage.setItem('twa_intake_draft', JSON.stringify({ v: 2, fields: { i_state: 'KY', i_current_carrier: 'Test Carrier' },
          products: ['auto'], vehicles: [], step: 2, hoSameAddr: true, savedAt: Date.now() - 60 * 60 * 1000 }));
      },
    });
    try {
      w.document.getElementById('draft-resume-btn').click();
      await sleep(2200);
      assert.ok(!w.document.getElementById('step-1').classList.contains('hidden'), 'not at step 1');
      assert.equal(w.document.getElementById('i_fname').value, '');
      assert.equal(w.document.getElementById('i_state').value, 'KY');
      assert.equal(w.__calls.filter((c) => c.url.includes('/api/intake/track')).length, 0);
    } finally { w.close(); }
  });
});

describe('draft retention (owner decision D11): identity only in this tab, selections for at most 24 hours', () => {
  const EXCLUDED = ['i_fname', 'i_lname', 'i_email', 'i_phone', 'i_dob', 'i_address', 'i_address_street', 'i_city', 'i_zip',
    'i_notes', 'i_other_desc', 'i_biz_name', 'i_umb_assets', 'i_ho_address', 'i_ho_address_street', 'i_ho_city', 'i_ho_state', 'i_ho_zip', 'i_df_address'];
  const EXCLUDED_PREFIX = /^i_(li|med|mcd|ih|fh|gh|sh|dv|ann|dis)_/;

  test('the allowlist holds no identity, address or health field', async () => {
    const w = await loadIntake();
    try {
      const allow = JSON.parse(w.eval('JSON.stringify(DRAFT_PERSIST_FIELD_IDS)'));
      for (const id of allow) {
        assert.ok(!EXCLUDED.includes(id), `${id} must not persist across visits`);
        assert.doesNotMatch(id, EXCLUDED_PREFIX, `${id} must not persist across visits`);
      }
      assert.equal(w.eval('DRAFT_MAX_AGE'), 24 * 60 * 60 * 1000);
    } finally { w.close(); }
  });

  test('identity, DOB, address, notes and life/health answers stay out of localStorage', async () => {
    const w = await loadIntake();
    try {
      fillStep1(w);
      w.eval("selectedProducts = ['term_life', 'medicare', 'auto']");
      w.showStep(3); // renders the life and Medicare question cards
      set(w, 'i_dob', '01/01/1970');
      set(w, 'i_address', '1 Test St, Testville, KY 40000');
      set(w, 'i_notes', 'Zz Privacycheck note');
      w.document.getElementById('i_li_tobacco').value = 'never';
      w.document.getElementById('i_med_status').value = 'both';
      w.document.getElementById('i_current_carrier').value = 'Test Carrier';
      w.document.getElementById('i_med_status').dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(650);
      const local = JSON.parse(w.localStorage.getItem('twa_intake_draft'));
      assert.equal(local.v, 2);
      const allow = JSON.parse(w.eval('JSON.stringify(DRAFT_PERSIST_FIELD_IDS)'));
      for (const k of Object.keys(local.fields)) assert.ok(allow.includes(k), `${k} is not allowlisted`);
      for (const id of EXCLUDED) assert.ok(!(id in local.fields), `${id} reached localStorage`);
      assert.ok(!Object.keys(local.fields).some((k) => EXCLUDED_PREFIX.test(k)), 'a life/health answer reached localStorage');
      assert.equal(local.fields.i_current_carrier, 'Test Carrier');
      assert.ok(!('sessionId' in local), 'the SAGE session id stays in this tab');
      const raw = w.localStorage.getItem('twa_intake_draft');
      for (const m of [LAST, EMAIL, PHONE, '1970', 'Testville']) assert.ok(!raw.includes(m), `localStorage carries ${m}`);
      const sess = JSON.parse(w.sessionStorage.getItem('twa_intake_draft_s'));
      assert.equal(sess.fields.i_email, EMAIL, 'the tab draft keeps identity');
      assert.equal(sess.fields.i_li_tobacco, 'never');
      assert.equal(sess.fields.i_med_status, 'both');
    } finally { w.close(); }
  });

  test('a cross-visit draft older than 24 hours is discarded and no toast shows', async () => {
    const w = await loadIntake({
      seed(win) {
        win.localStorage.setItem('twa_intake_draft', JSON.stringify({ v: 2, fields: { i_state: 'KY' }, products: ['auto'], vehicles: [],
          step: 2, hoSameAddr: true, savedAt: Date.now() - 25 * 3600 * 1000 }));
      },
    });
    try {
      await sleep(400);
      assert.ok(!w.document.getElementById('draft-toast').classList.contains('visible'));
      assert.equal(w.localStorage.getItem('twa_intake_draft'), null);
    } finally { w.close(); }
  });

  test('a pre-fix draft (no version, with identity) is purged on load and never offered', async () => {
    const w = await loadIntake({
      seed(win) {
        win.localStorage.setItem('twa_intake_draft', JSON.stringify({ fields: { i_fname: FIRST, i_email: EMAIL }, products: ['auto'],
          vehicles: [], step: 2, hoSameAddr: true, savedAt: Date.now() - 60 * 1000 }));
      },
    });
    try {
      await sleep(400);
      assert.equal(w.localStorage.getItem('twa_intake_draft'), null);
      assert.ok(!w.document.getElementById('draft-toast').classList.contains('visible'));
    } finally { w.close(); }
  });

  test('attribution.js purges a pre-fix draft on any page, before the visitor returns to /intake/', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
      url: 'https://www.thewayagency.com/personal/auto', runScripts: 'dangerously',
      beforeParse(win) {
        win.localStorage.setItem('twa_intake_draft', JSON.stringify({ fields: { i_email: EMAIL }, savedAt: Date.now() }));
      },
    });
    const w = dom.window;
    try {
      const sc = w.document.createElement('script'); sc.textContent = ATTR; w.document.head.appendChild(sc);
      assert.equal(w.localStorage.getItem('twa_intake_draft'), null);
      // A current-format draft survives.
      const keep = JSON.stringify({ v: 2, fields: { i_state: 'KY' }, products: [], savedAt: Date.now() });
      w.localStorage.setItem('twa_intake_draft', keep);
      const dom2 = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
        url: 'https://www.thewayagency.com/personal/auto', runScripts: 'dangerously',
        beforeParse(win) { win.localStorage.setItem('twa_intake_draft', keep); },
      });
      const sc2 = dom2.window.document.createElement('script'); sc2.textContent = ATTR; dom2.window.document.head.appendChild(sc2);
      assert.equal(dom2.window.localStorage.getItem('twa_intake_draft'), keep);
      dom2.window.close();
    } finally { w.close(); }
  });

  test('a cross-visit draft restores only allowlisted fields, whatever wrote it', async () => {
    const w = await loadIntake({
      seed(win) {
        win.localStorage.setItem('twa_intake_draft', JSON.stringify({ v: 2, fields: { i_state: 'KY', i_email: EMAIL }, products: ['auto'],
          vehicles: [], step: 2, hoSameAddr: true, sessionId: 'test-session-test-session', savedAt: Date.now() - 60 * 1000 }));
      },
    });
    try {
      w.document.getElementById('draft-resume-btn').click();
      await sleep(300);
      assert.equal(w.document.getElementById('i_email').value, '');
      assert.equal(w.eval('sessionId'), null, 'a cross-visit draft never resumes a SAGE session');
    } finally { w.close(); }
  });

  test('the inline-form hand-off lands in the tab draft only, and a reload can resume it', async () => {
    const w = await loadIntake({
      url: 'https://www.thewayagency.com/intake/?product=auto&line=personal&src=inline',
      seed(win) { win.sessionStorage.setItem('twa_inline_prefill', JSON.stringify({ v: 1, at: Date.now(), name: FIRST + ' ' + LAST, email: EMAIL, phone: PHONE })); },
    });
    try {
      await sleep(50);
      const sess = JSON.parse(w.sessionStorage.getItem('twa_intake_draft_s'));
      assert.equal(sess.fields.i_email, EMAIL);
      const local = w.localStorage.getItem('twa_intake_draft');
      assert.ok(!local || !local.includes(EMAIL), 'the hand-off reached localStorage');
    } finally { w.close(); }
  });
});
