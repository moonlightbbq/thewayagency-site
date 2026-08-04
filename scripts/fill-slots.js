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
 */
const fs = require('fs');
const q = require('./lib/content-queue');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const todayArg = args.indexOf('--today');
const today = todayArg !== -1 ? args[todayArg + 1] : new Date().toISOString().slice(0, 10);

// Same window definitions the build check enforces, so the scheduler can never
// place something check-data-integrity.js would then reject.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
function parseWindows() {
  const tax = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'data', 'content-taxonomy.json'), 'utf8'));
  const defs = tax?.lifecycle?.seasonal?.seasonality_windows || {};
  const out = {};
  for (const [name, desc] of Object.entries(defs)) {
    const found = String(desc).split('(')[0].match(/[A-Za-z]+/g) || [];
    const idx = found.map(w => MONTHS.indexOf(w.toLowerCase())).filter(i => i >= 0);
    if (!idx.length) continue;
    const months = [];
    for (let m = idx[0]; ; m = (m + 1) % 12) { months.push(m); if (m === idx[idx.length - 1]) break; }
    out[name] = months;
  }
  return out;
}

const cal = q.loadCalendar();
const backlog = q.loadBacklog();
const windows = parseWindows();

const reserved = q.reserveSlots(cal, today);
const { locked, skipped } = q.fillSlots(cal, backlog, today, windows);

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
