/**
 * sage-server Y-83: the claims page named claims@thewayagency.com, which does not
 * exist (owner, 2026-11-14). It names service@ now, and the agency email guard
 * (scripts/lib/agency-email-guard.js) refuses any @thewayagency.com address that
 * is not an agency mailbox:
 *   - over src/ and data/ here;
 *   - over the BUILT output in scripts/build.js (step 11a3), which this test
 *     checks is wired, and which fails CI and Cloudflare Pages builds.
 * Synthetic data only.
 *
 *   node --test tests/agency-email-guard.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { AGENCY_ADDRESSES, agencyEmailProblems, agencyEmailProblemsInTree, decodeAt } = require('../scripts/lib/agency-email-guard');

describe('the claims page (Y-83; Y-88b: "We want claims called in")', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/pages/about/claims.html'), 'utf8');
  test('invites no emailed claim: no claims@, no service@, no "Email Our Claims Team"; the footer keeps hello@', () => {
    assert.equal((html.match(/claims@thewayagency\.com/gi) || []).length, 0);
    assert.equal((html.match(/service@thewayagency\.com/g) || []).length, 0);
    assert.doesNotMatch(html, /Email Our Claims Team/);
    assert.deepEqual(html.match(/href="mailto:[^"]+"/g), ['href="mailto:hello@thewayagency.com"']);
  });
  test('claims are called or texted in: the call and text links stay', () => {
    assert.match(html, /<a href="tel:\+15024135335" class="btn btn--primary btn--lg">Call to File a Claim<\/a>/);
    assert.match(html, /<a href="sms:\+15024135335" class="btn btn--outline-white btn--lg">Text Us<\/a>/);
  });
});

describe('the guard', () => {
  test('the allowed mailboxes', () => {
    assert.deepEqual([...AGENCY_ADDRESSES].sort(), [
      'audrey@thewayagency.com', 'hello@thewayagency.com', 'jill@thewayagency.com', 'kelly@thewayagency.com',
      'partner@thewayagency.com', 'service@thewayagency.com', 'sheilia@thewayagency.com',
    ]);
  });
  test('MUST-FAIL: claims@ in a link or in text, in any case', () => {
    assert.equal(agencyEmailProblems('<a href="mailto:claims@thewayagency.com">x</a>', 'p.html').length, 1);
    assert.equal(agencyEmailProblems('Write to Claims@TheWayAgency.com today', 'p.html').length, 1);
  });
  test('MUST-FAIL: the encoded forms a browser decodes', () => {
    for (const s of ['claims&#64;thewayagency.com', 'claims&#x40;thewayagency.com', 'claims&commat;thewayagency.com', 'mailto:claims%40thewayagency.com']) {
      assert.equal(agencyEmailProblems(s, 'p.html').length, 1, s);
    }
    assert.equal(decodeAt('a&#064;b'), 'a@b');
  });
  test('the agency mailboxes pass; one problem per address per file', () => {
    assert.deepEqual(agencyEmailProblems('hello@thewayagency.com service@thewayagency.com SHEILIA@thewayagency.com', 'p.html'), []);
    assert.equal(agencyEmailProblems('nobody@thewayagency.com nobody@thewayagency.com', 'p.html').length, 1);
  });
  test('an address at another domain is not its business', () => {
    assert.deepEqual(agencyEmailProblems('someone@example.com claims@thewayagency.co', 'p.html'), []);
  });
  test('a tree: a planted address in a built page or script fails, with its file named', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-email-'));
    try {
      fs.mkdirSync(path.join(dir, 'about'));
      fs.writeFileSync(path.join(dir, 'about', 'claims.html'), '<a href="mailto:service@thewayagency.com">ok</a>');
      fs.writeFileSync(path.join(dir, 'app.js'), "var e = 'billing@thewayagency.com';");
      fs.writeFileSync(path.join(dir, 'logo.png'), 'billing@thewayagency.com');
      const { problems, files } = agencyEmailProblemsInTree(dir);
      assert.equal(files, 2);
      assert.deepEqual(problems, ['app.js: billing@thewayagency.com is not an agency mailbox (scripts/lib/agency-email-guard.js AGENCY_ADDRESSES)']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('every page source names only agency mailboxes', () => {
  for (const dir of ['src', 'data']) {
    test(dir, () => {
      const { problems, files } = agencyEmailProblemsInTree(path.join(ROOT, dir));
      assert.ok(files > 10, `${dir}: ${files} files scanned`);
      assert.deepEqual(problems, []);
    });
  }
});

describe('the build runs the guard over its output', () => {
  test('scripts/build.js scans BUILD with the guard and throws on a problem', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
    assert.match(src, /require\('\.\/lib\/agency-email-guard'\)/);
    assert.match(src, /agencyEmailProblemsInTree\(BUILD\)/);
    assert.match(src, /throw new Error\(`Agency email guard failed/);
  });
  test('the built site names only agency mailboxes', () => {
    const build = path.join(ROOT, 'build');
    assert.ok(fs.existsSync(path.join(build, 'about', 'claims.html')), 'npm test builds build/ first (tests/helpers/build-for-tests.js); run it, or node scripts/build.js'); // Y-97: never skipped
    const { problems } = agencyEmailProblemsInTree(build);
    assert.deepEqual(problems, []);
    const claims = fs.readFileSync(path.join(build, 'about', 'claims.html'), 'utf8');
    assert.equal((claims.match(/claims@thewayagency\.com/gi) || []).length, 0);
    assert.equal((claims.match(/service@thewayagency\.com/g) || []).length, 0, 'Y-88b: no emailed claims');
  });
});
