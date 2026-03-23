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
        <img src="/src/assets/images/logo-horizontal.png" alt="The Way Agency" style="height:40px;width:auto;">
      </a>
      <div class="nav__links" id="navLinks">
        <a href="/personal/" class="nav__link">Personal</a>
        <a href="/commercial/" class="nav__link">Commercial</a>
        <a href="/life-health/" class="nav__link">Life &amp; Health</a>
        <a href="/about/" class="nav__link">About</a>
        <a href="/blog/" class="nav__link">Blog</a>
        <a href="/quote.html" class="btn btn--primary">Get a Quote</a>
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
          <a href="/quote.html" class="btn btn--primary btn--lg">Get a Quote</a>
          <a href="/contact.html" class="btn btn--outline-white btn--lg">Contact Us</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="footer__grid">
      <div class="footer__brand">
        <p class="footer__logo" style="font-family:var(--font-heading);font-size:var(--text-xl);font-weight:700;color:var(--white);margin-bottom:var(--space-lg);">The Way Agency</p>
        <address class="footer__address" style="font-style:normal;">${office.street}<br>${office.city}, ${office.state} ${office.zip}</address>
        <div class="footer__contact-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>
          <a href="tel:+15024135335">${office.phone}</a>
        </div>
        <div class="footer__contact-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          <a href="mailto:${office.email}">${office.email}</a>
        </div>
        <p style="font-size:var(--text-xs);margin-top:var(--space-md);color:rgba(255,255,255,0.5);">Mon–Fri: 8:30 AM – 5:00 PM</p>
      </div>
      <div>
        <h4 class="footer__heading">Insurance</h4>
        <div class="footer__link-list">
          <a href="/personal/">Personal</a>
          <a href="/commercial/">Commercial</a>
          <a href="/life-health/">Life &amp; Health</a>
          <a href="/quote.html">Get a Quote</a>
        </div>
      </div>
      <div>
        <h4 class="footer__heading">Company</h4>
        <div class="footer__link-list">
          <a href="/about/">About Us</a>
          <a href="/about/team.html">Our Team</a>
          <a href="/about/locations.html">Locations</a>
          <a href="/blog/">Blog</a>
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
