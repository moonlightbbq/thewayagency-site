#!/usr/bin/env node
/**
 * 404 Suggestions Data Generator
 * Scans products, landing pages, and blog posts to build a keyword→URL map
 * that a 404 page can use to suggest relevant content.
 *
 * Usage: node scripts/generate-404-data.js
 * Output: build/404-suggestions.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const BUILD = path.join(ROOT, 'build');

const suggestions = [];

// Products
let products;
try {
  products = JSON.parse(fs.readFileSync(path.join(DATA, 'products.json'), 'utf8'));
} catch (e) {
  throw new Error('Failed to parse products.json: ' + e.message);
}
for (const [line, prods] of Object.entries(products)) {
  for (const p of prods) {
    const keywords = [p.name.toLowerCase(), p.slug.replace(/-/g, ' '), p.id];
    if (p.common_exclusions) keywords.push(...p.common_exclusions.map(e => e.toLowerCase().split(' ')[0]));
    suggestions.push({ url: p.url, title: p.name, keywords: [...new Set(keywords)] });
  }
}

// Landing pages (cities)
const landingData = JSON.parse(fs.readFileSync(path.join(DATA, 'landing-pages.json'), 'utf8'));
for (const city of (landingData.cities || [])) {
  suggestions.push({
    url: `/insurance/${city.slug}.html`,
    title: `Insurance in ${city.city}, ${city.state}`,
    keywords: [city.city.toLowerCase(), city.slug.replace(/-/g, ' '), city.county.toLowerCase()]
  });
}

// Industries
for (const ind of (landingData.industries || [])) {
  suggestions.push({
    url: `/industries/${ind.slug}.html`,
    title: `Insurance for ${ind.name}`,
    keywords: [ind.name.toLowerCase(), ind.slug.replace(/-/g, ' ')]
  });
}

// Blog posts (scan build/blog/)
const blogDir = path.join(BUILD, 'blog');
if (fs.existsSync(blogDir)) {
  for (const file of fs.readdirSync(blogDir)) {
    if (file.endsWith('.html') && file !== 'index.html') {
      const slug = file.replace('.html', '');
      const keywords = slug.split('-').filter(w => w.length > 3);
      const html = fs.readFileSync(path.join(blogDir, file), 'utf8');
      const titleMatch = html.match(/<title>([^|<]+)/);
      const title = titleMatch ? titleMatch[1].trim() : slug.replace(/-/g, ' ');
      suggestions.push({ url: `/blog/${file}`, title, keywords });
    }
  }
}

// Hub pages
suggestions.push({ url: '/personal/', title: 'Personal Insurance', keywords: ['personal', 'home', 'auto', 'renters'] });
suggestions.push({ url: '/commercial/', title: 'Commercial Insurance', keywords: ['commercial', 'business', 'liability'] });
suggestions.push({ url: '/life-health/', title: 'Life & Health Insurance', keywords: ['life', 'health', 'medicare', 'disability'] });
suggestions.push({ url: '/carriers/', title: 'Our Carriers', keywords: ['carriers', 'companies', 'providers'] });
suggestions.push({ url: '/about/', title: 'About Us', keywords: ['about', 'team', 'agency'] });
suggestions.push({ url: '/blog/', title: 'Insurance Blog', keywords: ['blog', 'articles', 'tips'] });
suggestions.push({ url: '/intake/', title: 'Get a Quote', keywords: ['quote', 'apply', 'start'] });
suggestions.push({ url: '/contact.html', title: 'Contact Us', keywords: ['contact', 'phone', 'email', 'call'] });

// Write output
if (!fs.existsSync(BUILD)) fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, '404-suggestions.json'), JSON.stringify(suggestions, null, 2));
console.log(`  ✓ 404-suggestions.json (${suggestions.length} entries)`);
