/**
 * Who a blog post credits as its reviewer, and whether a scheduled post renders
 * at all (sage-server BL-07, AIA-018 and AIA-019). One definition for every
 * script that publishes or renders a post: publish-scheduled-posts.js,
 * reconcile-calendar.js and generate-blog.js (the renderer, which is the step
 * that actually puts a page on the site).
 *
 * A "Reviewed by" byline puts a licensed agent's name, title and the date they
 * signed off on public text, in the visible byline and in the JSON-LD. Since
 * BL-07 the only sign-off is the assigned reviewer's click in SAGE on the
 * sha256 of the exact bytes of src/blog/<slug>.md (sage-server
 * src/services/blog-review-approval.js). SAGE records it on the calendar entry:
 * status 'approved', approved_by, approved_by_email, approved_date,
 * approved_sha256, approved_publish_date (the publish_date it was approved
 * for), approved_edit_id (when it approved a proposed edit) and approval_mac,
 * an HMAC over those fields with BLOG_REVIEW_TOKEN_SECRET that only a holder of
 * the secret can make. Plain calendar fields prove nothing: anyone who can edit
 * data/content-calendar.json could type them.
 *
 * An approval counts only while the entry is 'approved' and still scheduled
 * for the date it was approved for. Withdrawing one: the content owner sets
 * the entry back to 'in-review' (or SAGE holds it); the publisher then removes
 * the approval record from any entry that is not 'approved', 'published' or
 * 'error' (clearApprovalRecord), and an entry that publishes without a credit
 * keeps none. A rescheduled approval is refused ('approval_rescheduled'), so a
 * withdrawn approval cannot be put back onto the post's new date. What the MAC
 * cannot stop: someone with write access to this repository copying a past,
 * genuine approval back onto the same entry, for the same bytes and the same
 * date, before it publishes (a static site has no record of withdrawals to
 * check against). That copy is a commit in this repository's history.
 *
 *   APPROVAL (status 'approved', before the publisher runs)
 *     the raw file bytes hash to approved_sha256, the approval is the byline
 *     reviewer's, it is for the entry's publish_date, and approval_mac
 *     verifies                                  -> publishes CREDITING them
 *     anything else                             -> does NOT publish ('error',
 *                                                  and the renderer skips it)
 *     no secret here to verify with             -> the publisher leaves it
 *                                                  'approved'; the renderer
 *                                                  renders it uncredited
 *   CREDIT (status 'published', after it)
 *     the publisher credits a reviewer only after the check above, then
 *     records credited_sha256 (the sha256 of the file it committed, review
 *     lines and date rewrite included) and credit_mac (an HMAC over the slug,
 *     credited_sha256 and approval_mac). The renderer prints "Reviewed by"
 *     only while the file still hashes to credited_sha256 and both MACs
 *     verify. Any later change to the file drops the byline.
 *   SILENCE (any other publishable status)       -> publishes with NO review
 *                                                  line; any it has is ignored
 *                                                  by the renderer and removed
 *                                                  by the publisher, and so is
 *                                                  any approval record left on
 *                                                  the entry
 *
 * "The approval is the byline reviewer's" means: the address that approved is
 * the entry's reviewer_email, which is still the address data/team.json gives
 * the reviewer_slug member (a licensed one), and the entry's reviewer name is
 * that member's. So an address re-pointed in team.json after the click, or a
 * byline swapped on the calendar, refuses too.
 *
 * Front-matter keys are read the way generate-blog.js's parseFrontMatter reads
 * them (the text before the first ':' on a line, trimmed), and review keys are
 * matched case-insensitively, so " reviewer: X" or "Reviewer: X" is a review
 * claim here exactly when the renderer could print it.
 *
 * The approval hash covers the file as committed, before this repo's publisher
 * rewrites any front matter: callers hash fs.readFileSync(path) with no
 * encoding, before writing anything.
 */
'use strict';

const crypto = require('crypto');
const contentGuard = require('./blog-content-guard');

/** Front-matter keys that make a review claim (generate-blog.js renders them). */
const REVIEWER_FIELDS = Object.freeze(['reviewer', 'reviewer_slug', 'reviewer_title', 'reviewed_date', 'reviewed_by']);
// The renderer's front-matter block: generate-blog.js parseFrontMatter matches
// /^---\n([\s\S]*?)\n---\n([\s\S]*)$/. A file it does not match renders with no
// front matter (and is skipped for having no title), so this is the only block
// a review line can be read from.
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Shared with sage-server (src/email/blog-review-guard.js). The secret is the
// one that signs review-request tokens; the version strings keep the messages
// apart. v2 added approved_publish_date (v1 was never deployed).
const MIN_SECRET_LENGTH = 32;
const APPROVAL_MAC_VERSION = 'blog-review-approval/v2';
const CREDIT_MAC_VERSION = 'blog-review-credit/v1';
const MIN_WORDS = 200;
// The approval and credit record SAGE and the publisher write on an entry.
const APPROVAL_RECORD_FIELDS = Object.freeze([
  'approved_by', 'approved_by_email', 'approved_date', 'approved_sha256', 'approved_publish_date', 'approved_edit_id',
  'approval_mac', 'credited_sha256', 'credit_mac',
]);

const lower = (s) => String(s || '').trim().toLowerCase();

/** sha256 hex of a file's raw bytes. */
function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** BLOG_REVIEW_TOKEN_SECRET when it is usable (32+ characters), else null. */
function reviewSecret(env = process.env) {
  const s = env && typeof env.BLOG_REVIEW_TOKEN_SECRET === 'string' ? env.BLOG_REVIEW_TOKEN_SECRET : '';
  return s.length >= MIN_SECRET_LENGTH ? s : null;
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

/** The key generate-blog.js reads from a front-matter line, or null. */
function frontMatterKey(line) {
  const idx = String(line).indexOf(':');
  return idx > 0 ? String(line).slice(0, idx).trim() : null;
}

/** Whether a front-matter key makes a review claim (trimmed, any case). */
function isReviewerKey(key) {
  return key !== null && key !== undefined && REVIEWER_FIELDS.includes(String(key).trim().toLowerCase());
}

/** The front matter without any review claim; every other byte unchanged. */
function stripReviewerFields(md) {
  const s = String(md);
  const m = FRONT_MATTER.exec(s);
  if (!m) return s;
  const kept = m[1].split('\n').filter((line) => !isReviewerKey(frontMatterKey(line)));
  return `---\n${kept.join('\n')}\n---\n${s.slice(m[0].length)}`;
}

/** Whether the front matter carries any review claim. */
function hasReviewerFields(md) {
  const m = FRONT_MATTER.exec(String(md));
  return !!m && m[1].split('\n').some((line) => isReviewerKey(frontMatterKey(line)));
}

// ─── Signed records ─────────────────────────────────────────────────────────

const _clean = (v) => !/[|\r\n\u0000]/.test(String(v));

/**
 * The message approval_mac signs, or null when a field could make it
 * ambiguous. sage-server builds the same string (blog-review-guard.js
 * approvalMacMessage); a fixed test vector pins the two together.
 *
 *   blog-review-approval/v2|<slug>|<reviewer_slug>|<reviewer_email, lowercased>
 *     |<approved_by_email, lowercased>|<approved_sha256>|<approved_date>
 *     |<approved_publish_date>|<approved_edit_id or ''>
 */
function approvalMacMessage(post) {
  if (!post) return null;
  const parts = [
    APPROVAL_MAC_VERSION,
    String(post.slug || ''),
    String(post.reviewer_slug || ''),
    lower(post.reviewer_email),
    lower(post.approved_by_email),
    String(post.approved_sha256 || ''),
    String(post.approved_date || ''),
    String(post.approved_publish_date || ''),
    String(post.approved_edit_id || ''),
  ];
  if (!parts[1] || !parts[2] || !parts[3] || !parts[4] || !SHA256_RE.test(parts[5]) || !DATE_RE.test(parts[6]) || !DATE_RE.test(parts[7])) return null;
  if (!parts.every(_clean)) return null;
  return parts.join('|');
}

function _hmac(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(message, 'utf8').digest('base64url');
}

function _macEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** approval_mac for an entry's approval fields (SAGE makes it; tests use this). */
function signApproval(post, secret) {
  if (!secret || String(secret).length < MIN_SECRET_LENGTH) throw new Error(`signApproval: the secret must be at least ${MIN_SECRET_LENGTH} characters`);
  const message = approvalMacMessage(post);
  if (!message) throw new Error('signApproval: slug, reviewer_slug, reviewer_email, approved_by_email, approved_sha256, approved_date and approved_publish_date are required, and none may contain "|" or a line break');
  return _hmac(secret, message);
}

/** Whether the entry's approval_mac is SAGE's signature over its approval fields. */
function approvalSigned(post, secret) {
  if (!secret) return false;
  const message = approvalMacMessage(post);
  return !!message && _macEqual(post.approval_mac, _hmac(secret, message));
}

function _creditMessage(post) {
  const parts = [CREDIT_MAC_VERSION, String(post.slug || ''), String(post.credited_sha256 || ''), String(post.approval_mac || '')];
  if (!parts[1] || !SHA256_RE.test(parts[2]) || !parts[3] || !parts.every(_clean)) return null;
  return parts.join('|');
}

/**
 * Record that this entry was published crediting its reviewer, bound to the
 * exact bytes committed. Call only after approvalCheck() returned credit.
 */
function recordCredit(post, committedBytes, secret) {
  if (!Buffer.isBuffer(committedBytes)) throw new TypeError('recordCredit: committedBytes must be the file as a Buffer');
  post.credited_sha256 = sha256Hex(committedBytes);
  const message = _creditMessage(post);
  if (!secret || !message) throw new Error('recordCredit: needs the secret and a signed approval');
  post.credit_mac = _hmac(secret, message);
}

/** Remove a credit record (a post that publishes without a credit). */
function clearCredit(post) {
  delete post.credited_sha256;
  delete post.credit_mac;
}

/** Whether an entry carries any part of an approval or credit record. */
function hasApprovalRecord(post) {
  return !!post && APPROVAL_RECORD_FIELDS.some((k) => post[k] !== undefined);
}

/**
 * Remove the approval and credit record from an entry: one that publishes
 * without a credit, or one that is no longer 'approved' (a withdrawn approval).
 * @returns {boolean} whether anything was removed
 */
function clearApprovalRecord(post) {
  if (!hasApprovalRecord(post)) return false;
  for (const k of APPROVAL_RECORD_FIELDS) delete post[k];
  return true;
}

// ─── Decisions ──────────────────────────────────────────────────────────────

/** The member data/team.json gives this entry's reviewer_slug, or null. */
function _member(team, post) {
  return (Array.isArray(team) ? team : []).find((m) => m && post.reviewer_slug && m.slug === post.reviewer_slug) || null;
}

/**
 * Whether an 'approved' entry may publish, and whether it credits its reviewer.
 * @param {object} post      the calendar entry
 * @param {Buffer} rawBytes  src/blog/<slug>.md as read from disk, before any rewrite
 * @param {Array} team       data/team.json's team list
 * @param {{secret?: string|null}} [opts]  reviewSecret(): verifies approval_mac
 * @returns {{credit: boolean, error: string|null, unverifiable?: boolean, detail?: string}}
 *   error set: the entry must not publish (mark it 'error' with that reason)
 *   unverifiable: there is no secret here to check SAGE's signature with; the
 *     entry must neither publish nor be marked 'error' (leave it for a run that
 *     has the secret)
 */
function approvalCheck(post, rawBytes, team, { secret = null } = {}) {
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
  const member = _member(team, post);
  const licensed = !!member && Array.isArray(member.license_states) && member.license_states.length > 0;
  if (!member || !licensed || lower(member.email) !== assigned) {
    return { credit: false, error: 'approval_reviewer_not_byline', detail: 'the reviewer_slug member in data/team.json is missing, unlicensed or no longer has the address that approved' };
  }
  const key = personNameKey(member.name);
  if (!key || personNameKey(post.reviewer) !== key) {
    return { credit: false, error: 'approval_reviewer_not_byline', detail: 'the entry\'s reviewer name is not the reviewer_slug member\'s name in data/team.json' };
  }
  if (post.approved_publish_date !== undefined && String(post.approved_publish_date) !== String(post.publish_date || '')) {
    return { credit: false, error: 'approval_rescheduled', detail: `the reviewer approved it for publication on ${post.approved_publish_date}, and it is now scheduled for ${post.publish_date || 'no date'}` };
  }
  if (!secret) {
    return { credit: false, error: null, unverifiable: true, detail: 'BLOG_REVIEW_TOKEN_SECRET is not set here, so SAGE\'s signature on the approval cannot be checked' };
  }
  if (!approvalSigned(post, secret)) {
    return { credit: false, error: 'approval_unsigned', detail: 'the approval carries no valid approval_mac: SAGE did not record it (or it was edited after SAGE did)' };
  }
  return { credit: true, error: null };
}

/**
 * Whether a 'published' entry's "Reviewed by" may render: the publisher
 * credited it after approvalCheck, the file is still the one it committed,
 * and the reviewer is still a licensed data/team.json member with the
 * credited address and name (one who left, lost their licences, or whose slug
 * now names someone else is credited no longer: the page renders uncredited).
 * @param {{secret?: string|null, team?: Array}} [opts]  team: data/team.json's
 *   team list; without it no credit renders
 * @returns {{credit: boolean, reason: string}}
 */
function creditCheck(post, rawBytes, { secret = null, team = null } = {}) {
  if (!post || post.status !== 'published') return { credit: false, reason: 'not published' };
  if (!post.credited_sha256 && !post.credit_mac) return { credit: false, reason: 'no credit recorded' };
  if (!secret) return { credit: false, reason: 'BLOG_REVIEW_TOKEN_SECRET is not set here, so the credit cannot be verified' };
  if (!Buffer.isBuffer(rawBytes)) throw new TypeError('creditCheck: rawBytes must be the file as a Buffer');
  if (sha256Hex(rawBytes) !== post.credited_sha256) return { credit: false, reason: 'the file changed after it was published crediting its reviewer' };
  if (lower(post.approved_by_email) !== lower(post.reviewer_email) || !approvalSigned(post, secret)) {
    return { credit: false, reason: 'the approval it credits is not signed by SAGE' };
  }
  const message = _creditMessage(post);
  if (!message || !_macEqual(post.credit_mac, _hmac(secret, message))) return { credit: false, reason: 'the credit record is not the publisher\'s' };
  const member = _member(team, post);
  if (!member || !Array.isArray(member.license_states) || member.license_states.length === 0) {
    return { credit: false, reason: 'the credited reviewer is no longer a licensed data/team.json member' };
  }
  // As approvalCheck: the reviewer_slug member must still be the person
  // credited (their address and name), so a slug handed to someone else in
  // data/team.json does not keep an old credit linked to its new holder.
  const key = personNameKey(member.name);
  if (lower(member.email) !== lower(post.reviewer_email) || !key || personNameKey(post.reviewer) !== key) {
    return { credit: false, reason: 'the reviewer_slug member in data/team.json is no longer the credited reviewer (another address or name)' };
  }
  return { credit: true, reason: 'credited' };
}

/**
 * Why a post's front matter is unsafe to publish or render, or null
 * (scripts/lib/blog-content-guard.js, the same file sage-server's BL-06
 * promote and BL-07 approval check): markup or an invisible, control or bidi
 * character in a value, or an unsafe slug or a date that is not the plain
 * form. Deterministic rules only: wording that reads as
 * a review credit is a warning (reviewWordingWarnings), never a reason, and so
 * is who the byline names (the renderer prints the data/team.json member
 * author_slug names, or the agency: bylineAuthor), so a team.json edit never
 * takes a post off the site. Defence in depth behind the renderer's output
 * encoding (every value stays text) and its byline (printed from
 * data/team.json and a signed approval only).
 * @param {string} md
 */
function frontMatterProblem(md) {
  return contentGuard.frontMatterProblem(md);
}

/**
 * Review or approval credit wording in the text a post prints (front-matter
 * values, the body as the page prints it, each FAQ question and answer), as
 * warnings to log: [{field, text, wording}]. Never a reason not to publish or
 * render; the post carries no structured credit unless its reviewer approved
 * it in SAGE.
 * @param {string} md
 * @param {Array} team  data/team.json's team list
 */
function reviewWordingWarnings(md, team) {
  return contentGuard.reviewWordingWarnings(md, team);
}

// Warning fields that are not a front-matter key.
const TEXT_FIELDS = Object.freeze(['body', 'FAQ', 'rendered text', 'calendar title', 'calendar description']);

/** One log line for a review-wording warning (scripts log these; nothing is refused for one). */
function describeWordingWarning(slug, w) {
  const where = TEXT_FIELDS.includes(w.field) ? `the ${w.field}` : `the front-matter ${JSON.stringify(String(w.field))}`;
  return `  ! ${slug}: review-credit wording in ${where}: ${JSON.stringify(String(w.text))}. `
    + `${contentGuard.REVIEW_WORDING_NOTICE} It is printed as written.`;
}

/**
 * Why a markdown file is not ready to publish (the publisher's readiness
 * checks), or null: 'missing_frontmatter', 'unsafe_frontmatter' or
 * 'content_too_short'.
 * @param {string} md
 */
function readinessError(md) {
  const text = String(md);
  if (!text.includes('title:') || !text.includes('description:')) return 'missing_frontmatter';
  if (frontMatterProblem(text)) return 'unsafe_frontmatter';
  const words = text.replace(/---[\s\S]*?---/, '').trim().split(/\s+/).length;
  if (words < MIN_WORDS) return 'content_too_short';
  return null;
}

/** The reviewer's REAL title from team.json, never a hardcoded one. */
function reviewerTitle(team, slug, name) {
  const m = (Array.isArray(team) ? team : []).find((t) => t && (t.slug === slug || t.name === name));
  return (m && m.title) || 'The Way Agency';
}

const _oneLine = (v) => String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').trim();

/**
 * The markdown as it publishes: the review lines set from the approval when
 * `credit` (only ever the result of approvalCheck), else removed.
 * @returns {string}
 */
function applyReviewCredit(md, post, team, { credit }) {
  let out = stripReviewerFields(md);
  if (!credit) return out;
  // The name, slug and title are the team.json member approvalCheck bound the
  // approval to, not free text from the calendar entry.
  const member = _member(team, post) || {};
  const fields = {
    reviewer: _oneLine(member.name || post.reviewer),
    reviewer_slug: _oneLine(member.slug || post.reviewer_slug),
    // This used to stamp "Licensed Agent" on everyone, which published posts
    // crediting a Client Care Specialist as a Licensed Agent, in the visible
    // byline AND in the JSON-LD jobTitle.
    reviewer_title: _oneLine(member.title || reviewerTitle(team, post.reviewer_slug, post.reviewer)),
    // The date they approved it in SAGE (it is inside approval_mac).
    reviewed_date: _oneLine(post.approved_date).slice(0, 10),
  };
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  // Inside the front matter block, after whatever it has: `author_slug` is
  // absent on agency-authored posts, so no neighbour field can be assumed.
  return out.replace(FRONT_MATTER, (_m, fm) => `---\n${fm}\n${lines}\n---\n`);
}

/**
 * What the renderer does with one markdown file: whether it renders, and with
 * which markdown (review lines only when the credit is proven). It renders
 * exactly what the publisher would publish:
 *
 *   unsafe front matter             -> not rendered (frontMatterProblem:
 *                                      the deterministic rules only; review
 *                                      wording is a warning the caller logs)
 *   not on the calendar             -> renders (by its own date:), no credit
 *   held ('changes-requested')      -> not rendered
 *   'error', or an unknown status   -> not rendered
 *   'published'                     -> renders; credited only by creditCheck
 *   publishable, publish_date ahead -> not rendered yet
 *   publishable, due                -> rendered only if the publisher would
 *                                      publish it now (readiness, approval);
 *                                      an 'approved' one is credited as the
 *                                      publisher would credit it (without the
 *                                      secret it renders uncredited)
 *
 * @param {object|null} entry  the calendar entry for this slug (year1 or existing_posts)
 * @param {Buffer} rawBytes    the file's raw bytes
 * @param {Array} team         data/team.json's team list
 * @param {{secret?: string|null, today: string, isKnownStatus: Function, isPublishable: Function, isHeld: Function}} opts
 * @returns {{render: boolean, credit: boolean, markdown: string, why: string}}
 */
function renderDecision(entry, rawBytes, team, opts) {
  const { secret = null, today, isKnownStatus, isPublishable, isHeld } = opts;
  const text = rawBytes.toString('utf8');
  const stripped = () => stripReviewerFields(text);
  const unsafe = frontMatterProblem(text);
  if (unsafe) return { render: false, credit: false, markdown: '', why: `${unsafe} (unsafe_frontmatter)` };
  if (!entry) return { render: true, credit: false, markdown: stripped(), why: 'not on the content calendar' };
  const status = entry.status;
  if (isHeld(status)) return { render: false, credit: false, markdown: '', why: 'its reviewer requested changes; it renders once they approve a version in SAGE or the hold is released' };
  if (status === 'error') return { render: false, credit: false, markdown: '', why: `the publisher put it in error (${entry.error_reason || 'no reason recorded'})` };
  if (!isKnownStatus(status)) return { render: false, credit: false, markdown: '', why: `unrecognised calendar status "${status}"` };
  if (status === 'published') {
    const c = creditCheck(entry, rawBytes, { secret, team });
    return { render: true, credit: c.credit, markdown: c.credit ? text : stripped(), why: c.credit ? 'published, credited' : `published, no reviewer credited (${c.reason})` };
  }
  if (!isPublishable(status)) return { render: false, credit: false, markdown: '', why: `status "${status}" does not publish` };
  if (!entry.publish_date || String(entry.publish_date) > today) return { render: false, credit: false, markdown: '', why: `scheduled for ${entry.publish_date || 'no date'}` };
  const notReady = readinessError(text);
  if (notReady) return { render: false, credit: false, markdown: '', why: `not ready to publish (${notReady})` };
  const approval = approvalCheck(entry, rawBytes, team, { secret });
  if (approval.error) return { render: false, credit: false, markdown: '', why: `approved in SAGE, but ${approval.detail} (${approval.error})` };
  // No secret in this build: the approval cannot be verified, so it credits
  // no one, but the post renders as it would on silence (a planned or
  // in-review post with these bytes renders uncredited today). Taking it off
  // the site until the publisher runs would punish the reviewer's approval.
  if (approval.unverifiable) return { render: true, credit: false, markdown: stripped(), why: `approved in SAGE, but ${approval.detail}; rendered with no reviewer credited` };
  return {
    render: true,
    credit: approval.credit,
    markdown: applyReviewCredit(text, entry, team, { credit: approval.credit }),
    why: approval.credit ? 'due, approved in SAGE, credited' : 'due, no reviewer credited',
  };
}

module.exports = {
  REVIEWER_FIELDS,
  APPROVAL_RECORD_FIELDS,
  MIN_SECRET_LENGTH,
  APPROVAL_MAC_VERSION,
  CREDIT_MAC_VERSION,
  sha256Hex,
  reviewSecret,
  personNameKey,
  frontMatterKey,
  isReviewerKey,
  stripReviewerFields,
  hasReviewerFields,
  approvalMacMessage,
  signApproval,
  approvalSigned,
  recordCredit,
  clearCredit,
  hasApprovalRecord,
  clearApprovalRecord,
  approvalCheck,
  creditCheck,
  frontMatterProblem,
  reviewWordingWarnings,
  describeWordingWarning,
  readinessError,
  reviewerTitle,
  applyReviewCredit,
  renderDecision,
};
