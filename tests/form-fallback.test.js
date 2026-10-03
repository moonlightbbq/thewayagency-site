/**
 * Failure states on /contact and /intake/ always offer tappable call and text
 * links, keep what the visitor typed, push one PII-free lead_submit_error, and
 * never post without a Turnstile token (CONV-10, above-the-fold spec Step 7).
 * /contact no longer calls a server refusal a "Connection error".
 *
 * Drives the real pages in jsdom with stubbed fetch and Turnstile. No network,
 * synthetic values only.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const CONTACT = fs.readFileSync(path.join(ROOT, 'src/pages/contact.html'), 'utf8');
const INTAKE = fs.readFileSync(path.join(ROOT, 'src/intake.html'), 'utf8');
const TOKEN = 'test-token-test-token-test-token-test-token';
const SITEKEY = 'test-key-test-key-test-key';
const PII = ['Zz', 'Privacycheck', 'zz.privacycheck@example.com', '5555550123', '(555) 555-0123'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// turnstile: 'none' (not loaded), 'stuck' (never returns a token), 'ok' (token at once)
function turnstileStub(mode) {
  if (mode === 'none') return undefined;
  return {
    render(_el, opts) { if (mode === 'ok') setTimeout(() => opts.callback(TOKEN), 0); return 'w1'; },
    reset() {},
  };
}

// answer: { status, body } | 'reject'
function fetchStub(w, answer, posts, extra = {}) {
  return (url, opts = {}) => {
    const u = String(url);
    if (opts.method === 'POST' && /\/api\/intake(\/lead)?$/.test(u)) {
      posts.push(u);
      if (answer === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: () => Promise.resolve(answer.body || {}) });
    }
    if (u.includes('/api/config')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(extra.config || {}) });
    if (u.includes('/api/intake/rules')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ serviceStates: ['KY', 'IN', 'TN'], stateNames: { KY: 'Kentucky' } }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };
}

function checkFallback(w, el, events, formType, code, { email } = {}) {
  const tel = el.querySelectorAll('a[href="tel:+15024135335"]');
  const sms = el.querySelectorAll('a[href="sms:+15024135335"]');
  assert.equal(tel.length, 1, `no call link in: ${el.textContent}`);
  assert.equal(sms.length, 1, `no text link in: ${el.textContent}`);
  assert.ok(![...el.querySelectorAll('a')].some((a) => /body=/.test(a.getAttribute('href'))));
  if (email) assert.equal(el.querySelectorAll('a[href^="mailto:"]').length, 1);
  assert.doesNotMatch(el.textContent, /Connection error/);
  const errs = events.filter((e) => e && e.event === 'lead_submit_error');
  assert.equal(errs.length, 1, 'exactly one lead_submit_error');
  assert.deepEqual(Object.keys(errs[0]).sort(), ['error_code', 'event', 'form_type']);
  assert.equal(errs[0].form_type, formType);
  assert.equal(errs[0].error_code, code);
  const flat = JSON.stringify(errs[0]);
  for (const v of PII) assert.ok(!flat.includes(v), 'no PII in the event');
}

// ── /contact ────────────────────────────────────────────────────────────────
async function loadContact({ turnstile = 'ok', answer = { status: 200, body: { ok: true } } } = {}) {
  const posts = [];
  const dom = new JSDOM(CONTACT, {
    runScripts: 'dangerously', url: 'https://www.thewayagency.com/contact',
    beforeParse(w) {
      w.fetch = fetchStub(w, answer, posts);
      w.turnstile = turnstileStub(turnstile);
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.dataLayer = [];
    },
  });
  const w = dom.window;
  const d = w.document;
  d.getElementById('c_fname').value = 'Zz';
  d.getElementById('c_lname').value = 'Privacycheck';
  d.getElementById('c_email').value = 'zz.privacycheck@example.com';
  d.getElementById('c_phone').value = '(555) 555-0123';
  d.getElementById('subject').value = 'quote';
  return { w, d, posts };
}
async function submitContact(ctx, waitMs = 300) {
  ctx.d.getElementById('contactForm').dispatchEvent(new ctx.w.Event('submit', { cancelable: true, bubbles: true }));
  await sleep(waitMs);
  return ctx.d.getElementById('contact-error');
}
function contactValuesIntact(d) {
  assert.equal(d.getElementById('c_fname').value, 'Zz');
  assert.equal(d.getElementById('c_email').value, 'zz.privacycheck@example.com');
  assert.equal(d.getElementById('contactForm').style.display, '');
}

describe('/contact failure states', () => {
  test('(a) no Turnstile: fallback at once, no POST', async () => {
    const ctx = await loadContact({ turnstile: 'none' });
    try {
      const el = await submitContact(ctx);
      assert.equal(ctx.posts.length, 0, 'posted without a token');
      assert.match(el.textContent, /couldn't run the security check/);
      checkFallback(ctx.w, el, ctx.w.dataLayer, 'contact', 'turnstile_unavailable');
      contactValuesIntact(ctx.d);
    } finally { ctx.w.close(); }
  });

  test('(b) a token that never arrives: fallback after the poll, no POST', async () => {
    const ctx = await loadContact({ turnstile: 'stuck' });
    try {
      const el = await submitContact(ctx, 5600);
      assert.equal(ctx.posts.length, 0);
      checkFallback(ctx.w, el, ctx.w.dataLayer, 'contact', 'turnstile_timeout');
      contactValuesIntact(ctx.d);
    } finally { ctx.w.close(); }
  });

  for (const [status, code, re] of [[403, 'http_403', /couldn't verify/], [429, 'http_429', /several messages/], [500, 'http_5xx', /didn't accept/], [503, 'http_5xx', /didn't accept/]]) {
    test(`(c/d) server ${status}: accurate message with call and text, not "Connection error"`, async () => {
      const ctx = await loadContact({ answer: { status, body: { error: 'Verification failed' } } });
      try {
        const el = await submitContact(ctx);
        assert.equal(ctx.posts.length, 1);
        assert.match(el.textContent, re);
        checkFallback(ctx.w, el, ctx.w.dataLayer, 'contact', code);
        contactValuesIntact(ctx.d);
      } finally { ctx.w.close(); }
    });
  }

  test('(e) rejected fetch: connection message with call, text and email', async () => {
    const ctx = await loadContact({ answer: 'reject' });
    try {
      const el = await submitContact(ctx);
      assert.match(el.textContent, /couldn't reach our server/);
      checkFallback(ctx.w, el, ctx.w.dataLayer, 'contact', 'network', { email: true });
      contactValuesIntact(ctx.d);
    } finally { ctx.w.close(); }
  });

  test('400 shows the server\'s own words, no fallback and no event', async () => {
    const ctx = await loadContact({ answer: { status: 400, body: { error: 'Please enter a valid phone number.' } } });
    try {
      const el = await submitContact(ctx);
      assert.equal(el.textContent, 'Please enter a valid phone number.');
      assert.equal(el.querySelectorAll('a').length, 0);
      assert.equal(ctx.w.dataLayer.filter((e) => e && e.event === 'lead_submit_error').length, 0);
    } finally { ctx.w.close(); }
  });

  test('success still works', async () => {
    const ctx = await loadContact({ answer: { status: 200, body: { ok: true, reference: 'R1' } } });
    try {
      await submitContact(ctx);
      assert.equal(ctx.d.getElementById('contact-success').style.display, 'block');
      assert.equal(ctx.w.dataLayer.filter((e) => e && e.event === 'lead_submit_error').length, 0);
    } finally { ctx.w.close(); }
  });
});

// ── /intake/ ────────────────────────────────────────────────────────────────
async function loadIntake({ turnstile = 'ok', answer = { status: 200, body: { ok: true, reference: 'R1' } }, sitekey = true } = {}) {
  const posts = [];
  const dom = new JSDOM(INTAKE, {
    runScripts: 'dangerously', url: 'https://www.thewayagency.com/intake/',
    beforeParse(w) {
      w.fetch = fetchStub(w, answer, posts, { config: sitekey ? { turnstileSiteKey: SITEKEY } : {} });
      w.turnstile = turnstileStub(turnstile);
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      Object.defineProperty(w.HTMLElement.prototype, 'scrollIntoView', { value: () => {} });
    },
  });
  const w = dom.window;
  await sleep(50);
  const d = w.document;
  d.getElementById('i_fname').value = 'Zz';
  d.getElementById('i_lname').value = 'Privacycheck';
  d.getElementById('i_email').value = 'zz.privacycheck@example.com';
  d.getElementById('i_phone').value = '(555) 555-0123';
  w.eval("selectedProducts = ['auto']");
  if (turnstile === 'ok') w.eval(`turnstileToken = ${JSON.stringify(TOKEN)}`);
  return { w, d, posts };
}
const intakeErrors = (w) => (w.dataLayer || []).filter((e) => e && e.event === 'lead_submit_error');
function intakeValuesIntact(d) {
  assert.equal(d.getElementById('i_fname').value, 'Zz');
  assert.equal(d.getElementById('i_email').value, 'zz.privacycheck@example.com');
}

for (const [label, run, errId, formType] of [
  ['final submit (step 4)', (w) => w.submitIntake(), 'step4-error', 'intake_final'],
  ['quick lead (step 2)', (w) => w.submitQuickLead(), 'step2-error', 'intake_quick'],
]) {
  describe(`/intake/ ${label} failure states`, () => {
    test('(a) no Turnstile: fallback, and NO POST', async () => {
      const ctx = await loadIntake({ turnstile: 'none' });
      try {
        await run(ctx.w);
        assert.equal(ctx.posts.length, 0, 'posted an empty token SAGE always rejects');
        const el = ctx.d.getElementById(errId);
        checkFallback(ctx.w, el, intakeErrors(ctx.w), formType, 'turnstile_unavailable');
        intakeValuesIntact(ctx.d);
      } finally { ctx.w.close(); }
    });

    test('(a2) Turnstile loaded but no site key from /api/config: fallback, no POST', async () => {
      const ctx = await loadIntake({ turnstile: 'stuck', sitekey: false });
      try {
        ctx.w.eval('turnstileToken = null');
        await run(ctx.w);
        assert.equal(ctx.posts.length, 0);
        checkFallback(ctx.w, ctx.d.getElementById(errId), intakeErrors(ctx.w), formType, 'turnstile_unavailable');
      } finally { ctx.w.close(); }
    });

    test('(b) a token that never arrives: fallback after the poll, no POST', async () => {
      const ctx = await loadIntake({ turnstile: 'stuck' });
      try {
        await run(ctx.w);
        assert.equal(ctx.posts.length, 0);
        checkFallback(ctx.w, ctx.d.getElementById(errId), intakeErrors(ctx.w), formType, 'turnstile_timeout');
        intakeValuesIntact(ctx.d);
      } finally { ctx.w.close(); }
    });

    for (const [status, code] of [[403, 'http_403'], [429, 'http_429'], [500, 'http_5xx']]) {
      test(`(c/d) server ${status}: call and text fallback`, async () => {
        const ctx = await loadIntake({ answer: { status, body: { error: 'Verification failed' } } });
        try {
          await run(ctx.w);
          assert.equal(ctx.posts.length, 1);
          checkFallback(ctx.w, ctx.d.getElementById(errId), intakeErrors(ctx.w), formType, code);
          intakeValuesIntact(ctx.d);
        } finally { ctx.w.close(); }
      });
    }

    test('(e) rejected fetch: fallback with email', async () => {
      const ctx = await loadIntake({ answer: 'reject' });
      try {
        await run(ctx.w);
        checkFallback(ctx.w, ctx.d.getElementById(errId), intakeErrors(ctx.w), formType, 'network', { email: true });
        intakeValuesIntact(ctx.d);
      } finally { ctx.w.close(); }
    });

    test('400 field message is unchanged (no fallback, no event)', async () => {
      const ctx = await loadIntake({ answer: { status: 400, body: { error: 'Please enter a valid email.' } } });
      try {
        await run(ctx.w);
        const el = ctx.d.getElementById(errId);
        assert.equal(el.textContent, 'Please enter a valid email.');
        assert.equal(el.querySelectorAll('a').length, 0);
        assert.equal(intakeErrors(ctx.w).length, 0);
      } finally { ctx.w.close(); }
    });

    test('OUT_OF_AREA decline is unchanged', async () => {
      const ctx = await loadIntake({ answer: { status: 400, body: { code: 'OUT_OF_AREA', error: "We aren't licensed in Ohio." } } });
      try {
        await run(ctx.w);
        assert.ok(ctx.d.getElementById(errId).classList.contains('hidden'));
        assert.match(ctx.d.body.textContent, /We aren't licensed in Ohio\./);
        assert.equal(intakeErrors(ctx.w).length, 0);
      } finally { ctx.w.close(); }
    });
  });
}
