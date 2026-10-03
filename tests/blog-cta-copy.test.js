/**
 * Mid-post CTA copy (CONT-03, AEO-04, TRUST-05; owner decision D8): no "free"
 * on life, health or Medicare posts, no "top-rated" anywhere, and no
 * carrier-comparison claim on health or Medicare posts (health leads go to the
 * partner agency). The href is unchanged.
 *
 * Pure: renders in memory, never writes build/.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { injectMidPostCTA, parseFrontMatter, sitePath } = require('../scripts/generate-blog');
const { CTA_COPY, ctaLine } = require('../scripts/lib/blog-cta-copy');

const ROOT = path.join(__dirname, '..');
const CTA_START = '<div style="background:linear-gradient(135deg,var(--navy-dark),var(--navy))';

function sections(n) {
  let html = '<p class="text-lg">Intro.</p>\n';
  for (let i = 1; i <= n; i++) html += `<h2 id="s${i}">Section ${i}</h2>\n<p>Answer ${i}.</p>\n`;
  return html;
}
function block(out) {
  const at = out.indexOf(CTA_START);
  assert.ok(at >= 0, 'a CTA is rendered');
  return out.slice(at, out.indexOf('</div>', at) + '</div>'.length);
}
const render = (category, related, opts) => block(injectMidPostCTA(sections(5), category, related, opts));

describe('mid-post CTA copy (CONT-03, D8)', () => {
  test('a life post with no category (related_page under /life/): no "free", a "Get a Quote" button, href unchanged', () => {
    const b = render('', '/life/term-life.html');
    assert.doesNotMatch(b, /free/i);
    assert.match(b, />Get a Quote<\/a>/);
    assert.match(b, /We compare the insurance companies we represent for you\./);
    assert.match(b, /href="\/intake\/\?product=term-life"/);
  });

  test('category life, health and life_health: no "free"', () => {
    for (const c of ['life', 'health', 'life_health']) assert.doesNotMatch(render(c, null), /free/i, c);
  });

  test('a health post makes no carrier-comparison claim', () => {
    for (const b of [render('health', null), render('', '/health/individual-health.html'), render('life_health', null)]) {
      assert.doesNotMatch(b, /free|compare|shop/i);
      assert.match(b, /Talk with a licensed agent about your health insurance options\./);
    }
  });

  test('a Medicare post keeps its TRUST-01 line and loses "free" on the button', () => {
    const b = render('health', null, { medicare: true });
    assert.match(b, /Talk with a licensed agent about your Medicare options\./);
    assert.doesNotMatch(b, /free|compare|shop/i);
    assert.match(b, /href="\/intake\/\?product=medicare"/);
  });

  test('a /personal/ post keeps "Get a Free Quote", without "top-rated"', () => {
    const b = render('personal', '/personal/home.html');
    assert.match(b, />Get a Free Quote<\/a>/);
    assert.match(b, /Get a free quote from an independent agent\. We compare the insurance companies we represent for you\./);
    assert.doesNotMatch(b, /top-rated/i);
    assert.match(b, /href="\/intake\/\?product=home"/);
  });

  test('no line says "top-rated"; only the other-lines copy says "free"', () => {
    for (const [line, c] of Object.entries(CTA_COPY)) {
      assert.doesNotMatch(c.text + c.button, /top-rated/i, line);
      if (line !== 'other') assert.doesNotMatch(c.text + c.button, /free/i, line);
    }
    assert.equal(ctaLine('commercial', '/commercial/general-liability.html'), 'other');
    assert.equal(ctaLine('', '/life/final-expense.html'), 'life');
    assert.equal(ctaLine('life', '/health/medicare.html'), 'health', 'a health page wins: the stricter copy');
  });

  test('every markdown post under /life/ or /health/ (or in those categories) renders no "free" in its CTA', () => {
    const dir = path.join(ROOT, 'src', 'blog');
    let checked = 0;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const { meta } = parseFrontMatter(fs.readFileSync(path.join(dir, file), 'utf8'));
      const related = sitePath(meta.related_page);
      if (ctaLine(meta.category || '', related) === 'other') continue;
      checked++;
      assert.doesNotMatch(render(meta.category || '', related), /free/i, file);
    }
    assert.ok(checked >= 4, `checked ${checked} posts`);
  });
});
