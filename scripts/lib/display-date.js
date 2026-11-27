/**
 * A post's DISPLAYED date (owner decision 2026-11-27, "back post those
 * articles"): a calendar entry may carry `display_date`, an earlier
 * YYYY-MM-DD the post shows on the blog, while it goes live on its real
 * `publish_date` after the normal review (request, reminders, approval or
 * silence consent, all keyed on publish_date).
 *
 * Used for posts whose original slot passed before they were written: they go
 * live on a later slot and show the date they were first scheduled for. When
 * one publishes, its front matter `date:` becomes display_date and
 * `modified:` the real publish_date, so the page's dateModified says when it
 * actually went up.
 *
 * Nothing else changes: review tokens, approvals and the approval MAC stay
 * bound to publish_date, and an entry with an invalid display_date (not a
 * real date, or not earlier than publish_date) shows its publish_date; the
 * data-integrity check fails the build on it.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function realDay(s) {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** null when the entry's display_date is absent or valid, else why not. */
function displayDateProblem(entry) {
  if (!entry || entry.display_date === undefined || entry.display_date === null) return null;
  const d = String(entry.display_date);
  if (!realDay(d)) return `display_date "${d}" is not a YYYY-MM-DD date`;
  const p = String(entry.publish_date || '');
  if (!realDay(p)) return `display_date "${d}" needs a valid publish_date`;
  if (d >= p) return `display_date ${d} must be earlier than publish_date ${p}`;
  return null;
}

/** True when the entry shows an earlier date than the one it publishes on. */
function hasDisplayDate(entry) {
  return !!entry && entry.display_date !== undefined && entry.display_date !== null && !displayDateProblem(entry);
}

/** The date the post shows on the blog: a valid display_date, else publish_date. */
function shownDate(entry) {
  return hasDisplayDate(entry) ? String(entry.display_date) : (entry ? entry.publish_date : undefined);
}

/**
 * Front matter dates for a post being published: `date:` is the shown date;
 * `modified:` is the real publish_date (added after `date:` when a
 * display-dated post has none, so dateModified is truthful). Returns the new
 * markdown text; unchanged text when nothing differs.
 */
function publishFrontMatterDates(md, entry) {
  const fm = (md.match(/^---\n([\s\S]*?)\n---/) || [])[1];
  if (fm === undefined) return md;
  const norm = (v) => (v || '').trim().replace(/^["']|["']$/g, '');
  const shown = shownDate(entry);
  const real = String(entry.publish_date);
  let next = fm;
  const curDate = (next.match(/^date:\s*(.+)$/m) || [])[1];
  if (curDate !== undefined && norm(curDate) !== shown) next = next.replace(/^date:\s*.*$/m, `date: ${shown}`);
  const curModified = (next.match(/^modified:\s*(.+)$/m) || [])[1];
  if (curModified !== undefined) {
    if (norm(curModified) !== real) next = next.replace(/^modified:\s*.*$/m, `modified: ${real}`);
  } else if (hasDisplayDate(entry) && curDate !== undefined) {
    next = next.replace(/^(date:\s*.*)$/m, `$1\nmodified: ${real}`);
  }
  return next === fm ? md : md.replace(/^---\n[\s\S]*?\n---/, () => `---\n${next}\n---`);
}

module.exports = { displayDateProblem, hasDisplayDate, shownDate, publishFrontMatterDates };
