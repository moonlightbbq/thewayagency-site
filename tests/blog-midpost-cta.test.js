/**
 * AEO-04: the mid-post quote CTA sits below section 3, never between a
 * heading and its answer. It used to follow the 3rd </h2> directly, so on 65
 * posts a reader skimming for the answer to "How to Calculate Your Liability
 * Exposure" hit a sales block first. Placement only: markup, copy and href are
 * unchanged by the move (content-accuracy WP-A7a, owner decision D9).
 *
 * Pure: renders in memory, never writes build/.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { injectMidPostCTA, markdownToHtml, parseFrontMatter } = require('../scripts/generate-blog');
const { midPostCtaOffset } = require('../scripts/lib/blog-cta-placement');

const ROOT = path.join(__dirname, '..');
const CTA_START = '<div style="background:linear-gradient(135deg,var(--navy-dark),var(--navy))';

/** n sections: an H2 (with an id, as generateTOC() leaves it) and a paragraph each. */
function sections(n, { ids = true } = {}) {
  let html = '<p class="text-lg">Intro.</p>\n';
  for (let i = 1; i <= n; i++) {
    html += `<h2${ids ? ` id="s${i}"` : ''}>Section ${i}</h2>\n<p>Answer ${i}.</p>\n<ul>\n<li>Item ${i}</li>\n</ul>\n`;
  }
  return html;
}

const count = (html, needle) => html.split(needle).length - 1;
const ctaAt = (html) => html.indexOf(CTA_START);
const directlyAfterH2 = (html) => /<\/h2>\s*<div style="background:linear-gradient\(135deg,var\(--navy-dark\)/.test(html);

describe('mid-post CTA placement (AEO-04)', () => {
  test('5 H2s: one CTA, immediately before the 4th H2, never directly after a heading', () => {
    const out = injectMidPostCTA(sections(5), 'personal', '/personal/home.html');
    assert.equal(count(out, CTA_START), 1);
    assert.ok(!directlyAfterH2(out));
    const after = out.slice(ctaAt(out));
    assert.match(after, /^<div[\s\S]*?<\/div>\s*<h2 id="s4">/, 'the 4th H2 follows the CTA block');
    assert.ok(out.indexOf('<p>Answer 3.</p>') < ctaAt(out), 'section 3 is complete above the CTA');
  });

  test('H2s without ids (no table of contents) are matched too', () => {
    const out = injectMidPostCTA(sections(4, { ids: false }), '', null);
    assert.equal(count(out, CTA_START), 1);
    assert.match(out.slice(ctaAt(out)), /^<div[\s\S]*?<\/div>\s*<h2>Section 4<\/h2>/);
  });

  test('exactly 3 H2s: one CTA after the first block that follows the 3rd H2', () => {
    const out = injectMidPostCTA(sections(3), 'commercial', '/commercial/general-liability.html');
    assert.equal(count(out, CTA_START), 1);
    assert.ok(!directlyAfterH2(out));
    const i = out.indexOf('<p>Answer 3.</p>') + '<p>Answer 3.</p>'.length;
    assert.equal(midPostCtaOffset(sections(3)), sections(3).indexOf('<p>Answer 3.</p>') + '<p>Answer 3.</p>'.length);
    assert.match(out.slice(i), /^\s*<div style="background:linear-gradient/);
  });

  test('exactly 3 H2s with nothing after the last heading: the CTA goes at the end', () => {
    const html = '<p>a</p><h2>One</h2><p>b</p><h2>Two</h2><p>c</p><h2>Three</h2>';
    assert.equal(midPostCtaOffset(html), html.length);
  });

  test('fewer than 3 H2s: no CTA (unchanged)', () => {
    for (const n of [0, 1, 2]) {
      const html = sections(n);
      assert.equal(injectMidPostCTA(html, 'personal', null), html);
    }
  });

  test('the block itself is unchanged by the move: same copy, heading and href', () => {
    const out = injectMidPostCTA(sections(5), 'personal', '/personal/home.html');
    const block = out.slice(ctaAt(out), out.indexOf('</div>', ctaAt(out)) + '</div>'.length);
    assert.match(block, /Need help with personal insurance\?/);
    assert.match(block, /href="\/intake\/\?product=home"/);
    const bare = injectMidPostCTA(sections(5), '', null);
    assert.match(bare, /href="\/intake\/"/);
    assert.match(bare, /Need help with insurance\?/);
  });

  test('every markdown post with 3 or more H2s gets exactly one CTA, never directly after a heading', () => {
    const dir = path.join(ROOT, 'src', 'blog');
    let checked = 0;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(dir, file), 'utf8'));
      const html = markdownToHtml(body);
      const h2s = (html.match(/<h2[\s>]/g) || []).length;
      const out = injectMidPostCTA(html, meta.category || '', null);
      if (h2s < 3) { assert.equal(out, html, file); continue; }
      checked++;
      assert.equal(count(out, CTA_START), 1, file);
      assert.ok(!directlyAfterH2(out), `${file}: CTA directly after an </h2>`);
    }
    assert.ok(checked > 40, `checked ${checked} posts`);
  });
});
