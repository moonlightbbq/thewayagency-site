/**
 * Local proof on the hubs (LOCAL-05; priority-hubs R2): "Who you'll work with",
 * the carriers the agency is appointed with in the hub's state, and a Google
 * rating line. Each module renders from verified data only and renders NOTHING
 * until that data exists:
 *
 * - people: a data/team.json member whose service_areas name the hub's place
 *   AND who has a `licenses` record for the hub's state with a number and a
 *   `verified_on` date that has not expired (claims PR-3, TRUST-03; spec D2, D3).
 *   No such record on anyone today, so nothing renders. Never a default agent,
 *   never the word "local", titles verbatim, no bios, no NPN, and the licence
 *   link is the official search page, never a DOI detail page (RW-D7).
 * - carriers: data/carriers.json rows with type "insurer", the hub's state in
 *   `states` and an `appointment_verified_on` date (D4, TRUST-05). Names only:
 *   no logos, no counts, no wholesalers or MGAs, no health or Medicare group (D16).
 * - rating: data/locations.json agency.google_rating and google_review_count,
 *   only when agency.google_maps_url (the listing, not the review form) is set
 *   and the sync is at most 30 days old (D5, TRUST-14), read through
 *   scripts/lib/review-badge.js googleRating. Off until the owner approves D5
 *   (HUB_RATING_LINE_APPROVED). No JSON-LD (SCHEMA-03).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { googleRating, RATING_MAX_AGE_DAYS } = require('../lib/review-badge');

const ROOT = path.resolve(__dirname, '..', '..');
const STATE_NAMES = { KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' };

// Official licence searches (RW-D7). Indiana: the owner supplies the IDOI URL.
const LICENSE_LOOKUP = {
  KY: ['https://insurance.ky.gov/ppc/Agent/Default.aspx', 'Kentucky DOI license lookup'],
  TN: ['https://sbs.naic.org/solar-external-lookup/', 'NAIC license lookup'],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function esc(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const placeKey = (s) => String(s || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

/** A licence that may be shown: the state, a number, a real verified_on date, and not expired on `today`. */
function usableLicense(member, state, today) {
  return (Array.isArray(member.licenses) ? member.licenses : []).find((l) => l
    && l.state === state
    && String(l.number || '').trim()
    && ISO_DATE.test(String(l.verified_on || ''))
    && String(l.verified_on) <= today
    && (!l.expires || (ISO_DATE.test(String(l.expires)) && String(l.expires) >= today))) || null;
}

/** Members who serve one of `places` and hold a usable licence for `state`. */
function staffForPlace(team, places, state, today) {
  const want = new Set(places.map(placeKey).filter(Boolean));
  return ((team && team.team) || [])
    .filter((m) => (m.service_areas || []).some((a) => want.has(placeKey(a))))
    .map((m) => ({ m, lic: usableLicense(m, state, today) }))
    .filter((x) => x.lic);
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join('');
}

function teamAvatar(m) {
  const photo = String(m.photo || '');
  if (photo.startsWith('/') && fs.existsSync(path.join(ROOT, photo.replace(/^\//, '')))) {
    return `<img src="${esc(photo)}" width="64" height="64" loading="lazy" alt="${esc(m.name)}" class="hub-team__photo">`;
  }
  return `<svg class="hub-team__photo" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${esc(m.name)}"><circle cx="32" cy="32" r="32" fill="#173358"/><text x="32" y="39" text-anchor="middle" font-size="22" font-family="Montserrat, sans-serif" fill="#ffffff">${esc(initials(m.name))}</text></svg>`;
}

/** The hub's place names for matching service_areas: [city, county] or [county, parent city]. */
function placesForHub(hub, landingData) {
  if (hub.county_name) {
    const parent = ((landingData && landingData.cities) || []).find((c) => c.slug === hub.parent_city_slug);
    return [hub.county_name, parent && parent.city].filter(Boolean);
  }
  return [hub.city, hub.county].filter(Boolean);
}

function renderHubTeam(hub, ctx, today = new Date().toISOString().slice(0, 10)) {
  const state = hub.state;
  const people = staffForPlace(ctx && ctx.team, placesForHub(hub, ctx && ctx.landingData), state, today);
  if (!people.length) return '';
  const label = hub.county_name || hub.city;
  const look = LICENSE_LOOKUP[state];
  return `
        <section class="hub-team" aria-labelledby="hub-team-h">
          <h2 id="hub-team-h">Who you'll work with</h2>
          <p>These licensed members of our team serve clients in ${esc(label)}.</p>
          <ul class="hub-team__list">${people.map(({ m, lic }) => `
            <li class="hub-team__person">${teamAvatar(m)}<div>
              <p class="hub-team__name"><a href="/about/team#${esc(m.slug)}">${esc(m.name)}</a></p>
              <p class="hub-team__title">${esc(m.title)}</p>
              <p class="hub-team__license">${STATE_NAMES[state] || esc(state)} license no. ${esc(lic.number)}${(lic.lines_of_authority || []).length ? ` · ${esc(lic.lines_of_authority.join(', '))}` : ''}${look ? ` · <a href="${look[0]}" rel="noopener">${look[1]}</a>` : ''}</p>
            </div></li>`).join('')}
          </ul>
        </section>`;
}

// Product ids by group. No Health or Medicare group until TRUST-01 is live (D16).
const CARRIER_GROUPS = [
  ['Home and auto', ['home', 'auto', 'renters', 'umbrella', 'flood', 'motorcycle', 'boat', 'classic-car', 'earthquake', 'condo', 'landlord', 'dwelling-fire']],
  ['Business', ['general-liability', 'commercial-property', 'commercial-auto', 'workers-compensation', 'cyber', 'bonds', 'builders-risk', 'special-event', 'professional-liability', 'bop', 'inland-marine']],
  ['Life', ['term-life', 'whole-life', 'annuities', 'disability', 'final-expense', 'life']],
];

function qualifyingCarriers(carriers, state) {
  const seen = new Map();
  for (const rows of Object.values(carriers || {})) {
    if (!Array.isArray(rows)) continue;
    for (const c of rows) {
      if (!c || !c.slug || seen.has(c.slug)) continue;
      if (c.type !== 'insurer') continue;
      if (!ISO_DATE.test(String(c.appointment_verified_on || ''))) continue;
      if (!Array.isArray(c.states) || !c.states.includes(state)) continue;
      seen.set(c.slug, c);
    }
  }
  return [...seen.values()];
}

function renderHubCarriers(hub, ctx) {
  const state = hub.state;
  const rows = qualifyingCarriers(ctx && ctx.carriers, state);
  const groups = CARRIER_GROUPS.map(([title, ids]) => [title, rows
    .filter((c) => (c.lines || []).some((l) => ids.includes(l)))
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b))]).filter(([, names]) => names.length);
  if (!groups.length) return '';
  return `
        <section class="hub-carriers" aria-labelledby="hub-carriers-h">
          <h2 id="hub-carriers-h">Insurance companies we're appointed with in ${esc(STATE_NAMES[state] || state)}</h2>
${groups.map(([title, names]) => `          <h3>${esc(title)}</h3>\n          <p>${names.map(esc).join(', ')}</p>`).join('\n')}
          <p>Which company fits depends on the coverage and the property or business.</p>
        </section>`;
}

// priority-hubs D5 (owner-actions OA-28): the owner approves the hub rating
// line's wording before it renders. The listing URL it needs now exists
// (TRUST-14), so this switch, not the data, keeps the line off until then.
const HUB_RATING_LINE_APPROVED = false;

function renderRatingLine(ctx, now = new Date(), approved = HUB_RATING_LINE_APPROVED) {
  if (!approved) return '';
  // One reader of the rating, its listing URL and its 30-day freshness (TRUST-14).
  const g = googleRating(ctx && ctx.agency, now);
  if (!g) return '';
  return `
        <p class="hub-rating">Rated ${esc(g.rating)} on Google from ${esc(g.count)} reviews · <a href="${esc(g.listingUrl)}" rel="noopener">Read the reviews on Google</a></p>`;
}

module.exports = { staffForPlace, usableLicense, placesForHub, renderHubTeam, renderHubCarriers, renderRatingLine, qualifyingCarriers, LICENSE_LOOKUP, RATING_MAX_AGE_DAYS, HUB_RATING_LINE_APPROVED };
