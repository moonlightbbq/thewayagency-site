# Content Rules, The Way Agency Site

These are the gates every new piece of content on thewayagency.com passes through. They prevent the kind of templated low-value bulk that led to the 744-bridge-page deletion in April 2026, and they prevent fabricated trust signals (the kind that get an insurance YMYL site downranked or worse).

## Hard rules

1. **No fabricated trust signals.** If a credential, designation, certification, badge, partnership, award, or affiliation cannot be verified by document or by Sheilia, do not put it on the site. Examples we have already removed: a generic CISR designation claim in the team page meta description.

2. **Carrier logos only from official co-branding kits.** Never scrape, recreate, or color-match a carrier's wordmark. If the carrier has not provided a co-branding kit for the agency, list the carrier by name only.

3. **Click-to-call always pairs with text.** Every phone CTA on every page must offer text as a clickable peer option (`sms:+15024135335`). Footer, hero, intake, error pages, all in scope.

4. **Service-area business posture in JSON-LD.** `streetAddress` does not appear in `LocalBusiness`, `InsuranceAgency`, or `Organization` JSON-LD. The PO Box appears in human-readable `<address>` tags only. Schema uses `addressLocality` + `addressRegion` + `postalCode` + `addressCountry` + `areaServed`.

5. **No interpretation stated as fact.** Phrases like "she founded", "primary point of contact", "specializes in", "leads", "focuses on" require attestation by the named individual. Use only what is sourced verbatim from `data/team.json` or other verified data files.

6. **A/B variant for substantive form changes.** Intake field changes, CTA changes, copy changes that affect conversion ship behind the `AB_EXPERIMENTS` framework in `src/js/app.js`, not as straight cutovers.

7. **PII guards.** Customer documents, XLSX/CSV exports, document scans, database dumps never go in git. New directories that may receive PII are added to `.gitignore` proactively.

8. **Preserve the spelling "Sheilia".** Do not auto-correct to "Sheila".

## Per-blog-post gates

Every new blog post in `src/blog/` must include all of the following before it ships:

- [ ] A specific Kentucky data point OR a named local landmark (KY DOI rule, FEMA flood zone, KY-44 corridor, Floyds Fork, etc.)
- [ ] A named author with `author_slug` matching a `data/team.json` entry. The Article schema and "Reviewed by" byline both source from this.
- [ ] A real `description` line (150 to 160 chars) for the meta tag.
- [ ] At least one internal link to a relevant priority hub (`/insurance/owensboro-ky.html`, `/insurance/mt-washington-ky.html`) or LOB page.
- [ ] Honest scope claims. If we do not write a coverage type, the post acknowledges that and points to a specialist. Example: multi-peril crop insurance is referred out; we write farm packages only.
- [ ] No generic templated city paragraph that could be search-and-replaced into another city's post.

## Per-city-hub gates

Every new entry in `data/landing-pages.json` `cities[]` must include:

- [ ] Real prose for the city's `context` field. No "Welcome to {city}, where we proudly serve..." auto-fill.
- [ ] At least four `context_sections` covering home, auto, commercial, and life/health, each with named local landmarks (roads, corridors, neighborhoods, employers) specific to the city.
- [ ] A `context_closing` paragraph that ties the city back to either Owensboro HQ or a named team specialty.
- [ ] An `faqs[]` array of 8 to 13 questions, 40 to 90 word definition-first answers, sourced from the audit Pillar 8 list or equivalent. Answer the questions Google PAA and AI engines actually ask.
- [ ] Schema validation passes the Rich Results Test for `LocalBusiness`, `InsuranceAgency`, `Service`, and `FAQPage`.

## Carrier mentions

Carrier names that appear in body copy or `Service` schema must be present in `data/carriers.json`. Do not name a carrier we do not actually have an appointment with.

For Owensboro and Mt Washington hubs, the "we represent top-rated carriers including..." line should pull from `data/carriers.json` rather than hard-coding names that may drift.

## Schema validation

Before any commit that touches a city hub, product page, blog post, or team page, run:

```
node scripts/build.js
```

Then validate at least one priority page (`/insurance/owensboro-ky.html` or `/insurance/mt-washington-ky.html`) at https://search.google.com/test/rich-results.

## Why these rules exist

- The 744 bridge pages were deleted because they were templated and low-value. Resurrecting that pattern at the post or city level erases the gain.
- An insurance agency is a YMYL (your money or your life) site. Google holds YMYL content to a higher E-E-A-T standard, and AI engines (ChatGPT, Claude, Perplexity, Gemini) weight named authors and verifiable claims heavily for grounding.
- Owensboro and Mt Washington are the priority markets at every decision point. Every new piece of content should be evaluated against whether it strengthens or dilutes one of those two markets.

Owner: Sheilia Royal. Last updated 2026-05-15.
