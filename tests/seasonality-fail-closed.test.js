/**
 * Seasonality must fail CLOSED on a window it cannot interpret.
 *
 * The whole point of the 2026-08 redesign is that a winter driving guide can
 * never land in August. That rests on one filter — and the filter used to
 * return "eligible on every date" for any seasonality_window not found in the
 * taxonomy. A typo, a renamed window, or a bot writing the wrong vocabulary
 * defeated it silently.
 *
 * The vocabulary case is not hypothetical. topic-researcher's output contract
 * emits `seasonal_window: "2026-09"` — wrong field name AND a value that
 * matches no taxonomy window. Routing its proposals into the backlog (Stage 4)
 * would have driven every seasonal topic straight through the hole.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const q = require('../scripts/lib/content-queue');

const WINDOWS = {
  'winter-prep': [9, 10],       // Oct-Nov
  'back-to-school': [6, 7],     // Jul-Aug
};

// Month-band behaviour has to be asserted in isolation from data/seasonal-
// anchors.json. That file really does claim back-to-school (via
// school-year-start), so without this the anchor overrides the band and the
// test measures the live data instead of the code.
const NO_ANCHORS = { anchors: { anchors: {} } };

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

describe('unknown seasonality_window fails closed', () => {
  test('a window absent from the taxonomy is never eligible', () => {
    const c = candidate({ seasonality_window: 'not-a-real-window' });
    const e = q.eligibilityOn(c, '2026-08-12', WINDOWS);
    assert.equal(e.eligible, false);
    assert.equal(e.basis, 'unknown-window');
  });

  test('it stays ineligible in every month of the year', () => {
    const c = candidate({ seasonality_window: 'not-a-real-window' });
    for (let m = 1; m <= 12; m++) {
      const ymd = `2026-${String(m).padStart(2, '0')}-15`;
      assert.equal(q.isEligibleOn(c, ymd, WINDOWS), false, `expected ineligible on ${ymd}`);
    }
  });

  test("the topic-researcher's literal output value is rejected", () => {
    // Its contract says: "seasonal_window": "null or e.g. 2026-09 for a
    // Medicare AEP topic". That is not a taxonomy window name.
    const c = candidate({ seasonality_window: '2026-09' });
    const e = q.eligibilityOn(c, '2026-09-16', WINDOWS);
    assert.equal(e.eligible, false);
    assert.equal(e.basis, 'unknown-window');
  });

  test('the rejection reason names the data defect, not the season', () => {
    // An operator reading "out of season" goes looking at the calendar. The
    // actual problem is an unusable value in the backlog.
    const ctx = q.buildSchedulingContext({ existing_posts: [], year1: [] });
    const r = q.scoreCandidate(candidate({ seasonality_window: 'bogus' }), '2026-08-12', ctx, WINDOWS);
    assert.equal(r.eligible, false);
    assert.match(r.reasons[0], /not defined in content-taxonomy\.json/);
  });

  test('an empty window map blocks every seasonal candidate', () => {
    // A caller that could not read the taxonomy must not silently schedule
    // everything. Loud and stopped beats quiet and wrong.
    const c = candidate({ seasonality_window: 'winter-prep' });
    assert.equal(q.isEligibleOn(c, '2026-10-14', {}), false);
  });
});

describe('known windows keep working', () => {
  test('in-window seasonal candidate is eligible', () => {
    const c = candidate({ seasonality_window: 'back-to-school' });
    assert.equal(q.isEligibleOn(c, '2026-08-12', WINDOWS, NO_ANCHORS), true);
  });

  test('out-of-window seasonal candidate is rejected as out of season', () => {
    const c = candidate({ seasonality_window: 'winter-prep' });
    const e = q.eligibilityOn(c, '2026-08-12', WINDOWS);
    assert.equal(e.eligible, false);
    assert.equal(e.basis, 'months');
  });

  test('evergreen candidates are untouched', () => {
    assert.equal(q.isEligibleOn(candidate(), '2026-08-12', WINDOWS), true);
    assert.equal(q.eligibilityOn(candidate(), '2026-08-12', WINDOWS).basis, 'evergreen');
  });

  test('an anchored window still beats the month band', () => {
    const anchors = {
      anchors: {
        'school-year-start': {
          applies_to_windows: ['back-to-school'],
          lead_days: 45, close_days: 2,
          dates: { 2026: '2026-08-06' },
        },
      },
    };
    const c = candidate({ seasonality_window: 'back-to-school' });
    // Inside the month band but PAST the anchor close: the anchor wins.
    const e = q.eligibilityOn(c, '2026-08-20', WINDOWS, { anchors });
    assert.equal(e.eligible, false);
    assert.equal(e.basis, 'anchor');
  });

  test('an anchor with no date for the year falls back to the month band', () => {
    const anchors = {
      anchors: {
        'college-move-in': {
          applies_to_windows: ['back-to-school'],
          lead_days: 30, close_days: 0,
          dates: { 2026: null },
        },
      },
    };
    const c = candidate({ seasonality_window: 'back-to-school' });
    const e = q.eligibilityOn(c, '2026-08-12', WINDOWS, { anchors });
    assert.equal(e.basis, 'anchor-missing');
    // back-to-school is a REAL taxonomy window, so the band still applies and
    // fail-closed must not swallow this path.
    assert.equal(e.eligible, true);
  });
});

describe('loadWindowMonths is the one parser', () => {
  test('parses the live taxonomy into month indices', () => {
    const w = q.loadWindowMonths();
    assert.ok(Object.keys(w).length > 0);
    // "July-August" -> [6, 7]
    assert.deepEqual(w['back-to-school'], [6, 7]);
  });

  test('ignores months named only in the parenthetical note', () => {
    // "September (before Oct 15 open enrollment)" must be September alone, or
    // Medicare content becomes eligible two months early.
    const w = q.loadWindowMonths();
    assert.deepEqual(w['medicare-enrollment'], [8]);
  });

  test('throws rather than returning an empty map', () => {
    // An empty map is indistinguishable from "no windows defined", which under
    // fail-closed would silently refuse to schedule anything seasonal.
    assert.throws(() => q.loadWindowMonths('/nonexistent/root'));
  });
});
