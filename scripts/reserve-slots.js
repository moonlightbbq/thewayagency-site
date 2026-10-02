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
 * The rules are the lib's reserveSlots(), the one SAGE's queue adapter and
 * fill-slots.js run. This script used to carry its own copy of them, which
 * would have re-reserved the dates of an explicit pause (BLOG-06).
 *
 * Usage: node scripts/reserve-slots.js [--dry-run] [--today YYYY-MM-DD]
 */
const q = require('./lib/content-queue');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const todayArg = args.indexOf('--today');
const today = todayArg !== -1 ? args[todayArg + 1] : new Date().toISOString().slice(0, 10);

const cal = q.loadCalendar();

// Drops slots a real post has since claimed, past slots never locked, and
// unlocked slots inside a pause. A past LOCKED slot is left in place - it is
// evidence that something was committed and then not published, which
// queue-status reports.
const { added, pruned } = q.reserveSlots(cal, today);

if (!dryRun) q.saveCalendar(cal);

console.log(`${dryRun ? '[dry-run] ' : ''}Reserved window: ${today} +${q.HORIZON_DAYS}d`);
const pause = q.queuePause(cal);
if (pause && today <= pause.until) console.log(`  PAUSED until ${pause.until}: no slot is reserved on or before it`);
console.log(`  reserved ${added.length} new slot(s)${added.length ? ': ' + added.join(', ') : ''}`);
console.log(`  pruned ${pruned} stale slot(s)`);
console.log(`  ${cal.slots.length} slot(s) now tracked`);
