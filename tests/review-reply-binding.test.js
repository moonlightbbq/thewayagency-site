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

const SECRET = 'TEST-vector-secret-0123456789abcdef0123';
const VECTOR_BYTES = Buffer.from('---\ntitle: "Café Test Vector"\nslug: test-vector-post\n---\n\nBody with é and — dash.\n', 'utf8');
const VECTOR = { slug: 'test-vector-post', reviewerEmail: 'Test.Reviewer@Example.com', publishDate: '2099-12-31', content: VECTOR_BYTES };
const VECTOR_TOKEN = '20991231.c0841c3afd9ee10b.N8Q5Xb55k2ygrr3vfLRBrg';

// SAGE's signature on an approval (sage-server src/email/blog-review-guard.js
// signApproval, written to the calendar entry as approval_mac). The site
// verifies it before it publishes or renders a "Reviewed by" credit; sage-server
// tests/blog-review-approval-endpoint.test.js pins the SAME vector.
const APPROVAL_VECTOR = {
  slug: 'test-vector-post', reviewer_slug: 'test-reviewer', reviewer_email: 'Test.Reviewer@Example.com',
  approved_by_email: 'test.reviewer@example.com', approved_sha256: 'c0841c3afd9ee10b379e19209d951848bb5791c973f7ee7295525ab69d2704a0',
  approved_date: '2099-12-30',
};
const APPROVAL_VECTOR_MAC = 'OPiVjkk1WmIDoCWMPHO6Oe3_C9kg71Qnt3nfZTVteh0';
const APPROVAL_VECTOR_EDIT_ID = '00000000-0000-4000-8000-000000000001';
const APPROVAL_VECTOR_MAC_EDIT = '-lnwGHiGnkVuLF17teMjrA2qtb4c74vih_4sKC2oec8';

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
      approved_sha256: '0'.repeat(64), approved_date: '2099-12-31', approved_edit_id: APPROVAL_VECTOR_EDIT_ID,
    })) assert.ok(!rc.approvalSigned({ ...signed, [k]: v }, SECRET), k);
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
    // Silence publishes with no reviewer named (scripts/lib/review-credit.js),
    // and the email says so: the credit is the reason to approve.
    assert.match(html, /If you take no action it publishes on .* without a reviewer named: only an approval in SAGE puts your name on it\./);
    assert.match(html, /It names you as reviewer only if you approve it in SAGE\./);
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
    assert.match(html, /without a reviewer named/);
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
    assert.match(html, /without a reviewer named: only an approval in SAGE puts your name on it/);
    assert.match(html, /A change request has to reach SAGE before the publish date begins/);
    assert.match(html, /emails you the proposed edit/);
    const noToken = formatReminderEmail(post, { name: 'Test Reviewer' }, { sageUrl: SAGE });
    assert.match(noToken, /the Request Changes link in the original review email/);
    assert.match(noToken, /the content owner makes it by hand/);
    assert.throws(() => formatReminderEmail(post, { name: 'Test Reviewer' }, {}), /sageUrl is required/);
  });

  test('sage parses and verifies what this script sends (when a sage checkout is beside this repo)', (t) => {
    // Same resolution as calendar-status-contract.test.js. blog-review-guard.js
    // is pure (it requires only crypto), so loading it has no side effects.
    const guardPath = process.env.SAGE_GUARD_PATH || path.resolve(ROOT, '..', 'sage-main', 'src', 'email', 'blog-review-guard.js');
    if (!fs.existsSync(guardPath)) { t.skip('sage is not checked out beside this repo'); return; }
    const guard = require(guardPath);
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

  test('the publish workflow passes the secret and fails on I6', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    assert.match(wf, /BLOG_REVIEW_TOKEN_SECRET: \$\{\{ secrets\.BLOG_REVIEW_TOKEN_SECRET \}\}/);
    // The publish step needs it too: it verifies SAGE's approval_mac and signs the credit record.
    const publishStep = wf.slice(wf.indexOf('- name: Publish scheduled posts'), wf.indexOf('- name: Commit and push'));
    assert.match(publishStep, /BLOG_REVIEW_TOKEN_SECRET: \$\{\{ secrets\.BLOG_REVIEW_TOKEN_SECRET \}\}/);
    assert.match(wf, /SAGE_REVIEW_URL: \$\{\{ secrets\.SAGE_REVIEW_URL \}\}/);
    assert.match(wf, /queue-status\.js --fail-on I4,I2b,I6,I7/);
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
