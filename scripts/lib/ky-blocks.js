/**
 * Kentucky blocks, Kentucky product titles and line-hub intros (CONT-01, CONT-02;
 * priority-hubs spec R3-2 and R3-3, content roadmap B2).
 *
 * Everything here is data in data/ky-blocks.json and renders NOTHING until it is
 * signed:
 *   - the owner gate for its group is approved (owner_gates.<gate>.approved_by and
 *     .approved_on: D15 for product pages, CONT-02 for line hubs), AND
 *   - the entry itself carries a licensed reviewer (a data/team.json slug) and a
 *     reviewed_on date.
 * An unsigned entry is a draft. A Kentucky H1 renders only on a page that also
 * shows at least one signed Kentucky statement (R3-2: "Add 'in Kentucky' only where
 * the page has a Kentucky block").
 *
 * The reviewer's name is never printed (TRUST-06: no "Reviewed by" line until a
 * signed-credit mechanism exists); it stays in the data as the audit record.
 *
 * Pure and dependency-free (Node 18): CI's safe-build job runs without npm ci.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'ky-blocks.json');

// Primary sources a statement may cite: Kentucky statutes and regulations (LRC),
// Kentucky government program pages, and federal primary pages.
const SOURCE_HOSTS = [/^apps\.legislature\.ky\.gov$/, /^([a-z0-9-]+\.)*ky\.gov$/, /^www\.cms\.gov$/, /^www\.ecfr\.gov$/];
const BANNED = [
  { re: /—|&mdash;/, why: 'em dash' },
  { re: /\btop[- ]rated\b/i, why: '"top-rated" (TRUST-05)' },
  { re: /\bsince 1998\b/i, why: '"since 1998" (TRUST-02)' },
  { re: /\b40\+/, why: '"40+" (TRUST-05)' },
  { re: /\d\s*%|\bpercent\b/i, why: 'a percentage (CONT-01 titles; TRUST-10)' },
  { re: /\b(?:office|visit us|stop by|headquarters|based in)\b/i, why: 'storefront wording' },
  { re: /\bmedicare\b/i, why: 'Medicare copy (gated by TRUST-01; priority-hubs D16)' },
  { re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, why: 'emoji' },
];
const FREE_RE = /\bfree\b/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let cached = null;
function load(file = DATA_FILE) {
  if (file === DATA_FILE && cached) return cached;
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (file === DATA_FILE) cached = data;
  return data;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const signed = (e) => Boolean(e && e.reviewer && e.reviewed_on);
function gateOpen(data, gate) {
  const g = data && data.owner_gates && data.owner_gates[gate];
  return Boolean(g && g.approved_by && g.approved_on);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function sourcesOf(e) {
  return [{ cite: e.cite, url: e.source_url }, ...(Array.isArray(e.more_sources) ? e.more_sources : [])];
}
function citeLinks(e) {
  return sourcesOf(e).map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.cite)}</a>`).join('; ');
}

/** Signed statements for one product page path (e.g. "/personal/auto"). */
function signedStatements(data, page) {
  if (!gateOpen(data, 'product_blocks')) return [];
  return (data.statements || []).filter((s) => s.page === page && signed(s));
}

/**
 * Overrides for a product page: { html, title, h1 }. Each is '' / null when
 * nothing is signed, so the caller falls back to products.json.
 */
function forProduct(data, page) {
  const out = { html: '', title: null, h1: null };
  const rows = signedStatements(data, page);
  if (rows.length) {
    out.html = `
      <section class="ky-block" aria-labelledby="ky-block-h">
        <h2 id="ky-block-h">If you live in Kentucky</h2>
        <ul>
${rows.map((s) => `          <li>${esc(s.statement)} (${citeLinks(s)}; text as of ${esc(longDate(s.as_of))})</li>`).join('\n')}
        </ul>
        <p>These are Kentucky rules. If you live in Indiana or Tennessee, ask us about the rules in your state.</p>
      </section>`;
  }
  if (gateOpen(data, 'product_blocks')) {
    const t = (data.titles || []).find((x) => x.page === page && signed(x));
    if (t) {
      out.title = t.title || null;
      if (t.h1 && rows.length) out.h1 = t.h1;
    }
  }
  return out;
}

/**
 * Overrides for a line hub (canonical path such as "/personal/"):
 * { h1, subtitle, introHtml } or null when unsigned. Every intro sentence must be
 * signed for the intro to render (it reads as one paragraph).
 */
function forHub(data, canonical) {
  if (!gateOpen(data, 'line_hubs')) return null;
  const h = (data.hubs || []).find((x) => x.hub === canonical);
  if (!h || !signed(h)) return null;
  const sentences = Array.isArray(h.intro) ? h.intro : [];
  if (!sentences.length || !sentences.every(signed)) return null;
  const introHtml = sentences.map((s) => (s.source_url ? `${esc(s.text)} (${citeLinks(s)})` : esc(s.text))).join(' ');
  return { h1: h.h1, subtitle: h.subtitle || '', introHtml };
}

/**
 * Validates the file. `ctx`: { pages: Set of product page paths, hubs: Set of
 * hub canonicals, teamSlugs: Set, today: 'YYYY-MM-DD' }. Returns error strings.
 */
function validate(data, ctx) {
  const errors = [];
  const err = (m) => errors.push(m);
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const checkText = (where, text, { life = false } = {}) => {
    if (typeof text !== 'string' || !text.trim()) { err(`${where}: empty text`); return; }
    for (const b of BANNED) if (b.re.test(text)) err(`${where}: contains ${b.why}`);
    if (life && FREE_RE.test(text)) err(`${where}: "free" in life or health copy (KRS 304.15-712(3)(b))`);
  };
  const checkSignature = (where, e) => {
    if (e.reviewer === undefined || e.reviewed_on === undefined) err(`${where}: reviewer and reviewed_on must be present (null until signed)`);
    if (Boolean(e.reviewer) !== Boolean(e.reviewed_on)) err(`${where}: reviewer and reviewed_on are set together or not at all`);
    if (e.reviewer && !ctx.teamSlugs.has(e.reviewer)) err(`${where}: reviewer "${e.reviewer}" is not a data/team.json slug`);
    if (e.reviewed_on && (!DATE_RE.test(e.reviewed_on) || e.reviewed_on > today)) err(`${where}: reviewed_on "${e.reviewed_on}" is not a past YYYY-MM-DD date`);
  };
  const checkSource = (where, cite, url) => {
    if (!cite || typeof cite !== 'string') err(`${where}: missing cite`);
    let u = null;
    try { u = new URL(url); } catch { err(`${where}: source_url "${url}" is not a URL`); return; }
    if (u.protocol !== 'https:') err(`${where}: source_url must be https`);
    if (!SOURCE_HOSTS.some((re) => re.test(u.hostname))) err(`${where}: source_url host ${u.hostname} is not a primary-source host`);
  };
  const isLife = (page) => /^\/(?:life|health)\//.test(page);

  for (const [gate, g] of Object.entries(data.owner_gates || {})) {
    if (Boolean(g.approved_by) !== Boolean(g.approved_on)) err(`owner_gates.${gate}: approved_by and approved_on are set together or not at all`);
    if (g.approved_on && (!DATE_RE.test(g.approved_on) || g.approved_on > today)) err(`owner_gates.${gate}: approved_on is not a past YYYY-MM-DD date`);
  }

  const seenIds = new Set();
  for (const [i, s] of (data.statements || []).entries()) {
    const where = `statements[${i}] (${s.id || s.page})`;
    if (!s.id) err(`${where}: missing id`);
    else if (seenIds.has(s.id)) err(`${where}: duplicate id`);
    seenIds.add(s.id);
    if (!ctx.pages.has(s.page)) err(`${where}: page "${s.page}" is not a product page`);
    checkText(where, s.statement, { life: isLife(s.page) });
    for (const src of sourcesOf(s)) checkSource(where, src.cite, src.url);
    if (!DATE_RE.test(s.as_of || '') || s.as_of > today) err(`${where}: as_of must be a past YYYY-MM-DD date`);
    checkSignature(where, s);
  }

  const titles = new Set();
  for (const [i, t] of (data.titles || []).entries()) {
    const where = `titles[${i}] (${t.page})`;
    if (!ctx.pages.has(t.page)) err(`${where}: page "${t.page}" is not a product page`);
    checkText(where, t.title, { life: isLife(t.page) });
    if (typeof t.title === 'string') {
      if (t.title.length > 60) err(`${where}: title is ${t.title.length} chars (max 60)`);
      if (!/\bKentucky\b/.test(t.title)) err(`${where}: title must contain "Kentucky"`);
      if (titles.has(t.title)) err(`${where}: duplicate title`);
      titles.add(t.title);
    }
    if (t.h1 != null) {
      checkText(`${where} h1`, t.h1, { life: isLife(t.page) });
      if (!/\?$/.test(t.h1)) err(`${where}: h1 must be question-form`);
      if (!/\bKentucky\b/.test(t.h1)) err(`${where}: h1 must name Kentucky`);
      if (!(data.statements || []).some((s) => s.page === t.page)) err(`${where}: a Kentucky h1 needs a Kentucky statement on the page`);
    }
    checkSignature(where, t);
  }

  for (const [i, h] of (data.hubs || []).entries()) {
    const where = `hubs[${i}] (${h.hub})`;
    if (!ctx.hubs.has(h.hub)) err(`${where}: "${h.hub}" is not a line hub`);
    const life = h.hub === '/life/' || h.hub === '/health/';
    checkText(`${where} h1`, h.h1, { life });
    if (h.subtitle) checkText(`${where} subtitle`, h.subtitle, { life });
    checkSignature(where, h);
    const sentences = Array.isArray(h.intro) ? h.intro : [];
    if (!sentences.length) err(`${where}: intro has no sentences`);
    const words = sentences.map((s) => s.text || '').join(' ').split(/\s+/).filter(Boolean).length;
    if (words < 60 || words > 140) err(`${where}: intro is ${words} words (aim 80-120, allowed 60-140)`);
    for (const [j, s] of sentences.entries()) {
      const w = `${where} intro[${j}]`;
      checkText(w, s.text, { life });
      if (s.source_url) checkSource(w, s.cite, s.source_url);
      checkSignature(w, s);
    }
    // kynect is named for ACA plans and Medicaid only, never as a Medicare resource (R3-3).
    if (h.hub !== '/health/' && sentences.some((s) => /kynect/i.test(s.text || ''))) err(`${where}: kynect belongs on /health/ only`);
  }
  return errors;
}

module.exports = { DATA_FILE, load, forProduct, forHub, signedStatements, validate, gateOpen, signed };
