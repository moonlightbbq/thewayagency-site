/**
 * Seasonal anchors — timing content against real dates instead of month bands.
 *
 * "July-August" is a guess dressed up as a rule: it permits publishing
 * back-to-school content on August 31, three weeks after school starts. The
 * agency's districts start 2026-08-06, and nothing in the system knew that.
 *
 * These drive the REAL data/seasonal-anchors.json so the shipped dates and
 * lead times are what's under test, not a fixture of them.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const q = require('../scripts/lib/content-queue');

const MONTHS = { 'back-to-school': [6, 7], 'college-move-in': [7], 'medicare-enrollment': [8] };
const cand = (w) => ({ slug: 'c', seasonality_window: w });

describe('an anchored window beats its month band', () => {
  test('back-to-school closes BEFORE the first day of school', () => {
    // The whole point: 2026-08-26 is inside the "July-August" band and is
    // still wrong, because school started on the 6th.
    const late = q.eligibilityOn(cand('back-to-school'), '2026-08-26', MONTHS);
    assert.equal(late.eligible, false);
    assert.equal(late.basis, 'anchor');
    assert.match(late.detail, /2026-08-06/);
  });

  test('the day before school starts is already too late', () => {
    assert.equal(q.eligibilityOn(cand('back-to-school'), '2026-08-05', MONTHS).eligible, false);
  });

  test('a month before school is fine', () => {
    assert.equal(q.eligibilityOn(cand('back-to-school'), '2026-07-08', MONTHS).eligible, true);
  });

  test('the real 2026-07-01 checklist is accepted', () => {
    // Five weeks early is keen, not wrong. The lead is generous on purpose;
    // the CLOSE is the edge that matters.
    assert.equal(q.eligibilityOn(cand('back-to-school'), '2026-07-01', MONTHS).eligible, true);
  });
});

describe('a missing anchor date is loud, not silent', () => {
  test('college-move-in has no 2026 date and says so', () => {
    const r = q.eligibilityOn(cand('college-move-in'), '2026-08-26', MONTHS);
    assert.equal(r.basis, 'anchor-missing');
    assert.match(r.detail, /no date for 2026/);
  });

  test('it still falls back to the month band rather than blocking everything', () => {
    // Refusing to schedule anything because a date is unknown would be worse
    // than the approximation it replaces.
    assert.equal(q.eligibilityOn(cand('college-move-in'), '2026-08-26', MONTHS).eligible, true);
    assert.equal(q.eligibilityOn(cand('college-move-in'), '2026-12-26', MONTHS).eligible, false);
  });
});

describe('anchors with a negative close extend past the date', () => {
  test('medicare stays eligible through the enrollment period', () => {
    // AEP is Oct 15 - Dec 7 by statute, so content is useful AFTER the anchor.
    assert.equal(q.eligibilityOn(cand('medicare-enrollment'), '2026-11-20', MONTHS).eligible, true);
    assert.equal(q.eligibilityOn(cand('medicare-enrollment'), '2026-12-08', MONTHS).eligible, false);
  });

  test('and not before its lead opens', () => {
    assert.equal(q.eligibilityOn(cand('medicare-enrollment'), '2026-07-22', MONTHS).eligible, false);
  });
});

describe('unanchored windows are unchanged', () => {
  test('winter-prep still uses its month band', () => {
    const r = q.eligibilityOn({ slug: 'w', seasonality_window: 'winter-prep' }, '2026-12-02', { 'winter-prep': [9, 10] });
    assert.equal(r.basis, 'months');
    assert.equal(r.eligible, true);
  });

  test('evergreen candidates are always eligible', () => {
    const r = q.eligibilityOn({ slug: 'e', seasonality_window: null }, '2026-08-26', MONTHS);
    assert.equal(r.basis, 'evergreen');
    assert.equal(r.eligible, true);
  });
});

describe('the scheduler honours anchors', () => {
  test('fillSlots will not place back-to-school content after school starts', () => {
    const cal = { year1: [], slots: [{ date: '2026-08-19', state: 'reserved', locked_slug: null }], existing_posts: [] };
    const backlog = {
      candidates: [{
        slug: 'b2s', title: 'B2S', primary_keyword: 'back to school checklist',
        status: 'approved', seasonality_window: 'back-to-school',
      }],
    };
    const { locked } = q.fillSlots(cal, backlog, '2026-08-05', MONTHS, { hasMarkdown: () => true });
    assert.equal(locked.length, 0, 'school already started; the slot must stay empty');
  });
});
