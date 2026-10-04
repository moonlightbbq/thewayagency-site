/**
 * Slot filling: which candidate gets committed to a date, and why.
 *
 * The load-bearing property is that seasonality is a HARD FILTER, not a score.
 * The 2026-05-02 re-pace put a winter driving guide on 2026-08-19 because
 * dates were assigned by list position with nothing checking season. No
 * ranking signal may ever override that filter again, which is what the first
 * suite below pins.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const q = require('../scripts/lib/content-queue');

// 2026-08-01 is a Saturday. From here 08-12 (Wed) is 11d out and 08-15 (Sat)
// is 14d, so both sit inside the [MIN_LOCK_LEAD_DAYS, LOCK_DAYS] window that
// fillSlots is allowed to touch.
const TODAY = '2026-08-01';
const NEAR = '2026-08-12';   // 11d
const NEXT = '2026-08-15';   // 14d
const WINDOWS = {
  'winter-prep': [9, 10],       // Oct-Nov
  'back-to-school': [6, 7],     // Jul-Aug
  'spring-storms': [1, 2],      // Feb-Mar
};
const hasDraft = () => true;
const noDraft = () => false;

function candidate(over = {}) {
  return {
    slug: 'a-candidate',
    title: 'A Candidate',
    primary_keyword: 'commercial umbrella limits',
    status: 'approved',
    seasonality_window: null,
    target_location_pages: [],
    ...over,
  };
}
function calendar({ posts = [], slots = [], existing = [] } = {}) {
  return { year1: posts, slots, existing_posts: existing };
}
const ctxFor = (cal) => q.buildSchedulingContext(cal);

describe('seasonality is a hard filter, never a score', () => {
  test('a winter post is rejected for an August slot however well it scores', () => {
    const winter = candidate({
      slug: 'winter-driving-auto-insurance-kentucky',
      seasonality_window: 'winter-prep',
      // Everything else about it is maximally attractive.
      target_location_pages: ['/insurance/owensboro-ky.html'],
      related_cluster: 'brand-new-cluster',
    });
    const r = q.scoreCandidate(winter, '2026-08-19', ctxFor(calendar()), WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(r.eligible, false);
    assert.match(r.reasons[0], /out of season/);
  });

  test('the same post is eligible on its real date', () => {
    const winter = candidate({ seasonality_window: 'winter-prep' });
    const r = q.scoreCandidate(winter, '2026-12-02', ctxFor(calendar()), WINDOWS, { hasMarkdown: noDraft });
    assert.equal(r.eligible, true);
  });

  test('fillSlots will leave a slot EMPTY rather than place an out-of-season post', () => {
    const cal = calendar({ slots: [{ date: NEAR, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ seasonality_window: 'winter-prep' })] };
    const { locked, skipped } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(locked.length, 0);
    assert.equal(skipped.length, 1);
    assert.equal(cal.year1.length, 0, 'nothing may be scheduled');
  });
});

describe('approval is required', () => {
  for (const status of ['proposed', 'on-hold', 'rejected']) {
    test(`a "${status}" candidate is never placed`, () => {
      const r = q.scoreCandidate(candidate({ status }), NEAR, ctxFor(calendar()), WINDOWS, { hasMarkdown: hasDraft });
      assert.equal(r.eligible, false);
      assert.match(r.reasons[0], new RegExp(status));
    });
  }
});

describe('cannibalization', () => {
  test('rejects a candidate that overlaps an existing keyword', () => {
    const cal = calendar({
      existing: [{ slug: 'flood-insurance-ohio-river-valley-2026', primary_keyword: 'flood insurance kentucky', status: 'published' }],
    });
    const dupe = candidate({ slug: 'flood-insurance-kentucky', primary_keyword: 'flood insurance kentucky' });
    const r = q.scoreCandidate(dupe, NEAR, ctxFor(cal), WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(r.eligible, false);
    assert.match(r.reasons[0], /cannibalizes/);
  });

  test('allows genuinely distinct trades that share boilerplate words', () => {
    const cal = calendar({
      existing: [{ slug: 'hvac', primary_keyword: 'HVAC contractor insurance kentucky', status: 'published' }],
    });
    const roofing = candidate({ slug: 'roofing', primary_keyword: 'roofing contractor insurance kentucky' });
    const r = q.scoreCandidate(roofing, NEAR, ctxFor(cal), WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(r.eligible, true, 'distinct trades must not be treated as duplicates');
  });

  test('a candidate never cannibalizes itself', () => {
    const cal = calendar({ posts: [{ slug: 'self', primary_keyword: 'commercial umbrella limits', status: 'published' }] });
    const self = candidate({ slug: 'self' });
    assert.equal(q.cannibalizationConflict(self, ctxFor(cal)), null);
  });
});

describe('cannibalization sees short codes, numbers and states', () => {
  // Until 2026-10-04 the tokenizer dropped every word of 1-2 characters and
  // split "$25,000" into "25" and "000", so these pairs read as one search and
  // the queue could refuse a topic SAGE had correctly proposed as distinct
  // (sage-server hive/lib/topic-intent.js reads keywords the same way). The
  // published keywords below are the site's own public topics.
  const KY_AUTO_REQ = { slug: 'kentucky-auto-insurance-guide', primary_keyword: 'auto insurance requirements kentucky' };
  const conflict = (kw, existingKw) => q.cannibalizationConflict(
    candidate({ slug: 'the-candidate', primary_keyword: kw }),
    ctxFor(calendar({ posts: [{ slug: 'the-existing-post', primary_keyword: existingKw, status: 'published' }] })));
  const score = (a, b) => q.jaccard(q.tokenize(a), q.tokenize(b));

  describe('different searches are scheduled', () => {
    const DISTINCT = [
      // a code only one keyword names (it scored 1.00)
      ['SR-22 auto insurance requirements kentucky', KY_AUTO_REQ.primary_keyword],
      ['SR22 auto insurance requirements', KY_AUTO_REQ.primary_keyword],
      ['SR 22 auto insurance requirements Kentucky', KY_AUTO_REQ.primary_keyword],
      // one city name in two states (it scored 1.00)
      ['home insurance Clarksville IN', 'home insurance Clarksville TN'],
      ['home insurance Clarksville TN', 'home insurance Clarksville IN'],
      ['home insurance Franklin KY', 'home insurance Franklin TN'],
      // a state by name: the queue refused these at 0.67
      ['auto insurance requirements tennessee', KY_AUTO_REQ.primary_keyword],
      ['Indiana auto insurance requirements', KY_AUTO_REQ.primary_keyword],
      // policy forms (both read as "homeowners policy")
      ['HO-3 homeowners policy kentucky', 'HO-5 homeowners policy kentucky'],
      ['HO-3 vs HO-5 homeowners insurance', 'homeowners insurance kentucky'],
      ['HO-3 vs HO-5 homeowners insurance', 'HO-3 vs HO-8 homeowners insurance'],
      // Medicare plans and parts (both read as "medicare plan")
      ['medicare plan G', 'medicare plan N'],
      ['Medicare Part A explained', 'Medicare Part D explained'],
      ['medicare supplement plan G kentucky', 'medicare supplement plans kentucky'],
      // amounts ("$25,000" read as "000")
      ['$25,000 final expense insurance', '$10,000 final expense insurance'],
      ['$250,000 life insurance', '$25,000 life insurance'],
      // other short codes
      ['E&O insurance for real estate agents', 'GL insurance for real estate agents'],
      ['RV insurance requirements kentucky', KY_AUTO_REQ.primary_keyword],
      // numbers that are not counts of list items stay subjects
      ['health insurance small business less than 10 employees kentucky', 'health insurance small business less than 50 employees kentucky'],
      ['10 employees group health insurance', 'group health insurance for employees'],
      ['250/500/100 auto insurance', '100/300/100 auto insurance'],
      ['flood insurance 42301', 'flood insurance 42302'],
      // split limits are one subject, never three numbers or counts
      ['liability limits 50/100/50 options', 'liability limits 50/100/25 options'],
      ['25/50/25 coverage options', '50/50/25 coverage options'],
      // a number before a unit or a quantity, even in a list keyword
      ['16 year old driver insurance tips', '18 year old driver insurance tips'],
      ['10 employees health insurance options kentucky', '50 employees health insurance options kentucky'],
      // a number after a label names a thing
      ['section 8 landlord insurance tips', 'landlord insurance tips'],
      ['type 1 diabetes life insurance tips', 'type 2 diabetes life insurance tips'],
      ['class 8 truck insurance tips', 'class 7 truck insurance tips'],
    ];
    for (const [a, b] of DISTINCT) {
      test(`"${a}" is not "${b}"`, () => {
        assert.equal(conflict(a, b), null);
        assert.equal(conflict(b, a), null, 'either way round');
      });
    }

    test('the SR-22 topic is eligible next to the Kentucky auto requirements guide', () => {
      const cal = calendar({ existing: [{ ...KY_AUTO_REQ, status: 'published' }] });
      const sr22 = candidate({ slug: 'sr-22-insurance-kentucky', primary_keyword: 'SR-22 auto insurance requirements kentucky' });
      const r = q.scoreCandidate(sr22, NEAR, ctxFor(cal), WINDOWS, { hasMarkdown: hasDraft });
      assert.equal(r.eligible, true, r.reasons.join('; '));
    });
  });

  describe('real duplicates are still refused', () => {
    // Every pair the queue refused among the 99 keywords ever on the site's
    // calendar or backlog (git history to 2026-10-04), at the same score.
    const REFUSED_TODAY = [
      ['medicare open enrollment kentucky', 'medicare open enrollment 2027 kentucky', 0.75],
      ['medicare open enrollment kentucky', 'medicare enrollment kentucky', 0.67],
      ['boat insurance', 'boat insurance kentucky', 1],
      ['personal auto vs commercial auto insurance', 'commercial auto insurance kentucky', 0.67],
      ['insurance policy renewal process', 'insurance renewal process Kentucky', 0.67],
    ];
    for (const [a, b, s] of REFUSED_TODAY) {
      test(`"${a}" is "${b}" (${s})`, () => {
        const c = conflict(a, b);
        assert.ok(c, 'must be refused');
        assert.equal(c.slug, 'the-existing-post');
        assert.equal(c.score.toFixed(2), s.toFixed(2));
        assert.ok(conflict(b, a), 'either way round');
      });
    }

    // The same code, number or state written another way is the same search.
    const SAME = [
      ['SR22 insurance requirements', 'SR-22 insurance requirements kentucky'],
      ['medicare supplement Plan G', 'Medicare supplement plan g Kentucky'],
      ['$25,000 final expense', '$25000 final expense'],
      ['home insurance Clarksville TN', 'Clarksville, Tennessee home insurance'],
      ['home insurance Carmel IN', 'home insurance carmel indiana'],
      ['E & O insurance for realtors', 'E&O insurance for realtors'],
      // a keyword that names no state is a Kentucky search
      ['flood insurance', 'flood insurance kentucky'],
      ['flood insurance louisville', 'flood insurance louisville KY'],
      // lower-case "in" is the preposition, not Indiana
      ['flood insurance in louisville', 'flood insurance louisville ky'],
      // Mount/Mt., 401(k) and accents fold
      ['cheap car insurance in mount washington ky', 'cheap car insurance Mt. Washington'],
      ['401(k) vs life insurance', '401k vs life insurance'],
      ['café insurance louisville', 'cafe insurance louisville'],
      // a count of list items is not a subject: "10 home insurance tips" is
      // "home insurance tips" (a number after "top", before a list word, or
      // leading a keyword that has a list word)
      ['10 home insurance tips', 'home insurance tips'],
      ['5 ways to lower car insurance kentucky', 'ways to lower car insurance kentucky'],
      ['7 winter driving tips kentucky', 'winter driving insurance tips kentucky'],
      ['5 common home insurance mistakes', '7 common home insurance mistakes'],
      ['home insurance: 7 mistakes to avoid', 'home insurance mistakes to avoid'],
      ['10 best car insurance companies kentucky', 'best car insurance companies kentucky'],
      // the keyword's first number, not only its first word
      ['the 7 most common home insurance mistakes', '7 most common home insurance mistakes'],
      ['the 5 biggest home insurance mistakes', '5 biggest home insurance mistakes'],
      ['the 10 best car insurance companies kentucky', '10 best car insurance companies kentucky'],
      ['kentucky homeowners: 7 common mistakes', '7 common mistakes kentucky homeowners'],
      // "best 10" reads like "top 10"
      ['best 10 car insurance companies kentucky', '10 best car insurance companies kentucky'],
      // split limits and 401(k) written another way
      ['50/100/50 liability limits', 'liability limits 50/100/50'],
      ['life insurance vs 401k', '401(k) vs life insurance'],
    ];
    for (const [a, b] of SAME) {
      test(`"${a}" is "${b}"`, () => {
        assert.equal(score(a, b), 1);
        assert.ok(conflict(a, b));
      });
    }

    test('"top 10" drops the count and keeps "top", as the test always read it', () => {
      assert.equal(score('top 10 home insurance tips kentucky', 'home insurance tips kentucky').toFixed(2), '0.67');
      assert.ok(conflict('top 10 home insurance tips kentucky', 'home insurance tips kentucky'));
    });

    test('a count after an ordinary word is dropped and the word kept, as the test always read it', () => {
      // "our" is not a stopword: 0.75 on origin/main too
      assert.equal(score('our 5 favorite home insurance discounts', '5 favorite home insurance discounts'), 0.75);
      assert.ok(conflict('our 5 favorite home insurance discounts', '5 favorite home insurance discounts'));
    });

    test('split limits are one subject token', () => {
      assert.deepEqual([...q.tokenize('25/50/25 coverage options')], ['code:25/50/25', 'coverage', 'options']);
    });
  });

  describe('a state only one keyword names is a word only that one has', () => {
    // A keyword naming no state is read as Kentucky, but the test has no place
    // names: "nashville" without "tn" is still the Nashville search.
    const REFUSED = [
      ['home insurance nashville', 'home insurance nashville tn', 0.67],
      ['small business insurance nashville', 'small business insurance nashville tn', 0.75],
      ['home insurance evansville in', 'home insurance evansville indiana', 0.67],
      // The accepted price: a stateless keyword of 3+ words and its Tennessee
      // twin are refused too (the Kentucky keyword and the Tennessee one are not)
      ['auto insurance requirements', 'auto insurance requirements tennessee', 0.67],
    ];
    for (const [a, b, s] of REFUSED) {
      test(`"${a}" is "${b}" (${s})`, () => {
        assert.equal(score(a, b).toFixed(2), s.toFixed(2));
        assert.equal(score(b, a), score(a, b), 'either way round');
        assert.ok(conflict(a, b));
      });
    }

    test('a two-word stateless keyword and its Tennessee twin are scheduled (0.50)', () => {
      assert.equal(score('flood insurance', 'flood insurance tennessee'), 0.5);
      assert.equal(conflict('flood insurance', 'flood insurance tennessee'), null);
    });

    test('so is a one-word place keyword and its twin with the state (0.50; 1.00 on origin/main)', () => {
      assert.equal(score('nashville insurance', 'nashville tn insurance'), 0.5);
      assert.equal(conflict('nashville insurance', 'nashville tn insurance'), null);
      assert.equal(score('evansville insurance', 'evansville insurance IN'), 0.5);
      // one more shared word and the pair is one search again
      assert.equal(score('insurance agency nashville', 'insurance agency nashville tn').toFixed(2), '0.67');
    });

    test('Kentucky named on one side only is not counted', () => {
      assert.equal(score('auto insurance requirements', KY_AUTO_REQ.primary_keyword), 1);
    });
  });

  describe('accepted limits, read the same way as topic-intent.js', () => {
    test('"plan a <word>" reads as the Medigap code plana', () => {
      assert.ok(q.tokenize('plan a budget for home insurance').has('code:plana'));
      assert.equal(score('plan a budget for home insurance', 'budget for home insurance'), 0);
    });

    test('a dotted abbreviation is read letter by letter: "U.S." is not the stopword "us"', () => {
      assert.equal(score('U.S. flood insurance', 'US flood insurance'), 0);
    });

    test('IN in an all-capitals keyword is Indiana', () => {
      assert.equal(score('HOME INSURANCE IN LOUISVILLE', 'home insurance louisville ky'), 0);
      assert.equal(score('Home Insurance In Louisville', 'home insurance louisville ky'), 1);
    });
  });

  test('a year is still an ordinary word, not a subject of its own', () => {
    // "medicare open enrollment 2027" is the annual refresh of the same search
    assert.equal(score('medicare open enrollment 2027', 'medicare open enrollment'), 0.75);
  });

  test('a plain Set of words scores exactly as before (SAGE calls tokenize and jaccard directly)', () => {
    assert.equal(q.CANNIBALIZATION_THRESHOLD, 0.6);
    assert.equal(q.jaccard(new Set(['flood', 'owensboro']), new Set(['flood'])), 0.5);
    assert.equal(q.jaccard(new Set(['auto', 'requirements']), new Set(['auto', 'requirements'])), 1);
    assert.equal(q.jaccard(new Set(), new Set(['flood'])), 0);
    // a keyword of only stopwords and a state has nothing to compare
    assert.equal(score('kentucky insurance', 'insurance kentucky'), 0);
  });
});

describe('ranking prefers work already done', () => {
  test('a written draft outranks an unwritten one', () => {
    const written = candidate({ slug: 'written', primary_keyword: 'surety bonds explained' });
    const unwritten = candidate({ slug: 'unwritten', primary_keyword: 'certificates of insurance' });
    const ctx = ctxFor(calendar());
    const a = q.scoreCandidate(written, NEAR, ctx, WINDOWS, { hasMarkdown: s => s === 'written' });
    const b = q.scoreCandidate(unwritten, NEAR, ctx, WINDOWS, { hasMarkdown: s => s === 'written' });
    assert.ok(a.score > b.score, 'a ready draft should win');
    assert.ok(a.reasons.includes('draft already written'));
  });

  test('an uncovered location page is rewarded over a well-covered one', () => {
    const covered = '/insurance/owensboro-ky.html';
    const cal = calendar({
      posts: Array.from({ length: 6 }, (_, i) => ({
        slug: `p${i}`, primary_keyword: `topic ${i}`, status: 'published', target_location_pages: [covered],
      })),
    });
    const ctx = ctxFor(cal);
    const thin = q.scoreCandidate(
      candidate({ slug: 'thin', primary_keyword: 'aa bb cc', target_location_pages: ['/insurance/mt-washington-ky.html'] }),
      NEAR, ctx, WINDOWS, { hasMarkdown: noDraft });
    const fat = q.scoreCandidate(
      candidate({ slug: 'fat', primary_keyword: 'dd ee ff', target_location_pages: [covered] }),
      NEAR, ctx, WINDOWS, { hasMarkdown: noDraft });
    assert.ok(thin.score > fat.score, 'the uncovered market should be preferred');
    assert.ok(thin.reasons.some(r => /mt-washington/.test(r)));
  });
});

describe('fillSlots', () => {
  test('fills nearest-first and only inside the lock window', () => {
    const near = NEAR;
    const far = q.publishDatesWithin(TODAY, q.HORIZON_DAYS).at(-1); // beyond the lock window
    assert.ok(q.daysBetween(TODAY, far) > q.LOCK_DAYS);
    const cal = calendar({
      slots: [
        { date: far, state: 'reserved', locked_slug: null },
        { date: near, state: 'reserved', locked_slug: null },
      ],
    });
    const backlog = { candidates: [candidate({ slug: 'only-one' })] };
    const { locked } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(locked.length, 1);
    assert.equal(locked[0].date, near, 'the nearer slot must be filled first');
  });

  test('a locked candidate leaves the backlog and becomes a dated post', () => {
    const cal = calendar({ slots: [{ date: NEAR, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'moves' })] };
    q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(backlog.candidates.length, 0, 'must not remain a candidate');
    assert.equal(cal.year1.length, 1);
    assert.equal(cal.year1[0].slug, 'moves');
    assert.equal(cal.year1[0].status, 'planned');
    assert.equal(cal.slots[0].state, 'locked');
    assert.equal(cal.slots[0].locked_slug, 'moves');
  });

  test('never places the same candidate into two slots', () => {
    const cal = calendar({
      slots: [
        { date: NEAR, state: 'reserved', locked_slug: null },
        { date: NEXT, state: 'reserved', locked_slug: null },
      ],
    });
    const backlog = { candidates: [candidate({ slug: 'only-one' })] };
    const { locked, skipped } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(locked.length, 1);
    assert.equal(skipped.length, 1);
  });

  test('a second near-identical candidate is blocked by the one just locked', () => {
    const cal = calendar({
      slots: [
        { date: NEAR, state: 'reserved', locked_slug: null },
        { date: NEXT, state: 'reserved', locked_slug: null },
      ],
    });
    const backlog = {
      candidates: [
        candidate({ slug: 'flood-a', primary_keyword: 'flood insurance owensboro' }),
        candidate({ slug: 'flood-b', primary_keyword: 'flood insurance owensboro' }),
      ],
    };
    const { locked } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(locked.length, 1, 'the second must be rejected as a duplicate of the first');
  });

  test('the result passes the invariants it is supposed to satisfy', () => {
    const slots = q.publishDatesWithin(TODAY, q.HORIZON_DAYS)
      .map(date => ({ date, state: 'reserved', locked_slug: null }));
    const cal = calendar({ slots });
    // Genuinely distinct subject matter.
    const subjects = ['surety bonds', 'renters coverage', 'boat liability', 'workers compensation',
      'cyber breach', 'motorcycle storage', 'pet wellness', 'earthquake endorsement',
      'classic car agreed value', 'dental vision'];
    const backlog = {
      candidates: subjects.map((kw, i) => candidate({ slug: `c${i}`, primary_keyword: kw })),
    };
    q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    const { violations } = q.evaluateInvariants(cal, backlog, TODAY, { hasMarkdown: hasDraft });
    const ids = violations.map(v => v.id);
    assert.ok(!ids.includes('I2'), 'no slot inside the lock window should be left unlocked');
    assert.ok(!ids.includes('I3'), 'every locked slot must have its post');
  });
});

describe('reserveSlots', () => {
  test('is idempotent', () => {
    const cal = calendar();
    const first = q.reserveSlots(cal, TODAY);
    const count = cal.slots.length;
    const second = q.reserveSlots(cal, TODAY);
    assert.equal(second.added.length, 0);
    assert.equal(cal.slots.length, count);
    assert.ok(first.added.length > 0);
  });

  test('does not reserve a date a post already owns', () => {
    const cal = calendar({ posts: [{ slug: 'x', publish_date: NEAR, status: 'planned' }] });
    q.reserveSlots(cal, TODAY);
    assert.ok(!cal.slots.some(s => s.date === NEAR));
  });

  test('keeps a past LOCKED slot as evidence, drops a past reserved one', () => {
    const cal = calendar({
      slots: [
        { date: '2026-07-29', state: 'locked', locked_slug: 'committed-never-shipped' },
        { date: '2026-07-25', state: 'reserved', locked_slug: null },
      ],
    });
    q.reserveSlots(cal, TODAY);
    assert.ok(cal.slots.some(s => s.date === '2026-07-29'), 'a past locked slot is evidence');
    assert.ok(!cal.slots.some(s => s.date === '2026-07-25'), 'a past reserved slot is noise');
  });
});

describe('a slot nearer than D-10 is never filled: nothing publishes without its reviewer\'s approval (owner decision 2026-10-02)', () => {
  // 2026-08-05 is 4d from TODAY, inside the reviewer's D-10 lead time.
  const TOO_CLOSE = '2026-08-05';

  test('the slot is left empty and the reason is reported', () => {
    const cal = calendar({ slots: [{ date: TOO_CLOSE, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'ready' })] };
    const { locked, skipped } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(locked.length, 0);
    assert.match(skipped[0].reason, /only 4d out; too late for the licensed reviewer's D-10 lead time, and nothing publishes without their approval/);
  });

  test('the removed allowReviewSkip option is ignored: no fill, no review_skipped, a ready draft included', () => {
    const cal = calendar({ slots: [{ date: TOO_CLOSE, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'ready' })] };
    const { locked } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft, allowReviewSkip: true });
    assert.equal(locked.length, 0);
    assert.equal(cal.year1.length, 0);
    assert.equal(cal.slots[0].state, 'reserved');
    assert.equal(cal.slots[0].review_skipped, undefined);
    assert.equal(backlog.candidates.length, 1, 'the candidate stays in the backlog');
  });

  test('a normally-locked slot carries no review_skipped, and the stats no longer have a reviewSkipped list', () => {
    const cal = calendar({ slots: [{ date: NEAR, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'in-time' })] };
    const { locked } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(locked.length, 1);
    assert.equal(cal.year1[0].review_skipped, undefined);
    assert.equal(cal.slots[0].review_skipped, undefined);
    assert.equal('reviewSkipped' in locked[0], false);
    const { stats } = q.evaluateInvariants(cal, backlog, TODAY, { hasMarkdown: hasDraft });
    assert.equal(stats.reviewSkipped, undefined);
    assert.deepEqual(stats.heldForApproval, []);
  });

  test('fill-slots --allow-review-skip exits 2 with the reason, and writes nothing', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { spawnSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fill-slots-flag-'));
    try {
      const calPath = path.join(tmp, 'content-calendar.json');
      const text = `${JSON.stringify(calendar({ slots: [{ date: TOO_CLOSE, state: 'reserved', locked_slug: null }] }), null, 2)}\n`;
      fs.writeFileSync(calPath, text);
      const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'fill-slots.js'), '--allow-review-skip', '--today', TODAY],
        { encoding: 'utf8', env: { ...process.env, CONTENT_CALENDAR_PATH: calPath } });
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /--allow-review-skip was removed on 2026-10-02: every post needs its licensed reviewer's approval/);
      assert.match(r.stderr, /Nothing was changed/);
      assert.equal(fs.readFileSync(calPath, 'utf8'), text);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
