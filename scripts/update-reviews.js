#!/usr/bin/env node
/**
 * The Way Agency — Google Review Updater
 *
 * Fetches Google review data from sage's authenticated GBP integration via
 * the public read-only endpoint at /api/public/google-reviews. Sage hosts
 * the OAuth refresh token; this script just reads the cached aggregate +
 * recent 5-star reviews and writes them into the static-site data files.
 *
 * Why not Places API: The Way Agency is a service-area business with no
 * storefront, so it does not appear in any Places API discovery method
 * (text search, find-place, autocomplete by name/phone/address all return
 * ZERO_RESULTS). The Business Profile API works, and sage already has it
 * wired up — this script piggybacks on that.
 *
 * Behavior:
 *   - Updates data/locations.json#agency.{google_rating, google_review_count}.
 *   - Hybrid testimonial sync: appends new 5-star reviews from the API to
 *     data/testimonials.json#testimonials[]. Never modifies/reorders/deletes
 *     existing entries. Honors data/testimonials-blocklist.json:
 *       - {blocked: [id, ...]} to skip specific reviews.
 *       - {manual_overrides: {id: {agent, product_lines, products}}}
 *         to map auto-imported reviews to a specific agent / product line.
 *   - HTML-escapes reviewer names and text at ingest. The 3 hand-curated
 *     entries are safe (curator-typed) but auto-imported text is not, and
 *     scripts/builders/pages.js interpolates these directly into HTML.
 *   - Provenance (TRUST-11): asks SAGE for up to 50 reviews (?limit=50) and
 *     stores each new entry's published_at (YYYY-MM-DD or null), date (the
 *     same, or '') and review_key (SAGE's stable, non-identifying key). The
 *     new fields change nothing on the pages: testimonial cards still render
 *     only from entries tagged with a product line (scripts/builders/pages.js).
 *   - --backfill-provenance writes ONLY published_at, date and review_key onto
 *     entries already in testimonials.json, matched strictly (review_key, the
 *     synthetic id, or reviewer name plus the first 60 characters of text). An
 *     entry two reviews could match is left alone. It appends nothing, removes
 *     nothing, and leaves locations.json and google-reviews-status.json as
 *     they are.
 *   - Atomic writes (.tmp + rename) so an interrupted run never leaves a
 *     half-written JSON file.
 *   - Writes data/google-reviews-status.json on every run (success or
 *     failure) for cron-health visibility without polluting site data.
 *
 * Usage:
 *   node scripts/update-reviews.js                    # auto-fetch
 *   node scripts/update-reviews.js --dry-run          # preview, write nothing
 *   node scripts/update-reviews.js --rating 5.0 --count 27   # manual override (no API call)
 *       A manual override never touches google_reviews_last_updated, so it
 *       goes stale (and the badge hides) 30 days after the last real sync.
 *   node scripts/update-reviews.js --backfill-provenance [--dry-run]
 *       fill published_at/date/review_key on existing entries only
 *   node scripts/update-reviews.js --force            # bypass freshness gate
 *   node scripts/update-reviews.js --no-testimonials  # update aggregate only
 *   node scripts/update-reviews.js --verbose          # log full API response
 *
 * Env:
 *   SAGE_REVIEWS_URL   override the default endpoint (defaults to prod sage)
 *
 * Failure semantics:
 *   - API failure: exit 1, locations.json/testimonials.json unchanged,
 *     google-reviews-status.json marks ok:false.
 *   - No change: exit 1 (workflow's existing convention treats exit 1 as
 *     "nothing to commit").
 *   - Successful change: exit 0.
 *   - --backfill-provenance: exit 0 when entries changed, 1 when none did or
 *     the fetch failed (no status file write either way).
 *
 * To debug a failing cron, inspect the most recent commit of
 * data/google-reviews-status.json.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DEFAULT_ENDPOINT = 'https://sage.thewayagency.com/api/public/google-reviews';
const MIN_FETCH_INTERVAL_HOURS = 24;
// SAGE clamps ?limit= to 1-50 (sage-server #984); 50 covers every published 5-star review today.
const FETCH_LIMIT = 50;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const REVIEW_KEY = /^[A-Za-z0-9_-]{8,64}$/;

function parseArgs(argv = process.argv.slice(2)) {
  const args = argv;
  const out = { dryRun: false, force: false, noTestimonials: false, verbose: false, backfillProvenance: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--rating' && args[i + 1]) out.rating = args[++i];
    else if (a === '--count' && args[i + 1]) out.count = args[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--no-testimonials') out.noTestimonials = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--backfill-provenance') out.backfillProvenance = true;
  }
  return out;
}

function htmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlUnescape(str) {
  return String(str)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// SAGE's per-review provenance: published_at as YYYY-MM-DD (or null) and a
// stable review_key. An older SAGE without them gives { null, null }.
function provenanceOf(googleReview) {
  const day = String(googleReview && googleReview.published_at || '').slice(0, 10);
  const parsed = ISO_DAY.test(day) ? new Date(day + 'T00:00:00Z') : null;
  // A real calendar day only (2026-02-30 is not one).
  const published_at = parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  const key = String(googleReview && googleReview.review_key || '');
  const review_key = REVIEW_KEY.test(key) ? key : null;
  return { published_at, review_key };
}

function withLimit(endpoint) {
  const u = new URL(endpoint);
  u.searchParams.set('limit', String(FETCH_LIMIT));
  return u.toString();
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function syntheticId(reviewerName, text) {
  // Stable across runs as long as the reviewer doesn't edit the first 16 chars
  // of their text. Kept as the entry id even now that SAGE sends review_key,
  // so existing ids, the blocklist and manual_overrides keep working. Collisions across two reviewers with the same first 16 chars
  // are vanishingly rare in practice.
  const slug = slugify(reviewerName);
  const textKey = normalize(text).slice(0, 16).replace(/[^a-z0-9]+/g, '');
  return `${slug}--${textKey}`;
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

async function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await fsp.rename(tmp, p);
}

function hoursSince(iso, now = new Date()) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (now.getTime() - t) / 3_600_000;
}

async function fetchReviews(endpoint, verbose, fetchImpl = globalThis.fetch, log = console.log) {
  const res = await fetchImpl(endpoint, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (verbose) log('  API response:', JSON.stringify(data, null, 2));
  if (typeof data.count !== 'number') throw new Error('Invalid response: count missing');
  if (data.rating !== null && typeof data.rating !== 'number') throw new Error('Invalid response: rating wrong type');
  if (!Array.isArray(data.reviews)) throw new Error('Invalid response: reviews not an array');
  return data;
}

// Text as stored (imported text is HTML-escaped at ingest) compared with the
// API's raw text: unescape before normalizing so apostrophes still match.
function textPrefix(s) {
  return normalize(htmlUnescape(s)).slice(0, 60);
}

/**
 * The existing entry this review already is, or null. `strict` drops the
 * last, loose rule (same reviewer name and rating on an entry with no
 * google_review_id), which is fine for not importing a review twice but not
 * for writing a date onto an entry.
 */
function matchExisting(googleReview, existing, { strict = false } = {}) {
  const gAuthor = normalize(htmlUnescape(googleReview.reviewer_name));
  const gPrefix = textPrefix(googleReview.review_text);
  const synthId = syntheticId(googleReview.reviewer_name, googleReview.review_text);
  const { review_key } = provenanceOf(googleReview);
  if (review_key) {
    const byKey = existing.find((t) => t.review_key === review_key);
    if (byKey) return byKey;
  }
  for (const t of existing) {
    if (t.google_review_id && t.google_review_id === synthId) return t;
    const tAuthor = normalize(htmlUnescape(t.name));
    if (tAuthor === gAuthor && gPrefix && textPrefix(t.text) === gPrefix) return t;
    if (!strict && !t.google_review_id && tAuthor === gAuthor && Number(t.rating) === Number(googleReview.star_rating)) return t;
  }
  return null;
}

/**
 * Fill published_at, date and review_key on existing entries from the API's
 * reviews. Changes nothing else: no entry is added, removed, reordered, or
 * has any other field touched. An entry matched by two reviews, or a key
 * already held by another entry, is skipped and reported.
 * Mutates `entries`; returns { changed: [{ id, fields }], unmatched, ambiguous: [id] }.
 */
function backfillProvenance(apiReviews, entries) {
  const matches = new Map(); // entry -> [{ review, prov }]
  let unmatched = 0;
  for (const r of apiReviews) {
    const prov = provenanceOf(r);
    if (!prov.published_at && !prov.review_key) continue;
    const t = matchExisting(r, entries, { strict: true });
    if (!t) { unmatched++; continue; }
    if (!matches.has(t)) matches.set(t, []);
    matches.get(t).push(prov);
  }
  const changed = [];
  const ambiguous = [];
  for (const [t, provs] of matches) {
    if (provs.length > 1) { ambiguous.push(t.id); continue; }
    const { published_at, review_key } = provs[0];
    if (review_key && entries.some((o) => o !== t && o.review_key === review_key)) { ambiguous.push(t.id); continue; }
    const fields = {};
    if (published_at && t.published_at !== published_at) fields.published_at = [t.published_at === undefined ? null : t.published_at, published_at];
    if (published_at && t.date !== published_at) fields.date = [t.date === undefined ? null : t.date, published_at];
    if (review_key && t.review_key !== review_key) fields.review_key = [t.review_key === undefined ? null : t.review_key, review_key];
    if (!Object.keys(fields).length) continue;
    for (const [k, [, v]] of Object.entries(fields)) t[k] = v;
    changed.push({ id: t.id, fields });
  }
  return { changed, unmatched, ambiguous };
}

function buildTestimonialEntry(googleReview, blocklist) {
  const id = syntheticId(googleReview.reviewer_name, googleReview.review_text);
  const overrides = (blocklist && blocklist.manual_overrides && blocklist.manual_overrides[id]) || {};
  const { published_at, review_key } = provenanceOf(googleReview);
  return {
    id,
    name: htmlEscape(googleReview.reviewer_name),
    rating: 5,
    text: htmlEscape(googleReview.review_text),
    source: 'google',
    source_url: '',
    date: published_at || '',
    published_at,
    review_key,
    agent: overrides.agent || '',
    product_lines: overrides.product_lines || [],
    products: overrides.products || [],
    google_review_id: id,
  };
}

function paths(dataDir) {
  return {
    locations: path.join(dataDir, 'locations.json'),
    testimonials: path.join(dataDir, 'testimonials.json'),
    blocklist: path.join(dataDir, 'testimonials-blocklist.json'),
    status: path.join(dataDir, 'google-reviews-status.json'),
  };
}

/**
 * Run the updater. Returns the exit code instead of exiting, so tests can run
 * it against a temporary data directory with a stubbed fetch.
 */
async function run(argv = process.argv.slice(2), {
  dataDir = path.join(ROOT, 'data'),
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  log = console.log,
  endpoint = process.env.SAGE_REVIEWS_URL || DEFAULT_ENDPOINT,
} = {}) {
  const opts = parseArgs(argv);
  const P = paths(dataDir);
  const url = withLimit(endpoint);
  const writeStatus = (ok, extras = {}) => writeJsonAtomic(P.status, { ok, fetchedAt: now().toISOString(), ...extras });

  if (opts.rating && opts.count) {
    // Manual override: the rating and count only. google_reviews_last_updated
    // is the time of the last successful SAGE fetch and stays as it is, so a
    // hand-set rating goes stale 30 days after that and the badge hides (TRUST-14).
    const locations = loadJson(P.locations);
    const prevR = locations.agency.google_rating;
    const prevC = locations.agency.google_review_count;
    locations.agency.google_rating = String(opts.rating);
    locations.agency.google_review_count = String(opts.count);
    if (prevR !== String(opts.rating) || prevC !== String(opts.count)) {
      if (!opts.dryRun) await writeJsonAtomic(P.locations, locations);
      log(`  Manual override: ${prevR}/${prevC} → ${opts.rating}/${opts.count}${opts.dryRun ? ' (dry run)' : ''}`);
      return 0;
    }
    log('  Manual override: no change.');
    return 1;
  }

  if (opts.backfillProvenance) {
    log(`  Fetching (backfill): ${url}`);
    let api;
    try {
      api = await fetchReviews(url, opts.verbose, fetchImpl, log);
    } catch (err) {
      log(`  ! Fetch failed: ${err.message}`);
      return 1;
    }
    const testimonials = loadJson(P.testimonials);
    const result = backfillProvenance(api.reviews, testimonials.testimonials);
    for (const c of result.changed) {
      log(`  Backfill ${c.id}: ${Object.entries(c.fields).map(([k, [a, b]]) => `${k} ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join(', ')}`);
    }
    for (const id of result.ambiguous) log(`  Skipped (ambiguous match): ${id}`);
    log(`  Backfill: ${result.changed.length} entries changed, ${result.unmatched} reviews not in testimonials.json, ${result.ambiguous.length} ambiguous.`);
    if (!result.changed.length) return 1;
    if (opts.dryRun) { log('  Dry run — no files written.'); return 0; }
    await writeJsonAtomic(P.testimonials, testimonials);
    return 0;
  }

  const locations = loadJson(P.locations);
  const lastAttempt = locations.agency.google_reviews_last_updated;
  if (!opts.force && hoursSince(lastAttempt, now()) < MIN_FETCH_INTERVAL_HOURS) {
    log(`  Skipped: last update was ${hoursSince(lastAttempt, now()).toFixed(1)}h ago (min ${MIN_FETCH_INTERVAL_HOURS}h). Use --force to override.`);
    return 1;
  }

  log(`  Fetching: ${url}`);
  let api;
  try {
    api = await fetchReviews(url, opts.verbose, fetchImpl, log);
  } catch (err) {
    log(`  ! Fetch failed: ${err.message}`);
    if (!opts.dryRun) await writeStatus(false, { error: err.message, endpoint: url });
    return 1;
  }

  log(`  Got rating=${api.rating} count=${api.count} reviews=${api.reviews.length}`);

  const newRating = api.rating === null ? null : api.rating.toFixed(1);
  const newCount = String(api.count);
  const prevR = locations.agency.google_rating;
  const prevC = locations.agency.google_review_count;
  const aggregateChanged = (prevR !== newRating && newRating !== null) || prevC !== newCount;

  if (newRating !== null) locations.agency.google_rating = newRating;
  locations.agency.google_review_count = newCount;
  locations.agency.google_reviews_last_updated = now().toISOString();

  let testimonialsChanged = false;
  const testimonials = loadJson(P.testimonials);
  const blocklist = loadJson(P.blocklist, { blocked: [], manual_overrides: {} });
  const blockedIds = new Set(blocklist.blocked || []);

  if (!opts.noTestimonials) {
    const added = [];
    for (const r of api.reviews) {
      if (Number(r.star_rating) !== 5) continue;
      if (!r.review_text || !r.review_text.trim()) continue;
      const id = syntheticId(r.reviewer_name, r.review_text);
      if (blockedIds.has(id)) { log(`  Skipped (blocklist): ${r.reviewer_name}`); continue; }
      if (matchExisting(r, testimonials.testimonials)) { log(`  Skipped (already present): ${r.reviewer_name}`); continue; }
      const entry = buildTestimonialEntry(r, blocklist);
      testimonials.testimonials.push(entry);
      added.push(entry);
      log(`  Added: ${r.reviewer_name} (id=${id})`);
    }
    testimonialsChanged = added.length > 0;
  }

  if (opts.dryRun) {
    log('  Dry run — no files written.');
    if (aggregateChanged) log(`  Would update aggregate: ${prevR}/${prevC} → ${newRating}/${newCount}`);
    if (testimonialsChanged) log('  Would append testimonials.');
    return 0;
  }

  await writeJsonAtomic(P.locations, locations);
  if (testimonialsChanged) await writeJsonAtomic(P.testimonials, testimonials);
  await writeStatus(true, { rating: newRating, count: newCount, testimonialsAdded: testimonialsChanged });

  if (aggregateChanged || testimonialsChanged) {
    if (aggregateChanged) log(`  Updated aggregate: ${prevR}/${prevC} → ${newRating}/${newCount}`);
    return 0;
  }
  log('  No change.');
  return 1;
}

module.exports = {
  run, parseArgs, provenanceOf, withLimit, syntheticId, matchExisting, backfillProvenance, buildTestimonialEntry,
  htmlEscape, htmlUnescape, FETCH_LIMIT,
};

if (require.main === module) {
  run().then((code) => process.exit(code), (err) => {
    console.error(`  ! Unexpected error: ${err.stack || err.message}`);
    const P = paths(path.join(ROOT, 'data'));
    writeJsonAtomic(P.status, { ok: false, fetchedAt: new Date().toISOString(), error: err.message }).finally(() => process.exit(1));
  });
}
