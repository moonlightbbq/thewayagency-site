# The Way Agency — Website

Production website for [The Way Agency](https://www.thewayagency.com), an independent insurance agency serving Kentucky, Indiana, and Tennessee.

**Stack:** Static HTML/CSS/JS → GitHub → Cloudflare Pages (push-to-deploy)
**Pages:** ~80 (product, geo, industry, blog, utility)
**Lead gen:** Inline forms on 60+ pages, intake wizard, sticky mobile CTA, exit-intent popup
**SEO:** JSON-LD schema, 78-URL sitemap, 52+ redirect rules, answer-first content

---

## Quick start

```bash
node scripts/build.js     # Generate all pages into build/
node scripts/admin.js      # Content management CLI
```

Build output goes to `build/` which is **gitignored** — Cloudflare Pages runs the build command on deploy.

## Project structure

```
thewayagency-site/
├── src/                    # Source files
│   ├── pages/              # Hand-crafted HTML pages
│   │   ├── index.html      # Homepage
│   │   ├── contact.html    # Contact page
│   │   ├── personal/       # Personal lines hub
│   │   ├── commercial/     # Commercial lines hub
│   │   ├── life-health/    # Life & health hub
│   │   ├── about/          # About, team, locations, careers, community
│   │   └── blog/           # Blog index + individual post HTML files
│   ├── intake.html         # Lead intake wizard (SPA)
│   ├── portal.html         # Client portal (SPA)
│   ├── partner.html        # Partner page (SPA)
│   ├── css/
│   │   ├── base.css        # Reset, variables, typography, layout
│   │   ├── components.css  # Nav, hero, cards, footer, forms, FAQ
│   │   └── leadgen.css     # Inline forms, wizard, sticky bar, exit intent
│   ├── js/
│   │   └── app.js          # Lead gen engine (all JS in one file)
│   └── assets/images/      # Logos (PNG + WebP), social image, favicon
│
├── data/                   # JSON content (single source of truth)
│   ├── products.json       # 31 products with cost, exclusions, requirements
│   ├── carriers.json       # Personal + commercial carrier rosters
│   ├── testimonials.json   # Reviews with source, agent, product line
│   ├── team.json           # Staff bios, roles, credentials, license states
│   ├── locations.json      # Offices, hours, agency metadata, affiliations
│   ├── knowledge-base.json # FAQ entries (web + schema + future AI chat)
│   ├── landing-pages.json  # Geo cities + industry definitions
│   └── seo.json            # Per-page title, description, schema types
│
├── scripts/
│   ├── build.js            # Generates product, geo, industry pages from JSON
│   ├── admin.js            # Content management CLI (blog, team, products)
│   └── generate-blog.js    # Converts Markdown blog posts to HTML
│
├── workers/
│   └── contact.js          # Cloudflare Worker for contact form → email
│
├── _redirects              # Cloudflare Pages redirect rules (52+ rules)
├── _headers                # Security + cache headers
├── robots.txt
├── wrangler.toml           # Cloudflare Workers config
├── package.json
└── .gitignore              # Excludes build/, node_modules/, *.env
```

**Note:** `build/` is not committed to git. Cloudflare Pages runs `node scripts/build.js` on every push.

## How it works

### Build system

The build script (`scripts/build.js`) does:

1. **Copies hand-crafted pages** from `src/pages/` to `build/` (including blog posts)
2. **Copies SPA pages** — intake, portal, partner
3. **Generates pages from JSON** — 31 product pages, 18 geo city pages, 8 industry pages
4. **Generates sitemap.xml** with all URLs
5. **Copies static assets** — CSS, JS, images, headers, redirects, robots.txt

### Data-driven content

All dynamic content lives in `data/*.json`. To add a carrier, update `carriers.json`. To add a city landing page, add an entry to `landing-pages.json`. To add an FAQ, add to `knowledge-base.json`. Then rebuild.

The same data files power:
- The website pages
- The JSON-LD schema markup
- The admin CLI
- The future AI chat assistant (Phase 3)

### Pages by type

| Type | Count | Source | Lead capture |
|------|-------|--------|-------------|
| Homepage | 1 | Hand-crafted | Trust bar, CTA, FAQ |
| Product pages | 31 | Generated from `products.json` | Inline quote form on each |
| Hub pages | 3 | Hand-crafted | Product cards with CTAs |
| Geo city pages | 18 | Generated from `landing-pages.json` | Inline form + city context |
| Industry pages | 8 | Generated from `landing-pages.json` | Inline form + industry coverage |
| Intake wizard | 1 | Hand-crafted SPA | Multi-step lead intake |
| About pages | 5 | Hand-crafted | CTA banners |
| Blog | 13 | Hand-crafted HTML | Post links, CTAs |
| Utility | 4 | Hand-crafted | Contact form |

## Lead generation features

All lead forms submit to `sage.thewayagency.com/api/intake/lead` (configured in `src/js/app.js`).

| Feature | Where | What it does |
|---------|-------|-------------|
| Inline quote forms | 60+ product/geo/industry pages | Name + email + phone(optional), pre-tagged with product and line |
| Intake wizard | `/intake/` | Smart multi-step form with product routing |
| Sticky mobile CTA | All pages (phones only) | Call / Text / Quote bar appears on scroll |
| Exit-intent popup | All pages (desktop only) | "Get a free coverage review" — 2-field form, once per session |
| Social proof | Near every form | Google review testimonial auto-injected |
| Turnstile CAPTCHA | All forms | Cloudflare Turnstile invisible challenge |
| GA4 | All pages | Initialized if `CONFIG.gaId` is set |

## Configuration

Edit the `CONFIG` object at the top of `src/js/app.js`:

```javascript
const CONFIG = {
  webhookUrl: 'https://sage.thewayagency.com/api/intake/lead',
  turnstileSiteKey: '0x4AAAAAACuOvP2DfWPQJz9W',
  phone: '(502) 413-5335',
  phoneRaw: '+15024135335',
  email: 'hello@thewayagency.com',
  gaId: 'G-C79ZCDZVPE',
  fbPixelId: '',
  responseTimeMinutes: 60,
};
```

## Deployment

### Cloudflare Pages setup

1. Push this repo to GitHub
2. Cloudflare dashboard → Pages → Create project → Connect repo
3. Build settings:
   - **Build command:** `node scripts/build.js`
   - **Build output directory:** `build`
4. Deploy

Every push to `main` auto-deploys. Push to any other branch for a preview URL.

### Cloudflare Workers

The contact form worker is configured in `wrangler.toml`. Deploy separately:

```bash
npx wrangler deploy
```

### Redirects

The `_redirects` file maps old Webflow URLs to new locations with 301 status:

```
/personal-insurance       → /personal/
/commercial/general-liability → /commercial/general-liability.html
/about-us/about-us        → /about/
/contact-us               → /contact.html
/quote.html               → /intake/
```

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

### Add a blog post

**From Markdown** (preferred):
1. Create `src/blog/[slug].md` with front matter (see `scripts/generate-blog.js` for format)
2. Run `node scripts/generate-blog.js`
3. Add card to `src/pages/blog/index.html`
4. Push

**From HTML:**
1. Create `src/pages/blog/[slug].html`
2. Add card to `src/pages/blog/index.html`
3. Push

### Content management CLI

```bash
node scripts/admin.js blog list
node scripts/admin.js team list
node scripts/admin.js testimonial list
node scripts/admin.js product list
node scripts/admin.js deploy           # Rebuild + git push
```

## Brand

| Element | Value |
|---------|-------|
| Primary blue | `#3097D3` |
| Cyan (CTAs, accents) | `#20BCEE` |
| Green (success, secondary) | `#65C5B3` |
| Navy (headings, hero) | `#173358` |
| Font | Montserrat — 600 for headings, 300 for body |
| Logo horizontal | `src/assets/images/logo-horizontal.webp` (PNG fallback available) |

## Phase 3 — AI chat (placeholder)

Every page has a `<div id="ai-chat-root"></div>` container. The `data/knowledge-base.json` file has FAQ entries covering common insurance questions. When ready:

1. Build the chat widget UI
2. Connect to Claude API with knowledge-base.json as context
3. Mount into `#ai-chat-root`
4. No HTML changes needed on any page

## Contact

The Way Agency
PO Box 187, Owensboro, KY 42302
(502) 413-5335
hello@thewayagency.com
