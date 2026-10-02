# Content Rules, The Way Agency Site

These are the gates every new piece of content on thewayagency.com passes through. They prevent the kind of templated low-value bulk that led to the 744-bridge-page deletion in April 2026, and they prevent fabricated trust signals (the kind that get an insurance YMYL site downranked or worse).

## Hard rules

1. **No fabricated trust signals.** If a credential, designation, certification, badge, partnership, award, or affiliation cannot be verified by document or by Sheilia, do not put it on the site. Examples we have already removed: a generic CISR designation claim in the team page meta description.

2. **Carrier logos only from official co-branding kits.** Never scrape, recreate, or color-match a carrier's wordmark. If the carrier has not provided a co-branding kit for the agency, list the carrier by name only.

3. **Click-to-call always pairs with text.** Every phone CTA on every page must offer text as a clickable peer option (`sms:+15024135335`). Footer, hero, intake, error pages, all in scope.

4. **Service-area business posture in JSON-LD.** The agency has no storefront. JSON-LD never gives the agency a `streetAddress`, `postalCode`, `geo`, opening hours, `priceRange`, `aggregateRating` or `review`, and never a per-city or per-county `LocalBusiness`/`InsuranceAgency` node. The one agency node (`@id` `https://www.thewayagency.com/#organization`) is generated on the homepage from `data/entity.json`. Its `address`, if any, is the owner-approved base city only. Every other page refers to it with `orgRef()` (`scripts/lib/entity.js`). A city or county appears only in `Service.areaServed`. The PO Box appears in visible `<address>` text (and, only if the owner approves, as a mailing `contactPoint` using `postOfficeBoxNumber`). `scripts/lib/entity-schema-guard.js` fails the build otherwise. `data/entity.json` changes only with Sheilia's sign-off.

5. **No interpretation stated as fact.** Phrases like "she founded", "primary point of contact", "specializes in", "leads", "focuses on" require attestation by the named individual. Use only what is sourced verbatim from `data/team.json` or other verified data files.

6. **A/B variant for substantive form changes.** Intake field changes, CTA changes, copy changes that affect conversion ship behind the `AB_EXPERIMENTS` framework in `src/js/app.js`, not as straight cutovers.

7. **PII guards.** Customer documents, XLSX/CSV exports, document scans, database dumps never go in git. New directories that may receive PII are added to `.gitignore` proactively.

8. **Preserve the spelling "Sheilia".** Do not auto-correct to "Sheila".

## Per-blog-post gates

Every new blog post in `src/blog/` must include all of the following before it ships:

- [ ] A specific Kentucky data point OR a named local landmark (KY DOI rule, FEMA flood zone, KY-44 corridor, Floyds Fork, etc.)
- [ ] An honest byline. The post is "Written by The Way Agency" unless a team member actually wrote it; then `author_slug` names them in `data/team.json` (the page prints team.json's name and title, never `author`/`author_title`, which the build warns about when they differ; a slug naming no member prints the agency). An AI-drafted post is the agency's: SAGE refuses to promote one with an `author_slug` unless that person approves it. Do not write `reviewer:`/`reviewed_date:` lines: a "Reviewed by" byline (and the JSON-LD reviewedBy) renders only for the assigned reviewer's approval in SAGE, signed by SAGE and bound to the exact file (`scripts/lib/review-credit.js`), and hand-written review lines are ignored. Do not claim a review in the text either ("Reviewed by ...", "Checked by our licensed agents" in a title, description, CTA, alt text or the article): such wording is not refused, because code cannot tell it from advice reliably, but the build logs it as a warning and SAGE shows the warning next to the text to the person approving an AI draft or an AI-proposed edit. Only the signed byline is a verified credit. Front-matter values are plain text: a value containing `<` or `>` or an invisible, control or bidi character (zero-width, soft hyphen, direction marks, line separators; an emoji's own joiners are fine), a `slug`/`author_slug`/`reviewer_slug` that is not lower-case letters, digits and hyphens, or a `date` that is not YYYY-MM-DD stops the post from publishing (`unsafe_frontmatter`). Arrows, emoji, accents and other scripts are fine. A `reading_time` other than "N min" or "N min read" is not printed: the page shows the computed time and the build logs a warning. The check is `scripts/lib/blog-content-guard.js`, the same file sage-server runs before it promotes a draft or records an approval.
- [ ] A real `description` line (150 to 160 chars) for the meta tag.
- [ ] At least one internal link to a relevant priority hub (`/insurance/owensboro-ky.html`, `/insurance/mt-washington-ky.html`) or LOB page.
- [ ] Honest scope claims. If we do not write a coverage type, the post acknowledges that and points to a specialist. Example: multi-peril crop insurance is referred out; we write farm packages only.
- [ ] No generic templated city paragraph that could be search-and-replaced into another city's post.

## Per-city-hub gates

Every new entry in `data/landing-pages.json` `cities[]` must include:

- [ ] Real prose for the city's `context` field. No "Welcome to {city}, where we proudly serve..." auto-fill.
- [ ] At least four `context_sections` covering home, auto, commercial, and life/health, each with named local landmarks (roads, corridors, neighborhoods, employers) specific to the city.
- [ ] A `context_closing` paragraph that ties the city back to either Owensboro HQ or a named team specialty.
- [ ] An `faqs[]` array of the questions customers actually ask (calls, texts, emails, chats, People Also Ask), each with an accurate, definition-first answer. No fixed count.
- [ ] Schema: the hub's JSON-LD is generated (never hand-add nodes) and names the city or county only in `Service.areaServed`. `node scripts/build.js` passes (its entity schema guard) and validator.schema.org shows no errors. A Rich Results Test pass is not a gate: FAQ rich results were retired on 2026-05-07, Service has no rich result, and a "Review snippets" pass on the agency's own rating is a violation, not compliance. Once visible breadcrumbs ship (TECH-01), the Rich Results Test must show no Breadcrumbs errors.

## Carrier mentions

Carrier names that appear in body copy or `Service` schema must be present in `data/carriers.json`. Do not name a carrier we do not actually have an appointment with.

For Owensboro and Mt Washington hubs, the "we represent top-rated carriers including..." line should pull from `data/carriers.json` rather than hard-coding names that may drift.

## Schema validation

Before any commit that touches a city hub, product page, blog post, team page, or `data/entity.json`, run:

```
node scripts/build.js
npm test
```

The build runs the entity schema guard (`scripts/lib/entity-schema-guard.js`): it fails on a per-city `LocalBusiness`, a street address, geo, hours, `priceRange`, a rating or review, an owner placeholder, or a second description of the agency. Then check `/`, `/insurance/owensboro-ky` and `/insurance/mt-washington-ky` at https://validator.schema.org/ (no errors) and at https://search.google.com/test/rich-results. Organization markup is checked on the homepage, JobPosting on the careers pages. Rich Results Test warnings about a missing street address, `geo`, opening hours or `priceRange` are expected for a service-area business: do not "fix" them. No rich result is promised, so a missing one is not a failure.

## Why these rules exist

- The 744 bridge pages were deleted because they were templated and low-value. Resurrecting that pattern at the post or city level erases the gain.
- An insurance agency is a YMYL (your money or your life) site. Google holds YMYL content to a higher E-E-A-T standard, and AI engines (ChatGPT, Claude, Perplexity, Gemini) weight named authors and verifiable claims heavily for grounding.
- Owensboro and Mt Washington are the priority markets at every decision point. Every new piece of content should be evaluated against whether it strengthens or dilutes one of those two markets.

Owner: Sheilia Royal. Last updated 2026-10-02.
