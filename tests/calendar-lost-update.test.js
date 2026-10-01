/**
 * The calendar has two writers on different schedules, and for months the
 * second one silently undid the first.
 *
 * send-review-emails.js runs from the publish workflow (Wed/Sat ~13:00) and
 * assigns the reviewer. fill-slots runs hours later, round-tripping the WHOLE
 * calendar object it had already read — so it wrote back a copy that predated
 * the assignment. On 2026-09-05 the 13:11 run assigned Audrey Lillpop to
 * how-to-compare-insurance-quotes; the 16:30 run removed reviewer,
 * reviewer_email, reviewer_slug and review_sent_date and reverted the status.
 *
 * Every post therefore published with no reviewer on record, and the rotation
 * froze: getNextReviewer picks the fewest-assigned reviewer, and with no
 * assignment ever sticking the counts never moved, so the same person was
 * picked forever.
 *
 * saveCalendar re-reads before writing. These tests hold that.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let dir;
let calPath;
let q;

function write(obj) {
  fs.writeFileSync(calPath, `${JSON.stringify(obj, null, 2)}\n`);
}

function read() {
  return JSON.parse(fs.readFileSync(calPath, 'utf8'));
}

function baseCalendar() {
  return {
    version: 2,
    existing_posts: [],
    year1: [
      { slug: 'how-to-compare-insurance-quotes', publish_date: '2026-09-16', status: 'planned' },
      { slug: 'untouched-post', publish_date: '2026-09-19', status: 'planned' },
    ],
    slots: [],
  };
}

describe('saveCalendar does not clobber a concurrent writer', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twa-cal-'));
    calPath = path.join(dir, 'content-calendar.json');
    process.env.CONTENT_CALENDAR_PATH = calPath;
    delete require.cache[require.resolve('../scripts/lib/content-queue')];
    q = require('../scripts/lib/content-queue');
    write(baseCalendar());
  });

  afterEach(() => {
    delete process.env.CONTENT_CALENDAR_PATH;
    delete require.cache[require.resolve('../scripts/lib/content-queue')];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a reviewer assigned after our read survives our write', () => {
    // The queue reads the calendar...
    const mine = q.loadCalendar();

    // ...the review job assigns a reviewer and writes, while we still hold ours.
    const theirs = read();
    Object.assign(theirs.year1[0], {
      status: 'in-review',
      reviewer: 'Audrey Lillpop',
      reviewer_email: 'audrey@thewayagency.com',
      reviewer_slug: 'audrey-lillpop',
      review_sent_date: '2026-09-05',
    });
    write(theirs);

    // ...and only then do we save our stale copy.
    q.saveCalendar(mine);

    const after = read().year1.find(p => p.slug === 'how-to-compare-insurance-quotes');
    assert.equal(after.reviewer, 'Audrey Lillpop', 'the reviewer assignment was clobbered');
    assert.equal(after.reviewer_email, 'audrey@thewayagency.com');
    assert.equal(after.reviewer_slug, 'audrey-lillpop');
    assert.equal(after.review_sent_date, '2026-09-05');
    assert.equal(after.status, 'in-review', 'the review status was reverted');
  });

  test('an approval recorded after our read survives our write', () => {
    const mine = q.loadCalendar();
    const theirs = read();
    Object.assign(theirs.year1[0], {
      status: 'approved',
      reviewer: 'Sheilia Royal',
      approved_date: '2026-09-10',
      reviewed_date: '2026-09-10',
    });
    write(theirs);
    q.saveCalendar(mine);

    const after = read().year1.find(p => p.slug === 'how-to-compare-insurance-quotes');
    assert.equal(after.approved_date, '2026-09-10', 'a real sign-off was lost');
    assert.equal(after.reviewed_date, '2026-09-10');
    assert.equal(after.reviewer, 'Sheilia Royal');
  });

  test('an approval withdrawn after our read is not brought back by our stale copy', () => {
    // Our copy has a signed approval; the review flow then withdraws it on
    // disk (status back to in-review, the record deleted). The deletion wins.
    const seeded = baseCalendar();
    Object.assign(seeded.year1[0], { status: 'approved', approved_by: 'Test Reviewer', approved_sha256: 'a'.repeat(64), approval_mac: 'm'.repeat(43) });
    write(seeded);
    const mine = q.loadCalendar();
    const theirs = read();
    theirs.year1[0].status = 'in-review';
    for (const k of ['approved_by', 'approved_sha256', 'approval_mac']) delete theirs.year1[0][k];
    write(theirs);
    q.saveCalendar(mine);

    const after = read().year1.find(p => p.slug === 'how-to-compare-insurance-quotes');
    assert.equal(after.status, 'in-review');
    assert.equal(after.approval_mac, undefined, 'a withdrawn approval came back');
    assert.equal(after.approved_sha256, undefined);
    assert.equal(after.approved_by, undefined);
  });

  // BL-07 fix: MAC v2 signs approved_publish_date. The guard restored every
  // other approval field from disk but not that one, so a real approval saved
  // over by a stale queue copy lost it, no longer verified, and the publisher
  // put the post in 'error' (approval_unsigned).
  test('the guard owns every field of the approval and credit record (review-credit.js APPROVAL_RECORD_FIELDS)', () => {
    const { APPROVAL_RECORD_FIELDS } = require('../scripts/lib/review-credit');
    for (const f of APPROVAL_RECORD_FIELDS) assert.ok(q.REVIEW_OWNED_FIELDS.includes(f), `${f} is not owned by the review flow`);
    assert.ok(q.REVIEW_OWNED_FIELDS.includes('approved_publish_date'));
  });

  test('a signed approval written after our read survives our write whole, approved_publish_date included, and still verifies', () => {
    const { signApproval, approvalSigned } = require('../scripts/lib/review-credit');
    const secret = 'TEST-vector-secret-0123456789abcdef0123';
    const mine = q.loadCalendar();
    const theirs = read();
    const approval = {
      status: 'approved', reviewer: 'Test Reviewer A', reviewer_email: 'test-reviewer-a@example.com', reviewer_slug: 'test-reviewer-a',
      approved_by: 'Test Reviewer A', approved_by_email: 'test-reviewer-a@example.com', approved_date: '2026-09-10',
      approved_sha256: 'a'.repeat(64), approved_publish_date: '2026-09-16',
    };
    Object.assign(theirs.year1[0], approval);
    theirs.year1[0].approval_mac = signApproval(theirs.year1[0], secret);
    write(theirs);
    q.saveCalendar(mine);

    const after = read().year1.find(p => p.slug === 'how-to-compare-insurance-quotes');
    assert.equal(after.approved_publish_date, '2026-09-16', 'the signed publish date was dropped');
    assert.equal(after.approval_mac, theirs.year1[0].approval_mac);
    assert.ok(approvalSigned(after, secret), 'the approval no longer verifies after the save');
  });

  test('a withdrawal after our read deletes approved_publish_date too (no partial record left behind)', () => {
    const seeded = baseCalendar();
    Object.assign(seeded.year1[0], {
      status: 'approved', approved_by: 'Test Reviewer A', approved_sha256: 'a'.repeat(64), approved_publish_date: '2026-09-16', approval_mac: 'm'.repeat(43),
    });
    write(seeded);
    const mine = q.loadCalendar();
    const theirs = read();
    theirs.year1[0].status = 'in-review';
    for (const k of ['approved_by', 'approved_sha256', 'approved_publish_date', 'approval_mac']) delete theirs.year1[0][k];
    write(theirs);
    q.saveCalendar(mine);

    const after = read().year1.find(p => p.slug === 'how-to-compare-insurance-quotes');
    assert.equal(after.status, 'in-review');
    for (const k of ['approved_by', 'approved_sha256', 'approved_publish_date', 'approval_mac']) assert.equal(after[k], undefined, `${k} came back`);
  });

  test('an entry added after our read is carried over, not dropped', () => {
    const mine = q.loadCalendar();
    const theirs = read();
    theirs.year1.push({ slug: 'added-by-the-other-writer', publish_date: '2026-09-23', status: 'planned' });
    write(theirs);
    q.saveCalendar(mine);

    const slugs = read().year1.map(p => p.slug);
    assert.ok(slugs.includes('added-by-the-other-writer'), 'a concurrently added entry was dropped');
  });

  test('our own queue changes still land', () => {
    const mine = q.loadCalendar();
    mine.year1.push({ slug: 'locked-by-the-queue', publish_date: '2026-09-26', status: 'planned', source: 'queue-lock' });

    const theirs = read();
    theirs.year1[0].reviewer = 'Kelly McCallister';
    write(theirs);

    q.saveCalendar(mine);
    const after = read();
    assert.ok(after.year1.some(p => p.slug === 'locked-by-the-queue'), 'the queue lost its own write');
    assert.equal(after.year1.find(p => p.slug === 'how-to-compare-insurance-quotes').reviewer, 'Kelly McCallister');
  });

  test('an uncontended write is unchanged', () => {
    const mine = q.loadCalendar();
    mine.year1[1].status = 'published';
    q.saveCalendar(mine);
    assert.equal(read().year1[1].status, 'published');
  });
});
