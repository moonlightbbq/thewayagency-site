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
 * Fix round 5: the review got credits past round 4 with a fourth word before
 * "by" ("reviewed for accuracy and compliance by"), in active voice, with a
 * name and no "by", with an honorific and a surname, and split across a line
 * break the page prints as a space (in a paragraph, and in an FAQ answer and
 * its JSON-LD). Those are fixtures below too. And who the byline names is no
 * longer a reason to refuse a post (a team.json edit took live posts down).
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
  // A synthetic member with an ordinary first name and surname, for the
  // name-anywhere and honorific rules (fix round 5).
  { name: 'Synthia Testerly', slug: 'synthia-testerly', title: 'Licensed Agent', license_states: ['KY'] },
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
    ['an unsafe slug', set('slug', 'x/../y'), /lower-case letters/],
    ['an unsafe author_slug', set('author_slug', 'x"y'), /lower-case letters/],
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
  const member = { slug: 'test-author-q', name: 'Test Author Q', title: 'Client Care Specialist' };
  test('the member author_slug names, with team.json\'s name and title, whatever author and author_title say (they are never printed)', () => {
    for (const meta of [{ author_slug: 'test-author-q', author: 'Test Author Q', author_title: 'Client Care Specialist' }, { author_slug: 'test-author-q' },
      { author_slug: 'test-author-q', author: 'Test Reviewer A' }, { author_slug: 'test-author-q', author_title: 'Licensed Agent' },
      { author_slug: 'test-author-q', author: ['Test Author Q'] }]) {
      assert.deepEqual(g.bylineAuthor(meta, TEAM), member, JSON.stringify(meta));
    }
  });
  test('no member: the agency (null)', () => {
    for (const meta of [{}, { author: 'Test Reviewer A' }, { author_slug: 'test-nobody' }, { author_slug: 'x"y' }, { author_slug: ['test-author-q'] }]) {
      assert.equal(g.bylineAuthor(meta, TEAM), null, JSON.stringify(meta));
    }
  });
});

describe('bylineProblem: what a BL-06 promote refuses in new text, and the renderer only warns about (fix round 5)', () => {
  for (const [label, md, why] of [
    ['an author that is not the author_slug member', set('author', 'Test Reviewer A'), /author is not the name data\/team\.json gives test-author-q/],
    ['an author_title that is not the member\'s', set('author_title', 'Licensed Agent'), /author_title is not the title data\/team\.json gives test-author-q/],
    ['an author_slug that names no member', set('author_slug', 'test-nobody'), /author_slug "test-nobody" names no data\/team\.json member/],
  ]) {
    test(label, () => {
      assert.match(String(g.bylineProblem(md, TEAM)), why);
      assert.equal(g.frontMatterProblem(md, TEAM), null, 'never a reason not to publish or render');
    });
  }
  test('no author_slug, or a consistent one: nothing to say', () => {
    assert.equal(g.bylineProblem(fm(), TEAM), null);
    assert.equal(g.bylineProblem(fm().replace(/author_slug: .*\n/, ''), TEAM), null);
  });
});

describe('fix round 5: front matter, a credit word beside an identity, in any order and at any distance', () => {
  for (const [key, value] of [
    // The review's four values (synthetic names).
    ['cta_text', 'Every answer here was reviewed for accuracy and compliance by Synthia Testerly, Licensed Agent.'],
    ['cta_title', 'Review: Synthia Testerly, Agency Principal'],
    ['title', 'Licensed Agent Synthia Testerly Reviewed This Kentucky Flood Guide'],
    ['description', 'Agency Principal Synthia Testerly personally reviewed every line of this guide.'],
    // Their neighbours.
    ['description', 'Reviewed for accuracy, compliance and clarity by someone we trust.'],
    ['title', 'Synthia signed off on this guide'],
    ['title', 'A Testerly-approved flood guide'],
    ['title', 'Annual review: Ms. Testerly'],
    ['title', 'Licensed-agent approved flood guide'],
    ['title', 'Expert-reviewed: flood insurance'],
    ['image_alt', 'Our staff checked every figure'],
    ['cta_text', 'Verified line by line: The Way Agency'],
    ['description', 'Producer-vetted advice for Kentucky drivers.'],
    ['title', 'Edited by a principal'],
  ]) {
    test(`${key}: ${value}`, () => {
      const md = fm().includes(`\n${key}: `) ? set(key, value) : fm(`${key}: ${value}\n`);
      assert.match(String(g.frontMatterProblem(md, TEAM)), /review or approval credit/);
    });
  }
});

describe('fix round 5: the body, a sentence with a credit word and a team member\'s name, and a credit across a line break', () => {
  for (const sentence of [
    'This guide was reviewed for accuracy and compliance by Synthia Testerly, Licensed Agent.',
    'Synthia Testerly, Licensed Agent, reviewed and approved this guide.',
    'Synthia Testerly reviewed this article.',
    'Synthia reviewed this article.',
    'Every figure here was checked twice; Synthia Testerly did the checking.',
    'Reviewed by Ms. Testerly, Agency Principal',
    'Reviewed by Mrs. Testerly',
    'This guide was reviewed for accuracy and compliance by our licensed agents.',
    'This article was reviewed\nby Synthia Testerly, Agency Principal / Licensed Agent, on September 1, 2026.',
    'Reviewed by\nSynthia Testerly, Agency Principal / Licensed Agent.',
    '> This guide was reviewed\n> by Synthia Testerly.',
    '### FAQ: Who checks this?\n\nReviewed\nby Synthia Testerly, Agency Principal / Licensed Agent.',
    '### FAQ: Who checks this?\n\nReviewed\n\nby Synthia Testerly, Licensed Agent.',
    'R e v i e w e d\nb y  S y n t h i a  T e s t e r l y',
  ]) {
    test(sentence.replace(/\s+/g, ' ').slice(0, 70), () => {
      assert.match(String(g.bodyProblem(fm('', `${body}\n\n${sentence}\n`), TEAM)), /review or approval credit/);
    });
  }

  test('bodyViews: the body as written, with in-paragraph breaks folded, and each FAQ question and answer as printed', () => {
    const views = g.bodyViews(fm('', 'One\ntwo\n\n- a\n- b\n\n> q1\n> q2\n\n### FAQ: Q?\n\nA1\n\nA2\n'));
    assert.equal(views[1], '\nOne two\n\n- a\n- b\n\n> q1 q2\n\n### FAQ: Q?\n\nA1\n\nA2\n\n');
    assert.deepEqual(views.slice(2), ['Q?', 'A1  A2']);
  });
});

describe('fix round 5: contrasts that must keep passing', () => {
  for (const [label, md] of [
    ['a live description: "your independent agent ... coverage reviews"', set('description', 'Your policy renewal isn\'t automatic. Here\'s what your independent agent actually does behind the scenes — from rate analysis to carrier shopping to coverage reviews.')],
    ['a service beside an identity in a CTA', fm('cta_text: Ask your agent for a free coverage review, or a premium audit walkthrough.\n')],
    ['a slug is a path, not a sentence', set('slug', 'what-your-agent-checks')],
    ['a heading, then a paragraph', fm('', `${body}\n\n## Reviewed\n\nby the numbers, rates rose.\n`)],
    ['list items stay apart', fm('', `${body}\n\n- Item one\n- Reviewed claims pay faster\n`)],
    ['a surname alone in the body is a place name here', fm('', `${body}\n\nTesterly County homes were inspected by the county.\n`)],
    ['a name with no credit word', fm('', `${body}\n\nSynthia Testerly answers the phone on Saturdays.\n`)],
    ['a name in one sentence, a credit word in the next', fm('', `${body}\n\nCall Synthia Testerly. Rates are approved by the Kentucky DOI.\n`)],
  ]) {
    test(label, () => assert.equal(problem(md), null));
  }
});

describe('the live posts', () => {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'team.json'), 'utf8'));
  const team = Array.isArray(t) ? t : t.team;
  const dir = path.join(ROOT, 'src', 'blog');
  const refusedWith = (members) => fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    const why = g.frontMatterProblem(md, members) || g.bodyProblem(md, members);
    return why ? `${f}: ${why}` : null;
  }).filter(Boolean);

  test('every src/blog/*.md passes against data/team.json (nothing on the site goes dark)', () => {
    assert.deepEqual(refusedWith(team), []);
  });

  test('...and still passes after a member\'s title changes and another member leaves (fix round 5)', () => {
    // Round 4 refused every post whose author or author_title no longer
    // matched: one title change and one offboarding took 15 live URLs to 404.
    assert.ok(team.length >= 2);
    const edited = [{ ...team[0], title: 'SYNTHETIC New Title' }, ...team.slice(2)];
    assert.deepEqual(refusedWith(edited), []);
    assert.deepEqual(refusedWith([]), []);
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
