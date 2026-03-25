#!/usr/bin/env node
/**
 * The Way Agency  -  Static Site Build Script
 *
 * Generates product pages from data/products.json,
 * copies all files to build/, and generates sitemap.xml.
 *
 * Usage: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BUILD = path.join(ROOT, 'build');
const DATA = path.join(ROOT, 'data');

// ─── Version / Build Info ───────────────────────
function getGitInfo() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}
const gitInfo = getGitInfo();
const buildDate = new Date().toISOString();
const buildVersion = `${buildDate.split('T')[0]}-${gitInfo.commit}`;
console.log(`\nBuild version: ${buildVersion} (branch: ${gitInfo.branch})`);

// ─── Version injection helper ───────────────────
const versionMeta = `<meta name="build-version" content="${buildVersion}">`;
const versionComment = `<!-- build: ${buildVersion} | ${gitInfo.branch} | ${buildDate} -->`;
const versionFooter = `<span style="font-size:10px;color:rgba(255,255,255,0.25);margin-left:auto;">build ${buildVersion}</span>`;

function injectVersion(html) {
  // Add meta tag after charset
  html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n  ${versionMeta}`);
  // Add build comment after doctype
  html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${versionComment}`);
  // Add version to footer bottom
  html = html.replace(
    /(<div class="footer__legal-links">[\s\S]*?<\/div>\s*<\/div>)/,
    `$1\n      ${versionFooter}`
  );
  return html;
}

// ─── Utilities ─────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ─── Load Data ─────────────────────────────────
const products = JSON.parse(fs.readFileSync(path.join(DATA, 'products.json'), 'utf8'));
const locations = JSON.parse(fs.readFileSync(path.join(DATA, 'locations.json'), 'utf8'));
const team = JSON.parse(fs.readFileSync(path.join(DATA, 'team.json'), 'utf8'));
const knowledgeBase = JSON.parse(fs.readFileSync(path.join(DATA, 'knowledge-base.json'), 'utf8'));
const carriers = JSON.parse(fs.readFileSync(path.join(DATA, 'carriers.json'), 'utf8'));
const testimonials = JSON.parse(fs.readFileSync(path.join(DATA, 'testimonials.json'), 'utf8'));
const seoData = JSON.parse(fs.readFileSync(path.join(DATA, 'seo.json'), 'utf8'));
const agency = locations.agency;
const office = locations.offices[0];

// Load rich content files (optional  -  graceful fallback if not yet created)
let richContent = {};
for (const file of ['content-personal.json', 'content-commercial.json', 'content-life-health.json']) {
  const fp = path.join(DATA, file);
  if (fs.existsSync(fp)) {
    Object.assign(richContent, JSON.parse(fs.readFileSync(fp, 'utf8')));
  }
}

// Get FAQ entries for a product from knowledge-base.json
function getFAQsForProduct(productId) {
  return (knowledgeBase.entries || []).filter(e => e.product === productId).slice(0, 5);
}

// Get carriers for a product line
function getCarriersForLine(lineKey) {
  const key = lineKey === 'life_health' ? 'personal' : lineKey; // life/health uses personal carriers
  return carriers[key] || carriers.personal || [];
}

// Generate carrier marquee HTML
function generateCarrierMarquee(lineKey) {
  const lineCarriers = getCarriersForLine(lineKey);
  if (!lineCarriers.length) return '';
  // Duplicate for seamless scroll
  const carrierItems = lineCarriers.map(c =>
    `<span class="carriers__logo">${c.name}</span>`
  ).join('\n          ');
  return `
    <section class="carriers">
      <p class="carriers__label">We represent ${lineCarriers.length}+ carriers</p>
      <div style="overflow:hidden;">
        <div class="carriers__track">
          ${carrierItems}
          ${carrierItems}
        </div>
      </div>
    </section>`;
}

// Get testimonials for a product line, with fallback
function getTestimonialsForLine(lineKey) {
  const lineMap = { personal: 'personal', commercial: 'commercial', life_health: 'life_health' };
  const lineName = lineMap[lineKey] || 'personal';
  let filtered = testimonials.testimonials.filter(t => t.product_lines.includes(lineName));
  // If fewer than 2 matches, add general ones
  if (filtered.length < 2) {
    const others = testimonials.testimonials.filter(t => !filtered.includes(t));
    filtered = [...filtered, ...others].slice(0, 3);
  }
  return filtered.slice(0, 3);
}

// Generate testimonial HTML
const starSvg = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
function generateTestimonials(lineKey) {
  const reviews = getTestimonialsForLine(lineKey);
  if (!reviews.length) return '';
  return `
    <section class="section section--light">
      <div class="container">
        <div class="section-header">
          <p class="section-header__eyebrow">What Clients Say</p>
          <h2>Real reviews from real clients</h2>
          <a href="https://g.page/r/CSHCy85xJ8VOEBM/review" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:var(--space-sm);font-size:var(--text-sm);color:var(--charcoal);text-decoration:none;">
            <span style="color:#FBBC05;">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
            <strong>5.0</strong> <span style="color:var(--slate);">(19 Google reviews)</span>
          </a>
        </div>
        <div class="grid grid--3">
          ${reviews.map(r => `
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

// ─── Author Attribution ─────────────────────────
function findReviewerForProduct(product, lineKey) {
  const match = team.team.find(member =>
    member.specialties.includes(product.id) ||
    member.specialties.includes(lineKey === 'personal' ? 'personal_lines' : lineKey === 'commercial' ? 'commercial_lines' : 'life_health')
  );
  return match || team.team[0];
}

// ─── Shared Template Functions ──────────────────

function renderHead({ title, description, canonical, ogTitle, ogDescription, ogUrl, schema }) {
  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${ogTitle || title}">
  <meta property="og:description" content="${ogDescription || description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${ogUrl || canonical}">
  <meta property="og:site_name" content="The Way Agency">
  <meta property="og:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">
  <meta name="google-site-verification" content="UR_730X-tkdo6fvlzh_yGux9csokDdBhdEJANQAYlEo">
  <link rel="icon" href="/src/assets/images/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/css/base.css">
  <link rel="stylesheet" href="/src/css/components.css">
  <link rel="stylesheet" href="/src/css/leadgen.css">${schema ? `
  ${schema}` : ''}
</head>`;
}

function renderNav() {
  return `  <nav class="nav" id="nav">
    <div class="nav__inner">
      <a href="/" class="nav__logo" aria-label="Home">
        <picture><source srcset="/src/assets/images/logo-horizontal.webp" type="image/webp"><img src="/src/assets/images/logo-horizontal.png" alt="The Way Agency" style="height:40px;width:auto;"></picture>
      </a>
      <div class="nav__links" id="navLinks">
        <div class="nav__dropdown">
          <a href="/personal/" class="nav__link">Personal</a>
          <div class="nav__dropdown-menu">
            <a href="/personal/home.html" class="nav__dropdown-item">Home</a>
            <a href="/personal/auto.html" class="nav__dropdown-item">Auto</a>
            <a href="/personal/renters.html" class="nav__dropdown-item">Renters</a>
            <a href="/personal/umbrella.html" class="nav__dropdown-item">Umbrella</a>
            <a href="/personal/flood.html" class="nav__dropdown-item">Flood</a>
            <a href="/personal/motorcycle.html" class="nav__dropdown-item">Motorcycle</a>
            <a href="/personal/boat.html" class="nav__dropdown-item">Boat</a>
            <a href="/personal/classic-car.html" class="nav__dropdown-item">Classic Car</a>
            <a href="/personal/earthquake.html" class="nav__dropdown-item">Earthquake</a>
            <a href="/personal/pet.html" class="nav__dropdown-item">Pet</a>
          </div>
        </div>
        <div class="nav__dropdown">
          <a href="/commercial/" class="nav__link">Commercial</a>
          <div class="nav__dropdown-menu">
            <a href="/commercial/general-liability.html" class="nav__dropdown-item">General Liability</a>
            <a href="/commercial/commercial-property.html" class="nav__dropdown-item">Commercial Property</a>
            <a href="/commercial/commercial-auto.html" class="nav__dropdown-item">Commercial Auto</a>
            <a href="/commercial/workers-compensation.html" class="nav__dropdown-item">Workers Comp</a>
            <a href="/commercial/cyber.html" class="nav__dropdown-item">Cyber</a>
            <a href="/commercial/bonds.html" class="nav__dropdown-item">Bonds</a>
            <a href="/commercial/builders-risk.html" class="nav__dropdown-item">Builders Risk</a>
            <a href="/commercial/special-event.html" class="nav__dropdown-item">Special Events</a>
            <a href="/commercial/professional-liability.html" class="nav__dropdown-item">Professional Liability</a>
          </div>
        </div>
        <div class="nav__dropdown">
          <a href="/life-health/" class="nav__link">Life &amp; Health</a>
          <div class="nav__dropdown-menu">
            <a href="/life-health/medicare.html" class="nav__dropdown-item">Medicare</a>
            <a href="/life-health/individual-health.html" class="nav__dropdown-item">Individual Health</a>
            <a href="/life-health/group-health.html" class="nav__dropdown-item">Group Health</a>
            <a href="/life-health/term-life.html" class="nav__dropdown-item">Term Life</a>
            <a href="/life-health/whole-life.html" class="nav__dropdown-item">Whole Life</a>
            <a href="/life-health/disability.html" class="nav__dropdown-item">Disability</a>
            <a href="/life-health/final-expense.html" class="nav__dropdown-item">Final Expense</a>
          </div>
        </div>
        <div class="nav__dropdown">
          <a href="/about/" class="nav__link">About</a>
          <div class="nav__dropdown-menu" style="grid-template-columns:1fr;">
            <a href="/about/" class="nav__dropdown-item">Who We Are</a>
            <a href="/about/team.html" class="nav__dropdown-item">Our Team</a>
            <a href="/about/locations.html" class="nav__dropdown-item">Locations</a>
          </div>
        </div>
        <a href="/blog/" class="nav__link">Blog</a>
        <a href="/intake/" class="btn btn--primary">Get a Quote</a>
      </div>
      <button class="nav__toggle" id="navToggle" aria-label="Toggle menu"><span></span><span></span><span></span></button>
    </div>
  </nav>`;
}

function renderFooter() {
  return `  <footer class="footer">
    <div class="footer__grid">
      <div class="footer__brand">
        <picture><source srcset="/src/assets/images/logo-horizontal-white.webp" type="image/webp"><img class="footer__logo" src="/src/assets/images/logo-horizontal-white.png" alt="The Way Agency" style="height:36px;width:auto;"></picture>
        <address class="footer__address" style="font-style:normal;">${office.street}<br>${office.city}, ${office.state} ${office.zip}</address>
        <div class="footer__contact-link">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <a href="tel:+15024135335">${office.phone}</a>
        </div>
        <div class="footer__contact-link">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <a href="mailto:${office.email}">${office.email}</a>
        </div>
        <p style="font-size:var(--text-xs);margin-top:var(--space-md);color:rgba(255,255,255,0.5);">Mon–Fri: 8:30 AM – 5:00 PM</p>
        <a href="https://g.page/r/CSHCy85xJ8VOEBM/review" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:var(--space-sm);font-size:11px;color:rgba(255,255,255,0.7);text-decoration:none;">
          <span style="color:#FBBC05;">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
          <span>5.0 from 19 Google reviews</span>
        </a>
      </div>
      <div>
        <h4 class="footer__heading">Personal</h4>
        <div class="footer__link-list">
          <a href="/personal/home.html">Home</a>
          <a href="/personal/auto.html">Auto</a>
          <a href="/personal/renters.html">Renters</a>
          <a href="/personal/umbrella.html">Umbrella</a>
          <a href="/personal/flood.html">Flood</a>
        </div>
      </div>
      <div>
        <h4 class="footer__heading">Commercial</h4>
        <div class="footer__link-list">
          <a href="/commercial/general-liability.html">General Liability</a>
          <a href="/commercial/commercial-property.html">Property</a>
          <a href="/commercial/commercial-auto.html">Auto</a>
          <a href="/commercial/workers-compensation.html">Workers Comp</a>
          <a href="/commercial/cyber.html">Cyber</a>
        </div>
      </div>
      <div>
        <h4 class="footer__heading">Company</h4>
        <div class="footer__link-list">
          <a href="/about/">About Us</a>
          <a href="/about/team.html">Our Team</a>
          <a href="/about/locations.html">Locations</a>
          <a href="/blog/">Blog</a>
          <a href="/intake/">Get a Quote</a>
          <a href="/contact.html">Contact</a>
        </div>
      </div>
    </div>
    <div class="footer__bottom">
      <p>&copy; 2026 The Way Agency. All rights reserved.</p>
      <div class="footer__legal-links">
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
      </div>
    </div>
    <p style="max-width:var(--max-width);margin:var(--space-sm) auto 0;padding:0 var(--space-xl);font-size:11px;color:rgba(255,255,255,0.3);">Licensed in KY, IN &amp; TN. Way Associates, Inc dba The Way Agency.</p>
  </footer>`;
}

function renderHero({ eyebrow, title, subtitle, buttons, minHeight, bgStyle }) {
  const height = minHeight || '40vh';
  const eyebrowHtml = eyebrow ? `\n      <p class="hero__eyebrow">${eyebrow}</p>` : '';
  const subtitleHtml = subtitle ? `\n      <p class="hero__subtitle">${subtitle}</p>` : '';
  const bgStyleAttr = bgStyle ? ` style="${bgStyle}"` : '';
  const buttonsHtml = buttons && buttons.length > 0 ? `\n      <div class="hero__actions">\n${buttons.map(b => `        <a href="${b.href}" class="${b.className || 'btn btn--primary btn--lg'}">${b.text}</a>`).join('\n')}\n      </div>` : '';
  return `  <section class="hero" style="min-height:${height};">
    <div class="hero__bg"${bgStyleAttr}></div>
    <div class="hero__texture"></div>
    <div class="hero__content">${eyebrowHtml}
      <h1 class="hero__title">${title}</h1>${subtitleHtml}${buttonsHtml}
    </div>
    <div class="hero__accent"></div>
  </section>`;
}

function renderCTA({ title, text, buttons, contactMethods }) {
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>
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
    `          <input type="hidden" name="${k}" value="${v}">`
  ).join('\n');
  return `        <div class="inline-quote-section">
          <h3>%%FORM_HEADING%%</h3>
          <p>%%FORM_SUBTEXT%%</p>
          <form class="inline-quote-form" novalidate>
${hiddenHtml}
            <label for="iq-name-${formId}" class="sr-only">Your name</label>
            <input type="text" id="iq-name-${formId}" name="name" placeholder="Your name" required autocomplete="name">
            <label for="iq-email-${formId}" class="sr-only">Email address</label>
            <input type="email" id="iq-email-${formId}" name="email" placeholder="Email address" required autocomplete="email">
            <label for="iq-phone-${formId}" class="sr-only">Phone (optional)</label>
            <input type="tel" id="iq-phone-${formId}" name="phone" placeholder="Phone (optional)" autocomplete="tel">
            <input type="text" name="_hp_company" style="display:none" tabindex="-1" autocomplete="off">
            <button type="submit">Get Quote</button>
          </form>
          <p style="font-size:11px;color:var(--slate,#64748b);margin-top:8px;text-align:center;">We never sell your data. <a href="/privacy.html" style="color:inherit;text-decoration:underline;">Privacy Policy</a></p>
        </div>`;
}

function renderScripts() {
  return `  <div id="ai-chat-root"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
  <script src="/src/js/app.js"></script>`;
}

// ─── Product Page Template ─────────────────────
function generateProductPage(product, lineName, lineSlug, lineKey) {
  const rc = richContent[product.id] || {};
  const faqs = rc.faqs || [];
  const kbFaqs = getFAQsForProduct(product.id);
  // Merge: use rich content FAQs first, then knowledge base FAQs (deduplicate)
  const allFaqs = [...faqs];
  for (const kb of kbFaqs) {
    if (!allFaqs.some(f => f.question === kb.question)) {
      allFaqs.push({ question: kb.question, answer: kb.answer });
    }
  }
  const displayFaqs = allFaqs.slice(0, 5);

  // Rich content sections (if available)
  const directAnswerSection = rc.direct_answer ? `
      <p class="text-lg" style="font-size:var(--text-lg);line-height:1.8;margin-bottom:var(--space-xl);">${rc.direct_answer}</p>` : `
      <p class="text-lg" style="font-size:var(--text-lg);line-height:1.8;margin-bottom:var(--space-xl);">${product.summary}</p>`;

  const whoNeedsSection = rc.who_needs_it ? `
      <h2>Who needs ${product.name.toLowerCase()} in Kentucky?</h2>
      <p>${rc.who_needs_it}</p>` : (product.ky_requirement ? `
      <h2>Is ${product.name.toLowerCase()} required in Kentucky?</h2>
      <p>${product.ky_requirement}</p>` : '');

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
      <h2>What does ${product.name.toLowerCase()} cost${lineKey === 'personal' ? ' in Kentucky' : ''}?</h2>
      <p>${rc.cost_narrative}</p>` : (product.typical_cost_range ? `
      <h2>What does ${product.name.toLowerCase()} cost?</h2>
      <p>
        In our experience: <strong>${product.typical_cost_range}</strong>.
        ${product.cost_factors ? 'Key factors that affect your premium include: ' + product.cost_factors.join(', ') + '.' : ''}
        As an independent agency, we represent dozens of carriers and match you with the right one for your situation.
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

  // FAQPage schema for the FAQs
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

  // Build related product links with actual URLs
  const allProducts = [...(products.personal || []), ...(products.commercial || []), ...(products.life_health || [])];
  const relatedLinks = (product.related_products || []).map(rId => {
    const rp = allProducts.find(p => p.id === rId);
    if (!rp) return '';
    return `<li><a href="${rp.url}"><strong>${rp.name}</strong></a>  -  ${rp.summary ? rp.summary.split('.')[0] + '.' : ''}</li>`;
  }).filter(Boolean).join('\n        ');

  // Cross-line suggestion
  const crossLines = {
    personal: { text: 'Own a business? We can help with that too.', link: '/commercial/', label: 'Explore Commercial Insurance' },
    commercial: { text: 'We also protect your family at home.', link: '/personal/', label: 'Explore Personal Insurance' },
    life_health: { text: 'Need home, auto, or business coverage?', link: '/personal/', label: 'Explore Personal Insurance' },
  };
  const crossLine = crossLines[lineKey] || crossLines.personal;

  const relatedSection = relatedLinks ? `
      <h2>Related coverage to consider</h2>
      <ul>
        ${relatedLinks}
      </ul>
      <p><a href="/${lineSlug}/">Browse all ${lineName} options</a></p>` : '';

  const crossSellSection = `
      <section class="section section--light" style="margin-top:var(--space-2xl);">
        <div class="container" style="text-align:center;">
          <p style="font-weight:600;color:var(--navy);margin-bottom:var(--space-sm);">${crossLine.text}</p>
          <a href="${crossLine.link}" class="btn btn--outline">${crossLine.label}</a>
        </div>
      </section>`;

  // Product page schema
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
    "description": "${product.summary.replace(/"/g, '\\"')}"
  }
  </script>${faqSchema}`;

  // Build inline form
  const formHtml = renderInlineForm(product.id, { product: product.id, lineOfBusiness: lineSlug })
    .replace('%%FORM_HEADING%%', `Let's find the right ${product.name.toLowerCase()} for you`)
    .replace('%%FORM_SUBTEXT%%', 'Tell us a little about yourself and we\'ll come back with the best options for your situation. No pressure, no jargon, just clear answers.');

  return `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: product.title_tag,
    description: product.meta_description || product.summary,
    canonical: `https://www.thewayagency.com${product.url}`,
    ogTitle: product.title_tag,
    ogDescription: product.summary,
    ogUrl: `https://www.thewayagency.com${product.url}`,
    schema: serviceSchema,
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: lineName,
    title: product.h1 || product.name,
    buttons: [{ href: `/intake/?product=${product.id}`, text: `Get a ${product.name} Quote`, className: 'btn btn--primary btn--lg' }],
    minHeight: '40vh',
  })}

  ${generateCarrierMarquee(lineKey)}

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
        const reviewer = findReviewerForProduct(product, lineKey);
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

    ${generateTestimonials(lineKey)}

${renderCTA({
      title: `Ready to talk about ${product.name.toLowerCase()}?`,
      text: "We'll listen, find the right carriers for your situation, and come back with clear options. No pressure.",
      buttons: [
        { href: `/intake/?product=${product.id}`, text: 'Get a Quote', className: 'btn btn--primary btn--lg' },
        { href: '/contact.html', text: 'Request a Review', className: 'btn btn--outline-white btn--lg' },
      ],
      contactMethods: true,
    })}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

// ─── Build ─────────────────────────────────────
console.log('🔨 Building The Way Agency site...\n');

// 1. Ensure build directory exists (preserve hand-crafted pages)
ensureDir(BUILD);

// 1b. Write version.json
const versionInfo = {
  version: buildVersion,
  commit: gitInfo.commit,
  branch: gitInfo.branch,
  builtAt: buildDate,
};
fs.writeFileSync(path.join(BUILD, 'version.json'), JSON.stringify(versionInfo, null, 2));
console.log('  ✓ version.json written');

// 2. Copy CSS
copyDir(path.join(SRC, 'css'), path.join(BUILD, 'src', 'css'));
console.log('  ✓ CSS copied');

// 3. Copy JS
if (fs.existsSync(path.join(SRC, 'js'))) {
  copyDir(path.join(SRC, 'js'), path.join(BUILD, 'src', 'js'));
  console.log('  ✓ JS copied');
}

// 4. Copy assets
if (fs.existsSync(path.join(SRC, 'assets'))) {
  copyDir(path.join(SRC, 'assets'), path.join(BUILD, 'src', 'assets'));
  console.log('  ✓ Assets copied');
}

// 5. Copy all hand-crafted pages (root level)
const rootPages = ['index.html', 'contact.html', 'privacy.html', 'terms.html', 'login.html', '404.html'];
for (const file of rootPages) {
  const src = path.join(SRC, 'pages', file);
  if (fs.existsSync(src)) {
    const content = fs.readFileSync(src, 'utf8');
    fs.writeFileSync(path.join(BUILD, file), injectVersion(content));
    console.log(`  ✓ ${file}`);
  }
}

// Copy hand-crafted subdirectory pages
const subPages = [
  ['personal', 'index.html'],
  ['commercial', 'index.html'],
  ['life-health', 'index.html'],
  ['about', 'index.html'],
  ['about', 'team.html'],
  ['about', 'locations.html'],
  ['about', 'community.html'],
  ['about', 'careers.html'],
  ['blog', 'index.html'],
];
for (const [dir, file] of subPages) {
  const src = path.join(SRC, 'pages', dir, file);
  if (fs.existsSync(src)) {
    ensureDir(path.join(BUILD, dir));
    const content = fs.readFileSync(src, 'utf8');
    fs.writeFileSync(path.join(BUILD, dir, file), injectVersion(content));
    console.log(`  ✓ ${dir}/${file} (hand-crafted)`);
  }
}

// 5b. Copy hand-crafted blog posts from src/pages/blog/
const blogSrcDir = path.join(SRC, 'pages', 'blog');
if (fs.existsSync(blogSrcDir)) {
  ensureDir(path.join(BUILD, 'blog'));
  let blogCount = 0;
  for (const file of fs.readdirSync(blogSrcDir)) {
    if (file.endsWith('.html') && file !== 'index.html') {
      const content = fs.readFileSync(path.join(blogSrcDir, file), 'utf8');
      fs.writeFileSync(path.join(BUILD, 'blog', file), injectVersion(content));
      blogCount++;
    }
  }
  if (blogCount > 0) console.log(`  ✓ Copied ${blogCount} blog posts`);
}

// 6. Generate product pages from JSON
const lineMap = {
  personal: { name: 'Personal Insurance', slug: 'personal' },
  commercial: { name: 'Commercial Insurance', slug: 'commercial' },
  life_health: { name: 'Life & Health Insurance', slug: 'life-health' },
};

let generatedCount = 0;
for (const [lineKey, lineInfo] of Object.entries(lineMap)) {
  const lineProducts = products[lineKey] || [];
  ensureDir(path.join(BUILD, lineInfo.slug));

  for (const product of lineProducts) {
    const html = generateProductPage(product, lineInfo.name, lineInfo.slug, lineKey);
    const filename = `${product.slug}.html`;
    fs.writeFileSync(path.join(BUILD, lineInfo.slug, filename), injectVersion(html));
    generatedCount++;
  }
}
console.log(`  ✓ Generated ${generatedCount} product pages from JSON`);

// 6b. Generate geo-targeted city landing pages
const landingData = JSON.parse(fs.readFileSync(path.join(DATA, 'landing-pages.json'), 'utf8'));
ensureDir(path.join(BUILD, 'insurance'));
let geoCount = 0;

for (const city of landingData.cities) {
  const citySchema = `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "InsuranceAgency",
    "name": "The Way Agency",
    "url": "https://www.thewayagency.com",
    "telephone": "${office.phone}",
    "address": {"@type": "PostalAddress", "streetAddress": "${office.street}", "addressLocality": "${office.city}", "addressRegion": "${office.state}", "postalCode": "${office.zip}"},
    "areaServed": {"@type": "City", "name": "${city.city}", "containedIn": {"@type": "State", "name": "${city.state === 'KY' ? 'Kentucky' : city.state === 'IN' ? 'Indiana' : 'Tennessee'}"}}
  }
  </script>`;

  const cityFormHtml = renderInlineForm(city.slug, { city: city.city, state: city.state })
    .replace('%%FORM_HEADING%%', `Get a free insurance quote in ${city.city}`)
    .replace('%%FORM_SUBTEXT%%', 'Tell us your name and email and a licensed agent will follow up with options.');

  const pageHtml = `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: `Insurance in ${city.city}, ${city.state} | The Way Agency`,
    description: `Insurance agency serving ${city.city}, ${city.state}. Home, auto, commercial, and life insurance from top-rated carriers. Get a free quote today.`,
    canonical: `https://www.thewayagency.com/insurance/${city.slug}.html`,
    ogTitle: `Insurance in ${city.city}, ${city.state} | The Way Agency`,
    ogDescription: `Insurance agency serving ${city.city}, ${city.state}. Home, auto, commercial, and life insurance from top-rated carriers.`,
    ogUrl: `https://www.thewayagency.com/insurance/${city.slug}.html`,
    schema: citySchema,
  })}
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

${renderHero({
    eyebrow: `Serving ${city.county}`,
    title: `Insurance in ${city.city}, ${city.state}`,
    subtitle: `We represent dozens of carriers so you get the right coverage at the right price. Personal, commercial, and life insurance for ${city.city} families and businesses.`,
    buttons: [
      { href: `/intake/?city=${encodeURIComponent(city.city)}&state=${encodeURIComponent(city.state)}`, text: 'Get a Free Quote', className: 'btn btn--primary btn--lg' },
      { href: 'tel:+15024135335', text: `Call ${office.phone}`, className: 'btn btn--outline-white btn--lg' },
    ],
    minHeight: '45vh',
  })}

  <main id="main">
    <div class="trust-bar"><div class="trust-bar__inner">
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>Since 1998</div>
      <div class="trust-bar__divider"></div>
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Dozens of Carriers</div>
      <div class="trust-bar__divider"></div>
      <div class="trust-bar__item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Licensed in ${city.state}</div>
    </div></div>

    <section class="section">
      <div class="container container--narrow">
        <h2>Why ${city.city} families and businesses choose The Way Agency</h2>
        <p>${city.context}</p>
        <p>As an independent agency, we are not tied to one insurance company. We represent dozens of carriers  -  including Travelers, Progressive, Safeco, Chubb, The Hartford, and more  -  and we match you with the right ones for your specific situation in ${city.county}.</p>

        <h2>Insurance options in ${city.city}</h2>
        <div class="grid grid--3" style="margin:var(--space-xl) 0;">
          <a href="/personal/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Personal Insurance</h3><p class="card__text">Home, auto, umbrella, renters, flood, and specialty coverage.</p><span class="card__link">View options <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span></a>
          <a href="/commercial/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Commercial Insurance</h3><p class="card__text">Liability, property, auto, workers comp, cyber, bonds.</p><span class="card__link">View options <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span></a>
          <a href="/life-health/" class="card" style="text-decoration:none;"><h3 class="card__title" style="font-size:var(--text-xl);">Life &amp; Health</h3><p class="card__text">Medicare, health, life, disability, and employee benefits.</p><span class="card__link">View options <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span></a>
        </div>

${cityFormHtml}

        <h2>How it works</h2>
        <p><strong>1. Tell us what you need.</strong> Request a quote online or call ${office.phone}. We just need basic info to get started.</p>
        <p><strong>2. We find the right carriers.</strong> We compare options across dozens of carriers to find the best coverage and price for your situation in ${city.city}.</p>
        <p><strong>3. You choose with confidence.</strong> We present clear recommendations and help you understand exactly what you're buying. No pressure, no jargon.</p>
        <p style="color:var(--slate);font-size:var(--text-sm);">We aim to respond same-day during business hours (Mon–Fri, 8:30 AM – 5:00 PM).</p>
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
    })}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
  fs.writeFileSync(path.join(BUILD, 'insurance', `${city.slug}.html`), injectVersion(pageHtml));
  geoCount++;
}
console.log(`  ✓ Generated ${geoCount} geo-targeted city pages`);

// 6c. Generate industry landing pages
ensureDir(path.join(BUILD, 'industries'));
let indCount = 0;

for (const ind of landingData.industries) {
  const coverageList = ind.typical_coverage.map(c => `<li>${c}</li>`).join('\n            ');

  const indFormHtml = renderInlineForm(ind.slug, { industry: ind.slug, lineOfBusiness: 'commercial' })
    .replace('%%FORM_HEADING%%', `Get a quote for your ${ind.name.toLowerCase().replace(/s$/, '')} business`)
    .replace('%%FORM_SUBTEXT%%', 'Tell us about your business and we\'ll come back with coverage options from carriers that specialize in your industry.');

  const indHtml = `<!DOCTYPE html>
<html lang="en">
${renderHead({
    title: `Insurance for ${ind.name} in Kentucky | The Way Agency`,
    description: `Insurance for ${ind.name.toLowerCase()} in Kentucky, Indiana, and Tennessee. ${ind.description.split('.')[0]}. Get a free quote from top-rated carriers.`,
    canonical: `https://www.thewayagency.com/industries/${ind.slug}.html`,
    ogTitle: `Insurance for ${ind.name} in Kentucky | The Way Agency`,
    ogDescription: `Insurance for ${ind.name.toLowerCase()} in Kentucky, Indiana, and Tennessee. Get a free quote from top-rated carriers.`,
    ogUrl: `https://www.thewayagency.com/industries/${ind.slug}.html`,
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
    ],
    minHeight: '45vh',
    bgStyle: 'background:linear-gradient(135deg, #0F2240 0%, #173358 40%, #2680B5 100%);',
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
        <p>We represent dozens of carriers including specialty markets for ${ind.name.toLowerCase()}, which means we can often find coverage that generalist agencies cannot. We also handle certificates of insurance, additional insured endorsements, and audit support.</p>

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
    })}
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
  fs.writeFileSync(path.join(BUILD, 'industries', `${ind.slug}.html`), injectVersion(indHtml));
  indCount++;
}
console.log(`  ✓ Generated ${indCount} industry landing pages`);

// 7. Copy root files
for (const file of ['_redirects', '_headers', 'robots.txt']) {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(BUILD, file));
    console.log(`  ✓ ${file}`);
  }
}

// 8. Copy customer-facing portal pages (migrated from sage-server)
const portalPages = [
  { src: 'intake.html', dest: 'intake/index.html', sitemap: '/intake/' },
  { src: 'portal.html', dest: 'portal/index.html', sitemap: null },  // Token-based, not indexable
  { src: 'partner.html', dest: 'partner/index.html', sitemap: null }, // Token-based, not indexable
];
for (const page of portalPages) {
  const srcFile = path.join(SRC, page.src);
  if (fs.existsSync(srcFile)) {
    const destDir = path.join(BUILD, path.dirname(page.dest));
    ensureDir(destDir);
    const pageContent = fs.readFileSync(srcFile, 'utf8');
    fs.writeFileSync(path.join(BUILD, page.dest), injectVersion(pageContent));
    console.log(`  ✓ ${page.dest}`);
  }
}

// 9. Generate sitemap.xml (single generation with all pages)
const baseUrl = 'https://www.thewayagency.com';
const today = new Date().toISOString().split('T')[0];

// Use last_reviewed from seo.json for hand-crafted pages when available
function seoLastmod(urlPath) {
  const entry = seoData.pages && seoData.pages[urlPath];
  return entry && entry.last_reviewed ? entry.last_reviewed + '-01' : null;
}

const sitemapUrls = [
  { url: '/', priority: '1.0', freq: 'weekly', lastmod: seoLastmod('/') },
  { url: '/personal/', priority: '0.8', freq: 'monthly', lastmod: seoLastmod('/personal/') },
  { url: '/commercial/', priority: '0.8', freq: 'monthly', lastmod: seoLastmod('/commercial/') },
  { url: '/life-health/', priority: '0.8', freq: 'monthly', lastmod: seoLastmod('/life-health/') },
  { url: '/about/', priority: '0.7', freq: 'monthly', lastmod: seoLastmod('/about/') },
  { url: '/about/team.html', priority: '0.6', freq: 'monthly', lastmod: seoLastmod('/about/team.html') },
  { url: '/about/locations.html', priority: '0.6', freq: 'monthly', lastmod: seoLastmod('/about/locations.html') },
  { url: '/blog/', priority: '0.7', freq: 'weekly', lastmod: seoLastmod('/blog/') },
  { url: '/contact.html', priority: '0.6', freq: 'monthly', lastmod: seoLastmod('/contact.html') },
];

// Add all product pages (use last_reviewed date when available)
for (const [lineKey, lineInfo] of Object.entries(lineMap)) {
  for (const product of (products[lineKey] || [])) {
    sitemapUrls.push({ url: product.url, priority: '0.7', freq: 'monthly', lastmod: product.last_reviewed ? product.last_reviewed + '-01' : null });
  }
}

// Add geo city pages
for (const city of landingData.cities) {
  sitemapUrls.push({ url: `/insurance/${city.slug}.html`, priority: '0.6', freq: 'monthly' });
}

// Add industry pages
for (const ind of landingData.industries) {
  sitemapUrls.push({ url: `/industries/${ind.slug}.html`, priority: '0.6', freq: 'monthly' });
}

// Add blog posts (scan build/blog/ for .html files that aren't index.html)
const blogDir = path.join(BUILD, 'blog');
if (fs.existsSync(blogDir)) {
  for (const file of fs.readdirSync(blogDir)) {
    if (file.endsWith('.html') && file !== 'index.html') {
      sitemapUrls.push({ url: `/blog/${file}`, priority: '0.5', freq: 'monthly' });
    }
  }
}

// Add portal pages to sitemap
for (const page of portalPages) {
  if (page.sitemap && fs.existsSync(path.join(SRC, page.src))) {
    sitemapUrls.push({ url: page.sitemap, priority: '0.8', freq: 'monthly' });
  }
}

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url>
    <loc>${baseUrl}${u.url}</loc>
    <lastmod>${u.lastmod || today}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

fs.writeFileSync(path.join(BUILD, 'sitemap.xml'), sitemapXml);
console.log(`  ✓ sitemap.xml (${sitemapUrls.length} URLs)`);

console.log(`\n✅ Build complete! ${generatedCount + rootPages.length + subPages.length + portalPages.length} pages in build/`);
console.log(`   Total files: ${sitemapUrls.length} indexable URLs`);
