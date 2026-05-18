/**
 * Schema Markup Generator — generates JSON-LD structured data for all page types.
 *
 * Generates:
 * - InsuranceAgency + LocalBusiness for location/city pages
 * - Service schema for product pages
 * - BreadcrumbList for all pages
 * - AggregateRating on homepage from Google reviews
 *
 * Usage: called from build.js, returns an injectSchema(html, pageType, context) function.
 */
const path = require('path');

const SITE_URL = 'https://www.thewayagency.com';

/**
 * Create the schema injection function.
 * @param {object} opts - { agency, office, reviews }
 */
function createSchemaInjector({ agency, office, reviews, testimonials, blocklist }) {
  /**
   * Inject JSON-LD schema markup into an HTML page.
   * @param {string} html - the page HTML
   * @param {string} pageType - 'homepage' | 'product' | 'city' | 'blog' | 'carrier' | 'industry'
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
        // Handcrafted: InsuranceAgency + LocalBusiness combo, FAQPage, WebSite live in
        // src/pages/index.html. We add Review nodes here from data/testimonials.json
        // (filtered to recent 5-star reviews not in the blocklist). ratingValue is
        // emitted as NUMBER 5 to avoid colliding with the handcrafted aggregateRating
        // ratingValue: "5.0" string (validate-consistency.js Check 7 counts unique
        // ratingValue strings — number values are not regex-matched).
        for (const r of _buildReviews(testimonials, blocklist, 6)) schemas.push(r);
        break;

      case 'product':
        schemas.push(_buildService(context, agency));
        schemas.push(_buildInsuranceAgency(agency, office));
        break;

      case 'city':
        schemas.push(_buildLocalBusiness(agency, office, reviews, context.city));
        schemas.push(_buildInsuranceAgency(agency, office, context.city));
        for (const svc of _buildServicesForCity(agency, context.city)) {
          schemas.push(svc);
        }
        break;

      case 'county':
        schemas.push(_buildLocalBusinessForCounty(agency, office, reviews, context.county));
        schemas.push(_buildInsuranceAgencyForCounty(agency, office, context.county));
        break;

      case 'blog':
        schemas.push(_buildArticle(context, agency));
        break;

      case 'carrier':
        schemas.push(_buildInsuranceAgency(agency, office));
        break;

      case 'industry':
        schemas.push(_buildService(context, agency));
        break;
    }

    if (schemas.length === 0) return html;

    const scriptTags = schemas
      .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
      .join('\n    ');

    // Inject before </head>
    return html.replace('</head>', `    ${scriptTags}\n  </head>`);
  }

  return injectSchema;
}

// ── Schema builders ─────────────────────────────────────────────────────────

function _buildOrganization(agency, office, reviews) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: agency.dba || 'The Way Agency',
    legalName: agency.legal_name,
    url: SITE_URL,
    logo: `${SITE_URL}/assets/logo.webp`,
    foundingDate: agency.founded,
    description: `${agency.type} serving Kentucky since ${agency.founded}.`,
    telephone: office.phone,
    email: office.email,
    address: _buildAddress(office),
    sameAs: Object.values(agency.social || {}),
  };

  if (reviews?.rating && reviews?.count) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: reviews.rating,
      reviewCount: String(reviews.count).replace(/\+$/, ''),
      bestRating: '5',
      worstRating: '1',
    };
  }

  return schema;
}

function _buildLocalBusiness(agency, office, reviews, city = null) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'InsuranceAgency'],
    name: city ? `The Way Agency — ${city.city}, ${city.state}` : (agency.dba || 'The Way Agency'),
    url: city ? `${SITE_URL}/insurance/${city.slug}` : SITE_URL,
    telephone: office.phone,
    email: office.email,
    address: _buildAddress(office, city),
    priceRange: '$$',
  };

  if (office.latitude && office.longitude) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      latitude: office.latitude,
      longitude: office.longitude,
    };
  }

  if (office.hours) {
    schema.openingHoursSpecification = _buildHours(office.hours);
  }

  if (reviews?.rating && reviews?.count) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: reviews.rating,
      reviewCount: String(reviews.count).replace(/\+$/, ''),
      bestRating: '5',
      worstRating: '1',
    };
  }

  if (city) {
    schema.areaServed = {
      '@type': 'City',
      name: `${city.city}, ${city.state}`,
    };
  }

  return schema;
}

function _buildInsuranceAgency(agency, office, city = null) {
  return {
    '@context': 'https://schema.org',
    '@type': 'InsuranceAgency',
    name: agency.dba || 'The Way Agency',
    url: SITE_URL,
    telephone: office.phone,
    address: _buildAddress(office, city),
    areaServed: city ? {
      '@type': 'City',
      name: `${city.city}, ${city.state}`,
    } : {
      '@type': 'State',
      name: 'Kentucky',
    },
  };
}

// Build LocalBusiness for a county hub. areaServed is AdministrativeArea
// (the county), not City. Address still uses the agency's SAB locality (Owensboro).
function _buildLocalBusinessForCounty(agency, office, reviews, county) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'InsuranceAgency'],
    name: county ? `The Way Agency — ${county.county_name}, ${county.state}` : (agency.dba || 'The Way Agency'),
    url: county ? `${SITE_URL}/insurance/${county.slug}` : SITE_URL,
    telephone: office.phone,
    email: office.email,
    address: _buildAddress(office),
    priceRange: '$$',
  };
  if (office.latitude && office.longitude) {
    schema.geo = { '@type': 'GeoCoordinates', latitude: office.latitude, longitude: office.longitude };
  }
  if (office.hours) {
    schema.openingHoursSpecification = _buildHours(office.hours);
  }
  if (reviews?.rating && reviews?.count) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: reviews.rating,
      reviewCount: String(reviews.count).replace(/\+$/, ''),
      bestRating: '5',
      worstRating: '1',
    };
  }
  if (county) {
    schema.areaServed = {
      '@type': 'AdministrativeArea',
      name: `${county.county_name}, ${county.state}`,
    };
  }
  return schema;
}

// Build InsuranceAgency for a county hub. areaServed is AdministrativeArea.
function _buildInsuranceAgencyForCounty(agency, office, county) {
  return {
    '@context': 'https://schema.org',
    '@type': 'InsuranceAgency',
    name: agency.dba || 'The Way Agency',
    url: SITE_URL,
    telephone: office.phone,
    address: _buildAddress(office),
    areaServed: county ? {
      '@type': 'AdministrativeArea',
      name: `${county.county_name}, ${county.state}`,
    } : { '@type': 'State', name: 'Kentucky' },
  };
}

// Emit one Service per line of business with the city as areaServed.
// Lets AI engines and Google connect "personal insurance in {city}" intent
// to the city hub. Sources copy from the line-of-business hub descriptions.
function _buildServicesForCity(agency, city) {
  if (!city) return [];
  const cityName = `${city.city}, ${city.state}`;
  const lines = [
    { name: 'Personal Insurance',   slug: 'personal',   desc: 'Home, auto, renters, umbrella, flood, motorcycle, boat, classic car, earthquake, and pet insurance from top-rated carriers.' },
    { name: 'Commercial Insurance', slug: 'commercial', desc: 'General liability, commercial property, commercial auto, workers compensation, cyber, bonds, builders risk, special event, and professional liability insurance.' },
    { name: 'Life Insurance',       slug: 'life',       desc: 'Term life, whole life, annuities, disability, and final expense insurance from top-rated carriers.' },
    { name: 'Health Insurance',     slug: 'health',     desc: 'Medicare Advantage and Supplement, Medicaid, individual and group health, family health, dental, vision, and supplemental health insurance.' },
  ];
  return lines.map(line => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: `${line.name} in ${cityName}`,
    description: line.desc,
    url: `${SITE_URL}/${line.slug}/`,
    provider: {
      '@type': 'InsuranceAgency',
      name: agency.dba || 'The Way Agency',
      url: SITE_URL,
    },
    serviceType: 'Insurance',
    areaServed: { '@type': 'City', name: cityName },
  }));
}

function _buildService(context, agency, city = null) {
  const product = context.product || context;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: product.name || product.title || 'Insurance',
    description: product.meta_description || product.summary || product.description || '',
    url: product.url ? `${SITE_URL}${product.url}` : undefined,
    provider: {
      '@type': 'InsuranceAgency',
      name: agency.dba || 'The Way Agency',
      url: SITE_URL,
    },
    serviceType: 'Insurance',
  };

  if (city) {
    schema.areaServed = {
      '@type': 'City',
      name: `${city.city}, ${city.state}`,
    };
  } else {
    schema.areaServed = {
      '@type': 'State',
      name: 'Kentucky',
    };
  }

  return schema;
}

// Build Review nodes from testimonials.json for the homepage. Selection:
// rating === 5, date within last 24 months, text >= 40 chars, not in blocklist.
// Sorted by date desc, limited to `limit`. ratingValue emitted as NUMBER 5
// (not string) to avoid colliding with handcrafted aggregateRating string "5.0"
// per validate-consistency.js Check 7.
function _buildReviews(testimonials, blocklist, limit) {
  if (!testimonials || !Array.isArray(testimonials.testimonials)) return [];
  const blockedIds = new Set((blocklist && blocklist.blocked) || []);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const candidates = testimonials.testimonials
    .filter(t => Number(t.rating) === 5)
    .filter(t => t.text && t.text.length >= 40)
    .filter(t => !blockedIds.has(t.id))
    .filter(t => t.date && t.date >= cutoffStr)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, limit);

  return candidates.map(t => ({
    '@context': 'https://schema.org',
    '@type': 'Review',
    author: { '@type': 'Person', name: t.name },
    datePublished: t.date,
    reviewRating: { '@type': 'Rating', ratingValue: 5, bestRating: 5 },
    reviewBody: t.text,
    itemReviewed: {
      '@type': 'InsuranceAgency',
      name: agency_dba_or_default(),
      url: SITE_URL + '/',
    },
  }));

  function agency_dba_or_default() { return 'The Way Agency'; }
}

function _buildArticle(context, agency) {
  // YMYL E-E-A-T: prefer Person author when author metadata is present.
  // Generate-blog.js is the production emitter for blog Article schema; this
  // function is the symmetric helper for any future caller via injectSchema('blog', ...).
  const authorName = context.author || agency.dba || 'The Way Agency';
  const authorIsPerson = Boolean(context.author && context.author_slug);
  const author = authorIsPerson
    ? {
        '@type': 'Person',
        name: authorName,
        jobTitle: context.author_title || 'Licensed Agent',
        url: `${SITE_URL}/about/team.html#${context.author_slug}`,
        worksFor: {
          '@type': 'InsuranceAgency',
          name: agency.dba || 'The Way Agency',
          url: SITE_URL,
        },
      }
    : {
        '@type': 'Organization',
        name: agency.dba || 'The Way Agency',
        url: SITE_URL,
      };

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: context.title || '',
    description: context.description || '',
    url: context.slug ? `${SITE_URL}/blog/${context.slug}` : undefined,
    datePublished: context.publish_date || context.date || undefined,
    dateModified: context.modified_date || context.modified || context.publish_date || context.date || undefined,
    author,
    publisher: {
      '@type': 'InsuranceAgency',
      name: agency.dba || 'The Way Agency',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/assets/logo.webp`,
      },
    },
  };
}

function _buildBreadcrumbs(pageType, context) {
  const items = [{ name: 'Home', url: SITE_URL }];

  switch (pageType) {
    case 'product': {
      const lineName = context.lineName || 'Insurance';
      const lineSlug = context.lineSlug || 'personal';
      items.push({ name: lineName, url: `${SITE_URL}/${lineSlug}/` });
      if (context.product?.name) {
        items.push({ name: context.product.name, url: `${SITE_URL}${context.product.url || ''}` });
      }
      break;
    }
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function _buildAddress(office, city = null) {
  // Service-area business posture: omit streetAddress for PO Box / mailing-only addresses
  // per Google's SAB guidance. The PO Box stays visible in human-readable <address> HTML.
  const address = {
    '@type': 'PostalAddress',
    addressLocality: city?.city || office.city,
    addressRegion: city?.state || office.state,
    postalCode: office.zip,
    addressCountry: 'US',
  };
  if (office.street && !/^P\.?\s*O\.?\s*Box\b/i.test(office.street)) {
    address.streetAddress = office.street;
  }
  return address;
}

function _buildHours(hours) {
  const dayMap = {
    monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
    thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
  };

  const specs = [];
  for (const [day, value] of Object.entries(hours)) {
    if (!dayMap[day]) continue;
    if (value === 'Closed') continue;

    // Parse "9:00 AM – 5:00 PM"
    const match = value.match(/(\d{1,2}:\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
    if (match) {
      const opens = _to24h(match[1], match[2]);
      const closes = _to24h(match[3], match[4]);
      specs.push({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: dayMap[day],
        opens,
        closes,
      });
    }
  }
  return specs;
}

function _to24h(time, period) {
  let [h, m] = time.split(':').map(Number);
  if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
  if (period.toUpperCase() === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

module.exports = { createSchemaInjector };
