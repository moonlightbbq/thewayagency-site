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
 *   - HTML-escapes reviewer names and text at ingest. The 19 hand-curated
 *     entries are safe (curator-typed) but auto-imported text is not, and
 *     scripts/builders/pages.js interpolates these directly into HTML.
 *   - Atomic writes (.tmp + rename) so an interrupted run never leaves a
 *     half-written JSON file.
 *   - Writes data/google-reviews-status.json on every run (success or
 *     failure) for cron-health visibility without polluting site data.
 *
 * Usage:
 *   node scripts/update-reviews.js                    # auto-fetch
 *   node scripts/update-reviews.js --dry-run          # preview, write nothing
 *   node scripts/update-reviews.js --rating 5.0 --count 27   # manual override (no API call)
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
 *
 * To debug a failing cron, inspect the most recent commit of
 * data/google-reviews-status.json.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCATIONS_PATH = path.join(ROOT, 'data', 'locations.json');
const TESTIMONIALS_PATH = path.join(ROOT, 'data', 'testimonials.json');
const BLOCKLIST_PATH = path.join(ROOT, 'data', 'testimonials-blocklist.json');
const STATUS_PATH = path.join(ROOT, 'data', 'google-reviews-status.json');

const DEFAULT_ENDPOINT = 'https://sage.thewayagency.com/api/public/google-reviews';
const MIN_FETCH_INTERVAL_HOURS = 24;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, force: false, noTestimonials: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--rating' && args[i + 1]) out.rating = args[++i];
    else if (a === '--count' && args[i + 1]) out.count = args[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--no-testimonials') out.noTestimonials = true;
    else if (a === '--verbose') out.verbose = true;
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

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function syntheticId(reviewerName, text) {
  // Stable across runs as long as the reviewer doesn't edit the first 16 chars
  // of their text. No published_at exposed by the public endpoint, so we don't
  // include time. Collisions across two reviewers with the same first 16 chars
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

// Propagate the Google review count from locations.json to hardcoded references in
// hand-crafted source files. The handcrafted pages (src/pages/**.html, src/intake.html,
// src/portal.html, src/partner.html, src/js/app.js) carry the count
// inline as visible text "(N reviews)" and inline JSON-LD "reviewCount": "N". Generated
// pages already pull from locations.json via the build context, but these handcrafted
// files do not, and the count was drifting against the live Google rating.
async function propagateReviewCountToSource(prevCount, newCount) {
  if (!prevCount || !newCount || prevCount === newCount) return { updated: 0, files: [] };
  const SRC = path.join(ROOT, 'src');
  const targets = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'assets' || ent.name === 'css' || ent.name === 'blog') continue;
        walk(full);
      } else if (/\.(html|js)$/.test(ent.name)) {
        targets.push(full);
      }
    }
  }
  walk(SRC);
  const visibleNeedle = `(${prevCount} reviews)`;
  const visibleReplace = `(${newCount} reviews)`;
  const schemaNeedle = `"reviewCount": "${prevCount}"`;
  const schemaReplace = `"reviewCount": "${newCount}"`;
  const updated = [];
  for (const file of targets) {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes(visibleNeedle) && !content.includes(schemaNeedle)) continue;
    const next = content.split(visibleNeedle).join(visibleReplace).split(schemaNeedle).join(schemaReplace);
    fs.writeFileSync(file, next);
    updated.push(path.relative(ROOT, file));
  }
  return { updated: updated.length, files: updated };
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

async function fetchReviews(endpoint, verbose) {
  const res = await fetch(endpoint, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (verbose) console.log('  API response:', JSON.stringify(data, null, 2));
  if (typeof data.count !== 'number') throw new Error('Invalid response: count missing');
  if (data.rating !== null && typeof data.rating !== 'number') throw new Error('Invalid response: rating wrong type');
  if (!Array.isArray(data.reviews)) throw new Error('Invalid response: reviews not an array');
  return data;
}

function matchExisting(googleReview, existing) {
  const gAuthor = normalize(googleReview.reviewer_name);
  const gPrefix = normalize(googleReview.review_text).slice(0, 60);
  const synthId = syntheticId(googleReview.reviewer_name, googleReview.review_text);
  for (const t of existing) {
    if (t.google_review_id && t.google_review_id === synthId) return t;
    const tAuthor = normalize(t.name);
    const tPrefix = normalize(t.text).slice(0, 60);
    if (tAuthor === gAuthor && tPrefix === gPrefix) return t;
    if (!t.google_review_id && tAuthor === gAuthor && Number(t.rating) === Number(googleReview.star_rating)) return t;
  }
  return null;
}

function buildTestimonialEntry(googleReview, blocklist) {
  const id = syntheticId(googleReview.reviewer_name, googleReview.review_text);
  const overrides = blocklist.manual_overrides?.[id] || {};
  return {
    id,
    name: htmlEscape(googleReview.reviewer_name),
    rating: 5,
    text: htmlEscape(googleReview.review_text),
    source: 'google',
    source_url: '',
    date: '',
    agent: overrides.agent || '',
    product_lines: overrides.product_lines || [],
    products: overrides.products || [],
    google_review_id: id,
  };
}

async function writeStatus(ok, extras = {}) {
  await writeJsonAtomic(STATUS_PATH, {
    ok,
    fetchedAt: new Date().toISOString(),
    ...extras,
  });
}

async function main() {
  const opts = parseArgs();
  const endpoint = process.env.SAGE_REVIEWS_URL || DEFAULT_ENDPOINT;

  if (opts.rating && opts.count) {
    const locations = loadJson(LOCATIONS_PATH);
    const prevR = locations.agency.google_rating;
    const prevC = locations.agency.google_review_count;
    locations.agency.google_rating = String(opts.rating);
    locations.agency.google_review_count = String(opts.count);
    if (prevR !== String(opts.rating) || prevC !== String(opts.count)) {
      if (!opts.dryRun) {
        await writeJsonAtomic(LOCATIONS_PATH, locations);
        const prop = await propagateReviewCountToSource(prevC, String(opts.count));
        if (prop.updated > 0) console.log(`  Propagated count to ${prop.updated} source files.`);
      }
      console.log(`  Manual override: ${prevR}/${prevC} → ${opts.rating}/${opts.count}${opts.dryRun ? ' (dry run)' : ''}`);
      process.exit(0);
    }
    console.log('  Manual override: no change.');
    process.exit(1);
  }

  const locations = loadJson(LOCATIONS_PATH);
  const lastAttempt = locations.agency.google_reviews_last_updated;
  if (!opts.force && hoursSince(lastAttempt) < MIN_FETCH_INTERVAL_HOURS) {
    console.log(`  Skipped: last update was ${hoursSince(lastAttempt).toFixed(1)}h ago (min ${MIN_FETCH_INTERVAL_HOURS}h). Use --force to override.`);
    process.exit(1);
  }

  console.log(`  Fetching: ${endpoint}`);
  let api;
  try {
    api = await fetchReviews(endpoint, opts.verbose);
  } catch (err) {
    console.log(`  ! Fetch failed: ${err.message}`);
    if (!opts.dryRun) await writeStatus(false, { error: err.message, endpoint });
    process.exit(1);
  }

  console.log(`  Got rating=${api.rating} count=${api.count} reviews=${api.reviews.length}`);

  const newRating = api.rating === null ? null : api.rating.toFixed(1);
  const newCount = String(api.count);
  const prevR = locations.agency.google_rating;
  const prevC = locations.agency.google_review_count;
  let aggregateChanged = (prevR !== newRating && newRating !== null) || prevC !== newCount;

  if (newRating !== null) locations.agency.google_rating = newRating;
  locations.agency.google_review_count = newCount;
  locations.agency.google_reviews_last_updated = new Date().toISOString();

  let testimonialsChanged = false;
  const testimonials = loadJson(TESTIMONIALS_PATH);
  const blocklist = loadJson(BLOCKLIST_PATH, { blocked: [], manual_overrides: {} });
  const blockedIds = new Set(blocklist.blocked || []);

  if (!opts.noTestimonials) {
    const added = [];
    for (const r of api.reviews) {
      if (Number(r.star_rating) !== 5) continue;
      if (!r.review_text || !r.review_text.trim()) continue;
      const id = syntheticId(r.reviewer_name, r.review_text);
      if (blockedIds.has(id)) { console.log(`  Skipped (blocklist): ${r.reviewer_name}`); continue; }
      if (matchExisting(r, testimonials.testimonials)) { console.log(`  Skipped (already present): ${r.reviewer_name}`); continue; }
      const entry = buildTestimonialEntry(r, blocklist);
      testimonials.testimonials.push(entry);
      added.push(entry);
      console.log(`  Added: ${r.reviewer_name} (id=${id})`);
    }
    testimonialsChanged = added.length > 0;
  }

  if (opts.dryRun) {
    console.log('  Dry run — no files written.');
    if (aggregateChanged) console.log(`  Would update aggregate: ${prevR}/${prevC} → ${newRating}/${newCount}`);
    if (testimonialsChanged) console.log(`  Would append testimonials.`);
    process.exit(0);
  }

  await writeJsonAtomic(LOCATIONS_PATH, locations);
  if (testimonialsChanged) await writeJsonAtomic(TESTIMONIALS_PATH, testimonials);
  await writeStatus(true, { rating: newRating, count: newCount, testimonialsAdded: testimonialsChanged });

  if (aggregateChanged) {
    const prop = await propagateReviewCountToSource(prevC, newCount);
    if (prop.updated > 0) console.log(`  Propagated count to ${prop.updated} source files: ${prop.files.join(', ')}`);
  }

  if (aggregateChanged || testimonialsChanged) {
    if (aggregateChanged) console.log(`  Updated aggregate: ${prevR}/${prevC} → ${newRating}/${newCount}`);
    process.exit(0);
  }
  console.log('  No change.');
  process.exit(1);
}

main().catch(err => {
  console.error(`  ! Unexpected error: ${err.stack || err.message}`);
  writeStatus(false, { error: err.message }).finally(() => process.exit(1));
});
