/**
 * Kentucky blocks, Kentucky titles and line-hub intros (CONT-01, CONT-02).
 *
 * data/ky-blocks.json holds drafts that render nothing until the owner gate is
 * approved and a licensed reviewer has signed the entry. These tests check the
 * file against its rules, prove that the drafts render nothing today, and prove
 * the gate opens only with both signatures.
 *
 * Pages are rendered in-process from the real data and generators; nothing here
 * runs scripts/build.js or reads build/.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const ky = require('../scripts/lib/ky-blocks');
const pages = require('../scripts/builders/pages');
const shared = require('../scripts/shared-templates');

const data = load('ky-blocks.json');
const products = load('products.json');
const team = load('team.json');
const locations = load('locations.json');
const office = locations.offices[0];
const reviews = { rating: locations.agency.google_rating, count: locations.agency.google_review_count };
let richContent = {};
for (const f of ['content-personal.json', 'content-commercial.json', 'content-life.json', 'content-health.json']) {
  if (fs.existsSync(path.join(DATA, f))) Object.assign(richContent, load(f));
}

const LINES = ['personal', 'commercial', 'life', 'health'];
const allProducts = LINES.flatMap((l) => (products[l] || []).map((p) => ({ ...p, line: l })));
const byUrl = (url) => allProducts.find((p) => p.url === url);
const vctx = {
  pages: new Set(allProducts.map((p) => p.url)),
  hubs: new Set(['/personal/', '/commercial/', '/life/', '/health/']),
  teamSlugs: new Set(team.team.map((m) => m.slug)),
  today: '2026-10-03',
};
const WAVE1 = ['/personal/home', '/personal/auto', '/personal/renters', '/personal/umbrella', '/personal/motorcycle', '/personal/boat',
  '/personal/flood', '/commercial/general-liability', '/commercial/commercial-property', '/commercial/commercial-auto',
  '/commercial/workers-compensation', '/commercial/bonds', '/life/term-life'];

function makeCtx(kyData) {
  return {
    products, office, agency: locations.agency, team, knowledgeBase: load('knowledge-base.json'), carriers: load('carriers.json'),
    testimonials: load('testimonials.json'), testimonialsBlocklist: { blocked: [] }, reviews, richContent,
    landingData: load('landing-pages.json'), internalLinks: load('internal-links.json'), seoData: load('seo.json'),
    publishedBlog: new Set(), kyBlocks: kyData,
    renderNav: shared.renderNav, renderFooter: () => shared.renderFooter(office, reviews), renderScripts: shared.renderScripts,
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const product = (url, kyData) => {
  const p = byUrl(url);
  return pages.generateProductPage(p, 'Line', p.line, p.line, makeCtx(kyData));
};
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)[1];
const h1Of = (html) => /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1].trim();
const SIGNOFF = 'https://github.com/moonlightbbq/thewayagency-site/pull/84#issuecomment-1';
const sign = (e, reviewer = 'audrey-lillpop') => Object.assign(e, { reviewer, reviewed_on: '2026-10-03', signoff_ref: SIGNOFF });
// Synthetic registry rows for tests only; the committed registry is empty until signing.
const register = (d, slug, lines, until = '2027-09-30') => {
  d.reviewers = d.reviewers || {};
  d.reviewers[slug] = { lines, license_verified_on: '2026-10-03', license_valid_until: until, verified_by: 'Zz Privacycheck' };
  return d;
};
const registered = (o) => register(register(clone(o), 'audrey-lillpop', ['P&C', 'Life']), 'jill-boone', ['P&C', 'Life', 'Health']);
const approve = (d, gate) => Object.assign(d.owner_gates[gate], { approved_by: 'Zz Privacycheck', approved_on: '2026-10-03' });

describe('data/ky-blocks.json', () => {
  test('passes its own validation', () => {
    assert.deepEqual(ky.validate(data, vctx), []);
  });

  test('every committed signature is complete and by a registered reviewer licensed for its line (no test edit needed to sign)', () => {
    const entries = [
      ...data.statements.map((e) => [e, e.page]), ...data.titles.map((e) => [e, e.page]),
      ...data.hubs.flatMap((h) => [[h, h.hub], ...(h.intro || []).map((e) => [e, h.hub])]),
    ];
    for (const [e, where] of entries) {
      if (!e.reviewer) { assert.equal(e.reviewed_on, null, where); continue; }
      assert.ok(ky.signed(e, data, where, ky.HUB_ALLOWED_REVIEWERS[where]), `${where}: signature is not by a registered, licensed reviewer with a signoff_ref`);
    }
  });

  test('the /health/ hub needs the health_hub owner gate (TRUST-01, Branch B) and is pinned to sheilia-royal or jill-boone', () => {
    assert.ok(data.owner_gates.health_hub, 'owner_gates.health_hub exists');
    assert.match(data.owner_gates.health_hub.decision, /TRUST-01/);
    assert.deepEqual(ky.HUB_EXTRA_GATES['/health/'], ['health_hub']);
    assert.deepEqual(ky.HUB_ALLOWED_REVIEWERS['/health/'], ['sheilia-royal', 'jill-boone']);
  });

  test('drafts a Kentucky title for each of the 13 wave-1 pages', () => {
    assert.deepEqual(data.titles.map((t) => t.page).sort(), [...WAVE1].sort());
  });

  test('every statement cites a Kentucky statute on apps.legislature.ky.gov with a section number', () => {
    for (const s of data.statements) {
      assert.match(s.source_url, /^https:\/\/apps\.legislature\.ky\.gov\/law\/statutes\/statute\.aspx\?id=\d+$/, s.id);
      assert.match(s.cite, /^KRS \d+[A-Z]?\.\d/, s.id);
    }
  });

  test('says nothing about Medicare and nothing on the flood page (no Kentucky flood rule sourced)', () => {
    assert.ok(!JSON.stringify(data).match(/medicare/i));
    assert.ok(!data.statements.some((s) => s.page === '/personal/flood'));
  });
});

describe('render gate', () => {
  test('pages with no signed entry render nothing: no Kentucky block, titles and H1s unchanged', () => {
    for (const url of WAVE1) {
      if (ky.signedStatements(data, url).length || data.titles.some((t) => t.page === url && t.reviewer)) continue;
      const html = product(url, data);
      const p = byUrl(url);
      assert.doesNotMatch(html, /If you live in Kentucky/, url);
      assert.equal(titleOf(html), p.title_tag, url);
      assert.equal(h1Of(html), p.h1 || p.name, url);
    }
  });

  test('a signed statement does not render while the owner gate is closed', () => {
    const d = registered(data);
    d.statements.filter((s) => s.page === '/personal/auto').forEach((e) => sign(e));
    d.titles.filter((t) => t.page === '/personal/auto').forEach((e) => sign(e));
    const html = product('/personal/auto', d);
    assert.doesNotMatch(html, /If you live in Kentucky/);
    assert.equal(titleOf(html), byUrl('/personal/auto').title_tag);
  });

  test('an approved gate renders nothing unsigned', () => {
    const d = registered(data);
    approve(d, 'product_blocks');
    const html = product('/personal/auto', d);
    assert.doesNotMatch(html, /If you live in Kentucky/);
    assert.equal(titleOf(html), byUrl('/personal/auto').title_tag);
  });

  test('approved gate plus signatures render only the signed statements, with link and as-of date', () => {
    const d = registered(data);
    approve(d, 'product_blocks');
    sign(d.statements.find((s) => s.id === 'auto-2'));
    sign(d.titles.find((t) => t.page === '/personal/auto'));
    const html = product('/personal/auto', d);
    assert.match(html, /<h2 id="ky-block-h">If you live in Kentucky<\/h2>/);
    assert.match(html, /href="https:\/\/apps\.legislature\.ky\.gov\/law\/statutes\/statute\.aspx\?id=46758" rel="noopener">KRS 304\.39-110\(1\)\(a\)<\/a>; text as of October 3, 2026/);
    assert.doesNotMatch(html, /KRS 304\.39-080\(5\)/, 'unsigned auto-1 must not render');
    assert.equal(titleOf(html), 'Kentucky Auto Insurance Quotes &amp; Coverage | The Way Agency');
    assert.equal(h1Of(html), 'What auto insurance do you need in Kentucky?');
    const block = /<section class="ky-block"[\s\S]*?<\/section>/.exec(html)[0];
    assert.doesNotMatch(block, /Reviewed by|audrey|lillpop/i, 'the reviewer is never printed');
    assert.doesNotMatch(html, /Reviewed by/);
    // The block sits right after the direct answer.
    assert.ok(html.indexOf('ky-block-h') < html.indexOf('We\'re not just selling insurance'));
  });

  test('a signed Kentucky H1 waits for at least one signed statement on the page', () => {
    const d = registered(data);
    approve(d, 'product_blocks');
    sign(d.titles.find((t) => t.page === '/personal/auto'));
    const html = product('/personal/auto', d);
    assert.equal(titleOf(html), 'Kentucky Auto Insurance Quotes &amp; Coverage | The Way Agency');
    assert.equal(h1Of(html), byUrl('/personal/auto').h1);
  });
});

describe('reviewer licence gate (review M3)', () => {
  const autoSigned = (d) => { approve(d, 'product_blocks'); return d; };
  test('a reviewer not in the registry, without the line, past licence validity, or with no signoff_ref renders nothing', () => {
    let d = autoSigned(clone(data));
    sign(d.statements.find((s) => s.id === 'auto-2'));
    assert.doesNotMatch(product('/personal/auto', d), /If you live in Kentucky/, 'unregistered reviewer');
    d = autoSigned(register(clone(data), 'audrey-lillpop', ['Life']));
    sign(d.statements.find((s) => s.id === 'auto-2'));
    assert.doesNotMatch(product('/personal/auto', d), /If you live in Kentucky/, 'no P&C line');
    d = autoSigned(register(clone(data), 'audrey-lillpop', ['P&C'], '2026-10-01'));
    sign(d.statements.find((s) => s.id === 'auto-2'));
    assert.doesNotMatch(product('/personal/auto', d), /If you live in Kentucky/, 'licence expired before review');
    d = autoSigned(registered(data));
    sign(d.statements.find((s) => s.id === 'auto-2')).signoff_ref = null;
    assert.doesNotMatch(product('/personal/auto', d), /If you live in Kentucky/, 'no signoff_ref');
    d = autoSigned(registered(data));
    sign(d.statements.find((s) => s.id === 'auto-2'));
    assert.match(product('/personal/auto', d), /If you live in Kentucky/, 'control: qualified reviewer renders');
  });
  test('validation names each problem', () => {
    const v = (d) => ky.validate(d, vctx).join('\n');
    let d = clone(data); sign(d.statements[0]);
    assert.match(v(d), /not in reviewers with a verified P&C licence/);
    d = registered(data); sign(d.statements[0]).signoff_ref = null;
    assert.match(v(d), /needs signoff_ref/);
    d = registered(data); d.reviewers['audrey-lillpop'].license_verified_on = null;
    assert.match(v(d), /license_verified_on/);
    d = registered(data); d.reviewers.nobody = d.reviewers['jill-boone'];
    assert.match(v(d), /reviewers\.nobody: not a data\/team\.json slug/);
    d = registered(data); delete d.owner_gates.health_hub;
    assert.match(v(d), /owner_gates\.health_hub: missing/);
    d = registered(data); sign(d.hubs.find((h) => h.hub === '/health/'), 'audrey-lillpop');
    assert.match(v(d), /\/health\/ may be signed only by sheilia-royal or jill-boone/);
  });
});

describe('validation catches', () => {
  const bad = (mutate) => { const d = clone(data); mutate(d); return ky.validate(d, vctx).join('\n'); };
  test('an em dash, a non-primary source, a half signature, an unknown reviewer, a future date', () => {
    assert.match(bad((d) => { d.statements[0].statement += ' — x'; }), /em dash/);
    assert.match(bad((d) => { d.statements[0].source_url = 'https://example.com/krs'; }), /not a primary-source host/);
    assert.match(bad((d) => { d.statements[0].reviewer = 'audrey-lillpop'; }), /set together/);
    assert.match(bad((d) => { Object.assign(d.statements[0], { reviewer: 'nobody', reviewed_on: '2026-10-01' }); }), /not a data\/team\.json slug/);
    assert.match(bad((d) => { Object.assign(d.statements[0], { reviewer: 'jill-boone', reviewed_on: '2027-01-01' }); }), /not a past/);
  });
  test('"free" on a life page, a long or non-Kentucky title, a Kentucky H1 with no statement, Medicare copy', () => {
    assert.match(bad((d) => { d.statements.find((s) => s.page === '/life/term-life').statement += ' It is free to return.'; }), /"free"/);
    assert.match(bad((d) => { d.titles[0].title = 'Kentucky ' + 'x'.repeat(60); }), /max 60/);
    assert.match(bad((d) => { d.titles[0].title = 'Home Insurance | The Way Agency'; }), /must contain "Kentucky"/);
    assert.match(bad((d) => { d.titles.find((t) => t.page === '/personal/flood').h1 = 'Is flood insurance required in Kentucky?'; }), /needs a Kentucky statement/);
    assert.match(bad((d) => { d.statements[0].statement += ' Medicare too.'; }), /Medicare/);
  });
});

describe('line hubs (CONT-02)', () => {
  const hub = (key, kyData) => pages.generateHubPage(key, makeCtx(kyData));
  const signHub = (d, canonical) => { const h = d.hubs.find((x) => x.hub === canonical); sign(h); h.intro.forEach((s) => sign(s)); return h; };

  test('drafts an H1 and intro for each of the four line hubs', () => {
    assert.deepEqual(data.hubs.map((h) => h.hub).sort(), ['/commercial/', '/health/', '/life/', '/personal/']);
    for (const h of data.hubs) assert.match(h.h1, /^(Personal|Business|Life|Health) insurance in Kentucky$/);
  });

  test('today the hubs keep their tagline H1s and show no intro', () => {
    for (const key of ['personal', 'commercial', 'life', 'health']) {
      const html = hub(key, data);
      assert.doesNotMatch(html, /class="hub-intro"/, key);
      assert.equal(h1Of(html), pages.hubConfig[key].hero.title, key);
    }
  });

  test('the /health/ intro names kynect for marketplace plans, Medicaid and KCHIP only, and says nothing about Medicare', () => {
    const h = data.hubs.find((x) => x.hub === '/health/');
    const text = h.intro.map((s) => s.text).join(' ');
    assert.match(text, /The Kentucky Health Benefit Exchange \(kynect\) helps Kentuckians enroll in Qualified Health Plans or Medicaid, and people who qualify can enroll in Medicaid or KCHIP at any time of year\./);
    assert.doesNotMatch(text, /licensed agent will contact you/i, 'no unattributed contact promise (review M6)');
    assert.doesNotMatch(JSON.stringify(h), /medicare/i);
    assert.doesNotMatch(text, /\bfree\b|we compare/i);
  });

  test('/health/ stays hidden until the health_hub gate opens, and refuses a reviewer outside the pin', () => {
    const d = registered(data);
    approve(d, 'line_hubs');
    signHub(d, '/health/');
    assert.doesNotMatch(hub('health', d), /class="hub-intro"/, 'health_hub gate closed');
    const e = registered(data);
    approve(e, 'line_hubs'); approve(e, 'health_hub');
    register(e, 'audrey-lillpop', ['P&C', 'Life', 'Health']);
    const h = e.hubs.find((x) => x.hub === '/health/'); sign(h); h.intro.forEach((s) => sign(s));
    assert.doesNotMatch(hub('health', e), /class="hub-intro"/, 'reviewer outside the /health/ pin');
  });

  test('signed and approved, a hub renders the Kentucky H1, the tagline as subtitle and the intro with its source link', () => {
    const d = registered(data);
    approve(d, 'line_hubs');
    approve(d, 'health_hub');
    const hh = d.hubs.find((x) => x.hub === '/health/'); sign(hh, 'jill-boone'); hh.intro.forEach((s) => sign(s, 'jill-boone'));
    const html = hub('health', d);
    assert.equal(h1Of(html), 'Health insurance in Kentucky');
    assert.match(html, /Coverage built around your care/);
    assert.match(html, /class="hub-intro"[^>]*>Health insurance helps pay/);
    assert.match(html, /href="https:\/\/khbe\.ky\.gov\/Pages\/index\.aspx" rel="noopener">Kentucky Health Benefit Exchange \(kynect\)<\/a>/);
    assert.ok(html.indexOf('hub-intro') < html.indexOf('Health insurance options'), 'intro sits above the cards');
  });

  test('one unsigned intro sentence, or a closed owner gate, keeps the whole hub draft hidden', () => {
    const d = registered(data);
    approve(d, 'line_hubs');
    signHub(d, '/personal/').intro[2].reviewer = null;
    d.hubs.find((x) => x.hub === '/personal/').intro[2].reviewed_on = null;
    assert.doesNotMatch(hub('personal', d), /class="hub-intro"/);
    const e = registered(data);
    signHub(e, '/personal/');
    assert.doesNotMatch(hub('personal', e), /class="hub-intro"/);
    const f = registered(data);
    approve(f, 'line_hubs');
    signHub(f, '/personal/');
    assert.match(hub('personal', f), /class="hub-intro"/, 'control: fully signed /personal/ renders');
  });

  test('validation keeps kynect off the non-health hubs', () => {
    const d = clone(data);
    d.hubs.find((x) => x.hub === '/personal/').intro[0].text = 'Use kynect for this.';
    assert.match(ky.validate(d, vctx).join('\n'), /kynect belongs on \/health\/ only/);
  });
});
