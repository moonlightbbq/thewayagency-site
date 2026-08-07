#!/usr/bin/env node
/**
 * The Way Agency  -  Scheduled Blog Publisher
 *
 * Checks content-calendar.json for posts with a publish_date <= today
 * whose status is publishable (see scripts/lib/calendar-status.js -- the
 * vocabulary is shared with sage, which writes 'approved'), verifies the markdown
 * file exists, reconciles its frontmatter date:/modified: to the calendar
 * publish_date, and updates the status to "published".
 *
 * Used by the GitHub Actions workflow to auto-publish blog posts on schedule.
 *
 * Exit codes:
 *   0 = posts were published (caller should commit and push)
 *   1 = no posts due today (no action needed) OR a scheduled post is
 *       missing its markdown file (loud-fail; surfaces a red workflow
 *       run + marks the calendar entry status='error' so an operator
 *       can see what's stuck).
 *
 * Usage: node scripts/publish-scheduled-posts.js
 */

const fs = require('fs');
const path = require('path');
const { isPublishable, isKnownStatus } = require('./lib/calendar-status');

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

function reviewerTitle(slug, name) {
  const m = TEAM.find(t => t && (t.slug === slug || t.name === name));
  return (m && m.title) || 'The Way Agency';
}

let published = 0;
const errors = [];
let calendarChanged = false;

for (const post of calendar.year1) {
  // Publishable states come from the shared vocabulary, not a local list.
  // The local list is what broke: it omitted 'approved', so a reviewer
  // replying "Approved" silently stopped their own post from publishing.
  if (post.publish_date > today) continue;
  if (!isPublishable(post.status)) {
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
    const reason = 'missing_markdown';
    console.log(`  ! ERROR: "${post.title}" (${post.slug}) - markdown file not found: src/blog/${post.slug}.md`);
    if (post.status !== 'error' || post.error_reason !== reason) {
      post.status = 'error';
      post.error_reason = reason;
      post.error_at = new Date().toISOString();
      calendarChanged = true;
    }
    errors.push({ slug: post.slug, reason });
    continue;
  }

  // Readiness check: file must have title and description in frontmatter
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

  // Readiness check: file must have meaningful content (>200 words)
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

  // If a reviewer was assigned, update the markdown front matter with their byline.
  if (post.reviewer && post.reviewer_slug) {
    let md = fs.readFileSync(mdFile, 'utf8');
    // The reviewer's REAL title, from team.json — never a hardcoded one. This
    // used to stamp "Licensed Agent" on everyone, which published six posts
    // crediting a Client Care Specialist as a Licensed Agent, in the visible
    // byline AND in the JSON-LD `jobTitle` schema.
    const title = reviewerTitle(post.reviewer_slug, post.reviewer);
    md = md.replace(/^author: .+$/m, `author: ${post.reviewer}`);
    md = md.replace(/^author_title: .+$/m, `author_title: ${title}`);
    if (!md.includes('author_slug:')) {
      md = md.replace(/^author_title: .+$/m, `author_title: ${title}\nauthor_slug: ${post.reviewer_slug}`);
    } else {
      md = md.replace(/^author_slug: .+$/m, `author_slug: ${post.reviewer_slug}`);
    }
    // The date the article actually went out for review — rendered next to the
    // reviewer's name, so "Reviewed by X" carries a when, not just a who.
    if (post.review_sent_date) {
      const reviewed = String(post.review_sent_date).slice(0, 10);
      if (md.includes('reviewed_date:')) {
        md = md.replace(/^reviewed_date: .+$/m, `reviewed_date: ${reviewed}`);
      } else {
        md = md.replace(/^author_slug: .+$/m, `author_slug: ${post.reviewer_slug}\nreviewed_date: ${reviewed}`);
      }
    }
    fs.writeFileSync(mdFile, md);
  }

  // Reconcile frontmatter dates: if the .md `date:`/`modified:` differ from
  // the calendar publish_date, rewrite them. A future-dated `date:` would
  // otherwise make generate-blog.js skip the post even though it just got
  // marked published.
  {
    let md = fs.readFileSync(mdFile, 'utf8');
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
    if (dateChanged) {
      fs.writeFileSync(mdFile, md);
      console.log(`    ↳ frontmatter date/modified set to ${post.publish_date}`);
    }
  }

  post.status = 'published';
  published++;
  calendarChanged = true;
  console.log(`  Published: "${post.title}" (${post.publish_date}) — byline: ${post.reviewer || 'The Way Agency'}`);
}

// Persist any calendar mutations (publishes + error markings)
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
  console.log('  Investigate sage Hive blog-writer pipeline.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}

if (published > 0) {
  console.log(`\n  ${published} post(s) published. Calendar updated.`);
  process.exit(0);
}

console.log('  No posts due for publishing today.');
process.exit(1);
