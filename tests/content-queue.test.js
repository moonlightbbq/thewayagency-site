/**
 * The rolling content queue (scripts/lib/content-queue.js).
 *
 * Context: the 2026-05-02 re-pace (f1f4ba4) re-dated a year of content by
 * list position, so a cadence change silently pushed a winter driving guide
 * into August. Separately, college-student-auto-insurance was scheduled for
 * 2026-08-13 with no markdown and nothing noticed until the publish workflow
 * was about to go red on 2026-08-15.
 *
 * The invariants below exist for exactly those two failures, so the tests
 * drive the real rules with fixtures rather than restating them.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const q = require('../scripts/lib/content-queue');

// Fixtures are built RELATIVE to a fixed "today" that is itself a real
// calendar date, so nothing here rots the way a pinned publish_date would.
const TODAY = '2026-08-04'; // a Tuesday
const noMarkdown = () => false;
const allMarkdown = () => true;

function calendar({ posts = [], slots = [] } = {}) {
  return { year1: posts, slots };
}
function post(publish_date, over = {}) {
  return { slug: `post-${publish_date}`, title: 'T', publish_date, status: 'planned', ...over };
}
function ids(result) {
  return result.violations.map(v => v.id);
}

describe('publish-day arithmetic', () => {
  test('only ever returns Wednesdays and Saturdays', () => {
    for (const d of q.publishDatesWithin(TODAY, 60)) {
      assert.ok(q.isPublishDay(d), `${d} is not a publish day`);
    }
  });

  test('matches the workflow cron (Wed=3, Sat=6)', () => {
    assert.deepEqual(q.PUBLISH_WEEKDAYS, [3, 6]);
  });

  test('excludes today and is inclusive of the far edge', () => {
    const dates = q.publishDatesWithin('2026-08-05', 7); // 08-05 is a Wednesday
    assert.ok(!dates.includes('2026-08-05'), 'should not include the start date');
    assert.ok(dates.includes('2026-08-08'), 'should include the Saturday');
    assert.ok(dates.includes('2026-08-12'), 'should include the far-edge Wednesday');
  });

  test('day math is stable across a DST boundary', () => {
    // US DST ends 2026-11-01; a local-time implementation drifts here.
    assert.equal(q.daysBetween('2026-10-30', '2026-11-03'), 4);
  });
});

describe('I4 - markdown must exist before it is too late', () => {
  test('flags a post inside the window with no markdown (the 2026-08-13 case)', () => {
    const cal = calendar({ posts: [post('2026-08-08', { slug: 'college-student-auto-insurance' })] });
    const r = q.evaluateInvariants(cal, {}, TODAY, { hasMarkdown: noMarkdown });
    assert.ok(ids(r).includes('I4'));
    assert.match(r.violations.find(v => v.id === 'I4').message, /college-student-auto-insurance/);
  });

  test('stays quiet while the post is still outside the window', () => {
    // 22 days out: the drafting pipeline still has room, so this is not yet a problem.
    const cal = calendar({ posts: [post('2026-08-26')] });
    const r = q.evaluateInvariants(cal, {}, TODAY, { hasMarkdown: noMarkdown });
    assert.ok(!ids(r).includes('I4'));
  });

  test('stays quiet when the markdown is present', () => {
    const cal = calendar({ posts: [post('2026-08-08')] });
    const r = q.evaluateInvariants(cal, {}, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(!ids(r).includes('I4'));
  });

  test('ignores posts that already published', () => {
    const cal = calendar({ posts: [post('2026-08-08', { status: 'published' })] });
    const r = q.evaluateInvariants(cal, {}, TODAY, { hasMarkdown: noMarkdown });
    assert.ok(!ids(r).includes('I4'));
  });
});

describe('I1/I2 - capacity and commitment', () => {
  test('I1 fires when a publish date is neither filled nor reserved', () => {
    const r = q.evaluateInvariants(calendar(), {}, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(ids(r).includes('I1'));
  });

  test('I1 clears once every horizon date is reserved', () => {
    const slots = q.publishDatesWithin(TODAY, q.HORIZON_DAYS)
      .map(date => ({ date, state: 'reserved', locked_slug: null }));
    const r = q.evaluateInvariants(calendar({ slots }), {}, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(!ids(r).includes('I1'));
  });

  test('I2 fires for a reserved slot that is inside the lock window', () => {
    // 11d out: far enough to still get a review email, so it SHOULD be locked.
    const slots = [{ date: '2026-08-15', state: 'reserved', locked_slug: null }];
    const r = q.evaluateInvariants(calendar({ slots }), {}, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(ids(r).includes('I2'));
  });

  test('I2b flags a slot too close to fill without skipping review', () => {
    // 4d out: send-review-emails fires at D-10..18, so committing a topic here
    // would publish it unreviewed. That is reported, not silently filled.
    const slots = [{ date: '2026-08-08', state: 'reserved', locked_slug: null }];
    const r = q.evaluateInvariants(calendar({ slots }), {}, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(ids(r).includes('I2b'));
    assert.ok(!ids(r).includes('I2'), 'it is past saving, not a scheduling failure');
  });

  test('I2 leaves a slot beyond the lock window alone', () => {
    const beyond = q.publishDatesWithin(TODAY, q.HORIZON_DAYS).at(-1);
    assert.ok(q.daysBetween(TODAY, beyond) > q.LOCK_DAYS);
    const r = q.evaluateInvariants(
      calendar({ slots: [{ date: beyond, state: 'reserved', locked_slug: null }] }),
      {}, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(!ids(r).includes('I2'));
  });
});

describe('I3 - a locked slot points at a real post', () => {
  test('fires when the locked slot has no post', () => {
    const slots = [{ date: '2026-08-08', state: 'locked', locked_slug: 'ghost' }];
    const r = q.evaluateInvariants(calendar({ slots }), {}, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(ids(r).includes('I3'));
  });

  test('fires when the slot and the post disagree about the slug', () => {
    const cal = calendar({
      posts: [post('2026-08-08', { slug: 'actually-this-one' })],
      slots: [{ date: '2026-08-08', state: 'locked', locked_slug: 'expected-that-one' }],
    });
    const r = q.evaluateInvariants(cal, {}, TODAY, { hasMarkdown: allMarkdown });
    assert.match(r.violations.find(v => v.id === 'I3').message, /expected-that-one/);
  });

  test('is satisfied when they agree', () => {
    const cal = calendar({
      posts: [post('2026-08-08', { slug: 'agreed' })],
      slots: [{ date: '2026-08-08', state: 'locked', locked_slug: 'agreed' }],
    });
    const r = q.evaluateInvariants(cal, {}, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(!ids(r).includes('I3'));
  });
});

describe('I5 - backlog depth', () => {
  test('fires on an empty approved backlog', () => {
    const r = q.evaluateInvariants(calendar(), { candidates: [] }, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(ids(r).includes('I5'));
  });

  test('counts only approved candidates, not proposed or on-hold', () => {
    const candidates = Array.from({ length: q.MIN_APPROVED_BACKLOG }, (_, i) => ({
      slug: `c${i}`, status: i === 0 ? 'proposed' : 'approved',
    }));
    const r = q.evaluateInvariants(calendar(), { candidates }, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(ids(r).includes('I5'), 'one short of the floor should still fire');
  });

  test('clears at the floor', () => {
    const candidates = Array.from({ length: q.MIN_APPROVED_BACKLOG }, (_, i) => ({
      slug: `c${i}`, status: 'approved',
    }));
    const r = q.evaluateInvariants(calendar(), { candidates }, TODAY, { hasMarkdown: allMarkdown });
    assert.ok(!ids(r).includes('I5'));
  });
});

describe('seasonal eligibility is applied at lock time', () => {
  const WINDOWS = { 'winter-prep': [9, 10], 'back-to-school': [6, 7] };

  test('a winter post is not eligible for an August slot', () => {
    // The exact placement that started all of this: winter-driving on 2026-08-19.
    const winter = { slug: 'winter-driving', seasonality_window: 'winter-prep' };
    assert.equal(q.isEligibleOn(winter, '2026-08-19', WINDOWS), false);
  });

  test('the same post is eligible in its own season', () => {
    const winter = { slug: 'winter-driving', seasonality_window: 'winter-prep' };
    assert.equal(q.isEligibleOn(winter, '2026-12-02', WINDOWS), true);
  });

  test('evergreen candidates are eligible on any date', () => {
    const evergreen = { slug: 'surety-bonds', seasonality_window: null };
    assert.equal(q.isEligibleOn(evergreen, '2026-08-19', WINDOWS), true);
    assert.equal(q.isEligibleOn(evergreen, '2027-03-24', WINDOWS), true);
  });

  test('tolerates one shoulder month on each side, matching the build check', () => {
    const backToSchool = { slug: 'college-auto', seasonality_window: 'back-to-school' };
    assert.equal(q.isEligibleOn(backToSchool, '2026-09-02', WINDOWS), true, 'September is a shoulder month');
    assert.equal(q.isEligibleOn(backToSchool, '2026-12-02', WINDOWS), false, 'December is not');
  });
});

describe('occupiedDates', () => {
  test('counts unpublished posts and ignores published ones', () => {
    const cal = calendar({
      posts: [post('2026-08-08'), post('2026-08-12', { status: 'published' })],
    });
    const taken = q.occupiedDates(cal);
    assert.ok(taken.has('2026-08-08'));
    assert.ok(!taken.has('2026-08-12'), 'a published date is free to reserve again');
  });
});
