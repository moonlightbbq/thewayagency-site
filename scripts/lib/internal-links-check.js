'use strict';
/**
 * Data checks for the internal-link data (priority-hubs R1-13; LOCAL-01,
 * TECH-01, BLOG-03). Run by scripts/check-data-integrity.js in CI before the
 * build, and by tests/priority-hubs.test.js. Dependency-free (Node 18).
 *
 * Returns a list of problem strings; empty means the data is consistent.
 */
const fs = require('fs');
const path = require('path');

const TIERS = new Set(['priority', 'secondary', 'tertiary']);
const SLUG = /^[a-z0-9-]+$/;

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

/** The id generateCityPage/generateCountyPage gives a context section. */
function sectionId(s) {
  return String(s.slug || String(s.heading || '').split(/\s+/)[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Every string inside a JSON value, with its path. */
function* strings(value, at = '') {
  if (typeof value === 'string') yield [at, value];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], `${at}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, at ? `${at}.${k}` : k);
}

/** /blog/<slug> sources in _redirects: retired posts. */
function redirectedPosts(root) {
  const file = path.join(root, '_redirects');
  const out = new Set();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*\/blog\/([a-z0-9-]+)(?:\.html)?\s+\S+/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

function internalLinkProblems(root) {
  const problems = [];
  const landing = readJson(root, 'data/landing-pages.json');
  const links = readJson(root, 'data/internal-links.json');
  const locations = readJson(root, 'data/locations.json');
  const products = readJson(root, 'data/products.json');

  const hubs = new Map();
  for (const c of landing.cities || []) hubs.set(c.slug, c);
  for (const c of landing.counties || []) hubs.set(c.slug, c);
  const industries = new Set((landing.industries || []).map((i) => i.slug));
  const productIds = new Set();
  for (const list of Object.values(products)) if (Array.isArray(list)) for (const p of list) if (p && p.id) productIds.add(p.id);

  // Tiers: one field, data/locations.json hub_tiers (LOCAL-04 criterion (c)).
  for (const [slug, tier] of Object.entries(locations.hub_tiers || {})) {
    if (slug.startsWith('_')) continue;
    if (!hubs.has(slug)) problems.push(`locations.json hub_tiers: "${slug}" is not a hub in landing-pages.json`);
    if (!TIERS.has(tier)) problems.push(`locations.json hub_tiers.${slug}: "${tier}" is not priority, secondary or tertiary`);
  }
  for (const [slug, hub] of hubs) {
    if ('tier' in hub || 'market_tier' in hub) problems.push(`landing-pages.json ${slug}: tier belongs in data/locations.json hub_tiers only`);
  }

  // No internal link to the 308-redirecting .html form of a hub or industry page.
  const files = ['data/landing-pages.json', 'data/products.json', 'data/internal-links.json']
    .concat(fs.readdirSync(path.join(root, 'data')).filter((f) => /^content-.*\.json$/.test(f)).map((f) => `data/${f}`));
  for (const rel of files) {
    for (const [at, s] of strings(readJson(root, rel))) {
      const m = /href=\\?"\/(insurance|industries)\/[a-z0-9-]+\.html/.exec(s);
      if (m) problems.push(`${rel} ${at}: links the .html form of an /${m[1]}/ page (use the extensionless URL)`);
    }
  }

  // Hub sections: unique ids; fragment links resolve.
  const idsByHub = new Map();
  for (const [slug, hub] of hubs) {
    const ids = (hub.context_sections || []).map(sectionId);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) problems.push(`landing-pages.json ${slug}: duplicate context_sections id(s) ${[...new Set(dup)].join(', ')}`);
    idsByHub.set(slug, new Set(ids));
  }
  for (const rel of files) {
    for (const [at, s] of strings(readJson(root, rel))) {
      for (const m of s.matchAll(/\/insurance\/([a-z0-9-]+)(?:\.html)?#([a-z0-9-]+)/g)) {
        const ids = idsByHub.get(m[1]);
        if (!ids) problems.push(`${rel} ${at}: links /insurance/${m[1]}, which is not a hub`);
        else if (!ids.has(m[2])) problems.push(`${rel} ${at}: links /insurance/${m[1]}#${m[2]}, but that hub has no section with that id`);
      }
    }
  }

  // Guides: live source, not blocked, not retired, at most 3 per page.
  const blocked = links.blocked_guides || {};
  const retired = redirectedPosts(root);
  for (const [route, guides] of Object.entries(links.guides || {})) {
    if (!/^\/[a-z0-9/-]*$/.test(route) || /\.html$/.test(route)) problems.push(`internal-links.json guides: "${route}" is not an extensionless site path`);
    if (!Array.isArray(guides)) { problems.push(`internal-links.json guides["${route}"] is not a list`); continue; }
    if (guides.length > 3) problems.push(`internal-links.json guides["${route}"]: ${guides.length} guides (at most 3)`);
    for (const g of guides) {
      const slug = g && g.slug;
      if (!SLUG.test(String(slug))) { problems.push(`internal-links.json guides["${route}"]: bad slug ${JSON.stringify(slug)}`); continue; }
      if (!String(g.anchor || '').trim() || /click here|read more/i.test(g.anchor)) problems.push(`internal-links.json guides["${route}"] ${slug}: needs descriptive anchor text`);
      if (Object.prototype.hasOwnProperty.call(blocked, slug)) problems.push(`internal-links.json guides["${route}"] ${slug}: blocked (${blocked[slug]})`);
      if (retired.has(slug)) problems.push(`internal-links.json guides["${route}"] ${slug}: retired (a /blog/ source in _redirects)`);
      if (/medicare/.test(slug)) problems.push(`internal-links.json guides["${route}"] ${slug}: no Medicare links until the TRUST-01 TPMO statement is live (priority-hubs D16)`);
      if (!fs.existsSync(path.join(root, 'src/blog', `${slug}.md`)) && !fs.existsSync(path.join(root, 'src/pages/blog', `${slug}.html`))) {
        problems.push(`internal-links.json guides["${route}"] ${slug}: no source file in src/blog/ or src/pages/blog/`);
      }
    }
  }

  // Nearby hubs and hub labels name real hubs.
  for (const [slug, list] of Object.entries(links.nearby || {})) {
    if (!hubs.has(slug)) problems.push(`internal-links.json nearby: "${slug}" is not a hub`);
    for (const s of Array.isArray(list) ? list : []) if (!hubs.has(s)) problems.push(`internal-links.json nearby.${slug}: "${s}" is not a hub`);
  }
  for (const slug of Object.keys(links.hub_labels || {})) if (!hubs.has(slug)) problems.push(`internal-links.json hub_labels: "${slug}" is not a hub`);

  // Related industries name real products and industries.
  for (const [id, list] of Object.entries(links.related_industries || {})) {
    if (!productIds.has(id)) problems.push(`internal-links.json related_industries: "${id}" is not a product id`);
    for (const s of Array.isArray(list) ? list : []) if (!industries.has(s)) problems.push(`internal-links.json related_industries.${id}: "${s}" is not an industry`);
  }
  return problems;
}

module.exports = { internalLinkProblems, sectionId };
