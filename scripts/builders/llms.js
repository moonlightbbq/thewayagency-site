/**
 * llms.txt + llms-full.txt, generated from data (AEO-05; url-hygiene spec 3.8
 * and Appendix D, Option B; waits on owner decision url-hygiene D1 / OA-30).
 *
 *   /llms.txt       markdown manifest: who the agency is, the areas it serves,
 *                   its coverage pages, contact, team and key pages
 *   /llms-full.txt  the manifest plus the priority-tier hub copy as plain text
 *
 * Every fact comes from data: data/entity.json (legal-entity facts, licensed
 * states, founding), data/locations.json (agency name, contact, hub_tiers),
 * data/landing-pages.json (the 26 hubs), data/products.json (coverage),
 * data/team.json (names and titles shown on /about/team) and
 * src/js/business-hours.js (the one hours constant). Every URL goes through
 * scripts/lib/site-urls.js canonicalHref. Nothing here states a founding year,
 * a base city, an office, a count or a rating; scripts/lib/llms-check.js holds
 * those rules, the hub-copy gate below uses them, and validate-build.js
 * re-checks the built files.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { SITE_ORIGIN, canonicalHref } = require('../lib/site-urls');
const { STATE_NAMES } = require('../lib/entity');
const { claimProblems } = require('../lib/llms-check');
const { BUSINESS_HOURS, formatTime } = require('../../src/js/business-hours');

const abs = (p) => SITE_ORIGIN + canonicalHref(p);
const hubPath = (slug) => `/insurance/${slug}`;
const STATE_ORDER = ['KY', 'IN', 'TN'];
const LINES = [['personal', 'Personal'], ['commercial', 'Commercial'], ['life', 'Life'], ['health', 'Health']];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Key pages: hand-picked routes, each one checked against the build by validate-build.js.
const KEY_PAGES = ['/', '/about/', '/about/team', '/about/locations', '/personal/', '/commercial/', '/life/', '/health/', '/industries/', '/carriers/', '/blog/', '/contact'];

function listStates(codes) {
  const names = codes.map((c) => {
    if (!STATE_NAMES[c]) throw new Error(`llms: unknown licensed state "${c}" in data/entity.json`);
    return STATE_NAMES[c];
  });
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Every hub in landing-pages.json: 25 cities plus Daviess County. */
function allHubs(landingData) {
  const cities = (landingData.cities || []).map((c) => ({ slug: c.slug, label: `${c.city}, ${c.state}`, state: c.state, data: c }));
  const counties = (landingData.counties || []).map((c) => ({ slug: c.slug, label: `${c.county_name}, ${c.state}`, state: c.state, data: c }));
  return [...cities, ...counties];
}

function hoursLine() {
  const h = BUSINESS_HOURS;
  const days = [...h.days].sort((a, b) => a - b);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const span = contiguous && days.length > 1 ? `${DAY_NAMES[days[0]]} to ${DAY_NAMES[days[days.length - 1]]}` : days.map((d) => DAY_NAMES[d]).join(', ');
  return `${span}, ${formatTime(h.openMin)} to ${formatTime(h.closeMin)} ${h.zoneLabel}`;
}

function renderManifest(ctx) {
  const { agency, office, landingData, products, entity, locations, team } = ctx;
  const f = (entity && entity.founding) || {};
  // A founding year only when the owner documented one (TRUST-02, entity D4).
  const founded = f.date && f.evidence ? `, founded ${String(f.date).slice(0, 4)},` : '';
  const legal = agency.legal_name ? `${agency.legal_name}, doing business as ${agency.dba},` : agency.dba;
  const states = listStates((entity && entity.licensed_states) || []);
  const hubs = allHubs(landingData);
  const tiers = (locations && locations.hub_tiers) || {};
  const priority = hubs.filter((h) => tiers[h.slug] === 'priority');
  const link = (label, p) => `- [${label}](${abs(p)})`;

  const out = [];
  out.push(`# ${agency.dba}`, '');
  out.push(`> ${legal} is an independent insurance agency${founded} licensed in ${states}. It is a service-area business with no public storefront.`, '');

  if (priority.length) {
    out.push('## Priority service areas', '');
    for (const h of priority) out.push(link(h.label, hubPath(h.slug)));
    out.push('');
  }

  out.push('## Service-area pages', '');
  out.push(`The agency is licensed in ${states}. Each page below describes insurance considerations for an area it serves.`, '');
  const statesWithHubs = [...new Set(hubs.map((h) => h.state))].sort((a, b) => STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b));
  for (const st of statesWithHubs) {
    out.push(`### ${STATE_NAMES[st] || st}`, '');
    for (const h of hubs.filter((x) => x.state === st)) out.push(link(h.label, hubPath(h.slug)));
    out.push('');
  }

  out.push('## Coverage', '');
  for (const [key, label] of LINES) {
    const items = products[key] || [];
    if (!items.length) continue;
    out.push(`### ${label}`, '');
    for (const p of items) out.push(link(p.name, p.url));
    out.push('');
  }

  out.push('## Contact', '');
  out.push(`- Call or text: ${office.phone}`);
  out.push(`- Email: ${office.email}`);
  out.push(`- Hours: ${hoursLine()}`);
  out.push(`- Mailing address (mail only): ${office.street}, ${office.city}, ${office.state} ${office.zip}`);
  out.push('- Service-area business. No public storefront.', '');

  const members = (team && team.team) || [];
  if (members.length) {
    out.push('## Team', '');
    for (const m of members) out.push(`- [${m.name}](${abs('/about/team')}#${m.slug}): ${m.title}`);
    out.push('');
  }

  out.push('## Key pages', '');
  for (const p of KEY_PAGES) out.push(`- ${abs(p)}`);
  return out.join('\n') + '\n';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };

/** Hub copy as plain text: tags stripped, entities decoded, whitespace collapsed. */
function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One hub's copy, unit by unit (intro, each section, closing, each FAQ). A unit
 * that breaks a rule in llms-check.js is left out whole; it returns once the
 * hub data is corrected. Returns the block and the units left out.
 */
function renderHubBlock(hub, productNames) {
  const d = hub.data;
  const units = [];
  if (d.context) units.push({ kind: 'intro', text: plainText(d.context) });
  for (const s of d.context_sections || []) units.push({ kind: 'section', heading: plainText(s.heading), text: plainText(s.body) });
  if (d.context_closing) units.push({ kind: 'closing', text: plainText(d.context_closing) });
  for (const q of d.faqs || []) units.push({ kind: 'faq', heading: plainText(q.question), text: plainText(q.answer) });

  const kept = [];
  const omitted = [];
  for (const u of units) {
    const problems = claimProblems(`${u.heading || ''}\n${u.text}`, { productNames, prose: true });
    if (problems.length) omitted.push({ hub: hub.slug, kind: u.kind, heading: u.heading || '', rules: problems.map((p) => p.rule) });
    else kept.push(u);
  }

  const lines = [`## Insurance in ${hub.label}`, '', `Page: ${abs(hubPath(hub.slug))}`, ''];
  for (const u of kept.filter((x) => x.kind !== 'faq')) {
    if (u.heading) lines.push(`### ${u.heading}`, '');
    lines.push(u.text, '');
  }
  const faqs = kept.filter((x) => x.kind === 'faq');
  if (faqs.length) {
    lines.push('### Frequently asked questions', '');
    for (const q of faqs) lines.push(`**Q. ${q.heading}**`, '', q.text, '');
  }
  return { text: lines.join('\n').trimEnd() + '\n', omitted };
}

/** Both files' text. Pure: tests call it with data and no build directory. */
function render(ctx) {
  const manifest = renderManifest(ctx);
  const productNames = Object.values(ctx.products || {}).flat().map((p) => p.name);
  const tiers = (ctx.locations && ctx.locations.hub_tiers) || {};
  const priority = allHubs(ctx.landingData).filter((h) => tiers[h.slug] === 'priority');
  const blocks = priority.map((h) => renderHubBlock(h, productNames));
  const full = manifest + (blocks.length ? '\n---\n\n' + blocks.map((b) => b.text).join('\n---\n\n') : '');
  return { manifest, full, omitted: blocks.flatMap((b) => b.omitted) };
}

function generate(BUILD, ctx) {
  const { manifest, full, omitted } = render(ctx);
  fs.writeFileSync(path.join(BUILD, 'llms.txt'), manifest, 'utf8');
  fs.writeFileSync(path.join(BUILD, 'llms-full.txt'), full, 'utf8');
  console.log(`  ✓ llms.txt (${manifest.length} bytes), llms-full.txt (${full.length} bytes; ${omitted.length} hub paragraphs or FAQs left out by scripts/lib/llms-check.js)`);
}

module.exports = { generate, render, renderManifest, plainText, KEY_PAGES };
