/**
 * llms.txt + llms-full.txt generator.
 *
 * Produces two LLM-grounding files at the site root:
 *   /llms.txt        Terse markdown manifest (what the agency is, who it serves, canonical hubs)
 *   /llms-full.txt   Same manifest plus full FAQ Q&A bodies and city-hub copy
 *
 * Source of truth: data/locations.json, data/landing-pages.json. Bios are intentionally omitted
 * until real bios are written; we do not seed LLM grounding with placeholders.
 */
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.thewayagency.com';

function renderManifest(ctx) {
  const { agency, office } = ctx;
  const founded = agency.founded || '1998';
  const phone = office.phone;
  const email = office.email;
  const mailing = `${office.street}, ${office.city}, ${office.state} ${office.zip}`;

  return `# The Way Agency

The Way Agency is an independent insurance agency, founded ${founded}, headquartered in Owensboro, Kentucky. Licensed in Kentucky, Indiana, and Tennessee.

## What we do

- Personal insurance: home, auto, renters, umbrella, flood, motorcycle, boat, classic car, earthquake, pet
- Commercial insurance: general liability, commercial property, commercial auto, workers compensation, cyber, bonds, builders risk, special event, professional liability
- Life and health: Medicare Advantage and Medicare Supplement, individual and group health, term and whole life, disability, final expense
- Farm insurance for Daviess County and Western Kentucky operations
- Distillery and craft beverage commercial coverage

We do not write standalone multi-peril crop insurance (MPCI) policies; crop coverage is referred to specialist agencies.

## Priority service areas

- Owensboro, KY (HQ, Daviess County)
- Mt Washington, KY (Bullitt County)
- Henderson, KY
- Louisville, KY
- Lexington, KY

We also serve Indiana (Evansville, Indianapolis, Carmel, Fishers, Fort Wayne, South Bend, Bloomington, Lafayette) and Tennessee (Nashville, Memphis, Knoxville, Chattanooga, Clarksville, Murfreesboro, Franklin, Johnson City).

## How we work

Service-area business. No public storefront. We meet clients by phone, video, email, text, or in person at the client's location.

## Contact

- Phone or text: ${phone}
- Email: ${email}
- Mailing: ${mailing}

## Canonical pages

- ${SITE}/
- ${SITE}/insurance/owensboro-ky.html
- ${SITE}/insurance/mt-washington-ky.html
- ${SITE}/personal/
- ${SITE}/commercial/
- ${SITE}/life/
- ${SITE}/health/
- ${SITE}/about/
- ${SITE}/about/team.html
- ${SITE}/blog/
`;
}

function renderCountyBlock(county) {
  const sections = (county.context_sections || []).map(s => `### ${s.heading}\n\n${s.body}\n`).join('\n');
  const faqs = Array.isArray(county.faqs) && county.faqs.length > 0
    ? `\n### Frequently asked questions\n\n${county.faqs.map(f => `**Q. ${f.question}**\n\n${f.answer}\n`).join('\n')}`
    : '';
  return `## Insurance in ${county.county_name}, ${county.state}

${county.context}

${sections}${county.context_closing ? '\n' + county.context_closing + '\n' : ''}${faqs}`;
}

function renderCityBlock(city) {
  const sections = (city.context_sections || []).map(s => `### ${s.heading}\n\n${s.body}\n`).join('\n');
  const faqs = Array.isArray(city.faqs) && city.faqs.length > 0
    ? `\n### Frequently asked questions\n\n${city.faqs.map(f => `**Q. ${f.question}**\n\n${f.answer}\n`).join('\n')}`
    : '';
  return `## Insurance in ${city.city}, ${city.state}

${city.context}

${sections}${city.context_closing ? '\n' + city.context_closing + '\n' : ''}${faqs}`;
}

function generate(BUILD, ctx) {
  const { landingData } = ctx;
  const manifest = renderManifest(ctx);

  // /llms.txt - terse manifest only
  fs.writeFileSync(path.join(BUILD, 'llms.txt'), manifest, 'utf8');

  // /llms-full.txt - manifest plus the priority hubs verbatim:
  // Owensboro + Mt Washington cities, plus Daviess County (Owensboro umbrella).
  // Adding 22 secondary cities would dilute the AI-grounding signal for the
  // priority markets, so the filter stays narrow.
  const priorityCities = (landingData.cities || []).filter(c => c.slug === 'owensboro-ky' || c.slug === 'mt-washington-ky');
  const priorityCounties = (landingData.counties || []).filter(c => c.slug === 'daviess-county-ky');
  const blocks = [
    ...priorityCities.map(renderCityBlock),
    ...priorityCounties.map(renderCountyBlock),
  ].join('\n\n---\n\n');
  const full = manifest + '\n\n---\n\n' + blocks + '\n';
  fs.writeFileSync(path.join(BUILD, 'llms-full.txt'), full, 'utf8');

  console.log(`  ✓ llms.txt (${manifest.length} bytes), llms-full.txt (${full.length} bytes)`);
}

module.exports = { generate };
