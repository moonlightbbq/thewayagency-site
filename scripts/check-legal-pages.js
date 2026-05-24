#!/usr/bin/env node
/**
 * Legal-page guard.
 *
 * Keeps the disclosure pages free of "AI slop" em-dash phrasing and broken
 * in-page anchors. Only the <main> content of each page is inspected, so the
 * shared CSS / nav / footer (which legitimately use `--` in CSS vars and an
 * en dash in the business-hours line) cannot cause false positives.
 *
 * Run standalone:  node scripts/check-legal-pages.js [buildDir]
 * Returns an array of problem strings via checkLegalPages(); exits non-zero
 * when run directly and any are found.
 */
const fs = require('fs');
const path = require('path');

const LEGAL_PAGES = [
  'privacy.html', 'terms.html', 'disclosures.html',
  'privacy-notice.html', 'ai-disclosure.html', 'information-security.html',
];

function checkLegalPages(buildDir) {
  buildDir = buildDir || path.join(__dirname, '..', 'build');
  const problems = [];

  for (const file of LEGAL_PAGES) {
    const full = path.join(buildDir, file);
    if (!fs.existsSync(full)) continue;
    const html = fs.readFileSync(full, 'utf8');

    // Inspect only the visible content region.
    const m = html.match(/<main[\s\S]*?<\/main>/i);
    const content = m ? m[0] : html;

    // 1) Em-dash phrasing (en dash – is allowed; it is used in footer hours only).
    if (content.includes('&mdash;')) problems.push(`${file}: &mdash; in copy`);
    if (content.includes('—')) problems.push(`${file}: literal em dash (—) in copy`);
    if (/\s--\s/.test(content)) problems.push(`${file}: " -- " double hyphen in copy`);

    // 2) Broken in-page anchors: every href="#id" must resolve to an id in content.
    const ids = new Set([...content.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));
    for (const a of content.matchAll(/href="#([A-Za-z0-9_-]+)"/g)) {
      if (!ids.has(a[1])) problems.push(`${file}: broken anchor #${a[1]}`);
    }
  }
  return problems;
}

if (require.main === module) {
  const problems = checkLegalPages(process.argv[2]);
  if (problems.length) {
    console.error('✗ Legal page guard failed:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('✓ Legal pages clean (no em dashes / broken anchors)');
}

module.exports = { checkLegalPages, LEGAL_PAGES };
