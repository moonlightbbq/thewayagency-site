/**
 * Legal-claims lint for blog markdown (BLOG-02 process; content-accuracy
 * WP-A5). WARNINGS ONLY: generate-blog.js prints them and renders the post
 * anyway, the way the review-wording rules warn. Never a refusal.
 *
 * Kentucky statute and penalty statements on the blog went out wrong ("Class D
 * felony" for a workers' comp violation KRS 342.990 punishes with fines and
 * 30 to 180 days in jail; a $200 PIP weekly cap after the 2026 change to $500)
 * because nothing asked the writer to show the source. This lint asks:
 *
 *   1. A post that states law (KRS, KAR, CFR, "required by Kentucky law",
 *      felony, misdemeanor, "per week", "statute of limitations") but has no
 *      `sources:` entry and no body link to a primary source domain.
 *   2. A KRS section cited in the body (KRS 342.990, KRS 304.39-130) that no
 *      apps.legislature.ky.gov link names: neither an inline link whose text
 *      carries the section number nor a `sources:` item labelled with it.
 *
 * Site-only on purpose: scripts/lib/blog-content-guard.js is byte-identical
 * with sage-server's copy (a parity test fails on any difference), so this is
 * NOT part of the guard. Porting it to SAGE's approval screen would be a
 * coordinated two-repo change, sage-server first.
 */
'use strict';

/** Hosts whose pages count as a primary source for a legal or regulatory claim. */
const PRIMARY_SOURCE_HOSTS = Object.freeze([
  'apps.legislature.ky.gov',
  'ecfr.gov',
  'cms.gov',
  'medicare.gov',
  'ssa.gov',
  'insurance.ky.gov',
  'healthcare.gov',
  'irs.gov',
  'fema.gov',
  'chfs.ky.gov',
]);

const LRC_HOST = 'apps.legislature.ky.gov';

/** Phrases that state law. Each is [label, pattern]. */
const LEGAL_TRIGGERS = Object.freeze([
  ['KRS', /\bKRS\s+(?:Chapter\s+)?\d/i],
  ['KAR', /\b\d{3}\s+KAR\b/],
  ['CFR', /\bCFR\b/],
  ['"required by state law"', /\brequired by (?:state|Kentucky) law\b/i],
  ['"felony"', /\bfelon(?:y|ies)\b/i],
  ['"misdemeanor"', /\bmisdemeanou?rs?\b/i],
  ['"per week"', /\bper week\b/i],
  ['"statute of limitations"', /\bstatutes? of limitations?\b/i],
]);

// A KRS section number: 342.990, 304.39-130, 198B.668, 227A.060.
const KRS_SECTION_RE = /\bKRS\s+(\d{1,3}[A-Z]?\.\d{2,4}(?:-\d{2,4})?)/gi;

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function isPrimary(url) {
  const host = hostOf(url);
  return PRIMARY_SOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Split a markdown file into its front-matter text and its body. */
function splitFrontMatter(markdown) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(markdown || '').replace(/\r\n/g, '\n'));
  return m ? { front: m[1], body: m[2] } : { front: '', body: String(markdown || '') };
}

/**
 * The `sources:` items as [{ label, url }] (one line, "Label | https://url" or
 * a bare https URL), read the way generate-blog.js postSources reads them.
 */
function frontMatterSources(front) {
  const line = (/^sources:\s*(.*)$/m.exec(front) || [])[1];
  if (!line) return [];
  const inner = line.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const parts = item.split(/\s+\|\s+/).map((p) => p.trim());
    const url = parts[parts.length - 1];
    return { label: parts.length > 1 ? parts.slice(0, -1).join(' | ') : '', url };
  }).filter((s) => /^https:\/\/[^\s"'<>]+$/.test(s.url));
}

/** Inline markdown links in the body as [{ text, url }]. */
function bodyLinks(body) {
  return [...body.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map((m) => ({ text: m[1], url: m[2] }));
}

/** Upper-cased KRS section numbers named in a piece of text. */
function krsSections(text) {
  return [...String(text).matchAll(KRS_SECTION_RE)].map((m) => m[1].toUpperCase());
}

/**
 * Warnings for one post's markdown (front matter included). Returns an array
 * of strings, empty when there is nothing to say.
 * @param {string} markdown
 * @returns {string[]}
 */
function legalClaimWarnings(markdown) {
  const { front, body } = splitFrontMatter(markdown);
  const sources = frontMatterSources(front);
  const links = bodyLinks(body);
  const warnings = [];

  // Text a reader sees: link targets are not claims.
  const visible = body.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');
  const triggers = LEGAL_TRIGGERS.filter(([, re]) => re.test(visible)).map(([label]) => label);
  const hasPrimary = sources.length > 0 || links.some((l) => isPrimary(l.url));
  if (triggers.length && !hasPrimary) {
    warnings.push(`legal claim without a primary source (${triggers.join(', ')}): add a sources: line or link the statute or agency page`);
  }

  const cited = [...new Set(krsSections(visible))];
  if (cited.length) {
    const linked = new Set([
      ...links.filter((l) => hostOf(l.url) === LRC_HOST).flatMap((l) => krsSections(l.text)),
      ...sources.filter((s) => hostOf(s.url) === LRC_HOST).flatMap((s) => krsSections(s.label)),
    ]);
    const unlinked = cited.filter((n) => !linked.has(n));
    if (unlinked.length) {
      warnings.push(`KRS ${unlinked.join(', KRS ')} cited without an ${LRC_HOST} link naming it: link the section's LRC page`);
    }
  }
  return warnings;
}

module.exports = { legalClaimWarnings, PRIMARY_SOURCE_HOSTS, LEGAL_TRIGGERS };
