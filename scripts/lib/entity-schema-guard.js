/**
 * Entity schema guard: what the site's JSON-LD may say about the agency
 * (SCHEMA-01..04; docs/CONTENT_RULES.md rule 4).
 *
 * Pure (no fs, no packages): entitySchemaProblems(html, relPath, opts) returns
 * a list of problems, empty when the page is clean. scripts/build.js runs it
 * over build/ (step 11a: Cloudflare Pages runs build.js, so a failure keeps the
 * last good deploy live) and scripts/validate-build.js runs it in CI (7d).
 * tests/entity-schema*.test.js run it over generator output and src/.
 *
 * The owner's posture: a service-area business with no storefront. PO Box 187
 * is a mailing address only. So:
 *  - no AggregateRating or Review node anywhere (the agency's own rating is
 *    self-serving review markup);
 *  - LocalBusiness and its subtypes are reserved for the one canonical node,
 *    and only with the owner-approved base locality (data/entity.json
 *    base_locality; none approved means none allowed);
 *  - no agency node carries geo, opening hours, priceRange, a rating or
 *    reviews, a streetAddress or postalCode, or a per-location name
 *    ("The Way Agency — <City>"), and no node anywhere has the PO box as a
 *    streetAddress;
 *  - every agency node carries @id https://www.thewayagency.com/#organization,
 *    and only the homepage describes it: elsewhere a reference carries @type,
 *    @id, name and url (and sameAs/logo, as JobPosting.hiringOrganization);
 *  - foundingDate appears only as the documented date (data/entity.json
 *    founding.date with founding.evidence);
 *  - a bare {"@id": ...} must be defined on the same page;
 *  - no owner placeholder ("[OWNER VERIFY", "[LICENSED AGENT VERIFY") deploys;
 *  - every block parses.
 */
'use strict';

const ORG_ID = 'https://www.thewayagency.com/#organization';
const AGENCY_TYPES = new Set(['Organization', 'Corporation', 'LocalBusiness', 'InsuranceAgency', 'FinancialService', 'ProfessionalService']);
const LOCAL_BUSINESS_FAMILY = new Set(['LocalBusiness', 'InsuranceAgency', 'FinancialService', 'ProfessionalService']);
const FORBIDDEN_ON_AGENCY = ['geo', 'openingHoursSpecification', 'openingHours', 'priceRange', 'aggregateRating', 'review', 'reviews', 'hasMap'];
const REF_KEYS = new Set(['@context', '@type', '@id', 'name', 'url', 'sameAs', 'logo']);
const FULL_NODE_PAGES = new Set(['index.html']);
const AGENCY_NAME_RE = /^(The Way Agency|Way Associates)\b/i;
const PER_LOCATION_NAME_RE = /^The Way Agency\s*[—–-]\s*\S/;
const PO_BOX_RE = /\bP\.?\s*O\.?\s*Box\b/i;
const PLACEHOLDER_RE = /\[(OWNER|LICENSED AGENT) VERIFY/i;
// Any spelling of the tag, so a block cannot slip past by its attributes.
const LD_BLOCK_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Every ld+json block on a page: { json } or { error }, with its raw text. */
function ldBlocks(html) {
  return [...String(html).matchAll(LD_BLOCK_RE)].map((m) => {
    try { return { json: JSON.parse(m[1]), raw: m[1] }; } catch (e) { return { error: e.message, raw: m[1] }; }
  });
}

const typesOf = (n) => [].concat((n && n['@type']) || []);

/** A node that is (or claims to be) the agency itself. */
function isAgencyNode(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return false;
  if (n['@id'] === ORG_ID) return true;
  return typesOf(n).some((t) => AGENCY_TYPES.has(t)) && AGENCY_NAME_RE.test(String(n.name || ''));
}

function walk(v, visit, at = '$') {
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, visit, `${at}[${i}]`)); return; }
  if (v && typeof v === 'object') {
    visit(v, at);
    for (const [k, x] of Object.entries(v)) walk(x, visit, `${at}.${k}`);
  }
}

/** The guard's options from data/entity.json, the same way for every caller. */
function guardOptions(entity) {
  const e = entity || {};
  const f = e.founding || {};
  return {
    baseLocality: e.base_locality ? e.base_locality.addressLocality : null,
    foundingDate: f.date && f.evidence ? String(f.date) : null,
  };
}

/**
 * @param {string} html
 * @param {string} rel   path relative to build/ ('index.html', 'insurance/owensboro-ky.html', ...)
 * @param {{baseLocality?: string|null, foundingDate?: string|null}} [opts]  guardOptions(data/entity.json)
 * @returns {string[]}
 */
function entitySchemaProblems(html, rel, { baseLocality = null, foundingDate = null } = {}) {
  const out = [];
  let described = 0;
  const defined = new Set();
  const referenced = new Set();
  for (const b of ldBlocks(html)) {
    if (PLACEHOLDER_RE.test(b.raw)) out.push(`${rel}: JSON-LD carries an owner placeholder ("${b.raw.match(PLACEHOLDER_RE)[0]}"); supply the fact or drop the property`);
    if (b.error) { out.push(`${rel}: invalid JSON-LD (${b.error.slice(0, 60)})`); continue; }
    walk(b.json, (n, at) => {
      if (typeof n['@id'] === 'string') (Object.keys(n).length === 1 ? referenced : defined).add(n['@id']);
      const types = typesOf(n);
      if (types.includes('AggregateRating') || types.includes('Review')) out.push(`${rel} ${at}: ${types.join('+')} node`);
      if (typeof n.streetAddress === 'string' && PO_BOX_RE.test(n.streetAddress)) out.push(`${rel} ${at}: the PO box as a streetAddress ("${n.streetAddress}"); it is a mailing address only`);
      if (types.some((t) => LOCAL_BUSINESS_FAMILY.has(t))) {
        const loc = n.address && n.address.addressLocality;
        if (!baseLocality) out.push(`${rel} ${at}: ${types.join('+')} node, but no base locality is approved (type it Organization)`);
        else if (loc !== baseLocality) out.push(`${rel} ${at}: ${types.join('+')} with addressLocality ${JSON.stringify(loc)} (approved: ${JSON.stringify(baseLocality)})`);
      }
      if (!isAgencyNode(n)) return;
      if (PER_LOCATION_NAME_RE.test(String(n.name || ''))) out.push(`${rel} ${at}: per-location agency name "${n.name}"`);
      for (const k of FORBIDDEN_ON_AGENCY) if (k in n) out.push(`${rel} ${at}: agency node has ${k}`);
      const a = n.address;
      if (a && typeof a === 'object') {
        for (const addr of [].concat(a)) {
          if (addr && addr.streetAddress) out.push(`${rel} ${at}: agency address has streetAddress`);
          if (addr && addr.postalCode) out.push(`${rel} ${at}: agency address has postalCode`);
        }
      }
      if ('foundingDate' in n && String(n.foundingDate) !== String(foundingDate)) {
        out.push(`${rel} ${at}: agency foundingDate ${JSON.stringify(n.foundingDate)} is not the documented one (${foundingDate ? JSON.stringify(foundingDate) : 'none documented in data/entity.json'})`);
      }
      if (n['@id'] !== ORG_ID) out.push(`${rel} ${at}: agency node without @id ${ORG_ID}`);
      if (Object.keys(n).some((k) => !REF_KEYS.has(k))) described++;
    });
  }
  for (const id of referenced) if (!defined.has(id)) out.push(`${rel}: {"@id": "${id}"} is referenced but not defined on this page`);
  if (described && !FULL_NODE_PAGES.has(rel)) out.push(`${rel}: describes the agency (${described} node(s)); only ${[...FULL_NODE_PAGES].join(', ')} may, elsewhere use orgRef() (scripts/lib/entity.js)`);
  if (described > 1) out.push(`${rel}: ${described} described agency nodes (max 1)`);
  return out;
}

module.exports = { ORG_ID, entitySchemaProblems, guardOptions, ldBlocks, isAgencyNode };
