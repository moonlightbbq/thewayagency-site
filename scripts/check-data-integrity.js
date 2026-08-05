#!/usr/bin/env node
/**
 * Data Integrity Checker
 * Validates JSON data files for schema correctness, cross-references, and sanity.
 * Generates checksums for change detection.
 *
 * Usage: node scripts/check-data-integrity.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const DATA = path.join(ROOT, 'data');

let errors = 0;
let warnings = 0;

function error(msg) { console.log(`  ✗ ${msg}`); errors++; }
function warn(msg) { console.log(`  ! ${msg}`); warnings++; }
function pass(msg) { console.log(`  ✓ ${msg}`); }

function loadJson(filename) {
  const fp = path.join(DATA, filename);
  if (!fs.existsSync(fp)) { error(`Missing file: data/${filename}`); return null; }
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return data;
  } catch (e) {
    error(`Invalid JSON in data/${filename}: ${e.message}`);
    return null;
  }
}

console.log('\nChecking data integrity...\n');

// ─── Schema Validation ──────────────────────────

// products.json
const products = loadJson('products.json');
if (products) {
  let productErrors = 0;
  const allIds = new Set();
  for (const [line, prods] of Object.entries(products)) {
    if (!Array.isArray(prods)) { error(`products.json: ${line} is not an array`); productErrors++; continue; }
    for (const p of prods) {
      if (!p.id) { error(`products.json: missing id in ${line}`); productErrors++; }
      if (!p.name) { error(`products.json: missing name for ${p.id || 'unknown'}`); productErrors++; }
      if (!p.slug) { error(`products.json: missing slug for ${p.id || 'unknown'}`); productErrors++; }
      if (p.id && allIds.has(p.id)) { error(`products.json: duplicate id "${p.id}"`); productErrors++; }
      if (p.id) allIds.add(p.id);

      // ── SEO guardrails ──
      // The seo-optimizer bot rewrites these fields autonomously. Its last batch
      // (site PR #5, closed) tried to replace question-form h1s with marketing
      // slogans and to blow past the SERP limits. These are the invariants it is
      // not allowed to break, enforced in CI so a bot PR cannot land a regression.

      // Every product h1 is a QUESTION. All 31 follow this; it is a deliberate
      // answer-engine pattern (the question IS the query being answered), and a
      // half-converted set is worse than either convention applied consistently.
      if (p.h1 && !p.h1.trim().endsWith('?')) {
        error(`products.json: ${p.slug} h1 must be question-form (answer-engine convention): "${p.h1}"`);
        productErrors++;
      }
      // SERP truncation limits.
      if (p.meta_description && p.meta_description.length > 160) {
        error(`products.json: ${p.slug} meta_description is ${p.meta_description.length} chars (max 160 — truncates in search results)`);
        productErrors++;
      }
      if (p.title_tag && p.title_tag.length > 60) {
        error(`products.json: ${p.slug} title_tag is ${p.title_tag.length} chars (max 60 — truncates in search results)`);
        productErrors++;
      }
      // Thin titles are the real unmet need the seo-optimizer should be fixing
      // ("Home Insurance | The Way Agency" is 31 chars and ranks for nothing).
      // A warning, not an error: 19 of 31 are thin today, and failing the build
      // on the current state would just get the check disabled.
      if (p.title_tag && p.title_tag.length < 40) {
        warn(`products.json: ${p.slug} title_tag is thin (${p.title_tag.length} chars) — "${p.title_tag}"`);
      }
    }
  }
  if (productErrors === 0) pass(`products.json: ${allIds.size} products, all valid`);
}

// team.json
const team = loadJson('team.json');
if (team) {
  let teamErrors = 0;
  for (const m of (team.team || [])) {
    if (!m.name) { error(`team.json: member missing name`); teamErrors++; }
    if (!m.slug) { error(`team.json: ${m.name || 'unknown'} missing slug`); teamErrors++; }
    if (!m.title) { error(`team.json: ${m.name || 'unknown'} missing title`); teamErrors++; }
  }
  if (teamErrors === 0) pass(`team.json: ${(team.team || []).length} members, all valid`);
}

// carriers.json
const carriers = loadJson('carriers.json');
if (carriers) {
  let carrierErrors = 0;
  let total = 0;
  for (const [line, carrs] of Object.entries(carriers)) {
    if (!Array.isArray(carrs)) continue;
    for (const c of carrs) {
      total++;
      if (!c.name) { error(`carriers.json: missing name in ${line}`); carrierErrors++; }
      if (!c.slug) { error(`carriers.json: ${c.name || 'unknown'} missing slug`); carrierErrors++; }
    }
  }
  if (carrierErrors === 0) pass(`carriers.json: ${total} carriers, all valid`);
}

// locations.json
const locations = loadJson('locations.json');
if (locations) {
  if (!locations.agency) error('locations.json: missing agency object');
  if (!locations.offices || locations.offices.length === 0) error('locations.json: missing offices array');
  else pass('locations.json: valid');
}

// testimonials.json
const testimonials = loadJson('testimonials.json');
if (testimonials) {
  let testErrors = 0;
  for (const t of (testimonials.testimonials || [])) {
    if (!t.name) { error(`testimonials.json: missing name`); testErrors++; }
    if (!t.text) { error(`testimonials.json: ${t.name || 'unknown'} missing text`); testErrors++; }
    if (t.rating && (t.rating < 1 || t.rating > 5)) { error(`testimonials.json: ${t.name} rating out of range (${t.rating})`); testErrors++; }
  }
  if (testErrors === 0) pass(`testimonials.json: ${(testimonials.testimonials || []).length} entries, all valid`);
}

// knowledge-base.json
const kb = loadJson('knowledge-base.json');
if (kb) {
  let kbErrors = 0;
  for (const e of (kb.entries || [])) {
    if (!e.question) { error(`knowledge-base.json: entry missing question`); kbErrors++; }
    if (!e.answer) { error(`knowledge-base.json: entry missing answer`); kbErrors++; }
    if (!e.category) { warn(`knowledge-base.json: "${(e.question || '').substring(0, 40)}..." missing category`); }
  }
  if (kbErrors === 0) pass(`knowledge-base.json: ${(kb.entries || []).length} entries, all valid`);
}

// content-calendar.json
const calendar = loadJson('content-calendar.json');
if (calendar) {
  let calErrors = 0;
  const allCalPosts = [...(calendar.existing_posts || []), ...(calendar.year1 || [])];
  for (const p of allCalPosts) {
    if (!p.title) { error(`content-calendar.json: post missing title`); calErrors++; }
    if (!p.slug) { error(`content-calendar.json: "${(p.title || '').substring(0, 30)}..." missing slug`); calErrors++; }
    if (!p.publish_date) { error(`content-calendar.json: "${p.slug || 'unknown'}" missing publish_date`); calErrors++; }
    if (!p.status) { warn(`content-calendar.json: "${p.slug || 'unknown'}" missing status`); }
  }
  if (calErrors === 0) pass(`content-calendar.json: ${allCalPosts.length} entries, all valid`);

  // Seasonality: a post tagged with a seasonality_window must publish inside
  // that window. Added 2026-08-04 after the 2026-05-02 re-pace (commit
  // f1f4ba4) silently re-dated the whole calendar by list position, pushing
  // every future post 91-161 days early — a winter-driving guide was
  // scheduled for August and only caught by a reviewer replying to ask why.
  //
  // content-taxonomy.json holds the canonical windows as human strings
  // ("October-November", "September (before Oct 15 open enrollment)").
  // Tolerance is +/-1 month on each side: wide enough that a deliberate
  // shoulder-month placement doesn't fail the build, tight enough to catch
  // the multi-month drift this check exists for.
  const taxonomy = loadJson('content-taxonomy.json');
  const windowDefs = taxonomy?.lifecycle?.seasonal?.seasonality_windows;
  // Anchors are optional: absent file => month bands only, exactly as before.
  let queueLib = null;
  let seasonalAnchors = { anchors: {} };
  try {
    queueLib = require('./lib/content-queue');
    seasonalAnchors = queueLib.loadAnchors();
  } catch { /* month bands only */ }
  const windowMonthsFor = (defs) => {
    const out = {};
    for (const [name, desc] of Object.entries(defs || {})) {
      const found = String(desc).split('(')[0].match(/[A-Za-z]+/g) || [];
      const idx = found.map(w => MONTH_NAMES.indexOf(w.toLowerCase())).filter(i => i >= 0);
      if (!idx.length) continue;
      const months = [];
      for (let m = idx[0]; ; m = (m + 1) % 12) { months.push(m); if (m === idx[idx.length - 1]) break; }
      out[name] = months;
    }
    return out;
  };
  if (windowDefs) {
    const MONTHS = MONTH_NAMES; const _unusedMonths = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    // "February-March (publish before storm season)" -> [1, 2]
    function parseWindow(desc) {
      const lead = String(desc).split('(')[0];
      const found = lead.match(/[A-Za-z]+/g) || [];
      const idx = found.map(w => MONTHS.indexOf(w.toLowerCase())).filter(i => i >= 0);
      if (!idx.length) return null;
      const lo = idx[0];
      const hi = idx[idx.length - 1];
      // Walk lo->hi forward, wrapping across the year end (e.g. Nov-Feb).
      const months = [];
      for (let m = lo; ; m = (m + 1) % 12) { months.push(m); if (m === hi) break; }
      return months;
    }

    let seasonErrors = 0;
    let seasonChecked = 0;
    for (const p of allCalPosts) {
      if (!p.seasonality_window || !p.publish_date) continue;
      const months = parseWindow(windowDefs[p.seasonality_window]);
      if (!months) {
        warn(`content-calendar.json: "${p.slug}" has unknown seasonality_window "${p.seasonality_window}"`);
        continue;
      }
      seasonChecked++;
      // Prefer a real-world anchor over the month band when one governs this
      // window. A month band is an approximation -- "July-August" permits
      // publishing back-to-school content three weeks after school starts.
      const anchored = queueLib && queueLib.eligibilityOn(
        p, p.publish_date, windowMonthsFor(windowDefs), { anchors: seasonalAnchors });
      if (anchored && anchored.basis === 'anchor') {
        if (anchored.eligible) continue;
        const msg2 = `content-calendar.json: "${p.slug}" is ${p.seasonality_window} but publishes `
          + `${p.publish_date}, outside its anchored window (${anchored.detail})`;
        if (p.status === 'published') { warn(`${msg2} [already published]`); continue; }
        error(msg2); seasonErrors++; continue;
      }
      if (anchored && anchored.basis === 'anchor-missing' && p.status !== 'published') {
        warn(`content-calendar.json: "${p.slug}" - ${anchored.detail}`);
      }
      // Widen by one month on each end.
      const allowed = new Set();
      for (const m of months) { allowed.add(m); allowed.add((m + 11) % 12); allowed.add((m + 1) % 12); }
      const actual = new Date(`${p.publish_date}T12:00:00Z`).getUTCMonth();
      if (allowed.has(actual)) continue;

      const msg = `content-calendar.json: "${p.slug}" is ${p.seasonality_window} `
        + `(${windowDefs[p.seasonality_window]}) but publishes ${p.publish_date} `
        + `(${MONTHS[actual].replace(/^./, c => c.toUpperCase())})`;
      // Already-published posts are history — surface them, but don't fail a
      // build over a date that can no longer be changed.
      if (p.status === 'published') { warn(`${msg} [already published]`); }
      else { error(msg); seasonErrors++; }
    }
    if (seasonErrors === 0) pass(`content-calendar.json: ${seasonChecked} seasonal posts in-window`);
  }

  // ── Rolling queue: slots + backlog ──────────────────────────────────────
  // The slot ledger is the rolling Wed/Sat window; the backlog holds undated
  // candidates. Both are new in the 2026-08 queue redesign, so validate their
  // shape here rather than discovering a malformed entry when the scheduler
  // reads it.
  const VALID_SLOT_STATES = ['reserved', 'locked'];
  const VALID_BACKLOG_STATUS = ['proposed', 'approved', 'on-hold', 'rejected'];
  const PUBLISH_WEEKDAYS = [3, 6]; // Wed + Sat, matching publish-blog.yml

  let queueErrors = 0;
  const slots = Array.isArray(calendar.slots) ? calendar.slots : [];
  const seenSlotDates = new Set();
  for (const s of slots) {
    const label = s.date || '(no date)';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) {
      error(`content-calendar.json: slot ${label} has an invalid date`); queueErrors++; continue;
    }
    if (seenSlotDates.has(s.date)) { error(`content-calendar.json: duplicate slot for ${s.date}`); queueErrors++; }
    seenSlotDates.add(s.date);
    if (!PUBLISH_WEEKDAYS.includes(new Date(`${s.date}T12:00:00Z`).getUTCDay())) {
      error(`content-calendar.json: slot ${s.date} is not a Wednesday or Saturday`); queueErrors++;
    }
    if (!VALID_SLOT_STATES.includes(s.state)) {
      error(`content-calendar.json: slot ${s.date} has invalid state "${s.state}"`); queueErrors++;
    }
    if (s.state === 'locked' && !s.locked_slug) {
      error(`content-calendar.json: slot ${s.date} is locked but names no slug`); queueErrors++;
    }
    // A slot and a dated post must never both own the same day.
    if (s.state !== 'locked' && allCalPosts.some(p => p.publish_date === s.date && p.status !== 'published')) {
      error(`content-calendar.json: slot ${s.date} is reserved but a post already occupies that date`); queueErrors++;
    }
  }

  const backlog = loadJson('content-backlog.json');
  const candidates = (backlog && Array.isArray(backlog.candidates)) ? backlog.candidates : [];
  const seenCandidateSlugs = new Set();
  for (const c of candidates) {
    const label = c.slug || c.title || 'unknown';
    if (!c.slug) { error(`content-backlog.json: candidate "${label}" missing slug`); queueErrors++; }
    if (!c.title) { error(`content-backlog.json: "${label}" missing title`); queueErrors++; }
    if (!c.primary_keyword) { warn(`content-backlog.json: "${label}" missing primary_keyword`); }
    if (!VALID_BACKLOG_STATUS.includes(c.status)) {
      error(`content-backlog.json: "${label}" has invalid status "${c.status}"`); queueErrors++;
    }
    if (c.slug && seenCandidateSlugs.has(c.slug)) {
      error(`content-backlog.json: duplicate candidate "${c.slug}"`); queueErrors++;
    }
    if (c.slug) seenCandidateSlugs.add(c.slug);
    if (c.seasonality_window && windowDefs && !windowDefs[c.seasonality_window]) {
      error(`content-backlog.json: "${label}" has unknown seasonality_window "${c.seasonality_window}"`); queueErrors++;
    }
    // A candidate must not already be scheduled -- that is a double-booking.
    if (c.slug && allCalPosts.some(p => p.slug === c.slug && p.status !== 'published')) {
      error(`content-backlog.json: "${c.slug}" is in the backlog AND scheduled in year1`); queueErrors++;
    }
  }

  if (queueErrors === 0) pass(`content queue: ${slots.length} slot(s), ${candidates.length} backlog candidate(s), all valid`);
}

// ─── Cross-References ───────────────────────────

console.log();

// Product slugs in seo.json exist in products.json
const seoData = loadJson('seo.json');
if (seoData && products) {
  let xrefErrors = 0;
  const productSlugs = new Set();
  for (const [line, prods] of Object.entries(products)) {
    for (const p of prods) { if (p.url) productSlugs.add(p.url); }
  }
  for (const urlPath of Object.keys(seoData.pages || {})) {
    if (urlPath.match(/^\/(personal|commercial|life|health)\/[^/]+\.html$/)) {
      if (!productSlugs.has(urlPath)) {
        warn(`seo.json references ${urlPath} but no matching product found`);
        xrefErrors++;
      }
    }
  }
  if (xrefErrors === 0) pass('Cross-ref: seo.json product URLs match products.json');
}

// Blog files in content-calendar exist on disk
if (calendar) {
  const blogSrc = path.join(ROOT, 'src', 'blog');
  let missingBlogs = 0;
  const allCalPosts = [...(calendar.existing_posts || []), ...(calendar.year1 || [])];
  for (const p of allCalPosts) {
    if (!p.slug) continue;
    const mdPath = path.join(blogSrc, `${p.slug}.md`);
    if (!fs.existsSync(mdPath)) {
      // Check if it's an existing HTML post
      const htmlExists = fs.existsSync(path.join(ROOT, 'src', 'pages', 'blog', `${p.slug}.html`));
      if (!htmlExists) {
        warn(`content-calendar: "${p.slug}" — no .md or .html file found`);
        missingBlogs++;
      }
    }
  }
  if (missingBlogs === 0) pass('Cross-ref: all calendar posts have source files');
  else pass(`Cross-ref: ${missingBlogs} calendar posts missing source files (may be future)`);
}

// Every carrier in carriers.json should have at least one product page linkable
if (carriers && products) {
  const allProductIds = new Set();
  for (const [line, prods] of Object.entries(products)) {
    for (const p of prods) allProductIds.add(p.id);
  }
  let orphanCarriers = 0;
  const seen = new Set();
  for (const [line, carrs] of Object.entries(carriers)) {
    for (const c of carrs) {
      if (seen.has(c.slug)) continue;
      seen.add(c.slug);
      if (c.lines && c.lines.length > 0) {
        const hasMatch = c.lines.some(l => allProductIds.has(l));
        if (!hasMatch) { warn(`carriers.json: "${c.name}" lines [${c.lines.join(',')}] don't match any product IDs`); orphanCarriers++; }
      }
    }
  }
  if (orphanCarriers === 0) pass('Cross-ref: all enriched carriers link to valid products');
}

// Every product should have at least 3 FAQs in knowledge-base
if (products && kb) {
  const faqCounts = {};
  for (const e of (kb.entries || [])) {
    if (e.product) faqCounts[e.product] = (faqCounts[e.product] || 0) + 1;
  }
  let lowFaqProducts = 0;
  for (const [line, prods] of Object.entries(products)) {
    for (const p of prods) {
      const count = faqCounts[p.id] || 0;
      if (count < 3) { warn(`Product "${p.id}" has only ${count} FAQs (recommend 3+)`); lowFaqProducts++; }
    }
  }
  if (lowFaqProducts === 0) pass('Cross-ref: all products have 3+ FAQs');
  else pass(`Cross-ref: ${lowFaqProducts} products have fewer than 3 FAQs`);
}

// Verify sage-api-docs.json if it exists (optional — created in Task 29)
if (fs.existsSync(path.join(DATA, 'sage-api-docs.json'))) {
  const apiDocs = loadJson('sage-api-docs.json');
  if (apiDocs) {
    let docErrors = 0;
    const endpoints = apiDocs.endpoints || [];
    for (const ep of endpoints) {
      if (!ep.path) { error('sage-api-docs.json: endpoint missing path'); docErrors++; }
      if (!ep.method) { error(`sage-api-docs.json: ${ep.path || 'unknown'} missing method`); docErrors++; }
    }
    if (docErrors === 0) pass(`sage-api-docs.json: ${endpoints.length} endpoints documented`);
  }
}

// ─── Sanity Checks ──────────────────────────────

console.log();

// No empty data files
let emptyFiles = 0;
for (const file of fs.readdirSync(DATA)) {
  if (!file.endsWith('.json')) continue;
  const fp = path.join(DATA, file);
  const stat = fs.statSync(fp);
  if (stat.size === 0) { error(`Empty file: data/${file}`); emptyFiles++; }
  if (stat.size > 5 * 1024 * 1024) { error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB): data/${file}`); }
}
if (emptyFiles === 0) pass('No empty data files');

// No empty arrays that should have items
if (products) {
  for (const [line, prods] of Object.entries(products)) {
    if (Array.isArray(prods) && prods.length === 0) warn(`products.json: "${line}" is empty`);
  }
}

// ─── Checksums ──────────────────────────────────

console.log();

const checksums = {};
for (const file of fs.readdirSync(DATA).filter(f => f.endsWith('.json'))) {
  const content = fs.readFileSync(path.join(DATA, file));
  checksums[file] = crypto.createHash('sha256').update(content).digest('hex');
}

const checksumPath = path.join(DATA, '.checksums.json');
let changed = [];
if (fs.existsSync(checksumPath)) {
  const prev = JSON.parse(fs.readFileSync(checksumPath, 'utf8'));
  for (const [file, hash] of Object.entries(checksums)) {
    if (prev[file] && prev[file] !== hash) changed.push(file);
  }
  for (const file of Object.keys(prev)) {
    if (!checksums[file]) changed.push(`${file} (deleted)`);
  }
}

fs.writeFileSync(checksumPath, JSON.stringify(checksums, null, 2) + '\n');
if (changed.length > 0) {
  console.log(`  Changed since last check: ${changed.join(', ')}`);
} else {
  pass('Checksums generated (no previous baseline or no changes)');
}

// ─── Summary ────────────────────────────────────

console.log(`\n${errors === 0 ? '✅' : '❌'} Data integrity: ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
