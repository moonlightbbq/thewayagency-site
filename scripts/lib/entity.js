/**
 * The agency entity: one canonical JSON-LD node, one @id, one way to refer to
 * it (SCHEMA-01, SCHEMA-02; docs/CONTENT_RULES.md rule 4).
 *
 * The full node is emitted on the homepage only, by
 * scripts/builders/schema-generator.js (Google's Organization doc: the home
 * page or one page about the organization). Every other page refers to the
 * agency with orgRef(): a self-describing stub with the same @id. It is typed
 * Organization, so no page carries a LocalBusiness node without the physical
 * address that type requires.
 *
 * The agency is a service-area business with no storefront. PO Box 187,
 * Owensboro is a mailing address only. So no agency node carries a
 * streetAddress, postalCode, geo, opening hours, priceRange, aggregateRating
 * or review, and a city or county appears only as a place the agency serves
 * (Service.areaServed). scripts/lib/entity-schema-guard.js fails the build if
 * any of that comes back.
 *
 * Owner-verified facts (base locality, sameAs, founding date, mailing contact
 * point) come from data/entity.json, which SAGE's data-edit allowlist does not
 * include. This file reads no files: tests/render-review-gate.test.js runs
 * generate-blog.js from a temp tree that holds scripts/lib and three data
 * files only.
 */
'use strict';

const SITE_URL = 'https://www.thewayagency.com';
const HOME_URL = `${SITE_URL}/`;
const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const LOGO_URL = `${SITE_URL}/src/assets/images/logo-social.jpg`; // 631x631 JPEG
const AGENCY_NAME = 'The Way Agency';
const STATE_NAMES = Object.freeze({ KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' });

/** The reference every page except the homepage uses for the agency. */
function orgRef() {
  return { '@type': 'Organization', '@id': ORG_ID, name: AGENCY_NAME, url: HOME_URL };
}

/** A team member's IRI: their card on /about/team (extensionless; /about/team.html redirects). */
function teamMemberUrl(slug) {
  return `${SITE_URL}/about/team#${slug}`;
}

/** A blog post's canonical URL. */
function blogPostUrl(slug) {
  return `${SITE_URL}/blog/${slug}`;
}

/** '(502) 413-5335' -> '+1-502-413-5335' (telephone with the country code). */
function phoneE164(phone) {
  const d = String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (d.length !== 10) throw new Error(`entity: cannot read phone "${phone}"`);
  return `+1-${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * data/locations.json office.hours -> OpeningHoursSpecification[], days with
 * the same hours grouped. These are the hours the phone is answered, so they
 * go in contactPoint.hoursAvailable, never in openingHoursSpecification (which
 * says when a place is open to walk in). Owner decision 2026-10-02: Monday to
 * Friday, 9:00 AM to 5:00 PM, America/New_York. schema.org Time cannot carry
 * an IANA zone, and a fixed offset would be wrong for half the year, so the
 * times are written without one, as the site prints them.
 */
function hoursAvailable(hours) {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const to24 = (h, m, p) => `${String((Number(h) % 12) + (/pm/i.test(p) ? 12 : 0)).padStart(2, '0')}:${m}`;
  const groups = new Map();
  for (const day of days) {
    const v = hours && hours[day];
    if (!v || /^closed$/i.test(String(v).trim())) continue;
    const m = String(v).match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) throw new Error(`entity: cannot read hours for ${day}: "${v}"`);
    const key = `${to24(m[1], m[2], m[3])}|${to24(m[4], m[5], m[6])}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(day[0].toUpperCase() + day.slice(1));
  }
  return [...groups].map(([key, dayOfWeek]) => {
    const [opens, closes] = key.split('|');
    return { '@type': 'OpeningHoursSpecification', dayOfWeek, opens, closes };
  });
}

/**
 * The one fully described agency node (homepage only).
 * @param {{agency: object, office: object, entity: object}} data
 *   agency, office: data/locations.json agency and offices[0]
 *   entity: data/entity.json (owner-verified facts)
 */
function agencyNode({ agency, office, entity }) {
  const telephone = phoneE164(office.phone);
  const base = entity.base_locality || null; // entity-schema D1; null: no address at all
  const areaServed = (entity.licensed_states || []).map((s) => {
    if (!STATE_NAMES[s]) throw new Error(`entity: unknown licensed state "${s}"`);
    return { '@type': 'State', name: STATE_NAMES[s] };
  });
  const node = {
    '@context': 'https://schema.org',
    '@type': base ? 'InsuranceAgency' : 'Organization',
    '@id': ORG_ID,
    name: agency.dba,
    legalName: agency.legal_name,
    url: HOME_URL,
    logo: { '@type': 'ImageObject', url: LOGO_URL, width: 631, height: 631 },
    telephone,
    email: office.email,
    areaServed,
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'customer service',
      telephone,
      email: office.email,
      availableLanguage: 'en',
      hoursAvailable: hoursAvailable(office.hours),
    }],
  };
  if (entity.description) node.description = entity.description;
  if (entity.slogan) node.slogan = entity.slogan;
  // The base city only: never a street, a ZIP or coordinates.
  if (base) node.address = { '@type': 'PostalAddress', addressLocality: base.addressLocality, addressRegion: base.addressRegion, addressCountry: 'US' };
  // entity-schema D2: the PO box as a mailing contact point (postOfficeBoxNumber, never streetAddress).
  if (entity.mailing_contact_point) {
    node.contactPoint.push({
      '@type': 'PostalAddress',
      contactType: 'mailing address',
      postOfficeBoxNumber: String(entity.mailing_contact_point.post_office_box_number),
      addressLocality: office.city,
      addressRegion: office.state,
      postalCode: office.zip,
      addressCountry: 'US',
    });
  }
  if (Array.isArray(entity.same_as) && entity.same_as.length) node.sameAs = entity.same_as.slice(); // D3
  const f = entity.founding || {};
  if (f.date && f.evidence) node.foundingDate = String(f.date); // D4: only with its evidence
  return node;
}

module.exports = {
  SITE_URL, HOME_URL, ORG_ID, WEBSITE_ID, LOGO_URL, AGENCY_NAME, STATE_NAMES,
  orgRef, teamMemberUrl, blogPostUrl, phoneE164, hoursAvailable, agencyNode,
};
