/**
 * Dated health facts (data/health-facts.json) and the {{fact:<id>}} tokens that
 * product copy uses to read them (TRUST-04; specs/medicare-health-compliance.md
 * 3.17 Phase 4, started here for the plan year 2027 Marketplace dates).
 *
 * A date or figure that changes on an outside schedule (a court ruling, a CMS
 * release) lives in one place. Pure functions, CommonJS, no dependencies
 * (CI builds on Node 18 without npm ci).
 */
'use strict';

const TOKEN_RE = /\{\{fact:([a-z0-9_]+)\}\}/g;
const ANY_TOKEN_RE = /\{\{\s*fact\s*:[^}]*\}\}/g;
const ID_RE = /^[a-z0-9_]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNSAFE_VALUE_RE = /[<>&"'{}]/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** id -> value for every usable fact. */
function factMap(data) {
  const map = new Map();
  for (const f of (isObj(data) && Array.isArray(data.facts) ? data.facts : [])) {
    if (isObj(f) && typeof f.id === 'string' && typeof f.value === 'string') map.set(f.id, f.value);
  }
  return map;
}

/**
 * A deep copy of `value` with every {{fact:<id>}} in its strings replaced by
 * that fact's value. A token naming no fact is left as it is: the build guard
 * (scripts/check-health-compliance.js) fails on it, so it never ships.
 */
function resolveFacts(value, data) {
  const map = data instanceof Map ? data : factMap(data);
  const walk = (v) => {
    if (typeof v === 'string') return v.replace(TOKEN_RE, (whole, id) => (map.has(id) ? map.get(id) : whole));
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value);
}

/** Every fact token in a text (resolved or not), as written. */
function factTokens(text) {
  return String(text === undefined || text === null ? '' : text).match(ANY_TOKEN_RE) || [];
}

/**
 * Problems (errors) and warnings for data/health-facts.json, plus a check that
 * every token used in the given texts names a fact.
 * @param {object} data       the parsed file
 * @param {{ today?: Date, usedIn?: Array<[string, string]> }} [opts]  usedIn: [where, text] pairs to check
 */
function factProblems(data, { today = new Date(), usedIn = [] } = {}) {
  const problems = [];
  const warnings = [];
  if (!isObj(data) || !Array.isArray(data.facts)) return { problems: ['health-facts.json must be { "facts": [ ... ] }'], warnings };
  const seen = new Set();
  const todayIso = (today instanceof Date ? today : new Date(today)).toISOString().slice(0, 10);
  for (const [i, f] of data.facts.entries()) {
    const where = `facts[${i}]${isObj(f) && f.id ? ` (${f.id})` : ''}`;
    if (!isObj(f)) { problems.push(`${where} is not an object`); continue; }
    if (typeof f.id !== 'string' || !ID_RE.test(f.id)) problems.push(`${where}: id must be lower-case letters, digits and underscores`);
    else if (seen.has(f.id)) problems.push(`${where}: duplicate id`);
    else seen.add(f.id);
    if (typeof f.value !== 'string' || !f.value.trim()) problems.push(`${where}: value must be non-empty text`);
    else if (UNSAFE_VALUE_RE.test(f.value)) problems.push(`${where}: value must be plain text (no < > & quotes or braces)`);
    if (!Array.isArray(f.sources) || !f.sources.length || f.sources.some((s) => !isObj(s) || !/^https:\/\/[^\s"'<>]+$/.test(String(s.url || '')) || !String(s.title || '').trim())) {
      problems.push(`${where}: sources must list each source's title and https url`);
    }
    if (typeof f.retrieved_on !== 'string' || !DATE_RE.test(f.retrieved_on)) problems.push(`${where}: retrieved_on must be YYYY-MM-DD`);
    if (typeof f.review_by !== 'string' || !DATE_RE.test(f.review_by)) problems.push(`${where}: review_by must be YYYY-MM-DD`);
    else if (f.review_by < todayIso) warnings.push(`${where}: review_by ${f.review_by} has passed; re-check the sources and update the value or the date`);
  }
  for (const [place, text] of usedIn) {
    for (const token of factTokens(text)) {
      const m = /^\{\{fact:([a-z0-9_]+)\}\}$/.exec(token);
      if (!m) problems.push(`${place}: malformed fact token ${token}`);
      else if (!seen.has(m[1])) problems.push(`${place}: ${token} names no fact in data/health-facts.json`);
    }
  }
  return { problems, warnings };
}

module.exports = { TOKEN_RE, ANY_TOKEN_RE, factMap, resolveFacts, factTokens, factProblems };
