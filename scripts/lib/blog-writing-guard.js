'use strict';
/**
 * Blog writing rules (Y-84 (A); owner 11/14: "Don't use em dashes anywhere in new
 * copy", and the blog audit's AI-writing tells; Y0 rulings 11/14).
 *
 * The ONE source of the rules. The site applies them where a draft moves forward
 * (never in the production build, which must not fail on an unpublished draft):
 *   - scripts/send-review-emails.js sends no review request for a post that
 *     breaks one; the post stays planned and its content owner is alerted;
 *   - scripts/publish-scheduled-posts.js puts a due post that breaks one in
 *     'error' (the workflow goes red), so it never renders;
 *   - scripts/check-blog-writing.js (the PR check, tests too): every unpublished
 *     post passes; a live post may only improve against
 *     data/blog-writing-baseline.json, and a stale baseline entry fails.
 * SAGE's blog writer reads the same RULES through its site-lib loader (Y-84 (D)).
 *
 * Exports: RULES [{ id, description, test(md) -> problems }] and
 * writingProblems(md) -> [{ rule, line, text }], line 1-based in the file.
 *
 * Exceptions: false positives are handled by the patterns here, each with a
 * test. There is no per-line ignore marker. A post that truly needs one is a
 * named entry with a reason in data/blog-writing-exceptions.json.
 */

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;

/** The file split into the lines the rules read: title, description, and the body. */
function _lines(md) {
  const s = String(md === undefined || md === null ? '' : md).replace(/\r\n/g, '\n');
  const all = s.split('\n');
  const fm = FRONT_MATTER.exec(s);
  const out = [];
  let bodyStart = 0;
  if (fm) {
    const fmLines = fm[0].split('\n').length - 1;
    for (let i = 1; i < fmLines - 1; i++) {
      const m = /^(title|description):\s*(.*)$/.exec(all[i]);
      if (m) out.push({ line: i + 1, text: m[2].replace(/^["']|["']$/g, ''), where: m[1] });
    }
    bodyStart = fmLines;
  }
  for (let i = bodyStart; i < all.length; i++) out.push({ line: i + 1, text: all[i], where: 'body' });
  return out;
}

const _snip = (t) => (t.length > 120 ? `${t.slice(0, 117)}...` : t).trim();

// ─── (a) dashes ──────────────────────────────────────────────────────────────
// An em dash never. An en dash only directly between two numbers or two clock
// times (a range: "5–25", "9:00 AM – 5:00 PM", "9 a.m.–5 p.m.").
const EM = /—|&mdash;|&#8212;|&#x2014;/gi;
const EN = /–|&ndash;|&#8211;|&#x2013;/gi;
function _enDashIsRange(text, at, len) {
  const left = text.slice(0, at).replace(/\s+$/, '');
  const right = text.slice(at + len).replace(/^\s+/, '');
  return /(?:\d|\b[AaPp]\.?[Mm]\.?)$/.test(left) && /^\$?\d/.test(right);
}
function dashProblems(md) {
  const out = [];
  for (const l of _lines(md)) {
    if (EM.test(l.text)) out.push({ rule: 'dash', line: l.line, text: `em dash: ${_snip(l.text)}` });
    EM.lastIndex = 0;
    let m;
    EN.lastIndex = 0;
    while ((m = EN.exec(l.text))) {
      if (!_enDashIsRange(l.text, m.index, m[0].length)) { out.push({ rule: 'dash', line: l.line, text: `en dash outside a number range: ${_snip(l.text)}` }); break; }
    }
  }
  return out;
}

// ─── (b) stock lines ─────────────────────────────────────────────────────────
const STOCK = Object.freeze([
  ['"not just" contrast', /\bnot just\b|\bisn['’]t just\b|\bmore than just\b/i],
  ['announcer line', /\bhere(?:['’]s| is) what you need to know\b|\bhere(?:['’]s| is) the thing\b|\blet['’]s dive\b|\bwithout further ado\b|\blook no further\b|\brest assured\b/i],
  ['"Period." as a sentence', /(?:^|[.!?]["”']?\s+)Period\.(?=\s|$)/],
  ['"top-rated carriers"', /\btop[- ]rated carriers?\b/i],
  ['stock phrase', /\bin conclusion\b|\bin today['’]s world\b|\bit['’]s important to note\b|\bnavigating the landscape\b|\bheartfelt\b/i],
]);
function stockProblems(md) {
  const out = [];
  for (const l of _lines(md)) {
    for (const [name, re] of STOCK) if (re.test(l.text)) out.push({ rule: 'stock', line: l.line, text: `${name}: ${_snip(l.text)}` });
  }
  return out;
}

// ─── (c) every statistic names a source ──────────────────────────────────────
// A statistic is a percentage or an "N in M" figure. Dollar amounts are not
// (deductible and limit examples are everywhere). A percentage that is a policy
// term (a deductible, or a share of a coverage limit or value) is not a
// statistic either.
// "N in M" is a ratio ("1 in 8 drivers"), never a year ("turning 65 in 2027").
const STAT = /\b\d+(?:\.\d+)?\s?(?:%|percent\b)|\b\d{1,3} (?:in|out of) (?:every )?(?!(?:19|20)\d\d\b)\d{1,4}\b/gi;
const POLICY_PERCENT = /^\d+(?:\.\d+)?\s?(?:%|percent)(?:\s*(?:or|to|-|–)\s*\d+(?:\.\d+)?\s?(?:%|percent))?\s+(?:(?:wind(?:\/hail)?|hurricane|named[- ]storm|earthquake|percentage)\s+)?(?:deductible\b|of\s+(?:your|the|its|their|a)?\s*(?:[\w-]+['’]s\s+)?(?:insured\s+|dwelling\s+|personal\s+property\s+|policy\s+|coverage\s+|replacement\s+|actual\s+cash\s+|appraised\s+|total\s+)?(?:dwelling\s+coverage|coverage(?:\s+a)?|limit|limits|value|replacement\s+cost|policy\s+limit|personal\s+property\s+limit|dwelling\s+limit)\b)/i;
const DEDUCTIBLE_BEFORE = /\bdeductibles?\s+(?:of|is|are|at|set at|equal to)\s+$/i;
// "a percentage of your dwelling coverage, typically 20 to 30 percent": the figure is that share.
const PERCENTAGE_OF_BEFORE = /\bpercentage of (?:your|the|its|their|a)\s+(?:[\w'\u2019-]+\s+){0,3}?(?:coverage|limit|limits|value)\b/i;
// A coinsurance clause is stated as a percentage of value: a policy term.
const COINSURANCE = /\bcoinsurance\b/i;
// A benefit stated as a share of pay ("pays ... 50 to 70 percent of your pre-disability income").
const BENEFIT_SHARE = /^\d+(?:\.\d+)?\s?(?:%|percent)\s+of\s+(?:your|the|their)\s+(?:pre-disability\s+|gross\s+|monthly\s+|annual\s+)?(?:income|salary|earnings|pay)\b/i;
const BENEFIT_WORD = /\b(?:benefits?|pays?|replaces?)\b/i;
// A worked calculation ("$60,000/year x 15 years = $900,000 (adjusted to $720,000 at 80%)").
// A tax bracket or rate is a law term ("the 22 percent federal tax bracket").
const TAX_RATE = /^\d+(?:\.\d+)?\s?(?:%|percent)\s+(?:federal\s+|state\s+|marginal\s+|flat\s+)?(?:income\s+)?tax\s+(?:bracket|rate)\b/i;
// An ownership threshold is a legal test ("an S-corp shareholder owning more than 2 percent").
const OWNERSHIP_BEFORE = /\bown(?:s|ing|ers?)?\s+(?:more than|at least|over|less than)\s+$/i;
const WORKED_SUM = /=\s*\$|\$[\d,]+(?:\/\w+)?\s*[x\u00d7]\s*\d/;
const SOURCE = /\]\((?:https?:)?\/\/|\baccording to\b|\bdata from\b|\bsources?\b|\bsurvey|\bstud(?:y|ies)\b|\breport(?:s|ed)?\b|\bcensus\b|\bNAIC\b|Insurance Information Institute|\bIII\b|\bFEMA\b|\bNOAA\b|\bNFIP\b|\bNHTSA\b|\bIIHS\b|\bBureau of\b|\bDepartment of\b|\bBLS\b|\bCDC\b|J\.\s?D\.\s?Power|\bAM Best\b|\bLIMRA\b|\bNFDA\b|\bNFPA\b|\bSBA\b|\bIRS\b|Social Security Administration|Medicare\.gov|\bCMS\b|\bKFF\b/i;
function _statIsPolicyTerm(sentence, at) {
  const before = sentence.slice(0, at);
  const after = sentence.slice(at);
  return POLICY_PERCENT.test(after) || DEDUCTIBLE_BEFORE.test(before) || PERCENTAGE_OF_BEFORE.test(before)
    || TAX_RATE.test(after) || OWNERSHIP_BEFORE.test(before)
    || COINSURANCE.test(sentence) || WORKED_SUM.test(sentence) || (BENEFIT_SHARE.test(after) && BENEFIT_WORD.test(sentence));
}
function statisticProblems(md) {
  const out = [];
  for (const l of _lines(md)) {
    // A heading or a list item is its own sentence; prose is split at sentence ends.
    for (const sentence of l.text.split(/(?<=[.!?])\s+(?=[A-Z"“(*])/)) {
      STAT.lastIndex = 0;
      let m;
      let unsourced = false;
      while ((m = STAT.exec(sentence))) {
        if (_statIsPolicyTerm(sentence, m.index)) continue;
        if (!SOURCE.test(sentence)) unsourced = true;
      }
      if (unsourced) out.push({ rule: 'statistic', line: l.line, text: `statistic with no source: ${_snip(sentence)}` });
    }
  }
  return out;
}

// ─── (d) "(coming soon)" ─────────────────────────────────────────────────────
const COMING_SOON = /\(\s*coming soon\s*\)/i;
function comingSoonProblems(md) {
  return _lines(md).filter((l) => COMING_SOON.test(l.text)).map((l) => ({ rule: 'coming_soon', line: l.line, text: `"(coming soon)": ${_snip(l.text)}` }));
}

const RULES = Object.freeze([
  Object.freeze({ id: 'dash', description: 'No em dash anywhere (title, description, body). An en dash only directly between two numbers or two clock times, as a range (5–25, 9:00 AM – 5:00 PM).', test: dashProblems }),
  Object.freeze({ id: 'stock', description: 'None of these stock lines: a "not just" / "isn\'t just" / "more than just" contrast; announcer lines ("Here is what you need to know", "Here\'s the thing", "Let\'s dive", "Without further ado", "Look no further", "Rest assured"); "Period." as a sentence; "top-rated carriers"; "in conclusion", "in today\'s world", "it\'s important to note", "navigating the landscape", "heartfelt".', test: stockProblems }),
  Object.freeze({ id: 'statistic', description: 'Every statistic (a percentage, or an "N in M" figure) names its source in the same sentence: a link, "according to", or the body that published it (NAIC, III, FEMA, NOAA, a survey or study). Dollar amounts and policy-term percentages (a deductible, a share of a coverage limit or value) are not statistics.', test: statisticProblems }),
  Object.freeze({ id: 'coming_soon', description: 'No "(coming soon)" anywhere: a post never promises content that does not exist yet.', test: comingSoonProblems }),
]);

/** Every rule problem in a post's markdown: [{ rule, line, text }], in file order. */
function writingProblems(md) {
  const out = [];
  for (const r of RULES) out.push(...r.test(md));
  return out.sort((a, b) => a.line - b.line || RULES.findIndex((r) => r.id === a.rule) - RULES.findIndex((r) => r.id === b.rule));
}

/** { dash: n, stock: n, statistic: n, coming_soon: n } with only the rules that have problems. */
function problemCounts(md) {
  const counts = {};
  for (const p of writingProblems(md)) counts[p.rule] = (counts[p.rule] || 0) + 1;
  return counts;
}

/**
 * data/blog-writing-exceptions.json: { exceptions: [{ slug, rule, contains, reason }] }.
 * An entry waives one rule on the lines of one post that contain `contains`.
 * Every entry is visible in the PR diff and reviewed; a malformed one throws.
 */
function loadExceptions(file) {
  const fs = require('fs');
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, 'utf8')).exceptions;
  if (!Array.isArray(list)) throw new Error(`${file}: "exceptions" must be a list`);
  const ids = new Set(RULES.map((r) => r.id));
  for (const e of list) {
    if (!e || typeof e.slug !== 'string' || !ids.has(e.rule) || typeof e.contains !== 'string' || e.contains.length < 8 || typeof e.reason !== 'string' || e.reason.length < 20) {
      throw new Error(`${file}: an exception needs slug, a rule id (${[...ids].join(', ')}), contains (8+ characters) and a reason (20+ characters): ${JSON.stringify(e)}`);
    }
  }
  return list;
}

/** The post's problems after its named exceptions; `used` lists the entries that waived something. */
function postProblems(slug, md, exceptions = []) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const mine = exceptions.filter((e) => e.slug === slug);
  const used = new Set();
  const problems = writingProblems(md).filter((p) => {
    const e = mine.find((x) => x.rule === p.rule && (lines[p.line - 1] || '').includes(x.contains));
    if (e) used.add(e);
    return !e;
  });
  return { problems, used: [...used] };
}

module.exports = { RULES, writingProblems, problemCounts, loadExceptions, postProblems };
