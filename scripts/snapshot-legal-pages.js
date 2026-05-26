#!/usr/bin/env node
/**
 * Snapshot compliance pages by version into legal-archive/.
 *
 * For each compliance page in build/, read the `Version` chip and write the
 * full HTML to `legal-archive/<version>/<page>.html` if no snapshot exists
 * for that version yet. Snapshots are write-once per version — once a
 * version has been archived, that folder is frozen.
 *
 * If a page's <main> content changes within the same version, the build
 * prints a warning. The convention is to bump the `Version` chip (and
 * `Updated` date) on any substantive change. See legal-archive/README.md.
 *
 * Run standalone:  node scripts/snapshot-legal-pages.js [buildDir]
 */
const fs = require('fs');
const path = require('path');

const LEGAL_PAGES = [
  'privacy.html', 'terms.html', 'disclosures.html',
  'privacy-notice.html', 'ai-disclosure.html', 'information-security.html',
];

const extractMain = (html) => {
  const m = html.match(/<main[\s\S]*?<\/main>/i);
  return m ? m[0] : html;
};

function snapshotLegalPages({ buildDir, archiveDir } = {}) {
  buildDir = buildDir || path.join(__dirname, '..', 'build');
  archiveDir = archiveDir || path.join(__dirname, '..', 'legal-archive');
  const events = [];

  for (const file of LEGAL_PAGES) {
    const src = path.join(buildDir, file);
    if (!fs.existsSync(src)) continue;
    const html = fs.readFileSync(src, 'utf8');

    const vm = html.match(/Version\s+(\d{4}\.\d{2}(?:\.\d+)?)/);
    if (!vm) { events.push({ file, status: 'no-version' }); continue; }
    const version = vm[1];

    const dest = path.join(archiveDir, version, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, html);
      events.push({ file, version, status: 'created' });
    } else {
      const existing = fs.readFileSync(dest, 'utf8');
      if (extractMain(existing) !== extractMain(html)) {
        events.push({ file, version, status: 'content-diff-no-bump' });
      }
      // else: identical (or only chrome differs) — frozen, no overwrite
    }
  }

  const created = events.filter((e) => e.status === 'created');
  const diff    = events.filter((e) => e.status === 'content-diff-no-bump');
  const novsn   = events.filter((e) => e.status === 'no-version');

  if (!created.length && !diff.length && !novsn.length) {
    console.log('  ✓ Legal archive up to date');
  } else {
    if (created.length) {
      console.log('  ✓ Legal archive snapshot(s) created:');
      for (const e of created) console.log(`    + legal-archive/${e.version}/${e.file}`);
    }
    if (diff.length) {
      console.warn('  ! Legal archive: <main> content changed without bumping Version:');
      for (const e of diff) console.warn(`    - ${e.file} (still at ${e.version}) — bump Version chip + Updated date; see legal-archive/README.md`);
    }
    if (novsn.length) {
      console.warn('  ! Legal archive: no Version chip found in:');
      for (const e of novsn) console.warn(`    - ${e.file}`);
    }
  }

  return events;
}

if (require.main === module) {
  snapshotLegalPages({ buildDir: process.argv[2] });
}

module.exports = { snapshotLegalPages, LEGAL_PAGES };
