# The Way Agency — Website

Production website for [The Way Agency](https://www.thewayagency.com), an independent insurance agency serving Kentucky, Indiana, and Tennessee.

**Stack:** Static HTML/CSS/JS → GitHub → Cloudflare Pages (push-to-deploy)  
**Pages:** 72 (product, geo, industry, blog, utility)  
**Lead gen:** Inline forms on 60 pages, 3-step quote wizard, sticky mobile CTA, exit-intent popup  
**SEO:** JSON-LD schema, 67-URL sitemap, 52 redirect rules, answer-first content

---

## Quick start

```bash
# Install nothing — it's static HTML. Just run the build script:
node scripts/build.js

# Output goes to build/ — that's what Cloudflare Pages serves.
```

## Project structure

```
thewayagency-site/
├── src/                    # Source files
│   ├── pages/              # Hand-crafted HTML pages
│   │   ├── index.html      # Homepage
│   │   ├── quote.html      # 3-step quote wizard
│   │   ├── contact.html    # Contact page
│   │   ├── personal/       # Personal lines hub + home insurance
│   │   ├── commercial/     # Commercial lines hub
│   │   ├── life-health/    # Life & health hub
│   │   ├── about/          # About, team, locations, careers, community
│   │   └── blog/           # Blog index
│   ├── css/
│   │   ├── base.css        # Reset, variables, typography, layout
│   │   ├── components.css  # Nav, hero, cards, footer, forms, FAQ
│   │   └── leadgen.css     # Inline forms, wizard, sticky bar, exit intent
│   ├── js/
│   │   └── app.js          # Lead gen engine (all JS in one file)
│   └── assets/images/      # Logos, carrier images, team photos
│
├── data/                   # JSON content (single source of truth)
│   ├── products.json       # 31 products with cost, exclusions, requirements
│   ├── carriers.json       # Personal + commercial carrier rosters
│   ├── testimonials.json   # Reviews with source, agent, product line
│   ├── locations.json      # Offices, hours, agency metadata, affiliations
│   ├── knowledge-base.json # FAQ entries (web + schema + future AI chat)
│   └── landing-pages.json  # Geo cities + industry definitions
│
├── scripts/
│   └── build.js            # Generates product, geo, and industry pages from JSON
│
├── build/                  # BUILD OUTPUT — this is what deploys
│   ├── index.html          # ... all 72 pages with CSS/JS inlined
│   ├── sitemap.xml         # 67 URLs
│   ├── _redirects          # 52 Webflow → new URL mappings
│   ├── _headers            # Security + cache headers
│   └── robots.txt
│
├── _redirects              # Also at root for Cloudflare Pages
├── _headers
├── robots.txt
└── .gitignore
```

## How it works

### Build system

The build script (`scripts/build.js`) does three things:

1. **Copies hand-crafted pages** from `src/pages/` to `build/`
2. **Generates pages from JSON** — 30 product pages, 18 geo city pages, 8 industry pages
3. **Generates sitemap.xml** with all URLs

After building, a Python post-process inlines the CSS and JS into every HTML file so each page is fully self-contained. This happens in the deploy workflow, not in `build.js`.

### Data-driven content

All dynamic content lives in `data/*.json`. To add a carrier, update `carriers.json`. To add a city landing page, add an entry to `landing-pages.json`. To add an FAQ, add to `knowledge-base.json`. Then rebuild.

The same data files power:
- The website pages
- The JSON-LD schema markup
- The future AI chat assistant (Phase 3)

### Pages by type

| Type | Count | Source | Lead capture |
|------|-------|--------|-------------|
| Homepage | 1 | Hand-crafted | Trust bar, CTA, FAQ |
| Product pages | 31 | 1 hand-crafted + 30 from JSON | Inline quote form on each |
| Hub pages | 3 | Hand-crafted | Product cards with CTAs |
| Geo city pages | 18 | Generated from `landing-pages.json` | Inline form + city context |
| Industry pages | 8 | Generated from `landing-pages.json` | Inline form + industry coverage |
| Quote page | 1 | Hand-crafted | 3-step wizard |
| About pages | 5 | Hand-crafted | CTA banners |
| Blog | 1 | Hand-crafted index | Post links |
| Utility | 4 | Hand-crafted | Contact form |

## Lead generation features

Every feature is in `src/js/app.js` and activates automatically on page load.

| Feature | Where | What it does |
|---------|-------|-------------|
| Inline quote forms | 60 product/geo/industry pages | Name + email + phone(optional), pre-tagged with product and line |
| 3-step quote wizard | `/quote.html` | Visual LOB selector → details → contact info, phone optional |
| Sticky mobile CTA | All pages (phones only) | Call / Text / Quote bar appears on scroll |
| Exit-intent popup | All pages (desktop only) | "Get a free coverage review" — 2-field form, once per session |
| Social proof | Near every form | Google review testimonial auto-injected |
| Click tracking | All pages | Tracks phone, text, email, quote button clicks |
| Scroll animations | All pages | Cards and sections fade in on scroll |
| GA4 | All pages | Initialized if `CONFIG.gaId` is set |
| Facebook Pixel | All pages | Initialized if `CONFIG.fbPixelId` is set |

## Configuration

Edit the `CONFIG` object at the top of `src/js/app.js`:

```javascript
const CONFIG = {
  webhookUrl: '',        // Where form submissions POST to
  phone: '(502) 413-5335',
  phoneRaw: '+15024135335',
  email: 'hello@thewayagency.com',
  calendarUrl: '',       // Calendly or scheduling tool URL
  gaId: '',              // Google Analytics 4 measurement ID (G-XXXXXXXXXX)
  fbPixelId: '',         // Facebook Pixel ID for retargeting
  responseTimeMinutes: 60,
};
```

### Form submissions

Forms POST JSON to `CONFIG.webhookUrl`. If empty, data logs to console only.

**Options for the webhook:**
- **Quick start:** [Formspree.io](https://formspree.io) — free tier, gives you a URL, emails submissions
- **Better:** Cloudflare Worker that emails you + writes to Google Sheet
- **Best:** Cloudflare Worker → AgencyZoom API (creates lead in CRM)

The POST body looks like:
```json
{
  "name": "John Smith",
  "email": "john@example.com",
  "phone": "2705551234",
  "lineOfBusiness": "personal",
  "product": "home",
  "source": "inline-product-form",
  "page": "/personal/home.html",
  "referrer": "https://google.com",
  "timestamp": "2026-03-22T14:30:00.000Z"
}
```

## Deployment

### Cloudflare Pages setup

1. Push this repo to GitHub
2. Cloudflare dashboard → Pages → Create project → Connect repo
3. Build settings:
   - **Build command:** (leave empty)
   - **Build output directory:** `build`
4. Deploy

Every push to `main` auto-deploys in ~30 seconds. Push to any other branch for a preview URL.

### Custom domain

In Cloudflare Pages → Custom domains → Add `www.thewayagency.com`. If the domain is already on Cloudflare, the CNAME is automatic. SSL auto-provisions.

### Redirects

The `_redirects` file maps all 52 old Webflow URLs to new locations with 301 status. Test after deploy:

```
/personal-insurance       → /personal/
/commercial/general-liability → /commercial/general-liability.html
/about-us/about-us        → /about/
/contact-us               → /contact.html
```

## SEO

### Schema markup

Every page includes JSON-LD structured data:

| Page type | Schema |
|-----------|--------|
| All pages | `InsuranceAgency` + `LocalBusiness` (address, phone, hours) |
| Homepage | + `FAQPage` + `WebSite` |
| Product pages | + `Service` + `FAQPage` |
| Team page | + `Person` per team member |
| Blog posts | + `Article` with author |
| Locations | + `LocalBusiness` per office |

### Content framework

Product pages follow the answer-first framework (see `personal/home.html` as the gold standard):

1. **Direct answer** — 2-3 sentences answering "What is [this product]?"
2. **Who needs it** — specific scenarios with local context
3. **Covered / not covered** — clear lists
4. **Cost context** — honest ranges and factors
5. **FAQ** — 3-5 real questions with self-contained answers
6. **Related coverage** — links to related products

This structure is optimized for both human readers and AI citation (Google AI Overviews, ChatGPT, Perplexity).

## Making changes

### Add a new product

1. Add entry to `data/products.json` under the right line (personal/commercial/life_health)
2. Run `node scripts/build.js`
3. Push

### Add a new city landing page

1. Add entry to `data/landing-pages.json` → `cities` array
2. Run `node scripts/build.js`
3. Push

### Add a new industry page

1. Add entry to `data/landing-pages.json` → `industries` array
2. Run `node scripts/build.js`
3. Push

### Add a new carrier

1. Add entry to `data/carriers.json` under the right line
2. Update carrier marquee in hand-crafted pages (or automate via build script)
3. Push

### Add a blog post

1. Create HTML file in `build/blog/[slug].html`
2. Add card to `src/pages/blog/index.html`
3. Add redirect rule to `_redirects` if migrating from Webflow
4. Push

### Edit hand-crafted pages

Edit files in `src/pages/`, run `node scripts/build.js`, push. The build copies them to `build/`.

### Edit generated page template

Edit the template in `scripts/build.js` → `generateProductPage()` function, rebuild, push.

## Brand

| Element | Value |
|---------|-------|
| Primary blue | `#3097D3` |
| Cyan (CTAs, accents) | `#20BCEE` |
| Green (success, secondary) | `#65C5B3` |
| Navy (headings, hero) | `#173358` |
| Font | Montserrat — 600 for headings, 300 for body |
| Logo horizontal | `src/assets/images/logo-horizontal.png` |
| Logo stacked | `src/assets/images/logo-stacked.png` |

## Phase 3 — AI chat (placeholder)

Every page has a `<div id="ai-chat-root"></div>` container. The `data/knowledge-base.json` file has 16 Q&A entries covering common insurance questions. When ready:

1. Build the chat widget UI
2. Connect to Claude API with knowledge-base.json as context
3. Mount into `#ai-chat-root`
4. No HTML changes needed on any page

## Contact

The Way Agency  
4501 Stonegate Dr, Owensboro, KY 42303  
(502) 413-5335  
hello@thewayagency.com
