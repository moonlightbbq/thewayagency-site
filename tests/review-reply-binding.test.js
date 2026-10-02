/**
 * BL-07 — the approval link, the review-request token, and the reviewer hold.
 *
 * Approving is a click in SAGE: the review email's primary action is a link to
 * SAGE's review page for the post, where the reviewer sees the exact text that
 * will publish. No email reply approves (an old email's "Approved" reply gets
 * SAGE's answer with the link and changes nothing), so the email has no
 * "Approve" mailto.
 *
 * sage-server acts on a reviewer's emailed CHANGE REQUEST only when its subject
 * carries a token this repo's scripts/send-review-emails.js signed for that
 * post, that reviewer and the exact article bytes the reviewer was sent. Both
 * repositories pin the SAME fixed test vector below (sage-server
 * tests/blog-review-edit-gating.test.js and tests/blog-review-trigger-binding.test.js):
 * if either side changes the algorithm alone, its own CI goes red instead of
 * every change request being refused in production.
 *
 * A change request puts the post on the 'changes-requested' hold; this file
 * also pins that the blog generator skips held posts and that the queue makes a
 * held post loud (I6) once its date arrives.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'send-review-emails.js');
const {
  issueReviewToken, buildReviewSubjects, formatReviewEmail, formatReminderEmail, reviewTokenSecret, sageReviewBase, reviewApprovalUrl,
} = require(SCRIPT);
const SAGE = 'https://sage-test.example.com';
const q = require('../scripts/lib/content-queue');

const SECRET = 'test-vector-secret-test-vector-secret';
const VECTOR_BYTES = Buffer.from('---\ntitle: "Café Test Vector"\nslug: test-vector-post\n---\n\nBody with é and — dash.\n', 'utf8');
const VECTOR = { slug: 'test-vector-post', reviewerEmail: 'Test.Reviewer@Example.com', publishDate: '2099-12-31', content: VECTOR_BYTES };
const VECTOR_TOKEN = '20991231.c0841c3afd9ee10b.B052nW4erF6M4Z3xZk-Q_S';

// SAGE's signature on an approval (sage-server src/email/blog-review-guard.js
// signApproval, written to the calendar entry as approval_mac). The site
// verifies it before it publishes or renders a "Reviewed by" credit; sage-server
// tests/blog-review-approval-endpoint.test.js pins the SAME vector.
const APPROVAL_VECTOR = {
  slug: 'test-vector-post', reviewer_slug: 'test-reviewer', reviewer_email: 'Test.Reviewer@Example.com',
  approved_by_email: 'test.reviewer@example.com', approved_sha256: 'c0841c3afd9ee10b379e19209d951848bb5791c973f7ee7295525ab69d2704a0',
  approved_date: '2099-12-30', approved_publish_date: '2099-12-31',
};
// v2 (BL-07 fix round 3): the date the post was approved for is signed too.
const APPROVAL_VECTOR_MAC = 'EPUWxWuHILz7Ij6xqWF2y-5Z5XwKmwj69L1S6bWxblM';
const APPROVAL_VECTOR_EDIT_ID = '00000000-0000-4000-8000-000000000001';
const APPROVAL_VECTOR_MAC_EDIT = 'V2wUEcagIbhRYC-Ld3n-9sbbAiNs-A58re6vwJnK-h4';

describe('the approval signature (approval_mac)', () => {
  const rc = require('../scripts/lib/review-credit');
  test('matches the fixed cross-repo test vector, for a current-text approval and a proposal approval', () => {
    assert.equal(APPROVAL_VECTOR.approved_sha256, rc.sha256Hex(VECTOR_BYTES));
    assert.equal(rc.signApproval(APPROVAL_VECTOR, SECRET), APPROVAL_VECTOR_MAC);
    assert.equal(rc.signApproval({ ...APPROVAL_VECTOR, approved_edit_id: APPROVAL_VECTOR_EDIT_ID }, SECRET), APPROVAL_VECTOR_MAC_EDIT);
    assert.ok(rc.approvalSigned({ ...APPROVAL_VECTOR, approval_mac: APPROVAL_VECTOR_MAC }, SECRET));
  });

  test('every signed field matters, and an ambiguous field cannot be signed', () => {
    const signed = { ...APPROVAL_VECTOR, approval_mac: APPROVAL_VECTOR_MAC };
    for (const [k, v] of Object.entries({
      slug: 'test-vector-other', reviewer_slug: 'test-reviewer-2', reviewer_email: 'test.other@example.com', approved_by_email: 'test.other@example.com',
      approved_sha256: '0'.repeat(64), approved_date: '2099-12-31', approved_publish_date: '2099-12-30', approved_edit_id: APPROVAL_VECTOR_EDIT_ID,
    })) assert.ok(!rc.approvalSigned({ ...signed, [k]: v }, SECRET), k);
    assert.ok(!rc.approvalSigned({ ...signed, approved_publish_date: undefined }, SECRET), 'v1-shaped (no approved_publish_date)');
    assert.ok(!rc.approvalSigned(signed, `${SECRET}x`));
    assert.throws(() => rc.signApproval({ ...APPROVAL_VECTOR, approved_by_email: 'a|b@example.com' }, SECRET), /line break|"\|"/);
    assert.throws(() => rc.signApproval(APPROVAL_VECTOR, 'short'), /32/);
  });
});

describe('the review-request token', () => {
  test('matches the fixed cross-repo test vector', () => {
    assert.equal(issueReviewToken(VECTOR, SECRET), VECTOR_TOKEN);
  });

  test('is deterministic, case-insensitive on the address, and changes with every bound input', () => {
    assert.equal(issueReviewToken(VECTOR, SECRET), issueReviewToken({ ...VECTOR, reviewerEmail: 'test.reviewer@example.com' }, SECRET));
    const variants = [
      { ...VECTOR, slug: 'test-vector-other' },
      { ...VECTOR, reviewerEmail: 'test.someone-else@example.com' },
      { ...VECTOR, publishDate: '2099-12-30' },
      { ...VECTOR, content: Buffer.concat([VECTOR_BYTES, Buffer.from(' ')]) },
    ];
    for (const v of variants) assert.notEqual(issueReviewToken(v, SECRET), VECTOR_TOKEN);
    assert.notEqual(issueReviewToken(VECTOR, `${SECRET}x`), VECTOR_TOKEN);
  });

  test('refuses a short secret and incomplete input', () => {
    assert.throws(() => issueReviewToken(VECTOR, 'short'), /at least 32/);
    assert.throws(() => issueReviewToken({ ...VECTOR, content: 'not bytes' }, SECRET), /Buffer/);
    assert.throws(() => issueReviewToken({ ...VECTOR, publishDate: 'soon' }, SECRET), /YYYY-MM-DD/);
    assert.equal(reviewTokenSecret({}), null);
    assert.equal(reviewTokenSecret({ BLOG_REVIEW_TOKEN_SECRET: 'short' }), null);
    assert.equal(reviewTokenSecret({ BLOG_REVIEW_TOKEN_SECRET: SECRET }), SECRET);
  });
});

describe('subjects and links', () => {
  const post = { title: 'Synthetic Review Post 0001', publish_date: '2099-12-31', slug: 'test-synthetic-post-0001', pillar: 'education' };

  test('with a token, the email and the reply subjects carry it', () => {
    const s = buildReviewSubjects(post, VECTOR_TOKEN);
    assert.equal(s.email, `Review Request: "${post.title}" — publishes 2099-12-31 [ref:${VECTOR_TOKEN}]`);
    assert.equal(s.reply, `Re: Review Request: "${post.title}" [ref:${VECTOR_TOKEN}]`);
  });

  test('without a token, the legacy subjects (sage holds the post on a change request to them, but makes no AI edit)', () => {
    const s = buildReviewSubjects(post, null);
    assert.equal(s.email, `Review Request: "${post.title}" — publishes 2099-12-31`);
    assert.equal(s.reply, `Re: Review Request: "${post.title}"`);
  });

  test('backward compatible: the pre-BL-07 sage pattern still extracts the exact title', () => {
    const LEGACY = /re:\s*(review request|expedited review)[:\s]*["""](.+?)["""]/i;
    for (const subject of [`RE: ${buildReviewSubjects(post, VECTOR_TOKEN).email}`, buildReviewSubjects(post, VECTOR_TOKEN).reply]) {
      assert.equal(LEGACY.exec(subject)[2], post.title);
    }
  });

  const email = () => formatReviewEmail(post, '---\ntitle: x\n---\n\nSynthetic body.\n', { name: 'Test Reviewer' }, VECTOR_TOKEN, { sageUrl: SAGE });

  test('the primary action is "Review and approve in SAGE": an https link to SAGE\'s review page for the post', () => {
    const html = email();
    const url = reviewApprovalUrl(SAGE, post.slug);
    assert.equal(url, `${SAGE}/#/content/review?post=${post.slug}`);
    assert.ok(html.includes(`href="${url}"`), 'the approval link');
    assert.match(html, />Review and approve in SAGE</);
    assert.match(html, /Approving is a click in SAGE, where you see the exact text that will publish\. Email replies cannot approve\./);
    // Silence HOLDS the post (owner decision 2026-10-02), and the email says so.
    assert.match(html, /It will NOT publish until you approve it in SAGE\. Until you do, you get a reminder on each of the 3 days before .*; if it is still not approved on .*, it does not publish that day and the content owner is told\./);
    assert.match(html, /This article publishes on .* only once you approve it in SAGE, and then names you as its reviewer\./);
    assert.doesNotMatch(html, /without a reviewer named|If you take no action it publishes/);
    assert.doesNotMatch(html, /as written\.|approving by reply/i);
  });

  test('exactly one mailto: Request Changes, carrying the token-bearing reply subject and the label; no "Approved" reply', () => {
    const html = email();
    const mailtos = [...html.matchAll(/href="(mailto:[^"]+)"/g)].map((m) => m[1]);
    assert.equal(mailtos.length, 1);
    assert.ok(mailtos[0].includes(`subject=${encodeURIComponent(buildReviewSubjects(post, VECTOR_TOKEN).reply)}&`));
    assert.ok(mailtos[0].endsWith(`body=${encodeURIComponent('Changes requested:\n\n')}`));
    assert.doesNotMatch(html, /body=Approved/);
    assert.match(html, />Request Changes</);
    assert.match(html, /SAGE holds the post and emails you a proposed edit to approve in SAGE\./);
    assert.match(html, /SAGE holds the post and emails you the proposed edit as a list of changes/);
    // SAGE's cut-off: from the publish date a reply no longer holds the post.
    assert.match(html, /A change request has to reach SAGE before the publish date begins \(midnight UTC/);
    assert.match(html, /keep the subject line as it is/);
  });

  test('without a token the email promises no AI edit: the post is held and the edit is made by hand', () => {
    const html = formatReviewEmail(post, '---\ntitle: x\n---\n\nSynthetic body.\n', { name: 'Test Reviewer' }, null, { sageUrl: SAGE });
    assert.match(html, /SAGE holds the post; the content owner makes the edit by hand\./);
    assert.match(html, /This email carries no review code, so SAGE cannot prepare the edit itself/);
    assert.doesNotMatch(html, /emails you a proposed edit|emails you the proposed edit/);
    assert.doesNotMatch(html, /keep the subject line as it is/);
    assert.match(html, /A change request has to reach SAGE before the publish date begins/);
    assert.match(html, /It will NOT publish until you approve it in SAGE/);
  });

  test('the email cannot be built without the SAGE address, and only an https one', () => {
    assert.throws(() => formatReviewEmail(post, 'x', { name: 'Test Reviewer' }, VECTOR_TOKEN), /sageUrl is required/);
    assert.throws(() => reviewApprovalUrl('http://sage-test.example.com', post.slug), /https/);
    assert.throws(() => reviewApprovalUrl(SAGE, ''), /slug/);
  });

  test('the SAGE address: SAGE_REVIEW_URL, else SAGE_API_URL, as an https origin (a trailing "/" or "/api" dropped)', () => {
    assert.equal(sageReviewBase({ SAGE_API_URL: 'https://sage-test.example.com' }), SAGE);
    assert.equal(sageReviewBase({ SAGE_API_URL: 'https://sage-test.example.com/api/' }), SAGE);
    assert.equal(sageReviewBase({ SAGE_REVIEW_URL: 'https://review-test.example.com/', SAGE_API_URL: 'https://api-test.example.com' }), 'https://review-test.example.com');
    for (const bad of [{}, { SAGE_API_URL: 'http://sage-test.example.com' }, { SAGE_API_URL: 'https://sage-test.example.com/some/path' }, { SAGE_REVIEW_URL: 'javascript:alert(1)' }]) {
      assert.throws(() => sageReviewBase(bad), /https origin/, JSON.stringify(bad));
    }
  });

  test('the reminder carries the same approval link, a token-bearing Request Changes link, and no "No action needed to approve"', () => {
    const html = formatReminderEmail(post, { name: 'Test Reviewer' }, { sageUrl: SAGE, token: VECTOR_TOKEN });
    assert.ok(html.includes(`href="${reviewApprovalUrl(SAGE, post.slug)}"`));
    assert.match(html, /Email replies cannot approve/);
    assert.ok(html.includes(encodeURIComponent(buildReviewSubjects(post, VECTOR_TOKEN).reply)));
    assert.doesNotMatch(html, /No action needed to approve/);
    assert.match(html, /It will NOT publish until you approve it in SAGE/);
    assert.doesNotMatch(html, /without a reviewer named/);
    assert.match(html, /A change request has to reach SAGE before the publish date begins/);
    assert.match(html, /emails you the proposed edit/);
    const noToken = formatReminderEmail(post, { name: 'Test Reviewer' }, { sageUrl: SAGE });
    assert.match(noToken, /the Request Changes link in the original review email/);
    assert.match(noToken, /the content owner makes it by hand/);
    assert.throws(() => formatReminderEmail(post, { name: 'Test Reviewer' }, {}), /sageUrl is required/);
  });

  test('sage parses and verifies what this script sends (when a sage checkout is beside this repo)', (t) => {
    // sage-server src/email/blog-review-guard.js (the email and approval-MAC
    // guard, NOT src/services/blog-content-guard.js). SAGE_REVIEW_GUARD_PATH
    // names it (SAGE_GUARD_PATH, the old name, still works); otherwise a sage
    // checkout beside this repo, as calendar-status-contract.test.js finds it.
    // It is pure (it requires only crypto), so loading it has no side effects.
    const named = process.env.SAGE_REVIEW_GUARD_PATH || process.env.SAGE_GUARD_PATH || '';
    const guardPath = named || [
      path.resolve(ROOT, '..', 'sage-main', 'src', 'email', 'blog-review-guard.js'),
      path.resolve(ROOT, '..', 'sage-server', 'src', 'email', 'blog-review-guard.js'),
    ].find((p) => fs.existsSync(p));
    if (!guardPath) { t.skip('no sage checkout beside this repo: set SAGE_REVIEW_GUARD_PATH to sage-server src/email/blog-review-guard.js'); return; }
    assert.ok(fs.existsSync(guardPath), `SAGE_REVIEW_GUARD_PATH ${guardPath} does not exist`);
    const guard = require(guardPath);
    const missing = ['sha256Hex', 'parseReviewSubject', 'verifyRequestToken', 'approvalMacMessage', 'signApproval'].filter((f) => typeof guard[f] !== 'function');
    if (missing.length && !named) { t.skip(`the sage checkout at ${guardPath} predates BL-07 (no ${missing.join(', ')})`); return; }
    assert.deepEqual(missing, [], `${guardPath} is not sage-server src/email/blog-review-guard.js (it has no ${missing.join(', ')}): point SAGE_REVIEW_GUARD_PATH at that file`);
    const contentSha256 = guard.sha256Hex(VECTOR_BYTES);
    for (const subject of [`RE: ${buildReviewSubjects(post, VECTOR_TOKEN).email}`, buildReviewSubjects(post, VECTOR_TOKEN).reply]) {
      const parsed = guard.parseReviewSubject(subject);
      assert.equal(parsed.title, post.title);
      assert.equal(parsed.refToken, VECTOR_TOKEN);
    }
    assert.deepEqual(
      guard.verifyRequestToken({ token: VECTOR_TOKEN, slug: VECTOR.slug, senderEmail: 'test.reviewer@example.com', contentSha256, secret: SECRET, today: '2026-10-01' }),
      { ok: true, expires: '2099-12-31' },
    );
    // ...and SAGE's approval signature is the one this repo verifies.
    if (typeof guard.signApproval === 'function') {
      const rc = require('../scripts/lib/review-credit');
      for (const fields of [APPROVAL_VECTOR, { ...APPROVAL_VECTOR, approved_edit_id: APPROVAL_VECTOR_EDIT_ID }]) {
        assert.equal(guard.signApproval(fields, SECRET), rc.signApproval(fields, SECRET));
      }
    }
  });
});

describe('loading the script', () => {
  test('require() has no side effects: no exit, no send, no file read', () => {
    const env = { ...process.env };
    delete env.SAGE_API_URL;
    delete env.SAGE_API_TOKEN;
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCRIPT)}); console.log('loaded')`], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'loaded');
  });

  test('a missing or short BLOG_REVIEW_TOKEN_SECRET exits 2 before anything is sent', () => {
    for (const secret of [undefined, 'too-short-for-a-review-secret']) {
      const env = {
        ...process.env,
        // Synthetic settings on an unroutable host: the check runs before any send.
        SAGE_API_URL: 'https://sage-test.invalid', SAGE_API_TOKEN: 'synthetic-token', SAGE_CLIENT_ID: 'synthetic-client',
        SAGE_REVIEW_URL: 'https://sage-test.invalid',
      };
      if (secret === undefined) delete env.BLOG_REVIEW_TOKEN_SECRET; else env.BLOG_REVIEW_TOKEN_SECRET = secret;
      const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env, timeout: 20000 });
      assert.equal(run.status, 2, run.stdout + run.stderr);
      assert.match(run.stderr, /BLOG_REVIEW_TOKEN_SECRET is not set \(or shorter than 32 characters\)/);
      assert.match(run.stderr, /No review email was sent/);
      assert.doesNotMatch(run.stdout, /Review sent|Failed to send|review\(s\) sent/);
    }
  });

  test('running it without the API settings still exits 1', () => {
    const env = { ...process.env };
    delete env.SAGE_API_URL;
    delete env.SAGE_API_TOKEN;
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /SAGE_API_URL and SAGE_API_TOKEN are required/);
  });
});

describe('a held post never renders, and is loud when its date arrives', () => {
  test('generate-blog.js decides every post with the shared renderDecision before its date check', () => {
    // Behaviour is pinned end to end in tests/render-review-gate.test.js; this
    // pins the wiring: the decision (holds included) runs before, and
    // regardless of, the file's own date.
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-blog.js'), 'utf8');
    assert.match(src, /require\('\.\/lib\/calendar-status'\)/);
    assert.match(src, /require\('\.\/lib\/review-credit'\)/);
    const decided = src.indexOf('renderDecision(entry, rawBytes');
    const future = src.indexOf('// Skip future-dated posts');
    assert.ok(decided > 0 && future > 0 && decided < future, 'the decision must run before (and regardless of) the date check');
    const rc = require('../scripts/lib/review-credit');
    const cs = require('../scripts/lib/calendar-status');
    const d = rc.renderDecision({ slug: 'test-held-x', status: 'changes-requested', publish_date: '2000-01-01' }, Buffer.from('---\ntitle: t\n---\n'), [],
      { today: '2099-01-01', isKnownStatus: cs.isKnownStatus, isPublishable: cs.isPublishable, isHeld: cs.isHeld });
    assert.equal(d.render, false);
  });

  test('I6 fires for a held post at or past its date, and not before', () => {
    const cal = (date) => ({ slots: [], year1: [{ slug: 'test-held-a', status: 'changes-requested', publish_date: date }] });
    const ids = (date, today) => q.evaluateInvariants(cal(date), { candidates: [] }, today, { hasMarkdown: () => true }).violations.map(v => v.id);
    assert.ok(ids('2099-06-03', '2099-06-03').includes('I6'));
    assert.ok(ids('2099-06-03', '2099-06-10').includes('I6'));
    assert.ok(!ids('2099-06-10', '2099-06-03').includes('I6'));
    const inReview = { slots: [], year1: [{ slug: 'test-review-b', status: 'in-review', publish_date: '2099-06-03' }] };
    assert.ok(!q.evaluateInvariants(inReview, { candidates: [] }, '2099-06-03', { hasMarkdown: () => true }).violations.some(v => v.id === 'I6'));
  });

  test('the publish workflow passes the secret and fails on I6 and I8', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    assert.match(wf, /BLOG_REVIEW_TOKEN_SECRET: \$\{\{ secrets\.BLOG_REVIEW_TOKEN_SECRET \}\}/);
    // The publish step needs it too: it verifies SAGE's approval_mac and signs the credit record.
    const publishStep = wf.slice(wf.indexOf('- name: Publish scheduled posts'), wf.indexOf('- name: Commit and push'));
    assert.match(publishStep, /BLOG_REVIEW_TOKEN_SECRET: \$\{\{ secrets\.BLOG_REVIEW_TOKEN_SECRET \}\}/);
    assert.match(wf, /SAGE_REVIEW_URL: \$\{\{ secrets\.SAGE_REVIEW_URL \}\}/);
    assert.match(wf, /queue-status\.js --fail-on I4,I2b,I6,I7,I8,I9\n/, 'I8 (due without licensed approval) turns the publish run red');
    assert.match(wf, /REQUIRED: unset \(or under 32 characters\), this step exits 2/);
  });

  test('I7 fires for any entry the publisher put in error, so a refused approval is never silent', () => {
    const ids = (status) => q.evaluateInvariants({ slots: [], year1: [{ slug: 'test-err-a', status, publish_date: '2099-06-03', error_reason: 'approved_bytes_changed' }] },
      { candidates: [] }, '2099-06-03', { hasMarkdown: () => true }).violations;
    const i7 = ids('error').filter(v => v.id === 'I7');
    assert.equal(i7.length, 1);
    assert.match(i7[0].message, /approved_bytes_changed/);
    for (const status of ['approved', 'in-review', 'published', 'changes-requested']) assert.ok(!ids(status).some(v => v.id === 'I7'), status);
    // A status neither repo knows does not publish or render either.
    const unknown = ids('awaiting-legal').filter(v => v.id === 'I7');
    assert.equal(unknown.length, 1);
    assert.match(unknown[0].message, /unrecognised status "awaiting-legal"/);
  });

  test('a failed review step (a send, or the secret missing) does not stop the publish, and still fails the run (fix round 5)', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    const review = wf.slice(wf.indexOf('- name: Send review emails'), wf.indexOf('- name: Update Google reviews'));
    assert.match(review, /\n\s+continue-on-error: true\n/);
    const publish = wf.slice(wf.indexOf('- name: Publish scheduled posts'), wf.indexOf('- name: Commit and push'));
    assert.doesNotMatch(publish, /\bif:/, 'the publish step runs after a failed review step');
    const last = wf.slice(wf.indexOf('- name: Fail the run if review emails failed'));
    assert.ok(wf.indexOf('- name: Fail the run if review emails failed') > wf.indexOf('- name: Queue health'), 'it runs last');
    assert.match(last, /if: \$\{\{ !cancelled\(\) && steps\.review\.outcome == 'failure' \}\}/);
    assert.match(last, /exit 1/);
  });

  test('the workflow commits whatever changed (not only when a step reported output), and never after a failed publish', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    const commit = wf.slice(wf.indexOf('- name: Commit and push'), wf.indexOf('- name: Queue health'));
    assert.match(commit, /if: \$\{\{ !cancelled\(\) && steps\.publish\.outcome != 'failure' \}\}/);
    assert.doesNotMatch(commit, /outputs\.(published|reviews_sent|reviews_updated)/);
    assert.match(commit, /git diff --cached --quiet && exit 0/);
    const publish = wf.slice(wf.indexOf('- name: Publish scheduled posts'), wf.indexOf('- name: Commit and push'));
    // 0 and 3 (an entry in error, its changes written) keep the step green so they are committed; anything else fails it.
    assert.match(publish, /case "\$code" in\s+0\) ;;\s+3\)[^\n]*;;\s+\*\) exit "\$code" ;;/);
  });
});

// ─── Fix round 4: calendar and article values are data in these emails ─────
//
// The review and reminder emails go to a licensed reviewer. A title, pillar,
// reading time, reviewer name or article paragraph used to be interpolated
// into their HTML as is, so a hostile title could add markup (or a link of its
// own) to an email asking a licensed agent to approve a post, and a markdown
// link "[x](@host/y)" was prefixed into https://www.thewayagency.com@host/y,
// a link to another host.
describe('review emails encode every calendar and article value (fix round 4)', () => {
  const hostile = { slug: 'test-hostile-email', title: 'T <img src=x onerror=alert(1)>', pillar: '<script>x</script>', publish_date: '2099-12-31', reading_time: '6 min<i>' };
  const reviewer = { name: '<b>Eve</b> Test' };
  const md = '---\ntitle: x\n---\n\nA <b>bold</b> claim & [the site](/personal/home.html?a=1&b=2) [elsewhere](https://example.com/x) [trick](@evil.example/approve).\n';

  test('the review email', () => {
    const html = formatReviewEmail(hostile, md, reviewer, VECTOR_TOKEN, { sageUrl: SAGE });
    assert.doesNotMatch(html, /<img|<script|<b>|<i>/);
    assert.match(html, /T &lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /Hi &lt;b&gt;Eve&lt;\/b&gt;,/);
    assert.match(html, /A &lt;b&gt;bold&lt;\/b&gt; claim &amp; /);
    assert.ok(html.includes('href="https://www.thewayagency.com/personal/home.html?a=1&amp;b=2"'));
    assert.ok(html.includes('href="https://example.com/x"'));
    assert.doesNotMatch(html, /@evil\.example/, 'no link to another host through the site prefix');
  });

  test('the reminder email', () => {
    const html = formatReminderEmail(hostile, reviewer, { sageUrl: SAGE, token: VECTOR_TOKEN });
    assert.doesNotMatch(html, /<img|<script|<b>/);
    assert.match(html, /T &lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  });
});
