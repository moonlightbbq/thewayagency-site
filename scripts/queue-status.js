#!/usr/bin/env node
/**
 * Read-only health view of the content queue.
 *
 * Reports the five invariants in scripts/lib/content-queue.js. I4 is the one
 * that matters most: it is the check that would have caught
 * college-student-auto-insurance on 2026-08-03 instead of letting the publish
 * workflow go red on 2026-08-15.
 *
 * Usage: node scripts/queue-status.js [--today YYYY-MM-DD] [--strict]
 *   --strict  exit 1 if any invariant is violated (for CI)
 */
const q = require('./lib/content-queue');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const todayArg = args.indexOf('--today');
const today = todayArg !== -1 ? args[todayArg + 1] : new Date().toISOString().slice(0, 10);

const cal = q.loadCalendar();
const backlog = q.loadBacklog();
const { violations, stats } = q.evaluateInvariants(cal, backlog, today);

console.log(`\nContent queue as of ${today}\n${'='.repeat(46)}`);

console.log(`\nHorizon (${q.HORIZON_DAYS}d): ${stats.horizonDates.length} publish dates`);
console.log(`  filled by a post  : ${stats.filled}`);
console.log(`  reserved, no topic: ${stats.reserved}`);
console.log(`  unaccounted for   : ${stats.unreserved.length}`);

const candidates = backlog.candidates || [];
console.log(`\nBacklog: ${candidates.length} candidate(s)`);
const byStatus = {};
for (const c of candidates) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
for (const [k, v] of Object.entries(byStatus).sort()) console.log(`  ${String(v).padStart(3)} ${k}`);
console.log(`  draft already written: ${candidates.filter(c => q.hasMarkdown(c.slug)).length}`);

console.log('\nNext 6 scheduled posts:');
if (!stats.upcoming.length) console.log('  (none)');
for (const p of stats.upcoming.slice(0, 6)) {
  const d = q.daysBetween(today, p.publish_date);
  console.log(`  ${p.publish_date} (${String(d).padStart(3)}d) ${q.hasMarkdown(p.slug) ? 'md   ' : 'NO MD'} ${String(p.status).padEnd(9)} ${p.slug}`);
}

console.log(`\nNext publish date with no post: ${stats.nextEmptyDate || '(none inside horizon)'}`);

if (stats.reviewSkipped.length) {
  console.log(`\nPublishing WITHOUT a reviewer email (${stats.reviewSkipped.length}):`);
  for (const p of stats.reviewSkipped) {
    console.log(`  ${p.publish_date}  ${p.slug}`);
  }
  console.log('  These were locked inside the D-10 review window to keep the date from going silent.');
}

console.log(`\n${'='.repeat(46)}`);
if (!violations.length) {
  console.log('All queue invariants hold.\n');
  process.exit(0);
}
console.log(`${violations.length} invariant violation(s):`);
for (const v of violations) console.log(`  x ${v.id}: ${v.message}`);
console.log('');
process.exit(strict ? 1 : 0);
