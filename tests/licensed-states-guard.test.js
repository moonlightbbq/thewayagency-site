/**
 * Y-74 PR-B (Y4 CHANGES + Y0, 2026-11-14): every list of US states a built page
 * prints agrees with data/entity.json licensed_states, in both directions
 * (scripts/lib/licensed-states-guard.js, run by scripts/build.js step 11a4):
 *   1. a list naming a state entity.json does not license fails;
 *   2. a list of the agency's states that leaves one out fails (the owner's 11/14
 *      complaint: "OH hasnt been added to all of the locations where our states
 *      are listed");
 *   3. a list of exactly the agency's states in another order fails (the owner's
 *      order, 11/14: KY, IN, OH, TN).
 * And the Accident and Health pages' JSON-LD areaServed names exactly
 * health_licensed_states (Y0 ruling 11/14: no Accident and Health line in Ohio).
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
const { licensedStates, healthLicensedStates, areaServedStates } = require('../scripts/lib/licensed-states');
const FOUR = ['KY', 'IN', 'OH', 'TN'];
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
  test('the full list passes in the agency\'s order, in any form', () => {
    for (const html of ['Kentucky, Indiana, Ohio, and Tennessee', 'KY, IN, OH &amp; TN', 'KY/IN/OH/TN', 'Kentucky, Indiana, Ohio and Tennessee']) assert.deepEqual(run(html, FOUR), [], html);
    assert.deepEqual(run('Kentucky, Indiana, and Tennessee', THREE), []);
  });
});

describe('direction 3: the agency\'s order (owner 11/14: KY, IN, OH, TN)', () => {
  test('MUST-FAIL: the four states in any other order', () => {
    for (const html of ['Kentucky, Indiana, Tennessee, and Ohio', 'KY, IN, TN &amp; OH', 'Ohio, Kentucky, Tennessee and Indiana', '{"text":"KY, IN, TN, OH"}']) {
      const p = run(html, FOUR);
      assert.equal(p.length, 1, html);
      assert.match(p[0], /out of order \(data\/entity\.json order: KY, IN, OH, TN\)/, html);
    }
  });
  test('a partial list is judged by direction 2, never by order', () => {
    const p = run('Tennessee and Kentucky', FOUR);
    assert.equal(p.length, 1);
    assert.match(p[0], /leaves out/);
  });
});

describe('areaServed on the Accident and Health pages', () => {
  const page = (...names) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Service', areaServed: names.map((name) => ({ '@type': 'State', name })) })}</script>`;
  const HEALTH = ['KY', 'IN', 'TN'];
  test('the health pages and life/disability are Accident and Health pages; other life pages are not', () => {
    for (const rel of ['health/index.html', 'health/medicare.html', 'life/disability.html']) assert.ok(guard.isAccidentHealthPage(rel), rel);
    for (const rel of ['life/term-life.html', 'life/index.html', 'personal/pet.html', 'industries/restaurants.html']) assert.ok(!guard.isAccidentHealthPage(rel), rel);
  });
  test('MUST-FAIL: a health or disability page whose areaServed names Ohio', () => {
    for (const rel of ['health/medicare.html', 'life/disability.html']) {
      const p = guard.areaServedProblems(page('Kentucky', 'Indiana', 'Ohio', 'Tennessee'), rel, FOUR, HEALTH);
      assert.equal(p.length, 1, rel);
      assert.match(p[0], /Accident and Health page names exactly the health states/);
    }
  });
  test('MUST-FAIL: a health page that leaves a health state out', () => {
    assert.equal(guard.areaServedProblems(page('Kentucky', 'Indiana'), 'health/index.html', FOUR, HEALTH).length, 1);
  });
  test('the health states pass on a health page; every licensed state passes elsewhere; an unlicensed one fails elsewhere', () => {
    assert.deepEqual(guard.areaServedProblems(page('Kentucky', 'Indiana', 'Tennessee'), 'health/index.html', FOUR, HEALTH), []);
    assert.deepEqual(guard.areaServedProblems(page('Kentucky', 'Indiana', 'Ohio', 'Tennessee'), 'life/term-life.html', FOUR, HEALTH), []);
    assert.equal(guard.areaServedProblems(page('Kentucky', 'Georgia'), 'personal/auto.html', FOUR, HEALTH).length, 1);
  });
  test('the builders\' source: health and disability read health_licensed_states, never every licensed state', () => {
    assert.deepEqual(licensedStates(), FOUR);
    assert.deepEqual(healthLicensedStates(), HEALTH);
    assert.deepEqual(areaServedStates({ line: 'health' }), HEALTH);
    assert.deepEqual(areaServedStates({ line: 'life', productId: 'disability' }), HEALTH);
    assert.deepEqual(areaServedStates({ line: 'life', productId: 'term-life' }), FOUR);
    assert.deepEqual(areaServedStates({ line: 'personal', productId: 'pet' }), FOUR);
  });
  test('MUST-FAIL: a health state that is not a licensed state, or no health list, throws', () => {
    const { healthLicensedStates: fresh } = require('../scripts/lib/licensed-states');
    for (const [name, extra] of [['not-licensed', { health_licensed_states: ['KY', 'GA'] }], ['missing', { health_licensed_states: undefined }], ['empty', { health_licensed_states: [] }]]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `health-states-${name}-`));
      try {
        fs.writeFileSync(path.join(dir, 'entity.json'), JSON.stringify({ licensed_states: FOUR, ...extra }));
        assert.throws(() => fresh(dir), /licensed-states:/, name);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
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
    assert.match(src, /licensedStateProblemsInTree\(BUILD, licensedStates\(\), undefined, \{ health: healthLicensedStates\(\) \}\)/);
    assert.match(src, /throw new Error\(`Licensed-states guard failed/);
  });
  test('when a build is present: no problem, every exception rule is used, and without OH the hand-made pages fail', (t) => {
    const build = path.join(ROOT, 'build');
    if (!fs.existsSync(path.join(build, 'index.html'))) { t.skip('no build/ (run node scripts/build.js)'); return; }
    const r = guard.licensedStateProblemsInTree(build, licensedStates(), undefined, { health: healthLicensedStates() });
    assert.deepEqual(r.problems, []);
    // Every Accident and Health page carries an areaServed, and it is the health states (no OH).
    const ah = ['health/index.html', 'health/medicare.html', 'health/group-health.html', 'life/disability.html'];
    for (const rel of ah) {
      const lists = guard.areaServedLists(fs.readFileSync(path.join(build, rel), 'utf8'));
      assert.ok(lists.length >= 1, rel);
      for (const l of lists) assert.deepEqual(l, ['KY', 'IN', 'TN'], rel);
    }
    // Were the health pages to name every licensed state, the built tree fails.
    const asIfHealthWereAll = guard.licensedStateProblemsInTree(build, licensedStates(), undefined, { health: licensedStates() });
    const ahFiles = new Set(asIfHealthWereAll.problems.map((p) => p.split(':')[0]));
    for (const rel of ah) assert.ok(ahFiles.has(rel), rel);
    const unused = guard.ALLOW.filter((a) => !r.usedRules.includes(a)).map((a) => `${a.file} ${a.codes}`);
    assert.deepEqual(unused, [], 'a stale exception rule');
    const without = guard.licensedStateProblemsInTree(build, THREE);
    const files = new Set(without.problems.map((p) => p.split(':')[0]));
    for (const f of ['index.html', 'about/index.html', 'about/locations.html', 'contact.html', 'terms.html', 'llms.txt']) assert.ok(files.has(f), f);
  });
});
