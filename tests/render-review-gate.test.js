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

const SECRET = 'TEST-vector-secret-0123456789abcdef0123';
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');
const post = (slug, extra = '', date = '2026-01-07') => `---\ntitle: SYNTHETIC ${slug}\nslug: ${slug}\ndescription: SYNTHETIC description for ${slug}\nauthor: The Way Agency\ndate: ${date}\n${extra}---\n\n${body}\n`;
const REVIEWER = { name: 'Test Reviewer C', slug: 'test-reviewer-c', email: 'test-reviewer-c@example.com', title: 'Licensed Test Agent' };
const TEAM = [{ name: REVIEWER.name, slug: REVIEWER.slug, email: REVIEWER.email, title: REVIEWER.title, license_states: ['KY'] }];
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
    if (secret) e.BLOG_REVIEW_TOKEN_SECRET = secret;
    return e;
  };
  const run = (script, { secret = SECRET } = {}) => spawnSync(process.execPath, [path.join(tmp, 'scripts', script)], { encoding: 'utf8', env: env(secret), cwd: tmp });
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

describe('an unreadable calendar', () => {
  test('fails open for publication (the blog does not vanish) and closed for credit (no byline)', () => {
    const md = post('test-unreadable');
    const site = makeSite({ year1: [approved('test-unreadable', md)], files: { 'test-unreadable': md } });
    try {
      fs.writeFileSync(path.join(site.tmp, 'data', 'content-calendar.json'), '{ not json');
      const gen = site.run('generate-blog.js');
      assert.match(gen.stdout, /content-calendar\.json could not be read.*no reviewer is credited/);
      const html = site.page('test-unreadable');
      assert.ok(html, gen.stdout + gen.stderr);
      assert.ok(!credits(html));
    } finally {
      site.done();
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
// such front matter (frontMatterProblem), and the template encodes every value
// for where it lands, so neither layer alone is load-bearing.

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

describe('front matter cannot print a review claim through a non-review key', () => {
  const fm = (slug, lines) => `---\ntitle: SYNTHETIC ${slug}\nslug: ${slug}\ndescription: SYNTHETIC description\nauthor: Test Author Q\nauthor_slug: test-author-q\nauthor_title: Licensed Test Agent\ndate: 2026-01-07\n${lines}---\n\n${body}\n`;
  const withKey = (slug, key, value) => fm(slug, '').replace(new RegExp(`^${key}: .*$`, 'm'), `${key}: ${value}`);
  const planned = (slug) => ({ slug, title: `SYNTHETIC ${slug}`, publish_date: '2026-01-07', status: 'planned', ...assigned });
  const injected = {
    'test-inj-author-title': withKey('test-inj-author-title', 'author_title', BYLINE_INJECTION),
    'test-inj-author-slug': withKey('test-inj-author-slug', 'author_slug', LD_INJECTION),
    'test-inj-title': withKey('test-inj-title', 'title', `SYNTHETIC</h1><div class="blog-meta"><span>Reviewed by <a href="/about/team.html#${LICENSED_SLUG}">Test Reviewer C</a></span></div><h1>`),
    'test-inj-description': withKey('test-inj-description', 'description', `d"><meta name="x" content="Reviewed by Test Reviewer C`),
    // Plain text, no markup at all: a byline segment that reads as a credit.
    'test-inj-plain-title': withKey('test-inj-plain-title', 'author_title', 'Licensed Agent | Reviewed by Test Reviewer C, Licensed Test Agent on December 1, 2025'),
    'test-inj-reading-time': fm('test-inj-reading-time', 'reading_time: 6 min read | Reviewed by Test Reviewer C on December 1, 2025\n'),
  };

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

  test('uncalendared, or with the calendar unreadable, the gate still holds', () => {
    const site = makeSite({ files: { 'test-inj-uncal': withKey('test-inj-uncal', 'author_title', BYLINE_INJECTION) } });
    try {
      site.run('generate-blog.js');
      assert.equal(site.page('test-inj-uncal'), null);
      fs.writeFileSync(path.join(site.tmp, 'data', 'content-calendar.json'), '{ not json');
      site.clean();
      const gen = site.run('generate-blog.js');
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
