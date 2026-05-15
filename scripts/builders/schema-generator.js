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
function createSchemaInjector({ agency, office, reviews }) {
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
        schemas.push(_buildOrganization(agency, office, reviews));
        schemas.push(_buildLocalBusiness(agency, office, reviews));
        break;

      case 'product':
        schemas.push(_buildService(context, agency));
        schemas.push(_buildInsuranceAgency(agency, office));
        break;

      case 'city':
        schemas.push(_buildLocalBusiness(agency, office, reviews, context.city));
        schemas.push(_buildInsuranceAgency(agency, office, context.city));
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
    url: city ? `${SITE_URL}/insurance/${city.slug}.html` : SITE_URL,
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
    url: context.slug ? `${SITE_URL}/blog/${context.slug}.html` : undefined,
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
        items.push({ name: `${context.city.city}, ${context.city.state}`, url: `${SITE_URL}/insurance/${context.city.slug}.html` });
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
