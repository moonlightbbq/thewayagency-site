# THE WAY AGENCY — Website Rebuild
## Complete Phase 1 Architecture, Build Plan, Trust Signals & AI-Citability

**Prepared March 2026**
**Infrastructure:** Cloudflare Pages + GitHub Push-to-Deploy
**Replaces:** Webflow (www.thewayagency.com)

---

## Table of Contents

1. [Strategic Context & Guiding Principles](#1-strategic-context--guiding-principles)
2. [Content Inventory & Information Architecture](#2-content-inventory--information-architecture)
3. [Technical Architecture](#3-technical-architecture)
4. [SEO Architecture](#4-seo-architecture)
5. [Design System & Visual Identity](#5-design-system--visual-identity)
6. [Page-by-Page Specifications](#6-page-by-page-specifications)
7. [Performance & Core Web Vitals Targets](#7-performance--core-web-vitals-targets)
8. [Trust & E-E-A-T Compliance](#8-trust--e-e-a-t-compliance)
9. [AI-Citability Architecture](#9-ai-citability-architecture)
10. [Product Page Content Framework](#10-product-page-content-framework)
11. [Data Schemas](#11-data-schemas)
12. [Phase 2–4 Integration Hooks](#12-phase-24-integration-hooks)
13. [Build Checklist](#13-build-checklist)
14. [Content Volume Estimate](#14-content-volume-estimate)
15. [Success Criteria](#15-success-criteria)

---

## 1. Strategic Context & Guiding Principles

This document defines the complete technical architecture for the Phase 1 rebuild of The Way Agency website. Every decision in this phase serves the full vision: a site that ranks locally, converts visitors into quote requests, and provides a platform for AI-powered client engagement — while being structured so both people and AI systems can easily understand, trust, and cite the content.

### 1.1 Why Leave Webflow

- No control over rendered HTML structure, heading hierarchy, or schema markup — critical for local SEO and AI citability
- Cannot embed custom JavaScript for AI chat assistant, smart quote routing, or analytics event tracking
- Webflow's CDN and runtime bloat (100KB+ of framework CSS/JS) kills Core Web Vitals scores
- No server-side capabilities for API endpoints (chat, form handling, AgencyZoom integration)
- Monthly subscription cost eliminated; Cloudflare Pages hosting is free at this scale

### 1.2 Design Principles for the Foundation

1. Every page gets its own URL with keyword-targeted meta tags — no single-page app
2. Semantic HTML5 first, CSS second, JS only when necessary — progressive enhancement
3. Data-driven content via JSON configuration files so AI tools and scripts can update content without touching HTML
4. Component architecture via reusable HTML partials so nav, footer, testimonials, and carrier logos are maintained once
5. AI integration points designed from day one — chat widget container, form webhook endpoints, knowledge base structure
6. 301 redirects mapped for every existing Webflow URL to preserve any existing search equity
7. Answer-first content structure so both people and AI systems get the information they need immediately
8. Trust signals visible on every page — address, hours, credentials, verified reviews, licensing

---

## 2. Content Inventory & Information Architecture

The current Webflow site has approximately 40+ distinct pages. Many are thin product sub-pages with 2–3 sentences of content and identical templates. The rebuild consolidates these into SEO-optimized pages with substantial content while preserving URL equity through redirects.

### 2.1 Current Webflow Page Inventory

| Section | Current URLs | New Structure |
|---------|-------------|---------------|
| Homepage | `/` | `/ (index.html)` |
| Personal Lines | `/personal-insurance` + 10 sub-pages (`/personal/home-insurance`, `/auto`, `/renters`, `/umbrella`, `/flood`, `/motorcycle`, `/boat`, `/classic-car`, `/earthquake`, `/pet`) | `/personal/` (hub) + `/personal/[product].html` for each — 10 product pages retained |
| Commercial Lines | `/commercial-insurance` + 9 sub-pages (`/commercial/general-liability`, `/commercial-property`, `/commercial-auto`, `/workers-compensation`, `/cyber`, `/bonds`, `/builders-risk`, `/special-event`, `/professional-liability`) | `/commercial/` (hub) + `/commercial/[product].html` — 9 product pages retained |
| Life & Health | `/life-health-insurance` + 12 sub-pages (`/life-health/medicare`, `/medicaid`, `/supplemental-health`, `/group-health`, `/individual-health`, `/family-health`, `/term-life`, `/whole-life`, `/annuities`, `/disability`, `/final-expense`) | `/life-health/` (hub) + `/life-health/[product].html` — 12 product pages retained |
| About | 7 pages: `/about-us/about-us`, `/why-clients-choose-us`, `/our-insurance-team`, `/insurance-locations`, `/mission-and-values`, `/community-impact`, `/careers` | `/about/` (combined About + Mission + Why Us + Independent Agent explainer) + `/about/team.html` + `/about/locations.html` + `/about/careers.html` + `/about/community.html` |
| Utility | `/quote`, `/contact-us`, `/blog`, `/log-in`, `/privacy-policy`, `/t-c` | `/quote.html`, `/contact.html`, `/blog/` (with individual post pages), `/login.html`, `/privacy.html`, `/terms.html` |

### 2.2 URL Redirect Map (SEO Preservation)

Every existing Webflow URL must 301-redirect to its new location via Cloudflare Pages `_redirects` file.

| Old Webflow URL | New URL | Status |
|----------------|---------|--------|
| `/personal-insurance` | `/personal/` | 301 |
| `/personal/home-insurance` | `/personal/home.html` | 301 |
| `/commercial-insurance` | `/commercial/` | 301 |
| `/commercial/general-liability` | `/commercial/general-liability.html` | 301 |
| `/life-health-insurance` | `/life-health/` | 301 |
| `/about-us/about-us` | `/about/` | 301 |
| `/about-us/why-clients-choose-us` | `/about/` | 301 |
| `/about-us/mission-and-values` | `/about/` | 301 |
| `/about-us/our-insurance-team` | `/about/team.html` | 301 |
| `/about-us/insurance-locations` | `/about/locations.html` | 301 |
| `/contact-us` | `/contact.html` | 301 |
| `/post/[slug]` | `/blog/[slug].html` | 301 |

A complete redirect map covering all 40+ URLs will be finalized during build. The `_redirects` file is a Cloudflare Pages convention and deploys alongside the site.

---

## 3. Technical Architecture

### 3.1 Repository & Deployment

| Component | Detail |
|-----------|--------|
| Repository | GitHub: `thewayagency-site` (private repo) |
| Hosting | Cloudflare Pages (free tier, same as waiveflow.com) |
| Deploy Trigger | Push to `main` branch → auto-build → live in <60 seconds |
| Domain | `www.thewayagency.com` — DNS CNAME to Cloudflare Pages (cut over from Webflow after testing) |
| SSL | Automatic via Cloudflare (free, auto-renewing) |
| CDN | Cloudflare global edge network (296+ cities) |
| Build Tool | None required — static HTML served directly. Optional: simple Node.js build script for HTML partial injection (nav, footer, head) |
| Staging | Cloudflare Pages branch deploys — push to any non-main branch gets a preview URL |

### 3.2 Project File Structure

```
thewayagency-site/
├── src/                              Source files (pre-build)
│   ├── pages/                        All HTML page files
│   │   ├── index.html                Homepage
│   │   ├── quote.html                Quote request form
│   │   ├── contact.html              Contact page
│   │   ├── login.html                Client login redirect
│   │   ├── personal/                 Personal lines hub + product pages
│   │   ├── commercial/               Commercial lines hub + product pages
│   │   ├── life-health/              Life & Health hub + product pages
│   │   ├── about/                    About, team, locations, careers, community
│   │   └── blog/                     Blog index + individual post pages
│   ├── partials/                     Reusable HTML fragments
│   │   ├── nav.html                  Site navigation (single source of truth)
│   │   ├── footer.html               Site footer (address, hours, license, GBP link)
│   │   ├── head.html                 Common <head> content (meta, fonts, CSS)
│   │   ├── testimonials.html         Testimonial carousel component
│   │   ├── carriers.html             Carrier logo marquee
│   │   ├── cta-banner.html           Reusable call-to-action section
│   │   └── chat-widget.html          AI chat container (Phase 3 — placeholder now)
│   ├── css/                          Stylesheets
│   │   ├── base.css                  Reset, variables, typography
│   │   ├── layout.css                Grid, nav, footer, responsive
│   │   ├── components.css            Cards, buttons, forms, carousel
│   │   └── pages.css                 Page-specific overrides
│   ├── js/                           JavaScript (minimal)
│   │   ├── nav.js                    Mobile menu toggle, scroll behavior
│   │   ├── testimonials.js           Carousel logic
│   │   ├── forms.js                  Form validation + submission handler
│   │   ├── analytics.js              GA4 + conversion events
│   │   └── chat.js                   AI chat widget (Phase 3 — stub now)
│   └── assets/                       Images, fonts, video
│       ├── images/
│       │   ├── carriers/             Carrier logos (WebP + PNG fallback)
│       │   ├── team/                 Staff photos
│       │   └── hero/                 Hero section images/video stills
│       └── fonts/                    Self-hosted web fonts
├── data/                             JSON content files (AI-updatable)
│   ├── carriers.json                 Carrier names, logos, URLs, lines, appointment details
│   ├── testimonials.json             Reviews with name, text, rating, source, product line
│   ├── team.json                     Staff bios, roles, photos, credentials, license states
│   ├── products.json                 All product definitions with cost context and exclusions
│   ├── locations.json                Office addresses, hours, geo coords, agency-wide trust data
│   ├── seo.json                      Per-page title, description, schema type, last-reviewed date
│   └── knowledge-base.json           FAQ/coverage Q&A for web pages, schema, and AI chat
├── build/                            Build script output (what deploys)
├── scripts/                          Build & utility scripts
│   ├── build.js                      Assembles partials into final HTML
│   ├── generate-sitemap.js           Creates sitemap.xml from page list
│   └── generate-blog.js             Converts Markdown blog posts to HTML
├── _redirects                        Cloudflare Pages redirect rules
├── _headers                          Cloudflare Pages custom headers
├── robots.txt                        Search engine crawl directives
└── sitemap.xml                       Auto-generated XML sitemap
```

**Key architectural choice:** The `data/` directory contains JSON files that represent all dynamic content. The AI chat assistant (Phase 3), the blog content generator (Phase 3), and the smart quote router (Phase 3) all operate on the same structured data. A script or AI agent can update `carriers.json` when you add a new carrier, and the build script regenerates the relevant pages.

### 3.3 Build System

A lightweight Node.js build script (`scripts/build.js`) handles three tasks:

1. **Partial injection:** Replaces `<!-- partial:nav -->` placeholders in page HTML with the contents of `src/partials/nav.html`. Navigation, footer, head tags, testimonials, carrier logos, and chat widget container are each maintained in a single file.
2. **JSON data injection:** Reads `data/*.json` files and injects structured content into HTML templates. The carrier logo marquee is generated from `carriers.json`, so adding a carrier means editing one JSON file and pushing.
3. **Output to build/:** Assembles final HTML files with all partials resolved, copies CSS/JS/assets, and generates `sitemap.xml`. The `build/` directory is what Cloudflare Pages serves.

This build step is optional during initial development — you can work with complete HTML files that include all content inline, then refactor to partials once the design is locked.

---

## 4. SEO Architecture

SEO is not a later phase — it is baked into every HTML file from the start. This is the single biggest advantage over Webflow.

### 4.1 On-Page SEO Requirements (Every Page)

| Element | Implementation |
|---------|---------------|
| Title Tag | Unique, keyword-targeted, 50–60 chars. Pattern: "[Product] Insurance in Owensboro, KY \| The Way Agency" |
| Meta Description | Unique, action-oriented, 150–160 chars with local keywords and CTA |
| H1 Tag | Exactly one per page, contains primary keyword, phrased as a question where possible. Never duplicated across pages. |
| Heading Hierarchy | H1 → H2 → H3, never skipping levels. Semantic outline of page content. |
| Canonical URL | `<link rel="canonical" href="https://www.thewayagency.com/[path]">` |
| Open Graph | `og:title`, `og:description`, `og:image`, `og:url`, `og:type` for social sharing |
| Schema.org JSON-LD | Structured data embedded in `<head>` — see Section 4.2 |
| Image Alt Text | Descriptive, keyword-informed alt attributes on every image |
| Internal Linking | Every product page links to its hub page and the quote page. Hub pages link to all products. Cross-links between related products (e.g., home → umbrella, auto → umbrella). |
| URL Structure | Clean, descriptive, lowercase, hyphenated. `/personal/home-insurance` not `/personal/home_insurance` |
| Last Reviewed Date | Visible on every product and blog page. Stored in seo.json/products.json. |
| Author Attribution | Blog posts and product pages show the reviewing agent's name, title, and credentials with link to team page. |

### 4.2 Schema.org Structured Data

Every page includes JSON-LD schema markup in the `<head>`.

| Page | Schema Type | Key Properties |
|------|------------|----------------|
| All pages | `InsuranceAgency` + `LocalBusiness` | name, address, phone, url, openingHours, areaServed, sameAs (social links), license numbers |
| Homepage | + `WebSite` + `SearchAction` + `AggregateRating` | Sitelinks search box eligibility, Google review rating |
| Product pages | + `Service` + `FAQPage` | serviceType, provider, areaServed, description, Q&A pairs |
| About / Team | + `Person` (per team member) | name, jobTitle, worksFor, image, credential, hasCredential |
| Blog posts | + `Article` | headline, author (as Person with URL), datePublished, dateModified, image |
| Testimonials | + `Review` + `AggregateRating` | reviewRating, author, reviewBody, source |
| FAQ sections | + `FAQPage` | Question + acceptedAnswer pairs — enables rich snippets |
| Locations | + `LocalBusiness` (per office) | geo coordinates, address, phone, hours per location |

### 4.3 Technical SEO Files

| File | Purpose |
|------|---------|
| `sitemap.xml` | Auto-generated list of all pages with lastmod dates. Submitted to Google Search Console. |
| `robots.txt` | Allow all crawlers, point to sitemap. Disallow `/build/` and `/_*` internal paths. |
| `_redirects` | Cloudflare Pages 301 redirect rules — every old Webflow URL mapped to new URL. |
| `_headers` | Security headers (CSP, X-Frame-Options, HSTS) + cache-control for static assets. |

### 4.4 Local SEO Strategy

- Primary geo-targets: Owensboro KY, Daviess County, Henderson KY, Evansville IN, and surrounding tri-state area (KY/IN/TN)
- Every product page title includes geographic modifier: "Home Insurance in Owensboro, KY"
- Locations page includes embedded Google Map with all office locations and structured LocalBusiness schema per location
- Google Business Profile link prominently placed; NAP (Name, Address, Phone) consistent across all pages, schema, and external listings (GBP, BBB, Chamber, carrier directories)
- Service-area schema: areaServed includes Kentucky, Indiana, Tennessee with specific counties

---

## 5. Design System & Visual Identity

The visual identity should feel established, trustworthy, and distinctly Kentucky-rooted — not like a Silicon Valley startup. The brand voice echoes John 14:6: Insurance That Shows The Way.

### 5.1 Color Palette

| Name | Hex | Usage | Notes |
|------|-----|-------|-------|
| Navy | `#1B3A5C` | Primary / Headings | Trust, authority. Header, nav background, H1/H2. |
| Warm Stone | `#8C7E6E` | Secondary / Accents | Kentucky limestone warmth. Borders, dividers, subtle accents. |
| Linen | `#F5F2ED` | Backgrounds | Warm off-white. Alternating sections, card backgrounds. |
| Charcoal | `#1A1A1A` | Body Text | High-contrast readable body copy. |
| Slate | `#555555` | Secondary Text | Captions, meta text, timestamps. |
| Gold | `#C5A55A` | CTA / Highlight | Buttons, hover states, premium accent. Used sparingly. |
| White | `#FFFFFF` | Cards / Content | Clean card surfaces, form fields. |

### 5.2 Typography

- **Headings:** A serif typeface — Playfair Display, Lora, or Cormorant Garamond. Conveys establishment and trust without feeling corporate.
- **Body:** A clean sans-serif — Source Sans Pro, DM Sans, or similar. Highly readable at body sizes.
- **Fonts self-hosted** in `/assets/fonts/` for performance (no Google Fonts CDN dependency). Loaded via `@font-face` with `font-display: swap`.

### 5.3 Component Library

These components are defined once in `src/partials/` or `src/css/components.css` and reused across all pages:

- **Navigation:** Sticky top nav with logo, mega-menu dropdowns for Personal/Commercial/Life & Health/About, mobile hamburger. Quote CTA button always visible.
- **Hero Section:** Full-width with background image/video, tagline overlay, and primary CTA. Each line-of-business hub gets its own hero.
- **Trust Bar:** Immediately below hero. "Since [Year] • [X,000+] Clients • 17+ Carriers • KY, IN & TN." Renders from `locations.json` agency data.
- **Carrier Logo Marquee:** Auto-scrolling logo strip. Rendered from `carriers.json` — different carrier sets for Personal vs Commercial pages. Includes appointment year where available.
- **Product Card Grid:** Used on hub pages. Card with icon/image, product name, 2-sentence description, and Learn More link.
- **Testimonial Carousel:** Rotating reviews with star rating, name, source link, and full text. Data from `testimonials.json`. **Product-specific**: commercial reviews on commercial pages, personal reviews on personal pages.
- **How It Works:** 3-step section: (1) Tell us what you need, (2) We shop carriers and build options, (3) You choose with confidence. Includes expected response time.
- **CTA Banner:** Reusable section with headline, subtext, and two buttons (Get a Quote / Request Coverage Review).
- **Quote Form:** Name, email, phone, line-of-business selector, message. Submits via JavaScript to a webhook endpoint. Includes inline privacy micro-statement: "Your information is secure. A licensed agent will contact you within [X] business hours." Links to full privacy policy.
- **FAQ Accordion:** Question as H3, expandable answer. Marked up with FAQPage schema. Content sourced from `knowledge-base.json`.
- **Author Attribution Block:** For product pages and blog posts. Shows agent photo thumbnail, name, title, credentials, and "Last reviewed: [Month Year]."
- **Footer:** Street address, phone, email, hours, license statement ("Licensed in KY, IN & TN"), founding year, Google review rating with GBP link, social links, quick nav links, legal links, association badges. Includes LocalBusiness schema.
- **Chat Widget Placeholder:** An empty container div with ID `#ai-chat-root`. Phase 3 mounts the chat UI here. Including it now means zero HTML changes when AI chat goes live.

---

## 6. Page-by-Page Specifications

### 6.1 Homepage (/)

**Title:** "The Way Agency | Independent Insurance in Owensboro, KY"
**H1:** "The Way Insurance Gets Done"

Sections in order:

1. **Hero:** Background image/video, tagline, Get a Quote CTA
2. **Trust bar:** "Since [Year] • [X,000+] Clients • 17+ Carriers • KY, IN & TN"
3. **Carrier logo marquee** (combined Personal + Commercial carriers)
4. **Three-column card section:** Personal Lines / Commercial Lines / Life & Health — each with image, description, CTA to hub page
5. **How It Works:** 3 steps with expected response time
6. **About teaser:** 2–3 sentences about the agency, since [year], client-centered approach. Link to About page.
7. **Testimonial carousel** (top 6–8 reviews)
8. **FAQ section:** 4–6 common questions with expandable answers. FAQPage schema. (This feeds into the Phase 3 knowledge base.)
9. **CTA banner:** Get a Quote / Request Coverage Review
10. **Footer**

### 6.2 Product Hub Pages (/personal/, /commercial/, /life-health/)

Each hub page follows the same template:

1. Hero with line-specific background and tagline
2. Carrier logo marquee (filtered to relevant carriers for that line)
3. Product card grid: all products for that line with icon, name, description, Learn More link
4. Cross-sell callout: "Also consider" section linking to the other two lines
5. FAQ section (line-specific questions)
6. Testimonial carousel (filtered to that line's reviews)
7. CTA banner

### 6.3 Individual Product Pages (/personal/home.html, etc.)

These are the SEO and AI-citability workhorses. Each one targets a specific long-tail keyword and follows the content framework in Section 10.

- **Title:** "[Product] Insurance in Owensboro, KY | The Way Agency"
- **H1:** Unique, question-shaped heading: "What does [product] insurance cover in Kentucky?"
- **Content:** 500–800 words following the framework: Direct Answer → Who Needs It → What It Covers/Doesn't → Cost Context → FAQ → Related Coverage
- **Sidebar or inline:** Relevant carriers for this product (from `carriers.json` filtered by line)
- **FAQ:** 3–5 product-specific FAQs with FAQPage schema, sourced from `knowledge-base.json`
- **Internal links:** Back to hub page, to quote page, to related products
- **Author attribution:** Agent name, title, credentials, last reviewed date
- **CTA:** Inline quote form or prominent button

### 6.4 About Page (/about/)

Consolidates the current About Us, Why Choose Us, Mission & Values, and adds a new independent agent explainer. Sections:

1. **History and identity:** Since [year], KY/IN/TN, independent agency, client-centered approach. Key stats (clients served, carriers, years).
2. **Mission and values:** Clarity, trust, partnership — from the existing Mission & Values page.
3. **Why choose an independent agent:** 500–800 words of educational content explaining what an independent agent is, how carrier access works, why it leads to better coverage and pricing vs. going direct to GEICO/Progressive. This is both an SEO opportunity and a core differentiator.
4. **Affiliations:** Industry associations with logos (Big "I"/IIABA, KY Association of Insurance Agents, Owensboro Chamber, etc.)
5. **Coverage in Action:** 2–3 anonymized claims success stories (200–300 words each)
6. **Links:** Team page, locations page, community page, careers page

### 6.5 Team Page (/about/team.html)

**This page is critical for E-E-A-T.** Each team member gets:

- Professional headshot
- Full name and title
- Years in insurance
- License states (KY, IN, TN)
- Professional designations (CIC, CISR, LUTCF, AAI, etc.)
- Lines of specialty
- 2–3 sentence bio in the agent's own voice
- Person schema markup

Data sourced from `team.json`. The slug field generates anchor URLs (`#audrey-mitchell`) that blog post and product page author attributions link to.

### 6.6 Locations Page (/about/locations.html)

- Physical office addresses with street address, suite, city, state, zip
- Hours of operation per office
- Embedded Google Map
- Service area lists by state with cities served
- Industries served section
- FAQ section with FAQPage schema
- LocalBusiness schema per office with geo coordinates

### 6.7 Blog (/blog/)

Blog architecture is critical because it becomes the primary content marketing engine in Phase 3 (AI-assisted content generation).

- Blog index page with card grid of posts, sorted by date
- Individual post template with Article schema, **author byline with photo/credentials**, date, reading time, related posts
- Markdown-based authoring: posts written in Markdown in `/src/pages/blog/`, converted to HTML by build script
- Category/tag system in front matter for future filtering
- Migrate existing Webflow blog posts: Cyber Safety, Tornado Season, Winter Storm, Landlord Insurance, Pet Insurance, Earthquake Insurance — add author attribution to each

### 6.8 Quote Page (/quote.html)

Phase 1: Clean form matching current fields (First Name, Last Name, Email, Phone, Line of Business, Message). Form submits via JavaScript POST to a Cloudflare Workers function (or temporary email endpoint).

Inline privacy statement below submit button: "Your information is secure and only used to prepare your quote. A licensed agent will contact you within [X] business hours." Links to privacy policy.

Phase 3 upgrade: This becomes a conversational AI intake that asks qualifying questions and routes to the appropriate agent/line.

The form handler is a separate JavaScript module (`src/js/forms.js`) with a webhook URL defined as a configuration variable, so swapping the endpoint from an email forwarder to an AgencyZoom API integration requires changing one line.

### 6.9 Other Pages

- **Contact page:** Address, phone, email, hours, map, and a simple contact form
- **Login redirect page:** Brief explanation + link/redirect to client portal
- **Privacy Policy:** Full privacy policy page
- **Terms & Conditions:** Full terms page
- **Careers:** Open positions, culture description, application info
- **Community / Giving Back:** Community involvement, charitable work

---

## 7. Performance & Core Web Vitals Targets

| Metric | Target | Webflow Current | How |
|--------|--------|-----------------|-----|
| Largest Contentful Paint | < 1.5s | ~3.2s | No framework overhead, optimized images |
| First Input Delay | < 50ms | ~120ms | Minimal JS, no render-blocking scripts |
| Cumulative Layout Shift | < 0.05 | ~0.18 | Explicit image dimensions, font-display: swap |
| Total Page Weight | < 500KB | ~1.8MB | WebP images, no Webflow runtime, inlined critical CSS |
| Lighthouse Score | 95+ | ~68 | All of the above combined |

Performance optimizations built into Phase 1:

- All images converted to WebP format with PNG/JPEG fallbacks via `<picture>` element
- Carrier logos: SVG where available, otherwise WebP at exact display dimensions
- CSS loaded as a single concatenated file (< 20KB) with critical CSS inlined in `<head>`
- JavaScript deferred: all `<script>` tags use `defer` or `async` attributes. Total JS budget: < 15KB
- Self-hosted fonts with `font-display: swap` and preload hints
- Explicit `width` and `height` attributes on all `<img>` tags to prevent layout shift
- Lazy loading (`loading="lazy"`) on below-fold images

---

## 8. Trust & E-E-A-T Compliance

Google evaluates YMYL (Your Money, Your Life) sites on four dimensions: Experience, Expertise, Authoritativeness, and Trustworthiness. Insurance is firmly YMYL. AI systems that surface answers from the web (Google AI Overviews, ChatGPT with search, Perplexity, Copilot) also weight these signals when deciding which sources to cite.

The current site audit identified specific gaps. Each one maps to a build action.

### 8.1 Experience — Proving You've Done the Work

| Finding | Status | Why It Matters | Build Action |
|---------|--------|---------------|--------------|
| No claims volume, client count, or years-of-experience stats anywhere | **MISSING** | Visitors compare agencies by scale and track record. Competitors display specific numbers. | Add trust bar to homepage: "Since [Year] • X,000+ Clients • 17+ Carriers • KY, IN & TN." Repeat in About and footer. Add to schema. |
| No claims stories or case studies | **MISSING** | Testimonials say "she was great" but never show what happened. Stories prove experience. | Create 2–3 "Coverage in Action" anonymized narratives (200–300 words each). Place on relevant product pages and About page. |
| No process transparency on homepage | **WEAK** | Visitors don't know what happens after "Get a Quote." Uncertainty kills conversion. | Add "How It Works" 3-step section to homepage above CTA. Include expected response time. |
| No "last reviewed" dates on content | **MISSING** | For YMYL, freshness matters. Undated content looks abandoned. | Add "Page last reviewed: [Month Year]" to every product and blog page. Store in data files. |

### 8.2 Expertise — Proving Your People Are Qualified

| Finding | Status | Why It Matters | Build Action |
|---------|--------|---------------|--------------|
| Team page shows no credentials, licenses, designations, or specializations | **WEAK** | Google Quality Rater Guidelines check for expert credentials on YMYL. AI systems look for named experts. | Rebuild team page with headshots, credentials, designations (CIC, CISR, LUTCF), license states, specialties, and Person schema. |
| Blog posts have no author attribution | **MISSING** | Unsigned YMYL content is devalued by both Google and AI systems. | Every blog post gets author byline linking to team page. Article schema includes author as Person. |
| No content explaining what an independent agent is | **MISSING** | The agency's core differentiator, never explained. Strong SEO keyword opportunity. | Create "Why Choose an Independent Agent?" section in About page. 500–800 words, educational. |
| Product pages have generic content | **WEAK** | Thin, non-specific content fails Helpful Content evaluation. AI systems skip it. | Rewrite every product page following content framework in Section 10. |

### 8.3 Authoritativeness — Third-Party Validation

| Finding | Status | Why It Matters | Build Action |
|---------|--------|---------------|--------------|
| No Google review rating or count displayed | **MISSING** | Self-hosted testimonials are less persuasive than verified reviews. GBP signals matter for local ranking. | Display aggregate Google rating on homepage and footer with link to GBP. Add AggregateRating schema. |
| No industry association badges visible | **MISSING** | Big "I", KY Association of Insurance Agents, Owensboro Chamber — authority markers humans and algorithms recognize. | Add "Affiliations" section to About page and/or footer with logos and membership years. |
| Carrier logos shown but no relationship depth | **WEAK** | "Preferred agent for Travelers since 2012" is a different trust signal than just a logo. | In `carriers.json`, add appointment year and status. Render on marquee or dedicated carriers page. |
| BBB listing shows "Not Accredited" | **WEAK** | Consumers and AI check BBB. Accreditation is a validation layer. | Consider accreditation. At minimum, ensure listing is accurate with correct info. |
| Founding year inconsistency (site says 1998, Chamber says 2006) | **WEAK** | Inconsistent data erodes trust. NAP + founding date consistency matters. | Determine correct year. Update Chamber, BBB, GBP, and all site references. |

### 8.4 Trustworthiness — Reducing Friction and Risk

| Finding | Status | Why It Matters | Build Action |
|---------|--------|---------------|--------------|
| No physical street address on the site | **MISSING** | Fundamental trust signal for local business. Required for LocalBusiness schema and NAP consistency. | Add full street address to footer (every page), contact page, and locations page. Match GBP/BBB/Chamber exactly. |
| No business hours displayed | **MISSING** | Visitors don't know when to call. Missing from schema. | Display hours in footer and contact page. Add openingHoursSpecification to schema. |
| No state license numbers or regulatory info | **MISSING** | Insurance agencies are regulated. Displaying license info is an industry-specific trust signal. | Add "Licensed in KY, IN & TN" with agency license number(s) to footer. Individual agent licenses on team page. |
| Testimonials truncated and some unverifiable; identical block on every page | **WEAK** | Cut-off reviews feel curated. Same block everywhere is duplicated content. | Show full text with source links. Make testimonials product-specific per page. |
| No privacy statement adjacent to quote form | **MISSING** | Form collects PII with no data-use disclosure. Notable for YMYL/financial services. | Add inline privacy micro-statement below submit button. |

### 8.5 Structured Data

| Finding | Status | Why It Matters | Build Action |
|---------|--------|---------------|--------------|
| No JSON-LD schema markup on any page | **MISSING** | The single biggest technical gap. Schema is how you communicate credentials, location, reviews, and services to search engines and AI in machine-readable format. | Implement JSON-LD on every page per Section 4.2. |
| FAQ content exists but has no FAQPage schema | **MISSING** | FAQPage enables rich snippets — high-CTR for insurance queries. Also makes content parseable by AI. | Add FAQPage schema to every page with FAQ content. |

---

## 9. AI-Citability Architecture

AI systems that answer questions using web content (Google AI Overviews, ChatGPT with search, Perplexity, Claude with search, Copilot) decide which sources to cite based on how clearly a page answers a question, whether the source has identifiable expertise, and whether the content is structured for extraction and attribution.

This section defines how every page should be written so both people and AI systems get what they need.

### 9.1 The Dual-Audience Principle

Every piece of content serves two audiences simultaneously:

- A person in Kentucky, Indiana, or Tennessee trying to understand their insurance options and decide whether to contact an agent
- An AI system trying to find a clear, credible answer to a question like "Do I need umbrella insurance?" or "What does commercial property insurance cover in Kentucky?"

What makes content useful for people is exactly what makes it citable by AI: clear answers, plain language, identified expertise, specific facts, and honest scope.

### 9.2 Content Rules for Every Page

**Rule 1: Lead with the answer, not the pitch.**

When someone asks "What is general liability insurance?" the first sentence should answer that directly. Not a welcome message, not a mission statement, not a sales pitch.

Current site pattern (typical product page):
> "General Liability insurance is your business's safety net, offering unparalleled protection against bodily injury and property damage claims. It's not just insurance; it's a strategic investment in your company's future stability and success."

Rewritten for people and AI:
> "General liability insurance covers your business if a customer, vendor, or visitor is injured at your location, or if your work damages someone else's property. In Kentucky, most commercial leases and contracts require it. Policies typically start around $500/year for low-risk businesses, but cost depends on your industry, revenue, and claims history."

The rewrite is citable because it answers the question, provides geographic scope, includes concrete facts, and gives a useful range. An AI system can extract a clean answer. From the original, it cannot.

**Rule 2: Use question-shaped headings.**

AI systems match user queries to page headings. Question headings dramatically increase citation likelihood.

Instead of: "Coverage Details" or "Why Choose Us"
Use: "What does home insurance cover in Kentucky?" or "Why use an independent agent instead of buying direct?"

**Rule 3: One clear topic per section.**

Each H2 section addresses one question completely. Don't blend concepts. AI systems extract by section — muddled sections get skipped.

**Rule 4: Include specific facts, not just claims.**

AI systems prioritize verifiable specifics over marketing language.

Weak: "We offer the best auto insurance at competitive rates."
Strong: "Kentucky requires minimum auto liability limits of 25/50/25. We typically recommend 100/300/100 for most families because the cost difference is often less than $15/month, and it protects your assets if you're at fault in a serious accident."

**Rule 5: Name your expertise and scope.**

- Include the agency name naturally (not stuffed, but present)
- Reference specific states served (KY, IN, TN) to scope the advice
- On blog posts, name the author and credentials
- On product pages, include a reviewer line: "Reviewed by [Name], Licensed [Designation], The Way Agency. [X] years experience in [line]."

**Rule 6: Honest scope and limitations.**

Content that acknowledges limits is more trustworthy than content that pretends everything is simple. Example:

> "Flood damage is not covered by standard homeowners insurance in Kentucky. You need a separate flood policy, available through the NFIP or private carriers. If your home is in a FEMA-designated flood zone, your mortgage lender may require it."

Honest, useful, citable. Naturally leads to the quote CTA.

**Rule 7: Structure data for extraction.**

Formats AI parses and cites easily:

- **Comparison tables:** "Term Life vs. Whole Life" with side-by-side columns
- **Coverage checklists:** "What home insurance covers / What it doesn't"
- **FAQ sections:** Question as H3, answer as the paragraph immediately following
- **Definition blocks:** Bold term followed by plain-language definition
- **Cost context:** Not exact pricing, but ranges and factors. "In our experience, most [X] policies in Kentucky cost between $[Y] and $[Z] per year, depending on [factors]."

---

## 10. Product Page Content Framework

Every product page follows this structure. Sections 1–5 are mandatory. Section 6 is recommended.

| # | Section | Content | Why It Matters |
|---|---------|---------|---------------|
| 1 | **Direct Answer** | 2–3 sentences directly answering "What is [this product]?" in plain language. Who needs it, what it protects against. Question-shaped H1. | This is the paragraph AI systems extract. Also the first thing a visitor reads. Vague = lose both audiences. |
| 2 | **Who Needs It** | Specific scenarios tied to service area. "If you own a home in Daviess County…" "If you're a contractor bidding on jobs in Louisville…" "Kentucky law requires…" | Localizes content (SEO), helps visitors self-identify (conversion), gives AI geographic scope. |
| 3 | **What It Covers / Doesn't Cover** | Two lists or a comparison table. "Typically covered: [items]. Often excluded: [items]." Plain English, mention endorsements or riders. | Most-searched pattern for insurance queries. Extremely citable by AI and useful to people. |
| 4 | **Cost Context** | Honest ranges and factors. "In our experience, most homeowners in Owensboro pay between $1,200 and $2,400/year depending on home value, age, roof condition, and claims history." | Cost is the #1 search modifier for insurance. Pages that address it honestly outperform those that avoid it. |
| 5 | **FAQ (3–5 Questions)** | Real customer questions, answered in 2–4 sentences. H3 question headings. Self-contained answers. Stored in `knowledge-base.json`. | Enables FAQPage rich snippets. Feeds AI chat. Natural long-tail keywords. Clean Q&A for AI citation. |
| 6 | **Related Coverage** | 2–3 sentences linking to related products. "If you have home insurance, also consider umbrella and flood." | Internal link equity. Cross-sell. Helps visitors and AI understand product relationships. |

**Footer on every product page:** "Reviewed by: [Agent Name], [Designation], The Way Agency. [X] years experience. Last reviewed: [Month Year]."

### 10.1 Example: Home Insurance Page (Rewritten)

**Title:** Home Insurance in Owensboro, KY | The Way Agency
**H1:** What does home insurance cover in Kentucky?

> Home insurance protects your house, belongings, and personal liability if something goes wrong — a fire, a break-in, a tree falling on your roof, or someone getting injured on your property. In Kentucky, your mortgage lender almost certainly requires it, and even if you own your home outright, going without means one bad storm could wipe out your largest asset.

**H2: Who needs home insurance in Kentucky?**

> If you own a home anywhere in Kentucky, Indiana, or Tennessee, you need a homeowners policy. If you have a mortgage, your lender requires it. If you own free and clear, you still need it because Kentucky sees regular severe weather: tornadoes, hailstorms, ice storms, and wind damage are real risks, not hypothetical ones. The average Kentucky homeowner files a property claim every 8–10 years.

**H2: What does a standard homeowners policy cover?**

> A standard HO-3 policy in Kentucky typically covers: damage to your home's structure from fire, wind, hail, lightning, and falling objects; damage to or theft of personal belongings; liability if someone is injured on your property; additional living expenses if you're displaced.
>
> What it does NOT cover: flood damage (requires a separate policy), earthquake damage (available as an endorsement), normal wear and tear, and intentional damage.

**H2: What does home insurance cost in Owensboro?**

> In our experience, most homeowners in the Owensboro area pay between $1,200 and $2,400 per year. The main factors: your home's replacement cost, age and condition (especially the roof), your deductible choice, claims history, and proximity to a fire station. We shop across 17+ carriers to find the best combination of coverage and price for your situation.

**H2: Frequently asked questions**

> **Is flood insurance included in my homeowners policy?**
> No. Standard homeowners insurance in Kentucky does not cover flood damage. You need a separate flood policy, available through the NFIP or private carriers. If your home is in a FEMA flood zone, your lender may require it.

> **What is the difference between actual cash value and replacement cost?**
> Actual cash value pays what your damaged item is worth today (minus depreciation). Replacement cost pays what it costs to replace the item new. We almost always recommend replacement cost coverage.

> **Should I increase my coverage limits?**
> If you've renovated, added a room, or if construction costs have risen since your last review, yes. We offer free coverage reviews to check whether your limits still match your home's replacement cost.

**H2: Related coverage to consider**

> If you have home insurance, you should also look at umbrella liability insurance (extends your liability beyond home and auto limits) and flood insurance (especially near any waterway in the Owensboro area).

*Reviewed by: [Agent Name], Licensed Property & Casualty Agent, The Way Agency. [X] years experience. Last reviewed: March 2026.*

---

## 11. Data Schemas

Design principle: every data file contains everything needed to render the web page AND everything needed for the AI chat assistant to answer questions about that topic. One source of truth, two outputs.

### 11.1 team.json

```json
{
  "team": [
    {
      "name": "Audrey Mitchell",
      "slug": "audrey-mitchell",
      "title": "Licensed Agent",
      "photo": "/assets/images/team/audrey-mitchell.webp",
      "years_experience": 8,
      "license_states": ["KY", "IN", "TN"],
      "designations": ["CISR"],
      "specialties": ["personal_lines", "home", "auto"],
      "bio": "Audrey helps families across Kentucky find the right home and auto coverage. She is known for taking time to explain options in plain language and making sure clients understand exactly what they are buying.",
      "fun_fact": "Audrey coaches youth soccer in Owensboro.",
      "email": "audrey@thewayagency.com",
      "phone": "(502) 413-5335 ext 2"
    }
  ]
}
```

The `slug` field generates the URL anchor (`#audrey-mitchell`) on the team page. Article schema author URLs point here. The `specialties` array maps to product lines so the build script auto-assigns the right reviewer to each product page.

### 11.2 knowledge-base.json

This is the most important data file. It serves triple duty: rendering FAQ sections on web pages, providing FAQPage schema for search, and feeding the Phase 3 AI chat assistant.

```json
{
  "entries": [
    {
      "id": "home-flood-exclusion",
      "question": "Is flood insurance included in my homeowners policy?",
      "answer": "No. Standard homeowners insurance in Kentucky does not cover flood damage. You need a separate flood policy, available through the National Flood Insurance Program (NFIP) or private carriers. If your home is in a FEMA-designated flood zone, your mortgage lender will likely require it.",
      "category": "personal",
      "product": "home",
      "related_products": ["flood"],
      "tags": ["exclusions", "flood", "fema", "mortgage"],
      "source_page": "/personal/home.html",
      "reviewed_by": "audrey-mitchell",
      "last_reviewed": "2026-03"
    },
    {
      "id": "gl-ky-required",
      "question": "Is general liability insurance required in Kentucky?",
      "answer": "Kentucky does not legally require general liability insurance for all businesses, but most commercial leases, vendor contracts, and government permits require proof of GL coverage before you can operate. If you are a contractor, you will almost always need it to bid on jobs.",
      "category": "commercial",
      "product": "general-liability",
      "related_products": ["professional-liability", "commercial-property"],
      "tags": ["requirements", "kentucky", "contractors", "lease"],
      "source_page": "/commercial/general-liability.html",
      "reviewed_by": "josh-[lastname]",
      "last_reviewed": "2026-03"
    }
  ]
}
```

Each entry is self-contained: the question and answer make sense without additional context. This is critical for AI citability — an AI system can extract just this Q&A pair and present it as a complete answer with attribution. The `reviewed_by` field links to `team.json`. The `source_page` field tells the AI chat where to point users for detail.

### 11.3 carriers.json

```json
{
  "carriers": [
    {
      "name": "Travelers",
      "slug": "travelers",
      "logo_svg": "/assets/images/carriers/travelers.svg",
      "logo_webp": "/assets/images/carriers/travelers.webp",
      "lines": ["personal", "commercial"],
      "products": ["home", "auto", "umbrella", "general-liability", "commercial-property", "commercial-auto", "workers-compensation"],
      "appointed_since": 2012,
      "status": "preferred",
      "am_best_rating": "A++",
      "description": "Travelers is one of the largest property casualty insurers in the US. We have been an appointed Travelers agent since 2012 and place both personal and commercial lines with them.",
      "website": "https://www.travelers.com"
    }
  ]
}
```

The `appointed_since`, `status`, and `am_best_rating` fields render as authority signals and feed the AI chat for questions like "Which carriers do you work with for commercial auto?"

### 11.4 testimonials.json

```json
{
  "testimonials": [
    {
      "id": "brian-osbourne-2024",
      "name": "Brian Osbourne",
      "rating": 5,
      "text": "[FULL untruncated review text]",
      "source": "google",
      "source_url": "https://maps.google.com/...",
      "date": "2024-06-15",
      "agent": "audrey-mitchell",
      "product_lines": ["personal"],
      "products": ["home", "auto"]
    }
  ]
}
```

New fields: `source` and `source_url` (verifiability), `date` (freshness), `agent` (links to `team.json`), `product_lines` and `products` (product-specific display).

### 11.5 products.json

```json
{
  "products": [
    {
      "id": "home",
      "name": "Home Insurance",
      "line": "personal",
      "slug": "home",
      "url": "/personal/home.html",
      "title_tag": "Home Insurance in Owensboro, KY | The Way Agency",
      "meta_description": "Home insurance protects your house, belongings, and liability. The Way Agency shops 17+ carriers to find the right coverage in Kentucky, Indiana, and Tennessee.",
      "h1": "What does home insurance cover in Kentucky?",
      "summary": "Covers your home, belongings, and liability. Required by most mortgage lenders. Does not include flood or earthquake damage.",
      "icon": "/assets/images/icons/home.svg",
      "related_products": ["flood", "umbrella", "earthquake"],
      "reviewed_by": "audrey-mitchell",
      "last_reviewed": "2026-03",
      "typical_cost_range": "$1,200–$2,400/year in Owensboro area",
      "cost_factors": ["home replacement cost", "age and roof condition", "deductible", "claims history", "fire station proximity"],
      "ky_requirement": "Required by mortgage lenders. Not required by state law for owned homes.",
      "common_exclusions": ["flood", "earthquake", "normal wear and tear", "intentional damage"]
    }
  ]
}
```

The `summary`, `typical_cost_range`, `cost_factors`, `ky_requirement`, and `common_exclusions` fields let the AI chat give specific answers without hallucinating and render directly on product pages.

### 11.6 locations.json

```json
{
  "offices": [
    {
      "name": "Owensboro Office",
      "street": "4501 Stonegate Dr",
      "city": "Owensboro",
      "state": "KY",
      "zip": "42303",
      "phone": "(502) 413-5335",
      "email": "hello@thewayagency.com",
      "latitude": 37.7510,
      "longitude": -87.1133,
      "hours": {
        "monday": "8:30 AM - 5:00 PM",
        "tuesday": "8:30 AM - 5:00 PM",
        "wednesday": "8:30 AM - 5:00 PM",
        "thursday": "8:30 AM - 5:00 PM",
        "friday": "8:30 AM - 5:00 PM",
        "saturday": "Closed",
        "sunday": "Closed"
      }
    }
  ],
  "service_areas": [
    {
      "state": "KY",
      "license_number": "[KY Agency License #]",
      "cities": ["Owensboro", "Henderson", "Louisville", "Lexington", "Bowling Green", "Elizabethtown", "Mt. Washington", "Frankfort"]
    },
    {
      "state": "IN",
      "license_number": "[IN Agency License #]",
      "cities": ["Evansville", "Indianapolis", "Fort Wayne", "Carmel", "Fishers"]
    },
    {
      "state": "TN",
      "license_number": "[TN Agency License #]",
      "cities": ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville"]
    }
  ],
  "agency": {
    "legal_name": "Way Insurance LLC",
    "dba": "The Way Agency",
    "founded": "[1998 or 2006 — confirm correct year]",
    "type": "Independent Insurance Agency",
    "affiliations": ["IIABA", "Kentucky Association of Insurance Agents", "Owensboro Chamber of Commerce"],
    "google_business_url": "[GBP URL]",
    "google_rating": "[X.X]",
    "google_review_count": "[N]",
    "bbb_url": "https://www.bbb.org/us/ky/mt-washington/profile/insurance-agency/way-insurance-llc-0402-159158212"
  }
}
```

Brackets `[ ]` indicate values needing real data. The `agency` section centralizes trust signals so they render consistently across footer, about page, and schema.

---

## 12. Phase 2–4 Integration Hooks (Built Now, Activated Later)

The whole point of getting Phase 1 right is that Phases 2–4 require zero structural changes.

| Phase | Feature | Phase 1 Hook | Activation Step |
|-------|---------|-------------|----------------|
| Phase 2 | GA4 Analytics + Conversion Tracking | `analytics.js` loaded on every page with event helper functions | Add GA4 measurement ID and define conversion events |
| Phase 2 | Google Search Console | `sitemap.xml` + `robots.txt` + site verification meta tag placeholder in `head.html` | Add verification code, submit sitemap |
| Phase 3 | AI Chat Assistant | `#ai-chat-root` div in every page via `chat-widget.html` partial + `chat.js` stub loaded | Replace `chat.js` stub with Claude API integration, populate `knowledge-base.json` |
| Phase 3 | Smart Quote Routing | `forms.js` with configurable webhook URL + line-of-business field | Point webhook to Cloudflare Worker that classifies lead and routes to AgencyZoom |
| Phase 3 | AI Blog Content | Blog template + Markdown pipeline + `generate-blog.js` | Add AI content generation script, review, commit |
| Phase 3 | Knowledge Base for Chat | `knowledge-base.json` schema defined with FAQ structure | Populate with comprehensive Q&A, wire into chat system prompt |
| Phase 4 | A/B Testing | CSS class-based variant system + analytics event tracking | Add JS variant assignment and track conversion rates |

---

## 13. Build Checklist

Ordered by dependency and priority.

### 13.1 Infrastructure (Day 1)

- [ ] Create GitHub repo (`thewayagency-site`), initialize with README
- [ ] Connect repo to Cloudflare Pages, configure build output directory
- [ ] Set up branch deploy previews for staging
- [ ] Create project file structure per Section 3.2
- [ ] Establish CSS variables and base styles per Section 5
- [ ] **Determine correct founding year** (site says 1998, Chamber says 2006) — this propagates everywhere

### 13.2 Shared Components (Day 1–2)

- [ ] Build `nav.html` partial with full mega-menu structure and mobile responsive toggle
- [ ] Build `footer.html` partial with: street address, phone, email, hours, license statement, founding year, Google rating with GBP link, social links, legal links, association badges
- [ ] Build `head.html` partial with meta tag placeholders, font loading, CSS imports, schema base
- [ ] Build `carriers.html` partial and create `carriers.json` with appointment details
- [ ] Build `testimonials.html` partial and create `testimonials.json` with source links and product mapping
- [ ] Build `cta-banner.html` reusable section
- [ ] Build "How It Works" component (3 steps + response time)
- [ ] Build FAQ accordion component with FAQPage schema rendering
- [ ] Build author attribution block component
- [ ] Add `#ai-chat-root` placeholder via `chat-widget.html` partial
- [ ] Add inline privacy micro-statement to quote form partial
- [ ] Create `locations.json` with agency trust data section
- [ ] Add "last reviewed" date renderer to page template

### 13.3 Pages (Day 2–5)

- [ ] Homepage with all sections per Section 6.1 (including trust bar and How It Works)
- [ ] Personal Lines hub page + all 10 product pages (rewritten per Section 10 framework)
- [ ] Commercial Lines hub page + all 9 product pages (rewritten per Section 10 framework)
- [ ] Life & Health hub page + all 12 product pages (rewritten per Section 10 framework)
- [ ] About page (consolidated: history, mission, independent agent explainer, affiliations, coverage stories)
- [ ] Team page with full agent profiles, credentials, and Person schema
- [ ] Locations page with addresses, hours, map, and per-office schema
- [ ] Careers page
- [ ] Community / Giving Back page
- [ ] Blog index + migrate 6 existing posts with author attribution added
- [ ] Quote page with form and privacy statement
- [ ] Contact page
- [ ] Login redirect page
- [ ] Privacy Policy page
- [ ] Terms & Conditions page
- [ ] 2–3 "Coverage in Action" case studies

### 13.4 SEO, Schema & Data (Day 5–6)

- [ ] Write unique title tags and meta descriptions for all pages (store in `seo.json`)
- [ ] Implement JSON-LD schema markup on all pages per Section 4.2
- [ ] Populate `knowledge-base.json` with all FAQ content (estimated 100–150 Q&A entries)
- [ ] Ensure every FAQ section has FAQPage schema
- [ ] Ensure every team member has Person schema with credentials
- [ ] Add AggregateRating schema to homepage using Google review data
- [ ] Add author attribution and last-reviewed date to all product pages
- [ ] Create `_redirects` file with complete old-to-new URL map
- [ ] Create `_headers` file with security and caching rules
- [ ] Generate `sitemap.xml`
- [ ] Write `robots.txt`
- [ ] Add Open Graph meta tags to all pages
- [ ] Verify heading hierarchy on every page (one H1, proper nesting)
- [ ] Validate schema via Google Rich Results Test
- [ ] Verify founding year consistency across site, GBP, BBB, and Chamber

### 13.5 Performance & Quality (Day 6–7)

- [ ] Convert all images to WebP with fallbacks
- [ ] Add explicit width/height to all images
- [ ] Run Lighthouse audit on every page; target 95+
- [ ] Test all forms (submission, validation, error states)
- [ ] Cross-browser testing (Chrome, Safari, Firefox, Edge)
- [ ] Mobile responsive testing (iPhone, Android, tablet)
- [ ] Verify all internal links resolve correctly
- [ ] Test `_redirects` file for all legacy URLs
- [ ] Review every product page against AI-citability rules: Does the first paragraph directly answer the question? Are headings question-shaped? Are specific facts present?
- [ ] Verify testimonials show full text with source links
- [ ] Test `knowledge-base.json`: can a human read any single entry and get a complete, useful answer?
- [ ] Run Rich Results Test on homepage, 3 product pages, team page, and a blog post

### 13.6 Cutover (Day 7–8)

- [ ] Final staging review at Cloudflare Pages preview URL
- [ ] Update DNS: CNAME `www.thewayagency.com` to Cloudflare Pages
- [ ] Verify SSL certificate auto-provisioning
- [ ] Verify all redirects working in production
- [ ] Submit new sitemap to Google Search Console
- [ ] Ensure LocalBusiness schema includes full address, hours, geo, and license info
- [ ] Monitor Search Console for crawl errors over following week
- [ ] Cancel Webflow subscription after 30-day parallel monitoring period

---

## 14. Content Volume Estimate

| Content Type | Count | Words Each | Total Words |
|-------------|-------|-----------|-------------|
| Product pages (rewritten with full framework) | 31 | 500–800 | 15,500–24,800 |
| Knowledge base Q&A entries | 100–150 | 50–100 | 5,000–15,000 |
| Team bios | 6–10 | 80–150 | 480–1,500 |
| Coverage in Action case studies | 2–3 | 200–300 | 400–900 |
| About page (consolidated + independent agent section) | 1 | 1,000–1,500 | 1,000–1,500 |
| Blog posts (migrated, with author attribution) | 6 | existing | existing |
| Carrier descriptions | 17 | 30–50 | 510–850 |

**Estimated total new content: 23,000–45,000 words.**

This is achievable because the product page framework and knowledge base entries follow repeatable templates. Content can be AI-drafted using the Section 10 framework, then reviewed and localized by the team. The `knowledge-base.json` entries are the most leveraged: they appear on web pages, power search rich snippets, and feed the chat assistant — three outputs from one writing effort.

---

## 15. Success Criteria for Phase 1 Complete

- [ ] All pages live at new URLs on Cloudflare Pages with `www.thewayagency.com` DNS pointed
- [ ] All legacy Webflow URLs 301-redirect correctly to new locations
- [ ] Lighthouse Performance score 95+ on homepage and all hub pages
- [ ] Google Rich Results Test passes for LocalBusiness, FAQPage, Review, and Person schema
- [ ] All forms functional with confirmed receipt of test submissions
- [ ] Mobile responsive and visually polished across all breakpoints
- [ ] `#ai-chat-root` container present on every page, ready for Phase 3 mount
- [ ] `data/` directory populated with `carriers.json`, `testimonials.json`, `team.json`, `products.json`, `locations.json`, `seo.json`, `knowledge-base.json`
- [ ] Blog infrastructure functional with 6 migrated posts rendering with author attribution
- [ ] Google Search Console connected and sitemap submitted
- [ ] Street address, hours, license info, and Google rating visible in footer on every page
- [ ] Every product page follows the answer-first content framework with cost context, covered/not-covered, and FAQ
- [ ] Every product page and blog post has named author attribution with credentials
- [ ] Knowledge base contains 100+ self-contained Q&A entries ready for Phase 3 AI chat
- [ ] Founding year, NAP, and license info consistent across site, GBP, BBB, and Chamber listings
