/**
 * BLOG-02 process (content-accuracy WP-A5): statute and penalty statements on
 * the blog are flagged when they carry no primary source. Warnings only: the
 * post still renders. The lint lives in scripts/lib/legal-claims-lint.js, not
 * in the byte-shared blog-content-guard.js (sage-server parity test).
 *
 * Synthetic fixtures only; nothing is built or written.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { legalClaimWarnings } = require('../scripts/lib/legal-claims-lint');

const ROOT = path.join(__dirname, '..');
const LRC_990 = 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=52607';
const post = (body, front = '') => `---\ntitle: SYNTHETIC lint\nslug: test-lint\n${front}---\n\n${body}\n`;

describe('legalClaimWarnings', () => {
  test('a KRS citation with no link and no sources warns, naming the section', () => {
    const w = legalClaimWarnings(post('Penalties are set by KRS 342.990 for each offense.'));
    assert.ok(w.some((x) => /primary source/.test(x)), w.join('\n'));
    assert.ok(w.some((x) => /KRS 342\.990/.test(x)), w.join('\n'));
  });

  test('the same citation linked to its LRC page gives no warning', () => {
    assert.deepEqual(legalClaimWarnings(post(`Penalties are set by [KRS 342.990](${LRC_990}).`)), []);
  });

  test('a sources: item labelled with the section covers a plain-text citation', () => {
    const w = legalClaimWarnings(post('Penalties are set by KRS 342.990.', `sources: [KRS 342.990 | ${LRC_990}]\n`));
    assert.deepEqual(w, []);
  });

  test('an LRC link that names a different section does not cover the cited one', () => {
    const w = legalClaimWarnings(post(`See [KRS 342.012](https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=44523). Penalties: KRS 342.990.`));
    assert.equal(w.length, 1);
    assert.match(w[0], /KRS 342\.990/);
    assert.doesNotMatch(w[0], /342\.012/);
  });

  test('a link to a non-LRC host does not cover a KRS citation', () => {
    const w = legalClaimWarnings(post('Penalties: [KRS 342.990](https://example.com/krs).'));
    assert.ok(w.some((x) => /KRS 342\.990/.test(x)));
  });

  test('"felony" with no primary link warns', () => {
    const w = legalClaimWarnings(post('Going without coverage is a felony.'));
    assert.equal(w.length, 1);
    assert.match(w[0], /"felony"/);
  });

  test('"per week" and "statute of limitations" are legal claims too; a primary-domain link satisfies them', () => {
    assert.match(legalClaimWarnings(post('Wages are paid up to $500 per week.'))[0], /"per week"/);
    assert.match(legalClaimWarnings(post('The statute of limitations is two years.'))[0], /statute of limitations/);
    assert.deepEqual(legalClaimWarnings(post('The statute of limitations applies ([KY DOI](https://insurance.ky.gov/ppc/Static.aspx)).')), []);
  });

  test('section numbers with letters and hyphens are recognised', () => {
    const w = legalClaimWarnings(post('See KRS 304.39-130 and KRS 198B.668.', `sources: [https://www.irs.gov/x]\n`));
    assert.equal(w.length, 1);
    assert.match(w[0], /KRS 304\.39-130, KRS 198B\.668/);
  });

  test('a plain post gives no warning', () => {
    assert.deepEqual(legalClaimWarnings(post('Bundling home and auto can simplify renewals.')), []);
  });

  test('it never throws on empty or front-matter-only input', () => {
    assert.deepEqual(legalClaimWarnings(''), []);
    assert.deepEqual(legalClaimWarnings('---\ntitle: x\n---\n'), []);
  });
});

describe('wiring', () => {
  test('generate-blog.js prints the warnings and never refuses on them', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-blog.js'), 'utf8');
    assert.match(src, /require\('\.\/lib\/legal-claims-lint'\)/);
    assert.match(src, /for \(const w of legalClaimWarnings\(decision\.markdown\)\) console\.log\(/);
  });

  test('the byte-shared guard is untouched by this rule', () => {
    const guard = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'blog-content-guard.js'), 'utf8');
    assert.doesNotMatch(guard, /legal-claims-lint|legalClaimWarnings/);
  });
});
