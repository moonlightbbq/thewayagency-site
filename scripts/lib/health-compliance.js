#!/usr/bin/env node
/**
 * Medicare and health compliance guard (TRUST-01, TRUST-04, TRUST-07, BLOG-02;
 * specs/medicare-health-compliance.md 3.17). scripts/check-health-compliance.js is its
 * command-line entry; scripts/build.js runs it as step 11c and fails the build on any problem; check-data-integrity.js runs
 * scanText() over data/content-*.json and data/knowledge-base.json, so copy
 * that no page renders today is covered too.
 *
 * Each page is read three ways: its visible text (scripts and styles dropped,
 * tags stripped, entities decoded; block boundaries kept as line breaks so a
 * rule cannot match across two paragraphs), every string inside its JSON-LD,
 * and its title/description meta. build/llms.txt and build/llms-full.txt are
 * read as plain text (llms-full.txt repeats the hub paragraphs).
 *
 * Dependency-free on purpose: CI's safe-build job builds on Node 18 without
 * `npm ci`.
 *
 * Rules (P-numbers as in the spec):
 *   P-1   "$185 ... 2026" (the 2025 Part B premium labelled 2026)          any page
 *   P-2   $1,632 or $257 (the 2025 Part A/B deductibles)                    pages that mention Medicare
 *   P-3   a $2,000 Part D out-of-pocket cap (the 2025 value)                pages that mention Part D
 *   P-4   2024 poverty-guideline figures and the stale family OOP cap      any page
 *   P-5   2025 HSA/HDHP figures                                             any page
 *   P-6   Preferred Risk Policies (replaced by Risk Rating 2.0)             any page
 *   P-7   "enhanced subsidies" (expired end of 2025)                        any page; allowlist needs an enacted-law citation
 *   P-8   "all available plans"                                             any page
 *   P-9   kynect described as Medicare counseling                           any page
 *   P-10  guaranty association / guaranty fund (KRS 304.42-190)             any page; allowlist needs counsel's name
 *   P-11  "typically 3-5%", "cannot lose money", "similar to a CD"          any page
 *   P-11b an undated "typically N-M%" range next to a rate word
 *         (guaranteed, interest, cash value, loan, cap, crediting,
 *         dividend, annuity) in the same sentence                         any page; allowlist needs a named, dated source
 *   P-12  agency Medicare Advantage / Part D comparison claims, judged by the TPMO record:
 *         active A/mixed: the page must carry "Currently we represent"; active A1/C or
 *         not_applicable: fails; active B: fails unless the sentence names the partner;
 *         pending_owner: warning
 *   P-13  1-800-MEDICARE or the SHIP hotline as a tel: link                any page
 *   P-14  1-800-MEDICARE without "24 hours a day, 7 days a week"           any page
 *   P-15  the retired SHIP wording of the pre-2027 TPMO statement          any page
 *   P-16  a placeholder inside a .tpmo-disclaimer block                    any page
 *   P-17  tpmoProblems() while the TPMO record is active                   the record
 *   P-18  an undated "January 15" (no year after it)                       build/health/*.html
 *   P-19  "never sell your data" (warning in Phase 1; Phase 3 makes it an error)
 *   P-20  a {{fact:...}} token left unresolved                             any page
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { tpmoProblems, RETIRED_FRAGMENT } = require('./medicare-disclaimer');

// Exceptions, each with its reason. None today. A P-7 entry needs the citation
// of an enacted law; a P-10 entry needs counsel's name (`counsel`), recorded in
// the PR; a P-11b entry needs the named, dated source. Shape:
//   { rule: 'P-10', file: 'life/annuities.html', text: '<exact phrase>', reason: '...', counsel: '...' }
const ALLOWLIST = Object.freeze([]);

const RATE_RANGE_RE = /typically [0-9]+ ?(?:-|to) ?[0-9]+ ?(?:%|percent)/i;
const RATE_WORD_RE = /\b(?:guarantee[ds]?|guaranteed|interest|cash value|loans?|caps?|crediting|dividends?|annuit(?:y|ies))\b/i;

// Text rules: [id, regex, scope]. scope(pageText) decides whether a page is in scope.
const any = () => true;
const TEXT_RULES = [
  ['P-1', /\$185(?:\.00)?\b[^.\n]{0,40}\b2026\b/, any, 'the 2025 Part B premium ($185) labelled 2026'],
  ['P-2', /\$1,632\b|\$257\b/, (t) => /Medicare/.test(t), 'a 2025 Medicare deductible ($1,632 Part A, $257 Part B)'],
  ['P-3', /out-of-pocket[^.\n]{0,80}\$2,000\b|\$2,000\b[^.\n]{0,40}(?:out-of-pocket|Part D)/i, (t) => /Part D/.test(t), 'the 2025 Part D out-of-pocket cap ($2,000)'],
  ['P-4', /\$(?:20,783|28,208|35,632|60,240|18,900)\b/, any, 'a 2024 poverty-guideline figure or the stale family out-of-pocket cap'],
  ['P-5', /\$4,300 individual|\$1,650 for self-only|\$8,550 family/, any, 'a 2025 HSA/HDHP figure'],
  ['P-6', /Preferred Risk Polic/i, any, 'Preferred Risk Policies (FEMA replaced their pricing with Risk Rating 2.0)'],
  ['P-7', /enhanced subsidies/i, any, '"enhanced subsidies" (the enhanced premium tax credits expired at the end of 2025)'],
  ['P-8', /all available plans/i, any, '"all available plans"'],
  ['P-9', /kynect[^.\n]{0,80}(?:Medicare beneficiaries|compare Medicare)/i, any, 'kynect described as Medicare counseling (SHIP is run by CHFS DAIL)'],
  ['P-10', /guarant(?:y|ee)\s+(?:association|fund)/i, any, 'the guaranty association used in sales copy (KRS 304.42-190)'],
  ['P-11', /typically 3-5%|cannot lose money|similar to a CD/i, any, 'annuity rate/"cannot lose"/CD wording'],
  ['P-15', new RegExp(RETIRED_FRAGMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), any, 'the retired SHIP clause of the TPMO statement'],
  ['P-20', /\{\{\s*fact\s*:[^}]*\}\}/, any, 'a {{fact:...}} token left unresolved'],
];

// Agency Medicare Advantage / Part D comparison claims (P-12).
const CLAIM_RES = [
  /\b(?:we|us)\b[^.\n]{0,80}\bcompare\b[^.\n]{0,60}\b(?:Medicare Advantage|Part D)\b/i,
  /\b(?:Medicare Advantage|Part D)\b[^.\n]{0,80}\bside by side\b/i,
  /\b(?:our|The Way Agency)\b[^.\n]{0,80}\bcompar(?:e|es|ing)\b[^.\n]{0,60}\b(?:Medicare Advantage|Advantage plans?|Part D)\b/i,
];

const BLOCK_TAGS = 'p|h[1-6]|li|ul|ol|dl|dt|dd|div|section|article|aside|header|footer|nav|main|table|thead|tbody|tr|td|th|br|hr|blockquote|figure|figcaption|form|fieldset|legend|button|label|option|select|details|summary|title';
const BLOCK_RE = new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi');

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return m; } })
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The text a reader sees, one block per line. */
function visibleText(html) {
  return decodeEntities(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
    .replace(BLOCK_RE, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

/** Every string value inside the page's JSON-LD blocks (the raw block when it does not parse). */
function jsonLdStrings(html) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const m of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { out.push(m[1]); }
  }
  return out;
}

/** Title and description meta values (what a search result shows). */
function metaStrings(html) {
  const out = [];
  for (const m of String(html).matchAll(/<meta\b[^>]*(?:name|property)=["'](?:description|og:description|twitter:description|og:title|twitter:title)["'][^>]*>/gi)) {
    const c = /content=["']([^"']*)["']/i.exec(m[0]);
    if (c) out.push(decodeEntities(c[1]));
  }
  return out;
}

const sentences = (text) => String(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const excerpt = (text, m) => {
  const i = Math.max(0, m.index - 60);
  return text.slice(i, m.index + m[0].length + 60).replace(/\s+/g, ' ').trim();
};

function allowed(rule, file, text) {
  return ALLOWLIST.some((a) => a.rule === rule && a.file === file && text.includes(a.text) && a.reason
    && (rule !== 'P-10' || a.counsel) && (rule !== 'P-7' || a.citation) && (rule !== 'P-11b' || a.source));
}

/**
 * The text rules over a set of segments of one document.
 * @returns {{problems: string[], warnings: string[]}}
 */
function scanSegments(segments, { file = '', tpmo = null, pageText = null } = {}) {
  const problems = [];
  const warnings = [];
  const whole = pageText === null ? segments.join('\n') : pageText;
  for (const [id, re, scope, what] of TEXT_RULES) {
    if (!scope(whole)) continue;
    for (const seg of segments) {
      const m = re.exec(seg);
      if (m && !allowed(id, file, seg)) { problems.push(`${id} ${file}: ${what}: "${excerpt(seg, m)}"`); break; }
    }
  }
  // P-11b: an undated rate range next to a rate word, in one sentence.
  for (const seg of segments) {
    const hit = sentences(seg).find((s) => RATE_RANGE_RE.test(s) && RATE_WORD_RE.test(s) && !allowed('P-11b', file, s));
    if (hit) { problems.push(`P-11b ${file}: an undated rate range ("typically N-M%") with no named, dated source: "${hit.slice(0, 200)}"`); break; }
  }
  // P-12: agency MA/PDP comparison claims, judged by the TPMO record.
  const claims = [];
  for (const seg of segments) for (const s of sentences(seg)) if (CLAIM_RES.some((re) => re.test(s))) claims.push(s);
  if (claims.length) {
    const status = tpmo && tpmo.status;
    const branch = tpmo && tpmo.branch;
    const partner = tpmo && tpmo.lead_disclosure && tpmo.lead_disclosure.partner_consent && tpmo.lead_disclosure.partner_consent.entity;
    const first = `"${claims[0].slice(0, 200)}"`;
    if (status === 'active' && (branch === 'A' || branch === 'mixed')) {
      if (!/Currently we represent/.test(whole)) problems.push(`P-12 ${file}: Medicare Advantage/Part D comparison claim without the TPMO statement: ${first}`);
    } else if (status === 'not_applicable' || (status === 'active' && (branch === 'A1' || branch === 'C'))) {
      problems.push(`P-12 ${file}: Medicare Advantage/Part D comparison claim, but the agency does not sell for two or more organizations: ${first}`);
    } else if (status === 'active' && branch === 'B') {
      const bad = claims.find((s) => !(partner && s.includes(partner)));
      if (bad) problems.push(`P-12 ${file}: Medicare Advantage/Part D comparison claim that does not name the partner agency: "${bad.slice(0, 200)}"`);
    } else {
      warnings.push(`P-12 ${file}: Medicare Advantage/Part D comparison claim while the TPMO record is ${status || 'missing'}: ${first}`);
    }
  }
  return { problems, warnings };
}

/**
 * The text rules over one string from a data file (data/content-*.json,
 * data/knowledge-base.json): the copy-level rules, without the page-level
 * ones (tel: links, the hours sentence, placeholders, health-page dates) and
 * without P-20 (product copy carries {{fact:...}} tokens by design; the build
 * resolves them, and check-data-integrity.js checks that each one exists).
 */
function scanText(text, { file = '', tpmo = null } = {}) {
  const segs = [String(text === undefined || text === null ? '' : text)];
  const res = scanSegments(segs, { file, tpmo });
  res.problems = res.problems.filter((p) => !p.startsWith('P-20 '));
  return res;
}

function walkHtml(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkHtml(p, out);
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/**
 * Scan a built site.
 * @param {string} buildDir
 * @param {{tpmo?: object|null, today?: Date}} [opts]
 * @returns {{problems: string[], warnings: string[]}}
 */
function checkHealthCompliance(buildDir, { tpmo = null, today = new Date() } = {}) {
  const problems = [];
  const rawWarnings = [];
  if (tpmo && tpmo.status === 'active') {
    for (const p of tpmoProblems(tpmo, today)) problems.push(`P-17 data/medicare-tpmo.json: ${p}`);
  }
  const medicarePages = [];
  for (const abs of walkHtml(buildDir)) {
    const file = path.relative(buildDir, abs).split(path.sep).join('/');
    const html = fs.readFileSync(abs, 'utf8');
    const visible = visibleText(html);
    const segments = [visible, ...jsonLdStrings(html), ...metaStrings(html)];
    const whole = segments.join('\n');
    const res = scanSegments(segments, { file, tpmo, pageText: whole });
    problems.push(...res.problems);
    rawWarnings.push(...res.warnings);

    // P-13: 1-800-MEDICARE or the SHIP hotline as a tel: link.
    const tel = /href=["']tel:[^"']*(?:633-?4227|MEDICARE|293-?7447)/i.exec(html);
    if (tel) problems.push(`P-13 ${file}: a third-party Medicare number is a tel: link (${tel[0]}); show 1-800-MEDICARE and the SHIP hotline as plain text`);
    // P-14: the hours sentence wherever 1-800-MEDICARE appears.
    if (/1-800-MEDICARE/.test(whole) && !/24 hours a day, 7 days a week/.test(whole)) {
      problems.push(`P-14 ${file}: 1-800-MEDICARE without "24 hours a day, 7 days a week" (42 CFR 422.2262(c)(1)(iii))`);
    }
    // P-16: a placeholder inside a statement block.
    for (const m of html.matchAll(/<(aside|div)\b[^>]*class=["'][^"']*\btpmo-disclaimer\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)) {
      if (/\[(?:N|M|number|insert)[^\]]*\]|\binsert\b/i.test(visibleText(m[2]))) problems.push(`P-16 ${file}: a placeholder inside the TPMO statement`);
    }
    // P-18: an undated "January 15" on a health page.
    if (/^health\//.test(file)) {
      for (const seg of segments) {
        const m = /January 15\b(?!,?\s*20\d\d)/.exec(seg);
        if (m) { problems.push(`P-18 ${file}: "January 15" with no year: "${excerpt(seg, m)}"`); break; }
      }
    }
    // P-19: Phase 1 warning.
    if (/never sell your data/i.test(whole)) rawWarnings.push(`P-19 ${file}`);
    if (/Currently we represent/.test(whole)) medicarePages.push(file);
  }
  for (const name of ['llms.txt', 'llms-full.txt']) {
    const p = path.join(buildDir, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    const res = scanSegments(text.split(/\n{2,}/), { file: name, tpmo, pageText: text });
    problems.push(...res.problems);
    rawWarnings.push(...res.warnings);
  }

  // Warnings, one line per rule.
  const warnings = [];
  const p19 = rawWarnings.filter((w) => w.startsWith('P-19 '));
  if (p19.length) warnings.push(`P-19 "never sell your data" on ${p19.length} page(s) (an error once the Phase 3 privacy copy ships), e.g. ${p19.slice(0, 3).map((w) => w.slice(5)).join(', ')}`);
  warnings.push(...rawWarnings.filter((w) => !w.startsWith('P-19 ')));
  if (!tpmo || tpmo.status === 'pending_owner') {
    warnings.push('TPMO statement not rendered: owner inputs D-1/D-2 (and D-3/D-4 for Branch B) missing; data/medicare-tpmo.json is pending_owner');
  } else if (tpmo.status === 'active' && (tpmo.branch === 'A' || tpmo.branch === 'mixed')) {
    const expected = ['health/medicare.html', 'blog/medicare-enrollment-guide.html'];
    const missing = expected.filter((f) => !medicarePages.includes(f));
    if (missing.length) warnings.push(`TPMO statement is active but missing on: ${missing.join(', ')}`);
  }
  return { problems, warnings };
}

module.exports = { checkHealthCompliance, scanText, visibleText, jsonLdStrings, metaStrings, TEXT_RULES, CLAIM_RES, ALLOWLIST };

