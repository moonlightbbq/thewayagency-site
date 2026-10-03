#!/usr/bin/env node
/**
 * Build Validation Script
 * Checks build output for common issues. Exit 1 on failure.
 *
 * Usage: node scripts/validate-build.js
 */

const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
let errors = 0;
let warnings = 0;

function error(msg) { console.log(`  ✗ ${msg}`); errors++; }
function warn(msg) { console.log(`  ! ${msg}`); warnings++; }
function pass(msg) { console.log(`  ✓ ${msg}`); }

console.log('\nValidating build output...\n');

// Collect all HTML files
const htmlFiles = [];
function collectHtml(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(full);
    else if (entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}
collectHtml(BUILD);

// 1. Every page has <title> and <meta name="description">
let missingTitle = 0, missingDesc = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(BUILD, file);
  if (!/<title>[^<]+<\/title>/.test(html)) { error(`Missing <title>: ${rel}`); missingTitle++; }
  if (!/<meta\s+name="description"\s+content="[^"]+">/.test(html)) { error(`Missing <meta description>: ${rel}`); missingDesc++; }
}
if (missingTitle === 0 && missingDesc === 0) pass(`All ${htmlFiles.length} pages have <title> and <meta description>`);

// 2. No broken internal links
const allPaths = new Set();
function collectPaths(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPaths(full, `${prefix}${entry.name}/`);
      // Also register the directory as serving index.html
      if (fs.existsSync(path.join(full, 'index.html'))) {
        allPaths.add(`${prefix}${entry.name}/`);
      }
    } else {
      allPaths.add(`${prefix}${entry.name}`);
    }
  }
}
collectPaths(BUILD, '/');

let brokenLinks = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(BUILD, file);
  const linkRegex = /href="(\/[^"#?]+)"/g;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    // Skip external, anchor, and special links
    if (href.startsWith('//') || href.startsWith('/src/')) continue;
    // Check if path exists (as file or directory with index.html). Cloudflare
    // Pages serves /foo from /foo.html (pretty URLs), so accept .html on disk
    // for an extensionless href.
    if (!allPaths.has(href) && !allPaths.has(href + '.html') && !allPaths.has(href.replace(/\/$/, '/index.html'))) {
      if (!allPaths.has(href + '/') && !allPaths.has(href + '/index.html')) {
        error(`Broken link in ${rel}: ${href}`);
        brokenLinks++;
      }
    }
  }
}
if (brokenLinks === 0) pass('No broken internal links');

// 3. Sitemap URLs resolve
const sitemapPath = path.join(BUILD, 'sitemap.xml');
if (fs.existsSync(sitemapPath)) {
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const urlRegex = /<loc>https:\/\/www\.thewayagency\.com([^<]+)<\/loc>/g;
  let sitemapMatch;
  let sitemapBroken = 0;
  let sitemapTotal = 0;
  while ((sitemapMatch = urlRegex.exec(sitemap)) !== null) {
    sitemapTotal++;
    const urlPath = sitemapMatch[1];
    // Cloudflare Pages serves /foo from /foo.html (pretty URLs). Sitemap declares
    // the served URL (extensionless), so accept both /foo and /foo.html on disk.
    if (!allPaths.has(urlPath) && !allPaths.has(urlPath + '.html') && !allPaths.has(urlPath + 'index.html') && !allPaths.has(urlPath.replace(/\/$/, '/index.html'))) {
      error(`Sitemap URL not found: ${urlPath}`);
      sitemapBroken++;
    }
  }
  if (sitemapBroken === 0) pass(`All ${sitemapTotal} sitemap URLs resolve`);
} else {
  error('sitemap.xml not found');
}

// 4. No duplicate titles
const titles = {};
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(BUILD, file);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  if (titleMatch) {
    const title = titleMatch[1];
    if (titles[title]) {
      warn(`Duplicate title "${title}" in ${rel} and ${titles[title]}`);
    } else {
      titles[title] = rel;
    }
  }
}
const uniqueTitles = Object.keys(titles).length;
if (uniqueTitles === htmlFiles.length) pass(`All ${uniqueTitles} titles are unique`);

// 5. No pages >500KB
let oversized = 0;
for (const file of htmlFiles) {
  const stats = fs.statSync(file);
  const rel = path.relative(BUILD, file);
  if (stats.size > 500 * 1024) {
    error(`Page too large (${(stats.size / 1024).toFixed(0)}KB): ${rel}`);
    oversized++;
  }
}
if (oversized === 0) pass(`All pages under 500KB`);

// 5b. Stylesheets block render (PERF-03). A media="print" swap restyled sections after
// first paint, and a calc() whose + lost its spaces is dropped by the browser.
let printSwaps = 0;
for (const file of htmlFiles) {
  if (/<link\b[^>]*\bmedia=["']print["']/.test(fs.readFileSync(file, 'utf8'))) {
    error(`Stylesheet loaded with a media="print" swap: ${path.relative(BUILD, file)}`);
    printSwaps++;
  }
}
if (printSwaps === 0) pass('No media="print" stylesheet swaps');
let badCalc = 0;
const builtCssDir = path.join(BUILD, 'src', 'css');
if (fs.existsSync(builtCssDir)) {
  for (const name of fs.readdirSync(builtCssDir).filter((n) => n.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(builtCssDir, name), 'utf8');
    for (const m of css.match(/calc\([^;}]*?(?:\S\+|\+\S)[^;}]*/g) || []) {
      error(`calc() with a + not surrounded by spaces in src/css/${name}: ${m.slice(0, 80)}`);
      badCalc++;
    }
  }
}
if (badCalc === 0) pass('Every calc() + in the built CSS keeps its spaces');

// 6. All referenced images exist
let missingImages = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(BUILD, file);
  const imgRegex = /src="(\/src\/assets\/[^"]+)"/g;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const imgPath = imgMatch[1];
    const fullPath = path.join(BUILD, imgPath);
    if (!fs.existsSync(fullPath)) {
      error(`Missing image in ${rel}: ${imgPath}`);
      missingImages++;
    }
  }
}
if (missingImages === 0) pass('All referenced images exist');

// 7. JSON-LD validation (syntactically valid JSON)
let invalidJsonLd = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(BUILD, file);
  const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let jsonMatch;
  while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (!parsed['@type']) warn(`JSON-LD missing @type in ${rel}`);
    } catch (e) {
      error(`Invalid JSON-LD in ${rel}: ${e.message.substring(0, 60)}`);
      invalidJsonLd++;
    }
  }
}
if (invalidJsonLd === 0) pass('All JSON-LD is syntactically valid');

// 7b. JSON-LD URL validation
let jsonLdUrlIssues = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(BUILD, file);
  const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let jsonMatch;
  while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      const urls = JSON.stringify(parsed).match(/https:\/\/www\.thewayagency\.com[^"]+/g) || [];
      for (const url of urls) {
        const urlPath = url.replace('https://www.thewayagency.com', '');
        // Skip anchors, image/asset paths, and root
        if (!urlPath || urlPath === '/' || urlPath.includes('#') || urlPath.startsWith('/src/')) continue;
        // Cloudflare pretty URLs serve /foo from /foo.html — accept both.
        if (!allPaths.has(urlPath) && !allPaths.has(urlPath + '.html') && !allPaths.has(urlPath + 'index.html') && !allPaths.has(urlPath.replace(/\/$/, '/index.html'))) {
          if (!allPaths.has(urlPath + '/')) {
            warn(`JSON-LD URL in ${rel} may not resolve: ${urlPath}`);
            jsonLdUrlIssues++;
          }
        }
      }
    } catch {}
  }
}
if (jsonLdUrlIssues === 0) pass('JSON-LD URLs reference valid paths');

// 7d. Entity schema guard (SCHEMA-01..04): no invented locations, no self-serving
// ratings, one agency entity (#organization). Rules: scripts/lib/entity-schema-guard.js
// (dependency-free; build.js step 11a runs the same guard).
{
  const { entitySchemaProblems, guardOptions } = require('./lib/entity-schema-guard');
  const opts = guardOptions(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'entity.json'), 'utf8')));
  let entityProblems = 0;
  for (const file of htmlFiles) {
    const rel = path.relative(BUILD, file).split(path.sep).join('/');
    for (const p of entitySchemaProblems(fs.readFileSync(file, 'utf8'), rel, opts)) { error(`Entity schema: ${p}`); entityProblems++; }
  }
  if (entityProblems === 0) pass('Entity schema: one #organization entity, no invented locations, no review markup');
}

// 7c. Carrier pages check
const carrierDir = path.join(BUILD, 'carriers');
if (fs.existsSync(carrierDir)) {
  const carrierPages = fs.readdirSync(carrierDir).filter(f => f.endsWith('.html'));
  const hasIndex = carrierPages.includes('index.html');
  if (!hasIndex) warn('Carrier index page missing');
  if (carrierPages.length < 2) warn(`Only ${carrierPages.length} carrier pages — expected more`);
  else pass(`${carrierPages.length} carrier pages (including index)`);
}

// 7d. Turnstile loads only where a widget renders, async; app.js is deferred (PERF-02).
// A deferred Turnstile loader on every page held DOMContentLoaded, and with it all of
// app.js's set-up, on 179 pages that never render a widget.
const TURNSTILE_PAGES = new Set(['contact.html', 'about/careers/apply.html', 'intake/index.html']);
let turnstileIssues = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(BUILD, file).split(path.sep).join('/');
  const loaders = html.match(/<script\b[^>]*challenges\.cloudflare\.com\/turnstile[^>]*>/g) || [];
  if (loaders.length && !TURNSTILE_PAGES.has(rel)) { error(`Turnstile loaded on a page with no widget: ${rel}`); turnstileIssues++; }
  if (rel !== 'intake/index.html') {
    for (const tag of loaders) if (!/\sasync\b/.test(tag)) { error(`Turnstile loader is not async in ${rel}`); turnstileIssues++; }
  }
  if (/<link\b[^>]*rel="preconnect"[^>]*href="https:\/\/challenges\.cloudflare\.com"[^>]*crossorigin/.test(html)) {
    error(`crossorigin preconnect to challenges.cloudflare.com in ${rel} (the script request is no-cors)`); turnstileIssues++;
  }
  for (const tag of html.match(/<script\b[^>]*src="\/src\/js\/app\.js[^"]*"[^>]*>/g) || []) {
    if (!/\sdefer\b/.test(tag)) { error(`app.js is not deferred in ${rel}`); turnstileIssues++; }
  }
}
if (turnstileIssues === 0) pass('Turnstile only on widget pages (async); app.js deferred everywhere');

// 7e. Call-and-text pairing (CONV-04; CONTENT_RULES rule 3). Every tel: link has
// an sms: peer in its parent or grandparent, both go to +15024135335 (third-party
// numbers are plain text), and no sms: link prefills a body. Dependency-free
// tokenizer (CI runs this on Node 18 without npm ci). Links that JavaScript adds
// at runtime (sticky bar, mobile menu, ?agent= swaps) are covered by
// tests/sticky-cta.test.js and the Playwright check, not here. Exemptions:
// scripts/lib/contact-pairing-config.js (the D10 entries await the owner, OA-18).
{
  const { findContactLinkProblems } = require('./lib/contact-pairing');
  const { DEFAULT_EXEMPTIONS } = require('./lib/contact-pairing-config');
  const used = new Set();
  let pairingProblems = 0;
  for (const file of htmlFiles) {
    const rel = path.relative(BUILD, file).split(path.sep).join('/');
    for (const p of findContactLinkProblems(fs.readFileSync(file, 'utf8'), { file: rel, exemptions: DEFAULT_EXEMPTIONS, usedExemptions: used })) {
      error(`Call/text pairing: ${rel}:${p.line} ${p.message}`);
      pairingProblems++;
    }
  }
  for (const ex of DEFAULT_EXEMPTIONS) {
    if (!used.has(ex)) warn(`Call/text pairing: exemption no longer needed, delete it from contact-pairing-config.js: ${ex.page} (${ex.decision})`);
  }
  // The mobile menu's pair is server-rendered (scripts/builders/seo.js); every page
  // with the site nav must carry exactly one, with both links.
  let navPages = 0;
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('id="navLinks"')) continue;
    navPages++;
    const rel = path.relative(BUILD, file).split(path.sep).join('/');
    const blocks = html.match(/<div class="nav__contact">[\s\S]*?<\/div>/g) || [];
    if (blocks.length !== 1 || !blocks[0].includes('href="tel:+15024135335"') || !blocks[0].includes('href="sms:+15024135335"')) {
      error(`Call/text pairing: ${rel} needs exactly one .nav__contact with the tel: and sms: links (found ${blocks.length})`);
      pairingProblems++;
    }
  }
  if (navPages === 0) { error('Call/text pairing: no page with #navLinks found (the nav check stopped seeing them)'); pairingProblems++; }
  if (pairingProblems === 0) pass(`Call/text pairing: every tel: link has an sms: peer to +15024135335 (${used.size} listed exemptions in use); ${navPages} menus carry the pair`);
}

// 7f. CTA article (CONV-04): "Get a Auto Insurance Quote" and the like.
{
  let articleProblems = 0;
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(/\bGet a [AEIO][a-z]+[^<]*Quote/);
    if (m) { error(`CTA article: "${m[0]}" in ${path.relative(BUILD, file)}`); articleProblems++; }
  }
  if (articleProblems === 0) pass('CTA labels: no "Get a" before a vowel sound');
}

// 7g. /intake/ loads Google Maps on demand (PERF-06): no parse-time loader.
{
  const p = path.join(BUILD, 'intake', 'index.html');
  const intake = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  if (!intake.includes('function ensureIntakeMaps(') || /\(async function loadIntakeGoogleMaps\(/.test(intake) || /<script[^>]+src="https:\/\/maps\.googleapis\.com/.test(intake)) {
    error('Intake: Google Maps must load on demand from showStep() (ensureIntakeMaps), not at page load');
  } else pass('Intake: Google Maps loads only after step 1');
}

// 7h. Nav logo is the right-sized asset with dimensions (PERF-08): the 1979x390
// original (35 KB) was displayed at 203x40 and unsized on handcrafted pages.
{
  let logoProblems = 0;
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('id="navLinks"')) continue;
    const rel = path.relative(BUILD, file).split(path.sep).join('/');
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    const img = (nav.match(/<img\b[^>]*logo-horizontal[^>]*>/) || [])[0] || '';
    if (!/logo-horizontal-2x\.png/.test(img) || !/\swidth="203"/.test(img) || !/\sheight="40"/.test(img)) {
      error(`Nav logo in ${rel} is not logo-horizontal-2x.png with width="203" height="40"`); logoProblems++;
    }
    if (/logo-horizontal\.(png|webp)/.test(html)) { error(`${rel} still references the full-size logo-horizontal.(png|webp)`); logoProblems++; }
  }
  if (logoProblems === 0) pass('Nav logo: 2x asset with width/height on every page with the site nav');
}

// 8. Image size check (warn on images >500KB)
let largeImages = 0;
const assetsDir = path.join(BUILD, 'src', 'assets');
function checkImageSizes(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { checkImageSizes(full); continue; }
    if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(entry.name)) {
      const size = fs.statSync(full).size;
      if (size > 500 * 1024) {
        warn(`Large image (${(size / 1024).toFixed(0)}KB): ${path.relative(BUILD, full)}`);
        largeImages++;
      }
    }
  }
}
checkImageSizes(assetsDir);
if (largeImages === 0) pass('All images under 500KB');

// 9. Redirect conflict check
const redirectsPath = path.join(__dirname, '..', '_redirects');
if (fs.existsSync(redirectsPath)) {
  const redirects = fs.readFileSync(redirectsPath, 'utf8');
  const redirectSources = [];
  let conflicts = 0;
  for (const line of redirects.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) {
      const source = parts[0];
      if (redirectSources.includes(source)) {
        warn(`Duplicate redirect source: ${source}`);
        conflicts++;
      }
      redirectSources.push(source);
    }
  }
  if (conflicts === 0) pass(`${redirectSources.length} redirects, no conflicts`);
}

// 10. Privacy guards (TRUST-08 / TRUST-12). Plain string and regex checks on the
// built files: CI runs this on Node 18 without `npm ci`, so no dependencies.
{
  const readBuild = (rel) => {
    const p = path.join(BUILD, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  let privacyErrors = 0;
  const perr = (msg) => { error(msg); privacyErrors++; };
  // A Meta Lead call whose first object literal carries content_name (product
  // ids such as "medicare"). Matches source and terser output alike.
  const LEAD_WITH_CONTENT_NAME = /["']Lead["']\s*,\s*\{[^}]*content_name/;

  // 10a. The JS that every page loads: the bundled app.js (attribution.js is
  // prepended) and the standalone attribution.js that /intake/ loads.
  for (const rel of ['src/js/app.js', 'src/js/attribution.js']) {
    const js = readBuild(rel);
    if (js === null) { perr(`Privacy: ${rel} missing from the build`); continue; }
    if (/\.set\(\s*["'](name|email|phone)["']/.test(js)) perr(`Privacy: ${rel} puts name/email/phone into URL parameters`);
    if (/setUserProperties/.test(js)) perr(`Privacy: ${rel} still calls fbq setUserProperties (plain-text contact data to Meta)`);
    if (LEAD_WITH_CONTENT_NAME.test(js)) perr(`Privacy: ${rel} sends content_name on the Meta Lead event`);
    if (!js.includes('twa_inline_prefill')) perr(`Privacy: ${rel} lacks the sessionStorage hand-off (twa_inline_prefill)`);
  }
  const appJs = readBuild('src/js/app.js') || '';
  if (!appJs.includes('buildIntakeHandoff')) perr('Privacy: app.js inline forms no longer hand off through TWA.buildIntakeHandoff');

  // 10b. /intake/: the URL scrub must be the first script in the document,
  // ahead of every stylesheet (an inline script after a stylesheet waits for
  // it), attribution.js and the GTM/Clarity snippets.
  const intake = readBuild('intake/index.html');
  if (intake === null) {
    perr('Privacy: intake/index.html missing from the build');
  } else {
    const scrubAt = intake.indexOf('twa-url-scrub');
    const firstScriptAt = intake.search(/<script\b/i);
    const firstScriptEnd = firstScriptAt < 0 ? -1 : intake.indexOf('</script>', firstScriptAt);
    const firstCss = intake.search(/<link[^>]+rel="stylesheet"/);
    const attrAt = intake.indexOf('/src/js/attribution.js');
    const gtmAt = intake.indexOf('gtm.js');
    const clarityAt = intake.indexOf('clarity.ms/tag');
    const before = (at) => at < 0 || scrubAt < at;
    if (scrubAt < 0) perr('Privacy: intake/index.html has no twa-url-scrub');
    else if (!(scrubAt > firstScriptAt && scrubAt < firstScriptEnd)) perr('Privacy: twa-url-scrub is not the first <script> in intake/index.html');
    else if (!before(firstCss) || !before(attrAt) || !before(gtmAt) || !before(clarityAt)) perr('Privacy: twa-url-scrub must come before stylesheets, attribution.js, GTM and Clarity in intake/index.html');
    if (/content_name:\s*selectedProducts/.test(intake) || LEAD_WITH_CONTENT_NAME.test(intake)) perr('Privacy: intake sends products on the Meta Lead event');
    if (/setUserProperties/.test(intake)) perr('Privacy: intake calls fbq setUserProperties');
    if (/params\.get\(\s*['"](name|email|phone)['"]\s*\)/.test(intake)) perr('Privacy: intake reads name/email/phone from the URL');
    // Clarity masks: the union of pii-and-privacy PR 1 item 5 (#draft-toast,
    // #review-summary, #step-confirm) and medicare-health-compliance 3.11.8
    // (#draft-toast and the wizard .container). Checked per element, not by
    // count: both specs' counts (>= 3 and exactly 2) describe subsets of these.
    const MASKED = [
      ['#draft-toast', /<div\b[^>]*\bid="draft-toast"[^>]*>/],
      ['wizard .container', /<div\b[^>]*\bclass="container"[^>]*>/],
      ['#review-summary', /<div\b[^>]*\bid="review-summary"[^>]*>/],
      ['#step-confirm', /<div\b[^>]*\bid="step-confirm"[^>]*>/],
    ];
    for (const [label, re] of MASKED) {
      const tag = (intake.match(re) || [])[0];
      if (!tag) perr(`Privacy: intake/index.html has no ${label} element to mask`);
      else if (!/\sdata-clarity-mask="True"/.test(tag)) perr(`Privacy: ${label} in intake/index.html lacks data-clarity-mask="True"`);
    }
    // The fifth echo: Google Places' suggestion list is created at runtime and
    // appended to <body>, so the page must mask it in code.
    if (!/querySelectorAll\(\s*['"]\.pac-container['"]\s*\)[\s\S]{0,160}data-clarity-mask['"]\s*,\s*['"]True['"]/.test(intake)) {
      perr('Privacy: intake/index.html no longer masks the Places suggestion list (.pac-container) for Clarity');
    }
  }

  // 10c. Inline quote forms: no input named name/email/phone (so no native
  // submit can put them in a URL), data-field on all three, and a pre-JS
  // submit goes to /intake/ by GET.
  let inlineForms = 0;
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    // Any attribute order: a reordered <form> tag must not make the guard skip it.
    const forms = html.match(/<form\b[^>]*\bclass="[^"]*\binline-quote-form\b[^"]*"[^>]*>[\s\S]*?<\/form>/g) || [];
    if (!/<form\b[^>]*\bclass="[^"]*\binline-quote-form\b/.test(html)) continue;
    const rel = path.relative(BUILD, file);
    if (!forms.length) { perr(`Privacy: unterminated inline quote form in ${rel}`); continue; }
    for (const form of forms) {
      inlineForms++;
      const open = form.slice(0, form.indexOf('>') + 1);
      if (!/\saction="\/intake\/"/.test(open) || !/\smethod="get"/.test(open)) perr(`Privacy: inline quote form in ${rel} lacks action="/intake/" method="get"`);
      for (const input of form.match(/<input\b[^>]*>/g) || []) {
        if (/\sname="(name|email|phone)"/.test(input) || (/\sdata-field="/.test(input) && /\sname="/.test(input))) {
          perr(`Privacy: inline form PII input has a name attribute in ${rel}`);
        }
      }
      for (const f of ['name', 'email', 'phone']) {
        if (!form.includes(`data-field="${f}"`)) perr(`Privacy: inline quote form in ${rel} has no data-field="${f}" input`);
      }
    }
  }
  // 65 are expected (product, hub and industry pages): finding none means the
  // guard has stopped seeing them, which must fail, not pass quietly.
  if (inlineForms === 0) perr('Privacy: no inline quote forms found (expected on product, hub and industry pages)');
  if (privacyErrors === 0) pass(`Privacy guards: hand-off, intake URL scrub, Meta payload, Clarity masks and ${inlineForms} inline forms checked`);
}

// Summary
console.log(`\n${errors === 0 ? '✅' : '❌'} Validation complete: ${errors} errors, ${warnings} warnings, ${htmlFiles.length} pages checked`);
process.exit(errors > 0 ? 1 : 0);
