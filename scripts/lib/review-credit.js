/**
 * Who a published post credits as its reviewer (sage-server BL-07, AIA-018 and
 * AIA-019) -- one definition for every script that publishes a post.
 *
 * A "Reviewed by" byline puts a licensed agent's name, title and the date they
 * signed off on public text, in the visible byline and in the JSON-LD. Since
 * BL-07 the only sign-off is the assigned reviewer's click in SAGE on the
 * sha256 of the exact bytes of src/blog/<slug>.md (sage-server
 * src/services/blog-review-approval.js). SAGE records it on the calendar
 * entry: status 'approved', approved_by, approved_by_email, approved_date,
 * approved_sha256 (and approved_edit_id when it approved a proposed edit).
 *
 * The click binds those bytes in SAGE, so the publish step binds them too:
 *
 *   status 'approved', and the raw file bytes still hash to approved_sha256,
 *   and the approval is the byline reviewer's  -> publishes CREDITING them
 *   status 'approved', anything else            -> does NOT publish ('error')
 *   any other publishable status (silence)      -> publishes with NO review
 *                                                  line; any it had is removed
 *
 * Anything that changes the file after the click (a later commit, a merged
 * batch PR, a BL-06 promote for the same slug) therefore cannot publish under
 * the reviewer's name. "The approval is the byline reviewer's" means: the
 * address that approved is the entry's reviewer_email, which is still the
 * address data/team.json gives the reviewer_slug member (a licensed one), and
 * the entry's reviewer name is that member's. So an address re-pointed in
 * team.json after the click, or a byline swapped on the calendar, refuses too.
 *
 * The hash covers the file as committed, before this repo's publisher rewrites
 * any front matter (the reviewer lines below, and date/modified): callers hash
 * fs.readFileSync(path) with no encoding, before writing anything.
 */
'use strict';

const crypto = require('crypto');

/** Front-matter keys that make a review claim (generate-blog.js renders them). */
const REVIEWER_FIELDS = Object.freeze(['reviewer', 'reviewer_slug', 'reviewer_title', 'reviewed_date', 'reviewed_by']);
const REVIEWER_LINE = new RegExp(`^(?:${REVIEWER_FIELDS.join('|')})\\s*:`);
const FRONT_MATTER = /^---\n([\s\S]*?)\n---/;
const SHA256_RE = /^[0-9a-f]{64}$/;

const lower = (s) => String(s || '').trim().toLowerCase();

/** sha256 hex of a file's raw bytes. */
function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * A person's name as a comparison key; the same rule as sage-server's
 * personNameKey (src/email/blog-review-guard.js): Unicode-normalized,
 * lower-cased, punctuation dropped, whitespace collapsed.
 */
function personNameKey(name) {
  return String(name || '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Whether this entry may publish, and whether it credits its reviewer.
 * @param {object} post      the calendar entry
 * @param {Buffer} rawBytes  src/blog/<slug>.md as read from disk, before any rewrite
 * @param {Array} team       data/team.json's team list
 * @returns {{credit: boolean, error: string|null, detail?: string}}
 *   error set: the entry must not publish (mark it 'error' with that reason)
 */
function approvalCheck(post, rawBytes, team) {
  if (!post || post.status !== 'approved') return { credit: false, error: null };
  if (!Buffer.isBuffer(rawBytes)) throw new TypeError('approvalCheck: rawBytes must be the file as a Buffer (fs.readFileSync with no encoding)');
  const want = String(post.approved_sha256 || '');
  if (!SHA256_RE.test(want)) {
    return { credit: false, error: 'approval_hash_missing', detail: 'the entry is approved but records no approved_sha256, so it cannot be tied to any text' };
  }
  const got = sha256Hex(rawBytes);
  if (got !== want) {
    return { credit: false, error: 'approved_bytes_changed', detail: `the file is sha256 ${got.slice(0, 12)}, the reviewer approved ${want.slice(0, 12)}` };
  }
  const assigned = lower(post.reviewer_email);
  if (!assigned || lower(post.approved_by_email) !== assigned) {
    return { credit: false, error: 'approval_not_by_assigned_reviewer', detail: 'the address that approved is not the entry\'s reviewer_email' };
  }
  const member = (Array.isArray(team) ? team : []).find((m) => m && post.reviewer_slug && m.slug === post.reviewer_slug);
  const licensed = !!member && Array.isArray(member.license_states) && member.license_states.length > 0;
  if (!member || !licensed || lower(member.email) !== assigned) {
    return { credit: false, error: 'approval_reviewer_not_byline', detail: 'the reviewer_slug member in data/team.json is missing, unlicensed or no longer has the address that approved' };
  }
  const key = personNameKey(member.name);
  if (!key || personNameKey(post.reviewer) !== key) {
    return { credit: false, error: 'approval_reviewer_not_byline', detail: 'the entry\'s reviewer name is not the reviewer_slug member\'s name in data/team.json' };
  }
  return { credit: true, error: null };
}

/** The reviewer's REAL title from team.json, never a hardcoded one. */
function reviewerTitle(team, slug, name) {
  const m = (Array.isArray(team) ? team : []).find((t) => t && (t.slug === slug || t.name === name));
  return (m && m.title) || 'The Way Agency';
}

/** The front matter without any review claim. */
function stripReviewerFields(md) {
  return String(md).replace(FRONT_MATTER, (_m, fm) => `---\n${fm.split('\n').filter((line) => !REVIEWER_LINE.test(line)).join('\n')}\n---`);
}

/**
 * The markdown as it publishes: the review lines set from the calendar entry
 * when `credit` (only ever the result of approvalCheck), else removed.
 * @returns {string}
 */
function applyReviewCredit(md, post, team, { credit }) {
  let out = stripReviewerFields(md);
  if (!credit) return out;
  const fields = {
    reviewer: post.reviewer,
    reviewer_slug: post.reviewer_slug,
    // This used to stamp "Licensed Agent" on everyone, which published posts
    // crediting a Client Care Specialist as a Licensed Agent, in the visible
    // byline AND in the JSON-LD jobTitle.
    reviewer_title: reviewerTitle(team, post.reviewer_slug, post.reviewer),
    // The date they approved it in SAGE.
    reviewed_date: String(post.approved_date || post.review_sent_date || post.publish_date).slice(0, 10),
  };
  for (const [key, value] of Object.entries(fields)) {
    // Inside the front matter block, after whatever it has: `author_slug` is
    // absent on agency-authored posts, so no neighbour field can be assumed.
    out = out.replace(FRONT_MATTER, (_m, fm) => `---\n${fm}\n${key}: ${value}\n---`);
  }
  return out;
}

module.exports = {
  REVIEWER_FIELDS,
  sha256Hex,
  personNameKey,
  approvalCheck,
  reviewerTitle,
  stripReviewerFields,
  applyReviewCredit,
};
