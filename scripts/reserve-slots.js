#!/usr/bin/env node
/**
 * Reserve the rolling publish window.
 *
 * Creates a `reserved` slot for every Wed/Sat inside HORIZON_DAYS that is not
 * already held by a dated post. Reserving capacity before a topic exists is
 * the point: an empty slot is visible weeks out instead of surfacing as a
 * missing-markdown error on publish day, which is how 2026-08-13 was going to
 * fail.
 *
 * Idempotent - re-running never duplicates a slot, and slots that have fallen
 * behind the window are pruned once they are past and unlocked.
 *
 * Usage: node scripts/reserve-slots.js [--dry-run] [--today YYYY-MM-DD]
 */
const q = require('./lib/content-queue');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const todayArg = args.indexOf('--today');
const today = todayArg !== -1 ? args[todayArg + 1] : new Date().toISOString().slice(0, 10);

const cal = q.loadCalendar();
if (!Array.isArray(cal.slots)) cal.slots = [];

const taken = q.occupiedDates(cal);
const bySlotDate = new Map(cal.slots.map(s => [s.date, s]));

const added = [];
for (const date of q.publishDatesWithin(today, q.HORIZON_DAYS)) {
  if (taken.has(date)) continue;      // a real post already owns this date
  if (bySlotDate.has(date)) continue; // already reserved
  const slot = {
    date,
    state: 'reserved',
    locked_slug: null,
    locked_at: null,
    reserved_at: today,
  };
  cal.slots.push(slot);
  bySlotDate.set(date, slot);
  added.push(date);
}

// Drop slots that a real post has since claimed, and past slots that were
// never locked. A past LOCKED slot is left in place - it is evidence that
// something was committed and then not published, which queue-status reports.
const before = cal.slots.length;
cal.slots = cal.slots.filter(s => {
  if (taken.has(s.date) && s.state !== 'locked') return false;
  if (q.daysBetween(today, s.date) < 0 && s.state !== 'locked') return false;
  return true;
});
const pruned = before - cal.slots.length;

cal.slots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

if (!dryRun) q.saveCalendar(cal);

console.log(`${dryRun ? '[dry-run] ' : ''}Reserved window: ${today} +${q.HORIZON_DAYS}d`);
console.log(`  reserved ${added.length} new slot(s)${added.length ? ': ' + added.join(', ') : ''}`);
console.log(`  pruned ${pruned} stale slot(s)`);
console.log(`  ${cal.slots.length} slot(s) now tracked`);
