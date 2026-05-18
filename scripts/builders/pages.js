/**
 * Page Generators
 * Hub pages, product pages, city landing pages, city+product bridge pages, industry pages.
 */

const fs = require('fs');
const path = require('path');

// ─── HTML Escape Helper ────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escJson(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

// ─── Breadcrumb Helper ──────────────────────────

function renderBreadcrumbs(items) {
  // items: [{ name, url }] — last item has no url (current page)
  const htmlItems = items.map((item, i) => {
    if (i < items.length - 1) {
      return `<a href="${item.url}">${item.name}</a>`;
    }
    return `<span>${item.name}</span>`;
  }).join(' <span style="color:var(--gray);margin:0 4px;">›</span> ');

  const html = `    <nav aria-label="Breadcrumb" style="max-width:var(--max-width);margin:0 auto;padding:var(--space-md) var(--space-xl);font-size:var(--text-sm);color:var(--slate);">
      ${htmlItems}
    </nav>`;

  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": item.name,
      ...(item.url ? { "item": `https://www.thewayagency.com${item.url}` } : {})
    }))
  });

  return { html, schema };
}

// ─── Data Helpers ───────────────────────────────

function getFAQsForProduct(knowledgeBase, productId) {
  return (knowledgeBase.entries || []).filter(e => e.product === productId).slice(0, 5);
}

function getCarriersForLine(carriers, lineKey) {
  // life/health carriers fall back to personal carriers since the marquee
  // is a generic logo strip; specific L/H carrier lists can be added to
  // data/carriers.json later if we want differentiation.
  const key = (lineKey === 'life' || lineKey === 'health') ? 'personal' : lineKey;
  return carriers[key] || carriers.personal || [];
}

function generateCarrierMarquee(carriers, lineKey) {
  const lineCarriers = getCarriersForLine(carriers, lineKey);
  if (!lineCarriers.length) return '';
  const carrierItems = lineCarriers.map(c =>
    `<span class="carriers__logo">${c.name}</span>`
  ).join('\n          ');
  return `
    <section class="carriers">
      <p class="carriers__label">We represent top-rated carriers</p>
      <div style="overflow:hidden;">
        <div class="carriers__track">
          ${carrierItems}
          ${carrierItems}
        </div>
      </div>
    </section>`;
}

function getTestimonialsForLine(testimonials, lineKey) {
  const lineMap = { personal: 'personal', commercial: 'commercial', life: 'life', health: 'health' };
  const lineName = lineMap[lineKey] || 'personal';
  // Accept testimonials tagged with either the new line keys or the legacy
  // 'life_health' bucket so existing testimonial data still surfaces.
  let filtered = testimonials.testimonials.filter(t => {
    if (t.product_lines.includes(lineName)) return true;
    if ((lineName === 'life' || lineName === 'health') && t.product_lines.includes('life_health')) return true;
    return false;
  });
  if (filtered.length < 2) {
    const others = testimonials.testimonials.filter(t => !filtered.includes(t));
    filtered = [...filtered, ...others].slice(0, 3);
  }
  return filtered.slice(0, 3);
}

const starSvg = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

function generateTestimonials(testimonials, reviews, lineKey) {
  const revs = getTestimonialsForLine(testimonials, lineKey);
  if (!revs.length) return '';
  return `
    <section class="section section--light">
      <div class="container">
        <div class="section-header">
          <p class="section-header__eyebrow">What Clients Say</p>
          <h2>Real reviews from real clients</h2>
          <a href="https://g.page/r/CSHCy85xJ8VOEBM/review" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;margin-top:var(--space-sm);padding:8px 16px;background:var(--white);border:1px solid var(--border);border-radius:var(--border-radius);text-decoration:none;color:var(--charcoal);font-size:var(--text-sm);font-weight:500;">
            <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            <span style="display:flex;align-items:center;gap:4px;">
              <strong style="color:var(--navy);">${reviews.rating}</strong>
              <span style="color:#FBBC05;">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
              <span style="color:var(--slate);">(${reviews.count} reviews)</span>
            </span>
          </a>
        </div>
        <div class="grid grid--3">
          ${revs.map(r => `
          <div class="testimonial-card">
            <span class="testimonial-card__quote-mark">&ldquo;</span>
            <div class="testimonial-card__stars">${starSvg.repeat(r.rating)}</div>
            <p class="testimonial-card__text">${r.text}</p>
            <p class="testimonial-card__author">${r.name}</p>
            <p class="testimonial-card__source">${r.source === 'google' ? 'Google Review' : r.source}</p>
          </div>`).join('')}
        </div>
      </div>
    </section>`;
}

function findReviewerForProduct(team, product, lineKey) {
  const lineSpecialty = lineKey === 'personal' ? 'personal_lines'
    : lineKey === 'commercial' ? 'commercial_lines'
    : lineKey === 'life' ? 'life'
    : lineKey === 'health' ? 'health'
    : 'personal_lines';
  const match = team.team.find(member =>
    member.specialties.includes(product.id) ||
    member.specialties.includes(lineSpecialty)
  );
  return match || team.team[0];
}

// ─── Template Functions ─────────────────────────

// Critical CSS is injected by the build orchestrator via setCriticalCss()
let _criticalCssInline = '';
function setCriticalCss(css) { _criticalCssInline = css; }

function renderHead({ title, description, canonical, ogTitle, ogDescription, ogUrl, schema, robots }) {
  const cssBlock = _criticalCssInline
    ? `
  <style>${_criticalCssInline}</style>
  <link rel="stylesheet" href="/src/css/base.css" media="print" onload="this.media='all'">
  <link rel="stylesheet" href="/src/css/components.css" media="print" onload="this.media='all'">
  <link rel="stylesheet" href="/src/css/leadgen.css" media="print" onload="this.media='all'">
  <noscript><link rel="stylesheet" href="/src/css/base.css"><link rel="stylesheet" href="/src/css/components.css"><link rel="stylesheet" href="/src/css/leadgen.css"></noscript>`
    : `
  <link rel="stylesheet" href="/src/css/base.css">
  <link rel="stylesheet" href="/src/css/components.css">
  <link rel="stylesheet" href="/src/css/leadgen.css">`;

  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">${robots ? `
  <meta name="robots" content="${robots}">` : ''}
  <meta property="og:title" content="${ogTitle || title}">
  <meta property="og:description" content="${ogDescription || description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${ogUrl || canonical}">
  <meta property="og:site_name" content="The Way Agency">
  <meta property="og:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">
  <meta property="og:image:width" content="631">
  <meta property="og:image:height" content="631">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle || title}">
  <meta name="twitter:description" content="${ogDescription || description}">
  <meta name="twitter:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">
  <meta name="theme-color" content="#173358">
  <meta name="google-site-verification" content="UR_730X-tkdo6fvlzh_yGux9csokDdBhdEJANQAYlEo">
  <link rel="icon" href="/src/assets/images/favicon.png">
  <link rel="apple-touch-icon" href="/src/assets/images/apple-touch-icon.png">
  <link rel="preload" as="image" type="image/webp" href="/src/assets/images/logo-horizontal.webp">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="dns-prefetch" href="https://www.googletagmanager.com">
  <link rel="preconnect" href="https://challenges.cloudflare.com" crossorigin>
  <link rel="dns-prefetch" href="https://sage.thewayagency.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">${cssBlock}${schema ? (schema.includes('<script') ? `
  ${schema}` : `
  <script type="application/ld+json">
  ${schema}
  </script>`) : ''}
</head>`;
}

function renderHero({ eyebrow, title, subtitle, buttons, minHeight, bgStyle, variant }) {
  const height = minHeight || '40vh';
  const variantClass = variant ? ` hero--${variant}` : '';
  const eyebrowHtml = eyebrow ? `\n      <p class="hero__eyebrow">${eyebrow}</p>` : '';
  const subtitleHtml = subtitle ? `\n      <p class="hero__subtitle">${subtitle}</p>` : '';
  const bgStyleAttr = bgStyle ? ` style="${bgStyle}"` : '';
  const buttonsHtml = buttons && buttons.length > 0 ? `\n      <div class="hero__actions">\n${buttons.map(b => `        <a href="${b.href}" class="${b.className || 'btn btn--primary btn--lg'}">${b.text}</a>`).join('\n')}\n      </div>` : '';
  return `  <section class="hero${variantClass}" style="min-height:${height};">
    <div class="hero__bg"${bgStyleAttr}></div>
    <div class="hero__texture"></div>
    <div class="hero__content">${eyebrowHtml}
      <h1 class="hero__title">${title}</h1>${subtitleHtml}${buttonsHtml}
    </div>
    <div class="hero__accent"></div>
  </section>`;
}

function renderCTA({ title, text, buttons, contactMethods }, office) {
  const showContact = contactMethods !== false;
  return `    <section class="cta-banner">
      <div class="container">
        <h2 class="cta-banner__title">${title}</h2>
        <p class="cta-banner__text">${text}</p>
        <div class="cta-banner__actions">
${buttons.map(b => `          <a href="${b.href}" class="${b.className || 'btn btn--primary btn--lg'}">${b.text}</a>`).join('\n')}
        </div>${showContact ? `
        <div class="contact-methods">
          <a href="tel:+15024135335">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            ${office.phone}
          </a>
          <a href="sms:+15024135335">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Text us
          </a>
          <a href="mailto:${office.email}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Email
          </a>
        </div>` : ''}
      </div>
    </section>`;
}

function renderInlineForm(formId, hiddenFields) {
  const hiddenHtml = Object.entries(hiddenFields).map(([k, v]) =>
    `          <input type="hidden" name="${esc(k)}" value="${esc(v)}">`
  ).join('\n');
  return `        <div class="inline-quote-section">
          <h3>%%FORM_HEADING%%</h3>
          <p>%%FORM_SUBTEXT%%</p>
          <form class="inline-quote-form" novalidate>
${hiddenHtml}
            <label for="${formId}-name" class="sr-only">Your name</label>
            <input id="${formId}-name" type="text" name="name" placeholder="Your name" required autocomplete="name">
            <label for="${formId}-email" class="sr-only">Email address</label>
            <input id="${formId}-email" type="email" name="email" placeholder="Email address" required autocomplete="email">
            <label for="${formId}-phone" class="sr-only">Phone (optional)</label>
            <input id="${formId}-phone" type="tel" name="phone" placeholder="Phone (optional)" autocomplete="tel">
            <input type="text" name="_hp_company" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">
            <button type="submit">Get Quote</button>
          </form>
          <p style="font-size:11px;color:var(--slate,#64748b);margin-top:8px;text-align:center;">We never sell your data. <a href="/privacy.html" style="color:inherit;text-decoration:underline;">Privacy Policy</a></p>
        </div>`;
}

// ─── Hub Page Config ────────────────────────────

const hubConfig = {
  personal: {
    title: 'Personal Insurance | Home, Auto & More | The Way Agency',
    description: 'Personal insurance solutions: home, auto, renters, umbrella, flood, motorcycle, boat, classic car, earthquake, and pet. We represent top-rated carriers to find the right coverage and price.',
    canonical: '/personal/',
    hero: { eyebrow: 'Personal Insurance', title: 'Protection for you<br>and your family', subtitle: 'From your home and vehicles to your personal liability, we help families find the right coverage from top-rated carriers.' },
    sectionEyebrow: 'Coverage Options',
    sectionTitle: 'Personal insurance products',
    sectionDesc: 'Each product page explains what the coverage is, who needs it, what it costs, and what it doesn\'t cover, in plain language.',
    ctaTitle: 'Get a personal insurance quote',
    ctaText: 'Tell us what you need and we\'ll shop top-rated carriers for the best options.',
    crossSell: [
      { href: '/commercial/', title: 'Commercial Insurance', text: 'Liability, property, auto, workers comp, and more for your business.', label: 'Explore Commercial' },
      { href: '/life/', title: 'Life Insurance', text: 'Term life, whole life, annuities, disability, and final expense coverage.', label: 'Explore Life' },
      { href: '/health/', title: 'Health Insurance', text: 'Medicare, individual and group health, dental, vision, and supplemental coverage.', label: 'Explore Health' },
    ],
    schema: { serviceName: 'Personal Insurance', serviceType: 'Personal Lines Insurance', serviceDesc: 'Home, auto, renters, umbrella, flood, motorcycle, boat, classic car, earthquake, and pet insurance for families and individuals.' },
  },
  commercial: {
    title: 'Commercial Insurance | The Way Agency',
    description: 'Commercial insurance for businesses: general liability, property, auto, workers comp, cyber, bonds, builders risk, special events, and professional liability from top-rated carriers.',
    canonical: '/commercial/',
    hero: { eyebrow: 'Commercial Insurance', title: 'Protection that lets<br>your business grow', subtitle: 'From general liability to workers comp, we help businesses build coverage that matches real risk and real operations.' },
    sectionEyebrow: 'Coverage Options',
    sectionTitle: 'Commercial insurance products',
    sectionDesc: 'Each product page explains who needs the coverage, what it protects against, what it costs, and what it does not cover.',
    ctaTitle: 'Get a commercial insurance quote',
    ctaText: 'Tell us about your business and we\'ll build a coverage program from top-rated carriers.',
    crossSell: [
      { href: '/personal/', title: 'Personal Insurance', text: 'Home, auto, umbrella, and specialty coverage for you and your family.', label: 'Explore Personal' },
      { href: '/life/', title: 'Life Insurance', text: 'Term life, whole life, annuities, disability, and final expense coverage.', label: 'Explore Life' },
      { href: '/health/', title: 'Health Insurance', text: 'Medicare, group and individual health, dental, and supplemental coverage.', label: 'Explore Health' },
    ],
    schema: { serviceName: 'Commercial Insurance', serviceType: 'Commercial Lines Insurance', serviceDesc: 'General liability, property, auto, workers comp, cyber, bonds, builders risk, special events, and professional liability for businesses.' },
  },
  life: {
    title: 'Life Insurance | Term, Whole, Annuities & More | The Way Agency',
    description: 'Life insurance and lifetime protection: term life, whole life, annuities, disability, and final expense from top-rated carriers.',
    canonical: '/life/',
    hero: { eyebrow: 'Life Insurance', title: 'Plan for what<br>matters most', subtitle: 'Term life, whole life, annuities, disability, and final expense. We help you navigate the options and choose with confidence.' },
    ctaTitle: 'Get a life insurance quote',
    ctaText: 'Tell us what you need and we\'ll walk you through your options in plain language.',
    crossSell: [
      { href: '/health/', title: 'Health Insurance', text: 'Medicare, individual and group health, dental, vision, and supplemental coverage.', label: 'Explore Health' },
      { href: '/personal/', title: 'Personal Insurance', text: 'Home, auto, umbrella, and specialty coverage for you and your family.', label: 'Explore Personal' },
    ],
    schema: { serviceName: 'Life Insurance', serviceType: 'Life Insurance', serviceDesc: 'Term life, whole life, annuities, disability, and final expense insurance for individuals and families.' },
    groups: [
      { eyebrow: 'Life & Income Protection', title: 'Life and income protection', ids: ['term-life', 'whole-life', 'annuities', 'disability', 'final-expense'] },
    ],
  },
  health: {
    title: 'Health Insurance | Medicare, Individual, Group & More | The Way Agency',
    description: 'Health insurance and supplemental coverage: Medicare, Medicaid, individual and group health, family health, dental, vision, and supplemental from top-rated carriers.',
    canonical: '/health/',
    hero: { eyebrow: 'Health Insurance', title: 'Coverage built<br>around your care', subtitle: 'Medicare, Medicaid, individual and group health, dental, vision, and supplemental coverage. We help you navigate the options and choose with confidence.' },
    ctaTitle: 'Get a health insurance quote',
    ctaText: 'Tell us what you need and we\'ll walk you through your options in plain language.',
    crossSell: [
      { href: '/life/', title: 'Life Insurance', text: 'Term life, whole life, annuities, disability, and final expense coverage.', label: 'Explore Life' },
      { href: '/personal/', title: 'Personal Insurance', text: 'Home, auto, umbrella, and specialty coverage for you and your family.', label: 'Explore Personal' },
    ],
    schema: { serviceName: 'Health Insurance', serviceType: 'Health Insurance', serviceDesc: 'Medicare, Medicaid, individual and group health, family health, dental, vision, and supplemental health coverage for individuals, families, and small businesses.' },
    groups: [
      { eyebrow: 'Health Coverage', title: 'Health insurance options', ids: ['medicare', 'medicaid', 'supplemental-health', 'group-health', 'individual-health', 'family-health', 'dental-vision'] },
    ],
  },
};

// ─── Hub Page Generator ─────────────────────────

function generateHubPage(lineKey, ctx) {
  const { products, office, seoData, renderNav, renderFooter, renderScripts } = ctx;
  const config = hubConfig[lineKey];
  // line key === slug now that life/health are separate top-level keys
  const lineSlug = lineKey;
  const lineProducts = products[lineKey] || [];

  const arrowSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';

  function productCard(p) {
    return `          <a href="${p.url}" class="card" style="text-decoration:none;">
            <h3 class="card__title">${p.name}</h3>
            <p class="card__text">${p.summary.split('.').slice(0, 2).join('.') + '.'}</p>
            <span class="card__link">Learn more ${arrowSvg}</span>
          </a>`;
  }

  let productSections;
  if (config.groups) {
    productSections = config.groups.map((group, i) => {
      const groupProducts = group.ids.map(id => lineProducts.find(p => p.slug === id)).filter(Boolean);
      return `
    <section class="section${i % 2 === 1 ? ' section--light' : ''}">
      <div class="container">
        <div class="section-header">
          <p class="section-header__eyebrow">${group.eyebrow}</p>
          <h2>${group.title}</h2>
        </div>
        <div class="grid grid--3">
${groupProducts.map(p => productCard(p)).join('\n')}
        </div>
      </div>
    </section>`;
    }).join('\n');
  } else {
    productSections = `
    <section class="section">
      <div class="container">
        <div class="section-header">
          <p class="section-header__eyebrow">${config.sectionEyebrow}</p>
          <h2>${config.sectionTitle}</h2>
          <p>${config.sectionDesc}</p>
        </div>
        <div class="grid grid--3">
${lineProducts.map(p => productCard(p)).join('\n')}
        </div>
      </div>
    </section>`;
  }

  const crossSellCards = config.crossSell.map(cs => `          <a href="${cs.href}" class="card" style="text-decoration:none;text-align:center;">
            <h3 class="card__title">${cs.title}</h3>
            <p class="card__text">${cs.text}</p>
            <span class="card__link">${cs.label} ${arrowSvg}</span>
          </a>`).join('\n');

  const hubBreadcrumbs = renderBreadcrumbs([
    { name: 'Home', url: '/' },
    { name: config.hero.eyebrow },
  ]);

  return `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: config.title,
    description: config.description,
    canonical: `https://www.thewayagency.com${config.canonical}`,
    ogTitle: config.title,
    ogDescription: config.description,
    ogUrl: `https://www.thewayagency.com${config.canonical}`,
    schema: `<script type="application/ld+json">
  ${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "InsuranceAgency",
      "name": "The Way Agency",
      "legalName": "Way Associates, Inc",
      "url": "https://www.thewayagency.com",
      "telephone": office.phone,
      "email": office.email,
      "address": { "@type": "PostalAddress", "streetAddress": office.street, "addressLocality": office.city, "addressRegion": office.state, "postalCode": office.zip },
      "areaServed": [{ "@type": "State", "name": "Kentucky" }, { "@type": "State", "name": "Indiana" }, { "@type": "State", "name": "Tennessee" }],
      "sameAs": (seoData && seoData.social_profiles) || [],
      "makesOffer": { "@type": "Offer", "itemOffered": { "@type": "Service", "name": config.schema.serviceName, "serviceType": config.schema.serviceType, "description": config.schema.serviceDesc } }
    }, null, 2)}
  </script>
  <script type="application/ld+json">
  ${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": config.hero.eyebrow + " Products",
      "itemListElement": lineProducts.map((p, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "name": p.name,
        "url": `https://www.thewayagency.com${p.url}`
      }))
    }, null, 2)}
  </script>
  <script type="application/ld+json">
  ${hubBreadcrumbs.schema}
  </script>`,
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: config.hero.eyebrow,
    title: config.hero.title,
    subtitle: config.hero.subtitle,
    buttons: [{ href: `/intake/?line=${lineSlug}`, text: `Get a ${config.hero.eyebrow} Quote`, className: 'btn btn--primary btn--lg' }],
    minHeight: '38vh',
    variant: 'compact',
  })}

${hubBreadcrumbs.html}
  <main id="main">
${productSections}

    <!-- Cross-sell -->
    <section class="section section--light">
      <div class="container">
        <div class="section-header">
          <p class="section-header__eyebrow">Also Available</p>
          <h2>Need other coverage?</h2>
        </div>
        <div class="grid grid--2" style="max-width:800px;margin:0 auto;">
${crossSellCards}
        </div>
      </div>
    </section>

${renderCTA({
    title: config.ctaTitle,
    text: config.ctaText,
    buttons: [
      { href: `/intake/?line=${lineSlug}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
      { href: '/contact.html', text: 'Request a Coverage Review', className: 'btn btn--outline-white btn--lg' },
    ],
  }, office)}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

// ─── Product Page Template ──────────────────────

function generateProductPage(product, lineName, lineSlug, lineKey, ctx) {
  const { products, office, team, knowledgeBase, carriers, testimonials, reviews, richContent, seoData, renderNav, renderFooter, renderScripts } = ctx;
  const rc = richContent[product.id] || {};
  const faqs = rc.faqs || [];
  const kbFaqs = getFAQsForProduct(knowledgeBase, product.id);
  const allFaqs = [...faqs];
  for (const kb of kbFaqs) {
    if (!allFaqs.some(f => f.question === kb.question)) {
      allFaqs.push({ question: kb.question, answer: kb.answer });
    }
  }
  const displayFaqs = allFaqs.slice(0, 5);

  const directAnswerSection = rc.direct_answer ? `
      <p class="text-lg" style="font-size:var(--text-lg);line-height:1.8;margin-bottom:var(--space-xl);">${rc.direct_answer}</p>` : `
      <p class="text-lg" style="font-size:var(--text-lg);line-height:1.8;margin-bottom:var(--space-xl);">${product.summary}</p>`;

  const whoNeedsSection = rc.who_needs_it ? `
      <h2>Who needs ${product.name.toLowerCase()}?</h2>
      <p>${rc.who_needs_it}</p>` : (product.requirement ? `
      <h2>Is ${product.name.toLowerCase()} required?</h2>
      <p>${product.requirement}</p>` : '');

  const coversSection = rc.what_it_covers && rc.what_it_covers.length > 0 ? `
      <h2>What does ${product.name.toLowerCase()} cover?</h2>
      <ul class="coverage-list">
        ${rc.what_it_covers.map(c => `<li>${c}</li>`).join('\n        ')}
      </ul>` : '';

  const doesntCoverSection = (rc.what_it_doesnt_cover && rc.what_it_doesnt_cover.length > 0) ? `
      <h2>What ${product.name.toLowerCase()} does NOT cover</h2>
      <ul class="exclusion-list">
        ${rc.what_it_doesnt_cover.map(e => `<li>${e}</li>`).join('\n        ')}
      </ul>` : (product.common_exclusions && product.common_exclusions.length > 0 ? `
      <h2>What ${product.name.toLowerCase()} does NOT cover</h2>
      <ul class="exclusion-list">
        ${product.common_exclusions.map(e => `<li>${e}</li>`).join('\n        ')}
      </ul>` : '');

  const costSection = rc.cost_narrative ? `
      <h2>What does ${product.name.toLowerCase()} cost?</h2>
      <p>${rc.cost_narrative}</p>` : (product.typical_cost_range ? `
      <h2>What does ${product.name.toLowerCase()} cost?</h2>
      <p>
        In our experience: <strong>${product.typical_cost_range}</strong>.
        ${product.cost_factors ? 'Key factors that affect your premium include: ' + product.cost_factors.join(', ') + '.' : ''}
        As an independent agency, we represent top-rated carriers and match you with the right one for your situation.
      </p>` : '');

  const faqSection = displayFaqs.length > 0 ? `
      <section class="faq-section" style="margin-top:var(--space-2xl);">
        <h2>Frequently asked questions</h2>
        ${displayFaqs.map(f => `
        <div class="faq-item">
          <button class="faq-item__question" aria-expanded="false">
            <h3 style="margin:0;font-size:var(--text-lg);pointer-events:none;">${f.question}</h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;transition:transform 0.2s;pointer-events:none;"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="faq-item__answer">
            <p>${f.answer}</p>
          </div>
        </div>`).join('')}
      </section>` : '';

  const faqSchema = displayFaqs.length > 0 ? `
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      ${displayFaqs.map(f => `{
        "@type": "Question",
        "name": ${JSON.stringify(f.question)},
        "acceptedAnswer": {
          "@type": "Answer",
          "text": ${JSON.stringify(f.answer)}
        }
      }`).join(',\n      ')}
    ]
  }
  </script>` : '';

  const allProducts = [...(products.personal || []), ...(products.commercial || []), ...(products.life || []), ...(products.health || [])];
  const relatedLinks = (product.related_products || []).map(rId => {
    const rp = allProducts.find(p => p.id === rId);
    if (!rp) return '';
    return `<li><a href="${rp.url}"><strong>${rp.name}</strong></a>  -  ${rp.summary ? rp.summary.split('.')[0] + '.' : ''}</li>`;
  }).filter(Boolean).join('\n        ');

  const allLines = {
    personal:   { name: 'Personal Insurance',   text: 'Home, auto, umbrella, and specialty coverage for you and your family.', link: '/personal/', label: 'Explore Personal' },
    commercial: { name: 'Commercial Insurance', text: 'General liability, commercial property, workers\' comp, and more for your business.', link: '/commercial/', label: 'Explore Commercial' },
    life:       { name: 'Life Insurance',       text: 'Term life, whole life, annuities, disability, and final expense coverage.', link: '/life/', label: 'Explore Life' },
    health:     { name: 'Health Insurance',     text: 'Medicare, individual and group health, dental, vision, and supplemental coverage.', link: '/health/', label: 'Explore Health' },
  };
  const otherLines = Object.entries(allLines).filter(([key]) => key !== lineKey).map(([, info]) => info);

  const relatedSection = relatedLinks ? `
      <h2>Related coverage to consider</h2>
      <ul>
        ${relatedLinks}
      </ul>
      <p><a href="/${lineSlug}/">Browse all ${lineName} options</a></p>` : '';

  const crossSellSection = `
      <section class="section section--light" style="margin-top:var(--space-2xl);">
        <div class="container">
          <div class="section-header">
            <p class="section-header__eyebrow">Also Available</p>
            <h2>Need other coverage?</h2>
          </div>
          <div class="grid grid--2" style="max-width:800px;margin:0 auto;">
            ${otherLines.map(line => `<a href="${line.link}" class="card" style="text-decoration:none;text-align:center;">
              <h3 class="card__title">${line.name}</h3>
              <p class="card__text">${line.text}</p>
              <span class="card__link">${line.label} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>
            </a>`).join('\n            ')}
          </div>
        </div>
      </section>`;

  const socialProfiles = (seoData && seoData.social_profiles) || [];
  const serviceSchema = `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "${product.name}",
    "serviceType": "${product.name}",
    "provider": {
      "@type": "InsuranceAgency",
      "name": "The Way Agency",
      "url": "https://www.thewayagency.com",
      "telephone": "${office.phone}",
      "sameAs": ${JSON.stringify(socialProfiles)},
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "${office.street}",
        "addressLocality": "${office.city}",
        "addressRegion": "${office.state}",
        "postalCode": "${office.zip}"
      }
    },
    "areaServed": [
      { "@type": "State", "name": "Kentucky" },
      { "@type": "State", "name": "Indiana" },
      { "@type": "State", "name": "Tennessee" }
    ],
    "description": "${escJson(product.summary)}"
  }
  </script>${faqSchema}`;

  const formHtml = renderInlineForm(product.id, { product: product.id, lineOfBusiness: lineSlug })
    .replace('%%FORM_HEADING%%', `Let's find the right ${product.name.toLowerCase()} for you`)
    .replace('%%FORM_SUBTEXT%%', 'Tell us a little about yourself and we\'ll come back with the best options for your situation. No pressure, no jargon, just clear answers.');

  const breadcrumbs = renderBreadcrumbs([
    { name: 'Home', url: '/' },
    { name: lineName, url: `/${lineSlug}/` },
    { name: product.name },
  ]);

  return `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: product.title_tag,
    description: product.meta_description || product.summary,
    canonical: `https://www.thewayagency.com${product.url.replace(/\.html$/, '')}`,
    ogTitle: product.title_tag,
    ogDescription: product.summary,
    ogUrl: `https://www.thewayagency.com${product.url.replace(/\.html$/, '')}`,
    schema: serviceSchema + `
  <script type="application/ld+json">
  ${breadcrumbs.schema}
  </script>`,
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: lineName,
    title: product.h1 || product.name,
    buttons: [{ href: `/intake/?product=${product.id}`, text: `Get a ${product.name} Quote`, className: 'btn btn--primary btn--lg' }],
    minHeight: '38vh',
    variant: 'compact',
  })}

  ${generateCarrierMarquee(carriers, lineKey)}

${breadcrumbs.html}
  <main id="main">
    <article class="product-content">
      ${directAnswerSection}
      <p style="color:var(--slate);font-weight:300;font-style:italic;margin-bottom:var(--space-2xl);">We're not just selling insurance. We're here to make sure you understand your options, feel confident in your coverage, and have someone in your corner when it matters most.</p>
      ${whoNeedsSection}
      ${coversSection}
      ${doesntCoverSection}
      ${costSection}
      ${faqSection}
      <!-- Inline Quote Form -->
${formHtml}

      ${relatedSection}

      ${(() => {
        const reviewer = findReviewerForProduct(team, product, lineKey);
        const designations = reviewer.designations && reviewer.designations.length > 0 ? reviewer.designations.join(', ') + ' | ' : '';
        const reviewDate = product.last_reviewed ? new Date(product.last_reviewed + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'March 2026';
        return `<div style="margin-top:var(--space-2xl);padding:var(--space-lg);background:var(--light-bg);border:1px solid var(--border);border-radius:var(--border-radius-lg);">
        <p style="font-size:var(--text-sm);color:var(--slate);margin-bottom:4px;">Reviewed by</p>
        <p style="font-weight:600;color:var(--navy);margin-bottom:2px;">
          <a href="/about/team.html#${reviewer.slug}" style="color:var(--navy);">${reviewer.name}</a>, ${reviewer.title}
        </p>
        <p style="font-size:var(--text-sm);color:var(--slate);margin-bottom:0;">
          ${designations}Licensed in KY, IN &amp; TN | ${reviewer.years_experience} years experience | Last reviewed: ${reviewDate}
        </p>
      </div>`;
      })()}
    </article>

    ${crossSellSection}

    <!-- City-specific links handled by dedicated landing pages -->

    ${generateTestimonials(testimonials, reviews, lineKey)}

${renderCTA({
      title: `Ready to talk about ${product.name.toLowerCase()}?`,
      text: "We'll listen, find the right carriers for your situation, and come back with clear options. No pressure.",
      buttons: [
        { href: `/intake/?product=${product.id}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
        { href: '/contact.html', text: 'Request a Review', className: 'btn btn--outline-white btn--lg' },
      ],
      contactMethods: true,
    }, office)}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

// ─── City Landing Page ──────────────────────────

function generateCityPage(city, ctx) {
  const { office, landingData, renderNav, renderFooter, renderScripts } = ctx;

  const citySchema = `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "InsuranceAgency",
    "name": "The Way Agency",
    "url": "https://www.thewayagency.com",
    "telephone": "${office.phone}",
    "address": {"@type": "PostalAddress", "addressLocality": "${office.city}", "addressRegion": "${office.state}", "postalCode": "${office.zip}", "addressCountry": "US"},
    "areaServed": {"@type": "City", "name": "${escJson(city.city)}", "containedIn": {"@type": "State", "name": "${city.state === 'KY' ? 'Kentucky' : city.state === 'IN' ? 'Indiana' : 'Tennessee'}"}}
  }
  </script>`;

  const faqs = Array.isArray(city.faqs) ? city.faqs : [];
  const faqAccordion = faqs.length > 0 ? `
        <section class="faq-section" style="margin-top:var(--space-2xl);">
          <h2>Frequently asked questions about insurance in ${city.city}</h2>
${faqs.map(f => `          <div class="faq-item">
            <button class="faq-item__question" aria-expanded="false">
              <h3 style="margin:0;font-size:var(--text-lg);pointer-events:none;">${f.question}</h3>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;transition:transform 0.2s;pointer-events:none;"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div class="faq-item__answer">
              <div class="faq-item__answer-inner">
                <p>${f.answer}</p>
              </div>
            </div>
          </div>`).join('\n')}
        </section>` : '';

  const faqSchema = faqs.length > 0 ? `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
${faqs.map(f => `      {
        "@type": "Question",
        "name": ${JSON.stringify(f.question)},
        "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(f.answer)} }
      }`).join(',\n')}
    ]
  }
  </script>` : '';

  const cityFormHtml = renderInlineForm(city.slug, { city: city.city, state: city.state })
    .replace('%%FORM_HEADING%%', `Get an insurance quote in ${city.city}`)
    .replace('%%FORM_SUBTEXT%%', 'Tell us your name and email and a licensed agent will follow up with options.');

  const defaultTitle = `Insurance in ${city.city}, ${city.state} | The Way Agency`;
  const defaultDescription = `Insurance agency serving ${city.city}, ${city.state}. Home, auto, commercial, and life insurance from top-rated carriers. Get a quote today.`;
  const defaultOgDescription = `Insurance agency serving ${city.city}, ${city.state}. Home, auto, commercial, and life insurance from top-rated carriers.`;
  return `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: city.title || defaultTitle,
    description: city.meta_description || defaultDescription,
    canonical: `https://www.thewayagency.com/insurance/${city.slug}`,
    ogTitle: city.title || defaultTitle,
    ogDescription: city.meta_description || defaultOgDescription,
    ogUrl: `https://www.thewayagency.com/insurance/${city.slug}`,
    schema: citySchema + (faqSchema ? '\n  ' + faqSchema : ''),
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: `Independent agency · Serving ${city.county} since 1998`,
    title: `Insurance in <span class="hero__title-accent">${city.city}</span>, ${city.state}`,
    subtitle: `Top-rated carriers, right-sized coverage, local service. Personal, commercial, and life insurance for ${city.city} families and businesses.`,
    buttons: [
      { href: `/intake/?city=${encodeURIComponent(city.city)}&state=${encodeURIComponent(city.state)}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
      { href: 'tel:+15024135335', text: `Call ${office.phone}`, className: 'btn btn--outline-white btn--lg' },
      { href: 'sms:+15024135335', text: 'Or Text', className: 'btn btn--outline-white btn--lg' },
    ],
    minHeight: '38vh',
    variant: 'compact',
  })}

  <main id="main">
    <div class="trust-bar"><div class="trust-bar__inner">
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>Since 1998</div>
      <div class="trust-bar__divider"></div>
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Top-Rated Carriers</div>
      <div class="trust-bar__divider"></div>
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Licensed in ${city.state}</div>
    </div></div>

    <section class="section">
      <div class="container container--narrow">
        <h2>Why ${city.city} families and businesses choose The Way Agency</h2>
${city.context.split(/\n\n+/).map(p => `        <p>${p.trim()}</p>`).join('\n')}
${(city.context_sections || []).map(s => {
          const sectionId = (s.slug || s.heading.split(/\s+/)[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          return `        <h3 id="${sectionId}">${s.heading}</h3>\n        <p>${s.body}</p>`;
        }).join('\n')}
${city.context_closing ? `        <p>${city.context_closing}</p>` : ''}
${city.context_closing ? '' : `        <p>As an independent agency, we are not tied to one insurance company. We represent top-rated carriers &mdash; including Travelers, Progressive, Liberty Mutual, Chubb, The Hartford, and more &mdash; and we match you with the right ones for your specific situation in ${city.county}.</p>`}

        <h2>Insurance options in ${city.city}</h2>
        ${(() => {
          const arrowSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
          return `<div class="grid grid--4" style="margin:var(--space-xl) 0;">
          <a href="/personal/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Personal Insurance</h3><p class="card__text">Home, auto, umbrella, renters, flood, and specialty coverage.</p><span class="card__link">View options ${arrowSvg}</span></a>
          <a href="/commercial/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Commercial Insurance</h3><p class="card__text">Liability, property, auto, workers comp, cyber, bonds.</p><span class="card__link">View options ${arrowSvg}</span></a>
          <a href="/life/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Life Insurance</h3><p class="card__text">Term life, whole life, annuities, disability, final expense.</p><span class="card__link">View options ${arrowSvg}</span></a>
          <a href="/health/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Health Insurance</h3><p class="card__text">Medicare, individual and group health, dental, vision, supplemental.</p><span class="card__link">View options ${arrowSvg}</span></a>
        </div>`;
        })()}

${cityFormHtml}
${faqAccordion}

        <h2>How it works</h2>
        <p><strong>1. Tell us what you need.</strong> Request a quote online or call ${office.phone}. We just need basic info to get started.</p>
        <p><strong>2. We find the right carriers.</strong> We compare options across top-rated carriers to find the best coverage and price for your situation in ${city.city}.</p>
        <p><strong>3. You choose with confidence.</strong> We present clear recommendations and help you understand exactly what you're buying. No pressure, no jargon.</p>
        <p style="color:var(--slate);font-size:var(--text-sm);">We aim to respond same-day during business hours (Mon\u2013Fri, 9:00 AM \u2013 5:00 PM).</p>
      </div>
    </section>

${renderCTA({
      title: `Ready to get started in ${city.city}?`,
      text: "Request a quote or call us directly. We're here to help.",
      buttons: [
        { href: `/intake/?city=${encodeURIComponent(city.city)}&state=${encodeURIComponent(city.state)}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
        { href: 'tel:+15024135335', text: `Call ${office.phone}`, className: 'btn btn--outline-white btn--lg' },
      ],
      contactMethods: true,
    }, office)}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

// ─── County Landing Page ────────────────────────
// Sibling of generateCityPage. Same structure but framed at the county level:
// areaServed becomes AdministrativeArea, framing references county_name instead
// of city.city, internal links target the parent_city_slug sub-anchors.

function generateCountyPage(county, ctx) {
  const { office, renderNav, renderFooter, renderScripts } = ctx;
  const countyName = county.county_name;
  const stateAbbr = county.state;
  const stateFull = county.state_full || (stateAbbr === 'KY' ? 'Kentucky' : stateAbbr === 'IN' ? 'Indiana' : 'Tennessee');

  const countySchema = `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "InsuranceAgency",
    "name": "The Way Agency",
    "url": "https://www.thewayagency.com",
    "telephone": "${office.phone}",
    "address": {"@type": "PostalAddress", "addressLocality": "${office.city}", "addressRegion": "${office.state}", "postalCode": "${office.zip}", "addressCountry": "US"},
    "areaServed": {"@type": "AdministrativeArea", "name": "${escJson(countyName)}, ${stateAbbr}", "containedIn": {"@type": "State", "name": "${stateFull}"}}
  }
  </script>`;

  const faqs = Array.isArray(county.faqs) ? county.faqs : [];
  const faqAccordion = faqs.length > 0 ? `
        <section class="faq-section" style="margin-top:var(--space-2xl);">
          <h2>Frequently asked questions about insurance in ${countyName}</h2>
${faqs.map(f => `          <div class="faq-item">
            <button class="faq-item__question" aria-expanded="false">
              <h3 style="margin:0;font-size:var(--text-lg);pointer-events:none;">${f.question}</h3>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;transition:transform 0.2s;pointer-events:none;"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div class="faq-item__answer">
              <div class="faq-item__answer-inner">
                <p>${f.answer}</p>
              </div>
            </div>
          </div>`).join('\n')}
        </section>` : '';

  const faqSchema = faqs.length > 0 ? `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
${faqs.map(f => `      {
        "@type": "Question",
        "name": ${JSON.stringify(f.question)},
        "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(f.answer)} }
      }`).join(',\n')}
    ]
  }
  </script>` : '';

  const defaultTitle = `Insurance in ${countyName}, ${stateAbbr} | The Way Agency`;
  const defaultDescription = `Insurance agency serving ${countyName}, ${stateAbbr}. Home, auto, commercial, farm, and life insurance from top-rated carriers.`;

  const countyFormHtml = renderInlineForm(county.slug, { county: countyName, state: stateAbbr })
    .replace('%%FORM_HEADING%%', `Get an insurance quote in ${countyName}`)
    .replace('%%FORM_SUBTEXT%%', 'Tell us your name and email and a licensed agent will follow up with options.');

  return `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: county.title || defaultTitle,
    description: county.meta_description || defaultDescription,
    canonical: `https://www.thewayagency.com/insurance/${county.slug}`,
    ogTitle: county.title || defaultTitle,
    ogDescription: county.meta_description || defaultDescription,
    ogUrl: `https://www.thewayagency.com/insurance/${county.slug}`,
    schema: countySchema + (faqSchema ? '\n  ' + faqSchema : ''),
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: `Independent agency · Serving ${countyName} since 1998`,
    title: `Insurance in <span class="hero__title-accent">${countyName}</span>, ${stateAbbr}`,
    subtitle: `Top-rated carriers, right-sized coverage, local service. Personal, commercial, farm, and life insurance for ${countyName} families and businesses.`,
    buttons: [
      { href: `/intake/?county=${encodeURIComponent(countyName)}&state=${encodeURIComponent(stateAbbr)}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
      { href: 'tel:+15024135335', text: `Call ${office.phone}`, className: 'btn btn--outline-white btn--lg' },
      { href: 'sms:+15024135335', text: 'Or Text', className: 'btn btn--outline-white btn--lg' },
    ],
    minHeight: '38vh',
    variant: 'compact',
  })}

  <main id="main">
    <div class="trust-bar"><div class="trust-bar__inner">
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>Since 1998</div>
      <div class="trust-bar__divider"></div>
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Top-Rated Carriers</div>
      <div class="trust-bar__divider"></div>
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Licensed in ${stateAbbr}</div>
    </div></div>

    <section class="section">
      <div class="container container--narrow">
        <h2>Why ${countyName} families and businesses choose The Way Agency</h2>
${county.context.split(/\n\n+/).map(p => `        <p>${p.trim()}</p>`).join('\n')}
${(county.context_sections || []).map(s => {
          const sectionId = (s.slug || s.heading.split(/\s+/)[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          return `        <h3 id="${sectionId}">${s.heading}</h3>\n        <p>${s.body}</p>`;
        }).join('\n')}
${county.context_closing ? `        <p>${county.context_closing}</p>` : ''}

        <h2>Insurance options in ${countyName}</h2>
        ${(() => {
          const arrowSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
          return `<div class="grid grid--4" style="margin:var(--space-xl) 0;">
          <a href="/personal/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Personal Insurance</h3><p class="card__text">Home, auto, umbrella, renters, flood, and specialty coverage.</p><span class="card__link">View options ${arrowSvg}</span></a>
          <a href="/commercial/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Commercial Insurance</h3><p class="card__text">Liability, property, auto, workers comp, cyber, bonds.</p><span class="card__link">View options ${arrowSvg}</span></a>
          <a href="/life/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Life Insurance</h3><p class="card__text">Term life, whole life, annuities, disability, final expense.</p><span class="card__link">View options ${arrowSvg}</span></a>
          <a href="/health/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Health Insurance</h3><p class="card__text">Medicare, individual and group health, dental, vision, supplemental.</p><span class="card__link">View options ${arrowSvg}</span></a>
        </div>`;
        })()}

${countyFormHtml}
${faqAccordion}

        <h2>How it works</h2>
        <p><strong>1. Tell us what you need.</strong> Request a quote online or call ${office.phone}. We just need basic info to get started.</p>
        <p><strong>2. We find the right carriers.</strong> We compare options across top-rated carriers to find the best coverage and price for your situation in ${countyName}.</p>
        <p><strong>3. You choose with confidence.</strong> We present clear recommendations and help you understand exactly what you're buying. No pressure, no jargon.</p>
        <p style="color:var(--slate);font-size:var(--text-sm);">We aim to respond same-day during business hours (Mon–Fri, 9:00 AM – 5:00 PM).</p>
      </div>
    </section>

${renderCTA({
      title: `Ready to get started in ${countyName}?`,
      text: "Request a quote or call us directly. We're here to help.",
      buttons: [
        { href: `/intake/?county=${encodeURIComponent(countyName)}&state=${encodeURIComponent(stateAbbr)}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
        { href: 'tel:+15024135335', text: `Call ${office.phone}`, className: 'btn btn--outline-white btn--lg' },
      ],
      contactMethods: true,
    }, office)}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

// ─── Industry Landing Page ──────────────────────

function generateIndustryPage(ind, ctx) {
  const { office, renderNav, renderFooter, renderScripts } = ctx;

  const coverageList = ind.typical_coverage.map(c => `<li>${c}</li>`).join('\n            ');

  const indFormHtml = renderInlineForm(ind.slug, { industry: ind.slug, lineOfBusiness: 'commercial' })
    .replace('%%FORM_HEADING%%', `Get a quote for your ${ind.name.toLowerCase().replace(/s$/, '')} business`)
    .replace('%%FORM_SUBTEXT%%', 'Tell us about your business and we\'ll come back with coverage options from carriers that specialize in your industry.');

  return `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: `Insurance for ${ind.name} in Kentucky | The Way Agency`,
    description: `Insurance for ${ind.name.toLowerCase()} in Kentucky, Indiana, and Tennessee. ${ind.description.split('.')[0]}. Get a quote from top-rated carriers.`,
    canonical: `https://www.thewayagency.com/industries/${ind.slug}`,
    ogTitle: `Insurance for ${ind.name} in Kentucky | The Way Agency`,
    ogDescription: `Insurance for ${ind.name.toLowerCase()} in Kentucky, Indiana, and Tennessee. Get a quote from top-rated carriers.`,
    ogUrl: `https://www.thewayagency.com/industries/${ind.slug}`,
    schema: `<script type="application/ld+json">
  ${JSON.stringify({"@context":"https://schema.org","@type":"InsuranceAgency","name":"The Way Agency","knowsAbout":ind.name})}
  </script>`,
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: 'Industry Specialty',
    title: `Insurance for<br>${ind.name}`,
    subtitle: ind.description,
    buttons: [
      { href: `/intake/?line=commercial&industry=${ind.slug}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
      { href: 'tel:+15024135335', text: `Call ${office.phone}`, className: 'btn btn--outline-white btn--lg' },
      { href: 'sms:+15024135335', text: 'Or Text', className: 'btn btn--outline-white btn--lg' },
    ],
    minHeight: '38vh',
    bgStyle: 'background:linear-gradient(135deg, #0F2240 0%, #173358 40%, #2680B5 100%);',
    variant: 'compact',
  })}

  <main id="main">
    <section class="section">
      <div class="container container--narrow">
        <h2>What ${ind.name.toLowerCase()} typically need</h2>
        <p>Based on our experience working with ${ind.name.toLowerCase()} across Kentucky, Indiana, and Tennessee, here are the coverage types you should have in place:</p>
        <ul style="list-style:disc;padding-left:var(--space-xl);margin-bottom:var(--space-xl);">
            ${coverageList}
        </ul>

        <h2>Kentucky-specific requirements</h2>
        <p>${ind.ky_notes}</p>
        <p>We represent top-rated carriers including specialty markets for ${ind.name.toLowerCase()}, which means we can often find coverage that generalist agencies cannot. We also handle certificates of insurance, additional insured endorsements, and audit support.</p>

${indFormHtml}

        <h2>Why choose The Way Agency for ${ind.name.toLowerCase()} insurance?</h2>
        <p><strong>Industry experience.</strong> We understand the specific risks, contract requirements, and coverage gaps that ${ind.name.toLowerCase()} face. We don't sell generic policies  -  we build programs that match real-world operations.</p>
        <p><strong>Carrier access.</strong> As an independent agency, we access markets that captive agents and direct-to-carrier sites cannot. For specialty trades, this access is the difference between getting covered and getting declined.</p>
        <p><strong>Certificate management.</strong> We handle COIs, additional insured requests, and evidence of coverage quickly. When you need a certificate for a job site by tomorrow morning, we make it happen.</p>
        <p><strong>Claims advocacy.</strong> When something goes wrong on a job, we help you navigate the claims process and push back on the carrier when needed. We work for you, not the insurance company.</p>
      </div>
    </section>

${renderCTA({
      title: `Get coverage for your ${ind.name.toLowerCase().replace(/s$/, '')} business`,
      text: "We'll build a program that matches your operations, contracts, and budget.",
      buttons: [
        { href: `/intake/?line=commercial&industry=${ind.slug}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
        { href: 'tel:+15024135335', text: `Call ${office.phone}`, className: 'btn btn--outline-white btn--lg' },
      ],
      contactMethods: true,
    }, office)}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

// ─── Carrier Page ───────────────────────────────

function generateCarrierPage(carrier, line, ctx) {
  const { office, products, renderNav, renderFooter, renderScripts } = ctx;
  const lineName = line === 'personal' ? 'Personal Insurance' : 'Commercial Insurance';
  const lineSlug = line;

  // Find product pages for linked lines
  const allProducts = [...(products.personal || []), ...(products.commercial || []), ...(products.life || []), ...(products.health || [])];
  const linkedProducts = (carrier.lines || []).map(id => allProducts.find(p => p.id === id || p.slug === id)).filter(Boolean);

  const arrowSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';

  const productCards = linkedProducts.length > 0 ? `
        <h2>Coverage lines we place with ${carrier.name}</h2>
        <div class="grid grid--3" style="margin:var(--space-lg) 0 var(--space-2xl);">
${linkedProducts.map(p => `          <a href="${p.url}" class="card" style="text-decoration:none;">
            <h3 class="card__title" style="font-size:var(--text-lg);">${p.name}</h3>
            <span class="card__link">Learn more ${arrowSvg}</span>
          </a>`).join('\n')}
        </div>` : '';

  const strengthsList = (carrier.strengths || []).length > 0 ? `
        <h2>Why we recommend ${carrier.name}</h2>
        <ul style="list-style:disc;padding-left:var(--space-xl);margin-bottom:var(--space-xl);">
          ${carrier.strengths.map(s => `<li>${s}</li>`).join('\n          ')}
        </ul>` : '';

  const ratingBadge = carrier.am_best_rating ? `<p style="margin-top:var(--space-lg);"><strong>AM Best Rating:</strong> ${carrier.am_best_rating}</p>` : '';

  const breadcrumbs = renderBreadcrumbs([
    { name: 'Home', url: '/' },
    { name: 'Carriers', url: '/carriers/' },
    { name: carrier.name },
  ]);

  return `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: `${carrier.name} Insurance | The Way Agency`,
    description: `${carrier.name} insurance through The Way Agency. ${carrier.description || `We represent ${carrier.name} for ${lineName.toLowerCase()} in Kentucky, Indiana, and Tennessee.`}`,
    canonical: `https://www.thewayagency.com/carriers/${carrier.slug}`,
    ogTitle: `${carrier.name} Insurance | The Way Agency`,
    ogDescription: carrier.description || `We represent ${carrier.name} for insurance in KY, IN & TN.`,
    ogUrl: `https://www.thewayagency.com/carriers/${carrier.slug}`,
    schema: `<script type="application/ld+json">
  ${JSON.stringify({"@context":"https://schema.org","@type":"Organization","name":carrier.name,"description":carrier.description||`${carrier.name} insurance carrier represented by The Way Agency in Kentucky, Indiana, and Tennessee.`})}
  </script>`,
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: 'Our Carriers',
    title: carrier.name,
    subtitle: carrier.description || `We represent ${carrier.name} for ${lineName.toLowerCase()} in Kentucky, Indiana, and Tennessee.`,
    buttons: [
      { href: '/intake/', text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
    ],
    minHeight: '38vh',
    variant: 'compact',
  })}

${breadcrumbs.html}
  <main id="main">
    <section class="section">
      <div class="container container--narrow">
        ${ratingBadge}
        ${productCards}
        ${strengthsList}
        <h2>How it works</h2>
        <p>As an independent agency, we represent ${carrier.name} alongside many other top-rated carriers. When you request a quote, we compare options from multiple companies — including ${carrier.name} — to find the best combination of coverage, service, and price for your specific situation.</p>
        <p>You get the strength and backing of ${carrier.name} with the personal service and advocacy of a local, independent agent.</p>
      </div>
    </section>

${renderCTA({
      title: `Ready to see what ${carrier.name} can offer?`,
      text: "Request a quote and we'll compare options from multiple carriers, including " + carrier.name + ".",
      buttons: [
        { href: '/intake/', text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
        { href: '/contact.html', text: 'Contact Us', className: 'btn btn--outline-white btn--lg' },
      ],
      contactMethods: true,
    }, office)}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

// ─── Carriers Index Page ────────────────────────

function generateCarriersIndex(carriers, ctx) {
  const { office, renderNav, renderFooter, renderScripts } = ctx;
  const arrowSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';

  // Deduplicate carriers across lines
  const seen = new Set();
  const allCarriers = [];
  for (const line of ['personal', 'commercial']) {
    for (const c of (carriers[line] || [])) {
      if (!seen.has(c.slug)) {
        seen.add(c.slug);
        allCarriers.push({ ...c, line });
      }
    }
  }
  allCarriers.sort((a, b) => a.name.localeCompare(b.name));

  // Split into featured (have descriptions) and standard
  const featured = allCarriers.filter(c => c.description);
  const standard = allCarriers.filter(c => !c.description);

  const featuredCards = featured.map(c => `          <a href="/carriers/${c.slug}.html" class="card" style="text-decoration:none;">
            <h3 class="card__title" style="font-size:var(--text-xl);">${c.name}</h3>
            ${c.am_best_rating ? `<p style="font-size:var(--text-xs);color:var(--green);font-weight:600;margin-bottom:var(--space-sm);">AM Best: ${c.am_best_rating}</p>` : ''}
            <p class="card__text">${c.description.split('.')[0]}.</p>
            <span class="card__link">Learn more ${arrowSvg}</span>
          </a>`).join('\n');

  const standardList = standard.map(c => {
    const rating = c.am_best_rating ? ` <span style="color:var(--green);font-size:var(--text-xs);font-weight:600;">(${c.am_best_rating})</span>` : '';
    return `<li style="padding:var(--space-sm) 0;border-bottom:1px solid var(--border);">${c.name}${rating}</li>`;
  }).join('\n            ');

  return `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: 'Our Insurance Carriers | Top-Rated Companies | The Way Agency',
    description: 'The Way Agency represents top-rated insurance carriers including Travelers, Progressive, Chubb, Liberty Mutual, The Hartford, and more. We shop the market for you.',
    canonical: 'https://www.thewayagency.com/carriers/',
    ogTitle: 'Our Insurance Carriers | The Way Agency',
    ogDescription: 'We represent top-rated insurance carriers to find you the best coverage and price.',
    ogUrl: 'https://www.thewayagency.com/carriers/',
    schema: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "InsuranceAgency",
      "name": "The Way Agency",
      "url": "https://www.thewayagency.com",
      "description": "Independent insurance agency representing top-rated carriers across personal, commercial, and life lines.",
      "areaServed": [
        { "@type": "State", "name": "Kentucky" },
        { "@type": "State", "name": "Indiana" },
        { "@type": "State", "name": "Tennessee" }
      ]
    }, null, 2),
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: 'Our Carriers',
    title: 'Top-rated carriers.<br>One independent agent.',
    subtitle: 'We represent top-rated insurance carriers across personal, commercial, and life lines. That means we shop the market for you and find the best combination of coverage, service, and price.',
    buttons: [
      { href: '/intake/', text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
    ],
    minHeight: '38vh',
    variant: 'compact',
  })}

  <main id="main">
    <section class="section">
      <div class="container">
        <div class="section-header">
          <p class="section-header__eyebrow">Featured Carriers</p>
          <h2>Companies we work with most</h2>
        </div>
        <div class="grid grid--3">
${featuredCards}
        </div>
      </div>
    </section>

    <section class="section section--light">
      <div class="container container--narrow">
        <h2>All carriers we represent</h2>
        <p style="color:var(--slate);margin-bottom:var(--space-xl);">In addition to our featured partners, we have access to these carriers for specialty and standard risks:</p>
        <ul style="list-style:none;padding:0;">
            ${standardList}
        </ul>
      </div>
    </section>

${renderCTA({
      title: 'Let us shop the market for you',
      text: 'Tell us what you need and we\'ll compare options from our full carrier lineup.',
      buttons: [
        { href: '/intake/', text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
        { href: '/contact.html', text: 'Contact Us', className: 'btn btn--outline-white btn--lg' },
      ],
      contactMethods: true,
    }, office)}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

module.exports = {
  hubConfig,
  generateHubPage,
  generateProductPage,
  generateCityPage,
  generateCountyPage,
  generateIndustryPage,
  generateCarrierPage,
  generateCarriersIndex,
  setCriticalCss,
  renderHead,
  renderHero,
  renderCTA,
  renderInlineForm,
};
