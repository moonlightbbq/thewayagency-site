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
 * REVIEWER GATE SEMANTICS (decided 2026-08-07, hold added by BL-07): the
 * licensed review is ADVISORY on silence, BLOCKING on a change request.
 *
 *   no reply   -> publishes on its date (status stays in-review)
 *   "Approved" -> publishes on its date, approved_by recorded
 *   feedback   -> 'changes-requested' HOLD: never publishes, even past its
 *                 date, until the reviewer approves the exact edited version
 *                 SAGE proposed (which sets 'approved') or the content owner
 *                 releases the hold by editing the calendar
 *
 * A reviewer being on vacation must never silently empty a slot. Anything that
 * should STOP a publish belongs in TERMINAL_STATUSES or HOLD_STATUSES below,
 * and stopping is always accompanied by something loud (`error` sets
 * error_reason and exits non-zero; the queue's I4/I2b invariants fail the
 * workflow; a held post at or past its date fails the queue's I6 invariant,
 * and SAGE bells the admins when it puts a post on hold).
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

/**
 * States that HOLD a post: known, not publishable, not terminal. SAGE writes
 * 'changes-requested' when the post's assigned reviewer asks for changes
 * (src/email/blog-reviews.js in sage-server). generate-blog.js skips a held
 * post even when its date has passed, so a live URL is never re-rendered over
 * the reviewer's objection, and queue-status reports it (I6).
 */
const HOLD_STATUSES = Object.freeze(new Set([
  'changes-requested', // the reviewer asked for changes; nothing publishes until they approve
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
  return PUBLISHABLE_STATUSES.has(status) || TERMINAL_STATUSES.has(status) || HOLD_STATUSES.has(status);
}

/** Whether a calendar entry is held (a reviewer's change request is pending). */
function isHeld(status) {
  return HOLD_STATUSES.has(status);
}

/** Slugs of every held entry, in year1 and existing_posts. */
function heldSlugs(calendar) {
  const held = new Set();
  for (const list of [calendar && calendar.year1, calendar && calendar.existing_posts]) {
    for (const p of Array.isArray(list) ? list : []) {
      if (p && p.slug && isHeld(p.status)) held.add(p.slug);
    }
  }
  return held;
}

/**
 * Held slugs from the calendar file, for the blog generator. Never throws: a
 * missing calendar holds nothing, and an unreadable one is reported in `error`
 * (the caller logs it) and holds nothing, so the build still renders the blog
 * instead of losing every post. That is fail-OPEN for holds, chosen because the
 * alternative drops the whole blog, and a calendar that does not parse also
 * stops the publish workflow and the index step that read the same file.
 *
 * @param {string} calendarPath
 * @param {{existsSync: Function, readFileSync: Function}} [fsImpl]
 * @returns {{held: Set<string>, error: string|null}}
 */
function loadHeldSlugs(calendarPath, fsImpl = require('fs')) {
  try {
    if (!fsImpl.existsSync(calendarPath)) return { held: new Set(), error: null };
    return { held: heldSlugs(JSON.parse(fsImpl.readFileSync(calendarPath, 'utf8'))), error: null };
  } catch (err) {
    return { held: new Set(), error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  PUBLISHABLE_STATUSES,
  TERMINAL_STATUSES,
  HOLD_STATUSES,
  isPublishable,
  isKnownStatus,
  isHeld,
  heldSlugs,
  loadHeldSlugs,
};
