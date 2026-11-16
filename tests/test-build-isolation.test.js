/**
 * Y-97: no test races the repo's build/, and the built-site checks never skip.
 *
 * `node --test` runs test files in parallel. build-gate-wiring used to run the
 * real build in the repo while licensed-states-guard, agency-email-guard and
 * flyer-redirects read build/. In CI (no build before `npm test`) one of them
 * skipped and another ran in the same run, by scheduling alone. Now `npm test`
 * builds once first (tests/helpers/build-for-tests.js), and a test that builds does so
 * in a throwaway copy (tests/helpers/site-build.js copySite).
 *
 *   npm test
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, goodRules, startStubSage, runBuild, copySite } = require('./helpers/site-build');
const guard = require('../scripts/lib/licensed-states-guard');
const { licensedStates } = require('../scripts/lib/licensed-states');

describe('the test command builds once, first', () => {
  test('npm test builds the site (tests/helpers/build-for-tests.js) before any test file', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.test, 'node tests/helpers/build-for-tests.js && node --test tests/*.test.js');
  });

  test('no test file reaches for a "no build/" skip any more', () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((n) => n.endsWith('.test.js'))) {
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8'), /t\.skip\(['"]no build\//, f);
    }
  });

  test('MUST-FAIL: the helper refuses to build in the repo itself', async () => {
    await assert.rejects(runBuild(ROOT, 'http://127.0.0.1:9'), /never in the repo/);
  });

  test('no test file runs scripts/build.js except through the helper: the build script is only ever READ', () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((n) => n.endsWith('.test.js'))) {
      const src = fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8').replace(/^\s*(\*|\/\/).*$/gm, '');
      // A path to scripts/build.js is allowed only as the argument of a readFileSync (the source checks).
      for (const m of src.matchAll(/path\.join\([^)]*'scripts',\s*'build\.js'\)/g)) {
        assert.match(src.slice(Math.max(0, m.index - 20), m.index), /readFileSync\($/, `${f}: a path to scripts/build.js that is not just read`);
      }
      assert.doesNotMatch(src, /(execFile|execFileSync|spawn|spawnSync|execSync|fork)\([^)]*scripts\/build\.js/, f);
    }
  });
});

describe('a false licence claim fails npm test', () => {
  test('MUST-FAIL: a page claiming an unlicensed state, planted in a copy of the site, fails its build with the licensed-states guard', async () => {
    const site = copySite('false-licence-claim-');
    const sage = await startStubSage(() => goodRules(site.dir));
    try {
      const page = path.join(site.dir, 'src', 'pages', 'contact.html');
      const html = fs.readFileSync(page, 'utf8');
      assert.equal(html.split('</main>').length, 2, 'contact.html has one </main>');
      fs.writeFileSync(page, html.replace('</main>', '<p>We write home insurance in Kentucky, Indiana, Ohio, Tennessee and Texas.</p></main>'));
      const { code, out } = await runBuild(site.dir, sage.url);
      assert.equal(code, 1, out.slice(-2000));
      assert.match(out, /Licensed-states guard failed/);
      assert.match(out, /contact\.html/);
    } finally {
      await sage.close();
      site.done();
    }
  });

  test('the same check on the build npm test made: a claim planted in a copy of the built page is found', () => {
    const built = fs.readFileSync(path.join(ROOT, 'build', 'contact.html'), 'utf8');
    const planted = built.replace('</main>', '<p>We write home insurance in Kentucky, Indiana, Ohio, Tennessee and Texas.</p></main>');
    const r = guard.licensedStateProblems(planted, 'contact.html', licensedStates(), guard.ALLOW);
    assert.ok(r.problems.some((p) => /TX/.test(p)), r.problems.join('\n'));
    assert.deepEqual(guard.licensedStateProblems(built, 'contact.html', licensedStates(), guard.ALLOW).problems, []);
  });
});
