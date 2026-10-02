/**
 * Schema Markup Generator: JSON-LD for the homepage and the generated pages.
 *
 * Generates:
 * - the one fully described agency node, on the homepage only
 *   (scripts/lib/entity.js agencyNode, owner facts from data/entity.json)
 * - WebPage + Service for city and county hubs. The place is named only in
 *   Service.areaServed and the provider is the agency reference (orgRef). The
 *   agency is a service-area business with no storefront, so a hub never gets
 *   a LocalBusiness node, an address, geo, hours or a rating. The names come
 *   from the rendered page itself (its <title>, H1 and card headings), so the
 *   markup follows the copy.
 * - Service for industry pages
 * - BreadcrumbList for city, county, blog, carrier and industry pages (product
 *   pages get theirs from pages.js)
 * No AggregateRating or Review: the agency's own Google rating is self-serving
 * review markup (SCHEMA-03). scripts/lib/entity-schema-guard.js fails the
 * build if any of this comes back.
 *
 * Usage: called from build.js, returns an injectSchema(html, pageType, context) function.
 */
const { SITE_URL, STATE_NAMES, orgRef, agencyNode, phoneE164 } = require('../lib/entity');

/**
 * Create the schema injection function.
 * @param {object} opts - { agency, office, entity }: data/locations.json agency
 *   and offices[0], data/entity.json
 */
function createSchemaInjector({ agency, office, entity }) {
  /**
   * Inject JSON-LD schema markup into an HTML page.
   * @param {string} html - the page HTML
   * @param {string} pageType - 'homepage' | 'product' | 'city' | 'county' | 'blog' | 'carrier' | 'industry'
   * @param {object} context - page-specific data
   * @returns {string} HTML with schema injected before </head>
   */
  function injectSchema(html, pageType, context = {}) {
    const schemas = [];

    // BreadcrumbList for all pages
    const breadcrumbs = _buildBreadcrumbs(pageType, context);
    if (breadcrumbs) schemas.push(breadcrumbs);

    // Page-type-specific schemas
    switch (pageType) {
      case 'homepage':
        // The one fully described agency node. The FAQPage and WebSite blocks
        // stay handcrafted in src/pages/index.html and refer to it by @id.
        schemas.push(agencyNode({ agency, office, entity }));
        break;

      case 'product':
        // pages.js emits the product Service (provider: orgRef()) and its
        // BreadcrumbList; nothing to add.
        break;

      case 'city':
        schemas.push(..._buildHubNodes(html, context.city, 'city', office));
        break;

      case 'county':
        schemas.push(..._buildHubNodes(html, context.county, 'county', office));
        break;

      case 'industry':
        schemas.push(_buildIndustryService(context));
        break;

      // 'carrier': the page's own Organization node names the carrier; the
      // breadcrumb is all this adds.
    }

    if (schemas.length === 0) return html;

    // '<' as \u003c, so no value can close the script element.
    const scriptTags = schemas
      .map(s => `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, '\\u003c')}</script>`)
      .join('\n    ');

    // Inject before </head>. A function replacement: a replacement string
    // would expand $$, $& and $' inside the JSON (priceRange "$$" shipped as "$").
    return html.replace('</head>', () => `    ${scriptTags}\n  </head>`);
  }

  return injectSchema;
}

// ── Schema builders ─────────────────────────────────────────────────────────

/**
 * City or county hub: one WebPage and one Service, linked by @id. The place is
 * named only in Service.areaServed and the provider is the agency reference:
 * the agency has no location in these places. Names come from the page itself:
 * WebPage.name is its <title>, Service.name its H1, serviceType its line
 * cards, and a city hub adds its county only when the page content names it.
 * Never add a street, a ZIP, coordinates, hours or priceRange here.
 */
function _buildHubNodes(html, place, kind, office) {
  if (!place) return [];
  const isCounty = kind === 'county';
  const placeName = isCounty ? place.county_name : place.city;
  const label = `${placeName}, ${place.state}`;
  const url = `${SITE_URL}/insurance/${place.slug}`;
  const page = _readPage(html);
  const state = { '@type': 'State', name: STATE_NAMES[place.state] || place.state };

  const areaServed = [{ '@type': isCounty ? 'AdministrativeArea' : 'City', name: label, containedInPlace: state }];
  // The county, where the page names it in its content (not only in the hero).
  if (!isCounty && place.county && page.mainText.includes(place.county)) {
    areaServed.push({ '@type': 'AdministrativeArea', name: `${place.county}, ${place.state}`, containedInPlace: state });
  }

  const service = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${url}#service`,
    name: page.h1 || `Insurance in ${label}`,
    ...(page.lineCards.length ? { serviceType: page.lineCards } : {}),
    url,
    provider: orgRef(),
    areaServed,
  };
  // Call and text, paired (CONTENT_RULES rule 3), when the page links both.
  const telephone = phoneE164(office.phone);
  const digits = `+${telephone.replace(/\D/g, '')}`;
  if (page.hrefs.has(`tel:${digits}`) && page.hrefs.has(`sms:${digits}`)) {
    service.availableChannel = {
      '@type': 'ServiceChannel',
      servicePhone: { '@type': 'ContactPoint', telephone },
      serviceSmsNumber: { '@type': 'ContactPoint', telephone },
    };
  }

  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    ...(page.title ? { name: page.title } : {}),
    mainEntity: { '@id': `${url}#service` },
  };
  return [webPage, service];
}

// Industry page: one Service. areaServed matches the page's own description
// (Kentucky, Indiana, and Tennessee).
function _buildIndustryService(ind) {
  const url = `${SITE_URL}/industries/${ind.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${url}#service`,
    name: `Insurance for ${ind.name}`,
    serviceType: 'Commercial insurance',
    url,
    provider: orgRef(),
    areaServed: ['KY', 'IN', 'TN'].map((s) => ({ '@type': 'State', name: STATE_NAMES[s] })),
  };
}

function _buildBreadcrumbs(pageType, context) {
  const items = [{ name: 'Home', url: SITE_URL }];

  switch (pageType) {
    case 'product':
      return null; // pages.js renderBreadcrumbs emits the one (extensionless) product trail
    case 'city':
      items.push({ name: 'Insurance', url: `${SITE_URL}/insurance/` });
      if (context.city?.city) {
        items.push({ name: `${context.city.city}, ${context.city.state}`, url: `${SITE_URL}/insurance/${context.city.slug}` });
      }
      break;
    case 'county':
      items.push({ name: 'Insurance', url: `${SITE_URL}/insurance/` });
      if (context.county?.county_name) {
        items.push({ name: `${context.county.county_name}, ${context.county.state}`, url: `${SITE_URL}/insurance/${context.county.slug}` });
      }
      break;
    case 'blog':
      items.push({ name: 'Blog', url: `${SITE_URL}/blog/` });
      if (context.title) {
        items.push({ name: context.title });
      }
      break;
    case 'carrier':
      items.push({ name: 'Carriers', url: `${SITE_URL}/carriers/` });
      if (context.name) {
        items.push({ name: context.name });
      }
      break;
    case 'industry':
      items.push({ name: 'Industries', url: `${SITE_URL}/industries/` });
      if (context.name) {
        items.push({ name: context.name });
      }
      break;
    default:
      return null; // No breadcrumbs for homepage
  }

  if (items.length < 2) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url || undefined,
    })),
  };
}

// ── Reading the rendered page ───────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', hellip: '…' };

/** Element text: tags dropped, entities decoded, whitespace collapsed. */
function _text(fragment) {
  return String(fragment || '')
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What a hub page shows: its <title>, its H1, the text of <main>, the titles
 * of the cards that link to a line of insurance (/personal/, /commercial/,
 * /life/, /health/), and every href.
 */
function _readPage(html) {
  const src = String(html || '');
  const title = _text((src.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const h1 = _text((src.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  const mainHtml = (src.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [])[1] || '';
  const lineCards = [];
  for (const m of mainHtml.matchAll(/<a\b[^>]*\bhref="\/(?:personal|commercial|life|health)\/"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const card = (m[1].match(/<h3\b[^>]*\bclass="[^"]*\bcard__title\b[^"]*"[^>]*>([\s\S]*?)<\/h3>/i) || [])[1];
    const name = _text(card);
    if (name && !lineCards.includes(name)) lineCards.push(name);
  }
  const hrefs = new Set([...src.matchAll(/\bhref="([^"]*)"/gi)].map((m) => m[1]));
  return { title, h1, mainText: _text(mainHtml), lineCards, hrefs };
}

module.exports = { createSchemaInjector, _buildHubNodes, _buildIndustryService, _readPage };
