#!/usr/bin/env node
/**
 * Y-84 (A): the blog writing check (scripts/lib/blog-writing-check.js).
 *
 *   node scripts/check-blog-writing.js                       # live posts against the baseline, exceptions used
 *   node scripts/check-blog-writing.js --changed origin/main # also: every unpublished post this branch adds or edits
 *   node scripts/check-blog-writing.js --write-baseline      # rewrite the baseline from today (never raises a count)
 *   node scripts/check-blog-writing.js --write-baseline --init  # first baseline only
 *
 * Runs in deploy-protection.yml's blog-validation job (PRs: --changed against
 * the base branch). It is never part of scripts/build.js: a production build must
 * not fail on an unpublished draft (Y0 ruling 11/14).
 * Exit 0 clean, 1 problems, 2 usage or a git error.
 */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const c = require('./lib/blog-writing-check');

function changedPosts(baseRef) {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', `${baseRef}...HEAD`, '--', 'src/blog'], { encoding: 'utf8' });
  return new Set(out.split('\n').map((s) => s.trim()).filter((s) => /^src\/blog\/(?:_drafts\/)?[^/]+\.md$/.test(s) && !s.endsWith('/README.md')));
}

function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--changed');
  let changed = null;
  if (i >= 0) {
    if (!argv[i + 1]) { console.error('--changed needs a base ref'); return 2; }
    try { changed = changedPosts(argv[i + 1]); } catch (err) { console.error(`git diff against ${argv[i + 1]} failed: ${err.message}`); return 2; }
  }
  const today = new Date().toISOString().slice(0, 10);
  const calendar = c.readJson(c.DEFAULTS.calendarFile, {});
  const baseline = c.readJson(c.DEFAULTS.baselineFile, null);
  const exceptions = c.loadExceptions(c.DEFAULTS.exceptionsFile);

  if (argv.includes('--write-baseline')) {
    const r = c.checkPosts({ calendar, baseline: { posts: {} }, exceptions, today });
    const next = c.nextBaseline(baseline, r.liveCounts, { init: argv.includes('--init') && !baseline });
    fs.writeFileSync(c.DEFAULTS.baselineFile, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Wrote data/blog-writing-baseline.json: ${Object.keys(next.posts).length} live posts with problems (of ${r.live} live)`);
    return 0;
  }
  if (!baseline) { console.error('data/blog-writing-baseline.json is missing (create it once with --write-baseline --init)'); return 2; }

  const r = c.checkPosts({ calendar, baseline, exceptions, today, changed });
  for (const p of r.problems) console.error(`  - ${p}`);
  const scope = changed ? `; ${changed.size} post file(s) changed on this branch` : '';
  if (r.problems.length) {
    console.error(`✗ Blog writing check: ${r.problems.length} problem(s) (${r.live} live, ${r.unpublished} unpublished${scope}). Rules: scripts/lib/blog-writing-guard.js`);
    return 1;
  }
  console.log(`✓ Blog writing check: ${r.live} live posts within the baseline, ${r.unpublished} unpublished${scope}`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main, changedPosts };
