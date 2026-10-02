/**
 * scripts/check-health-compliance.js (specs/medicare-health-compliance.md 3.17
 * and section 4): every rule fails a fixture page, in visible text and
 * separately in JSON-LD; a clean page passes; the data scan covers copy no
 * page renders; and scripts/build.js runs the guard.
 *
 * Fixtures are written to a temp directory, never to build/.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkHealthCompliance, scanText, visibleText } = require('../scripts/check-health-compliance');

const ROOT = path.join(__dirname, '..');
const SITE_TPMO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'medicare-tpmo.json'), 'utf8'));
const activeA = () => {
  const t = JSON.parse(JSON.stringify(SITE_TPMO));
  Object.assign(t, { status: 'active', branch: 'A', variant: 'not_all', as_of: '2026-10-07', signed_record: 'compliance-log TEST #1' });
  t.areas.KY.counties['Daviess County'] = { organizations: 3, products: 12 };
  return t;
};

function page({ body = '<p>SYNTHETIC page.</p>', ld = null } = {}) {
  return `<!DOCTYPE html><html><head><title>SYNTHETIC</title><meta name="description" content="SYNTHETIC">${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}</head><body><main>${body}</main></body></html>`;
}
const faqLd = (text) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'SYNTHETIC?', acceptedAnswer: { '@type': 'Answer', text } }] });

/** Build a temp site from { 'path/file.html': html } and run the guard. */
function run(files, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-guard-'));
  try {
    for (const [rel, html] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), html);
    }
    return checkHealthCompliance(dir, { tpmo: SITE_TPMO, today: new Date('2026-10-02T12:00:00Z'), ...opts });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const ids = (r) => r.problems.map((p) => p.split(' ')[0]);

// Copy rules: the violating sentence, checked in visible text and in JSON-LD.
const COPY_RULES = {
  'P-1': 'Part B costs approximately $185/month in 2026.',
  'P-2': 'Original Medicare has a Part A deductible of around $1,632 per benefit period.',
  'P-3': 'In 2026 the law caps annual out-of-pocket drug spending at $2,000 for Medicare Part D enrollees.',
  'P-4': 'That is approximately $20,783 for an individual in 2026.',
  'P-5': 'HSA contribution limits are $4,300 individual and $8,550 family.',
  'P-6': 'Preferred Risk Policies for low-risk zones can cost as little as $300 per year.',
  'P-7': 'Enhanced subsidies currently extend assistance to higher earners.',
  'P-8': 'We help clients compare all available plans during Annual Enrollment.',
  'P-9': "Kentucky's kynect program offers free assistance to Medicare beneficiaries.",
  'P-10': 'Every state has a guaranty association that protects annuity owners.',
  'P-11': 'With a 0% floor you cannot lose money to market declines.',
  'P-11b': 'The guaranteed cash value growth rate is typically 2 to 4 percent.',
  'P-15': 'Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program to get information. 1-800-MEDICARE is available 24 hours a day, 7 days a week.',
  'P-20': 'Open enrollment: {{fact:not_a_fact}}',
};

describe('health compliance guard: each rule fails a fixture', () => {
  for (const [rule, sentence] of Object.entries(COPY_RULES)) {
    test(`${rule} in visible text and in JSON-LD`, () => {
      assert.ok(ids(run({ 'x/visible.html': page({ body: `<p>${sentence}</p>` }) })).includes(rule), `${rule} visible`);
      assert.ok(ids(run({ 'x/ld.html': page({ ld: faqLd(sentence) }) })).includes(rule), `${rule} JSON-LD`);
    });
  }

  test('P-12: a comparison claim needs the statement (active A), fails outright (A1, C, not_applicable), must name the partner (B), and only warns while pending', () => {
    const claim = page({ body: '<p>When we compare Medicare Advantage and Medicare Supplement plans, we focus on your doctors.</p>' });
    assert.ok(ids(run({ 'insurance/x.html': claim }, { tpmo: activeA() })).includes('P-12'));
    const withStmt = page({ body: '<p>When we compare Medicare Advantage plans, we focus on your doctors.</p><aside class="tpmo-disclaimer"><p>Currently we represent 3 organizations which offer 12 products in your area.</p></aside>' });
    assert.ok(!ids(run({ 'insurance/x.html': withStmt }, { tpmo: activeA() })).includes('P-12'));
    for (const patch of [{ branch: 'A1' }, { branch: 'C' }, { status: 'not_applicable' }]) {
      assert.ok(ids(run({ 'insurance/x.html': claim }, { tpmo: Object.assign(activeA(), patch) })).includes('P-12'), JSON.stringify(patch));
    }
    const b = Object.assign(activeA(), { branch: 'B' });
    b.lead_disclosure.partner_consent = { entity: 'Test Partner Agency LLC', text_version: 'test-v1' };
    assert.ok(ids(run({ 'insurance/x.html': claim }, { tpmo: b })).includes('P-12'));
    const named = page({ body: '<p>Test Partner Agency LLC, a separate agency, can help you compare Medicare Advantage plans, and we refer you to them.</p>' });
    assert.ok(!ids(run({ 'insurance/x.html': named }, { tpmo: b })).includes('P-12'));
    const pending = run({ 'insurance/x.html': claim });
    assert.ok(!ids(pending).includes('P-12'));
    assert.ok(pending.warnings.some((w) => w.startsWith('P-12 ')));
    assert.ok(ids(run({ 'insurance/x.html': page({ body: '<p>We can show you Medicare Advantage options and Part D plans side by side.</p>' }) }, { tpmo: activeA() })).includes('P-12'));
  });

  test('P-13: 1-800-MEDICARE or the SHIP hotline as a tel: link', () => {
    const hours = '<p>1-800-MEDICARE (TTY 1-877-486-2048) is available 24 hours a day, 7 days a week.</p>';
    assert.ok(ids(run({ 'x.html': page({ body: `<a href="tel:18006334227">1-800-MEDICARE</a>${hours}` }) })).includes('P-13'));
    assert.ok(ids(run({ 'x.html': page({ body: '<a href="tel:+18772937447">(877) 293-7447</a>' }) })).includes('P-13'));
    assert.ok(!ids(run({ 'x.html': page({ body: `<a href="tel:+15024135335">(502) 413-5335</a> <a href="sms:+15024135335">Text</a>${hours}` }) })).includes('P-13'), 'the agency number is fine');
  });

  test('P-14: 1-800-MEDICARE without its hours', () => {
    assert.ok(ids(run({ 'x.html': page({ body: '<p>Call 1-800-MEDICARE for help.</p>' }) })).includes('P-14'));
    assert.ok(!ids(run({ 'x.html': page({ body: '<p>Call 1-800-MEDICARE for help. 1-800-MEDICARE (TTY 1-877-486-2048) is available 24 hours a day, 7 days a week.</p>' }) })).includes('P-14'));
  });

  test('P-16: a placeholder inside the statement block', () => {
    const html = page({ body: '<aside class="tpmo-disclaimer" role="note"><p>Currently we represent [insert number of organizations] organizations.</p><p>1-800-MEDICARE (TTY 1-877-486-2048) is available 24 hours a day, 7 days a week.</p></aside>' });
    assert.ok(ids(run({ 'x.html': html })).includes('P-16'));
  });

  test('P-17: an active record with problems fails; the pending site record does not', () => {
    const bad = Object.assign(activeA(), { signed_record: null });
    assert.ok(ids(run({ 'x.html': page() }, { tpmo: bad })).includes('P-17'));
    assert.ok(!ids(run({ 'x.html': page() })).includes('P-17'));
  });

  test('P-18: an undated "January 15" on a health page fails; a dated one and other sections pass', () => {
    assert.ok(ids(run({ 'health/x.html': page({ body: '<p>Open enrollment runs from November 1 through January 15.</p>' }) })).includes('P-18'));
    assert.ok(!ids(run({ 'health/x.html': page({ body: '<p>As of October 2026, open enrollment runs November 1, 2026 to January 15, 2027.</p>' }) })).includes('P-18'));
    assert.ok(!ids(run({ 'blog/x.html': page({ body: '<p>From November 1 through January 15.</p>' }) })).includes('P-18'));
  });

  test('P-19 is a warning in Phase 1', () => {
    const r = run({ 'x.html': page({ body: '<p>We never sell your data.</p>' }) });
    assert.ok(!ids(r).includes('P-19'));
    assert.ok(r.warnings.some((w) => w.startsWith('P-19 ')));
  });

  test('llms.txt and llms-full.txt are scanned as plain text', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-guard-llms-'));
    try {
      fs.writeFileSync(path.join(dir, 'llms-full.txt'), '# SYNTHETIC\n\nWe help clients compare all available plans.\n');
      const r = checkHealthCompliance(dir, { tpmo: SITE_TPMO });
      assert.ok(r.problems.some((p) => p.startsWith('P-8 llms-full.txt')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('health compliance guard: clean copy passes', () => {
  test('current figures, dated dates, the hours sentence and unrelated percentages raise nothing', () => {
    const body = [
      '<p>In 2026 the standard Part B premium is $202.90 a month. Original Medicare also has a Part A hospital deductible of $1,736 and a Part B deductible of $283 a year in 2026.</p>',
      '<p>Out-of-pocket costs for covered Part D drugs are capped at $2,100 in 2026 and $2,400 in 2027.</p>',
      '<p>As of October 2026, open enrollment for 2027 coverage runs November 1, 2026 to January 15, 2027.</p>',
      '<p>1-800-MEDICARE (TTY 1-877-486-2048) is available 24 hours a day, 7 days a week.</p>',
      '<p>Disability insurance replaces a portion of your income, typically 50 to 70 percent.</p>',
      '<p>Annuity guarantees depend on the financial strength and claims-paying ability of the issuing insurance company.</p>',
      '<p>A licensed agent can review your Medicare options with you. <a href="tel:+15024135335">Call</a> <a href="sms:+15024135335">Text</a></p>',
    ].join('');
    const r = run({ 'health/medicare.html': page({ body, ld: faqLd('Out-of-pocket costs for covered Part D drugs are capped at $2,100 in 2026 and $2,400 in 2027.') }) });
    assert.deepEqual(r.problems, []);
  });

  test('visible text keeps block boundaries, so a rule cannot match across two paragraphs', () => {
    assert.equal(visibleText('<p>One &amp; two</p><p>three</p>'), 'One & two\nthree');
    const r = run({ 'x.html': page({ body: '<p>Medicare out-of-pocket</p><ul><li>Part D</li></ul><p>$2,000</p>' }) });
    assert.ok(!ids(r).includes('P-3'));
  });
});

describe('health compliance guard: data and wiring', () => {
  test('scanText flags "$185/month in 2026" in a fixture knowledge-base entry', () => {
    const r = scanText('Part B costs $185/month in 2026 for most enrollees.', { file: 'fixture knowledge-base' });
    assert.ok(r.problems.some((p) => p.startsWith('P-1 ')));
  });

  test('the repo data (content-*.json and knowledge-base.json) has no problem', () => {
    const problems = [];
    const visit = (v, where) => {
      if (typeof v === 'string') problems.push(...scanText(v, { file: where, tpmo: SITE_TPMO }).problems);
      else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${where}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, `${where}.${k}`);
    };
    for (const f of fs.readdirSync(path.join(ROOT, 'data')).filter((n) => /^content-.*\.json$/.test(n) || n === 'knowledge-base.json')) {
      visit(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')), f);
    }
    assert.deepEqual(problems, []);
  });

  test('scripts/build.js runs the guard after the legal-page guard and fails the build on a problem', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
    const legal = src.indexOf('checkLegalPages(BUILD)');
    const guard = src.indexOf('checkHealthCompliance(BUILD, { tpmo })');
    assert.ok(legal > 0 && guard > legal, 'step 11c after step 11');
    assert.match(src.slice(guard, guard + 600), /throw new Error\(`Health compliance guard failed/);
  });
});
