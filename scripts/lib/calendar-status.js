/**
 * The content calendar's status vocabulary — one definition, both repos.
 *
 * This exists because the vocabulary was implicit and the two ends disagreed.
 * sage's blog-review reply handler (src/email/blog-reviews.js) sets a post to
 * `approved` when a licensed reviewer replies "Approved", and commits it. The
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
 * REVIEWER GATE SEMANTICS (decided 2026-08-07): the licensed review is
 * ADVISORY, not blocking.
 *
 *   no reply   -> publishes on its date (status stays in-review)
 *   "Approved" -> publishes on its date, approved_by recorded
 *   feedback   -> holds, AI edit, re-sent to the reviewer
 *
 * A reviewer being on vacation must never silently empty a slot. Anything that
 * should STOP a publish belongs in TERMINAL_STATUSES below, and stopping is
 * always accompanied by something loud (`error` sets error_reason and exits
 * non-zero; the queue's I4/I2b invariants fail the workflow).
 */
'use strict';

/**
 * A scheduled post in any of these states still publishes when its date
 * arrives. Add to this set rather than to a caller's local copy.
 */
const PUBLISHABLE_STATUSES = Object.freeze(new Set([
  'planned',    // locked to a slot, drafting/awaiting its review window
  'in-draft',   // draft in flight
  'in-review',  // reviewer emailed, no reply yet — advisory, so it ships
  'approved',   // reviewer replied "Approved" — ships, and says who signed off
]));

/**
 * States that deliberately do NOT publish. Each is paired with a loud signal
 * elsewhere; none of them is a silent skip.
 */
const TERMINAL_STATUSES = Object.freeze(new Set([
  'published',  // already shipped
  'error',      // readiness check failed; carries error_reason + red workflow
]));

/** Whether a calendar entry should publish once its date arrives. */
function isPublishable(status) {
  return PUBLISHABLE_STATUSES.has(status);
}

/**
 * Whether a status is one this system knows at all. An unrecognised status is
 * a contract breach between the two repos and must be surfaced, not skipped —
 * that silence is the whole reason this module exists.
 */
function isKnownStatus(status) {
  return PUBLISHABLE_STATUSES.has(status) || TERMINAL_STATUSES.has(status);
}

module.exports = {
  PUBLISHABLE_STATUSES,
  TERMINAL_STATUSES,
  isPublishable,
  isKnownStatus,
};
