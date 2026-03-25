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

// ─── Load shared data and templates ──────────
const locations = JSON.parse(fs.readFileSync(path.join(DATA, 'locations.json'), 'utf8'));
const office = locations.offices[0];
const { renderNav, renderFooter, renderScripts } = require('./shared-templates');

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
${renderNav()}

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

${renderFooter(office)}
${renderScripts()}
</body>
</html>`;
}

// ─── Blog index page template ────────────────
function generateBlogIndex(allPosts) {
  const cards = allPosts.map(p => {
    const date = new Date(p.publish_date + 'T12:00:00');
    const dateLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    return `
          <a href="/blog/${p.slug}.html" class="card" style="text-decoration:none;">
            <p style="font-size:var(--text-xs);color:var(--slate);font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-sm);">${dateLabel}</p>
            <h3 class="card__title" style="font-size:var(--text-xl);">${p.title}</h3>
            <p class="card__text">${p.description}</p>
            <span class="card__link">Read article <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>
          </a>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Insurance Blog | Tips & Insights | The Way Agency</title>
  <meta name="description" content="Insurance insights, tips, and Kentucky-specific guidance from The Way Agency team. Practical advice in plain language.">
  <link rel="canonical" href="https://www.thewayagency.com/blog/">
    <meta name="google-site-verification" content="UR_730X-tkdo6fvlzh_yGux9csokDdBhdEJANQAYlEo">
  <link rel="icon" href="/src/assets/images/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/src/css/base.css">
  <link rel="stylesheet" href="/src/css/components.css">
  <link rel="stylesheet" href="/src/css/leadgen.css">

  <!-- Open Graph -->
  <meta property="og:title" content="Insurance Blog | Tips &amp; Insights | The Way Agency">
  <meta property="og:description" content="Insurance insights, tips, and Kentucky-specific guidance from The Way Agency team. Practical advice in plain language.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.thewayagency.com/blog/">
  <meta property="og:site_name" content="The Way Agency">
  <meta property="og:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">

  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": "Insurance Blog | Tips & Insights",
    "url": "https://www.thewayagency.com/blog/",
    "description": "Insurance insights, tips, and Kentucky-specific guidance from The Way Agency team.",
    "publisher": {
      "@type": "Organization",
      "name": "The Way Agency",
      "url": "https://www.thewayagency.com"
    }
  }
  </script>

</head>
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

  <section class="hero" style="min-height:35vh;">
    <div class="hero__bg"></div>
    <div class="hero__texture"></div>
    <div class="hero__content">
      <p class="hero__eyebrow">Blog</p>
      <h1 class="hero__title">Insurance insights<br>&amp; practical tips</h1>
      <p class="hero__subtitle">Practical advice from our licensed agents. No jargon, no fluff  -  just useful information for Kentucky families and businesses.</p>
    </div>
    <div class="hero__accent"></div>
  </section>

  <main id="main">
    <section class="section">
      <div class="container">
        <div class="grid grid--3">${cards}
        </div>
      </div>
    </section>

    <section class="cta-banner">
      <div class="container">
        <h2 class="cta-banner__title">Have an insurance question?</h2>
        <p class="cta-banner__text">We're happy to answer questions about your coverage, even if you're not a client yet.</p>
        <div class="cta-banner__actions">
          <a href="/intake/" class="btn btn--primary btn--lg">Get a Quote</a>
          <a href="/contact.html" class="btn btn--outline-white btn--lg">Ask a Question</a>
        </div>
      </div>
    </section>
  </main>

${renderFooter(office)}
${renderScripts()}
</body>
</html>`;
}

// ─── Build ──────────────────────────────────

// Ensure build/blog/ exists
if (!fs.existsSync(BLOG_BUILD)) {
  fs.mkdirSync(BLOG_BUILD, { recursive: true });
}

// 1. Convert Markdown posts to HTML
const posts = [];

if (fs.existsSync(BLOG_SRC)) {
  const mdFiles = fs.readdirSync(BLOG_SRC).filter(f => f.endsWith('.md'));
  if (mdFiles.length > 0) {
    console.log(`\n  Generating ${mdFiles.length} blog posts from Markdown...\n`);
    for (const file of mdFiles) {
      const raw = fs.readFileSync(path.join(BLOG_SRC, file), 'utf8');
      const { meta, body } = parseFrontMatter(raw);

      if (!meta.title || !meta.slug) {
        console.log(`  ! Skipping ${file}  -  missing title or slug in front matter`);
        continue;
      }

      const faqs = extractFAQs(body);
      const cleanBody = body.replace(/### FAQ: .+?\n\n[\s\S]*?(?=\n###|\n## |$)/g, '');
      const bodyHtml = markdownToHtml(cleanBody);
      const html = generateBlogPost(meta, bodyHtml, faqs);

      fs.writeFileSync(path.join(BLOG_BUILD, `${meta.slug}.html`), html);
      posts.push(meta);
      console.log(`  ✓ ${meta.slug}.html  -  "${meta.title}"`);
    }
  }
}

// 2. Generate blog index from content-calendar.json
const calendarPath = path.join(DATA, 'content-calendar.json');
if (fs.existsSync(calendarPath)) {
  const calendar = JSON.parse(fs.readFileSync(calendarPath, 'utf8'));

  // Collect all published posts: existing_posts + year1 entries with status "published"
  const allPublished = [];

  for (const post of (calendar.existing_posts || [])) {
    if (post.status === 'published') {
      allPublished.push({
        slug: post.slug,
        title: post.title,
        description: post.description,
        publish_date: post.publish_date
      });
    }
  }

  for (const post of (calendar.year1 || [])) {
    if (post.status === 'published') {
      allPublished.push({
        slug: post.slug,
        title: post.title,
        description: post.description,
        publish_date: post.publish_date
      });
    }
  }

  // Also include any markdown posts we just generated that aren't in the calendar
  for (const meta of posts) {
    const alreadyInCalendar = allPublished.some(p => p.slug === meta.slug);
    if (!alreadyInCalendar) {
      allPublished.push({
        slug: meta.slug,
        title: meta.title,
        description: meta.description || '',
        publish_date: meta.date
      });
    }
  }

  // Sort by date, newest first
  allPublished.sort((a, b) => new Date(b.publish_date) - new Date(a.publish_date));

  if (allPublished.length > 0) {
    const indexHtml = generateBlogIndex(allPublished);
    fs.writeFileSync(path.join(BLOG_BUILD, 'index.html'), indexHtml);
    console.log(`  ✓ blog/index.html (${allPublished.length} posts)`);
  }
} else {
  console.log('  ! No content-calendar.json found — skipping index generation');
}

const totalGenerated = posts.length;
console.log(`\n  Blog generation complete: ${totalGenerated} Markdown posts converted`);
console.log('   Run "node scripts/build.js" to copy static assets and update the sitemap.\n');
