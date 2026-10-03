/**
 * Claims scanner: the hard rules (claims-and-credentials spec section 3.5).
 *
 * A hard rule is a retracted phrase that no page may print again: a tenure or
 * founding year without evidence, a carrier count, a Medicare carrier count, an
 * AARP endorsement, an automatic "Reviewed by" box, storefront wording, a
 * licence overstatement, or claims-role copy that overpromises. Any match is a
 * finding. PR-3 of the spec adds the "checked" rules (founding years, parity,
 * review counts, rating dates, savings figures) and a build-mode run in
 * validate-build.js; this module is shaped so they slot in as more RULES.
 *
 * Pure and dependency-free (Node 18): CI's safe-build job runs without npm ci.
 * Nothing here reads build/ or writes anything.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Each pattern is global so every occurrence is reported.
const RULES = Object.freeze([
  {
    id: 'tenure-1998',
    why: 'no agency record supports a 1998 founding (TRUST-02)',
    patterns: [/\b(?:since|founded(?: in)?|established(?: in)?)\s+1998\b/gi],
  },
  {
    id: 'tenure-duration',
    why: 'tenure figures match no licence date (TRUST-02, TRUST-06)',
    patterns: [/\bmore than twenty-five years\b/gi, /\b\d+ years experience\b/gi],
    // Job requirements on the careers pages are not tenure claims.
    skipFile: (rel) => /^src\/pages\/about\/careers(?:\.html|\/)/.test(rel),
  },
  {
    id: 'carrier-count',
    why: 'carrier counts are not computed from verified appointments (TRUST-05)',
    patterns: [
      /\b\d+\+\s*(?:top-rated\s+)?(?:carriers|insurers|insurance companies)\b/gi,
      />\s*30\+\s*</g,
      />\s*Rated Carriers\s*</gi,
      /\ba dozen carriers\b/gi,
    ],
  },
  {
    id: 'medicare-count',
    why: 'Medicare is never paired with a carrier count (TRUST-01, TRUST-05)',
    patterns: [/\bMedicare from \d+/gi],
  },
  {
    id: 'aarp',
    why: 'no AARP endorsement applies to the agency or its commercial carriers (TRUST-05)',
    patterns: [/\bAARP\b/g],
    skipFile: (rel) => isBlogMarkdown(rel),
  },
  {
    id: 'review-credit',
    why: 'a review credit prints only from a signed SAGE approval (TRUST-06)',
    // A quoted "Reviewed by" names the label (the /ai-disclosure explanation of
    // when it appears); it credits no one.
    patterns: [/(?<!["\u201c]|&ldquo;|&quot;)\bReviewed by\b/g, /\bLast reviewed\b/gi],
    // The blog renderer and its credit library implement the signed gate; the
    // blog README documents it. Blog posts themselves are decided by that gate.
    skipFile: (rel) => rel === 'scripts/generate-blog.js'
      || rel === 'scripts/lib/review-credit.js'
      || rel === 'src/blog/README.md'
      || isBlogMarkdown(rel),
  },
  {
    id: 'office',
    why: 'no storefront: PO Box 187 is mail only (LOCAL-06)',
    patterns: [
      /\bOwensboro Office\b/g,
      /\bstop by\b/gi,
      // "no walk-in office" is the honest mail-only wording, not a storefront claim.
      /(?<!\bno )\bwalk-?in (?:office|location|visits?)\b/gi,
      /\bvisit (?:us|our office)\b/gi,
      /\bour office in\b/gi,
      /\bour [A-Z][a-z]+ office\b/g,
      /\bA local agent serving\b/g,
    ],
  },
  {
    id: 'licensing',
    why: 'two of the four agents hold no Tennessee licence (TRUST-03)',
    patterns: [/\bEach agent is licensed in Kentucky, Indiana, and Tennessee\b/g, /\blicensed across three states\b/gi],
  },
  {
    id: 'claims-role',
    why: 'claims copy overpromises the agency\'s role (TRUST-13); a warning only in blog posts',
    patterns: [
      /\bBefore anything else\b/g,
      /\ba person picks up\b/gi,
      /\bwe fight for you\b/gi,
      /\bpush back on the carrier\b/gi,
      /\bWe work for you, not the insurance company\b/g,
      /\bhandled fairly\b/gi,
      /\blowball\b/gi,
    ],
    softFile: (rel) => isBlogMarkdown(rel),
  },
]);

function isBlogMarkdown(rel) {
  return /^src\/blog\/[^/]+\.md$/.test(rel);
}

/**
 * Findings for one text. rel is the repository-relative path (forward
 * slashes); it decides per-rule exclusions and soft (warning-only) rules.
 * @returns {{rule: string, severity: 'hard'|'soft', file: string, line: number, match: string}[]}
 */
function scanText(text, rel = '') {
  const findings = [];
  const src = String(text);
  for (const rule of RULES) {
    if (rule.skipFile && rule.skipFile(rel)) continue;
    const severity = rule.softFile && rule.softFile(rel) ? 'soft' : 'hard';
    for (const re of rule.patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const line = src.slice(0, m.index).split('\n').length;
        findings.push({ rule: rule.id, severity, file: rel, line, match: m[0] });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
  return findings;
}

/** The repository files the source-mode scan reads (spec section 3.5, item 1). */
function sourceFiles(root) {
  const out = [];
  const add = (rel) => { if (fs.existsSync(path.join(root, rel))) out.push(rel); };
  const walk = (relDir, keep) => {
    const abs = path.join(root, relDir);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel, keep);
      else if (keep(rel)) out.push(rel);
    }
  };
  walk('src/pages', (rel) => /\.html$/.test(rel));
  add('src/intake.html');
  add('src/portal.html');
  add('src/partner.html');
  walk('data', (rel) => /^data\/[^/]+\.json$/.test(rel) && rel !== 'data/content-calendar.json');
  walk('scripts/builders', (rel) => /\.js$/.test(rel));
  add('scripts/shared-templates.js');
  add('scripts/generate-blog.js');
  walk('src/blog', (rel) => isBlogMarkdown(rel));
  return out.sort();
}

/** Every finding over the source-mode files under root. */
function scanSources(root) {
  const findings = [];
  for (const rel of sourceFiles(root)) {
    findings.push(...scanText(fs.readFileSync(path.join(root, rel), 'utf8'), rel));
  }
  return findings;
}

module.exports = { RULES, scanText, scanSources, sourceFiles };
