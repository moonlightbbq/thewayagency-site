/**
 * BLOG-02 (content-accuracy WP-B): the Kentucky statute corrections stay
 * corrected. Each check reads the source files (never build/); the wording
 * itself is the licensed reviewers' to approve, these only stop the verified
 * errors from coming back:
 *
 *   - workers' comp: KRS 342.990 sets fines and 30 to 180 days in jail, no
 *     felony; KRS 342.650 has no real-estate-agent exemption; the remedy is a
 *     Franklin Circuit Court injunction (KRS 342.402), not a "stop-work order".
 *   - HVAC: general liability is a licence condition (KRS 198B.668).
 *   - electrical: the licence needs $1,000,000 general liability (KRS 227A.060).
 *   - PIP: $500 a week for coverage issued or renewed on or after 2026-07-15
 *     (KRS 304.39-130, 2026 Ky. Acts ch. 149); "$200 per week" only as the
 *     figure before that date.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LRC = (id) => `https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=${id}`;

describe('workers\' comp keeper (B1)', () => {
  const md = read('src/blog/workers-comp-requirements-kentucky-2026.md');
  test('no felony, no $25,000, no real-estate exemption, no stop-work order', () => {
    for (const bad of [/felon/i, /25,000/, /real estate agents?/i, /stop-work/i]) assert.doesNotMatch(md, bad);
  });
  test('the penalties and the injunction are stated from and linked to the statutes', () => {
    assert.ok(md.includes(`[KRS 342.990(7)(c)](${LRC(52607)})`));
    assert.ok(md.includes(`[KRS 342.990(9)(a)](${LRC(52607)})`));
    assert.ok(md.includes(`[KRS 342.402](${LRC(32497)})`));
    assert.ok(md.includes(`[KRS 342.012](${LRC(44523)})`));
    assert.match(md, /30 to 180 days in jail/);
  });
});

describe('HVAC checklist (B3)', () => {
  const md = read('src/blog/insurance-checklist-hvac-contractors.md');
  test('general liability is not called "not legally required"; the licence condition is stated and linked', () => {
    assert.doesNotMatch(md, /not legally required by the state/);
    assert.match(md, /\$500,000/);
    assert.match(md, /\$300,000/);
    assert.ok(md.includes(`[KRS 198B.668](${LRC(46948)})`));
  });
});

describe('electrical guide (B4)', () => {
  const md = read('src/blog/insurance-guide-electrical-contractors.md');
  test('the $1,000,000 licence condition is stated and linked; no "exempt themselves"', () => {
    assert.ok(md.includes(`$1,000,000`));
    assert.ok(md.includes(`[KRS 227A.060(1)(c)](${LRC(55092)})`));
    assert.doesNotMatch(md, /exempt themselves/);
  });
});

describe('same-class stop-work wording (B6)', () => {
  for (const f of ['commercial-insurance-checklist-new-business', 'mt-washington-business-insurance']) {
    test(`${f}: the court order (KRS 342.402) replaces "stop-work orders"`, () => {
      const md = read(`src/blog/${f}.md`);
      assert.doesNotMatch(md, /stop-work/i);
      assert.ok(md.includes(`[KRS 342.402](${LRC(32497)})`));
    });
  }
});

describe('after-accident page PIP weekly cap (B5)', () => {
  const html = read('src/pages/blog/after-car-accident-kentucky.html');
  test('every "$200 per week" carries the before-2026-07-15 qualifier, and $500 is stated', () => {
    const qualified = 'up to $500 per week for policies issued or renewed on or after July 15, 2026; $200 per week before that';
    const all = html.match(/\$200 per week/g) || [];
    const ok = html.split(qualified).length - 1;
    assert.equal(ok, 3, 'body, visible FAQ and FAQPage JSON-LD');
    assert.equal(all.length, ok, 'no unqualified $200 per week');
    assert.doesNotMatch(html, /up to \$200 per week\)/);
  });
  test('no new copy says "reject PIP" (content D3)', () => {
    assert.doesNotMatch(html, /reject PIP/i);
  });
});

describe('no new "reject PIP" or "felony" in any corrected post', () => {
  for (const f of ['workers-comp-requirements-kentucky-2026', 'insurance-checklist-hvac-contractors', 'insurance-guide-electrical-contractors', 'commercial-insurance-checklist-new-business', 'mt-washington-business-insurance']) {
    test(f, () => {
      const md = read(`src/blog/${f}.md`);
      assert.doesNotMatch(md, /reject PIP/i);
      assert.doesNotMatch(md, /felon/i);
    });
  }
});
