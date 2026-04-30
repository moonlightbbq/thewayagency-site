#!/usr/bin/env node
/**
 * The Way Agency  -  Static Site Build Script
 *
 * Generates product pages from data/products.json,
 * copies all files to build/, and generates sitemap.xml.
 *
 * Usage: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BUILD = path.join(ROOT, 'build');
const DATA = path.join(ROOT, 'data');

function loadJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error('Failed to parse ' + path.basename(filepath) + ':', e.message);
    process.exit(1);
  }
}

// ─── Modules ────────────────────────────────────
const { createVersionInfo, createInjectVersion } = require('./builders/seo');
const assets = require('./builders/assets');
const { copyBlogPages, runBlogGenerator } = require('./builders/blog-helpers');
const { hubConfig, generateHubPage, generateProductPage, generateCityPage, generateIndustryPage, generateCarrierPage, generateCarriersIndex, setCriticalCss } = require('./builders/pages');
const { generateSitemap } = require('./builders/sitemap');
const { createSchemaInjector } = require('./builders/schema-generator');

// ─── Version / Build Info ───────────────────────
const { gitInfo, buildDate, buildVersion } = createVersionInfo(ROOT);
console.log(`\nBuild version: ${buildVersion} (branch: ${gitInfo.branch})`);

// ─── Load Data ──────────────────────────────────
const products = loadJson(path.join(DATA, 'products.json'));
const locations = loadJson(path.join(DATA, 'locations.json'));
const team = loadJson(path.join(DATA, 'team.json'));
const knowledgeBase = loadJson(path.join(DATA, 'knowledge-base.json'));
const carriers = loadJson(path.join(DATA, 'carriers.json'));
const testimonials = loadJson(path.join(DATA, 'testimonials.json'));
const seoData = loadJson(path.join(DATA, 'seo.json'));
const landingData = loadJson(path.join(DATA, 'landing-pages.json'));
const agency = locations.agency;
const office = locations.offices[0];

// Load rich content files (optional  -  graceful fallback if not yet created)
let richContent = {};
for (const file of ['content-personal.json', 'content-commercial.json', 'content-life-health.json']) {
  const fp = path.join(DATA, file);
  if (fs.existsSync(fp)) {
    Object.assign(richContent, JSON.parse(fs.readFileSync(fp, 'utf8')));
  }
}

// ─── Shared Templates ───────────────────────────
const { renderNav, renderFooter: _renderFooter, renderScripts, renderHead_GTM, renderBody_GTM } = require('./shared-templates');
const _reviews = { rating: agency.google_rating || '5.0', count: agency.google_review_count || '20+' };
function renderFooter() {
  return _renderFooter(office, _reviews);
}

// ─── Critical CSS ───────────────────────────────
let criticalCssMinified = '';
const criticalCssPath = path.join(SRC, 'css', 'critical.css');
if (fs.existsSync(criticalCssPath)) {
  const criticalCssRaw = fs.readFileSync(criticalCssPath, 'utf8');
  criticalCssMinified = assets.minifyCss(criticalCssRaw);
  setCriticalCss(criticalCssMinified);
  console.log(`  ✓ Critical CSS: ${(criticalCssMinified.length / 1024).toFixed(1)}KB (from ${(criticalCssRaw.length / 1024).toFixed(1)}KB)`);
}

// ─── Version Injection ──────────────────────────
const injectVersion = createInjectVersion({ buildVersion, gitInfo, buildDate, reviews: _reviews, renderHead_GTM, renderBody_GTM, criticalCss: criticalCssMinified });

// ─── Schema Markup ──────────────────────────────
const injectSchema = createSchemaInjector({ agency, office, reviews: _reviews });

// ─── Shared Context ─────────────────────────────
const ctx = { products, office, team, knowledgeBase, carriers, testimonials, reviews: _reviews, richContent, landingData, seoData, renderNav, renderFooter, renderScripts };

// ─── Build ──────────────────────────────────────
console.log('🔨 Building The Way Agency site...\n');

// 1. Ensure build directory + version.json
assets.ensureDir(BUILD);
assets.writeVersionJson(BUILD, {
  version: buildVersion,
  commit: gitInfo.commit,
  branch: gitInfo.branch,
  builtAt: buildDate,
});

// 2. Copy static assets
assets.copyCss(SRC, BUILD, true);
assets.copyJs(SRC, BUILD);
assets.copyAssets(SRC, BUILD);

// 3. Copy hand-crafted pages
const rootPages = assets.copyRootPages(SRC, BUILD, injectVersion);
const subPages = assets.copySubPages(SRC, BUILD, injectVersion);

// 4. Generate hub pages
for (const [lineKey, config] of Object.entries(hubConfig)) {
  const lineSlug = lineKey === 'life_health' ? 'life-health' : lineKey;
  assets.ensureDir(path.join(BUILD, lineSlug));
  const hubHtml = generateHubPage(lineKey, ctx);
  fs.writeFileSync(path.join(BUILD, lineSlug, 'index.html'), injectVersion(hubHtml));
  console.log(`  ✓ ${lineSlug}/index.html (generated from products.json)`);
}

// 5. Copy hand-crafted subdirectory pages (about, etc.) - already done in step 3

// 5b. Copy blog posts + run blog generator
copyBlogPages(SRC, BUILD, injectVersion);
runBlogGenerator(ROOT);

// 5c. Post-process blog files generated by generate-blog.js (injectVersion)
{
  const blogBuildDir = path.join(BUILD, 'blog');
  if (fs.existsSync(blogBuildDir)) {
    let versioned = 0;
    for (const file of fs.readdirSync(blogBuildDir)) {
      if (!file.endsWith('.html')) continue;
      const filePath = path.join(blogBuildDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      // Only process files that don't yet have version-busted CSS (avoids re-processing hand-crafted posts)
      if (!content.includes('?v=')) {
        fs.writeFileSync(filePath, injectVersion(content));
        versioned++;
      }
    }
    if (versioned > 0) console.log(`  ✓ Injected version params into ${versioned} generated blog posts`);
  }
}

// 6. Generate product pages
const lineMap = {
  personal: { name: 'Personal Insurance', slug: 'personal' },
  commercial: { name: 'Commercial Insurance', slug: 'commercial' },
  life_health: { name: 'Life & Health Insurance', slug: 'life-health' },
};

let generatedCount = 0;
for (const [lineKey, lineInfo] of Object.entries(lineMap)) {
  const lineProducts = products[lineKey] || [];
  assets.ensureDir(path.join(BUILD, lineInfo.slug));

  for (const product of lineProducts) {
    let html = generateProductPage(product, lineInfo.name, lineInfo.slug, lineKey, ctx);
    html = injectSchema(injectVersion(html), 'product', { product, lineName: lineInfo.name, lineSlug: lineInfo.slug });
    const filename = `${product.slug}.html`;
    fs.writeFileSync(path.join(BUILD, lineInfo.slug, filename), html);
    generatedCount++;
  }
}
console.log(`  ✓ Generated ${generatedCount} product pages from JSON`);

// 6b. Generate geo-targeted city landing pages
assets.ensureDir(path.join(BUILD, 'insurance'));
let geoCount = 0;
for (const city of landingData.cities) {
  let pageHtml = generateCityPage(city, ctx);
  pageHtml = injectSchema(injectVersion(pageHtml), 'city', { city });
  fs.writeFileSync(path.join(BUILD, 'insurance', `${city.slug}.html`), pageHtml);
  geoCount++;
}
console.log(`  ✓ Generated ${geoCount} geo-targeted city pages`);

// 6c. Generate industry landing pages
assets.ensureDir(path.join(BUILD, 'industries'));
let indCount = 0;
for (const ind of landingData.industries) {
  let indHtml = generateIndustryPage(ind, ctx);
  indHtml = injectSchema(injectVersion(indHtml), 'industry', ind);
  fs.writeFileSync(path.join(BUILD, 'industries', `${ind.slug}.html`), indHtml);
  indCount++;
}
console.log(`  ✓ Generated ${indCount} industry landing pages`);

// 6d. Generate carrier pages
assets.ensureDir(path.join(BUILD, 'carriers'));
let carrierCount = 0;
const seenCarrierSlugs = new Set();
for (const line of ['personal', 'commercial']) {
  for (const carrier of (carriers[line] || [])) {
    if (!carrier.description || seenCarrierSlugs.has(carrier.slug)) continue;
    seenCarrierSlugs.add(carrier.slug);
    let html = generateCarrierPage(carrier, line, ctx);
    html = injectSchema(injectVersion(html), 'carrier', carrier);
    fs.writeFileSync(path.join(BUILD, 'carriers', `${carrier.slug}.html`), html);
    carrierCount++;
  }
}
// Carriers index
const carriersIndexHtml = generateCarriersIndex(carriers, ctx);
fs.writeFileSync(path.join(BUILD, 'carriers', 'index.html'), injectVersion(carriersIndexHtml));
console.log(`  ✓ Generated ${carrierCount} carrier pages + index`);

// 6e. Inject homepage schema
{
  const homePath = path.join(BUILD, 'index.html');
  if (fs.existsSync(homePath)) {
    let homeHtml = fs.readFileSync(homePath, 'utf8');
    homeHtml = injectSchema(homeHtml, 'homepage');
    fs.writeFileSync(homePath, homeHtml);
    console.log('  ✓ Injected schema markup into homepage');
  }
}

// 7. Copy root files
assets.copyRootFiles(ROOT, BUILD);

// 8. Copy portal pages
const portalPages = assets.copyPortalPages(SRC, BUILD, injectVersion);

// 9. Generate sitemap
const sitemapUrls = generateSitemap(BUILD, { products, landingData, seoData, portalPages, SRC, carriers });

// 10. Generate 404 suggestions data
try {
  require('./generate-404-data');
} catch (e) {
  console.log('  ! 404 suggestions: ' + e.message);
}

console.log(`\n✅ Build complete! ${generatedCount + rootPages.length + subPages.length + portalPages.length} pages in build/`);
console.log(`   Total files: ${sitemapUrls.length} indexable URLs`);
