'use strict';
/**
 * llms.txt / llms-full.txt rules (AEO-05; url-hygiene spec 3.8, 3.9 section 11).
 *
 * The two files are generated from data by scripts/builders/llms.js. These
 * rules say what they may never print and how every URL in them must resolve.
 * The builder uses claimProblems() to leave out any hub paragraph or FAQ that
 * would break a rule; scripts/validate-build.js runs both checks on the built
 * files, so a rule broken by new data fails CI instead of reaching a reader.
 *
 * Dependency-free (Node 18, no npm ci): CI's safe-build job requires it.
 */
const { SITE_ORIGIN } = require('./site-urls');
const { scanText } = require('./claims-scan');

// Never in either file. Each rule names the decision that keeps it out.
const FILE_RULES = Object.freeze([
  { id: 'founding', why: 'no founding statement until TRUST-02 / entity D4 settles one (data/entity.json founding is null)', re: /\b1998\b|\btwenty-five\b|\bfounded\b|\bestablished in\b|\bsince (?:19|20)\d\d\b/i },
  { id: 'count', why: 'no carrier or tenure counts such as "40+" (TRUST-05)', re: /\b\d+\+/ },
  { id: 'top-rated', why: 'no "top-rated" claim (TRUST-05)', re: /\btop[- ]rated\b/i },
  { id: 'headquarters', why: 'no "headquartered" or "HQ": the agency has no public location (AEO-05, entity B6)', re: /\bheadquarter|\bHQ\b/i },
  { id: 'office', why: 'no office wording: service-area business, PO Box 187 is mail only (LOCAL-06)', re: /\boffices?\b/i },
  { id: 'base-locality', why: 'no base city until entity D1 is confirmed (data/entity.json base_locality is null)', re: /\bhome base\b|\bis (?:our )?home\b(?! insurance)|\bour home\b|\bbased (?:in|out of)\b/i },
  { id: 'local-agents', why: 'no "local agents" claim: no licensed staff member is confirmed to serve the Indiana or Tennessee hubs (OA-21 item 8)', re: /\blocal (?:agents?|agency|market)\b|\bwalked these neighborhoods\b|\bevery client gets\b|\bon every account\b/i },
  { id: 'medicare-compare', why: 'Medicare is referred, never compared (owner decision 3; TRUST-01): no Medicare Advantage, Part C or Part D sales copy', re: /\bMedicare Advantage\b|\bPart [CD]\b|\bcompar\w*\b[^.\n]{0,60}\bMedicare\b|\bMedicare\b[^.\n]{0,60}\bcompar/i },
  { id: 'in-person', why: 'in-person meetings are not confirmed (OA-21 item 7, priority-hubs D1)', re: /\bin person\b/i },
  { id: 'response-promise', why: 'no response-time promise until claims D16 is answered', re: /\bsame (?:business )?day\b/i },
  { id: 'em-dash', why: 'copy rules: no em dashes', re: /—/ },
  // The three hard-coded "specialty" lines (url-hygiene D1(c)) are not in
  // data/products.json. Allowed again only once products.json names the line.
  { id: 'specialty', why: 'farm, distillery and bourbon, and crop lines are not in data/products.json (url-hygiene D1(c))', re: /\bfarm[- ](?:insurance|package|and ranch)\b|\bdistill\w*\b|\bbourbon\b|\bcraft beverage\b|\bMPCI\b|\bcrop (?:insurance|coverage)\b|\bagritourism\b/i, unlessProduct: /farm|distill|bourbon|crop|agritourism|beverage/i },
]);

// Hub prose only (llms-full.txt): stricter, because no paragraph of hub copy
// has an approved neutral form for these yet.
const PROSE_RULES = Object.freeze([
  { id: 'medicare-prose', why: 'Medicare appears only as a product link until the TRUST-01 copy is live', re: /\bMedicare\b|\bMedigap\b/i },
  { id: 'meeting-modes', why: 'meeting modes beyond the /contact wording are not confirmed (OA-21 item 7)', re: /\bvideo\b/i },
  { id: 'html-link', why: 'hub prose is printed without its markup', re: /<a\b/i },
  // priority-hubs spec R3-1 "Verify-or-fix before any expansion" (MKT-02 step 0):
  // these hub claims stay out of the AI-facing file until #71 sources or rewrites them.
  { id: 'uninsured-rate', why: 'uninsured-driver rate claim has no primary source (priority-hubs verify-or-fix)', re: /uninsured[- ]drivers?\s+rates?|rates?\s+of\s+uninsured\s+drivers?/i },
  { id: 'savings-range', why: 'unsubstantiated savings range (TRUST-10; rewrites.md row 141)', re: /\b\d+\s*(?:to|-|\u2013)\s*\d+\s*(?:percent|%)/i },
  { id: 'flood-area', why: 'Daviess flood-area and NFIP CRS claims are not yet cited (priority-hubs verify-or-fix)', re: /square miles|Community Rating System/i },
  { id: 'commute', why: 'commuting and corridor claims are not checked against Census ACS (priority-hubs verify-or-fix)', re: /\bMost\b[^.]{0,40}\bresidents\s+drive\b|I-65 corridor/i },
  { id: 'construction-area', why: 'new-construction locality claim is not checked (priority-hubs verify-or-fix)', re: /new construction[^.]{0,80}\bKY-(?:44|480)\b/i },
  { id: 'carrier-capability', why: 'carrier-capability sentences stay only for D4-verified lines (priority-hubs verify-or-fix)', re: /\bWe represent\b[^.]{0,60}\bcarriers\b/i },
]);

function firstMatch(re, text) {
  const m = String(text).match(re);
  return m ? m[0] : null;
}

/**
 * Rule hits for one text. opts.productNames (data/products.json names) lifts
 * the specialty rule once a matching product exists; opts.prose adds the hub
 * prose rules. claims-scan.js hard rules apply too (one source for retractions).
 * @returns {{rule: string, why: string, match: string}[]}
 */
function claimProblems(text, opts = {}) {
  const names = (opts.productNames || []).join(' | ');
  const rules = opts.prose ? FILE_RULES.concat(PROSE_RULES) : FILE_RULES;
  const out = [];
  for (const r of rules) {
    if (r.unlessProduct && r.unlessProduct.test(names)) continue;
    const m = firstMatch(r.re, text);
    if (m) out.push({ rule: r.id, why: r.why, match: m });
  }
  for (const f of scanText(text, 'build/llms.txt')) {
    if (f.severity === 'hard') out.push({ rule: `claims-scan:${f.rule}`, why: 'claims-scan.js hard rule', match: f.match });
  }
  return out;
}

const URL_RE = /https:\/\/www\.thewayagency\.com(?:\/[^\s)<>\]"']*)?/g;

/** Every site URL in the text (markdown links and bare URLs), in order, duplicates kept. */
function siteUrls(text) {
  return [...String(text).matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:]+$/, ''));
}

/** id="..." values in an HTML document. */
function htmlIds(html) {
  return new Set([...String(html).matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
}

/**
 * URL problems: every URL is a built page (so Pages answers 200), never a
 * .html form, never a _redirects source, and any #fragment is an id on it.
 * @param {string} text
 * @param {{routes: Set<string>, isRedirected?: (route: string) => boolean, idsOf?: (route: string) => Set<string>}} site
 *   isRedirected: true when a 3xx rule in _redirects matches the route (see redirectMatcher)
 */
function urlProblems(text, site) {
  const out = [];
  for (const url of new Set(siteUrls(text))) {
    let rest = url.slice(SITE_ORIGIN.length) || '/';
    const hash = rest.indexOf('#');
    const frag = hash >= 0 ? rest.slice(hash + 1) : '';
    if (hash >= 0) rest = rest.slice(0, hash);
    const route = rest.split('?')[0] || '/';
    if (/\.html$/i.test(route)) { out.push(`${url}: names a .html file (Pages 308s it to the extensionless URL)`); continue; }
    if (!site.routes.has(route)) { out.push(`${url}: not a built page`); continue; }
    if (site.isRedirected && site.isRedirected(route)) { out.push(`${url}: is a _redirects source, so it does not answer 200`); continue; }
    if (frag && site.idsOf && !site.idsOf(route).has(frag)) out.push(`${url}: no id="${frag}" on ${route}`);
  }
  return out;
}

/** A route matcher for the 3xx rules of a _redirects file (url-hygiene.js parser; splats and :placeholders). */
function redirectMatcher(redirectsText) {
  const { parseRedirects, sourceRegExp } = require('./url-hygiene');
  const res = parseRedirects(redirectsText || '')
    .filter((r) => r.source && r.source.startsWith('/') && r.status >= 300 && r.status < 400)
    .map((r) => sourceRegExp(r.source));
  return (route) => res.some((re) => re.test(route));
}

module.exports = { FILE_RULES, PROSE_RULES, claimProblems, siteUrls, htmlIds, urlProblems, redirectMatcher };
