#!/usr/bin/env node
/**
 * The Way Agency  -  Scheduled Blog Publisher
 *
 * Checks content-calendar.json for posts with a publish_date <= today
 * whose status is publishable (see scripts/lib/calendar-status.js -- the
 * vocabulary is shared with sage, which writes 'approved'), verifies the markdown
 * file exists, decides the review credit (scripts/lib/review-credit.js: an
 * 'approved' post publishes crediting its reviewer only while its bytes are the
 * ones its reviewer approved, else it goes to 'error'), reconciles its
 * frontmatter date:/modified: to the calendar publish_date, and updates the
 * status to "published".
 *
 * Since the owner's decision of 2026-10-02 the licensed review is REQUIRED: a
 * due post that is still planned, in-draft or in-review is HELD. It is logged
 * ("HELD (no licensed approval)"), nothing on the entry or the file changes,
 * and it is not an error: the queue's I8 invariant turns the workflow red
 * while it is held. It publishes on the first run after its assigned reviewer
 * approves it, while it is still scheduled for the date they approved it for.
 * (The frozen advisory exceptions in calendar-status.js publish uncredited.)
 *
 * Used by the GitHub Actions workflow to auto-publish blog posts on schedule.
 *
 * Every file it changes is written at the end of the run (posts first, then the
 * calendar), so a run that dies part-way leaves nothing half-applied.
 *
 * Exit codes:
 *   0 = ran cleanly: posts published, nothing due, or due posts HELD for
 *       their reviewer's approval (I8 reports those)
 *   3 = one or more due posts failed a check (missing or unready markdown, or an
 *       approval in SAGE whose bytes, byline or signature no longer match): each
 *       entry is marked status='error' with error_reason, and any other changes
 *       of the run are written too. The workflow commits them and its queue
 *       check (scripts/queue-status.js I7: an entry in 'error') turns the run red.
 *   2 = an approved post could not be verified here (BLOG_REVIEW_TOKEN_SECRET is
 *       not set): it is left 'approved', neither published nor marked 'error'
 *   1 = the script itself failed (an uncaught error)
 *
 * Usage: node scripts/publish-scheduled-posts.js
 */

const fs = require('fs');
const path = require('path');
const { isPublishable, isKnownStatus, isAwaitingApproval, heldNextStep } = require('./lib/calendar-status');
const {
  approvalCheck, applyReviewCredit, readinessError, frontMatterProblem, reviewWordingWarnings, describeWordingWarning,
  reviewSecret, recordCredit, clearApprovalRecord,
} = require('./lib/review-credit');

const ROOT = path.resolve(__dirname, '..');
const CALENDAR_PATH = path.join(ROOT, 'data', 'content-calendar.json');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');

const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

const calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));

// team.json is the single source of truth for who holds which title.
const TEAM_PATH = path.join(__dirname, '..', 'data', 'team.json');
const TEAM = (() => {
  try {
    const t = JSON.parse(fs.readFileSync(TEAM_PATH, 'utf8'));
    return Array.isArray(t) ? t : (t.team || []); // file is { team: [...] }
  } catch { return []; }
})();


// Verifies SAGE's signature on an approval (approval_mac) and signs the credit
// record (credit_mac). Same value as the sage .env; the workflow passes it.
const SECRET = reviewSecret(process.env);

let published = 0;
const errors = [];
const held = [];
const unverified = [];
let calendarChanged = false;
// path -> final text. Written at the end: posts first, then the calendar.
const pendingWrites = new Map();

const NOT_READY_WHY = {
  missing_frontmatter: 'missing title or description in frontmatter',
  content_too_short: 'content too short (need 200+ words)',
  unsafe_frontmatter: 'its front matter is unsafe to publish',
};
// The guard's own explanation (scripts/lib/blog-content-guard.js), for the log.
function notReadyDetail(reason, md) {
  return reason === 'unsafe_frontmatter' ? frontMatterProblem(md) : null;
}

// A withdrawn approval does not stay on the entry. SAGE writes an approval
// record only together with status 'approved'; on an entry that is now
// planned, in-draft, in-review or held it is one the content owner withdrew
// (by setting the entry back to 'in-review') or SAGE released, and leaving it
// there would let anyone who can edit the calendar re-activate it by setting
// the status back. 'published' and 'error' entries keep theirs (the credit,
// and the evidence of what failed).
for (const post of calendar.year1) {
  if (!post || ['approved', 'published', 'error'].includes(post.status) || !isKnownStatus(post.status)) continue;
  if (clearApprovalRecord(post)) {
    calendarChanged = true;
    console.log(`  ~ ${post.slug}: removed the approval record left on an entry that is '${post.status}' (a withdrawn approval)`);
  }
}

/** Mark a due entry 'error' (once; the approval evidence on it is kept). */
function markError(post, reason) {
  if (post.status !== 'error' || post.error_reason !== reason) {
    post.status = 'error';
    post.error_reason = reason;
    post.error_at = new Date().toISOString();
    calendarChanged = true;
  }
  errors.push({ slug: post.slug, reason });
}

for (const post of calendar.year1) {
  // Publishable states come from the shared vocabulary, not a local list.
  // The local list is what broke: it omitted 'approved', so a reviewer
  // replying "Approved" silently stopped their own post from publishing.
  if (post.publish_date > today) continue;
  if (!isPublishable(post.status, post)) {
    // Due, but its licensed reviewer has not approved it (owner decision
    // 2026-10-02): HELD. Nothing changes on the entry or the file, so it
    // publishes on the first run after the approval while it is still
    // scheduled for this date. Not an error, and not silent: the line below,
    // the summary, and the queue's I8 invariant (red workflow).
    if (isAwaitingApproval(post.status)) {
      const md = fs.existsSync(path.join(BLOG_SRC, `${post.slug}.md`));
      console.log(`  ! HELD (no licensed approval): "${post.title}" (${post.slug}) due ${post.publish_date}, status ${post.status}, `
        + `reviewer ${post.reviewer_email ? `${post.reviewer || '?'} <${post.reviewer_email}>` : 'none assigned'}${md ? '' : ', and its markdown is missing'}`);
      held.push({ slug: post.slug, date: post.publish_date, next: heldNextStep(post, md) });
      continue;
    }
    // An unknown status is a contract breach between this repo and sage, and
    // skipping it quietly is exactly the failure mode this guards. Terminal
    // states (published/error) are expected and stay silent.
    if (!isKnownStatus(post.status)) {
      const reason = `unrecognised status "${post.status}" — not in the shared calendar-status vocabulary`;
      if (post.status !== 'error' || post.error_reason !== reason) {
        post.error_reason = reason;
        post.error_at = new Date().toISOString();
        calendarChanged = true;
      }
      errors.push({ slug: post.slug, reason });
    }
    continue;
  }

  // Readiness check: markdown file must exist. If a post is on the
  // calendar with a publish_date in the past and there's no markdown,
  // sage's BlogPlannerAdapter and BlogDraftsCronAdapter dropped the ball
  // somewhere upstream. Mark the entry status='error' so it's visible
  // and surface a non-zero exit so the GitHub Actions run shows red.
  const mdFile = path.join(BLOG_SRC, `${post.slug}.md`);
  if (!fs.existsSync(mdFile)) {
    console.log(`  ! ERROR: "${post.title}" (${post.slug}) - markdown file not found: src/blog/${post.slug}.md`);
    markError(post, 'missing_markdown');
    continue;
  }

  // Raw bytes: what the reviewer approved, hashed before anything is rewritten.
  const raw = fs.readFileSync(mdFile);
  const mdContent = raw.toString('utf8');

  // Readiness checks: title and description in the front matter, and more
  // than 200 words of body (the same rule the renderer applies).
  const notReady = readinessError(mdContent);
  if (notReady) {
    const detail = notReadyDetail(notReady, mdContent);
    console.log(`  ! ERROR: "${post.title}" (${post.slug}) - ${NOT_READY_WHY[notReady] || notReady}${detail ? `: ${detail}` : ''}`);
    markError(post, notReady);
    continue;
  }

  // Who the post credits as its reviewer (scripts/lib/review-credit.js).
  //
  // This used to overwrite `author` with the reviewer's name, which credited
  // them with writing a post they had only checked. The two are separate
  // things now: the drafting is the agency's, the review is the named agent's,
  // and generate-blog.js renders "Written by" and "Reviewed by" from the two
  // different fields.
  //
  // The licensed review is REQUIRED (scripts/lib/calendar-status.js, owner
  // decision 2026-10-02): only an 'approved' entry reaches this point, or one
  // of the frozen advisory exceptions, which makes no "Reviewed by" claim and
  // has any review line it carries removed. The approval credits the
  // reviewer: their approval of the sha256 of the exact bytes (a click in
  // SAGE, or a verified emailed APPROVED) sets status 'approved',
  // approved_sha256 and SAGE's approval_mac (sage-server BL-07). The bytes,
  // the byline and the signature are checked again HERE,
  // before anything below rewrites the front matter: a file changed after the
  // click, an approval that is not the byline reviewer's, or one SAGE did not
  // sign does not publish at all, it goes to 'error'.
  const approval = approvalCheck(post, raw, TEAM, { secret: SECRET });
  if (approval.error) {
    console.log(`  ! ERROR: "${post.title}" (${post.slug}) - approved in SAGE, but ${approval.detail}. Not published, and no reviewer credited.`);
    console.log('      To publish it: the assigned reviewer approves the current text, for the current date, in SAGE (set the entry back to "in-review" first), or the approved bytes and date are restored.');
    markError(post, approval.error);
    continue;
  }
  if (approval.unverifiable) {
    console.log(`  ! NOT PUBLISHED: "${post.title}" (${post.slug}) - ${approval.detail}. Left 'approved' for a run that has the secret.`);
    unverified.push(post.slug);
    continue;
  }

  let md = applyReviewCredit(mdContent, post, TEAM, { credit: approval.credit });

  // Reconcile frontmatter dates: if the .md `date:`/`modified:` differ from
  // the calendar publish_date, rewrite them. A future-dated `date:` would
  // otherwise make generate-blog.js skip the post even though it just got
  // marked published.
  {
    const fm = (md.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const norm = (v) => (v || '').trim().replace(/^["']|["']$/g, '');
    const curDate = (fm.match(/^date:\s*(.+)$/m) || [])[1];
    const curModified = (fm.match(/^modified:\s*(.+)$/m) || [])[1];
    let dateChanged = false;
    if (curDate !== undefined && norm(curDate) !== post.publish_date) {
      md = md.replace(/^date:\s*.*$/m, `date: ${post.publish_date}`);
      dateChanged = true;
    }
    if (curModified !== undefined && norm(curModified) !== post.publish_date) {
      md = md.replace(/^modified:\s*.*$/m, `modified: ${post.publish_date}`);
      dateChanged = true;
    }
    if (dateChanged) console.log(`    ↳ frontmatter date/modified set to ${post.publish_date}`);
  }
  if (md !== mdContent) pendingWrites.set(mdFile, md);

  // The credit record binds the "Reviewed by" line to the exact bytes this run
  // commits: the renderer prints it only while the file still hashes to
  // credited_sha256 and the publisher's credit_mac verifies.
  // A post published without a credit keeps no approval record either.
  if (approval.credit) recordCredit(post, Buffer.from(md, 'utf8'), SECRET);
  else clearApprovalRecord(post);

  post.status = 'published';
  published++;
  calendarChanged = true;
  console.log(`  Published: "${post.title}" (${post.publish_date}) — ${approval.credit ? `reviewed by ${post.reviewer} (${post.approved_via === 'email' ? 'approved by email reply' : 'approved in SAGE'})` : 'no reviewer credited (advisory exception)'}`);
  // Wording that reads as a review credit is flagged, never refused: only the
  // signed approval above credits a reviewer (sage-server BL-07).
  for (const w of reviewWordingWarnings(md, TEAM)) console.log(describeWordingWarning(post.slug, w));
}

// Persist: posts first, then the calendar that says they are published.
for (const [file, text] of pendingWrites) fs.writeFileSync(file, text);
if (calendarChanged) {
  fs.writeFileSync(CALENDAR_PATH, JSON.stringify(calendar, null, 2) + '\n');
}

if (errors.length > 0) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ${errors.length} scheduled post(s) failed readiness checks:`);
  for (const e of errors) console.log(`    - ${e.slug}: ${e.reason}`);
  console.log('');
  console.log('  Calendar status set to "error" with error_reason and error_at.');
  console.log('  missing_*/content_too_short: investigate the sage Hive blog-writer pipeline.');
  console.log('  unsafe_frontmatter: a front-matter value carries markup or an invisible, control or bidi character,');
  console.log('  or a slug or date is not in its plain form. Fix the markdown by hand.');
  console.log('  approval_*/approved_bytes_changed: the post changed after its reviewer approved it in SAGE, it was rescheduled,');
  console.log('  the approval is not the byline reviewer\'s, or SAGE did not sign it. It is not published under their name (sage-server BL-07).');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
if (held.length > 0) {
  console.log('');
  console.log(`  ${held.length} due post(s) HELD: not published, because their licensed reviewer has not approved them (owner decision 2026-10-02):`);
  for (const h of held) console.log(`    - ${h.slug} (due ${h.date}): ${h.next}`);
  console.log('  An in-review post is approved by its reviewer in SAGE, or by replying APPROVED to the review email if they review by email;');
  console.log('  it then publishes on the next run, while it is still scheduled for that date. Moving a post to another date needs a new approval.');
  console.log('  The queue check (I8) keeps the workflow red until then. Not an error: nothing was changed.');
}
if (published > 0) console.log(`\n  ${published} post(s) published. Calendar updated.`);
else if (errors.length === 0 && unverified.length === 0 && held.length === 0) console.log('  No posts due for publishing today.');

if (unverified.length > 0) {
  console.log(`\n  ! ${unverified.length} approved post(s) not published: BLOG_REVIEW_TOKEN_SECRET is not set (or under 32 characters), so SAGE's approval cannot be verified: ${unverified.join(', ')}`);
  process.exit(2);
}
process.exit(errors.length > 0 ? 3 : 0);
