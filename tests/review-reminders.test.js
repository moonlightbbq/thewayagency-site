/**
 * Approval required, and silent reviewers get daily emails the 3 days before
 * publishing (owner decision 2026-10-02, Q1), by the channel each reviewer
 * uses (Q3: Sheilia and Jill review by email, with no SAGE account).
 *
 * scripts/send-review-emails.js runReviewEmails is driven with a stub `send`
 * and an injected `today`, so nothing is mailed and no clock is read. The
 * spawned end-to-end runs replace fetch with tests/helpers/stub-fetch.js (no
 * network) and date their fixtures relative to the real clock.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'send-review-emails.js');
const sre = require(SCRIPT);

const SECRET = 'test-vector-secret-test-vector-secret';
const SAGE = 'https://sage-test.example.com';
const OWNER = 'test-content-owner@example.com';
// sage-server src/email/blog-review-guard.js REVIEW_REPLY_PATTERN, pinned: an
// email reviewer's plain "Re:" to the email must parse, or SAGE ignores it.
// (tests/review-reply-binding.test.js runs SAGE's own parser when a sage
// checkout is beside this repo.)
const REVIEW_REPLY_PATTERN = /^\s*(?:(?:re|aw|sv)\s*:\s*)+(?:review request|expedited review)\s*:\s*["“”]([^"“”]{1,200})["“”](?:\s*[-–—]\s*(?:publishes\s+\d{4}-\d{2}-\d{2}|proposed edit|approve in sage|reply not processed|edit not applied))?((?:\s*\[(?:ref|edit):[A-Za-z0-9._-]{8,120}\]){0,2})\s*$/i;

const SAGE_REV = { name: 'Test Sage Reviewer', slug: 'test-sage-reviewer', email: 'test-sage-reviewer@example.com', title: 'Licensed Test Agent', license_states: ['KY'] };
const EMAIL_REV = { name: 'Test Email Reviewer', slug: 'test-email-reviewer', email: 'test-email-reviewer@example.com', title: 'Licensed Test Agent', license_states: ['KY'], review_via: 'email' };
const UNLICENSED = { name: 'Test Unlicensed', slug: 'test-unlicensed', email: '', title: 'Client Care', license_states: [] };
const TEAM = [SAGE_REV, EMAIL_REV, UNLICENSED];

const TODAY = '2026-11-15';
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const words = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');
const md = (slug) => `---\ntitle: SYNTHETIC ${slug}\nslug: ${slug}\ndescription: SYNTHETIC description\ndate: 2026-11-18\n---\n\n## A heading <with> & markup\n\nFirst paragraph for ${slug}: claims are filed within 30 days.\n\n${words}\n`;

const assignedTo = (m) => ({ reviewer: m.name, reviewer_email: m.email, reviewer_slug: m.slug });
const entry = (slug, days, status, extra = {}) => ({ slug, title: `SYNTHETIC ${slug}`, publish_date: addDays(TODAY, days), status, ...extra });

/** Run the passes with a recording stub `send`. */
async function run(year1, { today = TODAY, finalOnly = false, team = TEAM, files = null, fail = () => null } = {}) {
  const sent = [];
  const calendar = { year1 };
  const bytesFor = (slug) => (files ? (files[slug] === undefined ? null : Buffer.from(files[slug], 'utf8')) : Buffer.from(md(slug), 'utf8'));
  const log = [];
  const result = await sre.runReviewEmails({
    calendar, team, today, sageUrl: SAGE, tokenSecret: SECRET, readPostBytes: bytesFor, finalOnly, alertTo: OWNER,
    log: (l) => log.push(l),
    send: async (to, subject, html, opts) => {
      sent.push({ to, subject, html, cc: opts ? opts.cc : undefined });
      const err = fail(to, subject);
      if (err) throw err;
      return { id: 'stub' };
    },
  });
  return { ...result, sent, calendar, log: log.join('\n') };
}
const sageError = (status, code) => Object.assign(new Error(`Email send failed (${status}): ${code}`), { status, code });

describe('D-3, D-2, D-1: a reminder on each day while the post is not approved', () => {
  for (const days of [3, 2, 1]) {
    test(`D-${days}: exactly one final reminder, recorded; a rerun the same day sends none`, async () => {
      const post = entry('test-final', days, 'in-review', { ...assignedTo(SAGE_REV), review_sent_date: addDays(TODAY, -10), reminder_sent: true });
      const first = await run([post]);
      assert.equal(first.sent.length, 1);
      assert.equal(first.sent[0].to, SAGE_REV.email);
      assert.equal(first.sent[0].cc, OWNER, 'the content owner is cc\'d');
      assert.equal(first.counts.finals, 1);
      assert.deepEqual(first.calendar.year1[0].final_reminder_dates, [TODAY]);
      assert.equal(first.calendarChanged, true);
      const again = await run(first.calendar.year1);
      assert.equal(again.sent.length, 0, 'never resent on a rerun the same day');
      assert.equal(again.calendarChanged, false);
      // The daily run and the Wed/Sat run share the record.
      assert.equal((await run(first.calendar.year1, { finalOnly: true })).sent.length, 0);
    });
  }

  test('one each day across the three days, then none on the publish date or after', async () => {
    const year1 = [entry('test-three', 3, 'in-review', { ...assignedTo(SAGE_REV), review_sent_date: addDays(TODAY, -10), reminder_sent: true })];
    let total = 0;
    for (let d = 0; d < 5; d++) {
      const r = await run(year1, { today: addDays(TODAY, d), finalOnly: true });
      total += r.sent.length;
      assert.equal(r.sent.length, d < 3 ? 1 : 0, `day ${d}`);
    }
    assert.equal(total, 3);
    assert.deepEqual(year1[0].final_reminder_dates, [TODAY, addDays(TODAY, 1), addDays(TODAY, 2)]);
  });

  test('not at D-4 or D-0, and not for approved, changes-requested, published or error posts', async () => {
    const r = await run([
      entry('test-d4', 4, 'in-review', assignedTo(SAGE_REV)),
      entry('test-d0', 0, 'in-review', assignedTo(SAGE_REV)),
      entry('test-approved', 2, 'approved', assignedTo(SAGE_REV)),
      // Not silent: SAGE emails them the proposed edit, and I6 makes the held date loud.
      entry('test-held', 2, 'changes-requested', assignedTo(SAGE_REV)),
      entry('test-published', 2, 'published', assignedTo(SAGE_REV)),
      entry('test-error', 2, 'error', assignedTo(SAGE_REV)),
    ]);
    assert.deepEqual(r.sent, []);
    assert.deepEqual(r.failures, []);
  });

  test('the day a (late) request goes out, it is that day\'s email: no reminder on top', async () => {
    const r = await run([entry('test-late', 2, 'in-review', { ...assignedTo(SAGE_REV), review_sent_date: TODAY })]);
    assert.equal(r.sent.length, 0);
  });

  test('the SAGE-channel final reminder: the approval link, "will NOT publish until you approve it", no article text', async () => {
    const r = await run([entry('test-final-sage', 2, 'in-review', assignedTo(SAGE_REV))]);
    const [m] = r.sent;
    assert.ok(m.html.includes(`href="${sre.reviewApprovalUrl(SAGE, 'test-final-sage')}"`));
    assert.match(m.html, /It will NOT publish until you approve it in SAGE\./);
    assert.match(m.html, /Not approved yet &middot; 2 days until publish/);
    assert.match(m.subject, /^Not approved yet: "SYNTHETIC test-final-sage" will not publish on 2026-11-17 until you approve it$/);
    assert.doesNotMatch(m.html, /The full article, exactly as it will publish/);
  });
});

describe('the request (~D-14) and the D-7 reminder stay; the request now reaches the publish date', () => {
  test('a planned post with markdown is requested anywhere from D-18 to D-0 on the Wed/Sat run (was D-10 to D-18)', async () => {
    for (const days of [18, 14, 9, 3, 0]) {
      const r = await run([entry('test-req', days, 'planned')]);
      assert.equal(r.sent.length, 1, `D-${days}`);
      const e = r.calendar.year1[0];
      assert.equal(e.status, 'in-review');
      assert.equal(e.review_sent_date, TODAY);
    }
    for (const days of [19, -1]) assert.equal((await run([entry('test-req', days, 'planned')])).sent.length, 0, `D${days < 0 ? '+1' : `-${days}`}`);
  });

  test('the daily run sends the request only for a post 1-3 days out (and no D-7)', async () => {
    assert.equal((await run([entry('test-req', 2, 'planned')], { finalOnly: true })).sent.length, 1);
    assert.equal((await run([entry('test-req', 10, 'planned')], { finalOnly: true })).sent.length, 0);
    assert.equal((await run([entry('test-req', 0, 'planned')], { finalOnly: true })).sent.length, 0);
    assert.equal((await run([entry('test-wk', 7, 'in-review', assignedTo(SAGE_REV))], { finalOnly: true })).sent.length, 0);
  });

  test('D-7 still goes out once on the Wed/Sat run', async () => {
    const r = await run([entry('test-wk', 7, 'in-review', assignedTo(SAGE_REV))]);
    assert.equal(r.sent.length, 1);
    assert.equal(r.calendar.year1[0].reminder_sent, true);
    assert.match(r.sent[0].html, /It will NOT publish until you approve it in SAGE/);
    assert.equal((await run(r.calendar.year1)).sent.length, 0);
  });

  test('no markdown, no request (as before: I4 reports it)', async () => {
    const r = await run([entry('test-nomd', 5, 'planned')], { files: {} });
    assert.equal(r.sent.length, 0);
    assert.equal(r.calendar.year1[0].status, 'planned');
  });

  test('an entry that already names a licensed reviewer keeps them (no rotation over it)', async () => {
    // Like the 11/18 post assigned to Jill: the rotation would pick the
    // fewest-assigned reviewer instead.
    const r = await run([
      entry('test-kept', 3, 'planned', assignedTo(EMAIL_REV)),
      entry('test-other-a', 30, 'planned', assignedTo(EMAIL_REV)),
      entry('test-other-b', 30, 'planned', assignedTo(EMAIL_REV)),
    ]);
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].to, EMAIL_REV.email);
    assert.equal(r.calendar.year1[0].reviewer_slug, EMAIL_REV.slug);
  });

  test('an unassigned post rotates over the licensed reviewers with a channel, fewest assignments first', async () => {
    const r = await run([entry('test-rot', 14, 'planned'), entry('test-busy', 40, 'planned', assignedTo(SAGE_REV))]);
    assert.equal(r.sent[0].to, EMAIL_REV.email, 'the reviewer with fewer assignments');
  });
});

describe('the email channel (review_via "email") vs the SAGE channel', () => {
  const body = (slug) => md(slug).replace(/^---[\s\S]*?---\n/, '').replace(/^\n+/, '').replace(/\s+$/, '');
  const escaped = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  for (const [kind, days, status, extra] of [
    ['request', 14, 'planned', {}],
    ['D-7 reminder', 7, 'in-review', {}],
    ['D-3 final reminder', 3, 'in-review', { reminder_sent: true }],
    ['D-1 final reminder', 1, 'in-review', { reminder_sent: true }],
  ]) {
    test(`${kind} to an email reviewer: full text, title, date, the token subject and the APPROVED instruction; no SAGE link`, async () => {
      const slug = 'test-email-chan';
      const r = await run([entry(slug, days, status, { ...assignedTo(EMAIL_REV), ...extra })]);
      assert.equal(r.sent.length, 1, r.log);
      const [m] = r.sent;
      const post = r.calendar.year1[0];
      const token = sre.issueReviewToken({ slug, reviewerEmail: EMAIL_REV.email, publishDate: post.publish_date, content: Buffer.from(md(slug), 'utf8') }, SECRET);
      assert.equal(m.subject, sre.buildReviewSubjects(post, token).email, 'the review subject with the token bound to the exact bytes');
      assert.ok(REVIEW_REPLY_PATTERN.test(`Re: ${m.subject}`), 'a plain Reply parses in SAGE');
      assert.equal(REVIEW_REPLY_PATTERN.exec(`RE: ${m.subject}`)[2].trim(), `[ref:${token}]`);
      assert.ok(m.html.includes(escaped(body(slug))), 'the article\'s full text, exactly as it will publish (escaped)');
      assert.match(m.html, /The full article, exactly as it will publish/);
      assert.ok(m.html.includes(`SYNTHETIC ${slug}`));
      assert.ok(m.html.includes(post.publish_date));
      assert.match(m.html, /To approve this exact version: reply to this email with APPROVED as the first line\./);
      assert.match(m.html, /To ask for changes: reply with the changes you want\./);
      assert.match(m.html, /keep the subject line as it is/);
      assert.match(m.html, /It will NOT publish until you approve it/);
      assert.ok(!m.html.includes(SAGE), 'no SAGE link');
      assert.doesNotMatch(m.html, /#\/content\/review|Email replies cannot approve|approve it in SAGE|Review and approve in SAGE/);
      assert.doesNotMatch(m.html, /<h2|## A heading <with>/, 'the markdown is text, never markup');
    });

    test(`${kind} to a SAGE reviewer: the approval link and no full-text block`, async () => {
      const slug = 'test-sage-chan';
      const r = await run([entry(slug, days, status, { ...assignedTo(SAGE_REV), ...extra })]);
      const [m] = r.sent;
      assert.ok(m.html.includes(`href="${sre.reviewApprovalUrl(SAGE, slug)}"`));
      assert.doesNotMatch(m.html, /The full article, exactly as it will publish|APPROVED as the first line/);
      assert.match(m.html, /Email replies cannot approve/);
    });
  }

  test('the email variant needs the token and the bytes: without the file no reminder is sent, and it counts as a failure', async () => {
    assert.throws(() => sre.formatEmailChannelEmail({ title: 't', publish_date: '2026-11-18', slug: 'x' }, 'x', EMAIL_REV, null), /token is required/);
    const r = await run([entry('test-email-nomd', 2, 'in-review', assignedTo(EMAIL_REV))], { files: {} });
    assert.equal(r.sent.length, 0);
    assert.equal(r.failures.length, 1);
    assert.equal(r.calendar.year1[0].final_reminder_dates, undefined);
  });

  test('articleBodyText drops only the front matter', () => {
    assert.equal(sre.articleBodyText('---\ntitle: x\n---\n\nBody <b>one</b>.\n\nTwo.\n'), 'Body <b>one</b>.\n\nTwo.');
  });
});

describe('a reviewer who cannot be reached: the content owner is alerted, nothing is reassigned', () => {
  test('an unknown review_via: alert, failure, the assignment untouched', async () => {
    const odd = { ...SAGE_REV, slug: 'test-odd', email: 'test-odd@example.com', review_via: 'fax' };
    const r = await run([entry('test-odd-post', 2, 'in-review', assignedTo(odd))], { team: [...TEAM, odd] });
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].to, OWNER);
    assert.equal(r.sent[0].cc, null, 'the alert goes to the content owner alone');
    assert.match(r.sent[0].subject, /Blog review cannot reach its reviewer: "SYNTHETIC test-odd-post"/);
    assert.match(r.sent[0].html, /review_via &quot;fax&quot;/);
    assert.match(r.sent[0].html, /Nothing was reassigned/);
    assert.equal(r.failures.length, 1);
    assert.equal(r.calendar.year1[0].reviewer_email, odd.email);
  });

  test('a reviewer who left (not in data/team.json) or lost their licence: alert, no reassignment, not even at the request', async () => {
    const gone = { name: 'Test Gone', slug: 'test-gone', email: 'test-gone@example.com' };
    const r = await run([
      entry('test-gone-final', 1, 'in-review', assignedTo(gone)),
      entry('test-gone-request', 14, 'planned', assignedTo(gone)),
      entry('test-unlicensed', 2, 'in-review', { reviewer: UNLICENSED.name, reviewer_slug: UNLICENSED.slug }),
    ]);
    assert.deepEqual(r.sent.map((m) => m.to), [OWNER, OWNER, OWNER]);
    assert.equal(r.failures.length, 3);
    assert.equal(r.calendar.year1[1].status, 'planned');
    assert.equal(r.calendar.year1[1].reviewer_email, gone.email, 'never reassigned');
  });

  test('SAGE refuses the reviewer (403 RECIPIENT_NOT_INTERNAL): alert, failure, recorded on the entry, retried next run', async () => {
    const fail = (to) => (to === EMAIL_REV.email ? sageError(403, 'RECIPIENT_NOT_INTERNAL') : null);
    const r = await run([entry('test-403', 14, 'planned', assignedTo(EMAIL_REV))], { fail });
    assert.deepEqual(r.sent.map((m) => m.to), [EMAIL_REV.email, OWNER]);
    assert.match(r.sent[1].html, /not an active SAGE user, and SAGE does not \(yet\) allow email to reviewers who review by email/);
    const e = r.calendar.year1[0];
    assert.equal(e.status, 'planned', 'not requested, so it is retried');
    assert.equal(e.reviewer_email, EMAIL_REV.email);
    assert.match(e.review_send_error, /^2026-11-15: Email send failed \(403\)/);
    assert.equal(r.failures.length, 1);
    assert.equal(r.counts.alerts, 1);
    const fin = await run([entry('test-403', 2, 'in-review', assignedTo(EMAIL_REV))], { fail });
    assert.equal(fin.calendar.year1[0].final_reminder_dates, undefined, 'a refused reminder is not recorded');
  });

  test('when the alert cannot be sent either, its full text is in the log and the run fails', async () => {
    const r = await run([entry('test-alert-fail', 2, 'in-review', { reviewer: 'Nobody', reviewer_email: 'test-nobody@example.com' })], { fail: () => sageError(403, 'RECIPIENT_NOT_INTERNAL') });
    assert.equal(r.failures.length, 2);
    assert.match(r.log, /the alert to test-content-owner@example.com could not be sent .*Blog review cannot reach its reviewer: "SYNTHETIC test-alert-fail".*test-nobody@example.com is not a data\/team.json member/);
  });
});

describe('outbound email paused (409 KILL_SWITCH_OUTBOUND_PAUSED): the draft waits in SAGE, so it is recorded and not queued again', () => {
  const paused = () => sageError(409, 'KILL_SWITCH_OUTBOUND_PAUSED');

  test('a final reminder is recorded as sent for today, fails the run, and is not queued again; no alert through the paused endpoint', async () => {
    const r = await run([entry('test-paused', 2, 'in-review', assignedTo(SAGE_REV))], { fail: paused });
    assert.equal(r.sent.length, 1);
    assert.deepEqual(r.calendar.year1[0].final_reminder_dates, [TODAY]);
    assert.equal(r.counts.queued, 1);
    assert.equal(r.counts.finals, 0);
    assert.equal(r.failures.length, 1, 'the run goes red');
    assert.match(r.log, /QUEUED in SAGE, not sent: outbound email is paused/);
    assert.equal((await run(r.calendar.year1, { fail: paused })).sent.length, 0, 'not queued a second time');
  });

  test('a request is recorded too: in-review, review_sent_date today', async () => {
    const r = await run([entry('test-paused-req', 14, 'planned')], { fail: paused });
    assert.equal(r.calendar.year1[0].status, 'in-review');
    assert.equal(r.calendar.year1[0].review_sent_date, TODAY);
    assert.equal(r.failures.length, 1);
  });
});

describe('the live team: the four licensed reviewers, two of them by email', () => {
  const team = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'team.json'), 'utf8')).team;

  test('the rotation is exactly Sheilia, Audrey, Kelly and Jill; Allison (no email, no licence) is not a reviewer', () => {
    assert.deepEqual(sre.rotationReviewers(team).map((m) => m.slug), ['sheilia-royal', 'audrey-lillpop', 'kelly-mccallister', 'jill-boone']);
    assert.equal(sre.reviewChannel(team.find((m) => m.slug === 'allison-sommers')), null);
  });

  test('review_via is "email" for Sheilia and Jill only (owner decision Q3); Audrey and Kelly review in SAGE', () => {
    const channels = Object.fromEntries(team.map((m) => [m.slug, sre.reviewChannel(m)]));
    assert.deepEqual(channels, { 'sheilia-royal': 'email', 'audrey-lillpop': 'sage', 'kelly-mccallister': 'sage', 'jill-boone': 'email' });
    assert.deepEqual(team.filter((m) => m.review_via !== undefined).map((m) => [m.slug, m.review_via]), [['sheilia-royal', 'email'], ['jill-boone', 'email']]);
  });

  test('the post assigned to Jill keeps her: her entry is a valid email-channel assignment', () => {
    const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-calendar.json'), 'utf8'));
    for (const e of cal.year1.filter((p) => p.reviewer_slug === 'jill-boone' && p.status !== 'published')) {
      const a = sre.assignedReviewer(e, team);
      assert.equal(a.channel, 'email', e.slug);
    }
  });
});

describe('the CLI, end to end, with fetch stubbed (no network, no email)', () => {
  const today = new Date().toISOString().slice(0, 10);
  function tree(year1) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-reminders-'));
    for (const d of ['scripts', 'data', 'src/blog']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(tmp, 'scripts', 'send-review-emails.js'));
    fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team: TEAM }));
    fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ year1 }, null, 2));
    for (const e of year1) fs.writeFileSync(path.join(tmp, 'src', 'blog', `${e.slug}.md`), md(e.slug));
    const log = path.join(tmp, 'fetch.jsonl');
    const go = (args = [], mode = 'ok') => {
      const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'helpers', 'stub-fetch.js'), path.join(tmp, 'scripts', 'send-review-emails.js'), ...args], {
        encoding: 'utf8',
        env: {
          ...process.env, SAGE_API_URL: 'https://sage-test.invalid', SAGE_REVIEW_URL: SAGE, SAGE_API_TOKEN: 'synthetic-token', SAGE_CLIENT_ID: 'synthetic-client',
          BLOG_REVIEW_TOKEN_SECRET: SECRET, REVIEW_CC: OWNER, STUB_FETCH_LOG: log, STUB_FETCH_MODE: mode, STUB_FETCH_OK_TO: OWNER, GITHUB_OUTPUT: '',
        },
        timeout: 30000,
      });
      const posts = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
      fs.rmSync(log, { force: true });
      return { r, posts, calendar: JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'content-calendar.json'), 'utf8')) };
    };
    return { tmp, go, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  }
  const at = (days) => addDays(today, days);

  test('--final-reminders sends only the D-3..D-1 pass, records it, and a second run that day posts nothing', () => {
    const t = tree([
      { slug: 'test-cli-final', title: 'SYNTHETIC final', publish_date: at(2), status: 'in-review', ...assignedTo(EMAIL_REV), review_sent_date: at(-12), reminder_sent: true },
      { slug: 'test-cli-week', title: 'SYNTHETIC week', publish_date: at(7), status: 'in-review', ...assignedTo(SAGE_REV) },
      { slug: 'test-cli-planned', title: 'SYNTHETIC planned', publish_date: at(14), status: 'planned' },
    ]);
    try {
      const first = t.go(['--final-reminders']);
      assert.equal(first.r.status, 0, first.r.stdout + first.r.stderr);
      assert.equal(first.posts.length, 1, first.r.stdout);
      assert.equal(first.posts[0].url, 'https://sage-test.invalid/api/email-drafts');
      assert.equal(first.posts[0].body.to, EMAIL_REV.email);
      assert.equal(first.posts[0].body.cc, OWNER);
      assert.equal(first.posts[0].body.send, true);
      assert.match(first.posts[0].body.subject, /^Review Request: "SYNTHETIC final" — publishes \d{4}-\d{2}-\d{2} \[ref:/);
      assert.deepEqual(first.calendar.year1[0].final_reminder_dates, [today]);
      assert.equal(first.calendar.year1[1].reminder_sent, undefined, 'no D-7 on the daily run');
      assert.equal(first.calendar.year1[2].status, 'planned', 'no D-14 request on the daily run');
      const second = t.go(['--final-reminders']);
      assert.equal(second.r.status, 0);
      assert.equal(second.posts.length, 0, 'idempotent across reruns the same day');
    } finally {
      t.done();
    }
  });

  test('SAGE refusing the reviewer: an alert to the content owner, exit 2, nothing recorded as sent', () => {
    const t = tree([{ slug: 'test-cli-403', title: 'SYNTHETIC refused', publish_date: at(1), status: 'in-review', ...assignedTo(EMAIL_REV) }]);
    try {
      const { r, posts, calendar } = t.go(['--final-reminders'], '403-review');
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.deepEqual(posts.map((p) => p.body.to), [EMAIL_REV.email, OWNER]);
      assert.equal(posts[1].body.cc, undefined, 'the alert has no cc');
      assert.equal(calendar.year1[0].final_reminder_dates, undefined);
      assert.match(r.stderr, /problem\(s\)/);
    } finally {
      t.done();
    }
  });

  test('outbound paused: exit 2, recorded, and not queued again on a rerun', () => {
    const t = tree([{ slug: 'test-cli-409', title: 'SYNTHETIC paused', publish_date: at(3), status: 'in-review', ...assignedTo(SAGE_REV) }]);
    try {
      const first = t.go(['--final-reminders'], '409');
      assert.equal(first.r.status, 2);
      assert.equal(first.posts.length, 1);
      assert.deepEqual(first.calendar.year1[0].final_reminder_dates, [today]);
      const second = t.go(['--final-reminders'], '409');
      assert.equal(second.posts.length, 0);
    } finally {
      t.done();
    }
  });
});

describe('the daily workflow (.github/workflows/review-reminders.yml)', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'review-reminders.yml'), 'utf8');
  const pub = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
  const line = (src, re) => (src.match(re) || [])[0];

  test('runs daily, and runs ONLY the reminder pass', () => {
    assert.match(wf, /- cron: '0 13 \* \* \*'/);
    assert.match(wf, /workflow_dispatch:/);
    assert.match(wf, /run: node scripts\/send-review-emails\.js --final-reminders\n/);
    assert.doesNotMatch(wf, /publish-scheduled-posts|update-reviews|queue-status|reconcile-calendar|fill-slots/);
  });

  test('copies publish-blog.yml\'s runner, permissions, Node and secrets, and pushes through git-push-rebase.sh', () => {
    assert.equal(line(wf, /runs-on: .*/), line(pub, /runs-on: .*/));
    assert.equal(line(wf, /permissions:\n\s+contents: write/), line(pub, /permissions:\n\s+contents: write/));
    assert.equal(line(wf, /node-version: .*/), line(pub, /node-version: .*/));
    assert.equal(/concurrency:/.test(wf), /concurrency:/.test(pub));
    for (const secret of ['SAGE_API_URL', 'SAGE_REVIEW_URL', 'SAGE_API_TOKEN', 'SAGE_CLIENT_ID', 'BLOG_REVIEW_TOKEN_SECRET']) {
      assert.match(wf, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`), secret);
    }
    assert.match(wf, /git add data\/content-calendar\.json\n/);
    assert.match(wf, /git diff --cached --quiet && exit 0/);
    assert.match(wf, /bash scripts\/git-push-rebase\.sh main/);
    assert.doesNotMatch(wf, /git push(?! -)/, 'never a plain push');
  });

  test('a failed send still commits what was sent, and fails the run last', () => {
    const remind = wf.slice(wf.indexOf('- name: Send final review reminders'), wf.indexOf('- name: Commit and push'));
    assert.match(remind, /continue-on-error: true/);
    assert.match(wf, /if: \$\{\{ !cancelled\(\) \}\}/);
    const last = wf.slice(wf.indexOf('- name: Fail the run if review reminders failed'));
    assert.match(last, /steps\.remind\.outcome == 'failure'/);
    assert.match(last, /exit 1/);
  });
});
