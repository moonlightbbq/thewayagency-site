#!/usr/bin/env node
/**
 * Lock topics into reserved slots inside the lock window.
 *
 * Picks the highest-scoring approved candidate that is seasonally eligible
 * and does not cannibalize existing coverage. Seasonality is a hard filter,
 * not a score: a winter post cannot land in August no matter how well it
 * ranks otherwise. That is the property the 2026-05-02 re-pace violated.
 *
 * Usage: node scripts/fill-slots.js [--dry-run] [--today YYYY-MM-DD]
 *                                    [--allow-review-skip]
 *
 * --allow-review-skip fills slots that are already inside the D-10 review
 * window rather than letting the date publish nothing. Only ever uses a
 * candidate whose draft is already written, and records review_skipped on the
 * entry so the trade-off stays visible.
 */
const fs = require('fs');
const q = require('./lib/content-queue');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const allowReviewSkip = args.includes('--allow-review-skip');
const todayArg = args.indexOf('--today');
const today = todayArg !== -1 ? args[todayArg + 1] : new Date().toISOString().slice(0, 10);

const cal = q.loadCalendar();
const backlog = q.loadBacklog();
// Same window definitions the build check enforces, so the scheduler can never
// place something check-data-integrity.js would then reject. One shared parser
// in the lib: eligibility fails CLOSED on a window it cannot interpret, so two
// parsers that disagree would mean one caller schedules and the other refuses.
const windows = q.loadWindowMonths();

const reserved = q.reserveSlots(cal, today);
const { locked, skipped } = q.fillSlots(cal, backlog, today, windows, { allowReviewSkip });

if (!dryRun) {
  q.saveCalendar(cal);
  fs.writeFileSync(q.BACKLOG_PATH, `${JSON.stringify(backlog, null, 2)}\n`);
}

console.log(`${dryRun ? '[dry-run] ' : ''}Queue fill for ${today} (lock window ${q.LOCK_DAYS}d)`);
console.log(`  reserved ${reserved.added.length} slot(s), pruned ${reserved.pruned}`);
console.log(`\n  locked ${locked.length} slot(s):`);
for (const l of locked) {
  console.log(`    ${l.date}  ${l.slug}  (score ${l.score})`);
  for (const r of l.reasons) console.log(`        - ${r}`);
}
if (skipped.length) {
  console.log(`\n  ${skipped.length} slot(s) left empty:`);
  for (const s of skipped) console.log(`    ${s.date}  ${s.reason}`);
}
console.log('');
