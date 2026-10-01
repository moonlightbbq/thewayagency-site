/**
 * The "Reviewed by" byline is stamped only for an approval in SAGE whose bytes
 * are still the ones published (sage-server BL-07, scripts/lib/review-credit.js).
 *
 * The licensed review is ADVISORY for publishing (scripts/lib/calendar-
 * status.js): a post whose reviewer never acted still publishes on its date.
 * But silence is not a review, so it names no reviewer, and any review line it
 * carries is removed. An 'approved' post credits its reviewer only while the
 * sha256 of the file's raw bytes equals approved_sha256 and the approval is
 * the byline reviewer's; anything else does not publish at all ('error').
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
const { approvalCheck, applyReviewCredit, stripReviewerFields, personNameKey } = require('../scripts/lib/review-credit');

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
const post = (slug, extra = '') => `---\ntitle: SYNTHETIC ${slug}\ndescription: SYNTHETIC description for ${slug}\ndate: 2026-01-07\n${extra}---\n\n${body}\n`;
const REVIEWER = { name: 'Test Reviewer B', slug: 'test-reviewer-b', email: 'test-reviewer-b@example.com', title: 'Licensed Test Agent' };
const TEAM = [{ name: REVIEWER.name, slug: REVIEWER.slug, email: REVIEWER.email, title: REVIEWER.title, license_states: ['KY'] }];
const REVIEW_KEYS = ['reviewer', 'reviewer_slug', 'reviewer_title', 'reviewed_date', 'reviewed_by'];

/** A calendar entry the assigned reviewer approved in SAGE, for these bytes. */
function approved(slug, md, patch = {}) {
  return {
    slug, title: `SYNTHETIC ${slug}`, publish_date: '2026-01-07', status: 'approved',
    reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, review_sent_date: '2025-12-20',
    approved_by: REVIEWER.name, approved_by_email: REVIEWER.email, approved_date: '2025-12-23', approved_sha256: sha(md),
    ...patch,
  };
}

/** A temp site tree; runs `script` once and returns the result. */
function runSite(script, { entries, files, team = TEAM, args = [] }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-review-stamp-'));
  fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'blog'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts', script), path.join(tmp, 'scripts', script));
  for (const lib of ['calendar-status.js', 'review-credit.js']) {
    fs.copyFileSync(path.join(REPO, 'scripts', 'lib', lib), path.join(tmp, 'scripts', 'lib', lib));
  }
  fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team }));
  fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ year1: entries }, null, 2));
  for (const [slug, md] of Object.entries(files)) fs.writeFileSync(path.join(tmp, 'src', 'blog', `${slug}.md`), md);
  const run = spawnSync(process.execPath, [path.join(tmp, 'scripts', script), ...args], { encoding: 'utf8' });
  const calendar = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'content-calendar.json'), 'utf8'));
  const read = (slug) => fs.readFileSync(path.join(tmp, 'src', 'blog', `${slug}.md`), 'utf8');
  return { tmp, run, calendar, read, entry: (slug) => calendar.year1.find((p) => p.slug === slug) };
}

describe('publish-scheduled-posts: silence and a matching approval', () => {
  let site;
  const silentMd = post('test-silent-review');
  // A post published on silence that somehow carries a review line (an AI
  // edit, a hand edit): the line is removed, never published.
  const smuggledMd = post('test-smuggled-review', `reviewer: ${REVIEWER.name}\nreviewer_slug: ${REVIEWER.slug}\nreviewer_title: Licensed Agent\nreviewed_date: 2025-12-01\n`);
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

  test('all three publish (the review stays advisory)', () => {
    assert.equal(site.run.status, 0, site.run.stdout + site.run.stderr);
    assert.deepEqual(site.calendar.year1.map((p) => p.status), ['published', 'published', 'published']);
  });

  test('a post the reviewer never approved carries no review byline, and a smuggled one is removed', () => {
    for (const slug of ['test-silent-review', 'test-smuggled-review']) {
      const meta = frontmatter(site.read(slug));
      for (const k of REVIEW_KEYS) assert.equal(meta[k], undefined, `${slug}: ${k} must not be stamped without an approval in SAGE`);
      assert.equal(meta.title, `SYNTHETIC ${slug}`);
    }
    assert.match(site.run.stdout, /test-silent-review.*no reviewer credited|SYNTHETIC silent.*no reviewer credited/);
  });

  test('an approval in SAGE whose bytes match credits the reviewer with their real title and the approval date', () => {
    const meta = frontmatter(site.read('test-approved-review'));
    assert.equal(meta.reviewer, REVIEWER.name);
    assert.equal(meta.reviewer_slug, REVIEWER.slug);
    assert.equal(meta.reviewer_title, REVIEWER.title);
    assert.equal(meta.reviewed_date, '2025-12-23');
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
  ];
  for (const [label, entry, file, reason, team] of cases) {
    test(label, () => {
      const site = runSite('publish-scheduled-posts.js', { entries: [entry], files: { 'test-bound': file }, team });
      try {
        assert.equal(site.run.status, 1, site.run.stdout);
        const e = site.entry('test-bound');
        assert.equal(e.status, 'error');
        assert.equal(e.error_reason, reason);
        assert.ok(e.error_at);
        // The approval evidence is kept, and nothing was written to the post.
        assert.equal(e.approved_by, REVIEWER.name);
        assert.equal(site.read('test-bound'), file);
        for (const k of REVIEW_KEYS) assert.equal(frontmatter(site.read('test-bound'))[k], undefined);
        assert.match(site.run.stdout, new RegExp(reason));
      } finally {
        fs.rmSync(site.tmp, { recursive: true, force: true });
      }
    });
  }

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

describe('reconcile-calendar applies the same rule', () => {
  test('--apply: a changed approved post goes to error; silence publishes with no review line; a matching approval is credited', () => {
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
      assert.equal(site.entry('test-rc-changed').error_reason, 'approved_bytes_changed');
      assert.equal(site.entry('test-rc-silent').status, 'published');
      for (const k of REVIEW_KEYS) assert.equal(frontmatter(site.read('test-rc-silent'))[k], undefined);
      assert.equal(site.entry('test-rc-good').status, 'published');
      assert.equal(frontmatter(site.read('test-rc-good')).reviewer, REVIEWER.name);
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
      assert.deepEqual(approvalCheck({ ...approved('x', 'x'), status }, Buffer.from('x'), TEAM), { credit: false, error: null });
    }
  });

  test('stripReviewerFields touches the front matter only', () => {
    const md = `---\ntitle: T\nreviewer: A\nreviewed_by: A\nreviewer_title: X\n---\n\nreviewer: this line is body text\n`;
    assert.equal(stripReviewerFields(md), '---\ntitle: T\n---\n\nreviewer: this line is body text\n');
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
