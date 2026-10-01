#!/usr/bin/env node
/**
 * The Way Agency  -  Content Calendar Reconciler
 *
 * Repairs the two ways a due post can fail to render:
 *
 *   1. A post whose calendar entry already says status "published" but whose
 *      src/blog/<slug>.md frontmatter carries a FUTURE `date:`/`modified:`.
 *      generate-blog.js skips future-dated markdown (and the index filters
 *      future publish_dates), so the post silently never renders.
 *   2. A post still sitting in status "planned" / "in-review" / "in-draft"
 *      whose publish_date has already arrived and never got flipped.
 *
 * For every year1 entry whose markdown exists AND whose publish_date <= today:
 *   (a) if the .md frontmatter `date:`/`modified:` differ from the calendar
 *       publish_date, rewrite them to equal publish_date;
 *   (b) if status is planned/in-review/in-draft, re-validate readiness
 *       (title + description present, body > ~200 words) and flip to
 *       "published" (or "error" + error_reason if it fails, mirroring
 *       publish-scheduled-posts.js).
 *
 * FUTURE-dated planned entries are left untouched.
 *
 * Idempotent: a second run finds nothing to change.
 *
 * --dry-run is the DEFAULT. Pass --apply to write changes to disk.
 *
 * Usage:
 *   node scripts/reconcile-calendar.js            # dry-run, prints planned diff
 *   node scripts/reconcile-calendar.js --apply    # write changes
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CALENDAR_PATH = path.join(ROOT, 'data', 'content-calendar.json');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');

const APPLY = process.argv.includes('--apply');
// --dry-run is the default; the flag is accepted for explicitness.
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

// Statuses eligible to be flipped to "published" once their date arrives.
// Shared with publish-scheduled-posts.js rather than mirrored: this list and
// that one had already drifted apart from what sage writes, which is how
// 'approved' became a status that silently blocked publication.
const { PUBLISHABLE_STATUSES } = require('./lib/calendar-status');
// Who a post credits as its reviewer, and whether an 'approved' post may
// publish at all: the same rule as publish-scheduled-posts.js (sage-server BL-07),
// including the credit record the renderer checks before it prints "Reviewed by".
const {
  approvalCheck, creditCheck, applyReviewCredit, readinessError, reviewSecret, recordCredit, clearApprovalRecord,
} = require('./lib/review-credit');
// Verifies SAGE's signature on an approval; without it an approved post is left alone.
const SECRET = reviewSecret(process.env);
const TEAM = (() => {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'team.json'), 'utf8'));
    return Array.isArray(t) ? t : (t.team || []);
  } catch { return []; }
})();

const calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));

let calendarChanged = false;
let mdChanges = 0;
let statusFlips = 0;
const errors = [];
const unverified = [];

console.log('');
console.log(`Content calendar reconcile  -  ${APPLY ? 'APPLY (writing changes)' : 'DRY-RUN (no changes written; pass --apply to write)'}`);
console.log(`Today: ${today}`);
console.log('');

for (const post of calendar.year1) {
  // Only consider entries whose date has arrived.
  if (post.publish_date > today) continue;

  const mdFile = path.join(BLOG_SRC, `${post.slug}.md`);
  if (!fs.existsSync(mdFile)) {
    // No markdown on disk: only a problem if this entry is supposed to go
    // live (publishable status). Published-status entries with no markdown
    // are out of scope for this reconciler. Match the publish script's
    // loud-fail behaviour for the publishable case.
    if (PUBLISHABLE_STATUSES.has(post.status)) {
      const reason = 'missing_markdown';
      console.log(`  ! ERROR: "${post.title}" (${post.slug}) - markdown file not found: src/blog/${post.slug}.md`);
      if (post.status !== 'error' || post.error_reason !== reason) {
        post.status = 'error';
        post.error_reason = reason;
        post.error_at = new Date().toISOString();
        calendarChanged = true;
      }
      errors.push({ slug: post.slug, reason });
    }
    continue;
  }

  const isPublishable = PUBLISHABLE_STATUSES.has(post.status);
  const isPublished = post.status === 'published';

  // Entries that are neither publishable nor already published (e.g. error,
  // or some other state) are left alone.
  if (!isPublishable && !isPublished) continue;

  // An 'approved' entry flips only while its file is the one approved in SAGE
  // and the approval is the byline reviewer's; decided from the raw bytes,
  // before the date rewrite below changes them.
  let approval = { credit: false, error: null };
  if (isPublishable) {
    approval = approvalCheck(post, fs.readFileSync(mdFile), TEAM, { secret: SECRET });
    if (approval.unverifiable) {
      console.log(`  ! SKIPPED: "${post.title}" (${post.slug}) - ${approval.detail}. Left 'approved'.`);
      unverified.push(post.slug);
      continue;
    }
    if (approval.error) {
      const reason = approval.error;
      console.log(`  ! ERROR: "${post.title}" (${post.slug}) - approved in SAGE, but ${approval.detail}. Not published, and no reviewer credited.`);
      if (post.status !== 'error' || post.error_reason !== reason) {
        post.status = 'error';
        post.error_reason = reason;
        post.error_at = new Date().toISOString();
        calendarChanged = true;
      }
      errors.push({ slug: post.slug, reason });
      continue;
    }
  }

  // ── (a) Frontmatter date reconcile ──────────────────────────────────
  // Read the frontmatter date:/modified: and, if either differs from the
  // calendar publish_date, rewrite both to publish_date.
  let md = fs.readFileSync(mdFile, 'utf8');
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
  const fm = fmMatch ? fmMatch[1] : '';
  const curDate = (fm.match(/^date:\s*(.+)$/m) || [])[1];
  const curModified = (fm.match(/^modified:\s*(.+)$/m) || [])[1];
  const normalize = (v) => (v || '').trim().replace(/^["']|["']$/g, '');
  // Only the render-breaking case warrants a rewrite: a FUTURE frontmatter
  // `date:` makes generate-blog.js skip the post entirely. Past-dated drift (a
  // .md date that merely differs from the calendar) still renders, so leave it
  // alone — we never silently move a live post's published date backward.
  const dateIsFuture = curDate !== undefined && normalize(curDate) > today;
  const dateNeedsFix = dateIsFuture && normalize(curDate) !== post.publish_date;
  const modifiedNeedsFix = dateIsFuture && curModified !== undefined && normalize(curModified) !== post.publish_date;

  if (dateNeedsFix || modifiedNeedsFix) {
    console.log(`  ~ FRONTMATTER: "${post.title}" (${post.slug})`);
    if (dateNeedsFix) console.log(`      date:     ${normalize(curDate)}  ->  ${post.publish_date}`);
    if (modifiedNeedsFix) console.log(`      modified: ${normalize(curModified)}  ->  ${post.publish_date}`);
    // A published post credited for its old bytes keeps its credit: the date
    // rewrite is this script's own, so the credit record moves to the new
    // bytes, but only when it verified for the old ones.
    const keepCredit = isPublished && creditCheck(post, Buffer.from(md, 'utf8'), { secret: SECRET }).credit;
    if (isPublished && !keepCredit && post.credit_mac) {
      console.log(`      (its "Reviewed by" credit ${SECRET ? 'did not verify for the old bytes' : 'cannot be verified without BLOG_REVIEW_TOKEN_SECRET'}, so it is not carried to the new bytes)`);
    }
    if (APPLY) {
      let next = md;
      if (dateNeedsFix) next = next.replace(/^date:\s*.*$/m, `date: ${post.publish_date}`);
      if (modifiedNeedsFix) next = next.replace(/^modified:\s*.*$/m, `modified: ${post.publish_date}`);
      fs.writeFileSync(mdFile, next);
      md = next;
      if (keepCredit) {
        recordCredit(post, Buffer.from(next, 'utf8'), SECRET);
        calendarChanged = true;
      }
    }
    mdChanges++;
  }

  // ── (b) Status flip (publishable entries only) ──────────────────────
  if (!isPublishable) continue;

  // Re-validate readiness before flipping, mirroring publish-scheduled-posts.js.
  // (Read from the on-disk content; in dry-run the dates may not be rewritten
  // yet, but readiness does not depend on the date field.)
  const mdContent = fs.readFileSync(mdFile, 'utf8');

  const notReady = readinessError(mdContent);
  if (notReady) {
    const reason = notReady;
    console.log(`  ! ERROR: "${post.title}" (${post.slug}) - ${{ missing_frontmatter: 'missing title or description in frontmatter', content_too_short: 'content too short (need 200+ words)', unsafe_frontmatter: 'its front matter carries markup or an unsafe slug' }[reason] || reason}`);
    if (post.status !== 'error' || post.error_reason !== reason) {
      post.status = 'error';
      post.error_reason = reason;
      post.error_at = new Date().toISOString();
      calendarChanged = true;
    }
    errors.push({ slug: post.slug, reason });
    continue;
  }

  console.log(`  + PUBLISH: "${post.title}" (${post.slug})  -  status ${post.status} -> published (date ${post.publish_date}), ${approval.credit ? `reviewed by ${post.reviewer}` : 'no reviewer credited'}`);
  if (APPLY) {
    // Silence names no reviewer; an approval in SAGE whose bytes still match does.
    const current = fs.readFileSync(mdFile, 'utf8');
    const next = applyReviewCredit(current, post, TEAM, { credit: approval.credit });
    if (next !== current) fs.writeFileSync(mdFile, next);
    // Bound to the bytes just written: the renderer credits only these.
    if (approval.credit) recordCredit(post, Buffer.from(next, 'utf8'), SECRET);
    else clearApprovalRecord(post);
  }
  post.status = 'published';
  // Clear any stale error markers now that it is ready.
  if (post.error_reason) { delete post.error_reason; delete post.error_at; }
  statusFlips++;
  calendarChanged = true;
}

// Persist calendar mutations (status flips + error markings).
if (calendarChanged && APPLY) {
  fs.writeFileSync(CALENDAR_PATH, JSON.stringify(calendar, null, 2) + '\n');
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Frontmatter date rewrites: ${mdChanges}`);
console.log(`  Status flips -> published:  ${statusFlips}`);
console.log(`  Readiness errors:           ${errors.length}`);
if (errors.length > 0) {
  for (const e of errors) console.log(`    - ${e.slug}: ${e.reason}`);
}
if (!APPLY && (mdChanges > 0 || calendarChanged)) {
  console.log('');
  console.log('  DRY-RUN: nothing written. Re-run with --apply to persist.');
}
if (APPLY && (mdChanges > 0 || calendarChanged)) {
  console.log('');
  console.log('  Changes written. Run `node scripts/build.js` to regenerate the site.');
}
if (mdChanges === 0 && !calendarChanged) {
  console.log('');
  console.log('  Nothing to reconcile  -  calendar and markdown are in sync.');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

if (unverified.length > 0) {
  console.log(`  ${unverified.length} approved post(s) left alone: set BLOG_REVIEW_TOKEN_SECRET (the sage .env value) to verify SAGE's approval: ${unverified.join(', ')}`);
  console.log('');
}

// Exit non-zero on readiness errors, so CI surfaces stuck posts; 2 when an
// approval could not be verified here.
process.exit(errors.length > 0 ? 1 : (unverified.length > 0 ? 2 : 0));
