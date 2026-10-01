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

  test('without a token, the legacy subjects (sage refuses a change request on them as unbound)', () => {
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
    assert.match(html, /If you take no action it publishes on .* as written\./);
    // The old (false) claim: the publisher credits the assigned reviewer on silence.
    assert.doesNotMatch(html, /no reviewer credited|approving by reply/i);
  });

  test('exactly one mailto: Request Changes, carrying the token-bearing reply subject and the label; no "Approved" reply', () => {
    const html = email();
    const mailtos = [...html.matchAll(/href="(mailto:[^"]+)"/g)].map((m) => m[1]);
    assert.equal(mailtos.length, 1);
    assert.ok(mailtos[0].includes(`subject=${encodeURIComponent(buildReviewSubjects(post, VECTOR_TOKEN).reply)}&`));
    assert.ok(mailtos[0].endsWith(`body=${encodeURIComponent('Changes requested:\n\n')}`));
    assert.doesNotMatch(html, /body=Approved/);
    assert.match(html, />Request Changes</);
    assert.match(html, /held until you approve a version in SAGE/);
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
    const noToken = formatReminderEmail(post, { name: 'Test Reviewer' }, { sageUrl: SAGE });
    assert.match(noToken, /the Request Changes link in the original review email/);
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
  test('generate-blog.js skips held slugs (from the shared helper) before its date check', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-blog.js'), 'utf8');
    assert.match(src, /require\('\.\/lib\/calendar-status'\)/);
    assert.match(src, /loadHeldSlugs\(/);
    const held = src.indexOf('heldSlugs.has(meta.slug)');
    const future = src.indexOf('// Skip future-dated posts');
    assert.ok(held > 0 && future > 0 && held < future, 'the hold check must run before (and regardless of) the date check');
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
    assert.match(wf, /SAGE_REVIEW_URL: \$\{\{ secrets\.SAGE_REVIEW_URL \}\}/);
    assert.match(wf, /queue-status\.js --fail-on I4,I2b,I6/);
  });
});
