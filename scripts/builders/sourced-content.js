/**
 * Sourced content blocks (CONT-04, CONT-05, MKT-02).
 *
 * Every block here renders reviewed data with its primary source linked:
 *  - industry pages: Kentucky requirements (statute-linked), coverage notes,
 *    contracts, a labelled fictional example and visible FAQs (no FAQPage markup);
 *  - standalone carrier pages: facts taken from the carrier's own site, each with
 *    its source and as-of date; a rating only when it carries both (TRUST-05);
 *  - priority-hub line sections (data/hub-sections.json): rendered only after a
 *    named licensed reviewer's sign-off is recorded on the section, like the
 *    Kentucky product blocks.
 *
 * Plain strings are escaped. Fields named *html are reviewed HTML from data/,
 * like the other rich-content fields the page builders print.
 */

const { canonicalHref } = require('../lib/site-urls');

function esc(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-03" -> "October 3, 2026"; anything else -> ''. */
function longDate(iso) {
  const m = ISO_DATE.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : '';
}

/** Only https links are printed; anything else drops the link, never the text. */
function safeUrl(url) {
  return /^https:\/\/[^\s"<>]+$/.test(String(url || '')) ? String(url) : '';
}

function citeLinks(cites) {
  return (Array.isArray(cites) ? cites : [])
    .map((c) => (safeUrl(c && c.url) ? `<a href="${esc(c.url)}">${esc(c.label)}</a>` : esc(c && c.label)))
    .filter(Boolean)
    .join(', ');
}

const listStyle = 'list-style:disc;padding-left:var(--space-xl);margin-bottom:var(--space-lg);';

// ─── Industry pages (CONT-04, content-accuracy WP-G) ───────────────

function renderIndustryRequirements(ind) {
  const reqs = Array.isArray(ind.ky_requirements) ? ind.ky_requirements.filter((r) => r && r.text && Array.isArray(r.cites) && r.cites.length) : [];
  if (!reqs.length) return '';
  const checked = reqs.map((r) => r.as_of).filter((d) => ISO_DATE.test(String(d || ''))).sort()[0];
  return `
        <h2 id="kentucky-requirements">Kentucky requirements for ${esc(ind.name.toLowerCase())}</h2>
        <ul class="ky-requirements" style="${listStyle}">
${reqs.map((r) => `          <li>${esc(String(r.text).replace(/\.\s*$/, ''))} (${citeLinks(r.cites)}).</li>`).join('\n')}
        </ul>
        <p style="color:var(--slate);font-size:var(--text-sm);">${checked ? `Statute text checked ${longDate(checked)}. ` : ''}Indiana and Tennessee rules differ; ask us.</p>`;
}

function renderIndustryDetail(ind) {
  const name = esc(ind.name.toLowerCase());
  const notes = Array.isArray(ind.coverage_notes) ? ind.coverage_notes.filter((n) => n && n.coverage && n.html) : [];
  const coverage = notes.length
    ? `
        <h2 id="coverage">Coverage ${name} typically carry</h2>
        <ul style="${listStyle}">
${notes.map((n) => `          <li><strong>${esc(n.coverage)}.</strong> ${n.html}</li>`).join('\n')}
        </ul>`
    : `
        <h2 id="coverage">Coverage ${name} typically carry</h2>
        <ul style="${listStyle}">
${(ind.typical_coverage || []).map((c) => `          <li>${esc(c)}</li>`).join('\n')}
        </ul>`;
  const contracts = ind.contracts_html ? `
        <h2 id="contracts">Contracts and certificates</h2>
        <p>${ind.contracts_html}</p>` : '';
  const scenario = ind.scenario ? `
        <h2 id="example">Example claim</h2>
        <p><em>Fictional example for illustration.</em> ${esc(ind.scenario)}</p>` : '';
  return `${coverage}${contracts}${scenario}`;
}

// Visible questions and answers only. No FAQPage markup (FAQ rich results are
// retired for this kind of site; markup aimed at them is out of scope).
function renderIndustryFaqs(ind) {
  const faqs = Array.isArray(ind.faqs) ? ind.faqs.filter((f) => f && f.question && f.answer_html) : [];
  if (!faqs.length) return '';
  return `
        <h2 id="questions">Questions ${esc(ind.name.toLowerCase())} ask</h2>
${faqs.map((f) => `        <h3 style="font-size:var(--text-lg);margin-top:var(--space-lg);">${esc(f.question)}</h3>
        <p>${f.answer_html}</p>`).join('\n')}`;
}

// ─── Carrier pages (CONT-05, content-accuracy WP-H) ────────────────

/** A rating prints only with a grade, an as-of date and an https source. */
function ratingLine(am) {
  if (!am || !am.rating || !ISO_DATE.test(String(am.as_of || '')) || !safeUrl(am.source_url)) return '';
  const desc = am.descriptor ? ` (${esc(am.descriptor)})` : '';
  return `AM Best financial strength rating: ${esc(am.rating)}${desc}, as of ${longDate(am.as_of)}, as published by the carrier (<a href="${esc(am.source_url)}">source</a>).`;
}

function sourcedFacts(profile) {
  return (Array.isArray(profile && profile.facts) ? profile.facts : [])
    .filter((f) => f && f.text && safeUrl(f.source_url) && ISO_DATE.test(String(f.as_of || '')));
}

function renderCarrierProfile(carrier, profile) {
  if (!profile) return '';
  const facts = sourcedFacts(profile);
  const rating = ratingLine(profile.am_best);
  const name = esc(carrier.name);
  const links = (Array.isArray(profile.links) ? profile.links : [])
    .filter((l) => l && l.label && safeUrl(l.url))
    .map((l) => `          <li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`)
    .join('\n');
  // Our product links next to a named carrier read as a placement claim, so they
  // print only once the owner has verified the appointment (OA-25; review M1).
  const productLinks = (carrier.appointment_verified_on && Array.isArray(profile.product_links) ? profile.product_links : [])
    .filter((p) => p && p.url && p.name)
    .map((p) => `<a href="${esc(canonicalHref(p.url))}">${esc(p.name)}</a>`);
  const checked = facts.map((f) => f.as_of).sort()[0];
  return `
        <h2 id="about">About ${name}</h2>
        <ul style="${listStyle}">
${facts.map((f) => `          <li>${esc(f.text)} (<a href="${esc(f.source_url)}">${esc(f.source_label || 'source')}</a>)</li>`).join('\n')}
${rating ? `          <li>${rating}</li>` : ''}
        </ul>${checked ? `
        <p style="color:var(--slate);font-size:var(--text-sm);">Read on ${name}'s own site on ${longDate(checked)}.</p>` : ''}${productLinks.length ? `
        <p>Related coverage on our site: ${productLinks.join(', ')}.</p>` : ''}${links ? `
        <h2 id="claims">Claims and policy service</h2>
        <p>We're an independent agency, not ${name}. For policy service or claims, use its official pages:</p>
        <ul style="${listStyle}">
${links}
        </ul>` : ''}`;
}

// ─── Priority-hub line sections (MKT-02, priority-hubs R3-1) ───────

/**
 * A section renders only when its sign-off names a reviewer, the license line
 * they hold and an ISO date (owner D9; content-accuracy D1 rotation).
 */
function isSigned(section) {
  const s = section && section.signoff;
  if (!(s && s.reviewer && s.license_line && ISO_DATE.test(String(s.date || '')))) return false;
  return gatesCleared(section);
}

/**
 * Extra owner gates on a section (e.g. the life sections wait on TRUST-01 and
 * on OA-25 confirming a life appointment; review M4). Each named gate needs the
 * ISO date it cleared; a section without `gates` has none.
 */
function gatesCleared(section) {
  const g = section && section.gates;
  if (g === undefined || g === null) return true;
  if (typeof g !== 'object' || Array.isArray(g)) return false;
  return Object.values(g).every((d) => ISO_DATE.test(String(d || '')));
}

/** A recorded sign-off is either absent (null) or complete. */
function signoffIsWellFormed(signoff) {
  if (signoff === null || signoff === undefined) return true;
  return Boolean(signoff && typeof signoff.reviewer === 'string' && signoff.reviewer.trim()
    && typeof signoff.license_line === 'string' && signoff.license_line.trim()
    && ISO_DATE.test(String(signoff.date || '')));
}

function sectionId(slug) {
  return String(slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function renderHubSection(section) {
  const sources = (Array.isArray(section.sources) ? section.sources : [])
    .filter((s) => s && s.label && safeUrl(s.url))
    .map((s) => `<a href="${esc(s.url)}">${esc(s.label)}</a>${ISO_DATE.test(String(s.accessed || '')) ? ` (accessed ${longDate(s.accessed)})` : ''}`);
  return `        <h3 id="${sectionId(section.slug)}">${esc(section.heading)}</h3>
${(Array.isArray(section.paragraphs_html) ? section.paragraphs_html : []).map((p) => `        <p>${p}</p>`).join('\n')}${sources.length ? `
        <p style="color:var(--slate);font-size:var(--text-sm);">Sources: ${sources.join('; ')}.</p>` : ''}`;
}

/**
 * Merge signed sections into a hub's existing context_sections. A signed section
 * with `replaces` takes the place of the existing section with that heading; the
 * rest follow the last replaced section (or the end). Unsigned sections render
 * nothing and the existing copy stays as it is.
 * Returns [{ html }] in page order.
 */
function hubSectionBlocks(existing, drafts, renderExisting) {
  const signed = (Array.isArray(drafts) ? drafts : []).filter(isSigned);
  const byReplaces = new Map(signed.filter((s) => s.replaces).map((s) => [s.replaces, s]));
  const extra = signed.filter((s) => !s.replaces || !(existing || []).some((e) => e.heading === s.replaces));
  const out = [];
  let lastReplaced = -1;
  (existing || []).forEach((e) => {
    const draft = byReplaces.get(e.heading);
    out.push(draft ? renderHubSection(draft) : renderExisting(e));
    if (draft) lastReplaced = out.length - 1;
  });
  const at = lastReplaced >= 0 ? lastReplaced + 1 : out.length;
  out.splice(at, 0, ...extra.map(renderHubSection));
  return out;
}

module.exports = {
  longDate,
  renderIndustryRequirements,
  renderIndustryDetail,
  renderIndustryFaqs,
  renderCarrierProfile,
  ratingLine,
  isSigned,
  gatesCleared,
  signoffIsWellFormed,
  hubSectionBlocks,
  renderHubSection,
};
