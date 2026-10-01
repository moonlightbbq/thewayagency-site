#!/usr/bin/env node
'use strict';
/**
 * Compare-and-swap check for scripts/git-push-rebase.sh. It runs after this
 * run's commit was rebased cleanly onto what landed on origin meanwhile, and
 * before that commit is pushed.
 *
 * A clean three-way rebase proves only that the two sides changed different
 * LINES. SAGE's own writes to this repo are stricter: each lands only if the
 * file is unchanged since SAGE read it (sage-server #943). The same rule is
 * applied here to the publish run, at the unit the run decides on:
 *   - a JSON file: each entry with a slug (a calendar entry, wherever it sits),
 *     the order of each array of such entries, the entries without a slug,
 *     and every other top-level key;
 *   - any other file (a post's markdown): the whole file.
 * A unit that both this run and origin changed since the run read it, to
 * different values, is a conflict, even when the lines merged: the run decided
 * on a copy that is no longer current. A post rescheduled (publish_date) or
 * reassigned while this run published it, or a post body rewritten after this
 * run checked its bytes, would otherwise publish on stale data.
 *
 * It also checks that the rebased commit holds exactly this run's version of
 * every unit the run changed and origin's version of everything else, and that
 * every JSON file the run changed still parses.
 *
 * Usage: node scripts/push-cas-check.js <base> <mine> <theirs> <merged>
 *   base    the commit this run started from (what it read)
 *   mine    this run's commit, before the rebase
 *   theirs  origin/<branch> as just fetched
 *   merged  the rebased commit about to be pushed
 * Exit 0: safe to push. 1: refused (each reason is printed). 2: the check
 * could not run. The caller refuses the push on any non-zero exit.
 */

const { execFileSync } = require('child_process');

const GIT_OPTS = { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
const git = (...args) => execFileSync('git', args, GIT_OPTS);

function commitOf(rev) {
  return git('rev-parse', '--verify', '-q', `${rev}^{commit}`).trim();
}

function changedPaths(a, b) {
  return git('diff', '--name-only', '-z', '--no-renames', a, b).split('\0').filter(Boolean);
}

/** The blob id of <path> at <commit>, or null when the path is absent there. */
function blobAt(commit, p) {
  try {
    return git('rev-parse', '--verify', '-q', `${commit}:${p}`).trim() || null;
  } catch (e) {
    if (e.status === 1) return null;
    throw e;
  }
}

const isSlugged = (e) => e !== null && typeof e === 'object' && !Array.isArray(e)
  && typeof e.slug === 'string' && e.slug !== '';

/** A JSON file as named units -> canonical value. Throws when it does not parse. */
function jsonUnits(blob) {
  const units = new Map();
  if (!blob) {
    units.set('the file itself', 'absent');
    return units;
  }
  const doc = JSON.parse(git('cat-file', 'blob', blob));
  units.set('the file itself', 'present');
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    units.set('the whole document', JSON.stringify(doc));
    return units;
  }
  const bySlug = new Map();
  for (const [key, value] of Object.entries(doc)) {
    if (!Array.isArray(value) || !value.some(isSlugged)) {
      units.set(`"${key}"`, JSON.stringify(value));
      continue;
    }
    const order = [];
    const unslugged = [];
    for (const e of value) {
      if (isSlugged(e)) {
        order.push(e.slug);
        if (!bySlug.has(e.slug)) bySlug.set(e.slug, []);
        bySlug.get(e.slug).push([key, e]);
      } else {
        order.push(null);
        unslugged.push(e);
      }
    }
    units.set(`the order of "${key}"`, JSON.stringify(order));
    if (unslugged.length) units.set(`the entries of "${key}" without a slug`, JSON.stringify(unslugged));
  }
  // An entry is one unit wherever it sits: moving it to another array changes it.
  for (const [slug, where] of bySlug) units.set(`entry "${slug}"`, JSON.stringify(where));
  return units;
}

const SIDES = { base: 'the version this run read', mine: "this run's version", theirs: "origin's version", merged: 'the rebased version' };

function compareJson(p, blobs, problems) {
  const units = {};
  for (const side of Object.keys(SIDES)) {
    try {
      units[side] = jsonUnits(blobs[side]);
    } catch (e) {
      problems.push(`${p}: ${SIDES[side]} is not valid JSON (${e.message}), so it cannot be checked`);
      return;
    }
  }
  const names = new Set(Object.values(units).flatMap((u) => [...u.keys()]));
  for (const n of names) {
    const b = units.base.get(n), m = units.mine.get(n), t = units.theirs.get(n), x = units.merged.get(n);
    const mineChanged = m !== b, theirsChanged = t !== b;
    if (mineChanged && theirsChanged && m !== t) {
      problems.push(`${p}: ${n}: origin changed it after this run read it, and this run changed it too`);
      continue;
    }
    if (x !== (mineChanged ? m : t)) problems.push(`${p}: ${n}: the rebased commit holds neither this run's nor origin's version`);
  }
}

function main(argv) {
  if (argv.length !== 4) {
    console.log('usage: node scripts/push-cas-check.js <base> <mine> <theirs> <merged>');
    return 2;
  }
  let problems;
  try {
    const [base, mine, theirs, merged] = argv.map(commitOf);
    const mineFiles = new Set(changedPaths(base, mine));
    const theirsFiles = new Set(changedPaths(base, theirs));
    problems = [];
    for (const p of new Set([...mineFiles, ...theirsFiles])) {
      const blobs = { base: blobAt(base, p), mine: blobAt(mine, p), theirs: blobAt(theirs, p), merged: blobAt(merged, p) };
      const mineChanged = blobs.mine !== blobs.base, theirsChanged = blobs.theirs !== blobs.base;
      if (mineChanged && p.endsWith('.json')) {
        compareJson(p, blobs, problems);
        continue;
      }
      if (mineChanged && theirsChanged && blobs.mine !== blobs.theirs) {
        problems.push(`${p}: origin changed this file after this run read it, and this run changed it too`);
        continue;
      }
      if (blobs.merged !== (mineChanged ? blobs.mine : blobs.theirs)) {
        problems.push(`${p}: the rebased commit holds neither this run's nor origin's version`);
      }
    }
    // The rebased commit may differ from origin only where this run changed something.
    for (const p of changedPaths(theirs, merged)) {
      if (!mineFiles.has(p)) problems.push(`${p}: the rebased commit changes a file this run never changed`);
    }
  } catch (e) {
    console.log(`push-cas-check: the check could not run: ${(e.stderr || e.message || String(e)).toString().trim()}`);
    return 2;
  }
  if (problems.length) {
    console.log('push-cas-check: refused. The rebased commit is not this run\'s change applied to what it read:');
    for (const p of problems) console.log(`  - ${p}`);
    return 1;
  }
  console.log('push-cas-check: nothing this run changed was changed on origin since the run read it.');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
