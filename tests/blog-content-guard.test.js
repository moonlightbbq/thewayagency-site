/**
 * scripts/lib/blog-content-guard.js: what a post may say about who wrote it
 * and who reviewed it (sage-server BL-07 fix round 4, AIA-018).
 *
 * The round-3 guard refused /review/i in author, author_title and
 * reading_time. The review got a forged "Reviewed by <licensed agent>" into
 * the rendered byline past it four ways (a Cyrillic look-alike, a soft hyphen
 * or zero-width space, full-width letters, the synonym "Approved by"), and
 * found every other printed value and the body unchecked. These are those
 * fixtures and their neighbours, the contrasts that must keep passing, and the
 * live posts, which must all still pass.
 *
 * The same file runs in sage-server (src/services/blog-content-guard.js),
 * whose tests/blog-content-guard-parity.test.js fails when the two differ.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const g = require('../scripts/lib/blog-content-guard');

const ROOT = path.join(__dirname, '..');
const TEAM = [
  { name: 'Test Reviewer A', slug: 'test-reviewer-a', title: 'Agency Principal / Licensed Agent', license_states: ['KY'] },
  { name: 'Test Author Q', slug: 'test-author-q', title: 'Client Care Specialist' },
];
const body = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ');
const fm = (lines = '', b = body) => `---\ntitle: SYNTHETIC guide\nslug: test-guide\ndescription: SYNTHETIC description.\nauthor: Test Author Q\nauthor_title: Client Care Specialist\nauthor_slug: test-author-q\ndate: 2026-09-30\n${lines}---\n\n${b}\n`;
const set = (key, value) => fm().replace(new RegExp(`^${key}: .*$`, 'm'), `${key}: ${value}`);
const problem = (md) => g.frontMatterProblem(md, TEAM) || g.bodyProblem(md, TEAM);
const CREDIT = 'Test Reviewer A, Agency Principal / Licensed Agent on September 30, 2026';

describe('front matter: the review\'s fixtures are refused', () => {
  for (const [label, md, why] of [
    ['(a) a Cyrillic look-alike in reading_time', fm(`reading_time: Rеviewed by ${CREDIT} | 6 min read\n`), /character other than/],
    ['(b) a soft hyphen in author_title', set('author_title', `Licensed Agent | Re­viewed by ${CREDIT}`), /character other than/],
    ['(b) a zero-width space in author_title', set('author_title', `Client Care Specialist, The Way Agency | Re​viewed by ${CREDIT}`), /character other than/],
    ['(c) full-width letters', set('author_title', `Ｒｅｖｉｅｗｅｄ by ${CREDIT}`), /character other than/],
    ['(d) "Approved by"', set('author_title', `Approved by ${CREDIT}`), /credit/],
    ['a bidi override', set('title', 'SYNTHETIC ‮yb deweiveR'), /character other than/],
    ['a combining mark', set('title', 'Réviewed by Test Reviewer A'), /character other than/],
    ['reading_time that is not "N min read"', fm('reading_time: 6 min read | Approved by Test Reviewer A\n'), /reading_time/],
    ['an author that is not the author_slug member', set('author', 'Test Reviewer A'), /author is not/],
    ['an author_title that is not the member\'s', set('author_title', 'Licensed Agent'), /author_title is not/],
    ['an author_slug that names no member', set('author_slug', 'test-nobody'), /names no data\/team.json member/],
    ['an unsafe slug', set('slug', 'x/../y'), /lower-case letters/],
    ['a date that is not YYYY-MM-DD', set('date', 'Reviewed by Test Reviewer A'), /YYYY-MM-DD/],
    ['markup', set('title', 'x</h1><span>Reviewed by Test Reviewer A</span>'), /'<' or '>'/],
  ]) {
    test(label, () => assert.match(String(g.frontMatterProblem(md, TEAM)), why));
  }
});

describe('front matter: a credit in ANY value the page prints is refused', () => {
  for (const [key, value] of [
    ['title', 'SYNTHETIC guide — Reviewed by Test Reviewer A, Licensed Agent'],
    ['title', 'Guide (Verified by Test Reviewer A)'],
    ['title', 'Reviewer: Test Reviewer A'],
    ['description', 'Fact-checked by a licensed agent.'],
    ['description', 'Reviewed and approved by someone we trust.'],
    ['cta_title', 'Reviewed by Test Reviewer A, Licensed Agent'],
    ['cta_text', 'Vetted by our licensed agents.'],
    ['image_alt', 'Approved by Test Reviewer A'],
    ['category', 'Checked by Test Reviewer A'],
    ['tags', 'auto, endorsed by Test Reviewer A'],
    ['related_page', '/personal/reviewed-by-test-reviewer-a.html'],
    ['title', 'SYNTHETIC — Signed off by The Way Agency'],
    ['title', 'SYNTHETIC — R.e.v.i.e.w.e.d by Test Reviewer A'],
  ]) {
    test(`${key}: ${value}`, () => {
      const md = fm().includes(`\n${key}: `) ? set(key, value) : fm(`${key}: ${value}\n`);
      assert.match(String(g.frontMatterProblem(md, TEAM)), /review or approval credit/);
    });
  }
});

describe('the body: a credit naming the team, the agency or a licensed agent is refused', () => {
  for (const sentence of [
    'Reviewed by [Test Reviewer A](/about/team.html#test-reviewer-a), Agency Principal / Licensed Agent on September 30, 2026',
    'This article was reviewed by our licensed agents.',
    'Re**view**ed by Test Reviewer A.',
    'Thіs article was rеviewed by our licensed agents.',
    'Re​viewed by Test Reviewer A.',
    'Ｒｅｖｉｅｗｅｄ by Test Reviewer A.',
    'R e v i e w e d  b y  T e s t  R e v i e w e r  A',
    'Every answer here is checked by The Way Agency.',
    'Approved by Test.',
    'Certified by Test Reviewer A.',
    'Reviewer: Test Reviewer A',
    '### FAQ: Who reviewed this?\n\nThis answer was verified by an Agency Principal.',
  ]) {
    test(sentence.replace(/\s+/g, ' ').slice(0, 70), () => {
      assert.match(String(g.bodyProblem(fm('', `${sentence}\n\n${body}`), TEAM)), /review or approval credit/);
    });
  }
});

describe('contrasts that must keep passing', () => {
  for (const [label, md] of [
    ['the plain post', fm('reading_time: 6 min read\n')],
    ['an agency post with no author_slug', fm().replace(/author: .*\nauthor_title: .*\nauthor_slug: .*\n/, 'author: The Way Agency\nauthor_title: Independent Insurance Agency\n')],
    ['reading_time "8 min"', fm('reading_time: 8 min\n')],
    ['an em dash, curly quotes, accents and a currency sign', set('title', 'Café Owners — What’s “actual cash value”? € and $')],
    ['"certified by the state" in a description', set('description', 'Contractors must be certified by the state of Kentucky.')],
    ['"coverage review" in a CTA', fm('cta_text: We\'re here to help. Get a quote or request a coverage review.\n')],
    ['advice in the body', fm('', `${body}\n\nHave your policy reviewed by a licensed agent every year. Medicare Advantage plans are approved by Medicare. The kitchen was inspected by the health department. Rates are approved by the Kentucky DOI. Ask us for a coverage review.\n`)],
    ['review keys themselves (the publisher strips or rewrites them)', fm('reviewer: Test Reviewer A\nreviewed_date: 2026-09-01\n')],
  ]) {
    test(label, () => assert.equal(problem(md), null));
  }
});

describe('bylineAuthor: the byline is a team.json member or the agency', () => {
  test('the member, with team.json\'s name and title', () => {
    assert.deepEqual(g.bylineAuthor({ author_slug: 'test-author-q', author: 'Test Author Q', author_title: 'Client Care Specialist' }, TEAM),
      { slug: 'test-author-q', name: 'Test Author Q', title: 'Client Care Specialist' });
    assert.deepEqual(g.bylineAuthor({ author_slug: 'test-author-q' }, TEAM), { slug: 'test-author-q', name: 'Test Author Q', title: 'Client Care Specialist' });
  });
  test('anything else is the agency (null)', () => {
    for (const meta of [{}, { author: 'Test Reviewer A' }, { author_slug: 'test-nobody' }, { author_slug: 'x"y' },
      { author_slug: 'test-author-q', author: 'Test Reviewer A' }, { author_slug: 'test-author-q', author_title: 'Licensed Agent' },
      { author_slug: 'test-author-q', author: ['Test Author Q'] }]) {
      assert.equal(g.bylineAuthor(meta, TEAM), null, JSON.stringify(meta));
    }
  });
});

describe('the live posts', () => {
  test('every src/blog/*.md passes against data/team.json (nothing on the site goes dark)', () => {
    const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'team.json'), 'utf8'));
    const team = Array.isArray(t) ? t : t.team;
    const dir = path.join(ROOT, 'src', 'blog');
    const refused = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
      const md = fs.readFileSync(path.join(dir, f), 'utf8');
      const why = g.frontMatterProblem(md, team) || g.bodyProblem(md, team);
      return why ? `${f}: ${why}` : null;
    }).filter(Boolean);
    assert.deepEqual(refused, []);
  });
});

describe('cost', () => {
  test('a large adversarial body is checked in linear time (SAGE runs this inside a request)', () => {
    const big = fm('', Array.from({ length: 20000 }, (_, i) => `reviewed word${i} by nobody in particular.`).join(' '));
    const t0 = Date.now();
    assert.equal(g.bodyProblem(big, TEAM), null);
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  });
});
