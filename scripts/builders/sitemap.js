/**
 * Sitemap Generator
 * Generates sitemap.xml from all built pages.
 */

const fs = require('fs');
const path = require('path');

function generateSitemap(BUILD, ctx) {
  const { products, landingData, seoData, portalPages, SRC, carriers } = ctx;
  const baseUrl = 'https://www.thewayagency.com';
  const today = new Date().toISOString().split('T')[0];

  function seoLastmod(urlPath) {
    const entry = seoData.pages && seoData.pages[urlPath];
    return entry && entry.last_reviewed ? entry.last_reviewed + '-01' : null;
  }

  const lineMap = {
    personal: { name: 'Personal Insurance', slug: 'personal' },
    commercial: { name: 'Commercial Insurance', slug: 'commercial' },
    life_health: { name: 'Life & Health Insurance', slug: 'life-health' },
  };

  const sitemapUrls = [
    { url: '/', priority: '1.0', freq: 'weekly', lastmod: seoLastmod('/') },
    { url: '/personal/', priority: '0.8', freq: 'monthly', lastmod: seoLastmod('/personal/') },
    { url: '/commercial/', priority: '0.8', freq: 'monthly', lastmod: seoLastmod('/commercial/') },
    { url: '/life-health/', priority: '0.8', freq: 'monthly', lastmod: seoLastmod('/life-health/') },
    { url: '/about/', priority: '0.7', freq: 'monthly', lastmod: seoLastmod('/about/') },
    { url: '/about/team.html', priority: '0.6', freq: 'monthly', lastmod: seoLastmod('/about/team.html') },
    { url: '/about/locations.html', priority: '0.6', freq: 'monthly', lastmod: seoLastmod('/about/locations.html') },
    { url: '/blog/', priority: '0.7', freq: 'weekly', lastmod: seoLastmod('/blog/') },
    { url: '/contact.html', priority: '0.6', freq: 'monthly', lastmod: seoLastmod('/contact.html') },
  ];

  // Add all product pages
  for (const [lineKey, lineInfo] of Object.entries(lineMap)) {
    for (const product of (products[lineKey] || [])) {
      sitemapUrls.push({ url: product.url, priority: '0.7', freq: 'monthly', lastmod: product.last_reviewed ? product.last_reviewed + '-01' : null });
    }
  }

  // Add geo city pages
  for (const city of landingData.cities) {
    sitemapUrls.push({ url: `/insurance/${city.slug}.html`, priority: '0.8', freq: 'monthly' });
  }

  // Add city+product bridge pages
  for (const cityConfig of (landingData.city_products || [])) {
    for (const prod of cityConfig.products) {
      sitemapUrls.push({ url: `/insurance/${prod.slug}-${cityConfig.city_slug}.html`, priority: '0.7', freq: 'monthly' });
    }
  }

  // Add industry pages
  for (const ind of landingData.industries) {
    sitemapUrls.push({ url: `/industries/${ind.slug}.html`, priority: '0.6', freq: 'monthly' });
  }

  // Add carrier pages
  if (carriers) {
    sitemapUrls.push({ url: '/carriers/', priority: '0.6', freq: 'monthly' });
    const seenSlugs = new Set();
    for (const line of ['personal', 'commercial']) {
      for (const c of (carriers[line] || [])) {
        if (c.description && !seenSlugs.has(c.slug)) {
          seenSlugs.add(c.slug);
          sitemapUrls.push({ url: `/carriers/${c.slug}.html`, priority: '0.5', freq: 'monthly' });
        }
      }
    }
  }

  // Add blog posts
  const blogDir = path.join(BUILD, 'blog');
  if (fs.existsSync(blogDir)) {
    for (const file of fs.readdirSync(blogDir)) {
      if (file.endsWith('.html') && file !== 'index.html') {
        sitemapUrls.push({ url: `/blog/${file}`, priority: '0.5', freq: 'monthly' });
      }
    }
  }

  // Add portal pages to sitemap
  for (const page of portalPages) {
    if (page.sitemap && fs.existsSync(path.join(SRC, page.src))) {
      sitemapUrls.push({ url: page.sitemap, priority: '0.8', freq: 'monthly' });
    }
  }

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url>
    <loc>${baseUrl}${u.url}</loc>
    <lastmod>${u.lastmod || today}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  fs.writeFileSync(path.join(BUILD, 'sitemap.xml'), sitemapXml);
  console.log(`  ✓ sitemap.xml (${sitemapUrls.length} URLs)`);

  return sitemapUrls;
}

module.exports = { generateSitemap };
