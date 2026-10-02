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
    // 4d out: inside the reviewer's D-10 lead time, and nothing publishes
    // without their approval, so committing a topic here would only hold.
    // That is reported, not silently filled.
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
    // Shoulder tolerance applies to UNANCHORED windows. back-to-school is now
    // anchored to the real first day of school, which overrides the band
    // entirely -- see tests/seasonal-anchors.test.js.
    const winter = { slug: 'winter-driving', seasonality_window: 'winter-prep' };
    assert.equal(q.isEligibleOn(winter, '2026-12-02', WINDOWS), true, 'December is a shoulder month for Oct-Nov');
    assert.equal(q.isEligibleOn(winter, '2026-06-02', WINDOWS), false, 'June is not');
  });

  test('an anchored window overrides the month band entirely', () => {
    // 2026-08-26 is inside the "July-August" band and still wrong, because
    // school started on the 6th. This is the whole point of anchors.
    const b2s = { slug: 'college-auto', seasonality_window: 'back-to-school' };
    assert.equal(q.isEligibleOn(b2s, '2026-08-26', WINDOWS), false);
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

describe('I8 - a post due without its licensed reviewer\'s approval is HELD, loudly (owner decision 2026-10-02)', () => {
  const i8 = (r) => r.violations.filter(v => v.id === 'I8');

  test('fires for a due planned, in-draft or in-review post, on and after its date', () => {
    for (const status of ['planned', 'in-draft', 'in-review']) {
      for (const date of [TODAY, '2026-08-01']) {
        const r = q.evaluateInvariants(calendar({ posts: [post(date, { status })] }), {}, TODAY, { hasMarkdown: allMarkdown });
        assert.equal(i8(r).length, 1, `${status} due ${date}`);
        assert.match(i8(r)[0].message, new RegExp(`"post-${date}" was due ${date} but has no licensed approval \\(status ${status}`));
        assert.deepEqual(r.stats.heldForApproval.map(p => p.slug), [`post-${date}`]);
      }
    }
  });

  test('does not fire for a future, approved, published, change-requested, error or frozen-exception post', () => {
    const { ADVISORY_GRANDFATHERED } = require('../scripts/lib/calendar-status');
    const g = ADVISORY_GRANDFATHERED[0];
    const posts = [
      post('2026-08-05', { status: 'in-review' }),
      post('2026-08-01', { slug: 'a1', status: 'approved' }),
      post('2026-08-01', { slug: 'p1', status: 'published' }),
      post('2026-08-01', { slug: 'h1', status: 'changes-requested' }),
      post('2026-08-01', { slug: 'e1', status: 'error', error_reason: 'missing_markdown' }),
      { slug: g.slug, title: 'T', publish_date: g.publish_date, status: 'planned' },
    ];
    const r = q.evaluateInvariants(calendar({ posts }), {}, '2026-10-02', { hasMarkdown: allMarkdown });
    assert.deepEqual(i8(r).filter(v => !v.message.includes('"post-2026-08-05"')), [], 'only the (now past) in-review post');
    const early = q.evaluateInvariants(calendar({ posts: [post('2026-08-05', { status: 'in-review' })] }), {}, TODAY, { hasMarkdown: allMarkdown });
    assert.deepEqual(i8(early), [], 'not due yet');
    assert.ok(ids(r).includes('I6') && ids(r).includes('I7'), 'the hold and the error keep their own invariants');
  });

  test('the message says what to do: approve (reviewer asked), re-date (nobody asked), or write the markdown', () => {
    const asked = post(TODAY, { slug: 'asked', status: 'in-review', reviewer: 'Test Reviewer', reviewer_email: 'test-reviewer@example.com' });
    const notAsked = post(TODAY, { slug: 'not-asked', status: 'planned' });
    const noMd = post(TODAY, { slug: 'no-md', status: 'planned' });
    const r = q.evaluateInvariants(calendar({ posts: [asked, notAsked, noMd] }), {}, TODAY, { hasMarkdown: (slug) => slug !== 'no-md' });
    const msg = (slug) => i8(r).find(v => v.message.includes(`"${slug}"`)).message;
    assert.match(msg('asked'), /reviewer Test Reviewer <test-reviewer@example.com>\); it is held and publishes on the first publish run after its assigned reviewer approves it, while still scheduled for 2026-08-04/);
    assert.match(msg('not-asked'), /reviewer none assigned\); no review request went out for it, so nobody can approve it: move it to a future date/);
    assert.match(msg('no-md'), /its markdown \(src\/blog\/no-md\.md\) is missing too/);
  });

  test('a held post keeps its date (no double booking) and blocks only that date: later slots still reserve and fill', () => {
    const heldDate = '2026-08-01';
    const cal = calendar({ posts: [post(heldDate, { status: 'in-review' })] });
    assert.ok(q.occupiedDates(cal).has(heldDate), 'its date stays taken until it publishes or moves');
    const reserved = q.reserveSlots(cal, TODAY);
    assert.ok(reserved.added.length > 0, 'the horizon still reserves');
    const backlog = { candidates: [{ slug: 'next-up', title: 'Next', primary_keyword: 'umbrella limits explained', status: 'approved', seasonality_window: null, target_location_pages: [] }] };
    const { locked } = q.fillSlots(cal, backlog, TODAY, {}, { hasMarkdown: allMarkdown });
    assert.equal(locked.length, 1, 'a later slot in the lock window is filled as usual');
    assert.ok(locked[0].date > heldDate);
    const r = q.evaluateInvariants(cal, backlog, TODAY, { hasMarkdown: allMarkdown });
    assert.equal(i8(r).length, 1);
  });

  test('the review flow owns final_reminder_dates and approved_via (the queue never clears them)', () => {
    assert.ok(q.REVIEW_OWNED_FIELDS.includes('final_reminder_dates'));
    assert.ok(q.REVIEW_OWNED_FIELDS.includes('approved_via'));
  });
});
