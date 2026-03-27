#!/usr/bin/env node
/**
 * The Way Agency  -  Scheduled Blog Publisher
 *
 * Checks content-calendar.json for posts with a publish_date <= today
 * and status "planned", verifies the markdown file exists, and updates
 * the status to "published".
 *
 * Used by the GitHub Actions workflow to auto-publish blog posts on schedule.
 *
 * Exit codes:
 *   0 = posts were published (caller should commit and push)
 *   1 = no posts due today (no action needed)
 *
 * Usage: node scripts/publish-scheduled-posts.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CALENDAR_PATH = path.join(ROOT, 'data', 'content-calendar.json');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');

const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

const calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));

let published = 0;

for (const post of calendar.year1) {
  // Publish posts that are "planned" or "in-review" when their date arrives
  if (post.status !== 'planned' && post.status !== 'in-review') continue;
  if (post.publish_date > today) continue;

  // Readiness check: markdown file must exist
  const mdFile = path.join(BLOG_SRC, `${post.slug}.md`);
  if (!fs.existsSync(mdFile)) {
    console.log(`  ! Skipping "${post.title}" - markdown file not found: src/blog/${post.slug}.md`);
    continue;
  }

  // Readiness check: file must have title and description in frontmatter
  const mdContent = fs.readFileSync(mdFile, 'utf8');
  if (!mdContent.includes('title:') || !mdContent.includes('description:')) {
    console.log(`  ! Skipping "${post.title}" - missing title or description in frontmatter`);
    continue;
  }

  // Readiness check: file must have meaningful content (>200 words)
  const bodyText = mdContent.replace(/---[\s\S]*?---/, '').trim();
  const wordCount = bodyText.split(/\s+/).length;
  if (wordCount < 200) {
    console.log(`  ! Skipping "${post.title}" - content too short (${wordCount} words, need 200+)`);
    continue;
  }

  // If a reviewer was assigned, update the markdown front matter with their byline
  if (post.reviewer && post.reviewer_slug) {
    let md = fs.readFileSync(mdFile, 'utf8');
    md = md.replace(/^author: .+$/m, `author: ${post.reviewer}`);
    md = md.replace(/^author_title: .+$/m, `author_title: Licensed Agent`);
    // Add author_slug if not present
    if (!md.includes('author_slug:')) {
      md = md.replace(/^author_title: .+$/m, `author_title: Licensed Agent\nauthor_slug: ${post.reviewer_slug}`);
    } else {
      md = md.replace(/^author_slug: .+$/m, `author_slug: ${post.reviewer_slug}`);
    }
    fs.writeFileSync(mdFile, md);
  }

  post.status = 'published';
  published++;
  console.log(`  Published: "${post.title}" (${post.publish_date}) — byline: ${post.reviewer || 'The Way Agency'}`);
}

if (published > 0) {
  fs.writeFileSync(CALENDAR_PATH, JSON.stringify(calendar, null, 2) + '\n');
  console.log(`\n  ${published} post(s) published. Calendar updated.`);
  process.exit(0);
} else {
  console.log('  No posts due for publishing today.');
  process.exit(1);
}
