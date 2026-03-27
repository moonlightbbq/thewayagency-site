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
    // Check if path exists (as file or directory with index.html)
    if (!allPaths.has(href) && !allPaths.has(href.replace(/\/$/, '/index.html'))) {
      // Check if Cloudflare pretty URLs would resolve it (e.g., /about → /about/index.html)
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
    if (!allPaths.has(urlPath) && !allPaths.has(urlPath + 'index.html') && !allPaths.has(urlPath.replace(/\/$/, '/index.html'))) {
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

// Summary
console.log(`\n${errors === 0 ? '✅' : '❌'} Validation complete: ${errors} errors, ${warnings} warnings, ${htmlFiles.length} pages checked`);
process.exit(errors > 0 ? 1 : 0);
