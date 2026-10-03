/**
 * Sitemap: every page the build emits that may be indexed, at its served URL
 * (TECH-04; url-hygiene spec 3.7 Step 1).
 *
 * Listed: a built .html outside build/src/, no robots noindex, and a
 * rel=canonical to its own served URL. So a noindexed, canonicalised-elsewhere
 * or removed page drops out with no change here.
 *
 * lastmod: only a full date the page itself states. Today that is a markdown
 * blog post's Article dateModified (generate-blog.js: front matter
 * `modified || date`), and /blog/, which takes the newest listed post's
 * datePublished (a new card is what changes the index). Every other page has
 * none: Google uses lastmod only if it is "consistently and verifiably
 * accurate" (Build and submit a sitemap, updated 2026-07-08), and Bing asks
 * sites never to use the sitemap's generation time. The 12 frozen hand-made
 * posts (scripts/lib/legacy-blog-pages.js) get none either: their
 * dateModified equals datePublished only because no real date of their last
 * edit is known (entity-schema D5 default), so it is not a true lastmod.
 * Google and Bing ignore changefreq and priority, so neither is printed.
 *
 * The output depends only on the built pages: two builds of one commit give
 * byte-identical files (no build time, no file mtime, code-unit sort order).
 */
const fs = require('fs');
const path = require('path');
const { SITE_ORIGIN, routeOfFile } = require('../lib/site-urls');
const { LEGACY_BLOG_PAGES } = require('../lib/legacy-blog-pages');

const W3C_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Indexable pages held out of the sitemap until the owner decides (url-hygiene
 * D4, TRUST-09): whether /about/careers/apply stays indexable, and which job
 * postings are open. They were never listed; this keeps them so. When the
 * owner rules, noindex or remove the page (it then drops out by itself) or
 * delete its line here.
 */
const HELD_FOR_OWNER = new Set([
  '/about/careers/apply',
  '/about/careers/employee-benefits-leader',
  '/about/careers/intern',
  '/about/careers/pc-insurance-agent',
]);

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function listHtml(BUILD) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byCodeUnit(a.name, b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (path.relative(BUILD, full) !== 'src') walk(full); }
      else if (e.name.endsWith('.html')) out.push(full);
    }
  })(BUILD);
  return out;
}

/** robots, canonical and the Article dates a page states. */
function pageFacts(html) {
  const robots = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(html);
  const canonical = /<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(html);
  let dateModified = null;
  let datePublished = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    for (const n of [].concat(data && data['@graph'] ? data['@graph'] : data)) {
      if (n && ['Article', 'BlogPosting'].includes(n['@type']) && W3C_DATE.test(String(n.dateModified || ''))) {
        dateModified = String(n.dateModified);
        datePublished = W3C_DATE.test(String(n.datePublished || '')) ? String(n.datePublished) : null;
      }
    }
  }
  return { noindex: Boolean(robots && /\bnoindex\b/i.test(robots[1])), canonical: canonical ? canonical[1] : null, dateModified, datePublished };
}

const isLegacyPost = (route) => route.startsWith('/blog/') && Object.prototype.hasOwnProperty.call(LEGACY_BLOG_PAGES, route.slice('/blog/'.length) + '.html');

function sitemapEntries(BUILD) {
  const entries = [];
  for (const file of listHtml(BUILD)) {
    const route = routeOfFile(path.relative(BUILD, file));
    if (route === '/404' || HELD_FOR_OWNER.has(route)) continue;
    const facts = pageFacts(fs.readFileSync(file, 'utf8'));
    if (facts.noindex || facts.canonical !== SITE_ORIGIN + route) continue;
    const dated = !isLegacyPost(route);
    entries.push({
      route,
      loc: SITE_ORIGIN + route,
      lastmod: dated ? facts.dateModified : null,
      datePublished: dated ? facts.datePublished : null,
    });
  }
  // /blog/ changes when a post is added: its lastmod is the newest listed post's datePublished.
  const newest = entries.map((e) => e.datePublished).filter(Boolean).sort().pop();
  const index = entries.find((e) => e.route === '/blog/');
  if (index && newest) index.lastmod = newest;
  return entries.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : byCodeUnit(a.route, b.route)));
}

function renderSitemap(entries) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + entries.map((e) => `  <url>\n    <loc>${e.loc}</loc>\n${e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : ''}  </url>`).join('\n')
    + '\n</urlset>\n';
}

function generateSitemap(BUILD) {
  const entries = sitemapEntries(BUILD);
  fs.writeFileSync(path.join(BUILD, 'sitemap.xml'), renderSitemap(entries));
  console.log(`  ✓ sitemap.xml (${entries.length} URLs, ${entries.filter((e) => e.lastmod).length} with lastmod)`);
  return entries;
}

module.exports = { generateSitemap, sitemapEntries, renderSitemap, pageFacts, HELD_FOR_OWNER, W3C_DATE };
