/**
 * Shared vocabulary for the rolling content queue.
 *
 * Replaces the practice of dating a year of content up front. The 2026-05-02
 * re-pace (f1f4ba4) showed why that fails: publish dates encoded list
 * position, so a cadence change silently re-timed a year of seasonal content
 * and a winter driving guide ended up scheduled for August.
 *
 * The model has three parts:
 *   backlog  data/content-backlog.json - undated candidates, nothing scheduled
 *   slots    content-calendar.json#slots - the rolling Wed/Sat ledger
 *   posts    content-calendar.json#year1 - the dated, authoritative record
 *
 * A slot is reserved HORIZON_DAYS out so capacity is visible, then a topic is
 * locked into it LOCK_DAYS before publish, chosen from the approved backlog
 * against current SEO signals. Seasonality is an eligibility filter applied at
 * lock time, never a date written months ahead - which is the structural fix,
 * because a cadence change can no longer move content that was never pre-dated.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CALENDAR_PATH = path.join(ROOT, 'data', 'content-calendar.json');
const BACKLOG_PATH = path.join(ROOT, 'data', 'content-backlog.json');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');

// Reserve capacity 4 weeks out; commit a topic to it 2 weeks out.
const HORIZON_DAYS = 28;
const LOCK_DAYS = 14;
// A slot this close to publishing must already have markdown on disk. Set
// just inside the review lead time so the alarm fires while there is still
// room to act, not on publish day.
const MARKDOWN_DUE_DAYS = 10;
// Four weeks of approved candidates at the 2x/week cadence.
const MIN_APPROVED_BACKLOG = 8;

// Wednesday and Saturday, matching .github/workflows/publish-blog.yml's
// `cron: '0 10 * * 3,6'`.
const PUBLISH_WEEKDAYS = [3, 6];

const DAY_MS = 86400000;

/** Parse a YYYY-MM-DD as UTC noon, so weekday math never straddles a zone. */
function asDate(ymd) {
  return new Date(`${ymd}T12:00:00Z`);
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromYmd, toYmdStr) {
  return Math.round((asDate(toYmdStr) - asDate(fromYmd)) / DAY_MS);
}

function isPublishDay(ymd) {
  return PUBLISH_WEEKDAYS.includes(asDate(ymd).getUTCDay());
}

/** Every Wed/Sat date in [fromYmd, fromYmd + days], exclusive of fromYmd. */
function publishDatesWithin(fromYmd, days) {
  const out = [];
  const start = asDate(fromYmd);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    if (PUBLISH_WEEKDAYS.includes(d.getUTCDay())) out.push(toYmd(d));
  }
  return out;
}

function loadCalendar() {
  return JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));
}

function loadBacklog() {
  if (!fs.existsSync(BACKLOG_PATH)) return { candidates: [] };
  return JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
}

function saveCalendar(cal) {
  fs.writeFileSync(CALENDAR_PATH, `${JSON.stringify(cal, null, 2)}\n`);
}

/** Dates already held by a real dated post, so a slot is never double-booked. */
function occupiedDates(cal) {
  const taken = new Set();
  for (const post of cal.year1 || []) {
    if (post.status !== 'published' && post.publish_date) taken.add(post.publish_date);
  }
  return taken;
}

function hasMarkdown(slug) {
  return !!slug && fs.existsSync(path.join(BLOG_SRC, `${slug}.md`));
}

function approvedCandidates(backlog) {
  return (backlog.candidates || []).filter(c => c.status === 'approved');
}

/**
 * Whether a candidate may occupy a slot on a given date. Evergreen items are
 * always eligible; seasonal ones only inside their declared window (+/-1
 * month, matching check-data-integrity.js so the scheduler cannot place
 * something the build would then reject).
 */
function isEligibleOn(candidate, ymd, windowMonths) {
  if (!candidate.seasonality_window) return true;
  const months = windowMonths[candidate.seasonality_window];
  if (!months || !months.length) return true;
  const allowed = new Set();
  for (const m of months) { allowed.add(m); allowed.add((m + 11) % 12); allowed.add((m + 1) % 12); }
  return allowed.has(asDate(ymd).getUTCMonth());
}

/**
 * Evaluate the five queue invariants. Pure: takes the data and the clock,
 * returns findings. `opts.hasMarkdown` is injectable so the rules can be
 * tested against fixtures rather than whatever happens to be on disk.
 *
 * @returns {{ violations: Array<{id,message}>, stats: object }}
 */
function evaluateInvariants(cal, backlog, today, opts = {}) {
  const markdownFor = opts.hasMarkdown || hasMarkdown;
  const slots = cal.slots || [];
  const posts = cal.year1 || [];
  const violations = [];
  const add = (id, message) => violations.push({ id, message });

  const taken = occupiedDates(cal);
  const slotByDate = new Map(slots.map(s => [s.date, s]));
  const postByDate = new Map(posts.filter(p => p.publish_date).map(p => [p.publish_date, p]));
  const horizonDates = publishDatesWithin(today, HORIZON_DAYS);

  const upcoming = posts
    .filter(p => p.status !== 'published' && p.publish_date && daysBetween(today, p.publish_date) >= 0)
    .sort((a, b) => (a.publish_date < b.publish_date ? -1 : 1));

  // I1 - capacity reserved across the horizon.
  const unreserved = horizonDates.filter(d => !taken.has(d) && !slotByDate.has(d));
  if (unreserved.length) {
    add('I1', `${unreserved.length} publish date(s) in the next ${HORIZON_DAYS}d neither filled nor reserved: ${unreserved.join(', ')}`);
  }

  // I2 - a topic committed once inside the lock window.
  const dueToLock = slots.filter(s => {
    const d = daysBetween(today, s.date);
    return d >= 0 && d <= LOCK_DAYS && s.state !== 'locked';
  });
  if (dueToLock.length) {
    add('I2', `${dueToLock.length} slot(s) within ${LOCK_DAYS}d have no topic locked: ${dueToLock.map(s => s.date).join(', ')}`);
  }

  // I3 - a locked slot must point at a real dated post.
  for (const s of slots.filter(x => x.state === 'locked')) {
    const post = postByDate.get(s.date);
    if (!post) add('I3', `slot ${s.date} is locked to "${s.locked_slug}" but no dated post exists`);
    else if (s.locked_slug && post.slug !== s.locked_slug) {
      add('I3', `slot ${s.date} locked to "${s.locked_slug}" but the post there is "${post.slug}"`);
    }
  }

  // I4 - markdown on disk while there is still time to act. This is the one
  // that would have caught college-student-auto-insurance on 2026-08-03
  // instead of the publish workflow going red on 2026-08-15.
  const missingMarkdown = upcoming.filter(p =>
    daysBetween(today, p.publish_date) <= MARKDOWN_DUE_DAYS && !markdownFor(p.slug));
  for (const p of missingMarkdown) {
    add('I4', `"${p.slug}" publishes ${p.publish_date} (${daysBetween(today, p.publish_date)}d) with no markdown on disk`);
  }

  // I5 - enough approved candidates to keep filling slots.
  const approved = approvedCandidates(backlog);
  if (approved.length < MIN_APPROVED_BACKLOG) {
    add('I5', `approved backlog is ${approved.length}, below the floor of ${MIN_APPROVED_BACKLOG} (${MIN_APPROVED_BACKLOG / 2} weeks at 2x/week)`);
  }

  return {
    violations,
    stats: {
      horizonDates,
      filled: horizonDates.filter(d => taken.has(d)).length,
      reserved: horizonDates.filter(d => !taken.has(d) && slotByDate.has(d)).length,
      unreserved,
      upcoming,
      approvedCount: approved.length,
      nextEmptyDate: horizonDates.find(d => !taken.has(d)) || null,
    },
  };
}

module.exports = {
  CALENDAR_PATH, BACKLOG_PATH, BLOG_SRC,
  evaluateInvariants,
  HORIZON_DAYS, LOCK_DAYS, MARKDOWN_DUE_DAYS, MIN_APPROVED_BACKLOG, PUBLISH_WEEKDAYS,
  asDate, toYmd, daysBetween, isPublishDay, publishDatesWithin,
  loadCalendar, loadBacklog, saveCalendar,
  occupiedDates, hasMarkdown, approvedCandidates, isEligibleOn,
};
