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
 * Scope decision (after fix round 5): free text can always claim a review,
 * and each tighter wording rule took more legitimate posts down ("Check with
 * your agent" in a title). So the wording rules now WARN (reviewWordingWarnings:
 * the field and the exact text), and only the deterministic rules refuse
 * (frontMatterProblem: markup, characters outside the allowed set, unsafe
 * slugs, dates and reading_time). The fixtures of rounds 4 and 5 stay below:
 * each must still be flagged, and none may refuse a post any more.
 *
 * Fix round 1 after the scope decision: an arrow in a live post's title, and
 * "reading_time: 7 minutes", still took posts off the site. Only characters
 * that print as nothing or reorder text (control, format, bidi, invisible,
 * line separators, noncharacters) refuse now; look-alike, full-width,
 * combining and other printable characters render and, when they spell a
 * credit, are flagged. reading_time never refuses: the renderer prints the
 * computed time for a value that is not "N min" or "N min read". The
 * structured credit is pinned elsewhere (render-review-gate.test.js): it
 * prints only from a signed approval.
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
const warnings = (md) => g.reviewWordingWarnings(md, TEAM);
const CREDIT = 'Test Reviewer A, Agency Principal / Licensed Agent on September 30, 2026';

/** The post is not refused, and the wording is flagged in `field` with its exact text. */
function flagged(md, field, text) {
  assert.equal(g.frontMatterProblem(md), null, 'wording never refuses a post');
  const w = warnings(md);
  assert.ok(w.length > 0, `no warning for ${JSON.stringify(text)}`);
  if (field) assert.ok(w.some((x) => x.field === field), `no warning in ${field}: ${JSON.stringify(w)}`);
  if (text) assert.ok(w.some((x) => x.text === text), `no warning carries the exact text ${JSON.stringify(text)}: ${JSON.stringify(w)}`);
  for (const x of w) assert.equal(typeof x.wording, 'string');
  return w;
}

describe('deterministic rules: front matter that does not publish or render', () => {
  const UNSAFE = /invisible, control or bidi character/;
  for (const [label, md, why] of [
    ['(b) a soft hyphen in author_title', set('author_title', `Licensed Agent | Re\u00ADviewed by ${CREDIT}`), UNSAFE],
    ['(b) a zero-width space in author_title', set('author_title', `Client Care Specialist, The Way Agency | Re\u200Bviewed by ${CREDIT}`), UNSAFE],
    ['a zero-width joiner between letters (not in an emoji)', set('title', 'SYNTHETIC Re\u200Dviewed guide'), UNSAFE],
    ['a word joiner', set('title', 'SYNTHETIC\u2060guide'), UNSAFE],
    ['a byte-order mark inside a value (a leading one is trimmed, as the renderer trims it)', set('title', 'SYNTHETIC\uFEFFguide'), UNSAFE],
    ['a bidi override', set('title', 'SYNTHETIC \u202Eyb deweiveR'), UNSAFE],
    ['a bidi isolate', set('title', 'SYNTHETIC \u2067guide\u2069'), UNSAFE],
    ['a right-to-left mark', set('title', 'SYNTHETIC\u200F guide'), UNSAFE],
    ['a line separator', set('title', 'SYNTHETIC\u2028guide'), UNSAFE],
    ['a tab (a control character)', set('title', 'SYNTHETIC\tguide'), UNSAFE],
    ['a C1 control character', set('title', 'SYNTHETIC\u0085guide'), UNSAFE],
    ['a noncharacter (invalid in the RSS feed)', set('title', 'SYNTHETIC guide\uFFFF'), UNSAFE],
    ['a Hangul filler (an invisible letter)', set('title', 'SYNTHETIC\u3164guide'), UNSAFE],
    ['a variation selector outside an emoji', set('title', 'SYNTHETIC gui\uFE0Fde'), UNSAFE],
    ['a tag character outside a flag', set('title', 'SYNTHETIC \u{E0041}guide'), UNSAFE],
    ['an invisible character in a key', fm('ti\u200Btle: SYNTHETIC\n'), UNSAFE],
    ['an unsafe slug', set('slug', 'x/../y'), /lower-case letters/],
    ['an unsafe author_slug', set('author_slug', 'x"y'), /lower-case letters/],
    ['a date that is not YYYY-MM-DD', set('date', 'Reviewed by Test Reviewer A'), /YYYY-MM-DD/],
    ['markup', set('title', 'x</h1><span>Reviewed by Test Reviewer A</span>'), /'<' or '>'/],
  ]) {
    test(label, () => assert.match(String(g.frontMatterProblem(md)), why));
  }
});

describe('fix round 1 after the scope decision: printable characters and reading_time never refuse a post', () => {
  // An arrow appended to a live post's title took it off the site, and so did
  // "reading_time: 7 minutes": both rules were wording defences, and wording
  // is now a warning. Only characters that print as nothing or reorder the
  // text still refuse (above).
  for (const [label, md] of [
    ['an arrow in a title', set('title', 'Term life vs. whole life →')],
    ['an emoji in a title', set('title', 'Storm season 🌪 is here')],
    ['an emoji with a presentation selector', set('title', '⚠\uFE0F Storm season checklist')],
    ['an emoji ZWJ sequence', set('title', 'Coverage for the whole 👨\u200D👩\u200D👧 family')],
    ['an emoji with a skin tone and a joiner', set('title', 'Working from home 🧑🏽\u200D💻')],
    ['a keycap emoji', set('title', '1\uFE0F\u20E3 First steps')],
    ['a subdivision flag', set('title', 'Travel to 🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} Scotland')],
    ['a regional-indicator flag', set('title', '🇺🇸 Independence Day safety')],
    ['check marks and comparison signs', set('description', '✓ ✔\uFE0F ✅ Deductibles ≤ $500 or ≥ $1,000 ★')],
    ['another script', set('description', 'Seguro de auto — 日本語 — Ελληνικά')],
    ['a no-break space and accents', set('title', 'Café\u00A0owners’ guide')],
    ['"reading_time: 7 minutes" (the renderer prints the computed time)', fm('reading_time: 7 minutes\n')],
    ['"reading_time: about 6 min read"', fm('reading_time: about 6 min read\n')],
  ]) {
    test(label, () => {
      assert.equal(g.frontMatterProblem(md), null);
      assert.deepEqual(warnings(md), []);
    });
  }

  // Round 4 refused these as look-alike, full-width or combining characters
  // that hid a credit from the wording rules. The wording rules fold them,
  // so each is still flagged, with its exact text; none refuses the post.
  for (const [label, md, field, text] of [
    ['(a) a Cyrillic look-alike in reading_time', fm(`reading_time: Rеviewed by ${CREDIT} | 6 min read\n`), 'reading_time', `Rеviewed by ${CREDIT} | 6 min read`],
    ['(c) full-width letters in author_title', set('author_title', `Ｒｅｖｉｅｗｅｄ by ${CREDIT}`), 'author_title', `Ｒｅｖｉｅｗｅｄ by ${CREDIT}`],
    ['a combining mark in a title', set('title', 'Réviewed by Test Reviewer A'), 'title', 'Réviewed by Test Reviewer A'],
    ['mathematical letters in a title', set('title', '𝐑𝐞𝐯𝐢𝐞𝐰𝐞𝐝 by Test Reviewer A'), 'title', '𝐑𝐞𝐯𝐢𝐞𝐰𝐞𝐝 by Test Reviewer A'],
    ['a credit in reading_time', fm('reading_time: 6 min read | Approved by Test Reviewer A\n'), 'reading_time', '6 min read | Approved by Test Reviewer A'],
  ]) {
    test(`${label}: flagged, not refused`, () => flagged(md, field, text));
  }
});

describe('wording: "(d) Approved by" in a byline field is flagged, not refused (author_title is never printed)', () => {
  test('author_title: Approved by ...', () => flagged(set('author_title', `Approved by ${CREDIT}`), 'author_title', `Approved by ${CREDIT}`));
});

describe('wording: a credit in ANY value the page prints is flagged with its key and exact text, never refused', () => {
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
      flagged(md, key, value);
    });
  }
});

describe('wording: a credit in the body naming the team, the agency or a licensed agent is flagged, never refused', () => {
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
      const w = flagged(fm('', `${sentence}\n\n${body}`));
      assert.ok(w.every((x) => x.field === 'body' || x.field === 'FAQ'), JSON.stringify(w));
    });
  }
});

describe('contrasts: no refusal and no warning', () => {
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
    test(label, () => {
      assert.equal(g.frontMatterProblem(md), null);
      assert.deepEqual(warnings(md), []);
    });
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
      assert.equal(g.frontMatterProblem(md), null, 'never a reason not to publish or render');
    });
  }
  test('no author_slug, or a consistent one: nothing to say', () => {
    assert.equal(g.bylineProblem(fm(), TEAM), null);
    assert.equal(g.bylineProblem(fm().replace(/author_slug: .*\n/, ''), TEAM), null);
  });
});

describe('fix round 5 fixtures, front matter: a credit word beside an identity, in any order and at any distance, is flagged', () => {
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
      flagged(md, key, value);
    });
  }
});

describe('fix round 5 fixtures, the body: a sentence with a credit word and a team member\'s name, and a credit across a line break, are flagged', () => {
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
      flagged(fm('', `${body}\n\n${sentence}\n`));
    });
  }

  test('bodyViews: the body as written, with in-paragraph breaks folded, and each FAQ question and answer as printed', () => {
    const views = g.bodyViews(fm('', 'One\ntwo\n\n- a\n- b\n\n> q1\n> q2\n\n### FAQ: Q?\n\nA1\n\nA2\n'));
    assert.equal(views[1], '\nOne two\n\n- a\n- b\n\n> q1 q2\n\n### FAQ: Q?\n\nA1\n\nA2\n\n');
    assert.deepEqual(views.slice(2), ['Q?', 'A1  A2']);
  });
});

describe('fix round 5: contrasts, no refusal and no warning', () => {
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
    test(label, () => {
      assert.equal(g.frontMatterProblem(md), null);
      assert.deepEqual(warnings(md), []);
    });
  }
});

describe('the scope decision: wording that used to take a post down only warns', () => {
  // Round 5's own residual-risk list: ordinary advice in a title,
  // description or CTA, and a first name beside a credit word in the body.
  for (const [label, md, field, text] of [
    ['"Check with your agent" in a title', set('title', 'Check with your agent before you renew'), 'title', 'Check with your agent before you renew'],
    ['"Verify coverage with a licensed agent" in a description', set('description', 'Verify coverage with a licensed agent.'), 'description', 'Verify coverage with a licensed agent.'],
    ['"Ask your agent to check your coverage" in a CTA', fm('cta_text: Ask your agent to check your coverage.\n'), 'cta_text', 'Ask your agent to check your coverage.'],
    ['a first name beside a credit word in the body', fm('', `${body}\n\nCall Synthia to review your policy.\n`), 'body', 'Call Synthia to review your policy.'],
  ]) {
    test(label, () => flagged(md, field, text));
  }

  test('a warning carries the exact text as written (case, accents and markdown kept), narrowed to its sentence', () => {
    const md = fm('', `Intro sentence one. Synthia Testerly **reviewed** this article. Another sentence here.\n\n${body}`);
    assert.deepEqual(warnings(md), [{ field: 'body', text: 'Synthia Testerly **reviewed** this article.', wording: 'synthia testerly reviewed this article' }]);
  });

  test('one warning per passage, though the body is read in overlapping views', () => {
    const md = fm('', `${body}\n\nThis article was reviewed\nby Synthia Testerly, Licensed Agent.\n\n### FAQ: Who checks this?\n\nReviewed\n\nby Synthia Testerly, Licensed Agent.\n`);
    assert.deepEqual(warnings(md).map((w) => [w.field, w.text]), [
      ['body', 'This article was reviewed by Synthia Testerly, Licensed Agent.'],
      ['FAQ', 'Reviewed by Synthia Testerly, Licensed Agent.'],
    ]);
  });

  test('every flagged sentence of a paragraph is listed, up to 50 warnings', () => {
    const md = fm('', `${body}\n\nSynthia Testerly reviewed this guide. Rates rose. Every figure was checked by Synthia Testerly.\n`);
    assert.deepEqual(warnings(md).map((w) => w.text), ['Synthia Testerly reviewed this guide.', 'Every figure was checked by Synthia Testerly.']);
    const many = fm('', Array.from({ length: 80 }, (_, i) => `Synthia Testerly reviewed part ${i}.`).join(' '));
    assert.equal(warnings(many).length, 50);
  });

  test('a long passage is cut at 500 characters', () => {
    const long = `Reviewed by Synthia Testerly ${'x'.repeat(800)}`;
    const [w] = warnings(fm(`cta_text: ${long}\n`));
    assert.equal(w.text.length, 500);
    assert.ok(w.text.endsWith('...'));
  });

  test('the notice SAGE and the build show with every warning', () => {
    assert.equal(g.REVIEW_WORDING_NOTICE, 'This text contains review-credit wording; only the signed byline is a verified credit.');
  });
});

describe('the live posts', () => {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'team.json'), 'utf8'));
  const team = Array.isArray(t) ? t : t.team;
  const dir = path.join(ROOT, 'src', 'blog');
  const files = () => fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
  const refused = () => files().map(([f, md]) => {
    const why = g.frontMatterProblem(md);
    return why ? `${f}: ${why}` : null;
  }).filter(Boolean);

  test('no src/blog/*.md breaks a deterministic rule (nothing on the site goes dark)', () => {
    assert.deepEqual(refused(), []);
  });

  test('a data/team.json edit cannot take a post down: no rule that refuses reads the team (fix round 5, and the scope decision)', () => {
    // Round 4 refused every post whose author or author_title no longer
    // matched: one title change and one offboarding took 15 live URLs to 404.
    // The wording rules read the team, and since the scope decision they only warn.
    assert.equal(g.frontMatterProblem.length, 1);
    assert.ok(team.length >= 2);
    for (const [, md] of files()) {
      assert.doesNotThrow(() => g.reviewWordingWarnings(md, [{ ...team[0], title: 'SYNTHETIC New Title' }, ...team.slice(2)]));
      assert.doesNotThrow(() => g.reviewWordingWarnings(md, []));
    }
  });
});

describe('cost', () => {
  test('a large adversarial body is read in linear time (SAGE runs this inside a request)', () => {
    const big = fm('', Array.from({ length: 20000 }, (_, i) => `reviewed word${i} by nobody in particular.`).join(' '));
    const t0 = Date.now();
    assert.deepEqual(warnings(big), []);
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  });

  test('...and so is one where every sentence is flagged', () => {
    const big = fm('', Array.from({ length: 5000 }, (_, i) => `Synthia Testerly reviewed part ${i}.`).join(' '));
    const t0 = Date.now();
    assert.equal(warnings(big).length, 50);
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  });
});
