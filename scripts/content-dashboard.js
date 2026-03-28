#!/usr/bin/env node
/**
 * Content Calendar Dashboard
 * Shows content status grouped by month and status, flags gaps and overdue items.
 *
 * Usage: node scripts/content-dashboard.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CALENDAR_PATH = path.join(ROOT, 'data', 'content-calendar.json');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');

let calendar;
try {
  calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));
} catch (e) {
  console.error(`Failed to load content calendar from ${CALENDAR_PATH}: ${e.message}`);
  console.error('Ensure data/content-calendar.json exists and is valid JSON.');
  process.exit(1);
}
const today = new Date().toISOString().split('T')[0];

const allPosts = [...(calendar.existing_posts || []), ...(calendar.year1 || [])];

// Group by status
const byStatus = {};
for (const p of allPosts) {
  const status = p.status || 'unknown';
  if (!byStatus[status]) byStatus[status] = [];
  byStatus[status].push(p);
}

// Group by month
const byMonth = {};
for (const p of allPosts) {
  const month = (p.publish_date || 'unknown').substring(0, 7);
  if (!byMonth[month]) byMonth[month] = [];
  byMonth[month].push(p);
}

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║       Content Calendar Dashboard             ║');
console.log('╚══════════════════════════════════════════════╝\n');

// Status summary
console.log('── Status Summary ──────────────────────────────\n');
const statusOrder = ['published', 'planned', 'in-review', 'draft', 'unknown'];
for (const status of statusOrder) {
  const posts = byStatus[status];
  if (!posts) continue;
  const icon = status === 'published' ? '✓' : status === 'planned' ? '○' : status === 'in-review' ? '◐' : '·';
  console.log(`  ${icon} ${status.padEnd(12)} ${String(posts.length).padStart(3)} posts`);
}
console.log(`${''.padEnd(22)}${String(allPosts.length).padStart(3)} total\n`);

// Monthly breakdown
console.log('── Monthly Breakdown ───────────────────────────\n');
const months = Object.keys(byMonth).sort();
for (const month of months) {
  const posts = byMonth[month];
  const published = posts.filter(p => p.status === 'published').length;
  const planned = posts.filter(p => p.status === 'planned' || p.status === 'in-review').length;
  const flag = posts.length === 0 ? ' ⚠️ GAP' : '';
  console.log(`  ${month}  ${String(posts.length).padStart(2)} posts (${published} published, ${planned} planned)${flag}`);
}

// Overdue posts (past date, not published)
console.log('\n── Overdue Posts ───────────────────────────────\n');
const overdue = allPosts.filter(p => p.publish_date <= today && p.status !== 'published');
if (overdue.length === 0) {
  console.log('  None — all due posts are published.\n');
} else {
  for (const p of overdue.slice(0, 20)) {
    const hasFile = fs.existsSync(path.join(BLOG_SRC, `${p.slug}.md`));
    console.log(`  ⚠ ${p.publish_date} "${p.title}" [${p.status}]${hasFile ? '' : ' — FILE MISSING'}`);
  }
  console.log(`\n  ${overdue.length} overdue post(s)\n`);
}

// Upcoming posts (next 30 days)
console.log('── Upcoming (Next 30 Days) ─────────────────────\n');
const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
const upcoming = allPosts.filter(p => p.publish_date > today && p.publish_date <= thirtyDays).sort((a, b) => a.publish_date.localeCompare(b.publish_date));
if (upcoming.length === 0) {
  console.log('  No posts scheduled in the next 30 days.\n');
} else {
  for (const p of upcoming) {
    const hasFile = fs.existsSync(path.join(BLOG_SRC, `${p.slug}.md`));
    const reviewer = p.reviewer ? ` (${p.reviewer})` : '';
    console.log(`  ${p.publish_date} "${p.title}" [${p.status}]${reviewer}${hasFile ? '' : ' — FILE MISSING'}`);
  }
  console.log();
}

// Posts missing review_deadline or reviewer
const needsReview = allPosts.filter(p => p.status === 'planned' && !p.reviewer);
if (needsReview.length > 0) {
  console.log('── Needs Reviewer Assignment ────────────────────\n');
  for (const p of needsReview.slice(0, 10)) {
    console.log(`  · "${p.title}" (${p.publish_date})`);
  }
  if (needsReview.length > 10) console.log(`  ... and ${needsReview.length - 10} more`);
  console.log();
}
