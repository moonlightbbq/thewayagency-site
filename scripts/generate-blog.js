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
 *   author_slug: sheilia-royal      (only when that team member wrote it)
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
 *
 * The byline prints the data/team.json member author_slug names (their name
 * and title from team.json), or "The Way Agency" without one (or when the slug
 * names no member). author and author_title are never printed; the build warns
 * when they disagree with team.json (src/blog/README.md).
 */

const fs = require('fs');
const path = require('path');

const contentGuard = require('./lib/blog-content-guard');
// The agency reference and the canonical page and person IRIs (SCHEMA-02, SCHEMA-04).
const { orgRef, teamMemberUrl, blogPostUrl, SITE_URL } = require('./lib/entity');
const { isMedicarePost, renderTpmoForAreas } = require('./lib/medicare-disclaimer');

const ROOT = path.resolve(__dirname, '..');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');
const BLOG_BUILD = path.join(ROOT, 'build', 'blog');
const DATA = path.join(ROOT, 'data');

// The CMS TPMO record (data/medicare-tpmo.json; TRUST-01), read once. Medicare
// posts print its statement under the byline. renderTpmoForAreas() prints
// nothing unless the record is active with signed counts, so a missing or
// unreadable file means no statement (check-data-integrity.js reports it).
const TPMO_DATA = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'medicare-tpmo.json'), 'utf8')); } catch { return null; }
})();

// ─── Output encoding ─────────────────────────
//
// Every value that comes from a post's front matter, its FAQ text or the
// content calendar is DATA, never markup. Each one is encoded for the place it
// lands: esc() for HTML text and attribute values, ldJson() for a value inside
// an application/ld+json block, cdata() for RSS. Without this, a front-matter
// value such as `author_title: ...</span><span>Reviewed by <a ...>A Licensed
// Agent</a>` printed a "Reviewed by" byline (and an author_slug carrying `"`
// added a top-level reviewedBy to the JSON-LD) on a post that no reviewer
// approved, around the signed review gate (sage-server BL-07, AIA-018).

/** HTML-escape a value for element text or a double- or single-quoted attribute. */
function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A value as JSON for an inline <script type="application/ld+json"> block:
 * JSON.stringify (so no value can close a string or add a key), with '<', '>'
 * and '&' as \u escapes so no value can close the script element either.
 */
function ldJson(value, indent) {
  return JSON.stringify(value === undefined ? null : value, null, indent)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** A value inside <![CDATA[ ... ]]> (RSS): only ']]>' can end the section. */
function cdata(value) {
  return String(value === undefined || value === null ? '' : value).replace(/]]>/g, ']]]]><![CDATA[>');
}

// Slugs become file names, URL paths and fragments: lower-case letters, digits
// and hyphens only.
const SAFE_SLUG_RE = /^[a-z0-9-]+$/;
/** The slug when it is safe to use, else ''. */
function safeSlug(value) {
  const s = String(value === undefined || value === null ? '' : value);
  return SAFE_SLUG_RE.test(s) ? s : '';
}
/** A site-relative path (/x/y.html), else '' (an absolute or protocol-relative URL, 'null', anything else). */
function sitePath(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  return /^\/(?!\/)[^\s"'<>\\]*$/.test(s) ? s : '';
}
/** A markdown link target the body may use: anything but a script or data URL. */
function safeHref(url) {
  // Browsers drop ASCII control characters and spaces inside a scheme.
  const scheme = String(url).replace(/[\u0000-\u0020]/g, '').toLowerCase();
  return /^(?:javascript|vbscript|data):/.test(scheme) ? '#' : url;
}

/**
 * The text a reader sees in rendered body HTML: whitespace collapsed as a
 * browser collapses it (a line break inside a paragraph is a space), each
 * block on a line of its own, inline markup removed, entities decoded. The
 * renderer reads this, and each FAQ question and answer as printed, for
 * review-credit wording to log: what the page shows, not only what the
 * markdown says.
 */
function printedText(html) {
  return String(html === undefined || html === null ? '' : html)
    .replace(/\s+/g, ' ')
    .replace(/<\/?(?:p|h[1-6]|li|ul|ol|blockquote|div|hr|br|section|table|thead|tbody|tr|td|th|figure|figcaption|nav|pre)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ─── Simple Markdown to HTML converter ──────
function markdownToHtml(md) {
  let html = md
    // Escape HTML entities in content. Quotes too: link targets below land in
    // a double-quoted href, which a '"' in the markdown would otherwise close.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
    .replace(/\[(.+?)\]\((.+?)\)/g, (_m, text, url) => `<a href="${safeHref(url)}">${text}</a>`)
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
    // The id from the heading's text as written: a '"' is escaped in the
    // body (&quot;), and must not become "quot" in the anchor.
    const id = text.replace(/&quot;/g, '"').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    headings.push({ level, text, id });
  }
  if (headings.length < 3) return { tocHtml: '', anchoredBody: html };

  // Add IDs to headings in the body
  let anchoredBody = html;
  for (const h of headings) {
    const tag = `h${h.level}`;
    // Replace first occurrence of this heading without an id
    // A function replacement: '$&' or "$'" in a heading is text, not a pattern.
    anchoredBody = anchoredBody.replace(
      new RegExp(`<${tag}>${h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</${tag}>`),
      () => `<${tag} id="${h.id}">${h.text}</${tag}>`
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

// A Medicare post with no product page of its own sends readers to the
// Medicare intake, where the Medicare lead disclosure shows (TRUST-01).
function intakeHref(relatedPage, { medicare = false } = {}) {
  const slug = productSlugFromRelatedPage(relatedPage);
  if (slug) return `/intake/?product=${slug}`;
  return medicare ? '/intake/?product=medicare' : '/intake/';
}

// ─── Mid-Post CTA Injection ─────────────────
// On a Medicare post the CTA makes no "we shop carriers" claim: whether the
// agency sells Medicare Advantage or Part D for several companies is the
// owner's open answer (medicare-health-compliance.md 3.7 step 3, D-1).
function injectMidPostCTA(html, category, relatedPage, { medicare = false } = {}) {
  const categoryLabels = { personal: 'personal insurance', commercial: 'business insurance', life: 'life insurance', health: 'health insurance', life_health: 'life and health insurance' };
  const label = categoryLabels[category] || 'insurance';
  const href = intakeHref(relatedPage, { medicare });
  const ctaText = medicare
    ? 'Talk with a licensed agent about your Medicare options.'
    : 'Get a free quote from an independent agent. We shop top-rated carriers for you.';
  const ctaHtml = `
      <div style="background:linear-gradient(135deg,var(--navy-dark),var(--navy));border-radius:var(--border-radius-lg);padding:var(--space-2xl);margin:var(--space-2xl) 0;text-align:center;">
        <p style="color:var(--white);font-size:var(--text-xl);font-weight:600;margin-bottom:var(--space-sm);">Need help with ${label}?</p>
        <p style="color:rgba(255,255,255,0.75);font-size:var(--text-sm);font-weight:300;margin-bottom:var(--space-lg);">${ctaText}</p>
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

// ─── Sources (BLOG-02) ───────────────────────
// Front matter, one line: `sources: [Label | https://url, https://url]`.
// Each item is "Label | https://url" or a bare https URL (its label is then the
// host and path). parseFrontMatter() splits the list on commas, so a label or
// URL must not contain one. Only https URLs without spaces, quotes or angle
// brackets are kept; anything else is dropped, not printed.
const SOURCE_URL_RE = /^https:\/\/[^\s"'<>]+$/;

/** A bare URL's label: host (without "www.") and path. */
function sourceUrlLabel(url) {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname}`.replace(/\/$/, '');
  } catch { return url; }
}

/** The post's sources as [{ label, url }], in front-matter order. */
function postSources(meta) {
  const raw = Array.isArray(meta.sources) ? meta.sources : (meta.sources ? [meta.sources] : []);
  const out = [];
  for (const item of raw) {
    const parts = String(item).split(/\s+\|\s+/).map((p) => p.trim());
    const url = parts[parts.length - 1];
    if (!SOURCE_URL_RE.test(url)) continue;
    const label = parts.length > 1 ? parts.slice(0, -1).join(' | ') : sourceUrlLabel(url);
    if (label) out.push({ label, url });
  }
  return out;
}

// ─── Blog post HTML template ────────────────
/**
 * @param {object} meta     the post's front matter (parseFrontMatter)
 * @param {string} bodyHtml
 * @param {Array} faqs
 * @param {{team?: Array, tpmo?: object|null}} [opts]  team: data/team.json's
 *   team list: the byline's author name and title come from the member
 *   author_slug names, never from the front matter (blog-content-guard.js
 *   bylineAuthor). Without a matching member the agency is the author.
 *   tpmo: the data/medicare-tpmo.json record (a test passes a fixture); a
 *   Medicare post prints its statement under the byline when it is active.
 */
function generateBlogPost(meta, bodyHtml, faqs, { team = [], tpmo = TPMO_DATA } = {}) {
  // Every front-matter value below is encoded where it lands (esc / ldJson);
  // see "Output encoding" above. Slugs and paths are validated, not escaped:
  // an unsafe one is dropped.
  const slug = safeSlug(meta.slug);
  // Who wrote it: a data/team.json member (their name and title as team.json
  // gives them), or the agency. Free text from the front matter used to be
  // printed here, so `author_title: Licensed Agent | Reviewed by <a licensed
  // agent> on ...` read as a review credit nobody signed, and any name was
  // linked to the team page with the title "Licensed Agent" by default
  // (sage-server BL-07, AIA-018).
  const byline = contentGuard.bylineAuthor(meta, team);
  const authorSlug = byline ? byline.slug : '';

  const faqSection = faqs.length > 0 ? `
      <section class="faq-section" style="margin-top:var(--space-2xl);">
        <h2>Frequently asked questions</h2>
        ${faqs.map(f => `
        <div class="faq-item">
          <button class="faq-item__question" aria-expanded="false">
            <h3 style="margin:0;font-size:var(--text-lg);pointer-events:none;">${esc(f.question)}</h3>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;transition:transform 0.2s;pointer-events:none;"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="faq-item__answer">
            <p>${esc(f.answer)}</p>
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
        "name": ${ldJson(f.question)},
        "acceptedAnswer": { "@type": "Answer", "text": ${ldJson(f.answer)} }
      }`).join(',\n      ')}
    ]
  }
  </script>` : '';

  const fmtDate = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const dateFormatted = fmtDate(meta.date);
  const writtenBy = byline
    ? `Written by <a href="/about/team.html#${authorSlug}" style="color:var(--cyan);text-decoration:none;">${esc(byline.name)}</a>${byline.title ? `, ${esc(byline.title)}` : ''}, ${esc(contentGuard.AGENCY_AUTHOR)}`
    : `Written by ${esc(contentGuard.AGENCY_AUTHOR)}`;

  // Byline honesty rule. "Written by" is a fact we always know. "Reviewed by"
  // is a professional-review claim on a regulated-industry page, so it renders
  // ONLY when a named reviewer AND the date they signed off are both on the
  // post. It used to print `Reviewed by ${author}` unconditionally, which meant
  // 41 posts claimed review by "The Way Agency" and 28 more put a licensed
  // agent's name against a review that has no record of happening. A post with
  // no recorded reviewer now simply makes no review claim.
  const reviewerName = meta.reviewer || meta.reviewed_by || '';
  const reviewerSlug = safeSlug(meta.reviewer_slug);
  const reviewerLink = reviewerSlug
    ? `<a href="/about/team.html#${reviewerSlug}" style="color:var(--cyan);text-decoration:none;">${esc(reviewerName)}</a>`
    : esc(reviewerName);
  const hasReview = Boolean(reviewerName && meta.reviewed_date);

  // Reading time: the front matter's only in its plain form ("6 min read"),
  // else computed. It is printed inside the byline.
  const readingMin = calculateReadingTime(bodyHtml);
  const readingTime = contentGuard.READING_TIME_RE.test(String(meta.reading_time || '')) ? String(meta.reading_time) : `${readingMin} min read`;

  // Table of contents
  const { tocHtml, anchoredBody } = generateTOC(bodyHtml);

  // Mid-post CTA
  const relatedPage = sitePath(meta.related_page);
  const medicarePost = isMedicarePost(meta);
  const enhancedBody = injectMidPostCTA(anchoredBody, meta.category || '', relatedPage, { medicare: medicarePost });

  // CMS TPMO statement under the byline of every Medicare post (TRUST-01,
  // 42 CFR 422.2267(e)(41)(iv)): '' unless the record is active with counts.
  const tpmoHtml = medicarePost && tpmo && tpmo.display && tpmo.display.medicare_posts ? renderTpmoForAreas(tpmo) : '';

  // Sources (BLOG-02): after the FAQ, outside the body, so they are neither in
  // the table of contents nor counted for the mid-post CTA.
  const sources = postSources(meta);
  const sourcesSection = sources.length ? `
      <section class="blog-sources" aria-labelledby="sources-heading">
        <h2 id="sources-heading">Sources</h2>
        <ul>
          ${sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a></li>`).join('\n          ')}
        </ul>
      </section>` : '';

  // Featured image (optional front matter: image + image_alt). Site-relative
  // path in front matter; og/twitter need the absolute URL. Falls back to the
  // social logo when a post has no image.
  const featuredImage = sitePath(meta.image) || null;
  const featuredAlt = String(meta.image_alt || meta.title || '').trim();
  const ogImage = featuredImage ? `https://www.thewayagency.com${featuredImage}` : 'https://www.thewayagency.com/src/assets/images/logo-social.jpg';
  const ogImageW = featuredImage ? '1536' : '631';
  const ogImageH = featuredImage ? '1024' : '631';
  const featuredFigure = featuredImage
    ? `<figure class="blog-featured-image" style="margin:0 0 1.5rem;"><img src="${esc(featuredImage)}" alt="${esc(featuredAlt)}" width="1536" height="1024" loading="eager" fetchpriority="high" style="width:100%;height:auto;border-radius:12px;display:block;"></figure>\n      `
    : '';

  // Article structured data, built as an object and serialized once: no
  // front-matter value can add a key (such as "reviewedBy") or close the block.
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${blogPostUrl(slug)}#article`,
    "url": blogPostUrl(slug),
    // schema.org defines reviewedBy and lastReviewed on WebPage only, so a
    // signed review credit sits on the page the article is the main entity of.
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": blogPostUrl(slug),
      "url": blogPostUrl(slug),
      ...(hasReview ? {
        "reviewedBy": {
          "@type": "Person",
          "name": String(reviewerName),
          ...(reviewerSlug ? { "@id": teamMemberUrl(reviewerSlug), "url": teamMemberUrl(reviewerSlug) } : {}),
        },
        "lastReviewed": String(meta.reviewed_date),
      } : {}),
    },
    "headline": String(meta.title || ''),
    "author": byline ? {
      "@type": "Person",
      "@id": teamMemberUrl(authorSlug),
      "name": byline.name,
      ...(byline.title ? { "jobTitle": byline.title } : {}),
      "url": teamMemberUrl(authorSlug),
    } : {
      "@type": "Organization",
      ...orgRef(),
      "name": contentGuard.AGENCY_AUTHOR,
    },
    "publisher": orgRef(),
    // Only an image the post itself carries (front matter), never the logo.
    ...(featuredImage ? { "image": [`${SITE_URL}${featuredImage}`] } : {}),
    "datePublished": String(meta.date || ''),
    "dateModified": String(meta.modified || meta.date || ''),
    "description": String(meta.description || ''),
    ...(sources.length ? { "citation": sources.map((s) => s.url) } : {}),
  };
  const tags = (Array.isArray(meta.tags) ? meta.tags : String(meta.tags || '').replace(/[\[\]]/g, '').split(','))
    .map(t => String(t).trim()).filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(meta.title)} | The Way Agency</title>
  <meta name="description" content="${esc(meta.description)}">
  <meta name="theme-color" content="#173358">
  <meta name="google-site-verification" content="UR_730X-tkdo6fvlzh_yGux9csokDdBhdEJANQAYlEo">
  <link rel="icon" href="/src/assets/images/favicon.png">
  <link rel="apple-touch-icon" href="/src/assets/images/apple-touch-icon.png">
  <link rel="canonical" href="https://www.thewayagency.com/blog/${slug}">
  <meta property="og:title" content="${esc(meta.title)} | The Way Agency">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://www.thewayagency.com/blog/${slug}">
  <meta property="og:site_name" content="The Way Agency">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:width" content="${ogImageW}">
  <meta property="og:image:height" content="${ogImageH}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="article:published_time" content="${esc(meta.date)}">
  <meta property="article:modified_time" content="${esc(meta.modified || meta.date)}">
  <meta property="article:author" content="${esc(byline ? byline.name : contentGuard.AGENCY_AUTHOR)}">
  <meta property="article:section" content="${esc(meta.category || 'insurance')}">
  ${tags.map(t => `<meta property="article:tag" content="${esc(t)}">`).join('\n  ')}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(meta.title)}">
  <meta name="twitter:description" content="${esc(meta.description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">
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
  ${ldJson(articleLd, 2).replace(/\n/g, '\n  ')}
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
      <h1 class="hero__title">${esc(meta.title)}</h1>
    </div>
    <div class="hero__accent"></div>
  </section>

  <main id="main">
    <article class="product-content blog-content">
      ${featuredFigure}<div class="blog-meta">
        <span>${writtenBy}</span>
        <span>|</span>${hasReview ? `
        <span>Reviewed by ${reviewerLink}${meta.reviewer_title ? `, ${esc(meta.reviewer_title)}` : ''} on ${esc(fmtDate(meta.reviewed_date))}</span>
        <span>|</span>` : ''}
        <span>Published ${esc(dateFormatted)}</span>
        <span>|</span>
        <span>${esc(readingTime)}</span>
      </div>${tpmoHtml ? `
      ${tpmoHtml}` : ''}
      <div class="blog-share" style="display:flex;gap:8px;margin-bottom:var(--space-lg);flex-wrap:wrap;">
        <a href="https://twitter.com/intent/tweet?text=${esc(encodeURIComponent(String(meta.title || '')))}&url=https://www.thewayagency.com/blog/${slug}.html" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-xs);color:var(--slate);text-decoration:none;font-weight:500;" aria-label="Share on Twitter">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Share
        </a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=https://www.thewayagency.com/blog/${slug}.html" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-xs);color:var(--slate);text-decoration:none;font-weight:500;" aria-label="Share on Facebook">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          Share
        </a>
        <a href="https://www.linkedin.com/sharing/share-offsite/?url=https://www.thewayagency.com/blog/${slug}.html" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-xs);color:var(--slate);text-decoration:none;font-weight:500;" aria-label="Share on LinkedIn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
          Share
        </a>
        <button onclick="navigator.clipboard.writeText('https://www.thewayagency.com/blog/${slug}.html').then(function(){this.textContent='Copied!';setTimeout(function(){this.textContent='Copy Link'}.bind(this),2000)}.bind(this))" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--border-radius);font-size:var(--text-xs);color:var(--slate);background:var(--white);cursor:pointer;font-family:var(--font-body);font-weight:500;" aria-label="Copy link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Copy Link
        </button>
      </div>
${tocHtml}
      ${enhancedBody}
      ${faqSection}${sourcesSection}
${relatedPage ? `
      <h2 style="margin-top:var(--space-2xl);">Related Coverage</h2>
      <div class="related-posts">
        <a href="${esc(relatedPage)}" class="card" style="text-decoration:none;">
          <h3 class="card__title" style="font-size:var(--text-xl);">${esc(relatedPage.replace(/^\/(personal|commercial|life|health)\//, '').replace(/\.html$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</h3>
          <p class="card__text">Learn more about this coverage and how it protects you.</p>
          <span class="card__link">Learn more <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>
        </a>
      </div>
` : ''}
    </article>

    <section class="cta-banner">
      <div class="container">
        <h2 class="cta-banner__title">${esc(meta.cta_title || 'Have questions about your coverage?')}</h2>
        <p class="cta-banner__text">${esc(meta.cta_text || "We're here to help. Get a quote or request a coverage review.")}</p>
        <div class="cta-banner__actions">
          <a href="${intakeHref(relatedPage, { medicare: medicarePost })}" class="btn btn--primary btn--lg">Get a Quote</a>
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
    // Titles and descriptions come from the calendar and from front matter:
    // data, encoded (see "Output encoding").
    return `
          <a href="/blog/${esc(p.slug)}.html" class="card blog-card" data-category="${esc(cat)}" data-title="${esc(String(p.title || '').toLowerCase())}" data-desc="${esc(String(p.description || '').toLowerCase())}" style="text-decoration:none;">
            <p style="font-size:var(--text-xs);color:var(--slate);font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-sm);">${esc(dateLabel)}${cat ? ` · ${esc(categoryLabels[cat] || cat)}` : ''}</p>
            <h3 class="card__title" style="font-size:var(--text-xl);">${esc(p.title)}</h3>
            <p class="card__text">${esc(p.description)}</p>
            <span class="card__link">Read article <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>
          </a>`;
  }).join('\n');

  const filterPills = categories.map(c =>
    `<button class="blog-filter__pill" data-category="${esc(c)}">${esc(categoryLabels[c] || c)}</button>`
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
    "publisher": ${ldJson(orgRef())}
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

// The page template and its encoders are importable, so a test can render
// hostile front matter through generateBlogPost directly (the build's own
// front-matter gate would otherwise stop it first). The build below runs only
// when this file is the program: `node scripts/generate-blog.js`, as
// scripts/builders/blog-helpers.js runs it. (A top-level return is legal in a
// CommonJS module.)
module.exports = { esc, ldJson, cdata, safeSlug, sitePath, safeHref, printedText, markdownToHtml, parseFrontMatter, extractFAQs, generateBlogPost, postSources, intakeHref, injectMidPostCTA };
if (require.main !== module) return;

// ─── Build ──────────────────────────────────

// Ensure build/blog/ exists
if (!fs.existsSync(BLOG_BUILD)) {
  fs.mkdirSync(BLOG_BUILD, { recursive: true });
}

// 1. Convert Markdown posts to HTML
//
// This is the step that actually publishes a page, so it applies the same
// rules as the publisher (scripts/lib/review-credit.js renderDecision) rather
// than trusting whatever a markdown file's front matter says (sage-server
// BL-07, AIA-018):
//   - a post on a reviewer's change-request hold is never rendered, even past
//     its date: it publishes only once its reviewer approves a version in SAGE
//     (or the hold is released);
//   - an entry the publisher put in 'error' (an approval whose bytes, byline or
//     signature no longer match, unready markdown), or one whose status this
//     repo does not know, is not rendered;
//   - a scheduled post renders once it is due only if the publisher would
//     publish it now;
//   - "Reviewed by" renders ONLY for an approval SAGE signed whose bytes are
//     the ones on disk (the publisher's credit record for a published post,
//     the approval itself for one it has not published yet). Review lines in
//     a file's front matter are otherwise ignored, however they are spelled,
//     and every other front-matter value is encoded as data (esc / ldJson),
//     so no value can print a byline or add a reviewedBy of its own;
//   - the "Written by" byline is a data/team.json member (their name and
//     title as team.json gives them) or the agency, never front-matter text;
//   - a post whose front matter carries markup, an invisible, control or
//     bidi character, an unsafe slug, or a date that is not its plain form
//     is not rendered at all (blog-content-guard.js, through review-credit.js
//     renderDecision): deterministic rules only. Any other printable
//     character (an arrow, an emoji, another script) renders, encoded; a
//     reading_time that is not "N min" or "N min read" is logged and the
//     computed time is printed instead;
//   - wording that reads as a review or approval credit (in any front-matter
//     value the page prints, in the body as the page prints it, or in the
//     text this run actually rendered) is logged as a warning and the post
//     renders as written: free text can always claim a review, so code does
//     not try to stop it; the structured credit above is the only one the
//     site vouches for, and a person approves AI-written text in SAGE with
//     the same warning in front of them (BL-06, BL-07);
//   - without a readable content calendar nothing is rendered and the build
//     fails: holds and errors cannot be told apart from silence, and the last
//     deploy stays live;
//   - a calendar post renders only from its own file, under its own slug;
//   - build/blog/ ends up holding only the pages this run rendered and the
//     frozen hand-made pages (scripts/lib/legacy-blog-pages.js) no markdown
//     post claims: anything else there, such as a hand-made copy of a post
//     this run refused to render, is removed.
const {
  isKnownStatus, isPublishable, isHeld,
} = require('./lib/calendar-status');
const {
  renderDecision, reviewSecret, isReviewerKey, reviewWordingWarnings, describeWordingWarning,
} = require('./lib/review-credit');
const { LEGACY_BLOG_PAGES } = require('./lib/legacy-blog-pages');

const RENDER_TODAY = new Date().toISOString().split('T')[0]; // YYYY-MM-DD, as the publisher
// Cloudflare Pages builds every pushed branch (Preview) with that branch's own
// code. BLOG_REVIEW_TOKEN_SECRET belongs to the Production environment only:
// a branch build that has it can print it, and with it sign an approval_mac or
// credit_mac offline that verifies on main. A Preview build that has it says
// so loudly and credits no one; the variable must be removed from Preview.
const PREVIEW_BRANCH = process.env.CF_PAGES === '1' && process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== 'main'
  ? process.env.CF_PAGES_BRANCH : null;
let REVIEW_SECRET = reviewSecret(process.env);
if (PREVIEW_BRANCH && REVIEW_SECRET) {
  console.log(`  ! BLOG_REVIEW_TOKEN_SECRET is set in a Cloudflare Pages PREVIEW build (branch ${JSON.stringify(PREVIEW_BRANCH).slice(0, 80)}). `
    + 'Branch code can read it and forge review credits on main: remove it from the Preview environment (Production only) and rotate it. '
    + 'This build credits no one.');
  REVIEW_SECRET = null;
}
if (!REVIEW_SECRET) {
  console.log('  ! BLOG_REVIEW_TOKEN_SECRET is not set (or under 32 characters, or this is a Preview build): no "Reviewed by" credit can be verified, so none is rendered');
}
const calendarEntries = (() => {
  const bySlug = new Map();
  const calPath = path.join(DATA, 'content-calendar.json');
  try {
    if (!fs.existsSync(calPath)) return { bySlug, calendar: null, error: 'the file is missing' };
    const cal = JSON.parse(fs.readFileSync(calPath, 'utf8'));
    if (!cal || typeof cal !== 'object' || (!Array.isArray(cal.existing_posts) && !Array.isArray(cal.year1))) {
      return { bySlug, calendar: null, error: 'it has neither an existing_posts nor a year1 list' };
    }
    for (const list of [cal.existing_posts, cal.year1]) {
      for (const p of Array.isArray(list) ? list : []) if (p && p.slug) bySlug.set(p.slug, p);
    }
    return { bySlug, calendar: cal, error: null };
  } catch (err) {
    return { bySlug, calendar: null, error: err && err.message ? err.message : String(err) };
  }
})();
if (calendarEntries.error) {
  // Fail closed. Without the calendar a post on a reviewer's change-request
  // hold, one in 'error' and one not yet due all look uncalendared, and would
  // render on their front-matter dates: text a reviewer objected to would go
  // live. So nothing is rendered or removed, and the build fails (scripts/
  // build.js stops on this exit code); Cloudflare Pages keeps the last deploy.
  console.error(`  ✗ data/content-calendar.json could not be read (${calendarEntries.error}). Holds and errors cannot be identified, `
    + 'so no blog post is rendered and the build fails. Restore the file from git history (the last good commit) and rebuild.');
  process.exit(1);
}
const REVIEW_TEAM = (() => {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(DATA, 'team.json'), 'utf8'));
    return Array.isArray(t) ? t : (t.team || []);
  } catch { return []; }
})();
const posts = [];
// What this run rendered, the URL slugs markdown files claim (a hand-made page
// of that name is not kept), and why a post was not rendered.
const renderedSlugs = new Set();
const claimedSlugs = new Set();
const notRendered = new Map();

if (fs.existsSync(BLOG_SRC)) {
  const mdFiles = fs.readdirSync(BLOG_SRC).filter(f => f.endsWith('.md'));
  if (mdFiles.length > 0) {
    console.log(`\n  Generating ${mdFiles.length} blog posts from Markdown...\n`);
    for (const file of mdFiles) {
      const rawBytes = fs.readFileSync(path.join(BLOG_SRC, file));
      const peek = parseFrontMatter(rawBytes.toString('utf8')).meta;
      claimedSlugs.add(file.slice(0, -'.md'.length));
      if (typeof peek.slug === 'string' && peek.slug) claimedSlugs.add(peek.slug);

      if (!peek.title || !peek.slug) {
        console.log(`  ! Skipping ${file}  -  missing title or slug in front matter`);
        continue;
      }

      // The slug is the output file name and part of every URL on the page.
      if (!safeSlug(peek.slug)) {
        console.log(`  ! Skipping ${file}  -  its slug ${JSON.stringify(String(peek.slug)).slice(0, 80)} is not lower-case letters, digits and hyphens`);
        continue;
      }

      const entry = calendarEntries.bySlug.get(peek.slug) || null;
      // A calendar post renders only from its own file: another file claiming
      // its slug would otherwise publish at its URL around its hold or approval.
      if (entry && file !== `${peek.slug}.md`) {
        console.log(`  ! Skipping ${file}  -  its slug "${peek.slug}" belongs to the calendar post src/blog/${peek.slug}.md`);
        continue;
      }
      // ...and a calendar post's own file renders only under its own slug: a
      // held or failed post whose front matter claimed another slug would
      // otherwise render there as an uncalendared post, around its hold.
      const stem = file.slice(0, -'.md'.length);
      if (calendarEntries.bySlug.has(stem) && peek.slug !== stem) {
        console.log(`  ! Skipping ${file}  -  slug mismatch: it is the calendar post "${stem}" but its front matter says slug "${peek.slug}"`);
        continue;
      }
      // The shared rule (scripts/lib/review-credit.js renderDecision): since the
      // owner's decision of 2026-10-02 a due post renders only once its
      // licensed reviewer approved it; an unapproved one is HELD (not rendered).
      const decision = renderDecision(entry, rawBytes, REVIEW_TEAM, { secret: REVIEW_SECRET, today: RENDER_TODAY, isKnownStatus, isPublishable, isHeld });
      if (!decision.render) {
        console.log(`  ~ Not rendered ${peek.slug}.html  -  ${decision.why}`);
        notRendered.set(peek.slug, decision.why);
        continue;
      }

      if (!decision.credit && entry && (entry.credit_mac || entry.credited_sha256)) {
        // A credit the publisher recorded no longer verifies (the file changed,
        // the reviewer left or lost their licences, no secret here): say so.
        console.log(`  ! ${peek.slug}: rendered with no reviewer credited  -  ${decision.why}`);
      }
      const { meta, body } = parseFrontMatter(decision.markdown);
      if (!decision.credit) {
        // Whatever survived the strip (any spelling of a review key): no claim.
        for (const key of Object.keys(meta)) if (isReviewerKey(key)) delete meta[key];
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
      // Review-credit wording is flagged, never refused (sage-server BL-07):
      // the post renders as written, and only a signed approval prints a
      // structured credit. The guard reads the markdown the way this renderer
      // prints it; when it finds nothing in the body, the text this run
      // actually rendered (the body, each FAQ question and answer) is read
      // too, for any way the two differ.
      const wording = reviewWordingWarnings(decision.markdown, REVIEW_TEAM);
      if (!wording.some((w) => w.field === 'body' || w.field === 'FAQ')) {
        const printed = [...printedText(bodyHtml).split('\n'), ...faqs.flatMap((f) => [f.question, f.answer])];
        for (const text of printed) {
          const found = text.trim() ? contentGuard.reviewClaimIn(text, REVIEW_TEAM) : null;
          if (found) wording.push({ field: 'rendered text', text: text.replace(/\s+/g, ' ').trim().slice(0, 500), wording: found });
        }
      }
      for (const w of wording) console.log(describeWordingWarning(meta.slug, w));
      // author and author_title are never printed; say so when they disagree
      // with data/team.json (a new title, a member who left), so the front
      // matter can be brought in line. The post renders either way.
      const bylineIssue = contentGuard.bylineProblem(decision.markdown, REVIEW_TEAM);
      if (bylineIssue) {
        const printedAuthor = contentGuard.bylineAuthor(meta, REVIEW_TEAM);
        console.log(`  ! ${meta.slug}: ${bylineIssue}; the byline prints ${printedAuthor ? `${printedAuthor.name} as data/team.json gives them` : contentGuard.AGENCY_AUTHOR}`);
      }
      // A reading_time that is not "N min" or "N min read" is not printed: the
      // page prints the computed time (generateBlogPost). The post renders;
      // say so, so the front matter can be brought in line.
      if (meta.reading_time && !contentGuard.READING_TIME_RE.test(String(meta.reading_time))) {
        console.log(`  ! ${meta.slug}: the front-matter reading_time ${JSON.stringify(String(meta.reading_time).slice(0, 80))} is not "N min" or "N min read"; the page prints the computed reading time instead`);
      }
      const html = generateBlogPost(meta, bodyHtml, faqs, { team: REVIEW_TEAM });

      fs.writeFileSync(path.join(BLOG_BUILD, `${meta.slug}.html`), html);
      renderedSlugs.add(meta.slug);
      posts.push(meta);
      console.log(`  ✓ ${meta.slug}.html  -  "${meta.title}"`);
    }
  }
}

// 1b. build/blog/ holds only what this run rendered, the index, and the frozen
// hand-made pages that no markdown post claims. scripts/build.js copies the
// hand-made pages in before this runs (scripts/builders/blog-helpers.js); a
// copy of one under the name of a post this run did not render (held, in
// error, not due, unsafe) would otherwise be served there around the gate,
// and so would a page left from an earlier build or written there by hand.
for (const file of fs.readdirSync(BLOG_BUILD)) {
  if (!file.endsWith('.html') || file === 'index.html') continue;
  const slug = file.slice(0, -'.html'.length);
  if (renderedSlugs.has(slug)) continue;
  if (Object.prototype.hasOwnProperty.call(LEGACY_BLOG_PAGES, file) && !claimedSlugs.has(slug)) continue;
  fs.rmSync(path.join(BLOG_BUILD, file), { force: true });
  const why = notRendered.get(slug);
  console.log(`  ~ Removed blog/${file}  -  ${why ? `not rendered (${why})` : 'not rendered by this build and not a frozen hand-made page'}`);
}

// 2. Generate blog index from content-calendar.json
const calendar = calendarEntries.calendar;
{
  // Calendar titles and descriptions come from the Hive topic planner and the
  // backlog: a person approves them as topics, not as credit-free text. They
  // print on the index cards, the Related Articles cards and the RSS feed, so
  // they get the front-matter wording check, as a warning: the card prints
  // them as written (sage-server BL-07).
  const card = (post) => {
    for (const [key, value] of [['title', post.title], ['description', post.description]]) {
      const found = contentGuard.reviewClaimIn(String(value === undefined || value === null ? '' : value), REVIEW_TEAM, { strict: true });
      if (found) console.log(describeWordingWarning(String(post.slug), { field: `calendar ${key}`, text: String(value).slice(0, 500), wording: found }));
    }
    return { slug: post.slug, title: post.title, description: post.description, publish_date: post.publish_date };
  };

  // Collect all published posts: existing_posts + year1 entries with status "published"
  const allPublished = [];

  for (const post of [...(calendar.existing_posts || []), ...(calendar.year1 || [])]) {
    if (!post || post.status !== 'published') continue;
    const c = card(post);
    if (c) allPublished.push(c);
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

  // Filter out future-dated posts and posts whose .html artifact does not
  // exist on disk (covers the case where the calendar status says
  // "published" but the .md frontmatter has a future `date:` field that
  // caused the per-post generator above to skip it).
  const now = new Date();
  const readyToPublish = allPublished.filter(p => {
    if (new Date(p.publish_date + 'T00:00:00') > now) return false;
    return fs.existsSync(path.join(BLOG_BUILD, `${p.slug}.html`));
  });
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
${related.map(p => `          <a href="/blog/${esc(p.slug)}.html" class="card" style="text-decoration:none;">
            <h3 class="card__title" style="font-size:var(--text-lg);">${esc(p.title)}</h3>
            <span class="card__link">Read article ${arrowSvg}</span>
          </a>`).join('\n')}
        </div>
      </section>`;
        // A function replacement: '$&' or "$'" in a title is text, not a pattern.
        html = html.replace('</article>', () => relatedHtml + '\n    </article>');
        fs.writeFileSync(filePath, html);
      }
    }
  }
}

// 3. Generate enhanced RSS feed
const rssItems = [];
// The rendered posts, with their own front matter (wording logged above).
// This always was the feed: it read a block-scoped list from step 2 through
// `typeof`, which is undefined out here, so calendar titles never reached it.
const rssPosts = posts.map(m => ({ slug: m.slug, title: m.title, description: m.description || '', publish_date: m.date })).slice(0, 20);
// Build author/category map from posts metadata
const postMetaMap = {};
for (const m of posts) postMetaMap[m.slug] = m;

for (const p of rssPosts) {
  const meta = postMetaMap[p.slug] || {};
  // The same author the page's byline names (a team.json member, or the agency).
  const byline = contentGuard.bylineAuthor(meta, REVIEW_TEAM);
  const author = byline ? byline.name : contentGuard.AGENCY_AUTHOR;
  const category = meta.category || '';
  // Read full content for content:encoded if file exists
  let contentEncoded = '';
  const builtFile = path.join(BLOG_BUILD, `${p.slug}.html`);
  if (fs.existsSync(builtFile)) {
    const html = fs.readFileSync(builtFile, 'utf8');
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/);
    // Text, so the page's entities are decoded back (CDATA holds it literally).
    if (articleMatch) {
      contentEncoded = articleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .substring(0, 2000);
    }
  }

  rssItems.push(`    <item>
      <title><![CDATA[${cdata(p.title)}]]></title>
      <link>https://www.thewayagency.com/blog/${esc(p.slug)}.html</link>
      <guid isPermaLink="true">https://www.thewayagency.com/blog/${esc(p.slug)}.html</guid>
      <pubDate>${new Date(p.publish_date + 'T12:00:00').toUTCString()}</pubDate>
      <dc:creator><![CDATA[${cdata(author)}]]></dc:creator>${category ? `
      <category><![CDATA[${cdata(category)}]]></category>` : ''}
      <description><![CDATA[${cdata(p.description)}]]></description>${contentEncoded ? `
      <content:encoded><![CDATA[${cdata(contentEncoded)}]]></content:encoded>` : ''}
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
