/**
 * The "Reviewed by" byline is stamped only for an approval in SAGE whose bytes
 * are still the ones published (sage-server BL-07, scripts/lib/review-credit.js).
 *
 * The licensed review is REQUIRED for publishing (scripts/lib/calendar-
 * status.js, owner decision 2026-10-02): a due post whose reviewer never
 * approved it is HELD (unchanged, not an error; the queue's I8 makes it loud).
 * Only the frozen advisory exceptions (ADVISORY_GRANDFATHERED, exact slug and
 * date) still publish on silence, naming no reviewer, with any review line
 * they carry removed. An 'approved' post credits its reviewer only while the
 * sha256 of the file's raw bytes equals approved_sha256, the approval is the
 * byline reviewer's, and SAGE signed it (approval_mac, an HMAC with
 * BLOG_REVIEW_TOKEN_SECRET: typed calendar fields prove nothing); anything else
 * does not publish at all ('error'). A credited publish records credited_sha256
 * and credit_mac, which the renderer checks (tests/render-review-gate.test.js).
 *
 * Runs the real scripts against a temp copy of the site tree with synthetic
 * data, so nothing in this repo is touched.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const {
  approvalCheck, applyReviewCredit, stripReviewerFields, personNameKey, signApproval, approvalMacMessage, creditCheck, sha256Hex,
  frontMatterKey, isReviewerKey,
} = require('../scripts/lib/review-credit');

// A synthetic test secret (the real one lives only in the sage .env and the
// repository's Actions secrets).
const SECRET = 'test-vector-secret-test-vector-secret';

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');
// The synthetic team's first name is "Test": a title or description that put
// it beside a credit word ("test-approved-review") is flagged like a real name
// would be (blog-content-guard.js reviewWordingWarnings), so the slug goes in
// without its prefix and only the fixtures meant to be flagged are.
const named = (slug) => slug.replace(/^test-/, '');
const post = (slug, extra = '') => `---\ntitle: SYNTHETIC ${named(slug)}\ndescription: SYNTHETIC description for ${named(slug)}\ndate: 2026-01-07\n${extra}---\n\n${body}\n`;
const REVIEWER = { name: 'Test Reviewer B', slug: 'test-reviewer-b', email: 'test-reviewer-b@example.com', title: 'Licensed Test Agent' };
const TEAM = [{ name: REVIEWER.name, slug: REVIEWER.slug, email: REVIEWER.email, title: REVIEWER.title, license_states: ['KY'] }];
const REVIEW_KEYS = ['reviewer', 'reviewer_slug', 'reviewer_title', 'reviewed_date', 'reviewed_by'];

/**
 * A calendar entry the assigned reviewer approved in SAGE, for these bytes,
 * signed the way SAGE signs it. `patch` applies after signing (so it can break
 * the signature); `signed` patches before signing (so the signature covers it).
 */
function approved(slug, md, patch = {}, signed = {}) {
  const entry = {
    slug, title: `SYNTHETIC ${slug}`, publish_date: '2026-01-07', status: 'approved',
    reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, review_sent_date: '2025-12-20',
    approved_by: REVIEWER.name, approved_by_email: REVIEWER.email, approved_date: '2025-12-23', approved_sha256: sha(md),
    approved_publish_date: '2026-01-07',
    ...signed,
  };
  entry.approval_mac = approvalMacMessage(entry) ? signApproval(entry, SECRET) : undefined;
  return { ...entry, ...patch };
}

/** A temp site tree; runs `script` once and returns the result. */
function runSite(script, { entries, files, team = TEAM, args = [], env = { BLOG_REVIEW_TOKEN_SECRET: SECRET } }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-review-stamp-'));
  fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'blog'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts', script), path.join(tmp, 'scripts', script));
  for (const lib of ['calendar-status.js', 'review-credit.js', 'blog-content-guard.js']) {
    fs.copyFileSync(path.join(REPO, 'scripts', 'lib', lib), path.join(tmp, 'scripts', 'lib', lib));
  }
  fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team }));
  fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ year1: entries }, null, 2));
  for (const [slug, md] of Object.entries(files)) fs.writeFileSync(path.join(tmp, 'src', 'blog', `${slug}.md`), md);
  const childEnv = { ...process.env, ...env };
  if (!('BLOG_REVIEW_TOKEN_SECRET' in env)) delete childEnv.BLOG_REVIEW_TOKEN_SECRET;
  const run = spawnSync(process.execPath, [path.join(tmp, 'scripts', script), ...args], { encoding: 'utf8', env: childEnv });
  const calendar = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'content-calendar.json'), 'utf8'));
  const read = (slug) => fs.readFileSync(path.join(tmp, 'src', 'blog', `${slug}.md`), 'utf8');
  return { tmp, run, calendar, read, entry: (slug) => calendar.year1.find((p) => p.slug === slug) };
}

describe('publish-scheduled-posts: silence HOLDS, a matching approval publishes', () => {
  let site;
  const silentMd = post('test-silent-review');
  // A post published on silence that somehow carries a review line (an AI
  // edit, a hand edit): the line is removed, never published.
  // Including spellings the renderer reads as review keys too: a leading space
  // and another case (generate-blog.js trims keys).
  const smuggledMd = post('test-smuggled-review', `reviewer: ${REVIEWER.name}\n reviewer_slug: ${REVIEWER.slug}\nReviewer_Title: Licensed Agent\n\treviewed_date : 2025-12-01\n`);
  const approvedMd = post('test-approved-review');

  before(() => {
    site = runSite('publish-scheduled-posts.js', {
      entries: [
        { slug: 'test-silent-review', title: 'SYNTHETIC silent', publish_date: '2026-01-07', status: 'in-review', reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, review_sent_date: '2025-12-20' },
        // approved_by on an entry that is not 'approved' (e.g. reverted to
        // in-review by a stale writer) still credits nobody.
        { slug: 'test-smuggled-review', title: 'SYNTHETIC smuggled', publish_date: '2026-01-07', status: 'in-review', reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, approved_by: REVIEWER.name, approved_by_email: REVIEWER.email },
        approved('test-approved-review', approvedMd),
      ],
      files: { 'test-silent-review': silentMd, 'test-smuggled-review': smuggledMd, 'test-approved-review': approvedMd },
    });
  });
  after(() => { fs.rmSync(site.tmp, { recursive: true, force: true }); });

  test('only the approved one publishes; the two the reviewer never approved are HELD, unchanged, exit 0 (owner decision 2026-10-02)', () => {
    assert.equal(site.run.status, 0, site.run.stdout + site.run.stderr);
    assert.deepEqual(site.calendar.year1.map((p) => p.status), ['in-review', 'in-review', 'published']);
    for (const slug of ['test-silent-review', 'test-smuggled-review']) {
      assert.equal(site.entry(slug).error_reason, undefined, `${slug}: a hold is not an error`);
      assert.match(site.run.stdout, new RegExp(`HELD \\(no licensed approval\\): .*\\(${slug}\\) due 2026-01-07, status in-review, reviewer ${REVIEWER.name} <${REVIEWER.email}>`));
    }
    assert.match(site.run.stdout, /2 due post\(s\) HELD/);
    assert.match(site.run.stdout, /publishes on the next run, while it is still scheduled for that date/);
  });

  test('a held entry keeps no stray approval record (a withdrawn one included)', () => {
    for (const slug of ['test-silent-review', 'test-smuggled-review']) {
      for (const k of ['approved_by', 'approved_by_email', 'approved_sha256', 'approval_mac']) assert.equal(site.entry(slug)[k], undefined, `${slug}: ${k}`);
    }
  });

  test('a held post is not touched: its file keeps its bytes, and no review byline or credit is stamped', () => {
    assert.equal(site.read('test-silent-review'), silentMd);
    assert.equal(site.read('test-smuggled-review'), smuggledMd, 'held, so not rewritten (it neither publishes nor renders)');
    for (const slug of ['test-silent-review', 'test-smuggled-review']) {
      assert.equal(site.entry(slug).credited_sha256, undefined);
      assert.equal(site.entry(slug).credit_mac, undefined);
    }
    assert.doesNotMatch(site.run.stdout, /Published: "SYNTHETIC (silent|smuggled)"/);
  });

  test('an approval in SAGE whose bytes match credits the reviewer with their real title and the approval date', () => {
    const meta = frontmatter(site.read('test-approved-review'));
    assert.equal(meta.reviewer, REVIEWER.name);
    assert.equal(meta.reviewer_slug, REVIEWER.slug);
    assert.equal(meta.reviewer_title, REVIEWER.title);
    assert.equal(meta.reviewed_date, '2025-12-23');
  });

  test('the credited publish records credited_sha256 of the exact bytes committed, and a credit_mac', () => {
    const e = site.entry('test-approved-review');
    assert.equal(e.credited_sha256, sha256Hex(fs.readFileSync(path.join(site.tmp, 'src', 'blog', 'test-approved-review.md'))));
    assert.match(e.credit_mac, /^[A-Za-z0-9_-]{43}$/);
    const bytes = fs.readFileSync(path.join(site.tmp, 'src', 'blog', 'test-approved-review.md'));
    assert.deepEqual(creditCheck(e, bytes, { secret: SECRET, team: TEAM }), { credit: true, reason: 'credited' });
    // Fix round 5: the credit is re-checked against data/team.json at render.
    // A reviewer who left, or lost their licences, is credited no longer.
    const gone = { credit: false, reason: 'the credited reviewer is no longer a licensed data/team.json member' };
    assert.deepEqual(creditCheck(e, bytes, { secret: SECRET, team: [] }), gone);
    assert.deepEqual(creditCheck(e, bytes, { secret: SECRET, team: [{ ...TEAM[0], license_states: [] }] }), gone);
    assert.deepEqual(creditCheck(e, bytes, { secret: SECRET }), gone, 'no team list, no credit');
    // Fix round 1 after the scope decision, as approvalCheck: a slug handed to
    // someone else in data/team.json (another address or name) credits no one,
    // so an old credit never links to the slug's new holder.
    const reassigned = { credit: false, reason: 'the reviewer_slug member in data/team.json is no longer the credited reviewer (another address or name)' };
    assert.deepEqual(creditCheck(e, bytes, { secret: SECRET, team: [{ ...TEAM[0], email: 'test-other-staff@example.com' }] }), reassigned);
    assert.deepEqual(creditCheck(e, bytes, { secret: SECRET, team: [{ ...TEAM[0], name: 'Test Someone Else' }] }), reassigned);
    assert.deepEqual(creditCheck(e, bytes, { secret: SECRET, team: [{ ...TEAM[0], email: REVIEWER.email.toUpperCase(), name: ` ${REVIEWER.name.toLowerCase()} ` }] }),
      { credit: true, reason: 'credited' }, 'case and spacing do not matter (as approvalCheck)');
  });
});

describe('publish-scheduled-posts: an approval that no longer matches does not publish', () => {
  const md = post('test-bound');
  const cases = [
    ['the file changed after the click', approved('test-bound', md), `${md}\nAn AI-added paragraph the reviewer never saw.\n`, 'approved_bytes_changed'],
    ['no approved_sha256 recorded', approved('test-bound', md, { approved_sha256: undefined }), md, 'approval_hash_missing'],
    ['a malformed approved_sha256', approved('test-bound', md, { approved_sha256: 'abc123' }), md, 'approval_hash_missing'],
    ['the approver is not the assigned reviewer', approved('test-bound', md, { approved_by_email: 'test-other-staff@example.com' }), md, 'approval_not_by_assigned_reviewer'],
    ['team.json re-pointed the byline member\'s address', approved('test-bound', md), md, 'approval_reviewer_not_byline', [{ ...TEAM[0], email: 'test-other-staff@example.com' }]],
    ['the byline member is not licensed', approved('test-bound', md), md, 'approval_reviewer_not_byline', [{ ...TEAM[0], license_states: [] }]],
    ['the calendar byline names someone else', approved('test-bound', md, { reviewer: 'Test Someone Else' }), md, 'approval_reviewer_not_byline'],
    // Typed by hand on the calendar (an admin or a merged PR): every field
    // agrees with team.json and the file's hash, but SAGE never signed it.
    ['a hand-typed approval with no approval_mac', approved('test-bound', md, { approval_mac: undefined }), md, 'approval_unsigned'],
    ['an approval_mac made with another secret', approved('test-bound', md, { approval_mac: signApproval(approved('test-bound', md), `${SECRET}-other`) }), md, 'approval_unsigned'],
    ['a signed approval whose date was edited afterwards', approved('test-bound', md, { approved_date: '2025-12-24' }), md, 'approval_unsigned'],
    ['a signed approval moved to another slug', approved('test-bound', md, {}, {}), md, 'approval_unsigned', undefined, (e) => ({ ...e, approval_mac: approved('test-other-slug', md).approval_mac })],
    // Round 3: the approval is for a date. Rescheduled after the click (or a
    // withdrawn approval copied onto the post's new date), it does not publish.
    ['the post was rescheduled after the click', approved('test-bound', md, { publish_date: '2026-01-06' }), md, 'approval_rescheduled'],
    ['a signed approval whose approved_publish_date was edited to match', approved('test-bound', md, { publish_date: '2026-01-06', approved_publish_date: '2026-01-06' }), md, 'approval_unsigned'],
  ];
  for (const [label, entry0, file, reason, team, tamper] of cases) {
    test(label, () => {
      const entry = tamper ? tamper(entry0) : entry0;
      const site = runSite('publish-scheduled-posts.js', { entries: [entry], files: { 'test-bound': file }, team });
      try {
        assert.equal(site.run.status, 3, site.run.stdout);
        const e = site.entry('test-bound');
        assert.equal(e.status, 'error');
        assert.equal(e.error_reason, reason);
        assert.ok(e.error_at);
        // The approval evidence is kept, and nothing was written to the post.
        assert.equal(e.approved_by, REVIEWER.name);
        assert.equal(site.read('test-bound'), file);
        for (const k of REVIEW_KEYS) assert.equal(frontmatter(site.read('test-bound'))[k], undefined);
        assert.match(site.run.stdout, new RegExp(reason));
        assert.equal(e.credited_sha256, undefined);
      } finally {
        fs.rmSync(site.tmp, { recursive: true, force: true });
      }
    });
  }

  test('with no secret to verify SAGE\'s signature, an approved post is left alone (exit 2), not published and not errored', () => {
    const site = runSite('publish-scheduled-posts.js', {
      entries: [approved('test-bound', md), { slug: 'test-silent-ok', title: 'SYNTHETIC silent', publish_date: '2026-01-07', status: 'planned' }],
      files: { 'test-bound': md, 'test-silent-ok': post('test-silent-ok') },
      env: {},
    });
    try {
      assert.equal(site.run.status, 2, site.run.stdout);
      assert.equal(site.entry('test-bound').status, 'approved');
      assert.equal(site.read('test-bound'), md);
      // An unapproved post is held either way.
      assert.equal(site.entry('test-silent-ok').status, 'planned');
      assert.match(site.run.stdout, /BLOG_REVIEW_TOKEN_SECRET/);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });

  test('an entry in error and a clean publish in one run: both are written, exit 3', () => {
    const okMd = post('test-ok', 'reviewer: Someone\n');
    const site = runSite('publish-scheduled-posts.js', {
      entries: [approved('test-bound', md), approved('test-ok', okMd)],
      files: { 'test-bound': `${md}\nChanged.\n`, 'test-ok': okMd },
    });
    try {
      assert.equal(site.run.status, 3, site.run.stdout);
      assert.equal(site.entry('test-bound').status, 'error');
      assert.equal(site.entry('test-ok').status, 'published');
      assert.equal(frontmatter(site.read('test-ok')).reviewer, REVIEWER.name, 'the typed review line is replaced by the approval\'s');
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });

  test('the hash is of the raw bytes before the publisher rewrites date:, so a future date: still matches', () => {
    const future = post('test-future').replace('date: 2026-01-07', 'date: 2099-01-01');
    const site = runSite('publish-scheduled-posts.js', { entries: [approved('test-future', future)], files: { 'test-future': future } });
    try {
      assert.equal(site.run.status, 0, site.run.stdout);
      const meta = frontmatter(site.read('test-future'));
      assert.equal(meta.date, '2026-01-07');
      assert.equal(meta.reviewer, REVIEWER.name);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });
});

describe('a withdrawn approval does not stay on the calendar (fix round 3)', () => {
  test('the publisher removes the approval record from any entry that is not approved, published or in error', () => {
    const md = post('test-w-due');
    const signedRecord = (slug, file) => {
      const a = approved(slug, file);
      const out = {};
      for (const k of ['approved_by', 'approved_by_email', 'approved_date', 'approved_sha256', 'approved_publish_date', 'approval_mac']) out[k] = a[k];
      return out;
    };
    const site = runSite('publish-scheduled-posts.js', {
      entries: [
        // Withdrawn: set back to in-review with SAGE's signed record left on it.
        { slug: 'test-w-due', title: 'SYNTHETIC w', publish_date: '2026-01-07', status: 'in-review', reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, ...signedRecord('test-w-due', md) },
        { slug: 'test-w-future', title: 'SYNTHETIC w', publish_date: '2099-01-07', status: 'in-review', reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, ...signedRecord('test-w-future', md) },
        { slug: 'test-w-held', title: 'SYNTHETIC w', publish_date: '2099-01-07', status: 'changes-requested', reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, ...signedRecord('test-w-held', md) },
        // Kept: a live approval (not due yet) and the evidence on an error entry.
        { ...approved('test-w-approved', md), publish_date: '2099-01-07' },
        { ...approved('test-w-error', md), status: 'error', error_reason: 'approved_bytes_changed' },
      ],
      files: { 'test-w-due': md },
    });
    try {
      assert.equal(site.run.status, 0, site.run.stdout);
      // Withdrawn and due: held (it no longer has an approval), not published.
      assert.equal(site.entry('test-w-due').status, 'in-review');
      assert.equal(site.read('test-w-due'), md);
      for (const slug of ['test-w-due', 'test-w-future', 'test-w-held']) {
        for (const k of ['approved_by', 'approved_by_email', 'approved_date', 'approved_sha256', 'approved_publish_date', 'approval_mac']) assert.equal(site.entry(slug)[k], undefined, `${slug}: ${k}`);
      }
      assert.equal(site.entry('test-w-future').status, 'in-review');
      assert.equal(site.entry('test-w-held').status, 'changes-requested');
      assert.ok(site.entry('test-w-approved').approval_mac, 'a live approval is untouched');
      assert.ok(site.entry('test-w-error').approval_mac, 'the evidence on an error entry is kept');
      assert.match(site.run.stdout, /test-w-future: removed the approval record/);
      assert.match(site.run.stdout, /HELD \(no licensed approval\): .*\(test-w-due\)/);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });
});

describe('front matter that breaks a deterministic rule does not publish (fix rounds 3 and 4)', () => {
  for (const [label, extra] of [
    ['markup in a value', 'author_title: Licensed Agent</span><span>Reviewed by Test Reviewer B</span>\n'],
    ['an unsafe author_slug', 'author_slug: x", "reviewedBy": {"name": "Test Reviewer B"}, "q": "\n'],
    // Fix round 4 (the review's hostile fixtures): the round-3 /review/i
    // denylist passed every one of these, and each printed a credit in the
    // byline. Since fix round 1 after the scope decision only the invisible
    // and bidi ones refuse; the look-alike, full-width and reading_time ones
    // publish, flagged (below).
    ['a soft hyphen in author_title', 'author_title: Licensed Agent | Re\u00ADviewed by Test Reviewer B on December 1, 2025\n'],
    ['a zero-width space in author_title', 'author_title: Client Care Specialist | Re\u200Bviewed by Test Reviewer B on December 1, 2025\n'],
    ['a bidi override in the title', 'title: SYNTHETIC \u202Eyb deweiveR\n'],
    ['a line separator in the description', 'description: SYNTHETIC\u2028Reviewed by Test Reviewer B\n'],
  ]) {
    test(label, () => {
      const file = post('test-unsafe', extra);
      // Approved (signed, for these bytes): the readiness check refuses it anyway.
      const site = runSite('publish-scheduled-posts.js', {
        entries: [approved('test-unsafe', file)],
        files: { 'test-unsafe': file },
      });
      try {
        assert.equal(site.run.status, 3, site.run.stdout);
        assert.equal(site.entry('test-unsafe').status, 'error');
        assert.equal(site.entry('test-unsafe').error_reason, 'unsafe_frontmatter');
        assert.equal(site.read('test-unsafe'), file, 'nothing written');
      } finally {
        fs.rmSync(site.tmp, { recursive: true, force: true });
      }
    });
  }
});

describe('review-credit wording in a front-matter value is flagged, never refused (the scope decision after fix round 5)', () => {
  // Free text can always claim a review; each tighter rule took legitimate
  // posts down. An approved post publishes as written, crediting its reviewer
  // with the approval's review lines only (the wording adds none), and the
  // publisher logs the wording.
  for (const [label, extra] of [
    ['review wording in a byline field', 'author_title: Licensed Agent | Reviewed by Test Reviewer B on December 1, 2025\n'],
    ['a synonym ("Approved by")', 'author_title: Approved by Test Reviewer B, Licensed Agent on December 1, 2025\n'],
    ['an author_title that is not the member\'s, with wording', `author_slug: ${REVIEWER.slug}\nauthor: ${REVIEWER.name}\nauthor_title: Licensed Agent | Reviewed by ${REVIEWER.name}\n`],
    ['a credit in the title', `title: SYNTHETIC guide \u2014 Reviewed by ${REVIEWER.name}, Licensed Agent\n`],
    ['a credit in the CTA banner', `cta_title: Reviewed by ${REVIEWER.name}, Licensed Agent\n`],
    ['a credit in the CTA text', 'cta_text: Fact-checked by our licensed agents.\n'],
    ['a credit in the image alt text', `image_alt: Approved by ${REVIEWER.name}\n`],
    ['a credit in the category', `category: Verified by ${REVIEWER.name}\n`],
    // Refused as characters until fix round 1 after the scope decision: an
    // arrow in a live title and "reading_time: 7 minutes" took posts down.
    ['a Cyrillic look-alike in reading_time', 'reading_time: R\u0435viewed by Test Reviewer B, Licensed Test Agent on December 1, 2025 | 6 min read\n'],
    ['full-width letters', 'author_title: \uFF32\uFF45\uFF56\uFF49\uFF45\uFF57\uFF45\uFF44 by Test Reviewer B, Licensed Agent\n'],
    ['a reading_time that is not "N min read", with wording', 'reading_time: 6 min read | Vetted by our licensed agents\n'],
  ]) {
    test(label, () => {
      const file = post('test-worded', extra);
      const site = runSite('publish-scheduled-posts.js', {
        entries: [approved('test-worded', file)],
        files: { 'test-worded': file },
      });
      try {
        assert.equal(site.run.status, 0, site.run.stdout);
        const e = site.entry('test-worded');
        assert.equal(e.status, 'published');
        assert.ok(e.credit_mac, 'credited by the signed approval, not by the wording');
        const meta = frontmatter(site.read('test-worded'));
        assert.equal(meta.reviewer, REVIEWER.name);
        assert.equal(meta.reviewer_title, REVIEWER.title, 'the review lines are the approval\'s');
        assert.match(site.run.stdout, /! test-worded: review-credit wording in the front-matter "[a-z_]+": .*only the signed byline is a verified credit/);
      } finally {
        fs.rmSync(site.tmp, { recursive: true, force: true });
      }
    });
  }
});

describe('printable characters and reading_time never stop a post publishing (fix round 1 after the scope decision)', () => {
  // The character allowlist refused an arrow or an emoji, and the
  // reading_time rule refused "7 minutes": each took a live post down with
  // the build still green. The renderer encodes every value and prints the
  // computed reading time for a value that is not "N min" or "N min read".
  for (const [label, extra] of [
    ['an arrow and emoji in the title', 'title: SYNTHETIC term life vs. whole life \u2192 \u26A0\uFE0F \uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\n'],
    ['"reading_time: 7 minutes"', 'reading_time: 7 minutes\n'],
    ['another script and comparison signs in the description', 'description: SYNTHETIC \u65E5\u672C\u8A9E \u2264 $500 \u2713\n'],
  ]) {
    test(label, () => {
      const file = post('test-printable', extra);
      const site = runSite('publish-scheduled-posts.js', {
        entries: [approved('test-printable', file)],
        files: { 'test-printable': file },
      });
      try {
        assert.equal(site.run.status, 0, site.run.stdout);
        const e = site.entry('test-printable');
        assert.equal(e.status, 'published', site.run.stdout);
        assert.equal(e.error_reason, undefined);
        assert.doesNotMatch(site.run.stdout, /review-credit wording/);
      } finally {
        fs.rmSync(site.tmp, { recursive: true, force: true });
      }
    });
  }
});

describe('who the byline names never stops a post publishing (fix round 5)', () => {
  // Round 4 refused these, so an offboarding or a new title in data/team.json
  // took live posts off the site. author and author_title are never printed:
  // the byline is the member author_slug names, as team.json gives them, or
  // the agency (blog-content-guard.js bylineAuthor). A BL-06 promote in SAGE
  // still refuses them for new text (bylineProblem).
  for (const [label, extra] of [
    ['an author who is not the author_slug member', `author_slug: ${REVIEWER.slug}\nauthor: Someone Else\n`],
    ['an author_title that is not the member\'s', `author_slug: ${REVIEWER.slug}\nauthor: ${REVIEWER.name}\nauthor_title: Client Care Specialist\n`],
    ['an author_slug that names no team member', 'author_slug: test-nobody\n'],
  ]) {
    test(label, () => {
      const file = post('test-byline-stale', extra);
      const site = runSite('publish-scheduled-posts.js', {
        entries: [approved('test-byline-stale', file)],
        files: { 'test-byline-stale': file },
      });
      try {
        assert.equal(site.run.status, 0, site.run.stdout);
        assert.equal(site.entry('test-byline-stale').status, 'published');
      } finally {
        fs.rmSync(site.tmp, { recursive: true, force: true });
      }
    });
  }
});

describe('a review credit in the article body is flagged, never refused (fix round 4 fixtures, the scope decision after round 5)', () => {
  for (const [label, sentence] of [
    ['a first paragraph that reads as a byline', `Reviewed by [${REVIEWER.name}](/about/team.html#${REVIEWER.slug}), Licensed Test Agent on December 1, 2025`],
    ['an approval naming the agency', 'This guide was approved by The Way Agency.'],
    ['emphasis inside the word', `Re**view**ed by ${REVIEWER.name}.`],
    ['a look-alike letter', 'Th\u0456s article was r\u0435viewed by our licensed agents.'],
  ]) {
    test(label, () => {
      const file = post('test-body-claim').replace('---\n\n', `---\n\n${sentence}\n\n`);
      const site = runSite('publish-scheduled-posts.js', {
        entries: [approved('test-body-claim', file)],
        files: { 'test-body-claim': file },
      });
      try {
        assert.equal(site.run.status, 0, site.run.stdout);
        assert.equal(site.entry('test-body-claim').status, 'published');
        assert.match(site.run.stdout, /! test-body-claim: review-credit wording in the body: .*only the signed byline is a verified credit/);
        assert.equal(frontmatter(site.read('test-body-claim')).reviewer, REVIEWER.name, 'the only review lines are the approval\'s');
      } finally {
        fs.rmSync(site.tmp, { recursive: true, force: true });
      }
    });
  }

  test('contrast: advice that mentions a review publishes, with no warning', () => {
    const file = post('test-body-advice').replace('---\n\n', '---\n\nHave your policy reviewed by a licensed agent every year. Medicare Advantage plans are approved by Medicare.\n\n');
    const site = runSite('publish-scheduled-posts.js', {
      entries: [approved('test-body-advice', file)],
      files: { 'test-body-advice': file },
    });
    try {
      assert.equal(site.entry('test-body-advice').status, 'published', site.run.stdout);
      assert.doesNotMatch(site.run.stdout, /review-credit wording/);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });
});

describe('reconcile-calendar applies the same rule', () => {
  test('--apply: a changed approved post goes to error; silence is HELD and left alone; a matching approval is credited', () => {
    const good = post('test-rc-good');
    const silent = post('test-rc-silent', `reviewer: ${REVIEWER.name}\nreviewed_date: 2025-12-01\n`);
    const site = runSite('reconcile-calendar.js', {
      args: ['--apply'],
      entries: [
        approved('test-rc-changed', post('test-rc-changed')),
        { slug: 'test-rc-silent', title: 'SYNTHETIC silent', publish_date: '2026-01-07', status: 'in-review', reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email },
        approved('test-rc-good', good),
      ],
      files: { 'test-rc-changed': `${post('test-rc-changed')}\nChanged.\n`, 'test-rc-silent': silent, 'test-rc-good': good },
    });
    try {
      assert.equal(site.run.status, 1, site.run.stdout);
      assert.equal(site.entry('test-rc-changed').status, 'error');
      assert.equal(site.entry('test-rc-good').credited_sha256, sha256Hex(fs.readFileSync(path.join(site.tmp, 'src', 'blog', 'test-rc-good.md'))));
      assert.ok(site.entry('test-rc-good').credit_mac);
      assert.equal(site.entry('test-rc-changed').error_reason, 'approved_bytes_changed');
      assert.equal(site.entry('test-rc-silent').status, 'in-review');
      assert.equal(site.read('test-rc-silent'), silent, 'held: the file is not touched');
      assert.match(site.run.stdout, /HELD \(no licensed approval\): .*\(test-rc-silent\)/);
      assert.match(site.run.stdout, /Held \(no licensed approval\): 1 \(test-rc-silent\)/);
      assert.equal(site.entry('test-rc-good').status, 'published');
      assert.equal(frontmatter(site.read('test-rc-good')).reviewer, REVIEWER.name);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });
});

describe('reconcile-calendar keeps a verified credit across its own date rewrite (fix round 3)', () => {
  const { recordCredit } = require('../scripts/lib/review-credit');
  // A credited published post whose date: is in the future (the one case the
  // reconciler rewrites a published file).
  const credited = () => {
    const md = post('test-rc-credit').replace('date: 2026-01-07', 'date: 2099-01-01');
    const entry = { ...approved('test-rc-credit', md), status: 'published' };
    recordCredit(entry, Buffer.from(md, 'utf8'), SECRET);
    return { md, entry };
  };

  test('the credit record moves to the rewritten bytes, and still verifies', () => {
    const { md, entry } = credited();
    const site = runSite('reconcile-calendar.js', { args: ['--apply'], entries: [entry], files: { 'test-rc-credit': md } });
    try {
      assert.equal(site.run.status, 0, site.run.stdout);
      const bytes = fs.readFileSync(path.join(site.tmp, 'src', 'blog', 'test-rc-credit.md'));
      assert.equal(frontmatter(bytes.toString('utf8')).date, '2026-01-07');
      assert.deepEqual(creditCheck(site.entry('test-rc-credit'), bytes, { secret: SECRET, team: TEAM }), { credit: true, reason: 'credited' });
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });

  test('contrast: a credit that did not verify for the old bytes is not carried over', () => {
    const { md, entry } = credited();
    const site = runSite('reconcile-calendar.js', { args: ['--apply'], entries: [{ ...entry, credit_mac: 'x'.repeat(43) }], files: { 'test-rc-credit': md } });
    try {
      const bytes = fs.readFileSync(path.join(site.tmp, 'src', 'blog', 'test-rc-credit.md'));
      assert.equal(creditCheck(site.entry('test-rc-credit'), bytes, { secret: SECRET, team: TEAM }).credit, false);
      assert.match(site.run.stdout, /not carried to the new bytes/);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });
});

describe('review-credit helpers', () => {
  test('approvalCheck refuses a non-Buffer: the hash must be of raw bytes', () => {
    assert.throws(() => approvalCheck(approved('x', 'x'), 'x', TEAM), /Buffer/);
  });

  test('a non-approved entry is never credited and never an error', () => {
    for (const status of ['planned', 'in-review', 'in-draft']) {
      assert.deepEqual(approvalCheck({ ...approved('x', 'x'), status }, Buffer.from('x'), TEAM, { secret: SECRET }), { credit: false, error: null });
    }
  });

  test('stripReviewerFields touches the front matter only', () => {
    const md = `---\ntitle: T\nreviewer: A\nreviewed_by: A\nreviewer_title: X\n---\n\nreviewer: this line is body text\n`;
    assert.equal(stripReviewerFields(md), '---\ntitle: T\n---\n\nreviewer: this line is body text\n');
  });

  test('stripReviewerFields removes every spelling the renderer reads as a review key', () => {
    // generate-blog.js parseFrontMatter takes the text before the first ':'
    // and trims it, so all of these would have printed a byline.
    const md = '---\ntitle: T\n reviewer: A\n\treviewer_slug: a\nREVIEWED_DATE: 2026-01-01\nreviewer_title : X\nreviewed_by:A\n---\nbody\n';
    assert.equal(stripReviewerFields(md), '---\ntitle: T\n---\nbody\n');
  });

  test('stripReviewerFields reads the same front-matter block the renderer does', () => {
    // A line starting "---x" does not close the renderer's block (it needs
    // "\n---\n"), so the review line after it is still front matter.
    const md = '---\ntitle: T\n---x: y\nreviewer: A\nreviewed_date: 2026-01-01\n---\nbody\n';
    assert.equal(stripReviewerFields(md), '---\ntitle: T\n---x: y\n---\nbody\n');
  });

  test('applyReviewCredit replaces stale review lines rather than duplicating them', () => {
    const md = post('x', 'reviewer: Old Name\nreviewer_title: Licensed Agent\n');
    const out = applyReviewCredit(md, approved('x', md), TEAM, { credit: true });
    assert.equal((out.match(/^reviewer:/gm) || []).length, 1);
    assert.equal(frontmatter(out).reviewer_title, REVIEWER.title);
  });

  test('personNameKey matches sage-server\'s rule', () => {
    assert.equal(personNameKey("Test  O'Reviewer-B."), 'test o reviewer b');
    assert.equal(personNameKey(null), '');
  });
});

describe('approval REQUIRED (owner decision 2026-10-02): unapproved due posts HOLD; email approvals pass the same checks', () => {
  const { ADVISORY_GRANDFATHERED } = require('../scripts/lib/calendar-status');

  test('planned, in-draft and in-review posts past their date are HELD: unchanged, no error, exit 0, even with no markdown or a review_skipped flag', () => {
    const files = { 'test-h-planned': post('test-h-planned'), 'test-h-draft': post('test-h-draft'), 'test-h-review': post('test-h-review'), 'test-h-skipped': post('test-h-skipped') };
    const entries = [
      { slug: 'test-h-planned', title: 'SYNTHETIC hp', publish_date: '2026-01-07', status: 'planned' },
      { slug: 'test-h-draft', title: 'SYNTHETIC hd', publish_date: '2026-01-03', status: 'in-draft' },
      { slug: 'test-h-review', title: 'SYNTHETIC hr', publish_date: '2026-01-07', status: 'in-review', reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email },
      // Locked by the removed --allow-review-skip: it needs an approval like any other post.
      { slug: 'test-h-skipped', title: 'SYNTHETIC hs', publish_date: '2026-01-07', status: 'planned', review_skipped: true },
      // No markdown: held too (I8 names the missing file), not 'error'.
      { slug: 'test-h-nomd', title: 'SYNTHETIC hn', publish_date: '2026-01-07', status: 'planned' },
    ];
    const site = runSite('publish-scheduled-posts.js', { entries, files });
    try {
      assert.equal(site.run.status, 0, site.run.stdout);
      assert.deepEqual(site.calendar.year1, JSON.parse(JSON.stringify(entries)), 'no entry changed');
      for (const [slug, md] of Object.entries(files)) assert.equal(site.read(slug), md, `${slug} untouched`);
      assert.match(site.run.stdout, /5 due post\(s\) HELD/);
      assert.match(site.run.stdout, /HELD \(no licensed approval\): .*\(test-h-nomd\).*reviewer none assigned, and its markdown is missing/);
      assert.match(site.run.stdout, /HELD \(no licensed approval\): .*\(test-h-draft\) due 2026-01-03, status in-draft/);
      assert.doesNotMatch(site.run.stdout, /No posts due/);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });

  test('an approval recorded from an emailed APPROVED (approved_via "email") publishes crediting the reviewer, through the same checks', () => {
    const md = post('test-email-ok');
    const site = runSite('publish-scheduled-posts.js', { entries: [{ ...approved('test-email-ok', md), approved_via: 'email' }], files: { 'test-email-ok': md } });
    try {
      assert.equal(site.run.status, 0, site.run.stdout);
      const e = site.entry('test-email-ok');
      assert.equal(e.status, 'published');
      assert.equal(e.approved_via, 'email');
      assert.equal(frontmatter(site.read('test-email-ok')).reviewer, REVIEWER.name);
      assert.ok(e.credit_mac);
      assert.match(site.run.stdout, /reviewed by Test Reviewer B \(approved by email reply\)/);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });

  for (const [label, patch, file, reason] of [
    ['a broken signature', { approval_mac: 'x'.repeat(43) }, null, 'approval_unsigned'],
    ['changed bytes', {}, 'changed', 'approved_bytes_changed'],
    ['a new date after the approval', { publish_date: '2026-01-10' }, null, 'approval_rescheduled'],
    ['an approver who is not the assigned reviewer', { approved_by_email: 'test-other-staff@example.com' }, null, 'approval_not_by_assigned_reviewer'],
  ]) {
    test(`an emailed approval with ${label} does not publish (${reason})`, () => {
      const md = post('test-email-bad');
      const entry = { ...approved('test-email-bad', md, patch), approved_via: 'email' };
      const site = runSite('publish-scheduled-posts.js', { entries: [entry], files: { 'test-email-bad': file ? `${md}\nAn edit after the reply.\n` : md } });
      try {
        assert.equal(site.run.status, 3, site.run.stdout);
        assert.equal(site.entry('test-email-bad').status, 'error');
        assert.equal(site.entry('test-email-bad').error_reason, reason);
      } finally {
        fs.rmSync(site.tmp, { recursive: true, force: true });
      }
    });
  }

  test('a withdrawn emailed approval loses approved_via with the rest of the record', () => {
    const md = post('test-email-wd');
    const entry = { ...approved('test-email-wd', md), approved_via: 'email', status: 'in-review', publish_date: '2099-01-07' };
    const site = runSite('publish-scheduled-posts.js', { entries: [entry], files: { 'test-email-wd': md } });
    try {
      assert.equal(site.run.status, 0, site.run.stdout);
      assert.equal(site.entry('test-email-wd').approved_via, undefined);
      assert.equal(site.entry('test-email-wd').approval_mac, undefined);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });

  test('the frozen advisory exceptions publish uncredited only at their exact slug and date; anything else back-dated is held', () => {
    const [g] = ADVISORY_GRANDFATHERED;
    const [g2] = ADVISORY_GRANDFATHERED.slice(1);
    const files = { [g.slug]: post(g.slug), [g2.slug]: post(g2.slug), 'test-backdated': post('test-backdated') };
    const site = runSite('publish-scheduled-posts.js', {
      entries: [
        { slug: g.slug, title: 'SYNTHETIC grandfathered', publish_date: g.publish_date, status: 'planned' },
        // Moved off its listed date: it loses the exception.
        { slug: g2.slug, title: 'SYNTHETIC moved', publish_date: '2026-01-07', status: 'in-review' },
        // Back-dated to before the decision, but not listed: held.
        { slug: 'test-backdated', title: 'SYNTHETIC backdated', publish_date: '2026-08-01', status: 'planned' },
      ],
      files,
    });
    try {
      assert.equal(site.run.status, 0, site.run.stdout);
      assert.equal(site.entry(g.slug).status, 'published');
      assert.equal(site.entry(g.slug).credit_mac, undefined, 'advisory: no reviewer credited');
      assert.match(site.run.stdout, /no reviewer credited \(advisory exception\)/);
      assert.equal(site.entry(g2.slug).status, 'in-review');
      assert.equal(site.entry('test-backdated').status, 'planned');
      assert.match(site.run.stdout, /2 due post\(s\) HELD/);
    } finally {
      fs.rmSync(site.tmp, { recursive: true, force: true });
    }
  });
});
