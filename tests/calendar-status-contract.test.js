/**
 * The calendar status vocabulary is a CROSS-REPO contract.
 *
 * sage writes statuses into data/content-calendar.json (since BL-07 it sets
 * 'approved' only when the assigned reviewer approves the exact text: in SAGE,
 * or, for a reviewer who reviews by email, by a verified APPROVED reply, and
 * commits it). This repo
 * decides what publishes. Nothing tested the seam, so the two ends drifted:
 * the publisher recognised planned/in-review/in-draft and skipped 'approved'
 * with a bare `continue` — no error, no red run. occupiedDates() still counted
 * the slot as filled, so no queue invariant fired either.
 *
 * Approving a post was what stopped it from publishing. It survived because no
 * reviewer reply had ever been processed in production, and because the
 * sage-side test asserts only that the write happens — it cannot see that this
 * repo refuses to act on it.
 *
 * These tests are the contract. If sage introduces a new status, one of them
 * fails here rather than a post going quietly unpublished.
 *
 * Since the owner's decision of 2026-10-02 'approved' is the ONLY publishable
 * status: planned, in-draft and in-review are known, awaiting approval, and
 * HELD once their date arrives (except the frozen advisory exceptions, by
 * exact slug and date).
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  PUBLISHABLE_STATUSES, AWAITING_APPROVAL_STATUSES, TERMINAL_STATUSES, HOLD_STATUSES, ADVISORY_GRANDFATHERED,
  isPublishable, isKnownStatus, isHeld, isAwaitingApproval, heldForApproval, isGrandfathered,
} = require('../scripts/lib/calendar-status');

const ROOT = path.resolve(__dirname, '..');

describe('publishable statuses', () => {
  test("'approved' publishes — the regression", () => {
    // Before the fix this was false, and that single false silently stopped
    // any post whose reviewer actually replied.
    assert.equal(isPublishable('approved'), true);
  });

  test("approval is REQUIRED: 'approved' is the only publishable status (owner decision 2026-10-02)", () => {
    assert.deepEqual([...PUBLISHABLE_STATUSES], ['approved']);
    for (const s of ['planned', 'in-draft', 'in-review']) {
      assert.equal(isPublishable(s), false, s);
      assert.equal(isPublishable(s, { slug: 'test-x', publish_date: '2026-01-07', status: s }), false, `${s} with its entry`);
      assert.equal(isKnownStatus(s), true, `${s} is known`);
      assert.equal(isAwaitingApproval(s), true);
      assert.equal(isHeld(s), false, `${s} is not a change-request hold`);
    }
    assert.equal(isAwaitingApproval('approved'), false);
  });

  test('one-argument calls (sage-server\'s cross-repo tests) keep working: approved true, everything else false', () => {
    assert.equal(isPublishable('approved'), true);
    assert.equal(isPublishable('changes-requested'), false);
    assert.equal(isPublishable('planned'), false);
  });

  test('heldForApproval: an awaiting entry at or past its date, never a future, approved, held or terminal one', () => {
    const e = (status, date) => ({ slug: 'test-held-y', status, publish_date: date });
    assert.equal(heldForApproval(e('planned', '2026-11-18'), '2026-11-18'), true, 'on its date');
    assert.equal(heldForApproval(e('in-review', '2026-11-18'), '2026-11-20'), true, 'past it');
    assert.equal(heldForApproval(e('in-draft', '2026-11-18'), '2026-11-20'), true);
    assert.equal(heldForApproval(e('in-review', '2026-11-18'), '2026-11-17'), false, 'not due yet');
    for (const s of ['approved', 'published', 'error', 'changes-requested']) assert.equal(heldForApproval(e(s, '2026-11-18'), '2026-11-20'), false, s);
    assert.equal(heldForApproval({ slug: 'test-held-y', status: 'planned' }, '2026-11-20'), false, 'undated');
  });

  test('the frozen advisory exceptions: exact slug AND date, awaiting statuses only; back-dating anything else does not qualify', () => {
    // Pinned pair by pair: swapping one for a new post must fail here.
    assert.deepEqual(ADVISORY_GRANDFATHERED.map((g) => [g.slug, g.publish_date]), [
      ['insurance-restaurants-food-service-kentucky', '2026-08-08'],
      ['final-expense-insurance-guide', '2026-08-12'],
      ['insurance-options-frankfort-state-employees', '2026-08-15'],
      ['professional-liability-who-needs-eo', '2026-08-19'],
      ['surety-bonds-explained', '2026-08-22'],
      ['group-health-insurance-small-business-kentucky', '2026-09-02'],
      ['insurance-guide-electrical-contractors', '2026-09-05'],
      ['community-involvement-2026', '2026-09-09'],
      ['community-spotlight-local-businesses', '2026-09-12'],
      ['how-to-compare-insurance-quotes', '2026-09-16'],
      ['replacement-cost-vs-actual-cash-value', '2026-09-19'],
      ['understanding-certificates-of-insurance', '2026-09-23'],
      ['understanding-insurance-endorsements', '2026-09-26'],
    ]);
    assert.ok(Object.isFrozen(ADVISORY_GRANDFATHERED));
    for (const g of ADVISORY_GRANDFATHERED) {
      assert.ok(Object.isFrozen(g));
      assert.ok(g.publish_date < '2026-10-03', `${g.slug} predates the decision`);
      for (const s of ['planned', 'in-review', 'in-draft']) {
        const entry = { slug: g.slug, publish_date: g.publish_date, status: s };
        assert.equal(isPublishable(s, entry), true, `${g.slug} ${s}`);
        assert.equal(heldForApproval(entry, '2026-10-02'), false);
      }
      assert.equal(isPublishable('planned', { slug: g.slug, publish_date: '2026-10-07', status: 'planned' }), false, 're-dated: no exception');
      assert.equal(isGrandfathered({ slug: g.slug, publish_date: g.publish_date, status: 'changes-requested' }), false, 'a hold stays a hold');
      assert.equal(isPublishable('planned', { slug: g.slug, publish_date: g.publish_date, status: 'in-review' }), false, 'the status must be the entry\'s');
    }
    assert.equal(isPublishable('planned', { slug: 'test-backdated', publish_date: '2026-01-01', status: 'planned' }), false);
  });

  test('terminal statuses do not publish', () => {
    assert.equal(isPublishable('published'), false);
    assert.equal(isPublishable('error'), false);
  });

  test('an unknown status is neither publishable nor known', () => {
    assert.equal(isPublishable('rejected-by-legal'), false);
    assert.equal(isKnownStatus('rejected-by-legal'), false);
  });

  test('publishable and terminal sets do not overlap', () => {
    for (const s of PUBLISHABLE_STATUSES) {
      assert.equal(TERMINAL_STATUSES.has(s), false, `"${s}" is in both sets`);
    }
  });
});

describe('the reviewer hold (BL-07)', () => {
  test("'changes-requested' is known, held, and does NOT publish", () => {
    // sage writes it when the assigned reviewer asks for changes. If it were
    // publishable the post would go live over the reviewer's objection; if it
    // were unknown the publisher would treat it as a contract breach.
    assert.equal(isKnownStatus('changes-requested'), true);
    assert.equal(isHeld('changes-requested'), true);
    assert.equal(isPublishable('changes-requested'), false);
  });

  test('publishable, awaiting, terminal and hold sets are disjoint', () => {
    const sets = { PUBLISHABLE_STATUSES, AWAITING_APPROVAL_STATUSES, TERMINAL_STATUSES, HOLD_STATUSES };
    const seen = new Map();
    for (const [name, set] of Object.entries(sets)) {
      for (const st of set) {
        assert.equal(seen.has(st), false, `"${st}" is in ${seen.get(st)} and ${name}`);
        seen.set(st, name);
      }
    }
  });
});

describe('the contract holds across both repos', () => {
  test('every status sage writes is one this repo knows', () => {
    // Read the statuses sage assigns straight out of its source. If sage adds
    // one, this fails here instead of a post going quietly unpublished.
    // (sage-server BL-07 writes 'approved' and the 'changes-requested' hold:
    // between sage's deploy and this repo's merge of the hold vocabulary, a
    // host run against ../sage-main fails here, which is the alarm working.)
    const blogReviews = path.resolve(ROOT, '..', 'sage-main', 'src', 'email', 'blog-reviews.js');
    if (!fs.existsSync(blogReviews)) {
      // sage is not checked out beside this repo (CI runners, fresh clones).
      // Skipping is honest; the assertion below still pins our own side.
      return;
    }
    const src = fs.readFileSync(blogReviews, 'utf8');
    const written = [...src.matchAll(/\bentry\.status\s*=\s*['"]([a-z-]+)['"]/g)].map(m => m[1]);
    assert.ok(written.length > 0, 'expected blog-reviews.js to assign at least one status');
    for (const s of written) {
      assert.equal(isKnownStatus(s), true,
        `sage writes status "${s}" but this repo does not know it — the seam that broke publishing`);
    }
  });

  test('every status on the live calendar is known', () => {
    const cal = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content-calendar.json'), 'utf8'));
    const all = [...(cal.year1 || []), ...(cal.existing_posts || [])];
    const unknown = [...new Set(all.map(p => p && p.status).filter(s => s && !isKnownStatus(s)))];
    assert.deepEqual(unknown, [], `unknown statuses on the live calendar: ${unknown.join(', ')}`);
  });

  test('the publisher reads the shared vocabulary, not a local list', () => {
    // Guards the specific shape of the bug: a hardcoded status list in the
    // publisher that can drift from what sage writes.
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'publish-scheduled-posts.js'), 'utf8');
    assert.match(src, /require\(['"]\.\/lib\/calendar-status['"]\)/);
    assert.doesNotMatch(src, /status !== 'planned' && post\.status !== 'in-review'/);
  });

  test('reconcile-calendar shares it too, with the entry (the exceptions are per entry)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'reconcile-calendar.js'), 'utf8');
    assert.match(src, /require\(['"]\.\/lib\/calendar-status['"]\)/);
    assert.doesNotMatch(src, /new Set\(\['planned', 'in-review', 'in-draft'\]\)/);
    assert.doesNotMatch(src, /PUBLISHABLE_STATUSES/, 'the bare set ignores the per-entry exceptions');
    assert.match(src, /publishable\(post\.status, post\)/);
    const pub = fs.readFileSync(path.join(ROOT, 'scripts', 'publish-scheduled-posts.js'), 'utf8');
    assert.match(pub, /isPublishable\(post\.status, post\)/);
  });
});
