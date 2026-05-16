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
    // Horizontal rules (--- on its own line)
    .replace(/^\n?---\n?$/gm, '<hr>')
    // Stat highlights: !!!stat Value | Label
    .replace(/^!!!stat (.+?) \| (.+)$/gm,
      '<div class="stat-highlight"><span class="stat-highlight__number">$1</span><span class="stat-highlight__label">$2</span></div>')
    // Blockquotes / callout boxes (> lines, escaped to &gt;)
    .replace(/(^&gt; .+(\n|$))+/gm, (match) => {
      const content = match.replace(/^&gt; /gm, '').trim();
      let cls = '';
      if (/^\*\*Key takeaway/.test(content)) cls = ' callout--takeaway';
      else if (/^\*\*Important/.test(content)) cls = ' callout--important';
      else if (/^\*\*Tip/.test(content)) cls = ' callout--tip';
      else if (/^\*\*Example/.test(content)) cls = ' callout--example';
      return `<blockquote class="${cls.trim()}">${content}</blockquote>\n`;
    })
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
      if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<ol') || block.startsWith('<div') || block.startsWith('<section') || block.startsWith('<table') || block.startsWith('<blockquote') || block.startsWith('<hr')) {
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
      let value = line.slice(idx + 1).trim();
      // Strip surrounding quotes from YAML values
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Parse inline YAML arrays: [item1, item2, item3]
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
      }
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
const agency = locations.agency;
const _reviews = { rating: agency.google_rating || '5.0', count: agency.google_review_count || '20+' };
const { renderNav, renderFooter: _renderFooter, renderScripts, renderHead_GTM, renderBody_GTM } = require('./shared-templates');
function renderFooter() { return _renderFooter(office, _reviews); }

// ─── Reading Time Calculator ────────────────
function calculateReadingTime(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').length;
  return Math.max(1, Math.ceil(words / 200));
}

// ─── Table of Contents Generator ────────────
function generateTOC(html) {
  const headings = [];
  const regex = /<h([23])>(.*?)<\/h[23]>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const level = parseInt(match[1]);
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    headings.push({ level, text, id });
  }
  if (headings.length < 3) return { tocHtml: '', anchoredBody: html };

  // Add IDs to headings in the body
  let anchoredBody = html;
  for (const h of headings) {
    const tag = `h${h.level}`;
    // Replace first occurrence of this heading without an id
    anchoredBody = anchoredBody.replace(
      new RegExp(`<${tag}>${h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</${tag}>`),
      `<${tag} id="${h.id}">${h.text}</${tag}>`
    );
  }

  const tocItems = headings.map(h => {
    const indent = h.level === 3 ? 'padding-left:var(--space-lg);' : '';
    return `<li style="${indent}margin-bottom:4px;"><a href="#${h.id}" style="color:var(--slate);text-decoration:none;font-size:var(--text-sm);font-weight:${h.level === 2 ? '500' : '300'};">${h.text}</a></li>`;
  }).join('\n          ');

  const tocHtml = `
      <nav aria-label="Table of contents" style="background:var(--light-bg);border:1px solid var(--border);border-radius:var(--border-radius-lg);padding:var(--space-lg) var(--space-xl);margin-bottom:var(--space-2xl);">
        <p style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--navy);margin-bottom:var(--space-sm);">In this article</p>
        <ul style="list-style:none;padding:0;margin:0;">
          ${tocItems}
        </ul>
      </nav>`;

  return { tocHtml, anchoredBody };
}

// Extract the marketing product slug from a related_page path so the intake
// pre-select fires on click. /personal/home.html → "home" → intake aliases
// to "homeowners". Returns null when related_page is absent/general so the
// CTA stays bare (no misleading pre-selection on multi-product posts).
function productSlugFromRelatedPage(relatedPage) {
  if (!relatedPage || relatedPage === 'null') return null;
  const m = /\/(?:personal|commercial|life|health)\/([a-z0-9-]+)\.html$/i.exec(relatedPage);
  return m ? m[1] : null;
}

function intakeHref(relatedPage) {
  const slug = productSlugFromRelatedPage(relatedPage);
  return slug ? `/intake/?product=${slug}` : '/intake/';
}

// ─── Mid-Post CTA Injection ─────────────────
function injectMidPostCTA(html, category, relatedPage) {
  const categoryLabels = { personal: 'personal insurance', commercial: 'business insurance', life: 'life insurance', health: 'health insurance', life_health: 'life and health insurance' };
  const label = categoryLabels[category] || 'insurance';
  const href = intakeHref(relatedPage);
  const ctaHtml = `
      <div style="background:linear-gradient(135deg,var(--navy-dark),var(--navy));border-radius:var(--border-radius-lg);padding:var(--space-2xl);margin:var(--space-2xl) 0;text-align:center;">
        <p style="color:var(--white);font-size:var(--text-xl);font-weight:600;margin-bottom:var(--space-sm);">Need help with ${label}?</p>
        <p style="color:rgba(255,255,255,0.75);font-size:var(--text-sm);font-weight:300;margin-bottom:var(--space-lg);">Get a free quote from an independent agent. We shop top-rated carriers for you.</p>
        <a href="${href}" style="display:inline-block;padding:10px 24px;background:var(--cyan);color:var(--navy-dark);border-radius:var(--border-radius);font-size:var(--text-sm);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;text-decoration:none;">Get a Free Quote</a>
      </div>`;

  // Insert after the 3rd H2 if possible
  let count = 0;
  const result = html.replace(/<\/h2>/g, (match) => {
    count++;
    if (count === 3) return match + ctaHtml;
    return match;
  });
  return count >= 3 ? result : html;
}

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
  const authorLink = meta.author_slug
    ? `<a href="/about/team.html#${meta.author_slug}" style="color:var(--cyan);text-decoration:none;">${meta.author}</a>`
    : meta.author;

  // Reading time
  const readingMin = calculateReadingTime(bodyHtml);
  const readingTime = meta.reading_time || `${readingMin} min read`;

  // Table of contents
  const { tocHtml, anchoredBody } = generateTOC(bodyHtml);

  // Mid-post CTA
  const enhancedBody = injectMidPostCTA(anchoredBody, meta.category || '', meta.related_page);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${meta.title} | The Way Agency</title>
  <meta name="description" content="${meta.description || ''}">
  <meta name="theme-color" content="#173358">
  <meta name="google-site-verification" content="UR_730X-tkdo6fvlzh_yGux9csokDdBhdEJANQAYlEo">
  <link rel="icon" href="/src/assets/images/favicon.png">
  <link rel="apple-touch-icon" href="/src/assets/images/apple-touch-icon.png">
  <link rel="canonical" href="https://www.thewayagency.com/blog/${meta.slug}.html">
  <meta property="og:title" content="${meta.title} | The Way Agency">
  <meta property="og:description" content="${meta.description || ''}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://www.thewayagency.com/blog/${meta.slug}.html">
  <meta property="og:site_name" content="The Way Agency">
  <meta property="og:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">
  <meta property="og:image:width" content="631">
  <meta property="og:image:height" content="631">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="article:published_time" content="${meta.date}">
  <meta property="article:modified_time" content="${meta.modified || meta.date}">
  <meta property="article:author" content="${meta.author}">
  <meta property="article:section" content="${meta.category || 'insurance'}">
  ${(Array.isArray(meta.tags) ? meta.tags : (meta.tags || '').replace(/[\[\]]/g, '').split(',')).map(t => t.trim()).filter(Boolean).map(t => `<meta property="article:tag" content="${t}">`).join('\n  ')}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${meta.title}">
  <meta name="twitter:description" content="${meta.description || ''}">
  <meta name="twitter:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">
  <link rel="alternate" type="application/rss+xml" title="The Way Agency Blog" href="/blog/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="dns-prefetch" href="https://www.googletagmanager.com">
  <link rel="preconnect" href="https://challenges.cloudflare.com" crossorigin>
  <link rel="dns-prefetch" href="https://sage.thewayagency.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/css/base.css">
  <link rel="stylesheet" href="/src/css/components.css">
  <link rel="stylesheet" href="/src/css/leadgen.css">
  <link rel="stylesheet" href="/src/css/blog.css">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(meta.title)},
    "author": {
      "@type": "Person",
      "name": ${JSON.stringify(meta.author)},
      "jobTitle": ${JSON.stringify(meta.author_title || 'Licensed Agent')},
      "url": "https://www.thewayagency.com/about/team.html${meta.author_slug ? '#' + meta.author_slug : ''}"
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
${renderHead_GTM()}
</head>
<body>
${renderBody_GTM()}
  <a href="#main" class="skip-link">Skip to main content</a>
${renderNav()}

  <section class="hero" style="min-height:35vh;">
    <div class="hero__bg"></div>
    <div class="hero__texture"></div>
    <div class="hero__content">
      <p class="hero__eyebrow"><a href="/blog/" style="color:var(--cyan);text-decoration:none;">Blog</a></p>
      <h1 class="hero__title">${meta.title}</h1>
    </div>
    <div class="hero__accent"></div>
  </section>

  <main id="main">
    <article class="product-content blog-content">
      <div class="blog-meta">
        <span>Reviewed by ${authorLink}, ${meta.author_title || 'Licensed Agent'}, The Way Agency</span>
        <span>|</span>
        <span>Published ${dateFormatted}</span>
        <span>|</span>
        <span>${readingTime}</span>
      </div>
      <div class="blog-share" style="display:flex;gap:8px;margin-bottom:var(--space-lg);flex-wrap:wrap;">
        <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(meta.title)}&url=https://www.thewayagency.com/blog/${meta.slug}.html" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-xs);color:var(--slate);text-decoration:none;font-weight:500;" aria-label="Share on Twitter">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Share
        </a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=https://www.thewayagency.com/blog/${meta.slug}.html" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-xs);color:var(--slate);text-decoration:none;font-weight:500;" aria-label="Share on Facebook">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          Share
        </a>
        <a href="https://www.linkedin.com/sharing/share-offsite/?url=https://www.thewayagency.com/blog/${meta.slug}.html" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-xs);color:var(--slate);text-decoration:none;font-weight:500;" aria-label="Share on LinkedIn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
          Share
        </a>
        <button onclick="navigator.clipboard.writeText('https://www.thewayagency.com/blog/${meta.slug}.html').then(function(){this.textContent='Copied!';setTimeout(function(){this.textContent='Copy Link'}.bind(this),2000)}.bind(this))" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-xs);color:var(--slate);background:var(--white);cursor:pointer;font-family:var(--font-body);font-weight:500;" aria-label="Copy link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Copy Link
        </button>
      </div>
${tocHtml}
      ${enhancedBody}
      ${faqSection}
${meta.related_page ? `
      <h2 style="margin-top:var(--space-2xl);">Related Coverage</h2>
      <div class="related-posts">
        <a href="${meta.related_page}" class="card" style="text-decoration:none;">
          <h3 class="card__title" style="font-size:var(--text-xl);">${meta.related_page.replace(/^\/(personal|commercial|life|health)\//, '').replace(/\.html$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</h3>
          <p class="card__text">Learn more about this coverage and how it protects you.</p>
          <span class="card__link">Learn more <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>
        </a>
      </div>
` : ''}
    </article>

    <section class="cta-banner">
      <div class="container">
        <h2 class="cta-banner__title">${meta.cta_title || 'Have questions about your coverage?'}</h2>
        <p class="cta-banner__text">${meta.cta_text || "We're here to help. Get a quote or request a coverage review."}</p>
        <div class="cta-banner__actions">
          <a href="${intakeHref(meta.related_page)}" class="btn btn--primary btn--lg">Get a Quote</a>
          <a href="/contact.html" class="btn btn--outline-white btn--lg">Contact Us</a>
        </div>
      </div>
    </section>
  </main>

${renderFooter()}
${renderScripts()}
</body>
</html>`;
}

// ─── Blog index page template ────────────────
function generateBlogIndex(allPosts, postsMeta) {
  // Build category map from markdown posts metadata
  const categoryMap = {};
  for (const m of (postsMeta || [])) {
    if (m.category) categoryMap[m.slug] = m.category;
  }

  // Enrich posts with category for JSON data
  const postsData = allPosts.map(p => ({
    slug: p.slug,
    title: p.title,
    description: p.description || '',
    date: p.publish_date,
    category: categoryMap[p.slug] || p.category || ''
  }));

  const categories = [...new Set(postsData.map(p => p.category).filter(Boolean))].sort();
  const categoryLabels = { personal: 'Personal', commercial: 'Commercial', life: 'Life', health: 'Health', life_health: 'Life & Health', general: 'General' };

  const cards = allPosts.map(p => {
    const date = new Date(p.publish_date + 'T12:00:00');
    const dateLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    const cat = categoryMap[p.slug] || p.category || '';
    return `
          <a href="/blog/${p.slug}.html" class="card blog-card" data-category="${cat}" data-title="${p.title.toLowerCase()}" data-desc="${(p.description || '').toLowerCase()}" style="text-decoration:none;">
            <p style="font-size:var(--text-xs);color:var(--slate);font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-sm);">${dateLabel}${cat ? ` · ${categoryLabels[cat] || cat}` : ''}</p>
            <h3 class="card__title" style="font-size:var(--text-xl);">${p.title}</h3>
            <p class="card__text">${p.description}</p>
            <span class="card__link">Read article <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>
          </a>`;
  }).join('\n');

  const filterPills = categories.map(c =>
    `<button class="blog-filter__pill" data-category="${c}">${categoryLabels[c] || c}</button>`
  ).join('\n            ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Insurance Blog | Tips & Insights | The Way Agency</title>
  <meta name="description" content="Insurance insights, tips, and Kentucky-specific guidance from The Way Agency team. Practical advice in plain language.">
  <link rel="canonical" href="https://www.thewayagency.com/blog/">
    <meta name="theme-color" content="#173358">
  <meta name="google-site-verification" content="UR_730X-tkdo6fvlzh_yGux9csokDdBhdEJANQAYlEo">
  <link rel="icon" href="/src/assets/images/favicon.png">
  <link rel="apple-touch-icon" href="/src/assets/images/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="dns-prefetch" href="https://www.googletagmanager.com">
  <link rel="preconnect" href="https://challenges.cloudflare.com" crossorigin>
  <link rel="dns-prefetch" href="https://sage.thewayagency.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/src/css/base.css">
  <link rel="stylesheet" href="/src/css/components.css">
  <link rel="stylesheet" href="/src/css/leadgen.css">
  <link rel="stylesheet" href="/src/css/blog.css">
  <link rel="alternate" type="application/rss+xml" title="The Way Agency Blog" href="/blog/feed.xml">

  <!-- Open Graph -->
  <meta property="og:title" content="Insurance Blog | Tips &amp; Insights | The Way Agency">
  <meta property="og:description" content="Insurance insights, tips, and Kentucky-specific guidance from The Way Agency team. Practical advice in plain language.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.thewayagency.com/blog/">
  <meta property="og:site_name" content="The Way Agency">
  <meta property="og:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">
  <meta property="og:image:width" content="631">
  <meta property="og:image:height" content="631">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Insurance Blog | Tips &amp; Insights | The Way Agency">
  <meta name="twitter:description" content="Insurance insights, tips, and Kentucky-specific guidance from The Way Agency team. Practical advice in plain language.">
  <meta name="twitter:image" content="https://www.thewayagency.com/src/assets/images/logo-social.jpg">

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
${renderHead_GTM()}
</head>
<body>
${renderBody_GTM()}
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
        <div class="blog-filter">
          <input type="search" class="blog-filter__search" id="blogSearch" placeholder="Search articles..." aria-label="Search articles">
          <div class="blog-filter__pills">
            <button class="blog-filter__pill blog-filter__pill--active" data-category="">All</button>
            ${filterPills}
          </div>
        </div>
        <div class="grid grid--3" id="blogGrid">${cards}
        </div>
        <p id="blogNoResults" style="display:none;text-align:center;color:var(--slate);padding:var(--space-2xl) 0;">No articles found. Try a different search or category.</p>
      </div>
    </section>

    <script>
    (function() {
      var search = document.getElementById('blogSearch');
      var grid = document.getElementById('blogGrid');
      var cards = grid.querySelectorAll('.blog-card');
      var pills = document.querySelectorAll('.blog-filter__pill');
      var noResults = document.getElementById('blogNoResults');
      var activeCategory = '';
      var debounceTimer;

      function filter() {
        var q = search.value.toLowerCase().trim();
        var shown = 0;
        cards.forEach(function(card) {
          var matchCat = !activeCategory || card.dataset.category === activeCategory;
          var matchSearch = !q || card.dataset.title.indexOf(q) !== -1 || card.dataset.desc.indexOf(q) !== -1;
          card.style.display = matchCat && matchSearch ? '' : 'none';
          if (matchCat && matchSearch) shown++;
        });
        noResults.style.display = shown === 0 ? '' : 'none';
        // Update URL params
        var params = new URLSearchParams();
        if (activeCategory) params.set('category', activeCategory);
        if (q) params.set('q', q);
        var qs = params.toString();
        history.replaceState(null, '', qs ? '?' + qs : location.pathname);
        // Analytics
        if (window.dataLayer && q) {
          window.dataLayer.push({ event: 'blog_search', search_term: q });
        }
      }

      search.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(filter, 300);
      });

      pills.forEach(function(pill) {
        pill.addEventListener('click', function() {
          pills.forEach(function(p) { p.classList.remove('blog-filter__pill--active'); });
          pill.classList.add('blog-filter__pill--active');
          activeCategory = pill.dataset.category;
          filter();
          if (window.dataLayer) {
            window.dataLayer.push({ event: 'blog_filter', category: activeCategory || 'all' });
          }
        });
      });

      // Restore from URL params
      var params = new URLSearchParams(location.search);
      if (params.get('q')) { search.value = params.get('q'); }
      if (params.get('category')) {
        activeCategory = params.get('category');
        pills.forEach(function(p) {
          p.classList.toggle('blog-filter__pill--active', p.dataset.category === activeCategory);
        });
      }
      if (params.get('q') || params.get('category')) filter();
    })();
    </script>

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

${renderFooter()}
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

      // Skip future-dated posts
      if (meta.date && new Date(meta.date + 'T00:00:00') > new Date()) {
        console.log(`  ~ Scheduled ${meta.slug}.html  -  publishes ${meta.date}`);
        continue;
      }

      const faqs = extractFAQs(body);
      const cleanBody = body.replace(/### FAQ: .+?\n\n[\s\S]*?(?=\n###|\n## |$)/g, '');
      let bodyHtml = markdownToHtml(cleanBody);
      // Enhance first paragraph with text-lg class (matches hand-crafted posts)
      bodyHtml = bodyHtml.replace(/^<p>/, '<p class="text-lg">');
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

  // Filter out future-dated posts and sort by date, newest first
  const now = new Date();
  const readyToPublish = allPublished.filter(p => new Date(p.publish_date + 'T00:00:00') <= now);
  readyToPublish.sort((a, b) => new Date(b.publish_date) - new Date(a.publish_date));
  const allPublishedFiltered = readyToPublish;

  if (allPublishedFiltered.length > 0) {
    const indexHtml = generateBlogIndex(allPublishedFiltered, posts);
    fs.writeFileSync(path.join(BLOG_BUILD, 'index.html'), indexHtml);
    console.log(`  ✓ blog/index.html (${allPublishedFiltered.length} posts, ${allPublished.length - allPublishedFiltered.length} scheduled)`);

    // Inject "Related Articles" into each generated blog post (prefer same category)
    const arrowSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    for (const meta of posts) {
      const filePath = path.join(BLOG_BUILD, `${meta.slug}.html`);
      if (!fs.existsSync(filePath)) continue;
      let html = fs.readFileSync(filePath, 'utf8');

      // Find related posts: prefer same category, then fill with recent posts
      const others = allPublishedFiltered.filter(p => p.slug !== meta.slug);
      const sameCategory = meta.category ? others.filter(p => {
        // Check if calendar entry has matching category
        const calEntry = [...(calendar.existing_posts || []), ...(calendar.year1 || [])].find(c => c.slug === p.slug);
        return calEntry && calEntry.category === meta.category;
      }) : [];
      // Also check generated posts for category match
      const sameCategoryFromPosts = posts.filter(p => p.slug !== meta.slug && p.category === meta.category);
      const sameCategorySlugs = new Set([...sameCategory.map(p => p.slug), ...sameCategoryFromPosts.map(p => p.slug)]);
      const relatedFromCategory = others.filter(p => sameCategorySlugs.has(p.slug)).slice(0, 3);
      const remaining = relatedFromCategory.length < 3 ? others.filter(p => !sameCategorySlugs.has(p.slug)).slice(0, 3 - relatedFromCategory.length) : [];
      const related = [...relatedFromCategory, ...remaining].slice(0, 3);

      if (related.length > 0) {
        const relatedHtml = `
      <section style="margin-top:var(--space-2xl);padding-top:var(--space-2xl);border-top:1px solid var(--border);">
        <h2 style="font-size:var(--text-2xl);">Related Articles</h2>
        <div class="grid grid--3" style="margin-top:var(--space-lg);">
${related.map(p => `          <a href="/blog/${p.slug}.html" class="card" style="text-decoration:none;">
            <h3 class="card__title" style="font-size:var(--text-lg);">${p.title}</h3>
            <span class="card__link">Read article ${arrowSvg}</span>
          </a>`).join('\n')}
        </div>
      </section>`;
        html = html.replace('</article>', relatedHtml + '\n    </article>');
        fs.writeFileSync(filePath, html);
      }
    }
  }
} else {
  console.log('  ! No content-calendar.json found — skipping index generation');
}

// 3. Generate enhanced RSS feed
const rssItems = [];
const rssPosts = (typeof allPublishedFiltered !== 'undefined' ? allPublishedFiltered : posts.map(m => ({ slug: m.slug, title: m.title, description: m.description || '', publish_date: m.date }))).slice(0, 20);
// Build author/category map from posts metadata
const postMetaMap = {};
for (const m of posts) postMetaMap[m.slug] = m;

for (const p of rssPosts) {
  const meta = postMetaMap[p.slug] || {};
  const author = meta.author || 'The Way Agency';
  const category = meta.category || '';
  // Read full content for content:encoded if file exists
  let contentEncoded = '';
  const builtFile = path.join(BLOG_BUILD, `${p.slug}.html`);
  if (fs.existsSync(builtFile)) {
    const html = fs.readFileSync(builtFile, 'utf8');
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/);
    if (articleMatch) contentEncoded = articleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 2000);
  }

  rssItems.push(`    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>https://www.thewayagency.com/blog/${p.slug}.html</link>
      <guid isPermaLink="true">https://www.thewayagency.com/blog/${p.slug}.html</guid>
      <pubDate>${new Date(p.publish_date + 'T12:00:00').toUTCString()}</pubDate>
      <dc:creator><![CDATA[${author}]]></dc:creator>${category ? `
      <category><![CDATA[${category}]]></category>` : ''}
      <description><![CDATA[${p.description || ''}]]></description>${contentEncoded ? `
      <content:encoded><![CDATA[${contentEncoded}]]></content:encoded>` : ''}
    </item>`);
}

const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>The Way Agency Insurance Blog</title>
    <link>https://www.thewayagency.com/blog/</link>
    <description>Insurance insights, tips, and Kentucky-specific guidance from The Way Agency team.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="https://www.thewayagency.com/blog/feed.xml" rel="self" type="application/rss+xml"/>
${rssItems.join('\n')}
  </channel>
</rss>`;

fs.writeFileSync(path.join(BLOG_BUILD, 'feed.xml'), rssFeed);
console.log(`  ✓ blog/feed.xml (${rssItems.length} items)`);

const totalGenerated = posts.length;
console.log(`\n  Blog generation complete: ${totalGenerated} Markdown posts converted`);
console.log('   Run "node scripts/build.js" to copy static assets and update the sitemap.\n');
