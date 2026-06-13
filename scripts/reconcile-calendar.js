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

// Statuses that are eligible to be flipped to "published" once their date
// arrives. Mirrors publish-scheduled-posts.js (planned/in-review) plus
// in-draft, which is genuinely-stuck content that is otherwise ready.
const PUBLISHABLE_STATUSES = new Set(['planned', 'in-review', 'in-draft']);

const calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));

let calendarChanged = false;
let mdChanges = 0;
let statusFlips = 0;
const errors = [];

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
    if (APPLY) {
      let next = md;
      if (dateNeedsFix) next = next.replace(/^date:\s*.*$/m, `date: ${post.publish_date}`);
      if (modifiedNeedsFix) next = next.replace(/^modified:\s*.*$/m, `modified: ${post.publish_date}`);
      fs.writeFileSync(mdFile, next);
      md = next;
    }
    mdChanges++;
  }

  // ── (b) Status flip (publishable entries only) ──────────────────────
  if (!isPublishable) continue;

  // Re-validate readiness before flipping, mirroring publish-scheduled-posts.js.
  // (Read from the on-disk content; in dry-run the dates may not be rewritten
  // yet, but readiness does not depend on the date field.)
  const mdContent = fs.readFileSync(mdFile, 'utf8');

  if (!mdContent.includes('title:') || !mdContent.includes('description:')) {
    const reason = 'missing_frontmatter';
    console.log(`  ! ERROR: "${post.title}" (${post.slug}) - missing title or description in frontmatter`);
    if (post.status !== 'error' || post.error_reason !== reason) {
      post.status = 'error';
      post.error_reason = reason;
      post.error_at = new Date().toISOString();
      calendarChanged = true;
    }
    errors.push({ slug: post.slug, reason });
    continue;
  }

  const bodyText = mdContent.replace(/---[\s\S]*?---/, '').trim();
  const wordCount = bodyText.split(/\s+/).length;
  if (wordCount < 200) {
    const reason = 'content_too_short';
    console.log(`  ! ERROR: "${post.title}" (${post.slug}) - content too short (${wordCount} words, need 200+)`);
    if (post.status !== 'error' || post.error_reason !== reason) {
      post.status = 'error';
      post.error_reason = reason;
      post.error_at = new Date().toISOString();
      calendarChanged = true;
    }
    errors.push({ slug: post.slug, reason });
    continue;
  }

  console.log(`  + PUBLISH: "${post.title}" (${post.slug})  -  status ${post.status} -> published (date ${post.publish_date})`);
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

// Exit non-zero only on readiness errors, so CI surfaces stuck posts.
process.exit(errors.length > 0 ? 1 : 0);
