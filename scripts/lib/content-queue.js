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
const { isHeld, isKnownStatus, heldForApproval, heldNextStep } = require('./calendar-status');
const { APPROVAL_RECORD_FIELDS } = require('./review-credit');

const ROOT = path.resolve(__dirname, '..', '..');
// Overridable for the same reason loadBacklog takes a path: the lost-update
// guard in saveCalendar has to be exercised against a fixture, and mutating
// the real calendar races the other suites node --test runs in parallel.
const CALENDAR_PATH = process.env.CONTENT_CALENDAR_PATH
  || path.join(ROOT, 'data', 'content-calendar.json');
const BACKLOG_PATH = path.join(ROOT, 'data', 'content-backlog.json');
// The backlog schema this code understands. Bump it in the same commit that
// changes the file's shape - loadBacklog() refuses anything else.
const BACKLOG_SCHEMA_VERSION = 2;
const BLOG_SRC = path.join(ROOT, 'src', 'blog');
const ANCHORS_PATH = path.join(ROOT, 'data', 'seasonal-anchors.json');

// Reserve capacity 4 weeks out; commit a topic to it 2 weeks out.
const HORIZON_DAYS = 28;
const LOCK_DAYS = 14;
// The floor for committing a topic: the licensed reviewer's lead time. Since
// the owner's decision of 2026-10-02 nothing publishes without its reviewer's
// approval, and send-review-emails.js sends the request from D-18 (normally
// D-14) down to the publish date. A topic locked nearer than this leaves the
// reviewer under 10 days to read and approve a draft that may not even be
// written yet, so the date would most likely HOLD (I8) instead of publishing.
// Slots closer than this are reported as unfillable (I2b) rather than filled.
const MIN_LOCK_LEAD_DAYS = 10;
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

// Fields the REVIEW flow owns. send-review-emails.js, SAGE's approval
// (sage-server BL-07: approved_* and its signature approval_mac) and the
// publisher (the credit record) write them; the queue never sets them and must
// never clear them. Dropping approval_mac or the credit record would silently
// take a reviewer's earned byline off the post, and dropping one field the
// MAC signs (approved_publish_date, since MAC v2) turns a real approval into
// an unsigned one ('error', approval_unsigned). The approval and credit
// record is review-credit.js APPROVAL_RECORD_FIELDS itself, so a field added
// to the signed record is owned here the moment it exists.
const REVIEW_OWNED_FIELDS = Object.freeze([
  'status', 'reviewer', 'reviewer_email', 'reviewer_slug', 'reviewer_title',
  'review_sent_date', 'review_send_error', 'reminder_sent',
  // The dates send-review-emails.js sent the D-3/D-2/D-1 final reminders
  // (owner decision 2026-10-02): once per day, never resent on a rerun.
  'final_reminder_dates',
  ...APPROVAL_RECORD_FIELDS,
  'reviewed_date',
]);

// The exact bytes loadCalendar() last read, so saveCalendar() can tell whether
// another writer got there first. See the lost-update note on saveCalendar.
let _calendarAtLoad = null;

function loadCalendar() {
  const raw = fs.readFileSync(CALENDAR_PATH, 'utf8');
  _calendarAtLoad = raw;
  return JSON.parse(raw);
}

// `backlogPath` is injectable for the same reason evaluateInvariants takes
// opts.hasMarkdown: the guard below must be testable against a fixture rather
// than against whatever happens to be on disk. Mutating the real file to test it
// races the other test files, which node --test runs in parallel processes.
function loadBacklog(backlogPath = BACKLOG_PATH) {
  if (!fs.existsSync(backlogPath)) return { candidates: [] };
  const backlog = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));
  // fill-slots.js round-trips this WHOLE object back to disk, but fillSlots only
  // ever mutates .candidates - so every other top-level key is rewritten exactly
  // as it was read from THIS checkout's disk. Run the queue from a tree that
  // predates a schema bump and the write silently reverts the header on main.
  // That is not hypothetical: 1414492 reverted _doc/version from v2 to v1 on
  // 2026-08-15 and only CI noticed. Refuse to operate on a schema this code does
  // not own, the same way an unrecognised seasonality_window fails closed rather
  // than scheduling something wrong.
  if (backlog.version !== BACKLOG_SCHEMA_VERSION) {
    throw new Error(
      `${path.basename(backlogPath)} is schema v${backlog.version}, expected v${BACKLOG_SCHEMA_VERSION}. `
      + 'This checkout is stale - pull main before running the queue.',
    );
  }
  return backlog;
}

/**
 * Write the calendar back, without clobbering a concurrent writer.
 *
 * fill-slots round-trips the WHOLE calendar object, exactly like loadBacklog
 * warns about for the backlog — but the calendar has a second writer running
 * on its own schedule. send-review-emails.js runs from the publish workflow
 * (Wed/Sat ~13:00) and assigns the reviewer; the queue runs hours later and
 * saved whatever it had read BEFORE that assignment, silently reverting it.
 *
 * Observed on 2026-09-05: the 13:11 run assigned Audrey Lillpop to
 * how-to-compare-insurance-quotes and set status in-review; the 16:30 queue
 * run removed reviewer, reviewer_email, reviewer_slug, review_sent_date and
 * reverted the status. Every cycle did this, so no reviewer ever survived to
 * publish and every post shipped with an unearned byline. It also froze the
 * rotation: getNextReviewer picks the fewest-assigned reviewer, and since no
 * assignment ever stuck, the counts never moved off their old values and the
 * same person was picked every time.
 *
 * So on write we re-read the file. If it changed underneath us, the review
 * flow's fields win — it is the owner of those — and entries it added that we
 * never saw are carried over rather than dropped.
 */
function saveCalendar(cal) {
  let onDisk = null;
  if (_calendarAtLoad !== null && fs.existsSync(CALENDAR_PATH)) {
    const current = fs.readFileSync(CALENDAR_PATH, 'utf8');
    if (current !== _calendarAtLoad) {
      try { onDisk = JSON.parse(current); } catch { onDisk = null; }
    }
  }

  if (onDisk) {
    const buckets = ['existing_posts', 'year1', 'slots'];
    const diskBySlug = new Map();
    for (const bucket of buckets) {
      for (const entry of onDisk[bucket] || []) {
        if (entry && entry.slug) diskBySlug.set(entry.slug, { entry, bucket });
      }
    }

    const restored = [];
    const seen = new Set();
    for (const bucket of buckets) {
      for (const entry of cal[bucket] || []) {
        if (!entry || !entry.slug) continue;
        seen.add(entry.slug);
        const hit = diskBySlug.get(entry.slug);
        if (!hit) continue;
        for (const field of REVIEW_OWNED_FIELDS) {
          if (entry[field] === hit.entry[field]) continue;
          // The review flow's version wins, including a field it REMOVED: an
          // approval withdrawn on disk (approved_*, approval_mac deleted) must
          // not come back from this job's stale copy.
          if (hit.entry[field] === undefined) delete entry[field];
          else entry[field] = hit.entry[field];
          if (field === 'reviewer') restored.push(`${entry.slug} -> ${hit.entry[field]}`);
        }
      }
    }

    // An entry the other writer added while we held a stale copy. Dropping it
    // is the same lost update in a different shape.
    const carried = [];
    for (const [slug, { entry, bucket }] of diskBySlug) {
      if (seen.has(slug)) continue;
      if (!Array.isArray(cal[bucket])) cal[bucket] = [];
      cal[bucket].push(entry);
      carried.push(slug);
    }

    if (restored.length || carried.length) {
      console.warn(
        `  ! content-calendar.json changed while this job held it. Kept the review flow's writes`
        + `${restored.length ? `; reviewers preserved: ${restored.join(', ')}` : ''}`
        + `${carried.length ? `; entries carried over: ${carried.join(', ')}` : ''}`,
      );
    }
  }

  const text = `${JSON.stringify(cal, null, 2)}\n`;
  fs.writeFileSync(CALENDAR_PATH, text);
  _calendarAtLoad = text;
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

// ── Explicit pause (BLOG-06) ──────────────────────────────────────────────
//
// The content owner stops NEW topics until a date with one top-level calendar
// field:
//   "queue_pause": { "until": "YYYY-MM-DD", "reason": "...", "set_by": "...", "set_on": "YYYY-MM-DD" }
// Deleting slots is not a pause: reserveSlots() re-reserves every free date on
// its next run, and the empty dates then turn the publish workflow red (I2b).
// While paused (every date on or before `until`) no slot is reserved or
// locked, an unlocked slot on a paused date is dropped, and I1/I2/I2b skip
// paused dates. A post already dated inside the pause is left alone and still
// publishes on its date; queue-status lists it. The pause ends by itself after
// `until`, and I9 makes a malformed or over-long one loud. SAGE's queue
// adapter runs this lib, so the pause applies there too.
const MAX_PAUSE_DAYS = 90;

/** A YYYY-MM-DD naming a real day. Date() rolls 2026-02-30 over to 03-02, hence the round trip. */
function isRealYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = asDate(s);
  return !Number.isNaN(d.getTime()) && toYmd(d) === s;
}

/** The calendar's queue_pause when it can be honoured (its `until` is a real date), else null. */
function queuePause(cal) {
  const p = cal && cal.queue_pause;
  return p && typeof p === 'object' && !Array.isArray(p) && isRealYmd(p.until) ? p : null;
}

/** Whether `ymd` falls inside the pause: on or before its `until`. */
function isPaused(cal, ymd) {
  const p = queuePause(cal);
  return Boolean(p && ymd <= p.until);
}

/**
 * Everything wrong with the calendar's queue_pause: [] when it is absent or
 * valid. Invariant I9 and check-data-integrity.js both read this one list, so
 * the alarm and the build check cannot disagree.
 */
function queuePauseProblems(cal) {
  if (!cal || !Object.prototype.hasOwnProperty.call(cal, 'queue_pause')) return [];
  const p = cal.queue_pause;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['is not an object with until, reason, set_by and set_on'];
  const problems = [];
  for (const k of ['until', 'set_on']) {
    if (p[k] === undefined || p[k] === null || p[k] === '') problems.push(`has no "${k}"`);
    else if (!isRealYmd(p[k])) problems.push(`"${k}" is ${JSON.stringify(p[k])}, not a YYYY-MM-DD date`);
  }
  for (const k of ['reason', 'set_by']) {
    if (typeof p[k] !== 'string' || !p[k].trim()) problems.push(`has no "${k}"`);
  }
  if (isRealYmd(p.until) && isRealYmd(p.set_on)) {
    const days = daysBetween(p.set_on, p.until);
    if (days > MAX_PAUSE_DAYS) {
      problems.push(`"until" ${p.until} is ${days} days after "set_on" ${p.set_on}; a pause runs at most ${MAX_PAUSE_DAYS} days`);
    } else if (days < 0) {
      problems.push(`"until" ${p.until} is before "set_on" ${p.set_on}`);
    }
  }
  return problems;
}


// ── Real-world anchors ────────────────────────────────────────────────────
//
// A month band is a guess: "July-August" permits publishing back-to-school
// content on August 31, three weeks after school starts. An anchored window is
// timed against the actual date instead. Windows with no anchor keep the month
// band, and the fallback is reported rather than silent.

function loadAnchors(root = ROOT) {
  try {
    const p = root === ROOT ? ANCHORS_PATH : path.join(root, 'data', 'seasonal-anchors.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return { anchors: {} }; }
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * seasonality_window -> the month indices it spans, parsed from the taxonomy's
 * prose definitions ("July-August", "September (before Oct 15 open enrolment)").
 *
 * THE single implementation. There were three near-identical copies (here,
 * fill-slots.js, and the sage content-queue adapter) back when an unparseable
 * window merely meant "always eligible" and a disagreement between them was
 * invisible. Now that eligibility fails CLOSED, a parser that returns nothing
 * stops the queue — so three of them that can drift is a correctness problem,
 * not a tidiness one.
 *
 * Throws rather than returning {} on a missing/unreadable taxonomy: an empty
 * map is indistinguishable from "no windows defined", which under fail-closed
 * would silently refuse to schedule anything seasonal.
 */
function loadWindowMonths(root = ROOT) {
  const p = path.join(root, 'data', 'content-taxonomy.json');
  const tax = JSON.parse(fs.readFileSync(p, 'utf8'));
  const defs = tax?.lifecycle?.seasonal?.seasonality_windows;
  if (!defs || !Object.keys(defs).length) {
    throw new Error(`No seasonality_windows defined in ${p}`);
  }
  const out = {};
  for (const [name, desc] of Object.entries(defs)) {
    // Only the text before the parenthetical is the range; the note after it
    // routinely names other months ("September (before Oct 15 ...)").
    const found = String(desc).split('(')[0].match(/[A-Za-z]+/g) || [];
    const idx = found.map(w => MONTH_NAMES.indexOf(w.toLowerCase())).filter(i => i >= 0);
    if (!idx.length) continue;
    const months = [];
    for (let m = idx[0]; ; m = (m + 1) % 12) { months.push(m); if (m === idx[idx.length - 1]) break; }
    out[name] = months;
  }
  return out;
}

/** The anchor governing a window, if one claims it. */
function anchorForWindow(windowName, anchors) {
  const all = (anchors && anchors.anchors) || {};
  for (const [name, a] of Object.entries(all)) {
    if ((a.applies_to_windows || []).includes(windowName)) return { name, ...a };
  }
  return null;
}

/**
 * The eligible date range for an anchored window in the year containing `ymd`.
 * Returns null when the anchor has no date for that year -- the caller then
 * falls back to the month band and reports it.
 */
function anchorRange(anchor, ymd) {
  const year = String(asDate(ymd).getUTCFullYear());
  const dateStr = (anchor.dates || {})[year];
  if (!dateStr) return null;
  const anchorDate = asDate(dateStr);
  const lead = Number.isFinite(anchor.lead_days) ? anchor.lead_days : 30;
  const close = Number.isFinite(anchor.close_days) ? anchor.close_days : 0;
  return {
    anchorDate: dateStr,
    // close_days may be NEGATIVE, which extends eligibility past the anchor
    // (Medicare AEP stays useful right through Dec 7).
    from: toYmd(new Date(anchorDate.getTime() - lead * DAY_MS)),
    to: toYmd(new Date(anchorDate.getTime() - close * DAY_MS)),
  };
}

/**
 * Whether a candidate may occupy a slot on a given date. Evergreen items are
 * always eligible; seasonal ones only inside their declared window (+/-1
 * month, matching check-data-integrity.js so the scheduler cannot place
 * something the build would then reject).
 */
function isEligibleOn(candidate, ymd, windowMonths, opts = {}) {
  return eligibilityOn(candidate, ymd, windowMonths, opts).eligible;
}

/**
 * Eligibility with its reasoning, so callers can distinguish "out of season"
 * from "we never recorded when this actually happens".
 * @returns {{ eligible: boolean, basis: 'evergreen'|'anchor'|'months'|'anchor-missing', detail?: string }}
 */
function eligibilityOn(candidate, ymd, windowMonths, opts = {}) {
  if (!candidate.seasonality_window) return { eligible: true, basis: 'evergreen' };
  const anchors = opts.anchors || loadAnchors(opts.root);
  const anchor = anchorForWindow(candidate.seasonality_window, anchors);

  if (anchor) {
    const range = anchorRange(anchor, ymd);
    if (range) {
      const ok = ymd >= range.from && ymd <= range.to;
      return {
        eligible: ok,
        basis: 'anchor',
        detail: `${anchor.name} ${range.anchorDate}; window ${range.from}..${range.to}`,
      };
    }
    // Anchor claims this window but has no date for the year in question.
    // Fall back to the month band rather than blocking everything, and say so.
    const monthsOk = _monthEligible(candidate, ymd, windowMonths);
    return {
      eligible: monthsOk,
      basis: 'anchor-missing',
      detail: `${anchor.name} has no date for ${asDate(ymd).getUTCFullYear()} - fell back to the month band`,
    };
  }

  // No anchor claims this window, and the taxonomy does not define it either.
  // FAIL CLOSED. The old behaviour returned "eligible on every date", which
  // means the one filter standing between a winter driving guide and an August
  // publish date could be defeated by a typo, a renamed window, or a bot
  // emitting a value in the wrong vocabulary (the topic-researcher's output
  // contract does exactly that: it writes `seasonal_window: "2026-09"`, which
  // matches no taxonomy window at all).
  //
  // A window we cannot interpret is not a window we can honour. Refusing to
  // schedule leaves the slot visibly empty and alarms through I2/I2b; the
  // alternative failure is silent and publishes the wrong thing.
  const known = _windowIsKnown(candidate.seasonality_window, windowMonths);
  if (!known) {
    return {
      eligible: false,
      basis: 'unknown-window',
      detail: `seasonality_window "${candidate.seasonality_window}" is not defined in content-taxonomy.json `
        + 'and no anchor claims it - refusing to schedule rather than treating it as always-eligible',
    };
  }
  return { eligible: _monthEligible(candidate, ymd, windowMonths), basis: 'months' };
}

/**
 * Whether the window is one we can actually reason about. An empty/absent
 * windowMonths map means the caller could not load the taxonomy at all, which
 * is a different failure from "this window is not in it" - in that case every
 * window is unknown and the queue stops, which is the correct loud outcome.
 */
function _windowIsKnown(windowName, windowMonths) {
  const months = (windowMonths || {})[windowName];
  return Array.isArray(months) && months.length > 0;
}

function _monthEligible(candidate, ymd, windowMonths) {
  const months = (windowMonths || {})[candidate.seasonality_window];
  if (!months || !months.length) return false; // see _windowIsKnown - fail closed
  const allowed = new Set();
  for (const m of months) { allowed.add(m); allowed.add((m + 11) % 12); allowed.add((m + 1) % 12); }
  return allowed.has(asDate(ymd).getUTCMonth());
}

// ── Choosing what fills a slot ────────────────────────────────────────────
//
// Seasonality is a HARD filter, never a score: the whole point of the redesign
// is that a winter post cannot land in August no matter how well it scores on
// anything else. Everything below only orders the candidates that already
// passed that filter.

const CANNIBALIZATION_THRESHOLD = 0.6;
// A written draft is worth more than any ranking signal: it costs nothing and
// ships immediately, which is what closes the 2026 Aug-Oct gap.
const W_DRAFT_READY = 100;
// A seasonal window that is about to close is use-it-or-lose-it for a year.
const W_SEASON_CLOSING = 50;
const SEASON_CLOSING_DAYS = 45;
const W_LOCATION_UNCOVERED = 20;
const W_LOCATION_THIN = 10;
const W_CLUSTER_THIN = 15;
const W_FUNNEL_THIN = 5;

// ── The cannibalization test: which keywords are one search ──────────────
//
// A keyword is read as a set of tokens, and two keywords are one search when
// their tokens overlap at CANNIBALIZATION_THRESHOLD or more. Until 2026-10-04
// the tokenizer dropped every word of 1-2 characters and split "$25,000" into
// "25" and "000", so the test could not see what made a search different:
// "SR-22 auto insurance requirements kentucky" scored 1.00 against the
// Kentucky auto requirements guide, "HO-3 vs HO-5" and "plan G" vs "plan N"
// read as the same words, and "Clarksville IN" vs "Clarksville TN" as the same
// city. SAGE reads keywords the way this test now does (see the note on
// topic-intent.js below), so a topic it proposed as distinct and the owner
// approved could still be refused here.
//
// What a keyword's tokens are:
//  - words, as before: 3+ characters, not in STOPWORDS;
//  - subjects ("code:<x>"): what names a search of its own in one or two
//    characters or in digits: short codes joined the way they are written
//    (SR-22 → sr22, HO-3 → ho3, E&O → eo, Part A → parta, Plan G → plang,
//    401(k) → 401k, split limits 250/500/100 as one), other short words (RV,
//    EV, GL), and numbers ($25,000 → 25000, "10 employees", a zip code). A
//    year is a word, as it always was ("medicare open enrollment 2027
//    kentucky" is still the enrollment guide), and a count of list items is
//    dropped (_isCount: "10 home insurance tips" is "home insurance tips");
//  - states ("state:ky|tn|in"): Kentucky, Tennessee and Indiana by name or
//    abbreviation. IN is Indiana only when written in capitals; "in" is the
//    preposition.
//
// jaccard() then reads two keywords as different searches (0) when they name
// different subjects, or when both name states and the states differ,
// whatever else they share. Otherwise it is the overlap of their words and
// subjects, and states are not counted, except that a keyword naming no state
// is read as Kentucky, the agency's default market (which is why "kentucky"
// was a stopword): "flood insurance" and "flood insurance kentucky" are one
// search, and a Tennessee or Indiana state that only one of the two names
// counts as a word only that one has ("home insurance nashville" vs "home
// insurance nashville tn" scores 0.67, so a place written once with its state
// and once without is still one search). A plain Set of words, with no states
// or subjects in it, scores exactly as before.
//
// The normalization (_words) mirrors _words() in sage-server
// hive/lib/topic-intent.js, which SAGE uses to tell a researched topic from
// the site's existing ones: keep the two in step. They are not shared because
// SAGE must decide without this lib (it loads it from the site mount, which
// may be stale or absent) and this lib cannot load SAGE's. One deliberate
// difference: a state abbreviation is never the first half of a code ("KY 61"
// stays a state and a number).
//
// Known limits, accepted and each pinned by a test (the last three are read
// the same way by topic-intent.js, which also knows place names):
//  - the test has no place names, so the state a keyword names is the only
//    state it has. A stateless keyword of 3+ words and a Tennessee or Indiana
//    keyword that share every other word score 0.67 and are refused ("auto
//    insurance requirements" vs "auto insurance requirements tennessee"); two
//    keywords that both name a state are never confused this way;
//  - "plan a <word>" reads as the Medigap code plana ("plan a budget");
//  - dotted abbreviations are read letter by letter ("U.S." is u + s, two
//    subjects, not the stopword "us");
//  - IN in an all-capitals keyword is Indiana ("HOME INSURANCE IN LOUISVILLE").

const STOPWORDS = new Set(['insurance', 'the', 'and', 'for', 'your', 'what', 'guide', 'need', 'you']);
// The only words of 1-2 characters that are dropped: function words and place
// abbreviations (the "Mt." of Mt. Washington). Same list as SHORT_STOP in
// topic-intent.js.
const SHORT_STOP = new Set([
  'a', 'i', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on',
  'or', 'so', 'to', 'up', 'us', 'we', 'ok', 'vs', 'wo', 'ca', 'mt', 'st', 'ft',
]);
// 'in' is not here: it is Indiana only as IN in capitals (see _words).
const STATE_WORDS = { ky: 'ky', kentucky: 'ky', tn: 'tn', tennessee: 'tn', indiana: 'in' };
const DEFAULT_STATE = 'ky';
const RAW_ALIASES = { mount: 'mt', saint: 'st', fort: 'ft' };
const YEAR = /^(?:19|20)\d\d$/;
// A number right before one of these, or a keyword's first number with one of
// these anywhere after it, counts list items ("5 mistakes", "10 best", "the 7
// most common home insurance mistakes"): _isCount.
const LIST_WORDS = new Set([
  'best', 'tips', 'ways', 'things', 'questions', 'mistakes', 'reasons', 'steps', 'signs', 'myths', 'facts',
  'ideas', 'secrets', 'tricks', 'hacks', 'rules', 'lessons', 'habits', 'examples', 'types', 'kinds', 'factors',
  'benefits', 'discounts', 'options', 'features', 'misconceptions',
]);
// A number right before one of these is a quantity, never a count ("16 year
// old drivers: 5 tips" keeps 16; "$1 million" keeps 1; "10 employees health
// insurance options" keeps 10).
const UNIT_WORDS = new Set([
  'year', 'years', 'month', 'months', 'week', 'weeks', 'day', 'days', 'hour', 'hours', 'mile', 'miles',
  'percent', 'hundred', 'thousand', 'million', 'billion',
  'employees', 'drivers', 'vehicles', 'cars', 'trucks', 'people', 'members', 'units', 'acres', 'rooms', 'beds',
  'locations', 'properties', 'homes', 'policies',
]);
// A number right after one of these names a thing, never a count ("section 8
// landlord insurance tips", "class 8 truck", "type 2 diabetes", "chapter 7").
const LABEL_WORDS = new Set([
  'class', 'section', 'chapter', 'tier', 'level', 'phase', 'zone', 'type', 'category', 'grade', 'form',
]);
const STATE_TOKEN = 'state:';
const SUBJECT_TOKEN = 'code:';

/**
 * The words of a keyword, in order: Unicode folded to ASCII where it can be
 * (NFKD, accents stripped), contractions and possessives dropped, thousands
 * separators removed ($25,000 → 25000), and codes joined: "E&O" → eo;
 * "401(k)" → 401k; split limits "50/100/50" stay one code; "SR-22"/"SR 22" →
 * sr22, "HO-3" → ho3 (a 1-2 letter word that is not a function word or a
 * state, then a 1-3 digit number); "Part A" → parta,
 * "Plan G" → plang (Medicare parts A-D, Medigap plans A-N). Each word carries
 * whether it is a joined code and whether it was written as IN in capitals.
 * @returns {{w: string, code?: boolean, upperIn?: boolean}[]}
 */
function _words(text) {
  const s = String(text || '').normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[‘’ʼ`]/g, '\'')
    .replace(/n't\b/gi, ' not')
    .replace(/'(?:s|d|m|ll|ve|re)\b/gi, '')
    .replace(/(\d)\(([a-z])\)/gi, '$1$2') // 401(k), 403(b)
    .replace(/(^|[^\p{L}\p{N}&])([a-z])\s*&\s*([a-z])(?=$|[^\p{L}\p{N}&])/giu, '$1$2&$3');
  const words = [];
  // Runs of letters, digits, & and commas, as a split on everything else
  // would give, except that numbers joined by slashes stay one run: split
  // limits (25/50/25, 250/500/100) are one subject, never three numbers.
  for (const [raw] of s.matchAll(/\d+(?:\/\d+)+|[\p{L}\p{N}&,]+/gu)) {
    if (raw.includes('/')) { words.push({ w: raw, code: true }); continue; }
    const t = raw.replace(/^,+|,+$/g, ''); // "E&O," is the code eo
    if (!t) continue;
    if (/^[a-z]&[a-z]$/i.test(t)) { words.push({ w: t.replace('&', '').toLowerCase(), code: true }); continue; }
    if (/^\d{1,3}(?:,\d{3})+$/.test(t)) { words.push({ w: t.replace(/,/g, '') }); continue; }
    for (const part of t.split(/[&,]/)) {
      if (!part) continue;
      const lower = part.toLowerCase();
      words.push({ w: RAW_ALIASES[lower] || lower, upperIn: part === 'IN' });
    }
  }
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    const b = words[i + 1];
    const codePair = b && !a.code && !b.code && (
      (/^[a-z]{1,2}$/.test(a.w) && !SHORT_STOP.has(a.w) && !STATE_WORDS[a.w] && /^\d{1,3}$/.test(b.w))
      || (a.w === 'part' && /^[a-d]$/.test(b.w))
      || (a.w === 'plan' && /^[a-n]$/.test(b.w)));
    if (codePair) {
      out.push({ w: a.w + b.w, code: true });
      i++;
    } else {
      out.push(a);
    }
  }
  return out;
}

/**
 * Whether words[i] counts list items rather than naming a subject: a number
 * of 1-2 digits written on its own (1-99; not part of a code or of split
 * limits, not a thousands number), not right before a unit or quantity
 * (UNIT_WORDS), not right after a label (LABEL_WORDS), and either
 *  (a) right after "top" or "best" ("top 10 home insurance tips", "best 10
 *      car insurance companies"),
 *  (b) right before a list word (LIST_WORDS: "5 ways to lower car insurance",
 *      "home insurance: 7 mistakes to avoid"), or
 *  (c) the keyword's first number (no number of any length before it), with a
 *      list word anywhere after it ("10 home insurance tips", "the 7 most
 *      common home insurance mistakes", "kentucky homeowners: 7 common
 *      mistakes").
 * Every other number stays a subject.
 */
function _isCount(words, i) {
  const w = words[i];
  if (w.code || !/^\d{1,2}$/.test(w.w)) return false;
  const prev = words[i - 1];
  const next = words[i + 1];
  if (next && UNIT_WORDS.has(next.w)) return false;
  if (prev && LABEL_WORDS.has(prev.w)) return false;
  if (prev && (prev.w === 'top' || prev.w === 'best')) return true;
  if (next && LIST_WORDS.has(next.w)) return true;
  return !words.slice(0, i).some(x => /^\d+$/.test(x.w)) && words.slice(i + 1).some(x => LIST_WORDS.has(x.w));
}

/** A keyword's tokens: words, subjects ("code:sr22") and states ("state:tn"). */
function tokenize(text) {
  const tokens = new Set();
  const words = _words(text);
  words.forEach((word, i) => {
    const state = word.upperIn ? 'in' : STATE_WORDS[word.w];
    const w = word.w;
    if (state) tokens.add(STATE_TOKEN + state);
    else if (_isCount(words, i)) return;
    else if (word.code || (w.length <= 2 && !SHORT_STOP.has(w)) || (/\d/.test(w) && !YEAR.test(w))) tokens.add(SUBJECT_TOKEN + w);
    else if (w.length > 2 && !STOPWORDS.has(w)) tokens.add(w);
  });
  return tokens;
}

/** A token set's states as named (none: empty), subjects, and everything but its states. */
function _parts(tokens) {
  const states = new Set();
  const rest = new Set();
  const subjects = new Set();
  for (const t of tokens) {
    if (t.startsWith(STATE_TOKEN)) { states.add(t); continue; }
    rest.add(t);
    if (t.startsWith(SUBJECT_TOKEN)) subjects.add(t);
  }
  return { states, rest, subjects };
}

const _sameSet = (a, b) => a.size === b.size && [...a].every(t => b.has(t));

/**
 * How far two keywords' tokens overlap, 0-1: 0 when they name different
 * subjects, or both name states and the states differ (two searches,
 * whatever else they share); otherwise the Jaccard overlap of everything but
 * the states, where a keyword naming no state is read as Kentucky and a
 * Tennessee or Indiana state only the other names is a token only it has.
 */
function jaccard(a, b) {
  const A = _parts(a);
  const B = _parts(b);
  if (!A.rest.size || !B.rest.size) return 0;
  if (!_sameSet(A.subjects, B.subjects)) return 0;
  let unshared = 0;
  if (A.states.size && B.states.size) {
    if (!_sameSet(A.states, B.states)) return 0;
  } else {
    for (const t of A.states.size ? A.states : B.states) if (t !== STATE_TOKEN + DEFAULT_STATE) unshared++;
  }
  let inter = 0;
  for (const t of A.rest) if (B.rest.has(t)) inter++;
  return inter / (A.rest.size + B.rest.size + unshared - inter);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/** Every /insurance/*.html page that exists, from the canonical landing data. */
function locationPages(root = ROOT) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'landing-pages.json'), 'utf8'));
    return [...(data.cities || []), ...(data.counties || [])]
      .filter(x => x && x.slug).map(x => `/insurance/${x.slug}.html`);
  } catch { return []; }
}

/**
 * Coverage snapshot the scorer reasons against: what keywords are already
 * taken, and which clusters / locations / funnel stages are thin.
 */
function buildSchedulingContext(cal, opts = {}) {
  const all = [...(cal.existing_posts || []), ...(cal.year1 || [])];
  const keywordIndex = all
    .filter(p => p.primary_keyword && p.status !== 'error')
    .map(p => ({ slug: p.slug, tokens: tokenize(p.primary_keyword) }));

  const clusterCounts = {};
  const funnelCounts = {};
  const locationCounts = {};
  for (const page of locationPages(opts.root)) locationCounts[page] = 0;
  for (const p of all) {
    if (p.related_cluster) clusterCounts[p.related_cluster] = (clusterCounts[p.related_cluster] || 0) + 1;
    if (p.funnel_stage) funnelCounts[p.funnel_stage] = (funnelCounts[p.funnel_stage] || 0) + 1;
    for (const loc of p.target_location_pages || []) locationCounts[loc] = (locationCounts[loc] || 0) + 1;
  }
  return {
    keywordIndex,
    clusterCounts,
    funnelCounts,
    locationCounts,
    clusterMedian: median(Object.values(clusterCounts)),
    funnelMedian: median(Object.values(funnelCounts)),
    locationMedian: median(Object.values(locationCounts)),
    // Optional GSC signal, keyed by primary_keyword. The site scripts have no
    // access to Search Console; the sage adapter injects it.
    signal: opts.signal || {},
  };
}

/** The closest already-taken keyword, if it is close enough to compete. */
function cannibalizationConflict(candidate, ctx, threshold = CANNIBALIZATION_THRESHOLD) {
  const mine = tokenize(candidate.primary_keyword);
  let worst = null;
  for (const entry of ctx.keywordIndex) {
    if (entry.slug === candidate.slug) continue;
    const score = jaccard(mine, entry.tokens);
    if (score >= threshold && (!worst || score > worst.score)) worst = { slug: entry.slug, score };
  }
  return worst;
}

/**
 * Score a candidate for a specific date. Returns { eligible, score, reasons }.
 * Ineligible candidates carry the reason they were rejected so a human reading
 * the log can tell "wrong season" from "would cannibalize".
 */
function scoreCandidate(candidate, ymd, ctx, windowMonths, opts = {}) {
  const reasons = [];
  if (candidate.status !== 'approved') {
    return { eligible: false, score: 0, reasons: [`status is "${candidate.status}", not approved`] };
  }
  const elig = eligibilityOn(candidate, ymd, windowMonths, opts);
  if (!elig.eligible) {
    // An unrecognised window is a data defect, not a scheduling outcome. Say
    // which it is, or an operator reading the log chases the wrong thing.
    const why = elig.basis === 'unknown-window'
      ? elig.detail
      : `out of season for ${ymd} (${candidate.seasonality_window})`;
    return { eligible: false, score: 0, reasons: [why] };
  }
  const conflict = cannibalizationConflict(candidate, ctx, opts.threshold);
  if (conflict) {
    return { eligible: false, score: 0, reasons: [`cannibalizes "${conflict.slug}" (${conflict.score.toFixed(2)})`] };
  }

  let score = 0;
  const hasDraft = (opts.hasMarkdown || hasMarkdown)(candidate.slug);
  if (hasDraft) { score += W_DRAFT_READY; reasons.push('draft already written'); }

  if (candidate.seasonality_window) {
    const months = windowMonths[candidate.seasonality_window] || [];
    const lastMonth = months[months.length - 1];
    if (lastMonth !== undefined) {
      // Days until the window's final month ends, in the year of this slot.
      const year = asDate(ymd).getUTCFullYear();
      const windowEnd = new Date(Date.UTC(year, lastMonth + 1, 0, 12));
      const daysLeft = Math.round((windowEnd - asDate(ymd)) / DAY_MS);
      if (daysLeft >= 0 && daysLeft <= SEASON_CLOSING_DAYS) {
        score += W_SEASON_CLOSING;
        reasons.push(`season closes in ${daysLeft}d`);
      }
    }
  }

  for (const loc of candidate.target_location_pages || []) {
    const count = ctx.locationCounts[loc];
    if (count === 0) { score += W_LOCATION_UNCOVERED; reasons.push(`${loc} has no coverage`); }
    else if (count !== undefined && count < ctx.locationMedian) { score += W_LOCATION_THIN; reasons.push(`${loc} is thin`); }
  }

  if (candidate.related_cluster && (ctx.clusterCounts[candidate.related_cluster] || 0) < ctx.clusterMedian) {
    score += W_CLUSTER_THIN; reasons.push(`cluster "${candidate.related_cluster}" is thin`);
  }
  if (candidate.funnel_stage && (ctx.funnelCounts[candidate.funnel_stage] || 0) < ctx.funnelMedian) {
    score += W_FUNNEL_THIN; reasons.push(`funnel stage "${candidate.funnel_stage}" is thin`);
  }

  const sig = ctx.signal[candidate.primary_keyword];
  if (sig) {
    // Impressions with a poor average position is the classic content gap:
    // people are searching and we are not answering well.
    const bump = Math.min(30, Math.round((sig.impressions || 0) / 100)) + (sig.position > 10 ? 10 : 0);
    if (bump) { score += bump; reasons.push(`search signal +${bump}`); }
  }

  return { eligible: true, score, reasons };
}

/** Shape an approved candidate into a dated year1 post. */
function candidateToPost(candidate, ymd, today) {
  return {
    publish_date: ymd,
    title: candidate.title,
    slug: candidate.slug,
    description: candidate.description || '',
    pillar: candidate.pillar || null,
    topic_type: candidate.topic_type || 'guide',
    search_intent: candidate.search_intent || 'informational',
    funnel_stage: candidate.funnel_stage || 'top',
    primary_keyword: candidate.primary_keyword,
    secondary_keywords: candidate.secondary_keywords || [],
    target_product_page: candidate.target_product_page || null,
    target_location_pages: candidate.target_location_pages || [],
    secondary_internal_links: candidate.secondary_internal_links || [],
    related_cluster: candidate.related_cluster || null,
    conversion_goal: candidate.conversion_goal || 'quote-request',
    evergreen_or_seasonal: candidate.seasonality_window ? 'seasonal' : 'evergreen',
    seasonality_window: candidate.seasonality_window || null,
    refresh_cycle: candidate.refresh_cycle || 'annual',
    page_role: candidate.page_role || (candidate.seasonality_window ? 'seasonal' : 'supporting'),
    is_link_target: false,
    receives_future_links: true,
    status: 'planned',
    source: 'queue-lock',
    locked_at: today,
    notes: candidate.notes || '',
    // The SERP evidence, differentiation angle, direct-answer target and
    // sources the researcher gathered. blog-planner injects it into the
    // blog-write task and seo-auditor's draft gate checks the draft AGAINST it
    // (direct answer delivered, questions answered, sources cited). Dropping it
    // here would mean a topic picked BECAUSE of a specific angle reaches the
    // writer as a bare title, and the gate then has nothing to verify against.
    research_brief: candidate.research_brief || null,
  };
}

/** Reserve every unclaimed publish date inside the horizon. Idempotent. */
function reserveSlots(cal, today) {
  if (!Array.isArray(cal.slots)) cal.slots = [];
  const taken = occupiedDates(cal);
  const byDate = new Map(cal.slots.map(s => [s.date, s]));
  const added = [];
  for (const date of publishDatesWithin(today, HORIZON_DAYS)) {
    if (taken.has(date) || byDate.has(date) || isPaused(cal, date)) continue;
    const slot = { date, state: 'reserved', locked_slug: null, locked_at: null, reserved_at: today };
    cal.slots.push(slot);
    byDate.set(date, slot);
    added.push(date);
  }
  const before = cal.slots.length;
  // Drop slots a real post has claimed, and past slots never locked. A past
  // LOCKED slot stays: it is evidence something was committed and not shipped.
  cal.slots = cal.slots.filter(s => {
    if (taken.has(s.date) && s.state !== 'locked') return false;
    if (daysBetween(today, s.date) < 0 && s.state !== 'locked') return false;
    // Paused (BLOG-06): capacity the owner withdrew. A locked slot keeps its post.
    if (s.state !== 'locked' && isPaused(cal, s.date)) return false;
    return true;
  });
  cal.slots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { added, pruned: before - cal.slots.length };
}

/**
 * Lock the best approved candidate into every reserved slot inside the lock
 * window, nearest date first. Mutates `cal` and `backlog`; returns a log.
 */
function fillSlots(cal, backlog, today, windowMonths, opts = {}) {
  const locked = [];
  const skipped = [];
  const reserved = (cal.slots || []).filter(s => s.state === 'reserved');

  // Anything nearer than MIN_LOCK_LEAD_DAYS is left empty and reported: there
  // is no time left for the licensed reviewer to approve it, and nothing
  // publishes without that approval (owner decision 2026-10-02). The old
  // `allowReviewSkip` override, which filled such a date and published it
  // with no reviewer, was removed with that decision.
  const targets = [];
  for (const slot of reserved) {
    if (isPaused(cal, slot.date)) continue; // BLOG-06: no topic is committed to a paused date
    const d = daysBetween(today, slot.date);
    if (d < 0 || d > LOCK_DAYS) continue;
    if (d >= MIN_LOCK_LEAD_DAYS) { targets.push({ slot }); continue; }
    skipped.push({ date: slot.date, reason: `only ${d}d out; too late for the licensed reviewer's D-${MIN_LOCK_LEAD_DAYS} lead time, and nothing publishes without their approval` });
  }
  // Nearest first: the most urgent date gets first pick of the backlog.
  targets.sort((a, b) => (a.slot.date < b.slot.date ? -1 : 1));

  for (const { slot } of targets) {
    // Rebuilt each iteration so a lock made a moment ago counts against the
    // next one -- otherwise two near-identical candidates both get placed.
    const ctx = buildSchedulingContext(cal, opts);
    const ranked = (backlog.candidates || [])
      .map(c => ({ candidate: c, ...scoreCandidate(c, slot.date, ctx, windowMonths, opts) }))
      .filter(r => r.eligible);
    ranked.sort((a, b) => b.score - a.score);

    if (!ranked.length) {
      skipped.push({ date: slot.date, reason: 'no eligible approved candidate' });
      continue;
    }
    const winner = ranked[0];
    const post = candidateToPost(winner.candidate, slot.date, today);
    cal.year1.push(post);
    slot.state = 'locked';
    slot.locked_slug = winner.candidate.slug;
    slot.locked_at = today;
    backlog.candidates = (backlog.candidates || []).filter(c => c.slug !== winner.candidate.slug);
    locked.push({
      date: slot.date, slug: winner.candidate.slug, score: winner.score,
      reasons: winner.reasons,
    });
  }
  return { locked, skipped };
}

/**
 * Evaluate the queue invariants (I1-I9). Pure: takes the data and the clock,
 * returns findings. `opts.hasMarkdown` is injectable so the rules can be
 * tested against fixtures rather than whatever happens to be on disk.
 *
 * @returns {{ violations: Array<{id,message}>, stats: object }}
 */
function evaluateInvariants(cal, backlog, today, opts = {}) {
  const markdownFor = opts.hasMarkdown || hasMarkdown;
  // BLOG-06: an unlocked slot on a paused date is capacity the owner withdrew,
  // not a date to fill, so I1/I2/I2b skip it. A locked slot still counts.
  const slots = (cal.slots || []).filter(s => s.state === 'locked' || !isPaused(cal, s.date));
  const posts = cal.year1 || [];
  const violations = [];
  const add = (id, message) => violations.push({ id, message });

  // I9 - the owner's pause (BLOG-06) is well formed and ends at most
  // MAX_PAUSE_DAYS after it was set. First, because I1/I2/I2b depend on it: a
  // pause without a real "until" is not honoured, so those fire again.
  const pause = queuePause(cal);
  const pauseProblems = queuePauseProblems(cal);
  if (pauseProblems.length) {
    add('I9', `queue_pause ${pauseProblems.join('; ')}${pause ? '' : '. The queue is NOT paused'}`);
  }

  const taken = occupiedDates(cal);
  const slotByDate = new Map(slots.map(s => [s.date, s]));
  const postByDate = new Map(posts.filter(p => p.publish_date).map(p => [p.publish_date, p]));
  const horizonDates = publishDatesWithin(today, HORIZON_DAYS);

  const upcoming = posts
    .filter(p => p.status !== 'published' && p.publish_date && daysBetween(today, p.publish_date) >= 0)
    .sort((a, b) => (a.publish_date < b.publish_date ? -1 : 1));

  // I1 - capacity reserved across the horizon.
  const unreserved = horizonDates.filter(d => !taken.has(d) && !slotByDate.has(d) && !isPaused(cal, d));
  if (unreserved.length) {
    add('I1', `${unreserved.length} publish date(s) in the next ${HORIZON_DAYS}d neither filled nor reserved: ${unreserved.join(', ')}`);
  }

  // I2 - a topic committed once inside the lock window.
  // Only slots that can still be filled with the reviewer's lead time. A slot
  // nearer than MIN_LOCK_LEAD_DAYS is past saving (I2b): it could not be
  // approved in time, so it would only hold.
  const dueToLock = slots.filter(s => {
    const d = daysBetween(today, s.date);
    return d >= MIN_LOCK_LEAD_DAYS && d <= LOCK_DAYS && s.state !== 'locked';
  });
  if (dueToLock.length) {
    add('I2', `${dueToLock.length} slot(s) in the ${MIN_LOCK_LEAD_DAYS}-${LOCK_DAYS}d lock window have no topic: ${dueToLock.map(s => s.date).join(', ')}`);
  }
  const tooLate = slots.filter(s => {
    const d = daysBetween(today, s.date);
    return d >= 0 && d < MIN_LOCK_LEAD_DAYS && s.state !== 'locked';
  });
  if (tooLate.length) {
    add('I2b', `${tooLate.length} slot(s) will publish nothing - too close to fill and still leave the licensed reviewer time to approve it: ${tooLate.map(s => s.date).join(', ')}`);
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

  // I6 - a post on a reviewer's change-request hold has reached its date. A
  // hold never publishes (scripts/lib/calendar-status.js HOLD_STATUSES) and the
  // publisher skips it without an error, so this is what makes the empty slot
  // loud: it clears when the reviewer approves the edited version SAGE
  // proposed, or the content owner releases the hold on the calendar.
  for (const p of posts.filter(x => isHeld(x.status) && x.publish_date && daysBetween(today, x.publish_date) <= 0)) {
    add('I6', `"${p.slug}" was due ${p.publish_date} but is on hold (${p.status}) for its reviewer's changes; it publishes only after the reviewer approves the edit or the hold is released`);
  }

  // I7 - a post the publisher refused: status 'error', with error_reason set by
  // publish-scheduled-posts.js or reconcile-calendar.js (missing or unready
  // markdown, or an approval whose bytes, byline or SAGE signature no longer
  // match: scripts/lib/review-credit.js). Also a status neither repo knows,
  // which the publisher only annotates. Neither publishes, and the renderer
  // does not render either (scripts/generate-blog.js). The publish step
  // commits and carries on (exit 3), so this is what keeps the workflow red
  // until someone fixes the entry.
  for (const p of posts.filter(x => x.status === 'error' || (x.status && !isKnownStatus(x.status)))) {
    const why = x => (x.status === 'error' ? `is in error (${x.error_reason || 'no reason recorded'})` : `has unrecognised status "${x.status}"`);
    add('I7', `"${p.slug}" (due ${p.publish_date || 'undated'}) ${why(p)} and is not publishing`);
  }

  // I8 - a post due without its licensed reviewer's approval (owner decision
  // 2026-10-02: approval is REQUIRED). The publisher holds it without an
  // error (scripts/lib/calendar-status.js heldForApproval) and the renderer
  // does not render it, so this is what makes the empty date loud. It keeps
  // its date (occupiedDates), so the queue never books a second post onto it
  // and only that one date is blocked. It clears when the reviewer approves it
  // (it then publishes on the next run, still dated publish_date) or the
  // content owner moves it, which needs a new approval for the new date.
  const heldPosts = posts.filter(p => heldForApproval(p, today));
  for (const p of heldPosts) {
    const md = markdownFor(p.slug);
    add('I8', `"${p.slug}" was due ${p.publish_date} but has no licensed approval (status ${p.status}, reviewer ${p.reviewer_email ? `${p.reviewer || '?'} <${p.reviewer_email}>` : 'none assigned'})`
      + `; ${heldNextStep(p, md)}`);
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
      nextEmptyDate: horizonDates.find(d => !taken.has(d) && !isPaused(cal, d)) || null,
      // BLOG-06: the pause being honoured (null when none is). `dates` are the
      // horizon dates it leaves empty (neither filled nor slotted, so the
      // horizon counts still add up); `posts` were dated inside it and still publish.
      pause: pause ? {
        until: pause.until,
        reason: pause.reason,
        set_by: pause.set_by,
        set_on: pause.set_on,
        active: today <= pause.until,
        dates: horizonDates.filter(d => d <= pause.until && !taken.has(d) && !slotByDate.has(d)),
        posts: upcoming.filter(p => p.publish_date <= pause.until),
      } : null,
      heldForApproval: heldPosts,
    },
  };
}

module.exports = {
  CALENDAR_PATH, BACKLOG_PATH, BLOG_SRC, BACKLOG_SCHEMA_VERSION,
  evaluateInvariants,
  CANNIBALIZATION_THRESHOLD,
  tokenize, jaccard, locationPages,
  buildSchedulingContext, cannibalizationConflict, scoreCandidate,
  candidateToPost, reserveSlots, fillSlots,
  HORIZON_DAYS, LOCK_DAYS, MIN_LOCK_LEAD_DAYS, MARKDOWN_DUE_DAYS, MIN_APPROVED_BACKLOG, PUBLISH_WEEKDAYS,
  asDate, toYmd, daysBetween, isPublishDay, publishDatesWithin,
  loadAnchors, anchorForWindow, anchorRange, eligibilityOn, loadWindowMonths,
  loadCalendar, loadBacklog, saveCalendar, REVIEW_OWNED_FIELDS,
  occupiedDates, hasMarkdown, approvedCandidates, isEligibleOn,
  queuePause, isPaused, queuePauseProblems, MAX_PAUSE_DAYS,
};
