/**
 * The renderer applies the review gate (sage-server BL-07, AIA-018).
 *
 * scripts/generate-blog.js is the step that actually publishes a page: the
 * deploy build runs it on every push to main and renders every markdown post
 * whose date has passed. Before BL-07 fix round 2 it printed "Reviewed by"
 * from whatever review lines a file's front matter carried, and rendered posts
 * the publisher had refused, so a reviewer could be credited with no click in
 * SAGE at all. These tests run the real generator (and, end to end, the real
 * publisher) against a temp copy of the site tree with synthetic data:
 *
 *   - a 'planned' post past its date with review lines renders with no credit,
 *     in any spelling of the review keys the generator's parser accepts;
 *   - an entry in 'error' (approved_bytes_changed) neither renders nor credits;
 *   - a hold, an unknown status and a file claiming another post's slug do not
 *     render;
 *   - "Reviewed by" renders only for an approval SAGE signed whose bytes are
 *     the ones on disk: the approval itself before the publisher runs, the
 *     publisher's credit record after; a hand-typed approval or credit record,
 *     a changed file, or a build without the secret credits no one.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const { signApproval } = require('../scripts/lib/review-credit');

const SECRET = 'test-vector-secret-test-vector-secret';
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');
// The synthetic team's first name is "Test": a title or description that put
// it beside a credit word ("test-approved-due") is flagged like a real name
// would be (blog-content-guard.js reviewWordingWarnings), so the slug goes in
// without its prefix and only the fixtures meant to be flagged are.
const named = (slug) => slug.replace(/^test-/, '');
const post = (slug, extra = '', date = '2026-01-07') => `---\ntitle: SYNTHETIC ${named(slug)}\nslug: ${slug}\ndescription: SYNTHETIC description for ${named(slug)}\nauthor: The Way Agency\ndate: ${date}\n${extra}---\n\n${body}\n`;
const REVIEWER = { name: 'Test Reviewer C', slug: 'test-reviewer-c', email: 'test-reviewer-c@example.com', title: 'Licensed Test Agent' };
// An author (the byline's "Written by" prints a team.json member, never front-matter text).
const AUTHOR = { name: 'Test Author Q', slug: 'test-author-q', email: 'test-author-q@example.com', title: 'Licensed Test Agent' };
const TEAM = [
  { name: REVIEWER.name, slug: REVIEWER.slug, email: REVIEWER.email, title: REVIEWER.title, license_states: ['KY'] },
  { name: AUTHOR.name, slug: AUTHOR.slug, email: AUTHOR.email, title: AUTHOR.title },
];
const REVIEW_LINES = `reviewer: ${REVIEWER.name}\nreviewer_slug: ${REVIEWER.slug}\nreviewer_title: Licensed Agent\nreviewed_date: 2025-12-01\n`;
const assigned = { reviewer: REVIEWER.name, reviewer_slug: REVIEWER.slug, reviewer_email: REVIEWER.email, review_sent_date: '2025-12-20' };

function approved(slug, md, patch = {}) {
  const entry = {
    slug, title: `SYNTHETIC ${slug}`, publish_date: '2026-01-07', status: 'approved', ...assigned,
    approved_by: REVIEWER.name, approved_by_email: REVIEWER.email, approved_date: '2025-12-23', approved_sha256: sha(md),
    approved_publish_date: '2026-01-07',
  };
  entry.approval_mac = signApproval(entry, SECRET);
  return { ...entry, ...patch };
}

/** A temp site tree with the generator, the publisher and their libraries. */
function makeSite({ year1 = [], existing = [], files = {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-review-gate-'));
  for (const dir of ['scripts/lib', 'data', 'src/blog', 'build/blog']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  for (const f of ['generate-blog.js', 'shared-templates.js', 'publish-scheduled-posts.js']) {
    fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(tmp, 'scripts', f));
  }
  for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'lib'))) {
    fs.copyFileSync(path.join(REPO, 'scripts', 'lib', f), path.join(tmp, 'scripts', 'lib', f));
  }
  fs.copyFileSync(path.join(REPO, 'data', 'locations.json'), path.join(tmp, 'data', 'locations.json'));
  fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team: TEAM }));
  fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ existing_posts: existing, year1 }, null, 2));
  for (const [name, md] of Object.entries(files)) fs.writeFileSync(path.join(tmp, 'src', 'blog', name.endsWith('.md') ? name : `${name}.md`), md);
  const env = (secret) => {
    const e = { ...process.env };
    delete e.BLOG_REVIEW_TOKEN_SECRET;
    delete e.CF_PAGES;
    delete e.CF_PAGES_BRANCH;
    if (secret) e.BLOG_REVIEW_TOKEN_SECRET = secret;
    return e;
  };
  const run = (script, { secret = SECRET, extraEnv = {} } = {}) => spawnSync(process.execPath, [path.join(tmp, 'scripts', script)], { encoding: 'utf8', env: { ...env(secret), ...extraEnv }, cwd: tmp });
  const page = (slug) => {
    const f = path.join(tmp, 'build', 'blog', `${slug}.html`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
  const calendar = () => JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'content-calendar.json'), 'utf8'));
  const clean = () => fs.rmSync(path.join(tmp, 'build', 'blog'), { recursive: true, force: true });
  return { tmp, run, page, calendar, clean, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

const credits = (html) => /Reviewed by/.test(html) || /"reviewedBy"/.test(html);

describe('generate-blog renders no review claim without a signed approval', () => {
  let site;
  let gen;
  const approvedMd = post('test-approved-due');
  const changedBase = post('test-error-changed');
  before(() => {
    site = makeSite({
      year1: [
        { slug: 'test-planned-past', title: 'SYNTHETIC planned', publish_date: '2026-01-07', status: 'planned', ...assigned },
        { slug: 'test-spellings', title: 'SYNTHETIC spellings', publish_date: '2026-01-07', status: 'in-review', ...assigned },
        { ...approved('test-error-changed', changedBase), status: 'error', error_reason: 'approved_bytes_changed' },
        { slug: 'test-held', title: 'SYNTHETIC held', publish_date: '2026-01-07', status: 'changes-requested', ...assigned },
        { slug: 'test-unknown', title: 'SYNTHETIC unknown', publish_date: '2026-01-07', status: 'awaiting-legal', ...assigned },
        { slug: 'test-future', title: 'SYNTHETIC future', publish_date: '2099-01-07', status: 'planned', ...assigned },
        approved('test-approved-due', approvedMd),
        approved('test-approved-unsigned', post('test-approved-unsigned'), { approval_mac: undefined }),
        { slug: 'test-short', title: 'SYNTHETIC short', publish_date: '2026-01-07', status: 'planned' },
      ],
      existing: [
        // An old post, published long ago, with review lines and no credit record.
        { slug: 'test-legacy', title: 'SYNTHETIC legacy', publish_date: '2026-01-01', status: 'published', ...assigned },
      ],
      files: {
        'test-planned-past': post('test-planned-past', REVIEW_LINES),
        // Every spelling generate-blog.js's parser reads as a key once trimmed.
        'test-spellings': post('test-spellings', ` reviewer: ${REVIEWER.name}\n\treviewer_slug: ${REVIEWER.slug}\nreviewed_date : 2025-12-01\nReviewer: ${REVIEWER.name}\n reviewed_by: ${REVIEWER.name}\n`),
        'test-error-changed': `${changedBase.replace('---\n\n', `${REVIEW_LINES}---\n\n`)}\nAn AI-added paragraph the reviewer never saw.\n`,
        'test-held': post('test-held', REVIEW_LINES),
        'test-unknown': post('test-unknown'),
        'test-future': post('test-future', '', '2026-01-07'),
        'test-approved-due': approvedMd,
        'test-approved-unsigned': post('test-approved-unsigned'),
        'test-short': `---\ntitle: SYNTHETIC short\nslug: test-short\ndescription: d\ndate: 2026-01-07\n---\n\nToo short.\n`,
        'test-legacy': post('test-legacy', REVIEW_LINES, '2026-01-01'),
        'test-uncalendared': post('test-uncalendared', REVIEW_LINES),
        // Another file claiming a calendar post's slug, to render at its URL.
        'zz-impostor.md': post('test-held'),
      },
    });
    gen = site.run('generate-blog.js');
  });
  after(() => site.done());

  test('the generator runs cleanly', () => {
    assert.equal(gen.status, 0, gen.stdout + gen.stderr);
  });

  test('a planned post past its date renders, with review lines in its front matter, and credits no one', () => {
    const html = site.page('test-planned-past');
    assert.ok(html, gen.stdout);
    assert.ok(!credits(html), 'no "Reviewed by" and no reviewedBy without an approval in SAGE');
    assert.ok(!html.includes(REVIEWER.name), 'the reviewer is not named anywhere on the page');
  });

  test('a review key with leading whitespace, another case or a space before the colon credits no one', () => {
    const html = site.page('test-spellings');
    assert.ok(html, gen.stdout);
    assert.ok(!credits(html));
    assert.ok(!html.includes(REVIEWER.name));
  });

  test('an entry in error (approved_bytes_changed) neither renders nor credits', () => {
    assert.equal(site.page('test-error-changed'), null);
    assert.match(gen.stdout, /test-error-changed\.html.*approved_bytes_changed/);
  });

  test('a held post, an unknown status and a post not yet due do not render', () => {
    assert.equal(site.page('test-held'), null);
    assert.equal(site.page('test-unknown'), null);
    assert.equal(site.page('test-future'), null, 'the calendar date governs, not the file\'s own date:');
    assert.equal(site.page('test-short'), null, 'a post the publisher would refuse as not ready');
  });

  test('another file cannot render at a calendar post\'s URL around its hold', () => {
    assert.match(gen.stdout, /zz-impostor\.md.*belongs to the calendar post/);
    assert.equal(site.page('test-held'), null);
  });

  test('an approval SAGE signed, for the bytes on disk, credits the reviewer before the publisher runs', () => {
    const html = site.page('test-approved-due');
    assert.ok(html, gen.stdout);
    assert.match(html, new RegExp(`Reviewed by <a href="/about/team.html#${REVIEWER.slug}"[^>]*>${REVIEWER.name}</a>, ${REVIEWER.title} on December 23, 2025`));
    assert.match(html, /"reviewedBy"/);
  });

  test('a hand-typed approval (no approval_mac) does not render at all', () => {
    assert.equal(site.page('test-approved-unsigned'), null);
    assert.match(gen.stdout, /test-approved-unsigned\.html.*approval_unsigned/);
  });

  test('a published post with review lines but no credit record renders without them', () => {
    const html = site.page('test-legacy');
    assert.ok(html);
    assert.ok(!credits(html));
  });

  test('a post that is not on the calendar renders, and credits no one', () => {
    const html = site.page('test-uncalendared');
    assert.ok(html);
    assert.ok(!credits(html));
  });
});

describe('a missing or unreadable calendar (fix round 5)', () => {
  // It used to render every post on its own front-matter date, held
  // ('changes-requested') and 'error' posts included: text a reviewer
  // objected to went live after a bad merge. Now nothing renders, nothing is
  // removed, and the generator exits nonzero, which fails scripts/build.js
  // (Cloudflare Pages keeps the last deploy).
  for (const [label, damage] of [
    ['unparseable', (f) => fs.writeFileSync(f, '{ not json')],
    ['missing', (f) => fs.rmSync(f)],
    ['with neither list', (f) => fs.writeFileSync(f, '{"slots": []}')],
  ]) {
    test(`${label}: no post renders, a held one included, and the run fails`, () => {
      const held = post('test-unreadable-held');
      const site = makeSite({
        year1: [{ slug: 'test-unreadable-held', title: 'SYNTHETIC held', publish_date: '2026-01-07', status: 'changes-requested', ...assigned }],
        files: { 'test-unreadable-held': held, 'test-unreadable-uncal': post('test-unreadable-uncal') },
      });
      try {
        const stale = path.join(site.tmp, 'build', 'blog', 'test-left-from-before.html');
        fs.writeFileSync(stale, '<!DOCTYPE html><p>an earlier build</p>');
        damage(path.join(site.tmp, 'data', 'content-calendar.json'));
        const gen = site.run('generate-blog.js');
        assert.notEqual(gen.status, 0, gen.stdout);
        assert.match(gen.stderr, /content-calendar\.json could not be read.*no blog post is rendered and the build fails/s);
        assert.equal(site.page('test-unreadable-held'), null);
        assert.equal(site.page('test-unreadable-uncal'), null);
        assert.ok(fs.existsSync(stale), 'nothing is removed either: the build fails as a whole');
      } finally {
        site.done();
      }
    });
  }

  test('scripts/build.js fails when the generator fails (runBlogGenerator no longer logs and carries on)', () => {
    const { runBlogGenerator } = require('../scripts/builders/blog-helpers');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-review-gate-run-'));
    try {
      fs.mkdirSync(path.join(tmp, 'scripts'));
      fs.writeFileSync(path.join(tmp, 'scripts', 'generate-blog.js'), 'process.exit(1);\n');
      assert.throws(() => runBlogGenerator(tmp), /Blog generation failed/);
      fs.writeFileSync(path.join(tmp, 'scripts', 'generate-blog.js'), '\n');
      assert.doesNotThrow(() => runBlogGenerator(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('end to end: publisher then renderer', () => {
  test('the credit survives publishing, and is dropped by any later change, a forged record, or a build without the secret', () => {
    const md = post('test-e2e');
    const silent = post('test-e2e-silent', REVIEW_LINES);
    const site = makeSite({
      year1: [
        approved('test-e2e', md),
        { slug: 'test-e2e-silent', title: 'SYNTHETIC silent', publish_date: '2026-01-07', status: 'in-review', ...assigned },
      ],
      files: { 'test-e2e': md, 'test-e2e-silent': silent },
    });
    try {
      const pub = site.run('publish-scheduled-posts.js');
      assert.equal(pub.status, 0, pub.stdout + pub.stderr);
      const entry = site.calendar().year1.find((p) => p.slug === 'test-e2e');
      assert.equal(entry.status, 'published');
      assert.ok(entry.credited_sha256 && entry.credit_mac);

      let gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stdout + gen.stderr);
      assert.match(site.page('test-e2e'), /Reviewed by .*Test Reviewer C/);
      assert.ok(!credits(site.page('test-e2e-silent')), 'silence names no reviewer');

      // A build without the secret cannot verify the credit, so prints none.
      site.clean();
      gen = site.run('generate-blog.js', { secret: null });
      assert.ok(site.page('test-e2e'), 'the post still renders');
      assert.ok(!credits(site.page('test-e2e')));
      assert.match(gen.stdout, /BLOG_REVIEW_TOKEN_SECRET is not set/);

      // A forged credit record: typed to match the file, with no valid MAC.
      const calPath = path.join(site.tmp, 'data', 'content-calendar.json');
      const cal = site.calendar();
      const forged = cal.year1.find((p) => p.slug === 'test-e2e-silent');
      Object.assign(forged, {
        status: 'published', approved_by: REVIEWER.name, approved_by_email: REVIEWER.email, approved_date: '2025-12-23',
        approved_sha256: sha(silent), approval_mac: 'x'.repeat(43),
        credited_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(site.tmp, 'src', 'blog', 'test-e2e-silent.md'))).digest('hex'),
        credit_mac: 'y'.repeat(43),
      });
      fs.writeFileSync(calPath, JSON.stringify(cal, null, 2));
      // ...and review lines put back into the published file by hand.
      const silentPath = path.join(site.tmp, 'src', 'blog', 'test-e2e-silent.md');
      fs.writeFileSync(silentPath, silent);
      forged.credited_sha256 = sha(silent);
      fs.writeFileSync(calPath, JSON.stringify(cal, null, 2));
      site.clean();
      site.run('generate-blog.js');
      assert.ok(!credits(site.page('test-e2e-silent')), 'a hand-typed credit record credits no one');

      // Any change to the credited file after publishing drops the byline.
      const e2ePath = path.join(site.tmp, 'src', 'blog', 'test-e2e.md');
      fs.appendFileSync(e2ePath, '\nA later edit nobody reviewed.\n');
      site.clean();
      site.run('generate-blog.js');
      assert.ok(site.page('test-e2e'));
      assert.ok(!credits(site.page('test-e2e')));
    } finally {
      site.done();
    }
  });
});

// ─── Fix round 3: front matter is data ──────────────────────────────────────
//
// A review claim must not be printable through a NON-review front-matter key.
// Before round 3 the generator interpolated front-matter values into the page
// HTML and the JSON-LD unescaped, so `author_title: ...</span><span>Reviewed by
// <a ...>A Licensed Agent</a>...` printed a "Reviewed by" byline, and an
// author_slug carrying '"' added a top-level reviewedBy to the JSON-LD, on a
// post no reviewer approved. Two layers now: the publish/render gate refuses
// such front matter (frontMatterProblem: markup, unsafe slugs and the other
// deterministic rules), and the template encodes every value for where it
// lands, so neither layer alone is load-bearing. Plain-text WORDING that reads
// as a credit is flagged, not refused (the scope decision after round 5): the
// byline never prints author_title, so it carries no structured credit.

const LICENSED_SLUG = 'test-reviewer-c';
const BYLINE_INJECTION = `Licensed Agent, The Way Agency</span><span>|</span><span>Reviewed by <a href="/about/team.html#${LICENSED_SLUG}">Test Reviewer C</a>, Licensed Test Agent on December 1, 2025`;
const LD_INJECTION = 'x"}, "reviewedBy": {"@type": "Person", "name": "Test Reviewer C"}, "q": {"z": "';

/** Every ld+json block on a page, parsed (a block that does not parse fails the test). */
function ldBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}
/** Whether any object anywhere in a parsed value has the key. */
function hasKeyDeep(v, key) {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, key));
  if (v && typeof v === 'object') return Object.keys(v).some((k) => k === key || hasKeyDeep(v[k], key));
  return false;
}
const bylineOf = (html) => (html.match(/<div class="blog-meta">[\s\S]*?<\/div>/) || [''])[0];
/**
 * Whether the page carries a STRUCTURED review credit: the byline's "Reviewed
 * by" element or a JSON-LD reviewedBy. Wording in the text (a title, the body)
 * is not one: it is flagged, never refused, and prints as written.
 */
const structuredCredit = (html) => /Reviewed by/.test(bylineOf(html)) || ldBlocks(html).some((b) => hasKeyDeep(b, 'reviewedBy'));
/** The build or publish log flagged review-credit wording for this post. */
const warned = (stdout, slug) => new RegExp(`! ${slug}: review-credit wording in .*only the signed byline is a verified credit`).test(stdout);

describe('front matter cannot print a review claim through a non-review key', () => {
  const fm = (slug, lines) => `---\ntitle: SYNTHETIC ${slug}\nslug: ${slug}\ndescription: SYNTHETIC description\nauthor: Test Author Q\nauthor_slug: test-author-q\nauthor_title: Licensed Test Agent\ndate: 2026-01-07\n${lines}---\n\n${body}\n`;
  const withKey = (slug, key, value) => fm(slug, '').replace(new RegExp(`^${key}: .*$`, 'm'), `${key}: ${value}`);
  const planned = (slug) => ({ slug, title: `SYNTHETIC ${slug}`, publish_date: '2026-01-07', status: 'planned', ...assigned });
  const injected = {
    'test-inj-author-title': withKey('test-inj-author-title', 'author_title', BYLINE_INJECTION),
    'test-inj-author-slug': withKey('test-inj-author-slug', 'author_slug', LD_INJECTION),
    'test-inj-title': withKey('test-inj-title', 'title', `SYNTHETIC</h1><div class="blog-meta"><span>Reviewed by <a href="/about/team.html#${LICENSED_SLUG}">Test Reviewer C</a></span></div><h1>`),
    'test-inj-description': withKey('test-inj-description', 'description', `d"><meta name="x" content="Reviewed by Test Reviewer C`),
  };
  // Plain text, no markup at all: a byline segment that reads as a credit.
  const PLAIN = withKey('test-inj-plain-title', 'author_title', 'Licensed Agent | Reviewed by Test Reviewer C, Licensed Test Agent on December 1, 2025');

  test('the publisher refuses each one (error / unsafe_frontmatter) and the renderer renders none of them, before or after', () => {
    const site = makeSite({ year1: Object.keys(injected).map(planned), files: injected });
    try {
      let gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stdout + gen.stderr);
      for (const slug of Object.keys(injected)) {
        assert.equal(site.page(slug), null, `${slug} must not render`);
        assert.match(gen.stdout, new RegExp(`Not rendered ${slug}\\.html .*unsafe_frontmatter`));
      }
      const pub = site.run('publish-scheduled-posts.js');
      assert.equal(pub.status, 3, pub.stdout + pub.stderr);
      for (const slug of Object.keys(injected)) {
        const e = site.calendar().year1.find((p) => p.slug === slug);
        assert.equal(e.status, 'error', slug);
        assert.equal(e.error_reason, 'unsafe_frontmatter', slug);
      }
      site.clean();
      gen = site.run('generate-blog.js');
      for (const slug of Object.keys(injected)) assert.equal(site.page(slug), null, `${slug} must not render after the publisher ran`);
    } finally {
      site.done();
    }
  });

  test('plain-text credit wording in author_title: flagged, rendered and published, with no structured credit (author_title is never printed)', () => {
    const site = makeSite({ year1: [planned('test-inj-plain-title')], files: { 'test-inj-plain-title': PLAIN } });
    try {
      const gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stdout + gen.stderr);
      const html = site.page('test-inj-plain-title');
      assert.ok(html, gen.stdout);
      assert.ok(!structuredCredit(html));
      assert.ok(!html.includes('Reviewed by'), 'author_title is never printed');
      assert.ok(warned(gen.stdout, 'test-inj-plain-title'), gen.stdout);
      const pub = site.run('publish-scheduled-posts.js');
      assert.equal(pub.status, 0, pub.stdout + pub.stderr);
      const e = site.calendar().year1.find((p) => p.slug === 'test-inj-plain-title');
      assert.equal(e.status, 'published');
      assert.equal(e.credit_mac, undefined);
      assert.ok(warned(pub.stdout, 'test-inj-plain-title'), pub.stdout);
    } finally {
      site.done();
    }
  });

  test('credit wording in reading_time: rendered and published with the computed reading time, flagged, with no structured credit (fix round 1 after the scope decision)', () => {
    // Round 4 refused a reading_time that was not "N min read". The renderer
    // never prints one: it prints the time it computes, and logs the value.
    const slug = 'test-inj-reading-time';
    const site = makeSite({ year1: [planned(slug)], files: { [slug]: fm(slug, 'reading_time: 6 min read | Reviewed by Test Reviewer C on December 1, 2025\n') } });
    try {
      const gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stdout + gen.stderr);
      const html = site.page(slug);
      assert.ok(html, gen.stdout);
      assert.ok(!structuredCredit(html));
      assert.ok(!html.includes('Reviewed by'), 'the front-matter reading_time is never printed');
      assert.match(bylineOf(html), /<span>\d+ min read<\/span>/);
      assert.ok(warned(gen.stdout, slug), gen.stdout);
      assert.match(gen.stdout, new RegExp(`! ${slug}: the front-matter reading_time .* is not "N min" or "N min read"; the page prints the computed reading time instead`));
      const pub = site.run('publish-scheduled-posts.js');
      assert.equal(pub.status, 0, pub.stdout + pub.stderr);
      const e = site.calendar().year1.find((p) => p.slug === slug);
      assert.equal(e.status, 'published');
      assert.equal(e.credit_mac, undefined);
    } finally {
      site.done();
    }
  });

  test('uncalendared, or with the calendar unreadable, the gate still holds', () => {
    const site = makeSite({ files: { 'test-inj-uncal': withKey('test-inj-uncal', 'author_title', BYLINE_INJECTION) } });
    try {
      site.run('generate-blog.js');
      assert.equal(site.page('test-inj-uncal'), null);
      fs.writeFileSync(path.join(site.tmp, 'data', 'content-calendar.json'), '{ not json');
      site.clean();
      const gen = site.run('generate-blog.js');
      assert.notEqual(gen.status, 0, 'an unreadable calendar renders nothing and fails the run (fix round 5)');
      assert.equal(site.page('test-inj-uncal'), null, gen.stdout);
    } finally {
      site.done();
    }
  });

  test('what the gate allows is still only text: quotes, a JSON-LD break-out and a </script> in a FAQ add no reviewedBy and no byline', () => {
    const md = `---\ntitle: SYNTHETIC "quoted" & 'single' title\nslug: test-encoded\ndescription: ${LD_INJECTION}\nauthor: Test Author Q\nauthor_slug: test-author-q\nauthor_title: Licensed Test Agent\nimage: /src/assets/images/test.jpg\nimage_alt: a" onerror="alert(1)\ndate: 2026-01-07\n---\n\n${body}\n\nSee [this](/x" onmouseover="alert(1)) and [that](javascript:alert(1)).\n\n### FAQ: Q</script><script type="application/ld+json">{"@context": "https://schema.org", "@type": "Article", "reviewedBy": {"@type": "Person", "name": "Test Reviewer C"}}</script>?\n\nA "quoted" answer & more.\n`;
    const site = makeSite({ year1: [planned('test-encoded')], files: { 'test-encoded': md } });
    try {
      const gen = site.run('generate-blog.js');
      const html = site.page('test-encoded');
      assert.ok(html, gen.stdout + gen.stderr);
      assert.doesNotMatch(bylineOf(html), /Reviewed by/);
      const blocks = ldBlocks(html);
      assert.ok(blocks.length >= 2, 'the Article and FAQPage blocks parse');
      assert.ok(!blocks.some((b) => hasKeyDeep(b, 'reviewedBy')), 'no reviewedBy anywhere in the structured data');
      const article = blocks.find((b) => b['@type'] === 'Article');
      assert.equal(article.description, LD_INJECTION, 'the value round-trips as a string');
      assert.equal(article.headline, 'SYNTHETIC "quoted" & \'single\' title');
      assert.equal(article.author['@type'], 'Person');
      assert.doesNotMatch(html, /onerror="alert|onmouseover="alert|href="javascript:/i, 'no attribute break-out, no script URL');
      assert.match(html, /<h1 class="hero__title">SYNTHETIC &quot;quoted&quot; &amp; &#39;single&#39; title<\/h1>/);
    } finally {
      site.done();
    }
  });
});

describe('the page template encodes every front-matter value (generateBlogPost, behind the gate)', () => {
  const { generateBlogPost, markdownToHtml } = require('../scripts/generate-blog');
  const base = { title: 'SYNTHETIC t', slug: 'test-template', description: 'SYNTHETIC d', author: 'Test Author Q', author_slug: 'test-author-q', author_title: 'Licensed Test Agent', date: '2026-01-07' };
  const render = (meta) => generateBlogPost(meta, markdownToHtml(body), []);

  test('the round-3 repro payloads through author_title, author_slug, title and description print no review element and no reviewedBy', () => {
    for (const meta of [
      { ...base, author_title: BYLINE_INJECTION },
      { ...base, author_slug: LD_INJECTION },
      { ...base, title: `SYNTHETIC</h1><span>Reviewed by <a href="/about/team.html#${LICENSED_SLUG}">Test Reviewer C</a></span>` },
      { ...base, description: `${LD_INJECTION}</script><script type="application/ld+json">{"reviewedBy": {"name": "Test Reviewer C"}}` },
    ]) {
      const html = render(meta);
      assert.doesNotMatch(html, /<span>Reviewed by/, JSON.stringify(meta));
      assert.ok(!html.includes(`href="/about/team.html#${LICENSED_SLUG}"`), 'no link to the reviewer');
      assert.ok(!ldBlocks(html).some((b) => hasKeyDeep(b, 'reviewedBy')));
    }
  });

  test('an unsafe author_slug is dropped: the agency is the author, with no link', () => {
    const html = render({ ...base, author_slug: LD_INJECTION });
    assert.equal(ldBlocks(html)[0].author['@type'], 'Organization');
    assert.match(bylineOf(html), /Written by The Way Agency/);
  });

  test('contrast: a credit (what renderDecision passes only for a signed approval) prints the byline and reviewedBy', () => {
    const html = render({ ...base, reviewer: 'Test Reviewer C', reviewer_slug: LICENSED_SLUG, reviewer_title: 'Licensed Test Agent', reviewed_date: '2025-12-23' });
    assert.match(bylineOf(html), new RegExp(`<span>Reviewed by <a href="/about/team.html#${LICENSED_SLUG}"[^>]*>Test Reviewer C</a>, Licensed Test Agent on December 23, 2025</span>`));
    assert.deepEqual(ldBlocks(html)[0].reviewedBy, { '@type': 'Person', name: 'Test Reviewer C', url: `https://www.thewayagency.com/about/team.html#${LICENSED_SLUG}` });
  });
});

describe('fix round 3: slug binding, unverifiable approvals, rescheduling and withdrawal', () => {
  test('a calendar post whose front matter claims another slug does not render under it (around its hold)', () => {
    const site = makeSite({
      year1: [{ slug: 'test-held-stem', title: 'SYNTHETIC held', publish_date: '2026-01-07', status: 'changes-requested', ...assigned }],
      files: { 'test-held-stem': post('test-uncalendared-alias') },
    });
    try {
      const gen = site.run('generate-blog.js');
      assert.equal(site.page('test-uncalendared-alias'), null);
      assert.equal(site.page('test-held-stem'), null);
      assert.match(gen.stdout, /test-held-stem\.md .*slug mismatch/);
    } finally {
      site.done();
    }
  });

  test('without the secret, a due signed approval renders uncredited (it does not go dark until the publisher runs)', () => {
    const md = post('test-approved-nosecret');
    const site = makeSite({ year1: [approved('test-approved-nosecret', md)], files: { 'test-approved-nosecret': md } });
    try {
      const gen = site.run('generate-blog.js', { secret: null });
      const html = site.page('test-approved-nosecret');
      assert.ok(html, gen.stdout);
      assert.ok(!credits(html));
      // ...and with the secret, the same approval credits.
      site.clean();
      site.run('generate-blog.js');
      assert.match(site.page('test-approved-nosecret'), /Reviewed by/);
    } finally {
      site.done();
    }
  });

  test('a signed approval moved to another publish date does not render (approval_rescheduled)', () => {
    const md = post('test-rescheduled');
    const site = makeSite({ year1: [{ ...approved('test-rescheduled', md), publish_date: '2026-01-06' }], files: { 'test-rescheduled': md } });
    try {
      const gen = site.run('generate-blog.js');
      assert.equal(site.page('test-rescheduled'), null);
      assert.match(gen.stdout, /test-rescheduled\.html.*approval_rescheduled/);
    } finally {
      site.done();
    }
  });

  test('a withdrawn approval (the entry set back to in-review, the signed record left on it) credits no one', () => {
    const md = post('test-withdrawn');
    const site = makeSite({ year1: [{ ...approved('test-withdrawn', md), status: 'in-review' }], files: { 'test-withdrawn': md } });
    try {
      site.run('generate-blog.js');
      assert.ok(site.page('test-withdrawn'));
      assert.ok(!credits(site.page('test-withdrawn')));
    } finally {
      site.done();
    }
  });
});

// ─── Fix round 4: the byline is an allowlist, and no copy bypasses the gate ──
//
// The round-3 guard was a /review/i denylist on three byline fields. The
// review found four ways past it that each printed "Reviewed by <a licensed
// agent>" inside the visible byline with no approval (a Cyrillic look-alike,
// a soft hyphen or zero-width space, full-width letters, a synonym), every
// other printed value (title, CTA, alt text, ...) and the article body
// unchecked, and a hand-made src/pages/blog/<slug>.html copied into the build
// around a hold. The byline now prints a data/team.json member or the agency,
// the deterministic front-matter rules refuse invisible and bidi characters
// (look-alike and full-width ones too, until fix round 1 after the scope
// decision: now they are folded and flagged), wording in every printed value
// and the body is flagged
// (scripts/lib/blog-content-guard.js: a warning since the scope decision
// after round 5; the post renders as written with no structured credit), and
// build/blog/ keeps only what the gate rendered and the frozen hand-made pages.

describe('fix round 4: no forged credit through the byline, any printed value or the body', () => {
  const fm = (slug, lines = '', bodyText = body) => `---\ntitle: SYNTHETIC ${slug}\nslug: ${slug}\ndescription: SYNTHETIC description\nauthor: ${AUTHOR.name}\nauthor_slug: ${AUTHOR.slug}\nauthor_title: ${AUTHOR.title}\ndate: 2026-01-07\n${lines}---\n\n${bodyText}\n`;
  const withKey = (slug, key, value) => fm(slug).replace(new RegExp(`^${key}: .*$`, 'm'), `${key}: ${value}`);
  const credit = `${REVIEWER.name}, Licensed Test Agent on December 1, 2025`;
  // Refused by a deterministic rule: an invisible or bidi character.
  const hostile = {
    'test-r4-shy': withKey('test-r4-shy', 'author_title', `Licensed Agent | Re\u00ADviewed by ${credit}`),
    'test-r4-zwsp': withKey('test-r4-zwsp', 'author_title', `Client Care Specialist, The Way Agency | Re\u200Bviewed by ${credit}`),
    'test-r4-bidi': withKey('test-r4-bidi', 'title', 'SYNTHETIC \u202Eyb deweiveR'),
  };
  // Plain-text wording: flagged, rendered as written, no structured credit.
  // The look-alike and full-width fixtures were refused as characters until
  // fix round 1 after the scope decision (an arrow in a live title took the
  // post down); the wording rules fold them, so they are flagged like the rest.
  const worded = {
    'test-r4-cyrillic': fm('test-r4-cyrillic', `reading_time: R\u0435viewed by ${credit} | 6 min read\n`),
    'test-r4-fullwidth': withKey('test-r4-fullwidth', 'author_title', `\uFF32\uFF45\uFF56\uFF49\uFF45\uFF57\uFF45\uFF44 by ${credit}`),
    'test-r4-fullwidth-title': withKey('test-r4-fullwidth-title', 'title', `SYNTHETIC \uFF32\uFF45\uFF56\uFF49\uFF45\uFF57\uFF45\uFF44 by ${REVIEWER.name}`),
    'test-r4-approved': withKey('test-r4-approved', 'author_title', `Approved by ${credit}`),
    'test-r4-author': withKey('test-r4-author', 'author', `${AUTHOR.name} | Reviewed by ${REVIEWER.name}`),
    'test-r4-title': withKey('test-r4-title', 'title', `SYNTHETIC guide — Reviewed by ${REVIEWER.name}, Licensed Agent`),
    'test-r4-cta': fm('test-r4-cta', `cta_title: Reviewed by ${REVIEWER.name}, Licensed Agent\n`),
    'test-r4-desc': withKey('test-r4-desc', 'description', 'Vetted by our licensed agents.'),
    'test-r4-alt': fm('test-r4-alt', `image_alt: Approved by ${REVIEWER.name}\n`),
    'test-r4-body': fm('test-r4-body', '', `Reviewed by [${REVIEWER.name}](/about/team.html#${REVIEWER.slug}), Licensed Test Agent on December 1, 2025\n\n${body}`),
  };
  const planned = (slug, status) => ({ slug, title: `SYNTHETIC ${slug}`, publish_date: '2026-01-07', status, ...assigned });

  for (const [label, status] of [['planned and due', 'planned'], ['in review and due', 'in-review'], ['not on the calendar', null]]) {
    test(`${label}: the invisible and bidi characters do not render; the wording renders, flagged, with no structured credit`, () => {
      const files = { ...hostile, ...worded };
      const site = makeSite({ year1: status ? Object.keys(files).map((slug) => planned(slug, status)) : [], files });
      try {
        const gen = site.run('generate-blog.js');
        assert.equal(gen.status, 0, gen.stdout + gen.stderr);
        for (const slug of Object.keys(hostile)) {
          assert.equal(site.page(slug), null, `${slug} must not render (${label})`);
          assert.match(gen.stdout, new RegExp(`Not rendered ${slug}\\.html .*unsafe_frontmatter`), slug);
        }
        for (const slug of Object.keys(worded)) {
          const html = site.page(slug);
          assert.ok(html, `${slug} renders (${label}): ${gen.stdout}`);
          assert.ok(!structuredCredit(html), `${slug}: no byline credit and no reviewedBy (${label})`);
          assert.ok(!bylineOf(html).includes(REVIEWER.name), `${slug}: the byline never names the reviewer`);
          assert.ok(warned(gen.stdout, slug), `${slug} is flagged in the build log`);
        }
      } finally {
        site.done();
      }
    });
  }

  test('the publisher refuses the deterministic ones (error, unsafe_frontmatter) and publishes the worded ones uncredited, logging the wording', () => {
    const files = { ...hostile, ...worded };
    const site = makeSite({ year1: Object.keys(files).map((slug) => planned(slug, 'planned')), files });
    try {
      const pub = site.run('publish-scheduled-posts.js');
      assert.equal(pub.status, 3, pub.stdout + pub.stderr);
      for (const slug of Object.keys(hostile)) {
        const e = site.calendar().year1.find((p) => p.slug === slug);
        assert.equal(e.status, 'error', slug);
        assert.equal(e.error_reason, 'unsafe_frontmatter', slug);
      }
      for (const slug of Object.keys(worded)) {
        const e = site.calendar().year1.find((p) => p.slug === slug);
        assert.equal(e.status, 'published', slug);
        assert.equal(e.credit_mac, undefined, slug);
        assert.ok(warned(pub.stdout, slug), `${slug}: ${pub.stdout}`);
      }
    } finally {
      site.done();
    }
  });

  test('worded text with a signed approval: the structured credit is the approval\'s, whatever the text says', () => {
    const md = worded['test-r4-title'];
    const site = makeSite({ year1: [approved('test-r4-title', md)], files: { 'test-r4-title': md } });
    try {
      const gen = site.run('generate-blog.js');
      const html = site.page('test-r4-title');
      assert.ok(html, gen.stdout);
      assert.match(bylineOf(html), new RegExp(`Reviewed by <a href="/about/team.html#${REVIEWER.slug}"[^>]*>${REVIEWER.name}</a>, ${REVIEWER.title} on December 23, 2025`));
      assert.ok(warned(gen.stdout, 'test-r4-title'));
    } finally {
      site.done();
    }
  });

  test('contrast: the same post with a plain byline renders "Written by" the team member, with team.json\'s title', () => {
    const site = makeSite({ year1: [planned('test-r4-plain', 'planned')], files: { 'test-r4-plain': fm('test-r4-plain', 'reading_time: 6 min read\n') } });
    try {
      const gen = site.run('generate-blog.js');
      const html = site.page('test-r4-plain');
      assert.ok(html, gen.stdout);
      assert.match(bylineOf(html), new RegExp(`Written by <a href="/about/team.html#${AUTHOR.slug}"[^>]*>${AUTHOR.name}</a>, ${AUTHOR.title}, The Way Agency`));
      assert.match(bylineOf(html), /<span>6 min read<\/span>/);
      assert.doesNotMatch(bylineOf(html), /Reviewed by/);
      const feed = fs.readFileSync(path.join(site.tmp, 'build', 'blog', 'feed.xml'), 'utf8');
      assert.match(feed, new RegExp(`<dc:creator><!\\[CDATA\\[${AUTHOR.name}\\]\\]></dc:creator>`));
    } finally {
      site.done();
    }
  });
});

describe('fix round 1 after the scope decision: printable characters and reading_time never take a post down', () => {
  // The review appended " \u2192" to a live post's title, and set
  // "reading_time: 7 minutes" on another: each was "Not rendered" with the
  // build still exiting 0, so the live URL would have dropped off the site.
  const fm = (slug, lines = '') => `---\ntitle: SYNTHETIC ${slug}\nslug: ${slug}\ndescription: SYNTHETIC description\nauthor: The Way Agency\ndate: 2026-01-07\n${lines}---\n\n${body}\n`;
  const TITLE = 'SYNTHETIC term life vs. whole life \u2192 \u26A0\uFE0F \uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67 \u65E5\u672C \u2264 $500';
  const files = {
    'test-fr1-arrow': fm('test-fr1-arrow').replace('title: SYNTHETIC test-fr1-arrow', `title: ${TITLE}`),
    'test-fr1-minutes': fm('test-fr1-minutes', 'reading_time: 7 minutes\n'),
  };
  for (const [label, status] of [['published long ago', 'published'], ['planned and due', 'planned'], ['not on the calendar', null]]) {
    test(`${label}: both render; the title prints as written, the computed reading time is printed and the value logged`, () => {
      const entry = (slug) => ({ slug, title: `SYNTHETIC ${slug}`, publish_date: '2026-01-07', status });
      const site = makeSite({ year1: status ? Object.keys(files).map(entry) : [], files });
      try {
        const gen = site.run('generate-blog.js');
        assert.equal(gen.status, 0, gen.stdout + gen.stderr);
        assert.doesNotMatch(gen.stdout, /Not rendered test-fr1/);
        const arrow = site.page('test-fr1-arrow');
        assert.ok(arrow, gen.stdout);
        assert.ok(arrow.includes(`<h1 class="hero__title">${TITLE}</h1>`), 'the title prints as written');
        assert.equal(ldBlocks(arrow)[0].headline, TITLE);
        const minutes = site.page('test-fr1-minutes');
        assert.ok(minutes, gen.stdout);
        assert.match(bylineOf(minutes), /<span>\d+ min read<\/span>/);
        assert.ok(!minutes.includes('7 minutes'), 'a reading_time that is not "N min read" is never printed');
        assert.match(gen.stdout, /! test-fr1-minutes: the front-matter reading_time "7 minutes" is not "N min" or "N min read"; the page prints the computed reading time instead/);
        assert.doesNotMatch(gen.stdout, /review-credit wording/);
        for (const html of [arrow, minutes]) assert.ok(!structuredCredit(html));
        if (status !== 'planned') {
          // The feed carries the title as written (a planned entry's card is the calendar's title).
          const feed = fs.readFileSync(path.join(site.tmp, 'build', 'blog', 'feed.xml'), 'utf8');
          assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(feed), 'the feed holds only XML characters');
        }
      } finally {
        site.done();
      }
    });
  }
});

describe('fix round 4: the template prints the byline from team.json, whatever the front matter says (behind the gate)', () => {
  const { generateBlogPost, markdownToHtml } = require('../scripts/generate-blog');
  const base = { title: 'SYNTHETIC t', slug: 'test-template', description: 'SYNTHETIC d', author: AUTHOR.name, author_slug: AUTHOR.slug, author_title: AUTHOR.title, date: '2026-01-07' };
  const render = (meta) => generateBlogPost(meta, markdownToHtml(body), [], { team: TEAM });

  test('free text in author, author_title or reading_time never reaches the byline', () => {
    for (const meta of [
      { ...base, author_title: `Licensed Agent | Re​viewed by ${REVIEWER.name}` },
      { ...base, author: `${AUTHOR.name} | Approved by ${REVIEWER.name}` },
      { ...base, reading_time: `Rеviewed by ${REVIEWER.name} | 6 min read` },
    ]) {
      const line = bylineOf(render(meta));
      assert.ok(!line.includes(REVIEWER.name), `${JSON.stringify(meta)}: ${line}`);
      assert.doesNotMatch(line, /viewed by|pproved by/i, JSON.stringify(meta));
    }
  });

  test('author_slug alone names the author, as team.json gives them; author and author_title are never printed (fix round 5)', () => {
    // A stale title or name (a promotion, a marriage) prints team.json's, so a
    // team.json edit updates the byline instead of dropping it to the agency.
    for (const meta of [{ ...base, author_title: 'Client Care Specialist' }, { ...base, author: 'Someone Else' }, { ...base, author: undefined, author_title: undefined }]) {
      const html = render(meta);
      assert.match(bylineOf(html), new RegExp(`>${AUTHOR.name}</a>, ${AUTHOR.title}, The Way Agency</span>`), JSON.stringify(meta));
      assert.ok(!html.includes('Someone Else') && !html.includes('Client Care Specialist'), JSON.stringify(meta));
      assert.deepEqual(ldBlocks(html)[0].author, { '@type': 'Person', name: AUTHOR.name, jobTitle: AUTHOR.title, url: `https://www.thewayagency.com/about/team.html#${AUTHOR.slug}` });
    }
    // The slug decides: the reviewer as AUTHOR is a "Written by", never a review credit.
    const asAuthor = render({ ...base, author_slug: REVIEWER.slug, author: AUTHOR.name });
    assert.match(bylineOf(asAuthor), new RegExp(`Written by <a[^>]*>${REVIEWER.name}</a>`));
    assert.doesNotMatch(bylineOf(asAuthor), /Reviewed by/);
    assert.equal(ldBlocks(asAuthor)[0].reviewedBy, undefined);
  });

  test('an author_slug that names no member makes the agency the author; no "Licensed Agent" is invented', () => {
    for (const meta of [{ ...base, author_slug: 'test-nobody' }, { ...base, author_slug: 'x"y' }]) {
      const html = render(meta);
      assert.match(bylineOf(html), /<span>Written by The Way Agency<\/span>/, JSON.stringify(meta));
      assert.equal(ldBlocks(html)[0].author['@type'], 'Organization');
    }
    const noTitle = generateBlogPost({ ...base, author_title: undefined }, markdownToHtml(body), [], { team: [{ name: AUTHOR.name, slug: AUTHOR.slug }] });
    assert.match(bylineOf(noTitle), new RegExp(`>${AUTHOR.name}</a>, The Way Agency</span>`));
    assert.equal(ldBlocks(noTitle)[0].author.jobTitle, undefined);
  });

  test('with the author unset, the post is the agency\'s, whatever author says', () => {
    const html = render({ ...base, author_slug: undefined, author_title: undefined, author: REVIEWER.name });
    assert.match(bylineOf(html), /<span>Written by The Way Agency<\/span>/);
    assert.ok(!html.includes(REVIEWER.name));
  });
});

describe('fix round 4: build/blog keeps only what the gate rendered and the frozen hand-made pages', () => {
  const { LEGACY_BLOG_PAGES } = require('../scripts/lib/legacy-blog-pages');
  const forged = (slug) => `<!DOCTYPE html><html><body><div class="blog-meta"><span>Reviewed by <a href="/about/team.html#${REVIEWER.slug}">${REVIEWER.name}</a></span></div><script type="application/ld+json">{"reviewedBy":{"name":"${REVIEWER.name}"}}</script></body></html>`;

  test('a hand-made copy of a held post, an unknown page and a stale page are removed; an unclaimed frozen page stays', () => {
    const legacy = Object.keys(LEGACY_BLOG_PAGES).find((f) => f !== 'index.html');
    const legacyClaimed = Object.keys(LEGACY_BLOG_PAGES).filter((f) => f !== 'index.html')[1];
    const claimedSlug = legacyClaimed.slice(0, -'.html'.length);
    const site = makeSite({
      year1: [
        { slug: 'test-r4-held', title: 'SYNTHETIC held', publish_date: '2026-01-07', status: 'changes-requested', ...assigned },
        { slug: claimedSlug, title: 'SYNTHETIC claimed', publish_date: '2026-01-07', status: 'changes-requested', ...assigned },
      ],
      files: { 'test-r4-held': post('test-r4-held'), [claimedSlug]: post(claimedSlug) },
    });
    try {
      // What scripts/build.js copyBlogPages (or a hand-made page) leaves there.
      for (const name of ['test-r4-held.html', 'test-r4-new-url.html', legacy, legacyClaimed]) {
        fs.writeFileSync(path.join(site.tmp, 'build', 'blog', name), forged(name));
      }
      const gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stdout + gen.stderr);
      assert.equal(site.page('test-r4-held'), null, 'the held post is not served from a hand-made copy');
      assert.match(gen.stdout, /Removed blog\/test-r4-held\.html .*not rendered .*requested changes/);
      assert.equal(site.page('test-r4-new-url'), null, 'no page at a new /blog/ URL without the gate');
      assert.equal(site.page(claimedSlug), null, 'a frozen page whose name a held markdown post claims is not served');
      assert.ok(site.page(legacy.slice(0, -'.html'.length)), 'an unclaimed frozen hand-made page stays');
    } finally {
      site.done();
    }
  });

  test('copyBlogPages fails the build on an unknown or edited hand-made page, and does not copy one a markdown post claims', () => {
    const { copyBlogPages } = require('../scripts/builders/blog-helpers');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-blog-pages-'));
    const SRC = path.join(tmp, 'src');
    const BUILD = path.join(tmp, 'build');
    fs.mkdirSync(path.join(SRC, 'pages', 'blog'), { recursive: true });
    fs.mkdirSync(path.join(SRC, 'blog'), { recursive: true });
    const real = Object.keys(LEGACY_BLOG_PAGES).filter((f) => f !== 'index.html');
    const copy = (f) => fs.copyFileSync(path.join(REPO, 'src', 'pages', 'blog', f), path.join(SRC, 'pages', 'blog', f));
    const id = (x) => x;
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      copy(real[0]);
      copy(real[1]);
      fs.writeFileSync(path.join(SRC, 'blog', 'any-file.md'), `---\ntitle: x\nslug: ${real[1].slice(0, -'.html'.length)}\n---\n\nx\n`);
      copyBlogPages(SRC, BUILD, id);
      assert.ok(fs.existsSync(path.join(BUILD, 'blog', real[0])), 'a frozen page is copied');
      assert.ok(!fs.existsSync(path.join(BUILD, 'blog', real[1])), 'a frozen page a markdown post claims is not');

      fs.writeFileSync(path.join(SRC, 'pages', 'blog', 'test-r4-new.html'), forged('x'));
      assert.throws(() => copyBlogPages(SRC, BUILD, id), /Hand-made blog page guard failed/);
      fs.rmSync(path.join(SRC, 'pages', 'blog', 'test-r4-new.html'));

      fs.appendFileSync(path.join(SRC, 'pages', 'blog', real[0]), '\n<p>Reviewed by Test Reviewer C</p>\n');
      assert.throws(() => copyBlogPages(SRC, BUILD, id), /Hand-made blog page guard failed/);
    } finally {
      console.log = log;
      console.error = err;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('the frozen hash list is exactly src/pages/blog/, and none of those pages claims a review', () => {
    const { legacyPageProblem } = require('../scripts/lib/legacy-blog-pages');
    const dir = path.join(REPO, 'src', 'pages', 'blog');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
    assert.deepEqual(files, Object.keys(LEGACY_BLOG_PAGES).sort());
    for (const f of files) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.equal(legacyPageProblem(f, html), null, f);
      assert.doesNotMatch(html, /Reviewed by|reviewedBy/i, f);
    }
  });
});

describe('fix round 4: a Cloudflare Pages Preview build credits no one', () => {
  test('with the secret in a branch build, a signed approval renders uncredited and the build log says to remove it', () => {
    const md = post('test-r4-preview');
    const site = makeSite({ year1: [approved('test-r4-preview', md)], files: { 'test-r4-preview': md } });
    try {
      let gen = site.run('generate-blog.js', { extraEnv: { CF_PAGES: '1', CF_PAGES_BRANCH: 'fix/some-branch' } });
      assert.ok(site.page('test-r4-preview'), gen.stdout);
      assert.ok(!credits(site.page('test-r4-preview')));
      assert.match(gen.stdout, /PREVIEW build .*remove it from the Preview environment/);
      site.clean();
      gen = site.run('generate-blog.js', { extraEnv: { CF_PAGES: '1', CF_PAGES_BRANCH: 'main' } });
      assert.ok(credits(site.page('test-r4-preview')), 'the production build credits it');
    } finally {
      site.done();
    }
  });
});

// ─── Fix round 5 ────────────────────────────────────────────────────────────

describe('fix round 5: a data/team.json edit never takes a post off the site', () => {
  test('a member\'s new title and another member\'s removal: every published and uncalendared post still renders, and the byline follows team.json', () => {
    const by = (slug, m) => post(slug).replace('author: The Way Agency\n', `author: ${m.name}\nauthor_title: ${m.title}\nauthor_slug: ${m.slug}\n`);
    const files = { 'test-team-pub': by('test-team-pub', AUTHOR), 'test-team-uncal': by('test-team-uncal', AUTHOR), 'test-team-rev': by('test-team-rev', REVIEWER) };
    const site = makeSite({
      existing: [
        { slug: 'test-team-pub', title: 'SYNTHETIC team pub', publish_date: '2026-01-07', status: 'published' },
        { slug: 'test-team-rev', title: 'SYNTHETIC team rev', publish_date: '2026-01-07', status: 'published' },
      ],
      files,
    });
    try {
      let gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stderr);
      for (const slug of Object.keys(files)) assert.ok(site.page(slug), `${slug}: ${gen.stdout}`);
      // Offboard AUTHOR; give REVIEWER a new title.
      fs.writeFileSync(path.join(site.tmp, 'data', 'team.json'), JSON.stringify({ team: [{ ...TEAM[0], title: 'Senior Test Agent' }] }));
      gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stderr);
      for (const slug of Object.keys(files)) assert.ok(site.page(slug), `${slug} went dark: ${gen.stdout}`);
      assert.match(bylineOf(site.page('test-team-pub')), /<span>Written by The Way Agency<\/span>/);
      assert.match(bylineOf(site.page('test-team-uncal')), /<span>Written by The Way Agency<\/span>/);
      assert.match(bylineOf(site.page('test-team-rev')), new RegExp(`>${REVIEWER.name}</a>, Senior Test Agent, The Way Agency</span>`));
      assert.match(gen.stdout, /test-team-pub: the front-matter author_slug "test-author-q" names no data\/team\.json member; the byline prints The Way Agency/);
      assert.match(gen.stdout, /test-team-rev: the front-matter author_title is not the title data\/team\.json gives test-reviewer-c/);
      const index = fs.readFileSync(path.join(site.tmp, 'build', 'blog', 'index.html'), 'utf8');
      for (const slug of ['test-team-pub', 'test-team-rev']) assert.ok(index.includes(`/blog/${slug}.html`), slug);
    } finally {
      site.done();
    }
  });
});

describe('fix round 5: a credit split across a line break is read the way the page prints it (flagged, never refused)', () => {
  const withBody = (slug, extra) => post(slug).replace(`${body}\n`, `${body}\n\n${extra}\n`);
  for (const [label, extra] of [
    ['a line break after the participle', `This article was reviewed\nby ${REVIEWER.name}, Licensed Test Agent, on September 1, 2026.`],
    ['a line break after "by"', `Reviewed by\n${REVIEWER.name}, Licensed Test Agent.`],
    ['a blockquote over two lines', `> This guide was reviewed\n> by ${REVIEWER.name}.`],
    ['an FAQ answer over two lines (printed joined, and in the FAQPage JSON-LD)', `### FAQ: Who checks this?\n\nReviewed\nby ${REVIEWER.name}, Licensed Test Agent.`],
    ['an FAQ answer over two paragraphs', `### FAQ: Who checks this?\n\nReviewed\n\nby ${REVIEWER.name}, Licensed Test Agent.`],
  ]) {
    test(`${label}: rendered, flagged in the build log, with no structured credit`, () => {
      const site = makeSite({ files: { 'test-linebreak': withBody('test-linebreak', extra) } });
      try {
        const gen = site.run('generate-blog.js');
        const html = site.page('test-linebreak');
        assert.ok(html, gen.stdout);
        assert.ok(!structuredCredit(html));
        assert.match(gen.stdout, new RegExp(`! test-linebreak: review-credit wording in the (body|FAQ): "[^"]*by ${REVIEWER.name}`));
      } finally {
        site.done();
      }
    });
  }

  test('the renderer reads the text it printed, so a gap in the markdown reading is still flagged', () => {
    for (const extra of [`This article was reviewed\nby ${REVIEWER.name}.`, `### FAQ: Who checks this?\n\nReviewed\n\nby ${REVIEWER.name}, Licensed Test Agent.`]) {
      const site = makeSite({ files: { 'test-printed': withBody('test-printed', extra), 'test-printed-ok': post('test-printed-ok') } });
      try {
        // Simulate a markdown reading that misses it: the copied guard's
        // reviewWordingWarnings finds nothing; reviewClaimIn is intact.
        fs.appendFileSync(path.join(site.tmp, 'scripts', 'lib', 'blog-content-guard.js'), '\nmodule.exports.reviewWordingWarnings = () => [];\n');
        const gen = site.run('generate-blog.js');
        assert.ok(site.page('test-printed'), gen.stdout);
        assert.ok(!structuredCredit(site.page('test-printed')));
        assert.match(gen.stdout, new RegExp(`! test-printed: review-credit wording in the rendered text: "[^"]*reviewed by ${REVIEWER.name}`, 'i'));
        assert.ok(site.page('test-printed-ok'), gen.stdout);
        assert.ok(!warned(gen.stdout, 'test-printed-ok'));
      } finally {
        site.done();
      }
    }
  });

  test('printedText: a line break inside a paragraph is a space; a block ends a line', () => {
    const { printedText } = require('../scripts/generate-blog');
    assert.equal(printedText('<p class="text-lg">This was re<strong>view</strong>ed\nby X &amp; Y.</p>').trim(), 'This was reviewed by X & Y.');
    assert.deepEqual(printedText('<h2>Reviewed</h2>\n<p>by the numbers</p>').split('\n').map((l) => l.trim()).filter(Boolean), ['Reviewed', 'by the numbers']);
  });
});

describe('fix round 5: calendar titles and descriptions on the cards get the wording check (a warning since the scope decision)', () => {
  test('a card whose calendar text reads as a credit is kept as written and flagged in the build log', () => {
    const { LEGACY_BLOG_PAGES } = require('../scripts/lib/legacy-blog-pages');
    const legacy = Object.keys(LEGACY_BLOG_PAGES).find((f) => f !== 'index.html');
    const legacySlug = legacy.slice(0, -'.html'.length);
    const site = makeSite({
      existing: [
        { slug: 'test-card', title: `Reviewed by ${REVIEWER.name}: SYNTHETIC card`, description: `Every answer here was checked by ${REVIEWER.name}.`, publish_date: '2026-01-07', status: 'published' },
        { slug: legacySlug, title: `Approved by ${REVIEWER.name}, Licensed Test Agent`, description: 'SYNTHETIC frozen', publish_date: '2026-01-06', status: 'published' },
        { slug: 'test-card-ok', title: 'SYNTHETIC plain card', description: 'SYNTHETIC plain description', publish_date: '2026-01-05', status: 'published' },
      ],
      files: { 'test-card': post('test-card'), 'test-card-ok': post('test-card-ok') },
    });
    try {
      fs.writeFileSync(path.join(site.tmp, 'build', 'blog', legacy), '<!DOCTYPE html><p>SYNTHETIC frozen page</p>');
      const gen = site.run('generate-blog.js');
      assert.equal(gen.status, 0, gen.stderr);
      const index = fs.readFileSync(path.join(site.tmp, 'build', 'blog', 'index.html'), 'utf8');
      assert.match(index, new RegExp(`>Reviewed by ${REVIEWER.name}: SYNTHETIC card<`), 'the calendar title, as written');
      assert.ok(index.includes(`/blog/${legacySlug}.html`), 'the frozen page keeps its card');
      assert.match(index, />SYNTHETIC plain card</);
      assert.match(gen.stdout, new RegExp(`! test-card: review-credit wording in the calendar title: "Reviewed by ${REVIEWER.name}: SYNTHETIC card"`));
      assert.match(gen.stdout, new RegExp(`! test-card: review-credit wording in the calendar description: "Every answer here was checked by ${REVIEWER.name}\\."`));
      assert.match(gen.stdout, new RegExp(`! ${legacySlug}: review-credit wording in the calendar title`));
      assert.doesNotMatch(gen.stdout, /! test-card-ok: review-credit wording/);
      const related = site.page('test-card-ok');
      assert.ok(!structuredCredit(related), 'a card title is text, not a credit');
      assert.match(related, new RegExp(`Related Articles[\\s\\S]*>Reviewed by ${REVIEWER.name}: SYNTHETIC card<`));
    } finally {
      site.done();
    }
  });
});

describe('fix round 5: a credit is re-checked against data/team.json at render', () => {
  test('a credited post whose reviewer leaves, or loses their licences, renders uncredited (and stays up)', () => {
    const md = post('test-r5-credit');
    const site = makeSite({ year1: [approved('test-r5-credit', md)], files: { 'test-r5-credit': md } });
    try {
      const pub = site.run('publish-scheduled-posts.js');
      assert.equal(pub.status, 0, pub.stdout + pub.stderr);
      let gen = site.run('generate-blog.js');
      assert.match(site.page('test-r5-credit'), /Reviewed by .*Test Reviewer C/, gen.stdout);
      for (const team of [[TEAM[1]], [{ ...TEAM[0], license_states: [] }, TEAM[1]]]) {
        fs.writeFileSync(path.join(site.tmp, 'data', 'team.json'), JSON.stringify({ team }));
        site.clean();
        gen = site.run('generate-blog.js');
        assert.ok(site.page('test-r5-credit'), gen.stdout);
        assert.ok(!credits(site.page('test-r5-credit')), JSON.stringify(team));
        assert.match(gen.stdout, /no longer a licensed data\/team\.json member/);
      }
    } finally {
      site.done();
    }
  });
});
