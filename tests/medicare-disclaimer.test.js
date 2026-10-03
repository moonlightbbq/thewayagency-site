/**
 * scripts/lib/medicare-disclaimer.js: the CMS TPMO statement and the
 * Medicare/health lead disclosure (TRUST-01; specs/medicare-health-compliance.md
 * 3.1, 3.2 and section 4).
 *
 * The counts in these fixtures (3 organizations, 12 products and so on) are test
 * data, never site data: the site's record (data/medicare-tpmo.json) is
 * pending_owner and renders no statement.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const M = require('../scripts/lib/medicare-disclaimer');

const ROOT = path.join(__dirname, '..');
const SITE_RECORD = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'medicare-tpmo.json'), 'utf8'));

/** An active Branch A record with Daviess counts, Indiana uniform statewide. */
function active(patch = {}) {
  const base = JSON.parse(JSON.stringify(SITE_RECORD));
  Object.assign(base, {
    status: 'active', branch: 'A', variant: 'not_all', plan_year: 2027, as_of: '2026-10-07',
    signed_record: 'compliance-log TEST #1',
  });
  base.areas.KY.counties['Daviess County'] = { organizations: 3, products: 12 };
  base.areas.IN.uniform_statewide = true;
  base.areas.IN.statewide = { organizations: 4, products: 20 };
  return Object.assign(base, patch);
}
const OCT2 = new Date('2026-10-02T12:00:00Z');

const NOT_ALL_3_12 = 'We do not offer every plan available in your area. Currently we represent 3 organizations which offer 12 products in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.';
const ALL_3_12 = 'Currently we represent 3 organizations which offer 12 products in your area. You can always contact Medicare.gov or 1-800-MEDICARE for help with plan choices.';

describe('TPMO statement text (42 CFR 422.2267(e)(41), CY2027)', () => {
  test('the not-all and all variants are the exact standardized sentences', () => {
    assert.equal(M.NOT_ALL(3, 12), NOT_ALL_3_12);
    assert.equal(M.ALL(3, 12), ALL_3_12);
    assert.equal(M.statementText(active(), { organizations: 3, products: 12 }), NOT_ALL_3_12);
    assert.equal(M.statementText(active({ variant: 'all' }), { organizations: 3, products: 12 }), ALL_3_12);
  });

  test('no output carries the retired SHIP wording', () => {
    const outs = [M.NOT_ALL(3, 12), M.ALL(3, 12), M.MEDICARE_HOURS,
      M.renderTpmoForAreas(active()), M.renderTpmoForAreas(active({ variant: 'all' }))];
    for (const o of outs) {
      assert.ok(!o.includes('State Health Insurance Program'), o);
      assert.ok(!o.includes(M.RETIRED_FRAGMENT), o);
    }
  });

  test('the hours sentence follows every statement, and nothing is a tel: link', () => {
    const html = M.renderTpmoForAreas(active());
    const blocks = html.split('</aside>').filter((b) => b.includes('<aside'));
    assert.equal(blocks.length, 2, 'Daviess and the uniform Indiana statewide entry render; Bullitt has no counts');
    for (const b of blocks) {
      assert.ok(b.indexOf('Currently we represent') < b.indexOf(M.MEDICARE_HOURS), 'hours after the statement');
    }
    assert.ok(!/href="tel:/i.test(html), 'no tel: link');
    assert.match(html, /<a href="https:\/\/www\.medicare\.gov\/"[^>]*>Medicare\.gov<\/a>/);
    assert.ok(html.includes('1-800-MEDICARE to get information'), '1-800-MEDICARE stays plain text');
  });

  test('only the first rendered block carries id="tpmo-disclaimer", and withId:false prints none', () => {
    const html = M.renderTpmoForAreas(active());
    assert.equal((html.match(/id="tpmo-disclaimer"/g) || []).length, 1);
    assert.equal((M.renderTpmoForAreas(active(), undefined, { withId: false }).match(/id="/g) || []).length, 0);
    assert.ok(html.includes('<strong>Kentucky, Daviess County:</strong>'));
    assert.ok(html.includes('<strong>Indiana:</strong>'));
  });

  test('status and branch gate the render: pending_owner, not_applicable, B and C print nothing', () => {
    for (const patch of [{ status: 'pending_owner' }, { status: 'not_applicable' }, { branch: 'B' }, { branch: 'C' }, { branch: 'A1' }]) {
      assert.equal(M.renderTpmoForAreas(active(patch)), '', JSON.stringify(patch));
      assert.equal(M.renderTpmoBlock(active(patch), { state: 'KY', county: 'Daviess County' }), '', JSON.stringify(patch));
    }
    assert.ok(M.renderTpmoForAreas(active({ branch: 'mixed' })).includes('Currently we represent'));
    assert.equal(M.renderTpmoForAreas(SITE_RECORD), '', 'the site record renders nothing');
  });

  test('statementText refuses missing or unusable counts', () => {
    assert.throws(() => M.statementText(active(), null));
    assert.throws(() => M.statementText(active(), { organizations: 1, products: 4 }));
  });
});

describe('tpmoProblems (validation)', () => {
  test('the site record is valid as pending_owner and lists no problem', () => {
    assert.deepEqual(M.tpmoProblems(SITE_RECORD, OCT2), []);
    assert.equal(SITE_RECORD.status, 'pending_owner');
    assert.deepEqual(SITE_RECORD.lead_disclosure.contact_entities, [], 'Phase 1 names no agency');
  });

  test('a complete active fixture has no problem', () => {
    assert.deepEqual(M.tpmoProblems(active(), OCT2), []);
  });

  test('placeholders, non-integers, organizations < 2, products < organizations and a missing signed_record each produce a problem', () => {
    const cases = {
      placeholder: (d) => { d.areas.KY.counties['Daviess County'] = { organizations: '[insert number]', products: 12 }; },
      'placeholder label': (d) => { d.lead_disclosure.medicare_products_label = '[products from D-1]'; },
      'non-integer': (d) => { d.areas.KY.counties['Daviess County'] = { organizations: 2.5, products: 12 }; },
      'one organization': (d) => { d.areas.KY.counties['Daviess County'] = { organizations: 1, products: 3 }; },
      'products below organizations': (d) => { d.areas.KY.counties['Daviess County'] = { organizations: 5, products: 4 }; },
      'missing signed_record': (d) => { d.signed_record = null; },
      'missing as_of': (d) => { d.as_of = 'October'; },
      'missing variant': (d) => { d.variant = null; },
    };
    for (const [name, mutate] of Object.entries(cases)) {
      const d = active();
      mutate(d);
      assert.ok(M.tpmoProblems(d, OCT2).length > 0, name);
    }
  });

  test('plan year: on 2026-10-02 plan_year 2026 is a problem and 2027 is not', () => {
    assert.ok(M.tpmoProblems(active({ plan_year: 2026 }), OCT2).some((p) => /plan_year/.test(p)));
    assert.ok(!M.tpmoProblems(active({ plan_year: 2027 }), OCT2).some((p) => /plan_year/.test(p)));
    // Before October 1 the current year is enough.
    assert.ok(!M.tpmoProblems(active({ plan_year: 2026 }), new Date('2026-09-30T12:00:00Z')).some((p) => /plan_year/.test(p)));
  });
});

describe('countsFor (lookup)', () => {
  test('county counts win; statewide only when uniform_statewide', () => {
    const d = active();
    d.areas.KY.statewide = { organizations: 9, products: 40 };
    assert.deepEqual(M.countsFor(d, 'KY', 'Daviess County'), { organizations: 3, products: 12 });
    assert.equal(M.countsFor(d, 'KY', 'Bullitt County'), null, 'KY is not uniform: no statewide fallback');
    d.areas.KY.uniform_statewide = true;
    assert.deepEqual(M.countsFor(d, 'KY', 'Bullitt County'), { organizations: 9, products: 40 });
    assert.deepEqual(M.countsFor(d, 'IN', 'Marion County'), { organizations: 4, products: 20 });
    assert.equal(M.countsFor(d, 'TN', 'Davidson County'), null);
  });
});

describe('leadDisclosureText (the only implementation of the form disclosure)', () => {
  const PHASE1 = {
    medicare: 'By continuing, you agree that the information you give us will be provided to a licensed insurance agent, who will contact you by phone, text or email about Medicare plans. This is a solicitation for insurance.',
    health: 'By continuing, you agree that the information you give us will be provided to a licensed insurance agent, who will contact you by phone, text or email about health insurance. This is a solicitation for insurance.',
    health_line: 'By continuing, you agree that the information you give us will be provided to a licensed insurance agent, who will contact you by phone, text or email about Medicare or other health insurance. This is a solicitation for insurance.',
  };
  const INLINE = {
    medicare: 'This form starts a quote request. Your information will be provided to a licensed insurance agent, who will contact you by phone, text or email about Medicare plans. This is a solicitation for insurance.',
    health: 'This form starts a quote request. Your information will be provided to a licensed insurance agent, who will contact you by phone, text or email about health insurance. This is a solicitation for insurance.',
  };

  test('Phase 1 default texts are exactly the spec 3.2 sentences, from the site record', () => {
    for (const [context, text] of Object.entries(PHASE1)) assert.equal(M.leadDisclosureText(SITE_RECORD, { context }), text, context);
    for (const [context, text] of Object.entries(INLINE)) assert.equal(M.leadDisclosureText(SITE_RECORD, { context, form: 'inline' }), text, context);
  });

  test('every text names a licensed insurance agent and says it is a solicitation for insurance', () => {
    for (const context of M.LEAD_CONTEXTS) {
      for (const form of [undefined, 'inline']) {
        const t = M.leadDisclosureText(SITE_RECORD, { context, form });
        assert.ok(t.includes('licensed insurance agent'), t);
        assert.ok(t.includes('This is a solicitation for insurance.'), t);
        assert.ok(!t.includes('The Way Agency'), 'Phase 1 names no agency');
      }
    }
  });

  test('Branch A names The Way Agency; Branch B names both entities; the label replaces "Medicare plans"', () => {
    const a = JSON.parse(JSON.stringify(SITE_RECORD));
    a.lead_disclosure.contact_entities = ['The Way Agency'];
    assert.equal(M.leadDisclosureText(a, { context: 'medicare' }),
      'By continuing, you agree that the information you give us will be provided to a licensed insurance agent with The Way Agency, who will contact you by phone, text or email about Medicare plans. This is a solicitation for insurance.');
    const b = JSON.parse(JSON.stringify(SITE_RECORD));
    b.lead_disclosure.contact_entities = ['The Way Agency', 'Test Partner Agency LLC'];
    b.lead_disclosure.medicare_products_label = 'Medicare Supplement (Medigap), Medicare Advantage or Part D plans';
    assert.equal(M.leadDisclosureText(b, { context: 'medicare', form: 'inline' }),
      'This form starts a quote request. Your information will be provided to a licensed insurance agent with The Way Agency or Test Partner Agency LLC, who will contact you by phone, text or email about Medicare Supplement (Medigap), Medicare Advantage or Part D plans. This is a solicitation for insurance.');
  });

  test('the TCPA sentence appears only with tcpa: true', () => {
    const t = JSON.parse(JSON.stringify(SITE_RECORD));
    assert.ok(!M.leadDisclosureText(t, { context: 'health' }).includes('not a condition of purchase'));
    t.lead_disclosure.tcpa = true;
    assert.ok(M.leadDisclosureText(t, { context: 'health' }).endsWith(` ${M.TCPA_SENTENCE}`));
  });

  test('no record (the intake before injection) falls back to the default text; an unknown context throws', () => {
    assert.equal(M.leadDisclosureText(null, { context: 'medicare' }), PHASE1.medicare);
    assert.throws(() => M.leadDisclosureText(SITE_RECORD, { context: 'auto' }));
  });
});

describe('isMedicarePost and publicTpmoData', () => {
  test('a medicare tag, slug or related_page marks a Medicare post', () => {
    assert.ok(M.isMedicarePost({ tags: 'medicare, open enrollment, kentucky', slug: 'x' }));
    assert.ok(M.isMedicarePost({ tags: ['louisville', 'Medicare'], slug: 'x' }));
    assert.ok(M.isMedicarePost({ slug: 'medicare-supplement-plans-kentucky' }));
    assert.ok(M.isMedicarePost({ slug: 'x', related_page: '/health/medicare.html' }));
    assert.ok(!M.isMedicarePost({ tags: 'flood insurance, kentucky', slug: 'homeowners-wont-cover-flooding', related_page: '/personal/flood.html' }));
  });

  test('publicTpmoData drops the internal fields', () => {
    const p = M.publicTpmoData(active());
    assert.ok(!('signed_record' in p) && !('_doc' in p) && !('branch' in p));
    assert.equal(p.status, 'active');
    assert.equal(M.publicTpmoData(null), null);
  });
});
