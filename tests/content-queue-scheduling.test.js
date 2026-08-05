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
    // Genuinely distinct subject matter. Note "topic number 1/2/3" would NOT
    // work: the digits are stripped as too short, so those keywords tokenize
    // identically and the cannibalization check correctly rejects them.
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

describe('allowReviewSkip: keeping a date from going silent', () => {
  // 2026-08-05 is 4d from TODAY, inside the D-10 review window.
  const TOO_CLOSE = '2026-08-05';

  test('by default the slot is left empty and the reason is reported', () => {
    const cal = calendar({ slots: [{ date: TOO_CLOSE, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'ready' })] };
    const { locked, skipped } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft });
    assert.equal(locked.length, 0);
    assert.match(skipped[0].reason, /review window/);
  });

  test('with the override the date is filled and marked review_skipped', () => {
    const cal = calendar({ slots: [{ date: TOO_CLOSE, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'ready' })] };
    const { locked } = q.fillSlots(cal, backlog, TODAY, WINDOWS,
      { hasMarkdown: hasDraft, allowReviewSkip: true });
    assert.equal(locked.length, 1);
    assert.equal(locked[0].reviewSkipped, true);
    assert.equal(cal.year1[0].review_skipped, true);
    assert.match(cal.year1[0].notes, /no reviewer email/);
  });

  test('the override never picks a candidate whose draft is not written', () => {
    // There is no time to write one, so an unwritten candidate is useless here.
    const cal = calendar({ slots: [{ date: TOO_CLOSE, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'unwritten' })] };
    const { locked, skipped } = q.fillSlots(cal, backlog, TODAY, WINDOWS,
      { hasMarkdown: noDraft, allowReviewSkip: true });
    assert.equal(locked.length, 0);
    assert.match(skipped[0].reason, /no ready draft/);
  });

  test('it still will not place an out-of-season post', () => {
    const cal = calendar({ slots: [{ date: TOO_CLOSE, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ seasonality_window: 'winter-prep' })] };
    const { locked } = q.fillSlots(cal, backlog, TODAY, WINDOWS,
      { hasMarkdown: hasDraft, allowReviewSkip: true });
    assert.equal(locked.length, 0, 'urgency never overrides the seasonal filter');
  });

  test('a normally-locked slot is NOT marked review_skipped', () => {
    const cal = calendar({ slots: [{ date: NEAR, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'in-time' })] };
    q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft, allowReviewSkip: true });
    assert.equal(cal.year1[0].review_skipped, undefined);
  });

  test('review-skipped posts are surfaced in the invariant stats', () => {
    const cal = calendar({ slots: [{ date: TOO_CLOSE, state: 'reserved', locked_slug: null }] });
    const backlog = { candidates: [candidate({ slug: 'ready' })] };
    q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: hasDraft, allowReviewSkip: true });
    const { stats } = q.evaluateInvariants(cal, backlog, TODAY, { hasMarkdown: hasDraft });
    assert.equal(stats.reviewSkipped.length, 1, 'the trade-off must never be invisible');
  });
});
