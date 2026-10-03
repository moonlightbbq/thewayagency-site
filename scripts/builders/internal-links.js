/**
 * Internal-link modules for generated pages (priority-hubs R1-6, R1-8; LOCAL-01,
 * BLOG-03, TECH-01, MKT-04). Data: data/internal-links.json (guides, related
 * industries, nearby hubs) and data/landing-pages.json (hub and industry names).
 *
 * Every href printed here is extensionless (scripts/lib/site-urls.js canonicalHref).
 * Nothing here adds a tel:, sms: or quote link: these blocks are navigation only
 * (CONV-04 classes new contact CTAs as A/B changes).
 */
'use strict';

const { canonicalHref } = require('../lib/site-urls');

function esc(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SLUG = /^[a-z0-9-]+$/;
const MAX_GUIDES = 3;

/** slug -> { slug, label } for every city and county hub. */
function hubIndex(landingData) {
  const m = new Map();
  for (const c of (landingData && landingData.cities) || []) m.set(c.slug, { slug: c.slug, label: `${c.city}, ${c.state}` });
  for (const c of (landingData && landingData.counties) || []) m.set(c.slug, { slug: c.slug, label: `${c.county_name}, ${c.state}` });
  return m;
}

/**
 * The guides a page may link: listed for its route in internal-links.json, not
 * blocked, and built in this build (ctx.publishedBlog). At most 3.
 */
function guidesFor(route, ctx) {
  const links = (ctx && ctx.internalLinks) || {};
  const blocked = links.blocked_guides || {};
  const published = ctx && ctx.publishedBlog;
  const list = ((links.guides || {})[canonicalHref(route)] || [])
    .filter((g) => g && SLUG.test(String(g.slug)) && g.anchor && !Object.prototype.hasOwnProperty.call(blocked, g.slug))
    .filter((g) => published && published.has(g.slug));
  const seen = new Set();
  return list.filter((g) => (seen.has(g.slug) ? false : seen.add(g.slug))).slice(0, MAX_GUIDES);
}

/** "Guides" block: 1-3 links to posts, or '' when none qualifies. */
function renderGuides(route, ctx, heading = 'Guides') {
  const live = guidesFor(route, ctx);
  if (!live.length) return '';
  return `
      <section class="link-block" data-links="guides" aria-label="${esc(heading)}">
        <h2>${esc(heading)}</h2>
        <ul class="link-list">${live.map((g) => `<li><a href="/blog/${esc(g.slug)}">${esc(g.anchor)}</a></li>`).join('')}</ul>
      </section>`;
}

/** "Local help": the two priority-market hubs and the full list. No contact links. */
function renderLocalHelp() {
  return `
      <section class="link-block local-help" data-links="local-help" aria-labelledby="local-help-h">
        <h2 id="local-help-h">Local help</h2>
        <p>We work with clients in <a href="/insurance/owensboro-ky">Owensboro and Daviess County</a>, <a href="/insurance/mt-washington-ky">Mt Washington and Bullitt County</a> and <a href="/about/locations">the other areas we serve</a>.</p>
      </section>`;
}

/** "Nearby areas we serve" on a hub, from internal-links.json nearby[slug]. */
function renderNearby(slug, ctx) {
  const idx = hubIndex(ctx && ctx.landingData);
  const items = (((ctx && ctx.internalLinks) || {}).nearby || {})[slug] || [];
  const hubs = items.map((s) => idx.get(s)).filter(Boolean).filter((h) => h.slug !== slug);
  if (!hubs.length) return '';
  return `
        <section class="link-block" data-links="nearby" aria-labelledby="nearby-h">
          <h2 id="nearby-h">Nearby areas we serve</h2>
          <ul class="link-list">${hubs.map((h) => `<li><a href="/insurance/${esc(h.slug)}">Insurance in ${esc(h.label)}</a></li>`).join('')}</ul>
        </section>`;
}

function industryIndex(landingData) {
  return new Map(((landingData && landingData.industries) || []).map((i) => [i.slug, i]));
}

/** Product page: "Industries we insure for this coverage", only for listed products. */
function renderRelatedIndustries(productId, ctx) {
  const idx = industryIndex(ctx && ctx.landingData);
  const slugs = (((ctx && ctx.internalLinks) || {}).related_industries || {})[productId] || [];
  const inds = slugs.map((s) => idx.get(s)).filter(Boolean);
  if (!inds.length) return '';
  return `
      <section class="link-block" data-links="industries" aria-labelledby="related-industries-h">
        <h2 id="related-industries-h">Industries we insure for this coverage</h2>
        <ul class="link-list">${inds.map((i) => `<li><a href="/industries/${esc(i.slug)}">${esc(i.name)}</a></li>`).join('')}<li><a href="/industries/">All industries</a></li></ul>
      </section>`;
}

/** /commercial/: "Industries we insure", every industry page plus the index. */
function renderIndustriesSection(ctx) {
  const inds = (ctx && ctx.landingData && ctx.landingData.industries) || [];
  if (!inds.length) return '';
  return `
    <section class="section">
      <div class="container container--narrow">
        <section class="link-block" data-links="industries" aria-labelledby="industries-we-insure-h">
          <h2 id="industries-we-insure-h">Industries we insure</h2>
          <ul class="link-list">${inds.map((i) => `<li><a href="/industries/${esc(i.slug)}">${esc(i.name)}</a></li>`).join('')}</ul>
          <p><a href="/industries/">Business insurance by industry</a></p>
        </section>
      </div>
    </section>`;
}

module.exports = { hubIndex, guidesFor, renderGuides, renderLocalHelp, renderNearby, renderRelatedIndustries, renderIndustriesSection, MAX_GUIDES };
