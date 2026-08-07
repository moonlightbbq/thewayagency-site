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
 *   --strict            exit 1 if ANY invariant is violated
 *   --fail-on I4,I2b    exit 1 only for these invariants (for CI)
 *
 * CI uses --fail-on rather than --strict: an empty slot inside the markdown
 * window (I4) must break the build, but a thin backlog (I5) is a planning
 * signal and should not turn the publish workflow red.
 */
const q = require('./lib/content-queue');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const failOnArg = args.indexOf('--fail-on');
const failOn = failOnArg !== -1
  ? new Set(String(args[failOnArg + 1] || '').split(',').map(x => x.trim()).filter(Boolean))
  : null;
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

// Seasonal anchors: what real-world dates the schedule is timed against, and
// which windows are still guessing with a month band.
const anchors = q.loadAnchors();
const anchorEntries = Object.entries(anchors.anchors || {});
if (anchorEntries.length) {
  console.log('\nSeasonal anchors:');
  const year = today.slice(0, 4);
  for (const [name, a] of anchorEntries) {
    const d = (a.dates || {})[year];
    if (!d) {
      console.log(`  ${name.padEnd(26)} NO DATE for ${year} - falling back to the month band`);
      continue;
    }
    const away = q.daysBetween(today, d);
    const range = q.anchorRange({ ...a, name }, d);
    const state = away < 0 ? `${-away}d ago` : `in ${away}d`;
    console.log(`  ${name.padEnd(26)} ${d} (${state})  publish ${range.from}..${range.to}`);
  }
}

// Windows nothing can interpret. These now fail CLOSED, so a candidate
// carrying one will never be scheduled — which is the safe outcome but an
// invisible one unless it is named here. The most likely cause is a bot
// writing a value in the wrong vocabulary.
const windows = q.loadWindowMonths();
const unknownWindows = new Map();
for (const c of backlog.candidates || []) {
  if (!c.seasonality_window) continue;
  const e = q.eligibilityOn(c, today, windows);
  if (e.basis === 'unknown-window') {
    if (!unknownWindows.has(c.seasonality_window)) unknownWindows.set(c.seasonality_window, []);
    unknownWindows.get(c.seasonality_window).push(c.slug);
  }
}
if (unknownWindows.size) {
  console.log('\nUNRECOGNISED seasonality_window (these can never be scheduled):');
  for (const [win, slugs] of unknownWindows) {
    console.log(`  "${win}" — ${slugs.join(', ')}`);
  }
  console.log('  Not defined in content-taxonomy.json and claimed by no anchor.');
}

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

const fatal = failOn ? violations.filter(v => failOn.has(v.id)) : (strict ? violations : []);
if (fatal.length) {
  console.log(`\n${fatal.length} of these are fatal here: ${[...new Set(fatal.map(v => v.id))].join(', ')}`);
}
console.log('');
process.exit(fatal.length ? 1 : 0);
