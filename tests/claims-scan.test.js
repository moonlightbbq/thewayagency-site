/**
 * Retracted claims stay retracted (claims-and-credentials spec, section 5, PR-1).
 *
 * The scanner's hard rules (scripts/lib/claims-scan.js) are unambiguous phrases
 * the site retracted: a 1998 founding or tenure figure, carrier counts, a
 * Medicare carrier count, an AARP endorsement, an automatic "Reviewed by" box,
 * storefront wording, the Tennessee licence overstatement, and claims-role
 * copy. Every rule is pinned with a phrase it must catch and honest text it
 * must leave alone; the real sources are then scanned.
 *
 * These tests read sources, fixtures in a temporary directory, and generator
 * output. They never run scripts/build.js or read build/: build-gate-wiring.test.js
 * builds in parallel, and a suite that reads build/ races it.
 */
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { RULES, scanText, scanSources, sourceFiles } = require('../scripts/lib/claims-scan');

const ROOT = path.join(__dirname, '..');

// Phrases a later release removes. A source finding passes only if it matches
// an entry here, no more often than `max`. Delete an entry when its release
// lands. An entry that no longer matches anything passes, so keeping or
// dropping a held commit never breaks this test.
const PENDING = [
  { rule: 'claims-role', file: 'scripts/builders/pages.js', match: 'push back on the carrier', max: 1, until: 'TRUST-13 industry-page copy, claims PR-5 (owner plus E&O or counsel)' },
  { rule: 'claims-role', file: 'scripts/builders/pages.js', match: 'We work for you, not the insurance company', max: 1, until: 'TRUST-13, claims PR-5' },
  { rule: 'claims-role', file: 'src/pages/about/claims.html', match: 'Before anything else', max: 1, until: 'TRUST-13 /about/claims copy, claims PR-5' },
  { rule: 'claims-role', file: 'src/pages/about/claims.html', match: 'a person picks up', max: 1, until: 'TRUST-13 / D12, claims PR-5' },
  { rule: 'claims-role', file: 'src/pages/about/index.html', match: 'handled fairly', max: 1, until: 'TRUST-13, claims PR-5' },
  { rule: 'claims-role', file: 'src/pages/about/index.html', match: 'lowball', max: 1, until: 'TRUST-13 / TRUST-15 case study, claims PR-5' },
  { rule: 'claims-role', file: 'src/pages/index.html', match: 'we fight for you', max: 1, until: 'TRUST-13 homepage card, claims PR-5' },
  { rule: 'office', file: 'src/intake.html', match: 'A local agent serving', max: 1, until: 'LOCAL-06 intake subtitle, held for owner decision D19' },
];

function hard(findings) { return findings.filter((f) => f.severity === 'hard'); }
function rulesHit(text, file) { return [...new Set(hard(scanText(text, file)).map((f) => f.rule))].sort(); }

describe('claims scan: every hard rule catches its retracted phrase', () => {
  const page = 'src/pages/index.html';
  const cases = [
    ['tenure-1998', 'Independent agency · Serving Davidson County since 1998', page],
    ['tenure-1998', 'an independent insurance agency, founded 1998, licensed in Kentucky', 'src/blog/example-post.md'],
    ['tenure-1998', 'The Way Agency is an independent insurance agency founded in 1998.', 'src/pages/terms.html'],
    ['tenure-duration', 'handled claims in Daviess County for more than twenty-five years', 'data/landing-pages.json'],
    ['tenure-duration', 'Licensed in KY, IN &amp; TN | 20 years experience | Last reviewed: March 2026', 'scripts/builders/pages.js'],
    ['carrier-count', 'Medicare from 40+ top-rated carriers.', 'data/landing-pages.json'],
    ['carrier-count', '<span class="trust-label">40+ Carriers</span>', 'src/portal.html'],
    ['carrier-count', 'font-weight:600;">30+</td>', 'src/pages/about/index.html'],
    ['carrier-count', 'font-weight:500;">Rated Carriers</p>', 'src/pages/about/index.html'],
    ['carrier-count', 'The Way Agency compares rates across a dozen carriers', 'data/content-life.json'],
    ['medicare-count', 'Home, auto, commercial, farm, Medicare from 40+ top-rated carriers.', 'data/landing-pages.json'],
    ['aarp', 'A leading small business insurer recommended by AARP', 'data/carriers.json'],
    ['review-credit', '<p>Reviewed by</p><p>Sheilia Royal</p>', 'scripts/builders/pages.js'],
    ['review-credit', 'Last reviewed: March 2026', 'src/pages/about/team.html'],
    ['office', '<h3>Owensboro Office</h3>', 'src/pages/contact.html'],
    ['office', 'whether they call, email, or stop by.', 'data/landing-pages.json'],
    ['office', 'just across the Ohio River from our office in Owensboro, Kentucky', 'src/blog/example-post.md'],
    ['office', 'Evansville is just across the river from our Owensboro office.', 'src/blog/example-post.md'],
    ['office', 'Visit us in Owensboro, KY.', 'data/seo.json'],
    ['office', 'Come by our walk-in office downtown.', page],
    ['office', "subtitle.textContent = 'A local agent serving ' + city;", 'src/intake.html'],
    ['licensing', 'Each agent is licensed in Kentucky, Indiana, and Tennessee.', 'src/pages/about/team.html'],
    ['licensing', 'Our agents are licensed across three states.', page],
    ['claims-role', 'Before anything else, give us a call.', 'src/pages/about/claims.html'],
    ['claims-role', 'When you need to file a claim, we fight for you.', page],
    ['claims-role', 'we help you navigate the claims process and push back on the carrier when needed.', 'scripts/builders/pages.js'],
  ];
  for (const [rule, text, file] of cases) {
    test(`${rule}: ${text.slice(0, 60)}`, () => {
      assert.ok(rulesHit(text, file).includes(rule), `${rule} did not catch: ${text}`);
    });
  }

  test('every rule has at least one positive case above', () => {
    const covered = new Set(cases.map((c) => c[0]));
    assert.deepEqual(RULES.map((r) => r.id).filter((id) => !covered.has(id)), []);
  });
});

describe('claims scan: honest text passes', () => {
  const cases = [
    ['a restaurant walk-in cooler', 'If your walk-in cooler fails overnight and you lose $5,000 in perishable inventory', 'src/blog/insurance-restaurants-food-service-kentucky.md'],
    ['a third-party founding year', 'Kentucky Farm Bureau has served the Bluegrass since 1943.', 'src/blog/example-post.md'],
    ['a job requirement on the careers pages', 'Lead our growing EB division. 10+ years experience.', 'src/pages/about/careers.html'],
    ['a job requirement on a careers sub-page', 'Requires 5 years experience in commercial lines.', 'src/pages/about/careers/pc-insurance-agent.html'],
    ['the mail-only statement', 'Mail only. We have no walk-in office; we work with clients by phone, text and email.', 'src/pages/contact.html'],
    ['the llms mailing label', '- Mailing address (mail only; no walk-in office): PO Box 187, Owensboro, KY 42302', 'scripts/builders/llms.js'],
    ['agency-level licensing', 'The Way Agency is an independent insurance agency licensed in Kentucky, Indiana, and Tennessee.', 'data/landing-pages.json'],
    ['the new hub eyebrow', 'Independent agency · Licensed in Tennessee', 'scripts/builders/pages.js'],
    ['an AARP mention in a blog post', 'AARP publishes a Medicare guide worth reading.', 'src/blog/example-post.md'],
    ['the signed review gate in the renderer', '<span>Reviewed by ${reviewerLink}</span>', 'scripts/generate-blog.js'],
    ['the blog README describing the gate', '- **"Reviewed by"** is never written here.', 'src/blog/README.md'],
    ['a signed review line in a post', 'Reviewed by Test Reviewer A on December 1, 2025', 'src/blog/example-post.md'],
    ['a neutral carrier phrase', 'We compare coverage from the insurance companies we are appointed with.', 'src/pages/index.html'],
    ['the quoted label on /ai-disclosure', 'A page shows "Reviewed by" with a licensed agent\'s name and date only when that agent has approved that exact text.', 'src/pages/ai-disclosure.html'],
  ];
  for (const [what, text, file] of cases) {
    test(what, () => {
      assert.deepEqual(rulesHit(text, file), [], `flagged: ${text}`);
    });
  }

  test('claims-role copy is a warning in blog posts, a failure elsewhere', () => {
    const text = 'Your agent can push back on the carrier for you.';
    assert.deepEqual(scanText(text, 'src/blog/example-post.md').map((f) => [f.rule, f.severity]), [['claims-role', 'soft']]);
    assert.deepEqual(scanText(text, 'src/pages/about/claims.html').map((f) => [f.rule, f.severity]), [['claims-role', 'hard']]);
  });
});

describe('claims scan: source mode', () => {
  test('scans the paths the spec names and skips the bot-written calendar', () => {
    const files = sourceFiles(ROOT);
    for (const must of ['src/intake.html', 'src/portal.html', 'src/pages/index.html', 'src/pages/about/team.html', 'data/landing-pages.json', 'data/carriers.json', 'scripts/builders/pages.js', 'scripts/builders/llms.js', 'scripts/generate-blog.js']) {
      assert.ok(files.includes(must), `not scanned: ${must}`);
    }
    assert.ok(files.some((f) => /^src\/blog\/.+\.md$/.test(f)), 'blog markdown is scanned');
    assert.ok(!files.includes('data/content-calendar.json'), 'the calendar is bot-written and not scanned');
  });

  test('reads only the root it is given (temporary fixture tree)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-scan-'));
    try {
      const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
      put('src/pages/about/index.html', '<p>Since 1998, we have helped families.</p>');
      put('data/landing-pages.json', '{"meta_description": "Medicare from 40+ top-rated carriers."}');
      put('data/content-calendar.json', '{"note": "founded 1998"}');
      put('src/blog/a-post.md', '---\ntitle: A\n---\nOur agents push back on the carrier.\n');
      put('docs/notes.md', 'since 1998');
      const findings = scanSources(dir);
      assert.deepEqual(hard(findings).map((f) => `${f.rule} ${f.file}`).sort(), [
        'carrier-count data/landing-pages.json',
        'medicare-count data/landing-pages.json',
        'tenure-1998 src/pages/about/index.html',
      ]);
      assert.deepEqual(findings.filter((f) => f.severity === 'soft').map((f) => `${f.rule} ${f.file}`), ['claims-role src/blog/a-post.md']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the repository has no hard finding outside the pending list', () => {
    const counts = new Map();
    const unexpected = [];
    for (const f of hard(scanSources(ROOT))) {
      const entry = PENDING.find((p) => p.rule === f.rule && p.file === f.file && p.match === f.match);
      if (!entry) { unexpected.push(`${f.rule} ${f.file}:${f.line} "${f.match}"`); continue; }
      counts.set(entry, (counts.get(entry) || 0) + 1);
    }
    const overMax = [...counts].filter(([e, n]) => n > e.max).map(([e, n]) => `${e.file} "${e.match}" x${n} (pending allows ${e.max})`);
    assert.deepEqual(unexpected, [], `retracted claims are back:\n  ${unexpected.join('\n  ')}`);
    assert.deepEqual(overMax, []);
  });
});

describe('the quote form makes no bundle-savings figure claims (TRUST-10)', () => {
  test('src/intake.html has no savings percentages, "typically save" or "Add & Save" copy', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');
    const banned = [
      /typically save/i,
      /Add\s*&(?:amp;)?\s*Save/i,
      /Bundle\s*&(?:amp;)?\s*Save/i,
      /Save more by bundling/i,
      /maximum savings/i,
      /\b(?:save|savings of)\s+(?:up to\s+)?\d+(?:\s*[-–]\s*\d+)?\s*%/i,
      /\d+\s*[-–]\s*\d+%\s+(?:less|cheaper|lower)/i,
      /Save \d+(?:\s*[-–]\s*\d+)?%/i,
    ];
    assert.deepEqual(banned.filter((re) => re.test(html)).map(String), []);
  });

  test('flood and life bundles claim no discount', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');
    const enhancers = html.match(/const CROSS_SELL_ENHANCERS = \{[\s\S]*?\n\};/)[0];
    for (const pid of ['flood', 'life']) {
      const row = enhancers.match(new RegExp(`\\n  ${pid}:\\s+\\[[\\s\\S]*?\\]\\s*,`))[0];
      assert.ok(!/type:\s*'discount'/.test(row), `${pid} still shows a discount badge`);
    }
    const bundleMap = html.match(/const BUNDLE_MAP = \{[\s\S]*?\n\};/)[0];
    assert.match(bundleMap, /flood:\s+\{[^}]*noDiscountClaim: true/);
    assert.match(bundleMap, /life:\s+\{[^}]*noDiscountClaim: true/);
  });
});

describe('generated hubs, product and carrier pages carry no retracted claim', () => {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
  const pages = require('../scripts/builders/pages');
  const locations = read('locations.json');
  const richContent = {};
  for (const f of ['content-personal.json', 'content-commercial.json', 'content-life.json', 'content-health.json']) Object.assign(richContent, read(f));
  const ctx = {
    products: read('products.json'),
    office: locations.offices[0],
    team: read('team.json'),
    knowledgeBase: read('knowledge-base.json'),
    carriers: read('carriers.json'),
    testimonials: read('testimonials.json'),
    testimonialsBlocklist: read('testimonials-blocklist.json'),
    reviews: { rating: '5.0', count: '31' },
    richContent,
    landingData: read('landing-pages.json'),
    seoData: read('seo.json'),
    renderNav: () => '',
    renderFooter: () => '',
    renderScripts: () => '',
  };
  const STATE = { KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' };
  const scanHtml = (html, rel) => hard(scanText(html, rel)).map((f) => `${f.rule} "${f.match}"`);

  test('every hub eyebrow states the licensed state, with no tenure, count or Medicare count', () => {
    const problems = [];
    for (const city of ctx.landingData.cities) {
      const html = pages.generateCityPage(city, ctx);
      const eyebrow = (html.match(/hero__eyebrow">([^<]*)</) || [])[1];
      if (eyebrow !== `Independent agency · Licensed in ${STATE[city.state]}`) problems.push(`${city.slug}: eyebrow "${eyebrow}"`);
      if (/twenty-five years|\b40\+/.test(html)) problems.push(`${city.slug}: tenure or count`);
      for (const p of scanHtml(html, `build/insurance/${city.slug}.html`)) problems.push(`${city.slug}: ${p}`);
    }
    for (const county of ctx.landingData.counties || []) {
      const html = pages.generateCountyPage(county, ctx);
      const eyebrow = (html.match(/hero__eyebrow">([^<]*)</) || [])[1];
      if (eyebrow !== `Independent agency · Licensed in ${STATE[county.state]}`) problems.push(`${county.slug}: eyebrow "${eyebrow}"`);
      for (const p of scanHtml(html, `build/insurance/${county.slug}.html`)) problems.push(`${county.slug}: ${p}`);
    }
    assert.deepEqual(problems, []);
  });

  test('product pages: no review box, no cross-line carrier strip, testimonials only from their own line', () => {
    const intermediaries = ['BTIS', 'CRC Group', 'ISC', 'RPS'];
    const blocked = new Set(ctx.testimonialsBlocklist.blocked || []);
    const problems = [];
    for (const [lineKey, lineName] of [['personal', 'Personal Insurance'], ['commercial', 'Commercial Insurance'], ['life', 'Life Insurance'], ['health', 'Health Insurance']]) {
      const wanted = ctx.testimonials.testimonials.filter((t) => !blocked.has(t.id)
        && ((t.product_lines || []).includes(lineKey) || ((lineKey === 'life' || lineKey === 'health') && (t.product_lines || []).includes('life_health')))).slice(0, 3);
      for (const product of ctx.products[lineKey] || []) {
        const html = pages.generateProductPage(product, lineName, lineKey, lineKey, ctx);
        const rel = `build/${lineKey}/${product.slug}.html`;
        if (/Reviewed by|Last reviewed|years experience/.test(html)) problems.push(`${rel}: review box`);
        if ((lineKey === 'life' || lineKey === 'health') && html.includes('carriers__label')) problems.push(`${rel}: P&C carrier strip`);
        for (const name of intermediaries) if (html.includes(`carriers__logo">${name}<`)) problems.push(`${rel}: intermediary ${name} on the strip`);
        const cards = (html.match(/class="testimonial-card"/g) || []).length;
        if (cards !== wanted.length) problems.push(`${rel}: ${cards} testimonial cards, expected ${wanted.length}`);
        for (const t of wanted) if (!html.includes(t.text)) problems.push(`${rel}: missing its own-line testimonial ${t.id}`);
        for (const p of scanHtml(html, rel)) problems.push(`${rel}: ${p}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test('carrier pages print no undated rating, no AARP, and no card cut at "U."', () => {
    const problems = [];
    for (const line of ['personal', 'commercial']) {
      for (const carrier of ctx.carriers[line]) {
        if (!carrier.description) continue;
        const html = pages.generateCarrierPage(carrier, line, ctx);
        if (/AM Best|A\+\+|\bAARP\b/.test(html)) problems.push(`${carrier.slug}: rating or AARP`);
      }
    }
    const index = pages.generateCarriersIndex(ctx.carriers, ctx);
    if (/AM Best|A\+\+|\bAARP\b/.test(index)) problems.push('index: rating or AARP');
    if (/in the U\.<\/p>/.test(index)) problems.push('index: card cut at "U."');
    for (const p of scanHtml(index, 'build/carriers/index.html')) problems.push(`index: ${p}`);
    assert.deepEqual(problems, []);
  });
});
