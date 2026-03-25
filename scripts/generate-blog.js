#!/usr/bin/env node
/**
 * The Way Agency  -  Blog Generator
 *
 * Converts Markdown blog posts in src/blog/ to HTML pages in build/blog/.
 * Also regenerates the blog index page with all posts sorted by date.
 *
 * Usage: node scripts/generate-blog.js
 *
 * Post format: Markdown files with YAML-like front matter:
 *
 *   ---
 *   title: Your Post Title
 *   slug: your-post-slug
 *   description: Meta description for SEO (150-160 chars)
 *   author: Sheilia Royal
 *   author_title: Agency Principal / Licensed Agent
 *   author_slug: sheilia-royal
 *   date: 2026-03-15
 *   modified: 2026-03-20
 *   reading_time: 5 min
 *   related_page: /personal/home.html
 *   tags: home insurance, kentucky, weather
 *   ---
 *
 *   Your markdown content here...
 *
 *   ## Heading
 *
 *   Paragraph text.
 *
 *   - List item
 *   - List item
 *
 *   **Bold text** and *italic text*.
 *
 *   ### FAQ: Is this a question?
 *
 *   Answer paragraph. (H3s starting with "FAQ:" become FAQ accordion items)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');
const BLOG_BUILD = path.join(ROOT, 'build', 'blog');
const DATA = path.join(ROOT, 'data');

// ─── Simple Markdown to HTML converter ──────
function markdownToHtml(md) {
  let html = md
    // Escape HTML entities in content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>\n${match}</ul>\n`)
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (lines not already wrapped in tags)
    .split('\n\n')
    .map(block => {
      block = block.trim();
      if (!block) return '';
      if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<ol') || block.startsWith('<div') || block.startsWith('<section') || block.startsWith('<table')) {
        return block;
      }
      return `<p>${block}</p>`;
    })
    .join('\n\n');

  return html;
}

// ─── Parse front matter ─────────────────────
function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      meta[key] = value;
    }
  });

  return { meta, body: match[2].trim() };
}

// ─── Extract FAQ items from content ─────────
function extractFAQs(body) {
  const faqs = [];
  const faqRegex = /### FAQ: (.+?)\n\n([\s\S]*?)(?=\n###|\n## |$)/g;
  let match;
  while ((match = faqRegex.exec(body)) !== null) {
    faqs.push({
      question: match[1].trim(),
      answer: match[2].trim().replace(/\n/g, ' ')
    });
  }
  return faqs;
}

// ─── Load shared data ───────────────────────
const locations = JSON.parse(fs.readFileSync(path.join(DATA, 'locations.json'), 'utf8'));
const office = locations.offices[0];

// ─── Blog post HTML template ────────────────
function generateBlogPost(meta, bodyHtml, faqs) {
  const faqSection = faqs.length > 0 ? `
      <section class="faq-section" style="margin-top:var(--space-2xl);">
        <h2>Frequently asked questions</h2>
        ${faqs.map(f => `
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

  const faqSchema = faqs.length > 0 ? `
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      ${faqs.map(f => `{
        "@type": "Question",
        "name": ${JSON.stringify(f.question)},
        "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(f.answer)} }
      }`).join(',\n      ')}
    ]
  }
  </script>` : '';

  const dateFormatted = new Date(meta.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${meta.title} | The Way Agency</title>
  <meta name="description" content="${meta.description || ''}">
  <link rel="canonical" href="https://www.thewayagency.com/blog/${meta.slug}.html">
  <meta property="og:title" content="${meta.title} | The Way Agency">
  <meta property="og:description" content="${meta.description || ''}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://www.thewayagency.com/blog/${meta.slug}.html">
  <meta property="og:site_name" content="The Way Agency">
  <meta property="og:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/css/base.css">
  <link rel="stylesheet" href="/src/css/components.css">
  <link rel="stylesheet" href="/src/css/leadgen.css">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(meta.title)},
    "author": {
      "@type": "Person",
      "name": ${JSON.stringify(meta.author)},
      "jobTitle": ${JSON.stringify(meta.author_title || 'Licensed Agent')},
      "url": "https://www.thewayagency.com/about/team.html#${meta.author_slug || ''}"
    },
    "publisher": {
      "@type": "InsuranceAgency",
      "name": "The Way Agency",
      "url": "https://www.thewayagency.com"
    },
    "datePublished": "${meta.date}",
    "dateModified": "${meta.modified || meta.date}",
    "description": ${JSON.stringify(meta.description || '')}
  }
  </script>${faqSchema}
</head>
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
  <nav class="nav" id="nav">
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
  </nav>

  <section class="hero" style="min-height:30vh;">
    <div class="hero__bg"></div><div class="hero__texture"></div>
    <div class="hero__content">
      <p class="hero__eyebrow"><a href="/blog/" style="color:var(--cyan);text-decoration:none;">Blog</a></p>
      <h1 class="hero__title" style="font-size:clamp(1.8rem,4vw,2.8rem);">${meta.title}</h1>
      <p class="hero__subtitle" style="font-size:var(--text-sm);">
        By <a href="/about/team.html#${meta.author_slug || ''}" style="color:var(--cyan);text-decoration:none;">${meta.author}</a>, ${meta.author_title || 'Licensed Agent'}
        &middot; ${dateFormatted} &middot; ${meta.reading_time || '5 min read'}
      </p>
    </div>
    <div class="hero__accent"></div>
  </section>

  <main id="main">
    <article class="product-content" style="max-width:var(--max-width-narrow);margin:0 auto;padding:var(--space-section) var(--space-xl);">
      ${bodyHtml}
      ${faqSection}
    </article>

    <section class="cta-banner">
      <div class="container">
        <h2 class="cta-banner__title">Have questions about your coverage?</h2>
        <p class="cta-banner__text">We're here to help. Get a free quote or request a coverage review.</p>
        <div class="cta-banner__actions">
          <a href="/intake/" class="btn btn--primary btn--lg">Get a Quote</a>
          <a href="/contact.html" class="btn btn--outline-white btn--lg">Contact Us</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
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
        <div class="footer__socials">
          <a href="https://www.facebook.com/TheWayAgency/" aria-label="Facebook" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg></a>
          <a href="https://www.instagram.com/thewayagencyins/" aria-label="Instagram" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg></a>
          <a href="https://www.linkedin.com/company/the-way-agency-insurance" aria-label="LinkedIn" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg></a>
        </div>
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
      <p>&copy; ${new Date().getFullYear()} The Way Agency. All rights reserved.</p>
      <div class="footer__legal-links">
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
      </div>
    </div>
    <p style="max-width:var(--max-width);margin:var(--space-sm) auto 0;padding:0 var(--space-xl);font-size:11px;color:rgba(255,255,255,0.3);">Licensed in KY, IN &amp; TN. Way Associates, Inc dba The Way Agency.</p>
  </footer>
  <div id="ai-chat-root"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
  <script src="/src/js/app.js"></script>
</body>
</html>`;
}

// ─── Build ──────────────────────────────────
if (!fs.existsSync(BLOG_SRC)) {
  console.log('No src/blog/ directory found. Create Markdown posts there to use the blog generator.');
  process.exit(0);
}

const mdFiles = fs.readdirSync(BLOG_SRC).filter(f => f.endsWith('.md'));
if (mdFiles.length === 0) {
  console.log('No Markdown files found in src/blog/');
  process.exit(0);
}

console.log(`\n📝 Generating ${mdFiles.length} blog posts...\n`);

const posts = [];

for (const file of mdFiles) {
  const raw = fs.readFileSync(path.join(BLOG_SRC, file), 'utf8');
  const { meta, body } = parseFrontMatter(raw);

  if (!meta.title || !meta.slug) {
    console.log(`  ⚠ Skipping ${file}  -  missing title or slug in front matter`);
    continue;
  }

  const faqs = extractFAQs(body);
  // Remove FAQ sections from body before converting (they render separately)
  const cleanBody = body.replace(/### FAQ: .+?\n\n[\s\S]*?(?=\n###|\n## |$)/g, '');
  const bodyHtml = markdownToHtml(cleanBody);
  const html = generateBlogPost(meta, bodyHtml, faqs);

  fs.writeFileSync(path.join(BLOG_BUILD, `${meta.slug}.html`), html);
  posts.push(meta);
  console.log(`  ✓ ${meta.slug}.html  -  "${meta.title}"`);
}

console.log(`\n✅ Generated ${posts.length} blog posts from Markdown`);
console.log('   Run "node scripts/build.js" to update the sitemap.\n');
