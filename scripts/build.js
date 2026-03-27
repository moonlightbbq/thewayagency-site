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

// ─── Modules ────────────────────────────────────
const { createVersionInfo, createInjectVersion } = require('./builders/seo');
const assets = require('./builders/assets');
const { copyBlogPages, runBlogGenerator } = require('./builders/blog-helpers');
const { hubConfig, generateHubPage, generateProductPage, generateCityPage, generateCityProductPage, generateIndustryPage, setCriticalCss } = require('./builders/pages');
const { generateSitemap } = require('./builders/sitemap');

// ─── Version / Build Info ───────────────────────
const { gitInfo, buildDate, buildVersion } = createVersionInfo(ROOT);
console.log(`\nBuild version: ${buildVersion} (branch: ${gitInfo.branch})`);

// ─── Load Data ──────────────────────────────────
const products = JSON.parse(fs.readFileSync(path.join(DATA, 'products.json'), 'utf8'));
const locations = JSON.parse(fs.readFileSync(path.join(DATA, 'locations.json'), 'utf8'));
const team = JSON.parse(fs.readFileSync(path.join(DATA, 'team.json'), 'utf8'));
const knowledgeBase = JSON.parse(fs.readFileSync(path.join(DATA, 'knowledge-base.json'), 'utf8'));
const carriers = JSON.parse(fs.readFileSync(path.join(DATA, 'carriers.json'), 'utf8'));
const testimonials = JSON.parse(fs.readFileSync(path.join(DATA, 'testimonials.json'), 'utf8'));
const seoData = JSON.parse(fs.readFileSync(path.join(DATA, 'seo.json'), 'utf8'));
const landingData = JSON.parse(fs.readFileSync(path.join(DATA, 'landing-pages.json'), 'utf8'));
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

// ─── Shared Context ─────────────────────────────
const ctx = { products, office, team, knowledgeBase, carriers, testimonials, reviews: _reviews, richContent, landingData, renderNav, renderFooter, renderScripts };

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
    const html = generateProductPage(product, lineInfo.name, lineInfo.slug, lineKey, ctx);
    const filename = `${product.slug}.html`;
    fs.writeFileSync(path.join(BUILD, lineInfo.slug, filename), injectVersion(html));
    generatedCount++;
  }
}
console.log(`  ✓ Generated ${generatedCount} product pages from JSON`);

// 6b. Generate geo-targeted city landing pages
assets.ensureDir(path.join(BUILD, 'insurance'));
let geoCount = 0;
for (const city of landingData.cities) {
  const pageHtml = generateCityPage(city, ctx);
  fs.writeFileSync(path.join(BUILD, 'insurance', `${city.slug}.html`), injectVersion(pageHtml));
  geoCount++;
}
console.log(`  ✓ Generated ${geoCount} geo-targeted city pages`);

// 6b-2. Generate city+product bridge pages
const cityProducts = landingData.city_products || [];
let cityProductCount = 0;
for (const cityConfig of cityProducts) {
  for (const prod of cityConfig.products) {
    const html = generateCityProductPage(cityConfig, prod, ctx);
    fs.writeFileSync(path.join(BUILD, 'insurance', `${prod.slug}-${cityConfig.city_slug}.html`), injectVersion(html));
    cityProductCount++;
  }
}
console.log(`  ✓ Generated ${cityProductCount} city+product bridge pages`);

// 6c. Generate industry landing pages
assets.ensureDir(path.join(BUILD, 'industries'));
let indCount = 0;
for (const ind of landingData.industries) {
  const indHtml = generateIndustryPage(ind, ctx);
  fs.writeFileSync(path.join(BUILD, 'industries', `${ind.slug}.html`), injectVersion(indHtml));
  indCount++;
}
console.log(`  ✓ Generated ${indCount} industry landing pages`);

// 7. Copy root files
assets.copyRootFiles(ROOT, BUILD);

// 8. Copy portal pages
const portalPages = assets.copyPortalPages(SRC, BUILD, injectVersion);

// 9. Generate sitemap
const sitemapUrls = generateSitemap(BUILD, { products, landingData, seoData, portalPages, SRC });

console.log(`\n✅ Build complete! ${generatedCount + rootPages.length + subPages.length + portalPages.length} pages in build/`);
console.log(`   Total files: ${sitemapUrls.length} indexable URLs`);
