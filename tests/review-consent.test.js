/**
 * Silence is consent (owner decision 2026-11-25: "no answer is consent to
 * publish with credit to producer").
 *
 * Every review email for a version that reaches the reviewer at least 3 days
 * before its publish date says that no reply publishes it with them credited,
 * and how to stop it, and carries the consent marker SAGE binds the consent to
 * (consent-notice/v1:<token>). SAGE approves on the publish date only from its
 * own record of those emails (sage-server src/services/blog-review-silence.js);
 * a version that first reaches the reviewer later says, truthfully, that it
 * will NOT publish until they approve it. consent_notice on the entry keeps
 * the wording the same for every later email about the same version.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sre = require(path.join(ROOT, 'scripts', 'send-review-emails.js'));

const SECRET = 'test-vector-secret-test-vector-secret';
const SAGE = 'https://sage-test.example.com';
const REV = { name: 'Test Consent Reviewer', slug: 'test-consent-reviewer', email: 'test-consent-reviewer@example.com', license_states: ['KY'] };
const EREV = { name: 'Test Consent Email Reviewer', slug: 'test-consent-email', email: 'test-consent-email@example.com', license_states: ['KY'], review_via: 'email' };
const TEAM = [REV, EREV];
const TODAY = '2026-11-15';
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const words = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');
const md = (slug, extra = '') => `---\ntitle: SYNTHETIC ${slug}\nslug: ${slug}\ndescription: SYNTHETIC description\ndate: 2026-11-18\n---\n\nFirst paragraph for ${slug}.${extra}\n\n${words}\n`;
const assigned = (m) => ({ reviewer: m.name, reviewer_email: m.email, reviewer_slug: m.slug });
const entry = (slug, days, status, extra = {}) => ({ slug, title: `SYNTHETIC ${slug}`, publish_date: addDays(TODAY, days), status, ...extra });

async function run(year1, { today = TODAY, finalOnly = false, files = {}, fail = () => null } = {}) {
  const sent = [];
  const calendar = { year1 };
  const result = await sre.runReviewEmails({
    calendar, team: TEAM, today, sageUrl: SAGE, tokenSecret: SECRET, finalOnly, alertTo: 'test-owner@example.com',
    readPostBytes: (slug) => Buffer.from(files[slug] !== undefined ? files[slug] : md(slug), 'utf8'),
    log: () => {},
    send: async (to, subject, html) => {
      sent.push({ to, subject, html });
      const err = fail(to, subject);
      if (err) throw err;
      return { id: 'stub' };
    },
  });
  return { ...result, sent, calendar };
}
const tokenFor = (post, who, content) => sre.issueReviewToken({ slug: post.slug, reviewerEmail: who.email, publishDate: post.publish_date, content: Buffer.from(content, 'utf8') }, SECRET);

describe('the marker is the contract with SAGE', () => {
  test('consent-notice/v1:<token>', () => {
    assert.equal(sre.CONSENT_NOTICE_TAG, 'consent-notice/v1');
    assert.equal(sre.consentNoticeMarker('20261118.0123456789abcdef.TESTMAC'), 'consent-notice/v1:20261118.0123456789abcdef.TESTMAC');
    assert.equal(sre.CONSENT_LEAD_DAYS, 3);
  });

  test('sage agrees on the marker (when a sage checkout is beside this repo)', (t) => {
    const p = [
      process.env.SAGE_BLOG_SILENCE_PATH,
      path.resolve(ROOT, '..', 'sage-server', 'src', 'services', 'blog-review-silence.js'),
    ].filter(Boolean).find((f) => fs.existsSync(f));
    if (!p) { t.skip('no sage checkout with src/services/blog-review-silence.js: set SAGE_BLOG_SILENCE_PATH'); return; }
    const src = fs.readFileSync(p, 'utf8');
    assert.match(src, /const CONSENT_NOTICE_TAG = 'consent-notice\/v1';/);
    assert.match(src, /const NOTICE_LEAD_DAYS = 3;/);
    assert.match(src, /const POST_REF = \(slug\) => `\[post-ref:\$\{slug\}\]`;/);
    assert.equal(sre.postRefMarker('a-slug'), '[post-ref:a-slug]');
  });
});

describe('which emails say that silence publishes', () => {
  const bytes = (slug) => Buffer.from(md(slug), 'utf8');
  test('a version at least 3 days out: yes; 2 or fewer: no; without the bytes: never', () => {
    assert.equal(sre.consentApplies(entry('a', 14, 'planned'), bytes('a'), TODAY), true);
    assert.equal(sre.consentApplies(entry('a', 3, 'planned'), bytes('a'), TODAY), true);
    assert.equal(sre.consentApplies(entry('a', 2, 'planned'), bytes('a'), TODAY), false);
    assert.equal(sre.consentApplies(entry('a', 14, 'planned'), null, TODAY), false);
  });
  test('a version already sent with the consent wording keeps it to the end; another version or date does not', () => {
    const post = entry('a', 1, 'in-review');
    post.consent_notice = sre.consentKey(post, bytes('a'));
    assert.equal(sre.consentApplies(post, bytes('a'), TODAY), true);
    assert.equal(sre.consentApplies(post, Buffer.from(md('a', ' Edited.'), 'utf8'), TODAY), false, 'edited since');
    assert.equal(sre.consentApplies({ ...post, publish_date: addDays(TODAY, 2) }, bytes('a'), TODAY), false, 're-dated since');
    assert.equal(sre.consentApplies({ ...post, reviewer_email: EREV.email }, bytes('a'), TODAY), false, 'reassigned since: the new reviewer was never told');
  });
});

describe('the emails', () => {
  test('the D-14 request (SAGE lane): the consent sentence, how to stop it, the marker, and consent_notice recorded', async () => {
    const r = await run([entry('test-req', 14, 'planned', assigned(REV))]);
    const [m] = r.sent;
    const post = r.calendar.year1[0];
    assert.match(m.html, /If you do not reply, this article publishes on .* with you credited as its licensed reviewer: no reply counts as your approval\. To stop it, use Request Changes\./);
    assert.match(m.html, /Unless you request changes, this article publishes on .* naming you as its reviewer, whether you approve it in SAGE or do not reply\./);
    assert.ok(m.html.includes(sre.consentNoticeMarker(tokenFor(post, REV, md('test-req')))));
    assert.doesNotMatch(m.html, /will NOT publish|only once you approve it/);
    assert.equal(post.consent_notice, `${post.publish_date}:${REV.email}:${require('crypto').createHash('sha256').update(md('test-req')).digest('hex')}`);
  });

  test('the request (email lane): reply with the changes to stop it; the marker; the header says so', async () => {
    const r = await run([entry('test-ereq', 14, 'planned', assigned(EREV))]);
    const [m] = r.sent;
    assert.match(m.html, /no reply counts as your approval\. To stop it, reply with the changes you want\./);
    assert.match(m.html, /unless you ask for changes<\/p>/);
    assert.ok(m.html.includes(sre.consentNoticeMarker(tokenFor(r.calendar.year1[0], EREV, md('test-ereq')))));
  });

  test('a version edited 2 days out: no consent wording, no marker, no consent_notice for it', async () => {
    const slug = 'test-late-edit';
    const post = entry(slug, 2, 'in-review', { ...assigned(REV), review_sent_date: addDays(TODAY, -12), reminder_sent: true });
    post.consent_notice = sre.consentKey(post, Buffer.from(md(slug), 'utf8')); // the D-14 version
    const edited = md(slug, ' A late synthetic edit.');
    const r = await run([post], { files: { [slug]: edited } });
    const [m] = r.sent;
    assert.match(m.html, /This version reached you less than 3 days before .*, so it will NOT publish until you approve it in SAGE\./);
    assert.doesNotMatch(m.html, /consent-notice\/v1|no reply counts as your approval/);
    assert.equal(r.calendar.year1[0].consent_notice, post.consent_notice, 'still the old version: the new one was never consent-noticed');
  });

  test('a request queued by the kill switch (not delivered) records no consent_notice', async () => {
    const paused = Object.assign(new Error('Email send failed (409): KILL_SWITCH_OUTBOUND_PAUSED'), { status: 409, code: 'KILL_SWITCH_OUTBOUND_PAUSED' });
    const r = await run([entry('test-queued', 14, 'planned', assigned(REV))], { fail: () => paused });
    assert.equal(r.calendar.year1[0].status, 'in-review', 'recorded as sent, as before');
    assert.equal(r.calendar.year1[0].consent_notice, undefined);
  });

  test('a send whose delivery SAGE could not confirm (outcome unknown) records no consent_notice', async () => {
    const sent = [];
    const calendar = { year1: [entry('test-unknown', 14, 'planned', assigned(REV))] };
    await sre.runReviewEmails({
      calendar, team: TEAM, today: TODAY, sageUrl: SAGE, tokenSecret: SECRET, alertTo: 'test-owner@example.com',
      readPostBytes: (slug) => Buffer.from(md(slug), 'utf8'), log: () => {},
      send: async (to, subject, html) => { sent.push(subject); return { ok: true, outcome: 'unknown' }; },
    });
    assert.equal(sent.length, 1);
    assert.equal(calendar.year1[0].status, 'in-review', 'not sent again');
    assert.equal(calendar.year1[0].consent_notice, undefined);
  });

  for (const [kind, days] of [['D-7 reminder', 7], ['D-3 final reminder', 3]]) {
    test(`${kind} (SAGE lane) with the consent wording shows the article text it is consent to`, async () => {
      const slug = 'test-text';
      const r = await run([entry(slug, days, 'in-review', { ...assigned(REV), review_sent_date: addDays(TODAY, -10), ...(days === 3 ? { reminder_sent: true } : {}) })]);
      const [m] = r.sent;
      assert.match(m.html, /no reply counts as your approval/);
      assert.match(m.html, /The article, as it will publish/);
      assert.ok(m.html.includes(`First paragraph for ${slug}.`), 'the text itself');
      assert.doesNotMatch(m.html, /The article changed since an earlier review email/);
    });
  }

  test('a version changed since the consent email (still 3+ days out) says so, in the text it shows', async () => {
    const slug = 'test-changed';
    const post = entry(slug, 7, 'in-review', { ...assigned(REV), review_sent_date: addDays(TODAY, -7) });
    post.consent_notice = sre.consentKey(post, Buffer.from(md(slug), 'utf8'));
    const edited = md(slug, ' Edited synthetic sentence.');
    const r = await run([post], { files: { [slug]: edited } });
    const [m] = r.sent;
    assert.match(m.html, /The article changed since an earlier review email: the text in this email is the version that will publish\./);
    assert.ok(m.html.includes('Edited synthetic sentence.'));
    assert.equal(r.calendar.year1[0].consent_notice, sre.consentKey(post, Buffer.from(edited, 'utf8')), 'the new version is now the one noticed');
  });

  test('a failed send records nothing', async () => {
    const r = await run([entry('test-failed', 14, 'planned', assigned(REV))], { fail: () => Object.assign(new Error('Email send failed (400): bad'), { status: 400 }) });
    assert.equal(r.calendar.year1[0].consent_notice, undefined);
  });
});

describe('every review email names its post; consent emails show the front matter too', () => {
  test('request, D-7 and final reminders in both lanes carry [post-ref:<slug>], consent-worded or not', async () => {
    const r = await run([
      entry('test-ref-req', 14, 'planned', assigned(REV)),
      entry('test-ref-wk', 7, 'in-review', assigned(REV)),
      entry('test-ref-late', 2, 'in-review', assigned(REV)),
      entry('test-ref-email', 1, 'in-review', assigned(EREV)),
    ]);
    assert.equal(r.sent.length, 4);
    for (const m of r.sent) {
      const slug = /\[post-ref:([a-z-]+)\]/.exec(m.html);
      assert.ok(slug, m.subject);
      assert.ok(r.calendar.year1.some((e) => e.slug === slug[1] && m.subject.includes(e.title)), m.subject);
    }
  });
  test('the page details (description and the rest) are shown, without the reviewer lines the publisher writes', async () => {
    const slug = 'test-fm';
    const withReviewer = md(slug).replace('description: SYNTHETIC description\n', 'description: SYNTHETIC description\nreviewer: Somebody Else\n');
    const r = await run([entry(slug, 7, 'in-review', assigned(REV))], { files: { [slug]: withReviewer } });
    const [m] = r.sent;
    assert.match(m.html, /Page details \(published with the article\)/);
    assert.ok(m.html.includes('description: SYNTHETIC description'));
    assert.ok(!m.html.includes('reviewer: Somebody Else'));
  });
});

test('consent_notice is a review-owned field: the queue\'s lost-update guard keeps it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'content-queue.js'), 'utf8');
  const block = /const REVIEW_OWNED_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(src);
  assert.ok(block, 'REVIEW_OWNED_FIELDS found');
  assert.match(block[1], /'consent_notice'/);
});
