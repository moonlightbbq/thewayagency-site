'use strict';
/**
 * Y-74 PR-B: the site's licensed states come from data/entity.json, and the Ohio
 * wording follows Y0's rulings (11/14):
 *  - every builder, the shared footer and the blog index derive the list;
 *  - with KY, IN, TN the derived text is byte-for-byte what the pages printed before;
 *  - team page option (a): visible "Licensed in" text for the two Ohio-licensed people
 *    only; no credential, no number, no JSON-LD change;
 *  - carrier pages name no state in their own copy;
 *  - the privacy "Residents of ..." sentence is unchanged (owner call);
 *  - terms and privacy are version 2026.11, archived;
 *  - frozen blog pages, careers pages and the sweepstakes page are untouched.
 * Synthetic carriers only.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const entityLib = require('../scripts/lib/entity');
const { stateNamesText, stateCodesText, stateCountWord, stateAreaServed, STATE_NAMES } = entityLib;
const { licensedStates } = require('../scripts/lib/licensed-states');

const THREE = ['KY', 'IN', 'TN'];
const FOUR = ['KY', 'IN', 'OH', 'TN'];
// The list as the pages wrote it, in every form they used.
const THREE_ONLY = /Kentucky, Indiana,? (?:and|&amp;|&) Tennessee|KY, IN,? (?:and|&amp;|&) TN\b|KY, IN, TN<|all three states|Three States\./g;

describe('state text formatters', () => {
  test('with KY, IN, TN they print exactly what the pages printed before', () => {
    assert.equal(stateNamesText(THREE), 'Kentucky, Indiana, and Tennessee');
    assert.equal(stateNamesText(THREE, { oxford: false }), 'Kentucky, Indiana and Tennessee');
    assert.equal(stateCodesText(THREE), 'KY, IN & TN');
    assert.equal(stateCodesText(THREE, { conj: '&amp;' }), 'KY, IN &amp; TN');
    assert.equal(stateCountWord(THREE), 'three');
    assert.deepEqual(stateAreaServed(THREE), [
      { '@type': 'State', name: 'Kentucky' }, { '@type': 'State', name: 'Indiana' }, { '@type': 'State', name: 'Tennessee' },
    ]);
  });
  test('with Ohio added', () => {
    assert.equal(stateNamesText(FOUR), 'Kentucky, Indiana, Ohio, and Tennessee');
    assert.equal(stateNamesText(FOUR, { oxford: false }), 'Kentucky, Indiana, Ohio and Tennessee');
    assert.equal(stateCodesText(FOUR, { conj: '&amp;' }), 'KY, IN, OH &amp; TN');
    assert.equal(stateCountWord(FOUR), 'four');
  });
  test('two states and one state read naturally', () => {
    assert.equal(stateNamesText(['KY', 'IN']), 'Kentucky and Indiana');
    assert.equal(stateNamesText(['KY']), 'Kentucky');
    assert.equal(stateCodesText(['KY', 'IN']), 'KY & IN');
  });
  test('a state the site cannot spell throws, never prints a code', () => {
    assert.throws(() => stateNamesText(['KY', 'ZZ']), /unknown licensed state "ZZ"/);
    assert.throws(() => stateCodesText(['KY', 'ZZ']), /unknown licensed state "ZZ"/);
    assert.throws(() => stateAreaServed(['ZZ']), /unknown licensed state "ZZ"/);
  });
});

describe('licensedStates() reads data/entity.json', () => {
  const tmp = (states) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'y74b-states-'));
    fs.writeFileSync(path.join(dir, 'entity.json'), JSON.stringify(states === undefined ? {} : { licensed_states: states }));
    return dir;
  };
  test('the repo list is the four, in order', () => {
    assert.deepEqual(licensedStates(), FOUR);
    assert.deepEqual(JSON.parse(read('data/entity.json')).licensed_states, FOUR);
  });
  test('another data dir is read on its own', () => {
    assert.deepEqual(licensedStates(tmp(THREE)), THREE);
  });
  test('missing, empty or unknown: throws (the site never guesses)', () => {
    assert.throws(() => licensedStates(tmp(undefined)), /lists no licensed_states/);
    assert.throws(() => licensedStates(tmp([])), /lists no licensed_states/);
    assert.throws(() => licensedStates(tmp(['KY', 'XX'])), /unknown state "XX"/);
  });
  test('a caller cannot change the cached list', () => {
    const a = licensedStates();
    assert.doesNotThrow(() => a.push('ZZ'), 'each caller gets its own copy');
    assert.deepEqual(licensedStates(), FOUR);
  });
});

describe('built surfaces derive the states', () => {
  const shared = require('../scripts/shared-templates');
  const office = JSON.parse(read('data/locations.json')).offices[0];
  test('the shared footer says the licensed states', () => {
    assert.match(shared.renderFooter(office, null), /Licensed in KY, IN, OH &amp; TN\. Way Associates, Inc dba The Way Agency\./);
  });
  test('no builder hard-codes the three states any more', () => {
    for (const f of ['scripts/builders/pages.js', 'scripts/builders/schema-generator.js', 'scripts/builders/llms.js',
      'scripts/generate-blog.js', 'scripts/shared-templates.js']) {
      const src = read(f).replace(/^\s*(?:\/\/|\*).*$/gm, '');
      assert.deepEqual(src.match(THREE_ONLY) || [], [], f);
      assert.doesNotMatch(src, /\[\s*'KY',\s*'IN',\s*'TN'\s*\]/, f);
    }
  });
  test('industry and product Service nodes serve every licensed state', () => {
    const pages = require('../scripts/builders/pages');
    const { createSchemaInjector } = require('../scripts/builders/schema-generator');
    const loc = JSON.parse(read('data/locations.json'));
    const entity = JSON.parse(read('data/entity.json'));
    const inject = createSchemaInjector({ agency: loc.agency, office: loc.offices[0], entity });
    const load = (f) => JSON.parse(read(`data/${f}`));
    const ctx = {
      products: load('products.json'), office: loc.offices[0], team: load('team.json'), knowledgeBase: load('knowledge-base.json'),
      carriers: load('carriers.json'), testimonials: load('testimonials.json'), reviews: null, richContent: {}, landingData: load('landing-pages.json'),
      seoData: load('seo.json'), renderNav: shared.renderNav, renderFooter: () => shared.renderFooter(loc.offices[0], null), renderScripts: shared.renderScripts,
    };
    const ind = ctx.landingData.industries[0];
    const html = inject(pages.generateIndustryPage(ind, ctx), 'industry', ind);
    assert.ok(html.includes(`Insurance for ${ind.name.toLowerCase()} in Kentucky, Indiana, Ohio, and Tennessee.`));
    assert.ok(html.includes('across Kentucky, Indiana, Ohio, and Tennessee, here are'));
    const served = [...html.matchAll(/"areaServed":\s*(\[[^\]]*\])/g)].map((m) => JSON.parse(m[1]).map((s) => s.name));
    assert.ok(served.length >= 1);
    for (const s of served) assert.deepEqual(s, ['Kentucky', 'Indiana', 'Ohio', 'Tennessee']);
    // Per line (Y0 11/14): a health product and disability serve only the states with an
    // Accident and Health line; every other product serves every licensed state.
    const productServed = (lineKey, id) => {
      const product = ctx.products[lineKey].find((x) => x.id === id);
      const out = pages.generateProductPage(product, lineKey, lineKey, lineKey, ctx);
      return [...out.matchAll(/"areaServed":\s*(\[[^\]]*\])/g)].map((m) => JSON.parse(m[1]).map((x) => x.name));
    };
    assert.deepEqual(productServed('health', 'medicare'), [['Kentucky', 'Indiana', 'Tennessee']]);
    assert.deepEqual(productServed('life', 'disability'), [['Kentucky', 'Indiana', 'Tennessee']]);
    assert.deepEqual(productServed('life', 'term-life'), [['Kentucky', 'Indiana', 'Ohio', 'Tennessee']]);
    assert.deepEqual(productServed('personal', 'pet'), [['Kentucky', 'Indiana', 'Ohio', 'Tennessee']]);
  });
  test('a carrier page names no state in its own copy (Y0: no OH on carrier pages)', () => {
    const pages = require('../scripts/builders/pages');
    const office = JSON.parse(read('data/locations.json')).offices[0];
    const ctx = { office, renderNav: () => '', renderFooter: () => '', renderScripts: () => '', reviews: null, carriers: { personal: [], commercial: [] }, products: [] };
    const STATE = /Kentucky|Indiana|Tennessee|\bOhio\b|\bKY\b|\bIN &|\bTN\b|\bOH\b/;
    for (const carrier of [{ name: 'Synthetic Mutual', slug: 'synthetic-mutual' }, { name: 'Example Casualty', slug: 'example-casualty', description: 'A made-up carrier.' }]) {
      const html = pages.generateCarrierPage(carrier, 'personal', ctx);
      // The page's own copy: title, descriptions, JSON-LD and hero (the CTA's mailing address is the office's, not a claim).
      const own = [/<title>[^<]*/, /<meta name="description" content="[^"]*/, /<meta property="og:description" content="[^"]*/,
        /<script type="application\/ld\+json">[\s\S]*?<\/script>/, /<p class="hero__subtitle"[^>]*>[^<]*/].map((re) => (re.exec(html) || [''])[0]);
      assert.ok(own.filter(Boolean).length >= 4, carrier.slug);
      for (const t of own) assert.doesNotMatch(t, STATE, `${carrier.slug}: ${t.slice(0, 80)}`);
    }
  });
});

describe('hand-made pages (Y0 rulings)', () => {
  const CHANGED = ['src/pages/index.html', 'src/pages/about/index.html', 'src/pages/about/community.html', 'src/pages/about/locations.html',
    'src/pages/contact.html', 'src/pages/404.html', 'src/pages/about/claims.html', 'src/pages/ai-disclosure.html', 'src/pages/disclosures.html',
    'src/pages/information-security.html', 'src/pages/login.html', 'src/pages/privacy-notice.html', 'src/pages/terms.html',
    'src/pages/privacy.html', 'src/pages/about/team.html', 'data/landing-pages.json', 'data/knowledge-base.json',
    'src/pages/about/careers.html', 'src/pages/about/careers/apply.html', 'src/pages/about/careers/intern.html', 'src/pages/about/careers/pc-insurance-agent.html',
    'src/pages/about/careers/employee-benefits-leader.html', 'data/seo.json'];
  // The only three-state text left on these pages, each by a ruling.
  const KEPT = {
    'src/pages/about/team.html': ['Kentucky, Indiana, and Tennessee', 'Kentucky, Indiana, and Tennessee'], // JSON-LD, option (a)
    // The Employee Benefits role is health business: the Accident and Health states (Y-74 rework).
    // JSON-LD and The Role, the location chip, the licence requirement and "a strong reputation in".
    'src/pages/about/careers/employee-benefits-leader.html': ['Kentucky, Indiana, and Tennessee', 'KY, IN &amp; TN', 'Kentucky, Indiana, and Tennessee', 'KY, IN, and TN', 'KY, IN, and TN'],
  };
  test('no page Y0 cleared still lists only the three states, except the kept sentences', () => {
    for (const f of CHANGED) assert.deepEqual(read(f).match(THREE_ONLY) || [], KEPT[f] || [], f);
  });
  test('privacy: the "Residents of" sentence names the four states (owner brief 11/14)', () => {
    assert.match(read('src/pages/privacy.html'), /<p>Residents of Kentucky, Indiana, Ohio, and Tennessee may have additional privacy rights/);
  });
  test('home FAQ and the knowledge base make no health claim for all four states (Y0 H1)', () => {
    for (const f of ['src/pages/index.html', 'data/knowledge-base.json']) {
      const t = read(f);
      assert.doesNotMatch(t, /all four states with [^.]*health/, f);
      assert.match(t, /across all four states with personal, commercial, and life insurance\./, f);
    }
  });
  test('the owner\'s footer: "Licensed in KY, IN, OH & TN." on the shared footer and every hand page footer', () => {
    const shared = require('../scripts/shared-templates');
    assert.match(shared.renderFooter(JSON.parse(read('data/locations.json')).offices[0], null), />Licensed in KY, IN, OH &amp; TN\. Way Associates, Inc dba The Way Agency\.</);
    const { LEGACY_BLOG_PAGES } = require('../scripts/lib/legacy-blog-pages');
    const hand = [...CHANGED.filter((f) => f.endsWith('.html')), ...Object.keys(LEGACY_BLOG_PAGES).map((n) => `src/pages/blog/${n}`)];
    for (const f of hand) {
      const footers = read(f).match(/>Licensed in [^<]*\. Way Associates, Inc dba The Way Agency\.</g) || [];
      for (const ft of footers) assert.equal(ft, '>Licensed in KY, IN, OH &amp; TN. Way Associates, Inc dba The Way Agency.<', f);
    }
  });
  test('team: only Sheilia Royal and Kelly McCallister show Ohio; no credential, number or JSON-LD names Ohio', () => {
    const html = read('src/pages/about/team.html');
    const cards = [...html.matchAll(/<div class="card team-(?:card|featured)" id="([a-z-]+)">([\s\S]*?)<p class="team-experience">([^<]*)<\/p>/g)]
      .map((m) => [m[1], m[3]]);
    assert.deepEqual(Object.fromEntries(cards), {
      'sheilia-royal': 'Licensed in KY, IN, OH, TN',
      'audrey-lillpop': 'Licensed in KY, IN',
      'kelly-mccallister': 'Licensed in KY, IN, OH, TN',
      'jill-boone': 'Licensed in KY, IN',
    });
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    assert.doesNotMatch(ld, /Ohio|"OH"/);
  });
  test('terms and privacy are 2026.11, and the archive holds that version', () => {
    for (const p of ['terms', 'privacy']) {
      const html = read(`src/pages/${p}.html`);
      assert.match(html, />Version 2026\.11<\/span>/, p);
      assert.match(html, />Updated November 14, 2026<\/span>/, p);
      const main = (h) => /<main[\s\S]*<\/main>/.exec(h)[0];
      assert.equal(main(read(`legal-archive/2026.11/${p}.html`)), main(html), p);
      assert.match(read(`legal-archive/2026.10/${p}.html`), />Version 2026\.10<\/span>/, `${p} 2026.10 kept`);
    }
  });
  test('out of scope: the ended sweepstakes page keeps its three states', () => {
    assert.doesNotMatch(read('src/pages/forrest-frank-2026.html'), /\bOhio\b|\bOH\b/);
  });
  test('careers: Ohio everywhere except the Employee Benefits role\'s health lines', () => {
    const eb = read('src/pages/about/careers/employee-benefits-leader.html');
    assert.match(eb, /division across Kentucky, Indiana, and Tennessee/);
    assert.match(eb, /willing to obtain KY, IN, and TN licenses/);
    assert.match(eb, /<\/svg> KY, IN &amp; TN<\/span>/);
    assert.match(eb, /strong reputation in KY, IN, and TN/);
    for (const f of ['careers.html', 'careers/apply.html', 'careers/intern.html', 'careers/pc-insurance-agent.html']) {
      assert.doesNotMatch(read(`src/pages/about/${f}`), /Kentucky, Indiana, and Tennessee|KY, IN,? (and|&amp;) TN/, f);
    }
  });
  test('STATE_NAMES spells Ohio; check-data-integrity accepts what it spells', () => {
    assert.equal(STATE_NAMES.OH, 'Ohio');
    assert.doesNotMatch(read('scripts/check-data-integrity.js'), /\['KY', 'IN', 'TN'\]\.includes/);
  });
});
