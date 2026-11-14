/**
 * Y-74 PR-B (Y4 CHANGES + Y0, 2026-11-14): every list of US states a built page
 * prints agrees with data/entity.json licensed_states, in both directions
 * (scripts/lib/licensed-states-guard.js, run by scripts/build.js step 11a4):
 *   1. a list naming a state entity.json does not license fails;
 *   2. a list of the agency's states that leaves one out fails (the owner's 11/14
 *      complaint: "OH hasnt been added to all of the locations where our states
 *      are listed").
 * Exceptions only by an explicit rule (file + exact states + reason).
 * Synthetic pages, plus the real build when one is present.
 *
 *   node --test tests/licensed-states-guard.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const guard = require('../scripts/lib/licensed-states-guard');
const { licensedStates } = require('../scripts/lib/licensed-states');
const FOUR = ['KY', 'IN', 'TN', 'OH'];
const THREE = ['KY', 'IN', 'TN'];
const run = (html, licensed, rel = 'page.html', allow = []) => guard.licensedStateProblems(html, rel, licensed, allow).problems;

describe('finding state lists', () => {
  test('names and abbreviations, with commas, and, &, &amp; and /', () => {
    const found = guard.findStateLists('Kentucky, Indiana, Tennessee, and Ohio · KY, IN, TN &amp; OH · KY/IN/TN · Indiana and Kentucky · West Virginia and Ohio');
    assert.deepEqual(found.map((f) => f.codes.join(',')), ['IN,KY,OH,TN', 'IN,KY', 'OH,WV', 'IN,KY,OH,TN', 'IN,KY,TN']);
  });
  test('a single state is never a list; lower-case words are not abbreviations', () => {
    assert.deepEqual(guard.findStateLists('Insurance in Kentucky. We are in or near me.'), []);
  });
});

describe('direction 1: a state entity.json does not license', () => {
  test('MUST-FAIL: OH out of entity.json, a page still saying Ohio fails', () => {
    const p = run('<p>We are licensed in Kentucky, Indiana, Tennessee, and Ohio.</p>', THREE);
    assert.equal(p.length, 1);
    assert.match(p[0], /names OH, which data\/entity\.json does not license/);
    assert.equal(run('<p>Licensed in KY, IN, TN &amp; OH.</p>', THREE).length, 1);
  });
  test('MUST-FAIL: any other unlicensed state in a list', () => {
    assert.equal(run('<p>Serving Kentucky, Indiana and Illinois</p>', FOUR).length, 1);
  });
});

describe('direction 2: a list of the agency\'s states that leaves one out', () => {
  test('MUST-FAIL: "KY, IN & TN" and "Kentucky, Indiana, and Tennessee" while OH is licensed', () => {
    for (const html of ['<p>Licensed in KY, IN &amp; TN.</p>', '<p>across Kentucky, Indiana, and Tennessee</p>', '{"text":"in KY, IN, and TN"}', 'Kentucky and Indiana']) {
      const p = run(html, FOUR);
      assert.equal(p.length, 1, html);
      assert.match(p[0], /leaves out/);
    }
  });
  test('the full list passes in any order and form', () => {
    for (const html of ['Kentucky, Indiana, Tennessee, and Ohio', 'KY, IN, TN &amp; OH', 'Ohio, Kentucky, Tennessee and Indiana']) assert.deepEqual(run(html, FOUR), [], html);
    assert.deepEqual(run('Kentucky, Indiana, and Tennessee', THREE), []);
  });
});

describe('exceptions are explicit and exact', () => {
  test('a rule allows only its file and its exact states', () => {
    const allow = [{ file: 'about/team.html', codes: 'IN,KY', reason: 'synthetic' }];
    assert.deepEqual(run('Licensed in KY, IN', FOUR, 'about/team.html', allow), []);
    assert.equal(run('Licensed in KY, IN', FOUR, 'about/index.html', allow).length, 1);
    assert.equal(run('Licensed in KY, IN, TN', FOUR, 'about/team.html', allow).length, 1);
  });
  test('every rule names a file, sorted states and a reason; frozen blog pages come from legacy-blog-pages.js', () => {
    for (const r of guard.ALLOW) {
      assert.match(r.file, /^[a-z0-9/._-]+\.(html|xml)$/, r.file);
      assert.equal(r.codes, r.codes.split(',').sort().join(','), r.file);
      assert.ok(r.reason && r.reason.length > 15, r.file);
    }
    const { LEGACY_BLOG_PAGES } = require('../scripts/lib/legacy-blog-pages');
    assert.deepEqual([...guard.FROZEN_BLOG].sort(), Object.keys(LEGACY_BLOG_PAGES).filter((n) => n !== 'index.html').map((n) => `blog/${n}`).sort());
  });
});

describe('a built tree', () => {
  test('MUST-FAIL: a hand-made page that still says four states, built after OH leaves entity.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'licensed-states-'));
    try {
      fs.writeFileSync(path.join(dir, 'index.html'), '<title>The Way Agency | Independent Insurance in KY, IN, TN &amp; OH</title>');
      fs.writeFileSync(path.join(dir, 'llms.txt'), 'Licensed in Kentucky, Indiana, and Tennessee.');
      fs.writeFileSync(path.join(dir, 'logo.png'), 'Kentucky and Ohio');
      const r = guard.licensedStateProblemsInTree(dir, THREE, []);
      assert.equal(r.files, 2);
      assert.equal(r.problems.length, 1);
      assert.match(r.problems[0], /^index\.html: .*names OH/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('scripts/build.js runs the guard over BUILD with entity.json\'s states and throws on a problem', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
    assert.match(src, /licensedStateProblemsInTree\(BUILD, licensedStates\(\)\)/);
    assert.match(src, /throw new Error\(`Licensed-states guard failed/);
  });
  test('when a build is present: no problem, every exception rule is used, and without OH the hand-made pages fail', (t) => {
    const build = path.join(ROOT, 'build');
    if (!fs.existsSync(path.join(build, 'index.html'))) { t.skip('no build/ (run node scripts/build.js)'); return; }
    const r = guard.licensedStateProblemsInTree(build, licensedStates());
    assert.deepEqual(r.problems, []);
    const unused = guard.ALLOW.filter((a) => !r.usedRules.includes(a)).map((a) => `${a.file} ${a.codes}`);
    assert.deepEqual(unused, [], 'a stale exception rule');
    const without = guard.licensedStateProblemsInTree(build, THREE);
    const files = new Set(without.problems.map((p) => p.split(':')[0]));
    for (const f of ['index.html', 'about/index.html', 'about/locations.html', 'contact.html', 'terms.html', 'llms.txt']) assert.ok(files.has(f), f);
  });
});
