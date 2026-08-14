#!/usr/bin/env node
/**
 * Build Consistency Validator
 * Checks that all pages share the same nav, footer, CSS/JS, meta structure, etc.
 * Runs on build/ output. Exit 1 on errors.
 *
 * Usage: node scripts/validate-consistency.js
 */

const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');

let errors = 0;
let warnings = 0;
const errorList = [];
const warnList = [];

function error(msg) { errorList.push(msg); errors++; }
function warn(msg)  { warnList.push(msg);  warnings++; }

// ─── Collect HTML files ─────────────────────────────────────────────────────

const htmlFiles = [];
function collectHtml(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(full);
    else if (entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}
collectHtml(BUILD);

// ─── Page Classification ─────────────────────────────────────────────────────

function classify(file) {
  const rel = path.relative(BUILD, file);
  // Utility pages: most checks skipped
  if (rel === '404.html') return 'utility';
  // Portal pages: simplified nav/footer rules, Turnstile required
  if (rel === 'intake/index.html' || rel === 'portal/index.html' || rel === 'partner/index.html') return 'portal';
  return 'public';
}

const publicPages  = htmlFiles.filter(f => classify(f) === 'public');
const portalPages  = htmlFiles.filter(f => classify(f) === 'portal');
const utilityPages = htmlFiles.filter(f => classify(f) === 'utility');

console.log(`\nValidating consistency (${htmlFiles.length} pages)...\n`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractHrefs(html, classPattern) {
  // classPattern: regex for class names to match on <a> elements
  const re = new RegExp(`<a[^>]+class="[^"]*(?:${classPattern})[^"]*"[^>]*href="([^"]+)"`, 'g');
  const hrefs = new Set();
  let m;
  while ((m = re.exec(html)) !== null) hrefs.add(m[1]);
  return hrefs;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function rel(file) { return path.relative(BUILD, file); }

// ─── Canonical nav/footer from shared-templates ───────────────────────────────

const { renderNav, renderFooter } = require('./shared-templates');
const canonicalNav = renderNav();
const dummyOffice = { street: '123 Test St', city: 'Louisville', state: 'KY', zip: '40202', phone: '(502) 413-5335', email: 'info@thewayagency.com' };
const canonicalFooter = renderFooter(dummyOffice);

// Extract nav hrefs from canonical nav
function extractNavHrefs(html) {
  // Extract from nav__link, nav__dropdown-item, and btn--primary
  const hrefs = new Set();
  const re = /href="([^"]+)"/g;
  // Only look inside the <nav> block
  const navMatch = html.match(/<nav[\s\S]*?<\/nav>/);
  if (!navMatch) return hrefs;
  const navHtml = navMatch[0];
  let m;
  while ((m = re.exec(navHtml)) !== null) {
    const href = m[1];
    // Filter to internal paths only (skip logo href="/")
    if (href.startsWith('/') && !href.startsWith('//')) hrefs.add(href);
  }
  return hrefs;
}

// Extract footer hrefs (internal only)
function extractFooterHrefs(html) {
  const hrefs = new Set();
  // Find footer block
  const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/);
  if (!footerMatch) return hrefs;
  const footerHtml = footerMatch[0];
  const re = /href="(\/[^"]+)"/g;
  let m;
  while ((m = re.exec(footerHtml)) !== null) {
    hrefs.add(m[1]);
  }
  return hrefs;
}

const canonicalNavHrefs = extractNavHrefs(canonicalNav);
const canonicalFooterHrefs = extractFooterHrefs(canonicalFooter);

// ─── Check 1: Nav Consistency ────────────────────────────────────────────────

{
  console.log('[Nav]');
  let navErrors = 0;
  let navWarnings = 0;

  for (const file of publicPages) {
    const html = fs.readFileSync(file, 'utf8');
    const pageNavHrefs = extractNavHrefs(html);
    if (!setsEqual(pageNavHrefs, canonicalNavHrefs)) {
      const missing = [...canonicalNavHrefs].filter(h => !pageNavHrefs.has(h));
      const extra   = [...pageNavHrefs].filter(h => !canonicalNavHrefs.has(h));
      const parts = [];
      if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
      if (extra.length)   parts.push(`extra: ${extra.join(', ')}`);
      error(`Nav mismatch in ${rel(file)}: ${parts.join(' | ')}`);
      navErrors++;
    }
  }

  for (const file of portalPages) {
    const html = fs.readFileSync(file, 'utf8');
    const pageNavHrefs = extractNavHrefs(html);
    if (!setsEqual(pageNavHrefs, canonicalNavHrefs)) {
      const missing = [...canonicalNavHrefs].filter(h => !pageNavHrefs.has(h));
      const extra   = [...pageNavHrefs].filter(h => !canonicalNavHrefs.has(h));
      const parts = [];
      if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
      if (extra.length)   parts.push(`extra: ${extra.join(', ')}`);
      warn(`Nav mismatch in ${rel(file)} (portal, warn only): ${parts.join(' | ')}`);
      navWarnings++;
    }
  }

  if (navErrors === 0 && navWarnings === 0) {
    console.log(`  ✓ All ${publicPages.length} public pages have consistent nav (${canonicalNavHrefs.size} links)`);
  } else {
    if (navErrors > 0)   console.log(`  ✗ ${navErrors} public page(s) have nav inconsistencies`);
    if (navWarnings > 0) console.log(`  ! ${navWarnings} portal page(s) have nav differences (warn only)`);
    // Print details
    for (const msg of errorList.filter(m => m.includes('Nav mismatch'))) console.log(`    ${msg}`);
    for (const msg of warnList.filter(m => m.includes('Nav mismatch'))) console.log(`    ${msg}`);
  }
}

// ─── Check 2: Footer Consistency ─────────────────────────────────────────────

{
  console.log('\n[Footer]');
  let footerErrors = 0;

  for (const file of publicPages) {
    const html = fs.readFileSync(file, 'utf8');
    const pageFooterHrefs = extractFooterHrefs(html);
    if (!setsEqual(pageFooterHrefs, canonicalFooterHrefs)) {
      const missing = [...canonicalFooterHrefs].filter(h => !pageFooterHrefs.has(h));
      const extra   = [...pageFooterHrefs].filter(h => !canonicalFooterHrefs.has(h));
      const parts = [];
      if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
      if (extra.length)   parts.push(`extra: ${extra.join(', ')}`);
      error(`Footer mismatch in ${rel(file)}: ${parts.join(' | ')}`);
      footerErrors++;
    }
  }

  if (footerErrors === 0) {
    console.log(`  ✓ All ${publicPages.length} public pages have consistent footer`);
  } else {
    console.log(`  ✗ ${footerErrors} page(s) have footer inconsistencies`);
    for (const msg of errorList.filter(m => m.includes('Footer mismatch'))) console.log(`    ${msg}`);
  }
}

// ─── Check 3: CSS/JS Loading ─────────────────────────────────────────────────

{
  console.log('\n[CSS/JS Loading]');
  let cssJsErrors = 0;
  const requiredCss = ['base.css', 'components.css', 'leadgen.css'];

  // Pages that embed ALL styles inline (no external CSS refs — intentionally self-contained)
  const inlineOnlyPages = new Set([
    'portal/index.html',   // SPA portal, fully inline
    'partner/index.html',  // SPA partner portal, fully inline
    'privacy.html',        // Legal page with full inline styles
    'terms.html',          // Legal page with full inline styles
  ]);

  // Pages that don't use app.js (self-contained SPAs with own inline JS).
  // intake previously passed this check only because the string "app.js"
  // appeared in a code COMMENT — list it explicitly; it loads attribution.js
  // standalone by design (loading full app.js would inject the mobile call
  // FAB + a dead after-hours chat binding on the money page).
  const noAppJsPages = new Set([
    'portal/index.html',
    'partner/index.html',
    'intake/index.html',
  ]);

  for (const file of htmlFiles) {
    const fileClass = classify(file);
    if (fileClass === 'utility') continue;
    const r = rel(file);
    if (inlineOnlyPages.has(r)) continue;

    const html = fs.readFileSync(file, 'utf8');
    const isBlogPost = r.startsWith('blog/') && r !== 'blog/index.html';

    for (const css of requiredCss) {
      // Accept in link tag, noscript, or inline style block reference
      if (!html.includes(css)) {
        error(`Missing ${css} in ${r}`);
        cssJsErrors++;
      }
    }

    if (!noAppJsPages.has(r) && !html.includes('app.js')) {
      error(`Missing app.js in ${r}`);
      cssJsErrors++;
    }

    if (isBlogPost && !html.includes('blog.css')) {
      error(`Blog post missing blog.css: ${r}`);
      cssJsErrors++;
    }
  }

  if (cssJsErrors === 0) {
    console.log(`  ✓ All pages load required CSS and JS`);
  } else {
    console.log(`  ✗ ${cssJsErrors} CSS/JS loading issue(s)`);
    for (const msg of errorList.filter(m => m.includes('Missing base.css') || m.includes('Missing components.css') || m.includes('Missing leadgen.css') || m.includes('Missing app.js') || m.includes('Blog post missing'))) {
      console.log(`    ${msg}`);
    }
  }
}

// ─── Check 4: HTML Structure ──────────────────────────────────────────────────

{
  console.log('\n[HTML Structure]');
  let structErrors = 0;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const r = rel(file);

    if (!html.includes('<!DOCTYPE html>') && !html.includes('<!DOCTYPE HTML>')) {
      error(`Missing <!DOCTYPE html>: ${r}`);
      structErrors++;
    }

    if (!/<html[^>]+lang="en"/.test(html)) {
      error(`Missing <html lang="en">: ${r}`);
      structErrors++;
    }

    // Count <h1> tags (skip utility pages and SPA portals that don't have semantic h1)
    const spaPages = new Set(['portal/index.html', 'partner/index.html']);
    if (classify(file) !== 'utility' && !spaPages.has(r)) {
      const h1Count = (html.match(/<h1[\s>]/g) || []).length;
      if (h1Count === 0) {
        error(`No <h1> found: ${r}`);
        structErrors++;
      } else if (h1Count > 1) {
        error(`Multiple <h1> tags (${h1Count}): ${r}`);
        structErrors++;
      }
    }

    // Duplicate <head> tags — look for literal opening <head> (not within comments/scripts)
    const headOpenCount = (html.match(/^<head>$/gm) || []).length;
    if (headOpenCount > 1) {
      error(`Duplicate <head> tag (${headOpenCount}x): ${r}`);
      structErrors++;
    }

    // Duplicate <body> tags
    const bodyCount = (html.match(/<body[\s>]/g) || []).length;
    if (bodyCount > 1) {
      error(`Duplicate <body> tag (${bodyCount}x): ${r}`);
      structErrors++;
    }
  }

  if (structErrors === 0) {
    console.log(`  ✓ All ${htmlFiles.length} pages have valid HTML structure`);
  } else {
    console.log(`  ✗ ${structErrors} HTML structure issue(s)`);
    for (const msg of errorList.filter(m =>
      m.includes('DOCTYPE') || m.includes('html lang') || m.includes('<h1>') ||
      m.includes('Multiple <h1>') || m.includes('No <h1>') ||
      m.includes('Duplicate <head>') || m.includes('Duplicate <body>'))) {
      console.log(`    ${msg}`);
    }
  }
}

// ─── Check 5: Meta Tags ───────────────────────────────────────────────────────

{
  console.log('\n[Meta Tags]');
  let metaErrors = 0;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const r = rel(file);

    if (!/<title>[^<]+<\/title>/.test(html)) {
      error(`Missing <title>: ${r}`);
      metaErrors++;
    }

    if (!/<meta\s[^>]*name="description"[^>]*content="[^"]+"/.test(html)) {
      error(`Missing meta description: ${r}`);
      metaErrors++;
    }

    // Public pages also need canonical + OG tags
    if (classify(file) === 'public') {
      if (!/<link[^>]+rel="canonical"/.test(html)) {
        error(`Missing canonical link: ${r}`);
        metaErrors++;
      }
      if (!/<meta[^>]+property="og:title"/.test(html)) {
        error(`Missing og:title: ${r}`);
        metaErrors++;
      }
      if (!/<meta[^>]+property="og:description"/.test(html)) {
        error(`Missing og:description: ${r}`);
        metaErrors++;
      }
      if (!/<meta[^>]+property="og:url"/.test(html)) {
        error(`Missing og:url: ${r}`);
        metaErrors++;
      }
    }
  }

  if (metaErrors === 0) {
    console.log(`  ✓ All pages have required meta tags`);
  } else {
    console.log(`  ✗ ${metaErrors} meta tag issue(s)`);
    for (const msg of errorList.filter(m =>
      m.includes('Missing <title>') || m.includes('meta description') ||
      m.includes('canonical') || m.includes('og:'))) {
      console.log(`    ${msg}`);
    }
  }
}

// ─── Check 6: Accessibility ───────────────────────────────────────────────────

{
  console.log('\n[Accessibility]');
  let a11yErrors = 0;

  const nonUtility = htmlFiles.filter(f => classify(f) !== 'utility');

  for (const file of nonUtility) {
    const html = fs.readFileSync(file, 'utf8');
    const r = rel(file);

    if (!html.includes('class="skip-link"')) {
      error(`Missing skip-link: ${r}`);
      a11yErrors++;
    }

    if (!/<main[\s>]/.test(html)) {
      error(`Missing <main> landmark: ${r}`);
      a11yErrors++;
    }

    // Public pages should have a <nav>
    if (classify(file) === 'public') {
      if (!/<nav[\s>]/.test(html)) {
        error(`Missing <nav>: ${r}`);
        a11yErrors++;
      }
    }
  }

  if (a11yErrors === 0) {
    console.log(`  ✓ All non-utility pages meet accessibility landmarks`);
  } else {
    console.log(`  ✗ ${a11yErrors} accessibility issue(s)`);
    for (const msg of errorList.filter(m =>
      m.includes('skip-link') || m.includes('<main>') || m.includes('<nav>'))) {
      console.log(`    ${msg}`);
    }
  }
}

// ─── Check 7: Review Data Consistency ────────────────────────────────────────

{
  console.log('\n[Review Data]');
  let reviewErrors = 0;

  // Extract all "(N reviews)" patterns
  const countPattern = /\((\d+\+?) reviews?\)/g;
  // Extract all ratingValue patterns in JSON-LD
  const ratingPattern = /"ratingValue":\s*"([\d.]+)"/g;

  const allCounts = new Map();
  const allRatings = new Map();

  for (const file of publicPages) {
    const html = fs.readFileSync(file, 'utf8');
    const r = rel(file);
    let m;

    // Reset lastIndex
    countPattern.lastIndex = 0;
    ratingPattern.lastIndex = 0;

    const countsInPage = new Set();
    while ((m = countPattern.exec(html)) !== null) {
      countsInPage.add(m[1]);
    }
    for (const c of countsInPage) {
      if (!allCounts.has(c)) allCounts.set(c, []);
      allCounts.get(c).push(r);
    }

    const ratingsInPage = new Set();
    while ((m = ratingPattern.exec(html)) !== null) {
      ratingsInPage.add(m[1]);
    }
    for (const rv of ratingsInPage) {
      if (!allRatings.has(rv)) allRatings.set(rv, []);
      allRatings.get(rv).push(r);
    }
  }

  if (allCounts.size > 1) {
    error(`Inconsistent review counts across pages: ${[...allCounts.keys()].join(', ')}`);
    reviewErrors++;
  }

  if (allRatings.size > 1) {
    error(`Inconsistent rating values across pages: ${[...allRatings.keys()].join(', ')}`);
    reviewErrors++;
  }

  if (reviewErrors === 0) {
    const count = allCounts.size === 1 ? [...allCounts.keys()][0] : 'N/A';
    const rating = allRatings.size === 1 ? [...allRatings.keys()][0] : 'N/A';
    console.log(`  ✓ Review data consistent (${count} reviews, ${rating} stars)`);
  } else {
    console.log(`  ✗ ${reviewErrors} review data inconsistency(ies)`);
    for (const msg of errorList.filter(m => m.includes('review'))) console.log(`    ${msg}`);
  }
}

// ─── Check 8: JSON-LD ─────────────────────────────────────────────────────────

{
  console.log('\n[JSON-LD]');
  let jsonLdErrors = 0;
  const jsonLdRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

  // Skip legal/utility pages and noindexed pages — they don't need structured data
  const jsonLdSkip = new Set(['privacy.html', 'terms.html', 'login.html']);

  for (const file of publicPages) {
    const r = rel(file);
    const html = fs.readFileSync(file, 'utf8');

    // Skip explicitly excluded pages and noindexed pages
    if (jsonLdSkip.has(r)) continue;
    if (html.includes('name="robots" content="noindex')) continue;

    jsonLdRe.lastIndex = 0;

    let found = false;
    let m;
    while ((m = jsonLdRe.exec(html)) !== null) {
      found = true;
      try {
        const parsed = JSON.parse(m[1].trim());
        if (!parsed['@context']) {
          error(`JSON-LD missing @context in ${r}`);
          jsonLdErrors++;
        }
        if (!parsed['@type']) {
          error(`JSON-LD missing @type in ${r}`);
          jsonLdErrors++;
        }
      } catch (e) {
        error(`Invalid JSON-LD in ${r}: ${e.message.substring(0, 60)}`);
        jsonLdErrors++;
      }
    }

    if (!found) {
      error(`No JSON-LD found: ${r}`);
      jsonLdErrors++;
    }
  }

  if (jsonLdErrors === 0) {
    console.log(`  ✓ All applicable public pages have valid JSON-LD`);
  } else {
    console.log(`  ✗ ${jsonLdErrors} JSON-LD issue(s)`);
    for (const msg of errorList.filter(m =>
      m.includes('JSON-LD') || m.includes('@context') || m.includes('@type'))) {
      console.log(`    ${msg}`);
    }
  }
}

// ─── Check 9: Script Tags ─────────────────────────────────────────────────────

{
  console.log('\n[Script Tags]');
  let scriptErrors = 0;
  const nonUtility = htmlFiles.filter(f => classify(f) !== 'utility');

  // SPA portals have their own inline JS and don't use app.js; intake loads
  // attribution.js standalone instead (see noAppJsPages above).
  const spaPortals = new Set(['portal/index.html', 'partner/index.html', 'intake/index.html']);

  for (const file of nonUtility) {
    const html = fs.readFileSync(file, 'utf8');
    const r = rel(file);

    if (!html.includes('GTM-MCQG9SN3')) {
      error(`Missing GTM container (GTM-MCQG9SN3): ${r}`);
      scriptErrors++;
    }

    if (!spaPortals.has(r) && !html.includes('app.js')) {
      error(`Missing app.js script: ${r}`);
      scriptErrors++;
    }
  }

  // Only intake requires Turnstile (it's the form submission portal)
  const intakePage = htmlFiles.find(f => rel(f) === 'intake/index.html');
  if (intakePage) {
    const html = fs.readFileSync(intakePage, 'utf8');
    if (!html.includes('challenges.cloudflare.com/turnstile')) {
      error(`Intake page missing Turnstile: intake/index.html`);
      scriptErrors++;
    }
  }

  if (scriptErrors === 0) {
    console.log(`  ✓ All pages have required script tags`);
  } else {
    console.log(`  ✗ ${scriptErrors} script tag issue(s)`);
    for (const msg of errorList.filter(m =>
      m.includes('GTM') || m.includes('app.js script') || m.includes('Turnstile'))) {
      console.log(`    ${msg}`);
    }
  }
}

// ─── Check 10: Cache-Busting ──────────────────────────────────────────────────

{
  console.log('\n[Cache-Busting]');
  let cacheErrors = 0;

  // Skip portal pages and inline-only pages (they use inline styles without external asset refs)
  const cacheSkipPages = new Set(['portal/index.html', 'partner/index.html', 'privacy.html', 'terms.html']);
  const checkPages = htmlFiles.filter(f => !cacheSkipPages.has(rel(f)));

  for (const file of checkPages) {
    const html = fs.readFileSync(file, 'utf8');
    const r = rel(file);

    // Find all /src/css/*.css and /src/js/*.js references
    const assetRe = /\/src\/(css\/[^"?\s]+\.css|js\/[^"?\s]+\.js)/g;
    let m;
    while ((m = assetRe.exec(html)) !== null) {
      const assetRef = m[0];
      // Check if the full reference (in href or src attribute) has ?v=
      // Look a bit ahead in the HTML for the closing quote to see if ?v= is present
      const startIdx = m.index;
      const snippet = html.substring(startIdx, startIdx + 100);
      if (!snippet.includes('?v=')) {
        error(`Missing ?v= cache-bust on ${assetRef} in ${r}`);
        cacheErrors++;
      }
    }
  }

  if (cacheErrors === 0) {
    console.log(`  ✓ All asset references have cache-busting ?v= params`);
  } else {
    console.log(`  ✗ ${cacheErrors} missing cache-busting param(s)`);
    for (const msg of errorList.filter(m => m.includes('cache-bust'))) {
      console.log(`    ${msg}`);
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('');
if (errors === 0 && warnings === 0) {
  console.log(`✓ Consistency check passed: ${htmlFiles.length} pages, 0 errors, 0 warnings`);
} else if (errors === 0) {
  console.log(`✓ Consistency check passed with warnings: ${htmlFiles.length} pages, 0 errors, ${warnings} warnings`);
} else {
  console.log(`✗ Consistency check: ${errors} errors, ${warnings} warnings across ${htmlFiles.length} pages`);
}

process.exit(errors > 0 ? 1 : 0);
