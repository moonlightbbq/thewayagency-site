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
