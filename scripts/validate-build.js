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

// 3. Sitemap (TECH-04): every URL resolves, and the file is exactly what
// scripts/builders/sitemap.js renders from this build (indexable,
// self-canonical pages; true dates only), so a stale or hand-edited sitemap fails.
const { SITE_ORIGIN, routeOfFile } = require('./lib/site-urls');
const routes = new Set(htmlFiles
  .filter(f => !path.relative(BUILD, f).startsWith('src' + path.sep))
  .map(f => routeOfFile(path.relative(BUILD, f))));
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
    // A <loc> is the served URL: /foo (from foo.html) or /dir/ (from dir/index.html).
    if (!routes.has(urlPath)) {
      error(`Sitemap URL is not a served page: ${urlPath}${urlPath.endsWith('.html') ? ' (.html URLs 308 to the extensionless form)' : ''}`);
      sitemapBroken++;
    }
  }
  if (sitemapBroken === 0) pass(`All ${sitemapTotal} sitemap URLs resolve`);
  const { sitemapEntries, renderSitemap, W3C_DATE } = require('./builders/sitemap');
  const entries = sitemapEntries(BUILD);
  let sitemapProblems = 0;
  if (/<changefreq>|<priority>/.test(sitemap)) { error('Sitemap prints <changefreq> or <priority> (ignored by Google and Bing)'); sitemapProblems++; }
  for (const m of sitemap.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) {
    if (!W3C_DATE.test(m[1])) { error(`Sitemap lastmod is not a full W3C date: ${m[1]}`); sitemapProblems++; }
  }
  if (sitemap !== renderSitemap(entries)) {
    const want = new Set(entries.map(e => e.loc));
    const got = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
    const missing = [...want].filter(u => !got.has(u));
    const extra = [...got].filter(u => !want.has(u));
    error(`sitemap.xml differs from scripts/builders/sitemap.js over this build (missing ${missing.length}: ${missing.slice(0, 3).join(' ')}; extra ${extra.length}: ${extra.slice(0, 3).join(' ')}; else a lastmod differs)`);
    sitemapProblems++;
  }
  if (sitemapProblems === 0) pass(`Sitemap matches the build: ${entries.length} indexable pages, ${entries.filter(e => e.lastmod).length} with a stated lastmod, no changefreq/priority`);
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

// 7e. Blog HTML guard (sage-server BL-54, AIA-089): no built blog page carries
// "javascript:", an event-handler or srcdoc attribute or a script URL, and a
// post holds only the generator's elements and attributes and no comment. Rules:
// scripts/lib/blog-html-guard.js (dependency-free; build.js step 11a2 runs the
// same guard, which is what stops a SAGE publish push on Cloudflare).
{
  const { blogHtmlProblems } = require('./lib/blog-html-guard');
  const blogDir = path.join(BUILD, 'blog');
  let blogPages = 0;
  let blogProblems = 0;
  if (fs.existsSync(blogDir)) {
    for (const name of fs.readdirSync(blogDir).filter((n) => n.endsWith('.html'))) {
      blogPages++;
      for (const p of blogHtmlProblems(fs.readFileSync(path.join(blogDir, name), 'utf8'), `blog/${name}`, { listing: name === 'index.html' })) { error(`Blog HTML: ${p}`); blogProblems++; }
    }
  }
  if (blogPages === 0) error('Blog HTML: no built blog pages found to check (build/blog/*.html)');
  else if (blogProblems === 0) pass(`Blog HTML: ${blogPages} blog pages carry no javascript:, no event-handler attribute and no script URL; their posts hold only the generator's elements and attributes`);
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
    // The pair is mobile-menu only: a page that does not load components.css
    // (the compliance pages carry inline CSS) must hide it on desktop itself,
    // or it shows unstyled in the header and squeezes the logo.
    if (blocks.length && !/href="[^"]*\/src\/css\/components\.css/.test(html) && !/\.nav__contact\{display:none\}/.test(html)) {
      error(`Call/text pairing: ${rel} has the menu pair but neither links components.css nor carries .nav__contact{display:none}`);
      pairingProblems++;
    }
  }
  if (navPages === 0) { error('Call/text pairing: no page with #navLinks found (the nav check stopped seeing them)'); pairingProblems++; }
  if (pairingProblems === 0) pass(`Call/text pairing: every tel: link has an sms: peer to +15024135335 (${used.size} listed exemptions in use); ${navPages} menus carry the pair`);
}

// 7e2. Google rating badge (TRUST-14): every badge names Google and links to the
// listing, never the write-a-review form; the old "(N reviews)" badge text and
// any unfilled badge marker are gone. The rating is read the way the build reads
// it (googleRating): when it is null (missing or stale data) no rating text may
// survive anywhere; otherwise every visible count and rating equals the data.
// Dependency-free (CI runs this on Node 18): review-badge.js has no requires.
{
  const { googleRating } = require('./lib/review-badge');
  let rating = null;
  try {
    rating = googleRating(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'locations.json'), 'utf8')).agency);
  } catch (e) { error(`Review badge: cannot read data/locations.json (${e.message})`); }
  let badgeProblems = 0;
  let badges = 0;
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = path.relative(BUILD, file).split(path.sep).join('/');
    if (/\(\d+\+? reviews?\)/.test(html)) { error(`Review badge: ${rel} still shows "(N reviews)" without naming Google`); badgeProblems++; }
    if (html.includes('render:review-badge')) { error(`Review badge: ${rel} has an unfilled review-badge marker`); badgeProblems++; }
    const counts = [...html.matchAll(/\b(\d[\d,]*)(\+?)\s+(?:Google\s+)?reviews?\b/gi)];
    const ratings = [...html.matchAll(/\b(\d\.\d)\s+on Google\b/g)];
    if (rating === null) {
      if (counts.length || ratings.length || html.includes('review-badge__') || /\d\.\d\s*<\/strong>\s*<span[^>]*>\s*(?:&#9733;|\u2605)/.test(html)) {
        error(`Review badge: the rating is missing or stale (googleRating() is null) but ${rel} still shows rating text`); badgeProblems++;
      }
    } else {
      for (const c of counts) {
        if (c[2] || Number(c[1].replace(/,/g, '')) !== rating.count) { error(`Review badge: ${rel} shows "${c[0]}" but the data says ${rating.count} reviews`); badgeProblems++; }
      }
      for (const r of ratings) {
        if (r[1] !== rating.rating) { error(`Review badge: ${rel} shows "${r[0]}" but the data says ${rating.rating}`); badgeProblems++; }
      }
    }
    for (const m of html.matchAll(/<a class="review-badge__listing" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      badges++;
      if (/\/review\/?$/.test(m[1])) { error(`Review badge: ${rel} links the badge to the review form (${m[1]}), not the listing`); badgeProblems++; }
      if (!/\d\.\d on Google/.test(m[2])) { error(`Review badge: ${rel} has a badge that does not say "<rating> on Google"`); badgeProblems++; }
    }
  }
  if (badgeProblems === 0) {
    pass(rating === null
      ? 'Review badge: rating missing or stale, and no page shows rating or review-count text'
      : `Review badge: ${badges} badges say "on Google" and link to the listing; every visible count is ${rating.count} and every rating ${rating.rating}; no "(N reviews)" text`);
  }
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

// 9b. Redirects (TECH-07): one hop to a built page. No host rules, no .html
// or /index.html destination, no destination another rule redirects again,
// no static rule hidden below a splat that matches it first.
if (fs.existsSync(redirectsPath)) {
  const { redirectProblems } = require('./lib/url-hygiene');
  const builtFiles = new Set();
  for (const p of allPaths) if (!p.endsWith('/')) builtFiles.add(p.replace(/^\//, ''));
  const problems = redirectProblems(fs.readFileSync(redirectsPath, 'utf8'), routes, builtFiles);
  for (const p of problems) error(p);
  if (problems.length === 0) pass('Every redirect is one hop to a built page (no .html destinations, no host rules)');
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

// 11. Blog feed (TECH-05): the 20 newest rendered posts, newest first, at
// extensionless URLs; old .html guids kept with isPermaLink="false". Posts
// that scripts/lib/feed-hold.js holds (health and Medicare, until PR #63's
// corrections are live) must not appear and do not count toward the 20.
{
  const feedPath = path.join(BUILD, 'blog', 'feed.xml');
  if (fs.existsSync(feedPath)) {
    const { feedProblems } = require('./lib/url-hygiene');
    const { LEGACY_BLOG_PAGES } = require('./lib/legacy-blog-pages');
    const { feedHoldReason } = require('./lib/feed-hold');
    const metaContent = (html, prop) => [...html.matchAll(new RegExp(`<meta property="${prop}" content="([^"]*)">`, 'g'))]
      .map((x) => x[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    const posts = [];
    const held = new Set();
    for (const name of fs.readdirSync(path.join(BUILD, 'blog'))) {
      if (!name.endsWith('.html') || name === 'index.html' || Object.prototype.hasOwnProperty.call(LEGACY_BLOG_PAGES, name)) continue;
      const html = fs.readFileSync(path.join(BUILD, 'blog', name), 'utf8');
      const m = /"@type":\s*"Article"[\s\S]*?"datePublished":\s*"([^"]*)"/.exec(html);
      const slug = name.slice(0, -'.html'.length);
      const title = (metaContent(html, 'og:title')[0] || '').replace(/ \| The Way Agency$/, '');
      const category = metaContent(html, 'article:section')[0] || '';
      if (feedHoldReason({ slug, title, category, tags: metaContent(html, 'article:tag') })) { held.add(slug); continue; }
      posts.push({ slug, date: m ? m[1] : '' });
    }
    posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)));
    const feedXml = fs.readFileSync(feedPath, 'utf8');
    const problems = feedProblems(feedXml, { routes, expectedSlugs: posts.map(p => p.slug) });
    for (const slug of held) {
      if (feedXml.includes(`/blog/${slug}<`) || feedXml.includes(`/blog/${slug}.html<`)) problems.push(`feed lists ${slug}, which scripts/lib/feed-hold.js holds out until the Medicare corrections are live`);
    }
    for (const p of problems) error(p);
    if (problems.length === 0) pass(`Feed lists the ${Math.min(20, posts.length)} newest posts, newest first, at extensionless URLs (${held.size} health/Medicare posts held out)`);
  } else {
    error('blog/feed.xml not found');
  }
}

// 12. robots.txt (AEO-03 Option A): the 16 search and answer crawlers stay
// allowed and the 7 AI-training crawlers are disallowed.
{
  const robotsPath = path.join(BUILD, 'robots.txt');
  if (fs.existsSync(robotsPath)) {
    const { robotsPolicyProblems, SEARCH_AND_ANSWER_AGENTS, TRAINING_AGENTS } = require('./lib/robots-txt');
    const problems = robotsPolicyProblems(fs.readFileSync(robotsPath, 'utf8'));
    for (const p of problems) error(p);
    if (problems.length === 0) pass(`robots.txt: ${SEARCH_AND_ANSWER_AGENTS.length} search/answer crawlers allowed, ${TRAINING_AGENTS.length} training crawlers disallowed`);
  } else {
    error('robots.txt not found in build/');
  }
}

// 13. Link structure (TECH-01, LOCAL-01): one breadcrumb trail per page whose
// items are built, extensionless pages; no internal link to /insurance/<x>.html
// or /industries/<x>.html; the priority hubs and /industries/ within their
// click-depth limits and no hub or industry page orphaned. Rules:
// scripts/lib/link-structure-check.js (dependency-free).
{
  const { readSite, breadcrumbProblems, htmlHubLinkProblems, clickDepthProblems, relatedBlockedProblems } = require('./lib/link-structure-check');
  const site = readSite(BUILD);
  const crumbs = breadcrumbProblems(site);
  for (const p of crumbs) error(`Breadcrumb: ${p}`);
  if (crumbs.length === 0) pass('Breadcrumbs: one trail per page; every item a built, extensionless page');
  const htmlLinks = htmlHubLinkProblems(site);
  for (const p of htmlLinks.slice(0, 50)) error(`Hub link: ${p}`);
  if (htmlLinks.length > 50) error(`Hub link: ... and ${htmlLinks.length - 50} more`);
  if (htmlLinks.length === 0) pass('No internal links to /insurance/*.html or /industries/*.html');
  const depthProblems = clickDepthProblems(site);
  for (const p of depthProblems) error(`Click depth: ${p}`);
  if (depthProblems.length === 0) pass('Priority hubs and /industries/ within click-depth limits; no orphaned hub or industry page');
  const { LEGACY_BLOG_PAGES } = require('./lib/legacy-blog-pages');
  const blockedGuides = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'internal-links.json'), 'utf8')).blocked_guides || {});
  const relatedBlocked = relatedBlockedProblems(site, blockedGuides, new Set(Object.keys(LEGACY_BLOG_PAGES).map((f) => `blog/${f}`)));
  for (const p of relatedBlocked) error(`Related Articles: ${p}`);
  if (relatedBlocked.length === 0) pass(`Related Articles link no blocked_guides post (${blockedGuides.length} held)`);
}

// 14. No internal URL names a page by its .html file (TECH-02, url-hygiene 3.9
// "2b"). Pages 308s /x.html -> /x and /dir/index.html -> /dir/, so each such
// link, JSON-LD URL, share URL, llms URL or 404 suggestion is a redirect hop.
// Covers every built page, llms.txt and llms-full.txt, 404-suggestions.json and
// href strings in the built site JS. The feed is check 11 (its old .html guids
// stay, with isPermaLink="false"). Dependency-free (CI runs this on Node 18).
// Fix the emitter (scripts/lib/site-urls.js canonicalHref / pageUrl), or for a
// hand-made page run scripts/codemods/extensionless-links.js.
{
  const { htmlFileUrlsInHtml, htmlFileUrlsInText, mainRange } = require('./lib/url-hygiene');
  // WAITS ON OWNER D2 (OA-19): the <main> of these six compliance pages keeps
  // its .html links until the owner approves a links-only Version bump. The
  // commit that bumps them removes this exemption.
  const EXEMPT_MAIN = new Set(['privacy.html', 'terms.html', 'disclosures.html', 'privacy-notice.html', 'ai-disclosure.html', 'information-security.html']);
  const report = [];
  let exempted = 0;
  for (const file of htmlFiles) {
    const rel = path.relative(BUILD, file).split(path.sep).join('/');
    if (rel.startsWith('src/')) continue;
    const html = fs.readFileSync(file, 'utf8');
    const range = EXEMPT_MAIN.has(rel) ? mainRange(html) : null;
    const all = htmlFileUrlsInHtml(html);
    const hits = range ? htmlFileUrlsInHtml(html, { skip: [range] }) : all;
    exempted += all.length - hits.length;
    if (hits.length) report.push({ rel, hits });
  }
  for (const name of ['llms.txt', 'llms-full.txt']) {
    const f = path.join(BUILD, name);
    if (!fs.existsSync(f)) continue;
    const hits = htmlFileUrlsInText(fs.readFileSync(f, 'utf8'));
    if (hits.length) report.push({ rel: name, hits });
  }
  const sugg = path.join(BUILD, '404-suggestions.json');
  if (fs.existsSync(sugg)) {
    const { isHtmlFileUrl } = require('./lib/url-hygiene');
    let list = [];
    try { list = JSON.parse(fs.readFileSync(sugg, 'utf8')); } catch { error('404-suggestions.json is not valid JSON'); }
    const hits = (Array.isArray(list) ? list : []).filter((x) => x && isHtmlFileUrl(x.url)).map((x) => ({ kind: 'json', url: x.url }));
    if (hits.length) report.push({ rel: '404-suggestions.json', hits });
  }
  const jsDir = path.join(BUILD, 'src', 'js');
  if (fs.existsSync(jsDir)) {
    const { isHtmlFileUrl } = require('./lib/url-hygiene');
    for (const name of fs.readdirSync(jsDir).filter((n) => n.endsWith('.js'))) {
      const js = fs.readFileSync(path.join(jsDir, name), 'utf8');
      const hits = [...js.matchAll(/\bhref=\\?["']([^"'\\]+)/g)].map((m) => m[1]).filter(isHtmlFileUrl).map((url) => ({ kind: 'js', url }));
      if (hits.length) report.push({ rel: `src/js/${name}`, hits });
    }
  }
  const total = report.reduce((n, r) => n + r.hits.length, 0);
  for (const r of report.slice(0, 40)) {
    const ex = [...new Set(r.hits.map((h) => h.url))].slice(0, 3).join(', ');
    error(`Internal .html URL (308s to the extensionless page) in ${r.rel}: ${r.hits.length} (e.g. ${ex})`);
  }
  if (report.length > 40) error(`Internal .html URLs: ... and ${report.length - 40} more files`);
  if (total === 0) pass(`No internal URL names a page by its .html file${exempted ? ` (${exempted} in compliance-page <main> wait on owner D2, OA-19)` : ''}`);
}

// Summary
console.log(`\n${errors === 0 ? '✅' : '❌'} Validation complete: ${errors} errors, ${warnings} warnings, ${htmlFiles.length} pages checked`);
process.exit(errors > 0 ? 1 : 0);
