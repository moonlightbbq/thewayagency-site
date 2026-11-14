'use strict';
/**
 * The agency email guard (sage-server board Y-83): a published page names only
 * @thewayagency.com addresses that exist.
 *
 * The claims page sent visitors to claims@thewayagency.com, a mailbox that was
 * never created (owner, 2026-11-14: "claims@thewayagency.com doesnt exist, needs
 * to go to service@"). This guard refuses any @thewayagency.com address that is
 * not on AGENCY_ADDRESSES, in a link or in text, including the encoded forms a
 * browser decodes (&#64; &#x40; &commat; and %40). scripts/build.js runs it over
 * every built text file, so a CI build and a Cloudflare Pages build both fail
 * on a page that names an address nobody reads; tests/agency-email-guard.test.js
 * also runs it over src/ and data/.
 *
 * Adding a real mailbox: add it here, in the same commit as the page that uses it.
 */
const fs = require('fs');
const path = require('path');

// Every agency mailbox a public page may name (each one exists).
const AGENCY_ADDRESSES = Object.freeze([
  'hello@thewayagency.com',
  'service@thewayagency.com',
  'partner@thewayagency.com',
  'audrey@thewayagency.com',
  'jill@thewayagency.com',
  'kelly@thewayagency.com',
  'sheilia@thewayagency.com',
]);

const TEXT_FILE = /\.(html?|js|mjs|json|txt|xml|md|webmanifest)$/i;

/** The text with the encoded forms of "@" a browser or mail client decodes, decoded once. */
function decodeAt(text) {
  return String(text)
    .replace(/&#0*64;?/g, '@')
    .replace(/&#x0*40;?/gi, '@')
    .replace(/&commat;/gi, '@')
    .replace(/%40/g, '@');
}

/**
 * Each @thewayagency.com address in `text` that is not an agency mailbox.
 * @returns {string[]} problems, "<label>: <address>"
 */
function agencyEmailProblems(text, label) {
  const out = [];
  const re = /([a-z0-9._%+-]+)@thewayagency\.com\b/gi;
  let m;
  const seen = new Set();
  const decoded = decodeAt(text);
  while ((m = re.exec(decoded))) {
    const addr = `${m[1].toLowerCase()}@thewayagency.com`;
    if (AGENCY_ADDRESSES.includes(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(`${label}: ${addr} is not an agency mailbox (scripts/lib/agency-email-guard.js AGENCY_ADDRESSES)`);
  }
  return out;
}

/** Every text file under `dir`, relative to it. */
function textFiles(dir, skip = () => false) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (skip(rel, e)) continue;
      if (e.isDirectory()) walk(p);
      else if (TEXT_FILE.test(e.name)) out.push(rel);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/** The guard over a whole tree (the build output, or src/). */
function agencyEmailProblemsInTree(dir, opts = {}) {
  const problems = [];
  const files = textFiles(dir, opts.skip);
  for (const rel of files) problems.push(...agencyEmailProblems(fs.readFileSync(path.join(dir, rel), 'utf8'), rel.split(path.sep).join('/')));
  return { problems, files: files.length };
}

module.exports = { AGENCY_ADDRESSES, agencyEmailProblems, agencyEmailProblemsInTree, decodeAt };
