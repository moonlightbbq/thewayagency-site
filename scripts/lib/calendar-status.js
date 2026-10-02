/**
 * The content calendar's status vocabulary — one definition, both repos.
 *
 * This exists because the vocabulary was implicit and the two ends disagreed.
 * sage sets a post to `approved` when its assigned, licensed reviewer approves
 * it (since BL-07 by a click in SAGE on the exact text:
 * src/services/blog-review-approval.js; since 2026-10-02 also by a verified
 * "APPROVED" email reply from a reviewer who reviews by email), and commits it. The
 * publisher (scripts/publish-scheduled-posts.js) only recognised
 * planned/in-review/in-draft, so it skipped `approved` entirely — with a bare
 * `continue`, so no error, no red run, no alarm. And occupiedDates() counts any
 * non-published entry as owning its date, so the queue saw the slot as filled
 * and no invariant fired either.
 *
 * The net effect: **approving a post was what stopped it from publishing.**
 * It was never caught because no reviewer reply had ever been processed in
 * production, and because no test spans both repos — the sage-side test
 * asserted the write and could not see that the site would refuse to act on it.
 *
 * REVIEWER GATE SEMANTICS. Decided 2026-08-07 (advisory on silence), hold and
 * SAGE approval added by BL-07, and REVERSED for silence by the owner on
 * 2026-10-02: "Should a licensed agent's approval be required before a blog
 * post publishes?" -> "Required - but if they do not approve, and are silent,
 * then they get daily emails the 3 days leading up to publishing." The
 * licensed review is now REQUIRED: only an approval by the post's assigned,
 * licensed reviewer publishes it, and a "Reviewed by" credit comes with it
 * (scripts/lib/review-credit.js).
 *
 *   no action          -> HELD: it does not publish or render on its date. Not
 *                         'error' and not silent: the entry keeps its status
 *                         and its date, the publisher logs it as HELD, and the
 *                         queue's I8 invariant fails the publish workflow
 *                         while it is due without approval. The reviewer is
 *                         emailed at D-14 (the request), D-7, and on each of
 *                         D-3, D-2 and D-1 (scripts/send-review-emails.js).
 *                         Once they approve, it publishes on the first publish
 *                         run after the approval, as long as it is still
 *                         scheduled for the date it was approved for
 *                         (review-credit.js 'approval_rescheduled'); the
 *                         content owner re-dating it means a new approval for
 *                         the new date. A held post keeps its date, so the
 *                         queue never books a second post onto it; it blocks
 *                         only that one date.
 *   approved           -> publishes on its date crediting the reviewer, but
 *                         only while the file's raw bytes still hash to the
 *                         approved_sha256 the reviewer approved, the
 *                         approval is the byline reviewer's, it is still
 *                         scheduled for the date it was approved for, and
 *                         SAGE signed it (approval_mac); otherwise the entry
 *                         goes to 'error' (I7) and nothing publishes or
 *                         renders. The approval is a click in SAGE, or, for a
 *                         reviewer whose data/team.json entry says
 *                         "review_via": "email", an "APPROVED" email reply
 *                         that SAGE verified (token, bytes, sender, email
 *                         authentication) and recorded the same way, signed
 *                         the same way, with approved_via 'email'. The
 *                         publisher checks both the same way.
 *   change request     -> 'changes-requested' HOLD: never publishes, even past
 *                         its date, until the reviewer approves a version (the
 *                         edit SAGE proposed, or the current text: either sets
 *                         'approved') or the content owner releases the hold
 *                         by editing the calendar (I6)
 *   any other reply    -> nothing changes; SAGE answers with how to approve
 *   withdrawn          -> the content owner sets an 'approved' entry back to
 *                         'in-review'; the publisher removes the approval
 *                         record it leaves (review-credit.js clearApprovalRecord)
 *
 * ONE EXCEPTION, frozen: ADVISORY_GRANDFATHERED below. SAGE's content-queue
 * commits set posts the publisher had marked 'published' back to planned and
 * in-review (git 0d5b45c, bab0bdc, 63164e3 in this repository), so on
 * 2026-10-02 thirteen posts that are already live on the site sit in main as
 * past-dated 'planned'/'in-review' entries. Applying the new rule to them would
 * take them off the site at the next build, which the owner did not decide.
 * They keep the 2026-08-07 advisory rule (publish uncredited), but only while
 * BOTH the slug and the publish_date are the ones listed: an entry moved to
 * another date, or any other entry back-dated to before the decision, needs an
 * approval like every other post. The list only ever shrinks.
 *
 * A reviewer being on vacation must never silently empty a slot. Anything that
 * STOPS a publish is paired with something loud: 'error' sets error_reason and
 * the queue's I7 invariant fails the workflow; a held post at or past its date
 * fails I6 (change request) or I8 (no approval); I4/I2b fail it too; and SAGE
 * bells the admins when it puts a post on hold.
 */
'use strict';

/**
 * A scheduled post in this state publishes when its date arrives (after
 * review-credit.js approvalCheck). Add to this set rather than to a caller's
 * local copy.
 */
const PUBLISHABLE_STATUSES = Object.freeze(new Set([
  'approved',   // the assigned licensed reviewer approved it (in SAGE, or by a verified email reply): ships crediting them, if its bytes are the approved ones
]));

/**
 * Known states of a post that has not been approved yet. They do NOT publish
 * when their date arrives (owner decision 2026-10-02): the post is HELD on its
 * date until its reviewer approves it (the queue's I8 makes that loud).
 */
const AWAITING_APPROVAL_STATUSES = Object.freeze(new Set([
  'planned',    // locked to a slot, drafting/awaiting its review window
  'in-draft',   // draft in flight
  'in-review',  // reviewer emailed, no approval yet
]));

/**
 * States that deliberately do NOT publish. Each is paired with a loud signal
 * elsewhere; none of them is a silent skip.
 */
const TERMINAL_STATUSES = Object.freeze(new Set([
  'published',  // already shipped
  'error',      // a readiness or approval check failed; carries error_reason + red workflow (I7)
]));

/**
 * States that HOLD a post: known, not publishable, not terminal. SAGE writes
 * 'changes-requested' when the post's assigned reviewer emails a change
 * request (src/email/blog-reviews.js in sage-server), and releases it only
 * when the reviewer approves a version. generate-blog.js skips a held post
 * even when its date has passed (review-credit.js renderDecision), so a live
 * URL is never re-rendered over the reviewer's objection, and queue-status
 * reports it (I6).
 */
const HOLD_STATUSES = Object.freeze(new Set([
  'changes-requested', // the reviewer asked for changes; nothing publishes until they approve
]));

/**
 * The exact (slug, publish_date) pairs that keep the 2026-08-07 advisory rule
 * (see the header): every past-dated 'planned'/'in-review' entry on main on
 * 2026-10-02 whose markdown was on disk, i.e. a post already live on the site.
 * Frozen: never add to it.
 */
const ADVISORY_GRANDFATHERED = Object.freeze([
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
].map(([slug, publishDate]) => Object.freeze({ slug, publish_date: publishDate })));

/** Whether an entry is one of the frozen advisory exceptions (slug AND date). */
function isGrandfathered(entry) {
  return !!entry && AWAITING_APPROVAL_STATUSES.has(entry.status)
    && ADVISORY_GRANDFATHERED.some((g) => g.slug === entry.slug && g.publish_date === String(entry.publish_date || ''));
}

/**
 * Whether a calendar entry should publish once its date arrives: 'approved'
 * (still subject to review-credit.js approvalCheck), or one of the frozen
 * advisory exceptions. Called with the status alone (sage-server's tests do),
 * only 'approved' is publishable.
 * @param {string} status
 * @param {object} [entry]  the calendar entry the status belongs to
 */
function isPublishable(status, entry) {
  if (PUBLISHABLE_STATUSES.has(status)) return true;
  return !!entry && entry.status === status && isGrandfathered(entry);
}

/** Whether a status is a known one that is still waiting for its reviewer's approval. */
function isAwaitingApproval(status) {
  return AWAITING_APPROVAL_STATUSES.has(status);
}

/**
 * Whether an entry is HELD for want of its licensed reviewer's approval: it
 * is awaiting approval, its date has arrived, and it is not an exception.
 * @param {object} entry
 * @param {string} today  YYYY-MM-DD
 */
function heldForApproval(entry, today) {
  return !!entry && isAwaitingApproval(entry.status) && !!entry.publish_date
    && String(entry.publish_date) <= String(today) && !isPublishable(entry.status, entry);
}

/**
 * Whether a status is one this system knows at all. An unrecognised status is
 * a contract breach between the two repos and must be surfaced, not skipped —
 * that silence is the whole reason this module exists.
 */
function isKnownStatus(status) {
  return PUBLISHABLE_STATUSES.has(status) || AWAITING_APPROVAL_STATUSES.has(status)
    || TERMINAL_STATUSES.has(status) || HOLD_STATUSES.has(status);
}

/** Whether a calendar entry is held (a reviewer's change request is pending). */
function isHeld(status) {
  return HOLD_STATUSES.has(status);
}

/**
 * What a held post (heldForApproval) needs, in one sentence, shared by the
 * queue's I8 and the publisher's summary so they never disagree. Review
 * requests go out only from D-18 down to the publish date, so a past-due post
 * that never got one cannot be approved where it stands: it has to move.
 * @param {object} entry       the calendar entry
 * @param {boolean} hasMarkdown whether src/blog/<slug>.md exists
 * @returns {string}
 */
function heldNextStep(entry, hasMarkdown) {
  if (!hasMarkdown) {
    return `its markdown (src/blog/${entry.slug}.md) is missing too, so it cannot be reviewed: write it and move the entry to a future date (the review request goes out from D-18), or remove the entry`;
  }
  if (entry.status === 'in-review' && entry.reviewer_email) {
    return `it is held and publishes on the first publish run after its assigned reviewer approves it, while still scheduled for ${entry.publish_date}`;
  }
  return 'no review request went out for it, so nobody can approve it: move it to a future date (the request goes out from D-18 down to the publish date), or remove the entry';
}

module.exports = {
  PUBLISHABLE_STATUSES,
  AWAITING_APPROVAL_STATUSES,
  TERMINAL_STATUSES,
  HOLD_STATUSES,
  ADVISORY_GRANDFATHERED,
  isGrandfathered,
  isPublishable,
  isAwaitingApproval,
  heldForApproval,
  heldNextStep,
  isKnownStatus,
  isHeld,
};
