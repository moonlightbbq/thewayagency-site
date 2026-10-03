/**
 * The hero is visible from the first painted frame, and stylesheets block render
 * (PERF-04 and PERF-03, above-the-fold spec Steps 1.2 and 1.3).
 *
 * The hero eyebrow, title, subtitle and buttons used to start at opacity:0 behind a
 * fadeUp delayed 0.2-0.8 s, also for reduced-motion users, and Chrome leaves opacity:0
 * elements out of LCP. The three site stylesheets loaded with a media="print" swap
 * behind a hand-kept critical.css, so sections were restyled after first paint.
 *
 * One exception is TEMPORARY and documented in components.css: the homepage hero
 * actions, which hold the hero-cta A/B button, keep the old fade until the owner
 * ends that test (decision D1), so its label swap stays hidden.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const COMPLIANCE = ['privacy', 'terms', 'disclosures', 'privacy-notice', 'ai-disclosure', 'information-security'];
const HERO_PARTS = ['.hero__eyebrow', '.hero__title', '.hero__subtitle', '.hero__actions'];
const D1_HOLD = '.hero__actions:has([data-ab-test="hero-cta"])';

// Leaf rules as { prelude, body, media }, descending into @media/@supports blocks.
function rules(css, media = '') {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 0, j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    const body = css.slice(open + 1, j);
    if (/^@(media|supports)\b/.test(prelude)) out.push(...rules(body, prelude));
    else out.push({ prelude, body, media });
    i = j + 1;
  }
  return out;
}

const hides = (body) => /(^|[;{\s])opacity\s*:\s*0(?![.\d])/.test(body);
const animates = (body) => /(^|[;{\s])animation(-name|-delay)?\s*:/.test(body);
const selectors = (prelude) => prelude.split(',').map((s) => s.trim());

function inlineHeadCss(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  return [...head.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

function assertHeroVisible(css, where) {
  const all = rules(css);
  for (const part of HERO_PARTS) {
    const own = all.filter((r) => !r.media && selectors(r.prelude).includes(part));
    assert.ok(own.length > 0, `${where}: no ${part} rule found`);
    for (const r of own) {
      assert.ok(!hides(r.body), `${where}: ${part} starts hidden: ${r.body}`);
      assert.ok(!animates(r.body), `${where}: ${part} still animates: ${r.body}`);
    }
  }
  // No other rule may hide or delay a hero part, except the documented D1 hold.
  for (const r of all) {
    if (!/\.hero__(eyebrow|title|subtitle|actions)\b/.test(r.prelude)) continue;
    if (!hides(r.body) && !animates(r.body)) continue;
    assert.equal(r.prelude, D1_HOLD, `${where}: unexpected hero fade in "${r.prelude}{${r.body}}"`);
  }
}

describe('the hero is visible from the first painted frame', () => {
  test('components.css: the four hero parts have no opacity:0 and no animation', () => {
    assertHeroVisible(read('src/css/components.css'), 'components.css');
  });

  for (const page of COMPLIANCE) {
    test(`${page}.html inline head CSS: the four hero parts have no opacity:0 and no animation`, () => {
      const css = inlineHeadCss(read(`src/pages/${page}.html`));
      assertHeroVisible(css, page);
      assert.ok(!rules(css).some((r) => r.prelude === D1_HOLD), `${page}: the D1 hold belongs to components.css only`);
      assert.match(css, /@keyframes fadeUp\{/, `${page}: .wizard-step still uses fadeUp`);
    });
  }

  test('@keyframes fadeUp is kept (leadgen.css .wizard-step uses it)', () => {
    assert.match(read('src/css/components.css'), /@keyframes fadeUp\{/);
    assert.match(read('src/css/leadgen.css'), /animation:\s*fadeUp\b/);
  });

  test('TEMPORARY (D1): the hero-cta hold applies only on the homepage', () => {
    const pages = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (e.name.endsWith('.html') && read(rel).includes('data-ab-test="hero-cta"')) pages.push(rel);
      }
    };
    walk('src');
    assert.deepEqual(pages, [path.join('src', 'pages', 'index.html')]);
  });
});

describe('reduced motion never delays content', () => {
  for (const file of ['src/css/components.css', 'src/css/leadgen.css']) {
    test(`${file}: the reduced-motion block sets animation-delay:0s and never animation:none`, () => {
      const block = rules(read(file)).filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media));
      const star = block.find((r) => selectors(r.prelude).includes('*'));
      assert.ok(star, `${file}: no reduced-motion * rule`);
      assert.match(star.body, /animation-delay:\s*0s\s*!important/);
      for (const r of block) assert.doesNotMatch(r.body, /animation\s*:\s*none/);
      // The only selector allowed to keep a delay in this mode is the TEMPORARY D1 hold.
      for (const r of block.filter((x) => x !== star)) {
        assert.equal(r.prelude, D1_HOLD, `${file}: unexpected reduced-motion rule ${r.prelude}`);
      }
    });
  }
});

describe('stylesheets load render-blocking, with no hand-kept critical subset', () => {
  test('src/css/critical.css is gone', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'src', 'css', 'critical.css')), false);
  });

  test('no build script or source page emits a media="print" stylesheet swap', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel); continue; }
        if (!/\.(js|html)$/.test(e.name)) continue;
        if (/<link\b[^>]*\bmedia=["']print["']|this\.media\s*=\s*["']all["']/.test(read(rel))) offenders.push(rel);
      }
    };
    walk('scripts');
    walk('src');
    assert.deepEqual(offenders, []);
  });

  test('renderHead() emits the three stylesheets as plain links', () => {
    const { renderHead } = require('../scripts/builders/pages');
    const head = renderHead({ title: 't', description: 'd', canonical: 'https://www.thewayagency.com/x' });
    assert.match(head, /<link rel="stylesheet" href="\/src\/css\/base\.css">\s*<link rel="stylesheet" href="\/src\/css\/components\.css">\s*<link rel="stylesheet" href="\/src\/css\/leadgen\.css">/);
    assert.doesNotMatch(head, /<style>|media=|onload=|<noscript>/);
  });

  test('injectVersion() leaves a page\'s stylesheet links alone', () => {
    const { createInjectVersion } = require('../scripts/builders/seo');
    const inject = createInjectVersion({
      buildVersion: 'v1', gitInfo: { branch: 'b' }, buildDate: 'd', reviews: { count: '1', rating: '5.0' },
      renderHead_GTM: () => '', renderBody_GTM: () => '',
    });
    const links = '  <link rel="stylesheet" href="/src/css/base.css">\n  <link rel="stylesheet" href="/src/css/components.css">\n  <link rel="stylesheet" href="/src/css/leadgen.css">';
    const out = inject(`<!DOCTYPE html><html><head><meta charset="UTF-8">\n${links}\n</head><body></body></html>`, '/x.html');
    assert.match(out, /<link rel="stylesheet" href="\/src\/css\/base\.css\?v=v1">\s*<link rel="stylesheet" href="\/src\/css\/components\.css\?v=v1">\s*<link rel="stylesheet" href="\/src\/css\/leadgen\.css\?v=v1">/);
    assert.doesNotMatch(out, /media="print"|<style>/);
  });
});
