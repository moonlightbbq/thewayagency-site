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
// The backlog schema this code understands. Bump it in the same commit that
// changes the file's shape - loadBacklog() refuses anything else.
const BACKLOG_SCHEMA_VERSION = 2;
const BLOG_SRC = path.join(ROOT, 'src', 'blog');
const ANCHORS_PATH = path.join(ROOT, 'data', 'seasonal-anchors.json');

// Reserve capacity 4 weeks out; commit a topic to it 2 weeks out.
const HORIZON_DAYS = 28;
const LOCK_DAYS = 14;
// The floor for committing a topic. send-review-emails.js only picks a post up
// at `days >= 10 && days <= 18`, so locking anything nearer than 10 days
// publishes it without a reviewer ever seeing it. Filling a slot is not worth
// silently skipping review, so slots closer than this are reported as
// unfillable rather than quietly filled.
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

function loadCalendar() {
  return JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));
}

function loadBacklog() {
  if (!fs.existsSync(BACKLOG_PATH)) return { candidates: [] };
  const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
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
      `content-backlog.json is schema v${backlog.version}, expected v${BACKLOG_SCHEMA_VERSION}. `
      + 'This checkout is stale - pull main before running the queue.',
    );
  }
  return backlog;
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

const STOPWORDS = new Set(['insurance', 'kentucky', 'the', 'and', 'for', 'your', 'what', 'guide', 'need', 'you']);

function tokenize(text) {
  return new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
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
    if (taken.has(date) || byDate.has(date)) continue;
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
  const markdownFor = opts.hasMarkdown || hasMarkdown;
  const reserved = (cal.slots || []).filter(s => s.state === 'reserved');

  // Slots split into two kinds. Anything nearer than MIN_LOCK_LEAD_DAYS is
  // past the D-10 review email, so filling it publishes without a reviewer.
  // Default is to leave it empty and say so. `allowReviewSkip` is the
  // deliberate override for "no date goes silent": it fills the date anyway,
  // records that review was skipped on the entry, and only ever uses a
  // candidate whose draft is ALREADY written - there is no time to write one.
  const targets = [];
  for (const slot of reserved) {
    const d = daysBetween(today, slot.date);
    if (d < 0 || d > LOCK_DAYS) continue;
    if (d >= MIN_LOCK_LEAD_DAYS) { targets.push({ slot, reviewSkip: false, daysOut: d }); continue; }
    if (opts.allowReviewSkip) targets.push({ slot, reviewSkip: true, daysOut: d });
    else skipped.push({ date: slot.date, reason: `only ${d}d out; locking now would skip the D-${MIN_LOCK_LEAD_DAYS} review window` });
  }
  // Nearest first: the most urgent date gets first pick of the backlog.
  targets.sort((a, b) => (a.slot.date < b.slot.date ? -1 : 1));

  for (const { slot, reviewSkip, daysOut } of targets) {
    // Rebuilt each iteration so a lock made a moment ago counts against the
    // next one -- otherwise two near-identical candidates both get placed.
    const ctx = buildSchedulingContext(cal, opts);
    let ranked = (backlog.candidates || [])
      .map(c => ({ candidate: c, ...scoreCandidate(c, slot.date, ctx, windowMonths, opts) }))
      .filter(r => r.eligible);
    if (reviewSkip) ranked = ranked.filter(r => markdownFor(r.candidate.slug));
    ranked.sort((a, b) => b.score - a.score);

    if (!ranked.length) {
      skipped.push({
        date: slot.date,
        reason: reviewSkip
          ? `${daysOut}d out and no ready draft available to fill it in time`
          : 'no eligible approved candidate',
      });
      continue;
    }
    const winner = ranked[0];
    const post = candidateToPost(winner.candidate, slot.date, today);
    if (reviewSkip) {
      post.review_skipped = true;
      post.notes = `${post.notes ? `${post.notes} ` : ''}Locked ${daysOut}d before publish so the date would not go silent. `
        + `That is inside send-review-emails' D-${MIN_LOCK_LEAD_DAYS} window, so no reviewer email goes out for this post. `
        + 'Draft was already written and on disk.';
    }
    cal.year1.push(post);
    slot.state = 'locked';
    slot.locked_slug = winner.candidate.slug;
    slot.locked_at = today;
    slot.review_skipped = reviewSkip || undefined;
    backlog.candidates = (backlog.candidates || []).filter(c => c.slug !== winner.candidate.slug);
    locked.push({
      date: slot.date, slug: winner.candidate.slug, score: winner.score,
      reasons: winner.reasons, reviewSkipped: reviewSkip,
    });
  }
  return { locked, skipped };
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
  // Only slots that can still be filled without skipping review. A slot
  // nearer than MIN_LOCK_LEAD_DAYS is past saving; that is an I1/I4 concern,
  // not a scheduling failure, and demanding a lock there would push the
  // scheduler into the exact review-skipping behaviour this floor prevents.
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
    add('I2b', `${tooLate.length} slot(s) will publish nothing - too close to fill without skipping review: ${tooLate.map(s => s.date).join(', ')}`);
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
      // Deliberate policy, not a violation - but it must never be invisible.
      reviewSkipped: upcoming.filter(p => p.review_skipped),
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
  loadCalendar, loadBacklog, saveCalendar,
  occupiedDates, hasMarkdown, approvedCandidates, isEligibleOn,
};
