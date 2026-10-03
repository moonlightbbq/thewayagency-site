/**
 * Medicare TPMO disclaimer and the Medicare/health lead disclosure (TRUST-01).
 *
 * The ONLY implementation of both texts. Product pages, blog posts, the frozen
 * legacy guide, the build guard (scripts/check-health-compliance.js) and the
 * intake page read them from here; src/intake.html cannot load Node modules,
 * so it carries a mirror of leadDisclosureText() and the sentence templates,
 * and tests/intake-health-disclosure.test.js fails when the two drift.
 *
 * Inputs come from data/medicare-tpmo.json. Pure functions: no I/O, CommonJS,
 * Node 18 (CI builds on Node 18 without npm ci, so no dependencies).
 *
 * Rules (specs/medicare-health-compliance.md 3.1-3.2):
 *   - the TPMO statement is standardized content, 42 CFR 422.2267(e)(41) and
 *     423.2267(e)(41) as amended for CY2027 (91 FR 17583): only the two counts
 *     vary; the wording, punctuation and order never change;
 *   - it renders only with status "active", branch A or mixed, and counts for
 *     the area from a dated record signed by a licensed agent; never a
 *     placeholder, never a guessed or statewide number for counties that differ;
 *   - 1-800-MEDICARE is plain text, never a tel: link, and is followed by its
 *     hours (42 CFR 422.2262(c)(1)(iii));
 *   - the lead disclosure (806 KAR 17:570 Section 22(2)(c); 42 CFR
 *     422.2274(g)) names "a licensed insurance agent" until the owner's record
 *     names who contacts the visitor (contact_entities). Counsel approves the
 *     one set of texts: the Phase 1 default, Branch A and Branch B.
 */
'use strict';

// STANDARDIZED CONTENT. Do not edit wording, punctuation or order.
const NOT_ALL = (o, p) => `We do not offer every plan available in your area. Currently we represent ${o} organizations which offer ${p} products in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.`;
const ALL = (o, p) => `Currently we represent ${o} organizations which offer ${p} products in your area. You can always contact Medicare.gov or 1-800-MEDICARE for help with plan choices.`;
// 42 CFR 422.2262(c)(1)(iii): wherever 1-800-MEDICARE appears, state its hours at least once.
// A separate sentence, so the standardized wording stays unaltered. TTY number as printed on CMS tip sheet 12237-P
// (and on Medicare.gov "Talk to someone", retrieved 2026-10-02).
const MEDICARE_HOURS = '1-800-MEDICARE (TTY 1-877-486-2048) is available 24 hours a day, 7 days a week.';
// Retired wording (the SHIP clause CMS removed for CY2027 marketing). The guard fails if it appears anywhere.
const RETIRED_FRAGMENT = 'or your local State Health Insurance Program';

const STATUSES = Object.freeze(['pending_owner', 'active', 'not_applicable']);
const BRANCHES = Object.freeze(['A', 'A1', 'B', 'C', 'mixed']);
const VARIANTS = Object.freeze(['not_all', 'all']);
const STATE_NAMES = Object.freeze({ KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' });
// The two priority markets (Owensboro, Mt Washington): the default areas on pages that serve every area.
const PRIORITY_COUNTIES = Object.freeze([['KY', 'Daviess County'], ['KY', 'Bullitt County']]);

const LEAD_CONTEXTS = Object.freeze(['medicare', 'health', 'health_line']);
const DEFAULT_AGENT = 'a licensed insurance agent';
const DEFAULT_MEDICARE_LABEL = 'Medicare plans';
const TCPA_SENTENCE = 'Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out of texts.';
const SOLICITATION = 'This is a solicitation for insurance.';

const PLACEHOLDER_RE = /\[|insert/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (n) => Number.isInteger(n);

/** Why a filled area entry is unusable, or null. */
function areaProblem(entry) {
  if (!isObj(entry)) return 'is not { "organizations": <int>, "products": <int> }';
  const { organizations: o, products: p } = entry;
  if (!isCount(o) || !isCount(p)) return 'organizations and products must be integers';
  if (o < 2) return 'organizations must be at least 2 (with one organization the statement is optional and "1 organizations" must never print)';
  if (p < o) return 'products must be at least the number of organizations';
  return null;
}

/** Every string value in v (deep), with its path. */
function* strings(v, path) {
  if (typeof v === 'string') yield [path, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${path}[${i}]`);
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) yield* strings(x, path ? `${path}.${k}` : k);
}

/**
 * What is wrong with data/medicare-tpmo.json, as strings ([] when nothing).
 * Shape problems are reported in every status; the readiness rules (branch,
 * variant, as_of, signed_record, plan year) only when status is "active".
 * Plan-year rule: from October 1 of year Y the counts must be for plan year
 * Y + 1 (the yearly re-confirmation), before it for Y.
 */
function tpmoProblems(data, today = new Date()) {
  const out = [];
  if (!isObj(data)) return ['medicare-tpmo.json is not a JSON object'];
  if (!STATUSES.includes(data.status)) out.push(`status must be one of ${STATUSES.join(', ')}`);
  if (data.branch !== null && data.branch !== undefined && !BRANCHES.includes(data.branch)) out.push(`branch must be null or one of ${BRANCHES.join(', ')}`);
  if (data.variant !== null && data.variant !== undefined && !VARIANTS.includes(data.variant)) out.push(`variant must be null or one of ${VARIANTS.join(', ')}`);
  if (!isObj(data.display)) out.push('display must be an object of booleans');

  const areas = isObj(data.areas) ? data.areas : null;
  if (!areas) out.push('areas must be an object keyed by state');
  for (const [state, a] of Object.entries(areas || {})) {
    if (!isObj(a)) { out.push(`areas.${state} must be an object`); continue; }
    if (typeof a.uniform_statewide !== 'boolean') out.push(`areas.${state}.uniform_statewide must be true or false`);
    if (a.statewide !== null && a.statewide !== undefined) {
      const p = areaProblem(a.statewide);
      if (p) out.push(`areas.${state}.statewide ${p}`);
    }
    for (const [county, entry] of Object.entries(isObj(a.counties) ? a.counties : {})) {
      if (entry === null) continue;
      const p = areaProblem(entry);
      if (p) out.push(`areas.${state}.counties["${county}"] ${p}`);
    }
  }

  const ld = data.lead_disclosure;
  if (!isObj(ld)) out.push('lead_disclosure must be an object');
  else {
    if (!Array.isArray(ld.contact_entities) || ld.contact_entities.some((e) => typeof e !== 'string' || !e.trim())) {
      out.push('lead_disclosure.contact_entities must be an array of names (empty for the default "a licensed insurance agent")');
    }
    if (typeof ld.medicare_products_label !== 'string' || !ld.medicare_products_label.trim()) out.push('lead_disclosure.medicare_products_label must be a non-empty string');
    if (typeof ld.tcpa !== 'boolean') out.push('lead_disclosure.tcpa must be true or false');
    if (ld.partner_consent !== null && ld.partner_consent !== undefined
      && !(isObj(ld.partner_consent) && typeof ld.partner_consent.entity === 'string' && ld.partner_consent.entity.trim() && typeof ld.partner_consent.text_version === 'string')) {
      out.push('lead_disclosure.partner_consent must be null or { "entity": <name>, "text_version": <version> }');
    }
  }

  // No placeholder may survive anywhere a value can print.
  for (const [path, s] of strings({ areas: data.areas, lead_disclosure: data.lead_disclosure, signed_record: data.signed_record, as_of: data.as_of }, '')) {
    if (PLACEHOLDER_RE.test(s)) out.push(`${path} looks like a placeholder (${JSON.stringify(s.slice(0, 60))})`);
  }

  if (data.status === 'active') {
    if (!BRANCHES.includes(data.branch)) out.push('an active record needs its branch (A, A1, B, C or mixed)');
    if (!VARIANTS.includes(data.variant)) out.push('an active record needs its variant (not_all or all)');
    if (typeof data.as_of !== 'string' || !DATE_RE.test(data.as_of)) out.push('as_of must be the YYYY-MM-DD date of the signed record');
    if (typeof data.signed_record !== 'string' || !data.signed_record.trim()) out.push('signed_record must reference the signed record (an internal reference, never a name)');
    const d = today instanceof Date ? today : new Date(today);
    const y = d.getUTCFullYear();
    const minYear = d.getUTCMonth() >= 9 ? y + 1 : y; // October is month 9
    if (!Number.isInteger(data.plan_year) || data.plan_year < minYear) {
      out.push(`plan_year must be at least ${minYear} on ${d.toISOString().slice(0, 10)} (counts are re-confirmed every October 1 for the next plan year)`);
    }
  }
  return out;
}

/** The area's counts: the county's own entry, else the state's statewide entry only when uniform_statewide; else null. */
function countsFor(data, state, county) {
  const a = data && data.areas && data.areas[state];
  if (!isObj(a)) return null;
  const own = county && isObj(a.counties) ? a.counties[county] : null;
  if (own && !areaProblem(own)) return own;
  if (a.uniform_statewide === true && a.statewide && !areaProblem(a.statewide)) return a.statewide;
  return null;
}

/** The standardized statement with the counts. Throws when the counts are missing or unusable. */
function statementText(data, counts) {
  const p = areaProblem(counts);
  if (p) throw new Error(`TPMO statement needs valid counts: ${p}`);
  return data && data.variant === 'all' ? ALL(counts.organizations, counts.products) : NOT_ALL(counts.organizations, counts.products);
}

/** True when this record may put the statement on a page at all. */
function mayRender(data) {
  return isObj(data) && data.status === 'active' && (data.branch === 'A' || data.branch === 'mixed') && VARIANTS.includes(data.variant);
}

const BLOCK_STYLE = 'font-size:15px;line-height:1.6;color:#1e293b;background:#f8fafc;border:1px solid #cbd5e1;border-left:4px solid #173358;border-radius:8px;padding:12px 16px;';

/**
 * One statement block for one area, or '' (status not active, branch not A or
 * mixed, or no counts for the area). "Medicare.gov" links to Medicare.gov;
 * 1-800-MEDICARE stays plain text. The id is printed only when the caller
 * passes one, so no page carries two id="tpmo-disclaimer".
 */
function renderTpmoBlock(data, { state, county, label, id, compact = false } = {}) {
  if (!mayRender(data)) return '';
  const counts = countsFor(data, state, county);
  if (!counts) return '';
  const statement = esc(statementText(data, counts)).replace('Medicare.gov', '<a href="https://www.medicare.gov/" rel="noopener" style="color:inherit;text-decoration:underline;">Medicare.gov</a>');
  const style = BLOCK_STYLE + (compact ? 'margin:0 0 12px;' : 'margin:16px 0;');
  return `<aside${id ? ` id="${esc(id)}"` : ''} class="tpmo-disclaimer" role="note" aria-label="Medicare plan disclaimer" style="${style}">`
    + `<p style="margin:0 0 6px;">${label ? `<strong>${esc(label)}</strong> ` : ''}${statement}</p>`
    + `<p style="margin:0;">${esc(MEDICARE_HOURS)}</p></aside>`;
}

/** The areas a page that serves several areas shows: the two priority counties, then each uniform state. */
function defaultAreas(data) {
  const out = PRIORITY_COUNTIES.map(([state, county]) => ({ state, county, label: `${STATE_NAMES[state]}, ${county}:` }));
  for (const [state, a] of Object.entries((data && data.areas) || {})) {
    if (isObj(a) && a.uniform_statewide === true) out.push({ state, county: null, label: `${STATE_NAMES[state] || state}:` });
  }
  return out;
}

/** One block per area that has counts, in order; the first rendered block carries id="tpmo-disclaimer" unless withId is false. */
function renderTpmoForAreas(data, areas = defaultAreas(data), { compact = false, withId = true } = {}) {
  if (!mayRender(data)) return '';
  const blocks = [];
  for (const area of areas || []) {
    const html = renderTpmoBlock(data, { ...area, compact, id: withId && blocks.length === 0 ? 'tpmo-disclaimer' : undefined });
    if (html) blocks.push(html);
  }
  return blocks.join('\n');
}

/** True for a post about Medicare: a tag with the word "medicare", a slug containing it, or related_page /health/medicare. */
function isMedicarePost(meta) {
  if (!meta || typeof meta !== 'object') return false;
  const tags = Array.isArray(meta.tags) ? meta.tags : String(meta.tags || '').replace(/[[\]]/g, '').split(',');
  if (tags.some((t) => /\bmedicare\b/i.test(String(t)))) return true;
  if (/medicare/i.test(String(meta.slug || ''))) return true;
  return /^\/health\/medicare(?:\.html)?$/.test(String(meta.related_page || '').trim());
}

/** "A", "A or B", "A, B or C". */
function joinEntities(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * The Medicare/health form disclosure: the only implementation, shown beside
 * every Medicare and health submit (product-page inline forms with
 * form: 'inline', the intake for every context).
 *   context 'medicare'    Medicare page, ?product=medicare, Medicare tile selected
 *           'health'      another health product
 *           'health_line' ?line=health (which offers the Medicare tiles too)
 * With lead_disclosure.contact_entities empty (Phase 1, true in every branch)
 * the contact is "a licensed insurance agent"; Branch A names The Way Agency,
 * Branch B both entities. "Medicare plans" becomes medicare_products_label.
 * With tcpa: true the TCPA sentence follows.
 */
function leadDisclosureText(data, { context = 'health', form } = {}) {
  if (!LEAD_CONTEXTS.includes(context)) throw new Error(`leadDisclosureText: unknown context ${JSON.stringify(context)}`);
  const ld = isObj(data) && isObj(data.lead_disclosure) ? data.lead_disclosure : {};
  const entities = Array.isArray(ld.contact_entities) ? ld.contact_entities.map((e) => String(e).trim()).filter(Boolean) : [];
  const agent = entities.length ? `${DEFAULT_AGENT} with ${joinEntities(entities)}` : DEFAULT_AGENT;
  const medicareLabel = typeof ld.medicare_products_label === 'string' && ld.medicare_products_label.trim() ? ld.medicare_products_label.trim() : DEFAULT_MEDICARE_LABEL;
  const topic = context === 'medicare' ? medicareLabel : context === 'health' ? 'health insurance' : 'Medicare or other health insurance';
  const lead = form === 'inline'
    ? `This form starts a quote request. Your information will be provided to ${agent}, who will contact you by phone, text or email about ${topic}.`
    : `By continuing, you agree that the information you give us will be provided to ${agent}, who will contact you by phone, text or email about ${topic}.`;
  return `${lead} ${SOLICITATION}${ld.tcpa === true ? ` ${TCPA_SENTENCE}` : ''}`;
}

/** The record without its internal fields (signed_record, _doc, branch), for the intake page. */
function publicTpmoData(data) {
  if (!isObj(data)) return null;
  const copy = JSON.parse(JSON.stringify(data));
  delete copy.signed_record;
  delete copy._doc;
  // The intake reads only lead_disclosure (and, from Phase 2, display/areas);
  // the branch is internal (the owner does not advertise the partnership).
  delete copy.branch;
  return copy;
}

module.exports = {
  NOT_ALL,
  ALL,
  MEDICARE_HOURS,
  RETIRED_FRAGMENT,
  TCPA_SENTENCE,
  STATUSES,
  BRANCHES,
  VARIANTS,
  STATE_NAMES,
  LEAD_CONTEXTS,
  tpmoProblems,
  countsFor,
  statementText,
  renderTpmoBlock,
  defaultAreas,
  renderTpmoForAreas,
  isMedicarePost,
  leadDisclosureText,
  publicTpmoData,
};
