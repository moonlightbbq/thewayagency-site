/**
 * Y-84 (A): the blog writing rules (scripts/lib/blog-writing-guard.js) and where
 * they bite (Y0 rulings 11/14): the review request, the publish step, the PR
 * check and the live ratchet. Never the production build. Synthetic posts only.
 *
 *   node --test tests/blog-writing-guard.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const g = require('../scripts/lib/blog-writing-guard');
const c = require('../scripts/lib/blog-writing-check');

const post = (body, { title = 'SYNTHETIC title', description = 'SYNTHETIC description' } = {}) =>
  `---\ntitle: "${title}"\nslug: synthetic\ndescription: ${description}\ndate: 2026-11-18\n---\n\n${body}\n`;
const rules = (md) => g.writingProblems(md).map((p) => p.rule);

describe('the exports SAGE reads (Y-84 (D))', () => {
  test('RULES: id, description, test; writingProblems -> { rule, line, text }', () => {
    assert.deepEqual(g.RULES.map((r) => r.id), ['dash', 'stock', 'statistic', 'coming_soon']);
    for (const r of g.RULES) {
      assert.equal(typeof r.test, 'function', r.id);
      assert.ok(r.description.length > 40, r.id);
    }
    const p = g.writingProblems(post('Line one.\n\nA dash — here.'));
    assert.deepEqual(Object.keys(p[0]).sort(), ['line', 'rule', 'text']);
    assert.equal(p[0].line, 10, 'line numbers count the front matter');
  });
});

describe('(a) dashes', () => {
  test('MUST-FAIL: an em dash anywhere: body, title, description, as a character or an entity', () => {
    assert.deepEqual(rules(post('Coverage — explained.')), ['dash']);
    assert.deepEqual(rules(post('Fine.', { title: 'A title — with a dash' })), ['dash']);
    assert.deepEqual(rules(post('Fine.', { description: 'A description&mdash;with a dash' })), ['dash']);
    assert.deepEqual(rules(post('Coverage&#8212;explained.')), ['dash']);
    assert.equal(g.writingProblems(post('Fine.', { title: 'A title — with a dash' }))[0].line, 2);
  });
  test('an en dash between two numbers or two clock times passes', () => {
    for (const ok of ['Discounts of 5–25 apply.', 'Open 9:00 AM – 5:00 PM.', 'Call 9 a.m.–5 p.m.', 'A $500–$1,000 deductible.', 'Pages 3 – 4.']) {
      assert.deepEqual(rules(post(ok)), [], ok);
    }
  });
  test('MUST-FAIL: an en dash anywhere else', () => {
    for (const bad of ['Coverage – explained.', 'Kentucky–Indiana line.', '2026 – the year.', 'Ends –']) {
      assert.deepEqual(rules(post(bad)), ['dash'], bad);
    }
  });
});

describe('(b) stock lines', () => {
  test('MUST-FAIL: each listed line', () => {
    for (const bad of ['It is not just a policy.', 'This isn’t just paperwork.', 'More than just a quote.', "Here's what you need to know about flood.", 'Here is what you need to know.',
      "Here's the thing.", "Let's dive in.", 'Without further ado, the list.', 'Look no further.', 'Rest assured, we help.', 'Floods are excluded. Period. Check yours.',
      'We compare top-rated carriers.', 'In conclusion, review it.', "In today's world, risks grow.", "It's important to note the limit.", 'Navigating the landscape of coverage.', 'A heartfelt thanks.']) {
      assert.deepEqual(rules(post(bad)), ['stock'], bad);
    }
  });
  test('ordinary sentences pass ("period" as a word, "just" alone, a rated carrier)', () => {
    for (const ok of ['The grace period is 30 days long.', 'It just works.', 'An A-rated carrier wrote it.', 'The policy period ends in May.']) {
      assert.deepEqual(rules(post(ok)), [], ok);
    }
  });
});

describe('(c) every statistic names a source', () => {
  test('MUST-FAIL: a percentage or an "N in M" figure with no source', () => {
    for (const bad of ['About 12 percent of drivers are uninsured.', 'Bundling saves 5 to 25 percent.', 'Rates rose 9%.', 'Roughly 1 in 8 drivers is uninsured.', '!!!stat 60% | Homeowners who do not know their limits']) {
      assert.deepEqual(rules(post(bad)), ['statistic'], bad);
    }
  });
  test('a source in the same sentence passes: a link, "according to", a named body, a survey or study', () => {
    for (const ok of ['About 12 percent of drivers are uninsured, according to the Insurance Research Council.', 'About 12 percent are uninsured ([source](https://example.com/irc)).',
      'The NAIC puts it at 12 percent.', 'A 2025 survey found 40 percent had no flood cover.', 'FEMA says 1 in 4 flood claims come from outside high-risk zones.']) {
      assert.deepEqual(rules(post(ok)), [], ok);
    }
  });
  test('dollar amounts are not statistics', () => {
    assert.deepEqual(rules(post('A $1,000 deductible on a $150 package is not worth a claim.')), []);
  });
  // Pattern-level exceptions (Y0: no per-line marker), each with a case.
  test('a deductible percentage is a policy term', () => {
    for (const ok of ['Some policies carry a 2% wind deductible.', 'Your deductible is 1 percent of the dwelling coverage.', 'A deductible of 5% applies.', 'A 1-5% deductible.']) assert.deepEqual(rules(post(ok)), [], ok);
  });
  test('a share of a coverage limit or value is a policy term', () => {
    for (const ok of ['Usually up to 10 percent of your personal property limit.', 'The premium is typically 3 to 5 percent of the horse\'s insured value per year.',
      'Insure it for at least 80 percent of its total value.', 'Most policies set ALE as a percentage of your dwelling coverage, typically 20 to 30 percent.',
      'This might be a percentage of your dwelling coverage (1-5%).']) {
      assert.deepEqual(rules(post(ok)), [], ok);
    }
  });
  test('a coinsurance clause, a benefit share, a worked sum, a tax bracket and an ownership test are policy or law terms', () => {
    for (const ok of ['Most policies include a coinsurance clause, usually 80 percent.', 'Disability insurance pays you a monthly benefit, typically 50 to 70 percent of your pre-disability income.',
      '- **Income:** $60,000/year x 15 years = $900,000 (adjusted to $720,000 at 80%)', 'If you are in the 22 percent federal tax bracket, it saves you $2,640.',
      'An S-corp shareholder owning more than 2 percent may deduct premiums.']) {
      assert.deepEqual(rules(post(ok)), [], ok);
    }
  });
  test('a year is not an "N in M" ratio', () => {
    assert.deepEqual(rules(post('If you are turning 65 in 2027, start planning now.')), []);
  });
  test('the exceptions stay narrow: the same words as a market claim still fail', () => {
    for (const bad of ['Discounts typically run 10 to 20 percent of your premium.', 'Most small businesses contribute 50 to 75 percent of the employee-only premium.', 'Insurance typically costs 1 to 3 percent of your annual income.']) {
      assert.deepEqual(rules(post(bad)), ['statistic'], bad);
    }
  });
});

describe('(d) "(coming soon)"', () => {
  test('MUST-FAIL: any "(coming soon)", linked or not', () => {
    assert.deepEqual(rules(post('See our umbrella insurance guide (coming soon).')), ['coming_soon']);
    assert.deepEqual(rules(post('See [our guide](/blog/x) ( Coming Soon ).')), ['coming_soon']);
  });
  test('a markup or URL value never confuses the rules', () => {
    assert.deepEqual(rules(post('<script>alert(1)</script> https://example.com/a?b=1')), []);
  });
});

describe('named exceptions (data/blog-writing-exceptions.json)', () => {
  const md = post('Rates rose 9% this year.\n\nRates rose 9% again.');
  test('an entry waives its rule on its post\'s matching lines only', () => {
    const ex = [{ slug: 'synthetic', rule: 'statistic', contains: 'this year', reason: 'synthetic reason, at least twenty characters' }];
    const r = g.postProblems('synthetic', md, ex);
    assert.equal(r.problems.length, 1);
    assert.equal(r.used.length, 1);
    assert.equal(g.postProblems('other', md, ex).problems.length, 2, 'another post is not waived');
  });
  test('MUST-FAIL: a malformed entry throws', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwg-ex-'));
    try {
      for (const bad of [{ slug: 'x', rule: 'nope', contains: '12345678', reason: 'twenty characters reason' }, { slug: 'x', rule: 'dash', contains: 'short', reason: 'twenty characters reason' }, { slug: 'x', rule: 'dash', contains: '12345678', reason: 'short' }]) {
        fs.writeFileSync(path.join(dir, 'e.json'), JSON.stringify({ exceptions: [bad] }));
        assert.throws(() => g.loadExceptions(path.join(dir, 'e.json')), /an exception needs/, JSON.stringify(bad));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test('the repo file is valid', () => {
    assert.ok(Array.isArray(g.loadExceptions(c.DEFAULTS.exceptionsFile)));
  });
});

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwg-tree-'));
  fs.mkdirSync(path.join(dir, '_drafts'));
  for (const [rel, md] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), md);
  return dir;
}
const rel = (dir, f) => path.relative(path.join(__dirname, '..'), path.join(dir, f)).split(path.sep).join('/');

describe('the check: unpublished posts, the live ratchet', () => {
  const TODAY = '2026-11-15';
  const live = (body) => post(body).replace('date: 2026-11-18', 'date: 2026-01-01');
  const calendar = { year1: [{ slug: 'cal-live', publish_date: '2026-01-02', status: 'published' }, { slug: 'cal-planned', publish_date: '2026-12-02', status: 'planned' }] };
  test('MUST-FAIL: an unpublished post the PR changes, with a problem; the same post unchanged is not the PR\'s', () => {
    const dir = tree({ 'cal-planned.md': post('A dash — here.') });
    try {
      const changed = new Set([rel(dir, 'cal-planned.md')]);
      const r = c.checkPosts({ blogDir: dir, calendar, baseline: { posts: {} }, exceptions: [], today: TODAY, changed });
      assert.equal(r.problems.length, 1);
      assert.match(r.problems[0], /unpublished post breaks the "dash" rule/);
      assert.deepEqual(c.checkPosts({ blogDir: dir, calendar, baseline: { posts: {} }, exceptions: [], today: TODAY, changed: new Set() }).problems, []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test('a draft in _drafts/ and a future-dated post off the calendar are unpublished', () => {
    const dir = tree({ '_drafts/d.md': post('x — y'), 'future.md': post('x — y') });
    try {
      const r = c.checkPosts({ blogDir: dir, calendar, baseline: { posts: {} }, exceptions: [], today: TODAY, changed: new Set([rel(dir, '_drafts/d.md'), rel(dir, 'future.md')]) });
      assert.equal(r.unpublished, 2);
      assert.equal(r.problems.length, 2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test('MUST-FAIL: a live post above its baseline; a live post below it (stale entry); an entry for no live post', () => {
    const dir = tree({ 'cal-live.md': live('One — two.\n\nThree — four.'), 'old.md': live('Clean.') });
    try {
      const worse = c.checkPosts({ blogDir: dir, calendar, baseline: { posts: { 'cal-live': { dash: 1 } } }, exceptions: [], today: TODAY });
      assert.equal(worse.problems.length, 1);
      assert.match(worse.problems[0], /has 2 "dash" problem\(s\), its baseline allows 1/);
      const stale = c.checkPosts({ blogDir: dir, calendar, baseline: { posts: { 'cal-live': { dash: 3 } } }, exceptions: [], today: TODAY });
      assert.match(stale.problems[0], /lower its entry .* from 3 to 2/);
      const gone = c.checkPosts({ blogDir: dir, calendar, baseline: { posts: { 'cal-live': { dash: 2 }, nope: { dash: 1 } } }, exceptions: [], today: TODAY });
      assert.deepEqual(gone.problems, ['data/blog-writing-baseline.json: "nope" is not a live post; remove its entry']);
      assert.deepEqual(c.checkPosts({ blogDir: dir, calendar, baseline: { posts: { 'cal-live': { dash: 2 } } }, exceptions: [], today: TODAY }).problems, []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test('MUST-FAIL: an exception that waives nothing', () => {
    const dir = tree({ 'old.md': live('Clean.') });
    try {
      const r = c.checkPosts({ blogDir: dir, calendar, baseline: { posts: {} }, exceptions: [{ slug: 'old', rule: 'dash', contains: 'nothing here', reason: 'synthetic reason over twenty' }], today: TODAY });
      assert.match(r.problems[0], /waives nothing/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test('the baseline only goes down: writing it never raises a count or adds a post', () => {
    assert.throws(() => c.nextBaseline({ posts: { a: { dash: 1 } } }, { a: { dash: 2 } }), /refusing to raise: a dash: 1 -> 2/);
    assert.throws(() => c.nextBaseline({ posts: {} }, { b: { stock: 1 } }), /b stock: not listed -> 1/);
    assert.deepEqual(c.nextBaseline({ posts: { a: { dash: 3, stock: 1 } } }, { a: { dash: 2 } }).posts, { a: { dash: 2 } });
    assert.deepEqual(c.nextBaseline(null, { b: { stock: 1 } }, { init: true }).posts, { b: { stock: 1 } });
  });
  test('W1: an unpublished calendar post 0-18 days out that breaks a rule', () => {
    const dir = tree({ 'cal-planned.md': post('x — y'), 'far.md': post('x — y') });
    try {
      const cal = { year1: [{ slug: 'cal-planned', publish_date: '2026-12-02', status: 'planned' }, { slug: 'far', publish_date: '2027-03-01', status: 'planned' }, { slug: 'cal-live', publish_date: '2026-11-20', status: 'published' }] };
      const holds = c.writingHolds(cal, { blogDir: dir, today: TODAY });
      assert.deepEqual(holds.map((h) => h.entry.slug), ['cal-planned']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the repo', () => {
  test('every live post is within data/blog-writing-baseline.json, the baseline is current, every exception is used', () => {
    const r = c.checkPosts({ calendar: c.readJson(c.DEFAULTS.calendarFile, {}), baseline: c.readJson(c.DEFAULTS.baselineFile, null), exceptions: g.loadExceptions(c.DEFAULTS.exceptionsFile), today: new Date().toISOString().slice(0, 10) });
    assert.deepEqual(r.problems, []);
  });
  test('the 12/02 and 12/16 drafts keep every rule (Y-84 (C))', () => {
    for (const slug of ['winter-driving-auto-insurance-kentucky', 'year-end-insurance-review-checklist']) {
      assert.deepEqual(g.writingProblems(fs.readFileSync(path.join(ROOT, 'src', 'blog', `${slug}.md`), 'utf8')), [], slug);
    }
  });
  test('12/02 goes back to planned for a fresh request over the clean bytes; its reviewer stays, and it carries no approval (Y0 11/15)', () => {
    const e = c.calendarEntries(c.readJson(c.DEFAULTS.calendarFile, {})).get('winter-driving-auto-insurance-kentucky');
    assert.equal(e.reviewer_slug, 'audrey-lillpop');
    // The fresh request then goes out through the normal reminder run (it did on
    // 2026-11-18: status in-review, review_sent_date set). Until the reviewer
    // approves the clean bytes, no approval or credit may ride along.
    if (e.status === 'planned' || e.status === 'in-review') {
      const keys = ['approved_sha256', 'approval_mac', 'credited_sha256', 'credit_mac'];
      if (e.status === 'planned') keys.push('review_sent_date');
      for (const k of keys) assert.equal(e[k], undefined, k);
    } else {
      assert.ok(['approved', 'published'].includes(e.status), `unexpected status ${e.status}`);
    }
  });
  test('never in the production build; the PR check and the publish workflow run it', () => {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8'), /blog-writing/);
    const dp = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-protection.yml'), 'utf8');
    assert.match(dp, /fetch-depth: 0/);
    assert.match(dp, /node scripts\/check-blog-writing\.js --changed "origin\/\$\{\{ github\.base_ref \}\}"/);
    assert.match(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8'), /--fail-on I4,I2b,I6,I7,I8,I9,W1\n/);
  });
});

describe('the gates', () => {
  const sre = require('../scripts/send-review-emails');
  const REV = { name: 'Test Sage Reviewer', slug: 'test-sage-reviewer', email: 'test-sage-reviewer@example.com', title: 'Licensed Test Agent', license_states: ['KY'] };
  const words = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');
  async function request(md) {
    const sent = [];
    const log = [];
    const calendar = { year1: [{ slug: 'test-write', title: 'SYNTHETIC test-write', publish_date: '2026-11-25', status: 'planned' }] };
    const r = await sre.runReviewEmails({
      calendar, team: [REV], today: '2026-11-15', sageUrl: 'https://sage-test.example.com', tokenSecret: 'test-vector-secret-test-vector-secret',
      readPostBytes: () => Buffer.from(md, 'utf8'), alertTo: 'test-content-owner@example.com', log: (l) => log.push(l), writingExceptions: [],
      send: async (to, subject, html) => { sent.push({ to, subject, html }); return { id: 'stub' }; },
    });
    return { ...r, sent, entry: calendar.year1[0], log: log.join('\n') };
  }
  test('MUST-FAIL: no review request for a post that breaks a rule; it stays planned, records why, and the content owner is told the rule and line', async () => {
    const r = await request(post(`Coverage — explained.\n\n${words}`));
    assert.equal(r.sent.length, 1, 'only the alert');
    assert.equal(r.sent[0].to, 'test-content-owner@example.com');
    assert.match(r.sent[0].subject, /^Blog review request not sent \(the post breaks the writing rules\)/);
    assert.match(r.sent[0].html, /line 8 \[dash\]/);
    assert.match(r.sent[0].html, /Blog review request not sent/);
    assert.equal(r.entry.status, 'planned');
    assert.equal(r.entry.reviewer_email, undefined, 'no reviewer assigned for a held post');
    assert.match(r.entry.review_send_error, /^2026-11-15: WRITING_RULES: 1 problem\(s\) in src\/blog\/test-write\.md, first: line 8 \[dash\]/);
    assert.equal(r.counts.requests, 0);
  });
  test('a post that keeps the rules gets its request', async () => {
    const r = await request(post(`Coverage explained.\n\n${words}`));
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].to, REV.email);
    assert.equal(r.entry.status, 'in-review');
  });
  test('MUST-FAIL: a due post that breaks a rule goes to \'error\' (writing_rules) and is not published', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwg-publish-'));
    try {
      for (const d of ['scripts/lib', 'data', 'src/blog']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'scripts', 'publish-scheduled-posts.js'), path.join(tmp, 'scripts', 'publish-scheduled-posts.js'));
      for (const lib of ['calendar-status.js', 'review-credit.js', 'blog-content-guard.js', 'blog-writing-guard.js']) fs.copyFileSync(path.join(ROOT, 'scripts', 'lib', lib), path.join(tmp, 'scripts', 'lib', lib));
      fs.writeFileSync(path.join(tmp, 'data', 'team.json'), JSON.stringify({ team: [REV] }));
      fs.writeFileSync(path.join(tmp, 'data', 'content-calendar.json'), JSON.stringify({ year1: [{ slug: 'test-due', title: 'SYNTHETIC test-due', publish_date: '2026-01-01', status: 'approved' }] }));
      fs.writeFileSync(path.join(tmp, 'src', 'blog', 'test-due.md'), post(`Coverage — explained.\n\n${words}`));
      const env = { ...process.env };
      delete env.BLOG_REVIEW_TOKEN_SECRET;
      const run = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'publish-scheduled-posts.js')], { encoding: 'utf8', env });
      const e = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'content-calendar.json'), 'utf8')).year1[0];
      assert.equal(e.status, 'error', run.stdout + run.stderr);
      assert.equal(e.error_reason, 'writing_rules');
      assert.match(run.stdout, /breaks the blog writing rules \(1 problem\(s\)\); not published/);
      assert.match(run.stdout, /src\/blog\/test-due\.md:8 \[dash\]/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});
