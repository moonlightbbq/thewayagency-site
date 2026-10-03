/**
 * BLOG-01 review F1: a link inside an FAQ answer (a statute citation) renders
 * as a live link on the page and as its label in the FAQPage JSON-LD; raw
 * markdown such as "([KRS 304.39-110](https://...))" is never printed.
 * Nothing here reads or writes build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { extractFAQs, generateBlogPost, parseFrontMatter, faqAnswerHtml, faqAnswerText } = require('../scripts/generate-blog');

const ROOT = path.join(__dirname, '..');
const BLOG = path.join(ROOT, 'src', 'blog');
const KRS = 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=46758';
const RAW_LINK = /\]\((?:https?:|\/)/;

/** The FAQ answers' visible HTML and the FAQPage answer texts of a rendered page. */
function faqParts(html) {
  const visible = [...html.matchAll(/<div class="faq-item__answer">\s*<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  const ld = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    if (data['@type'] === 'FAQPage') for (const q of data.mainEntity) ld.push(q.acceptedAnswer.text);
  }
  return { visible, ld };
}

describe('FAQ answer links (BLOG-01 review F1)', () => {
  test('a statute link renders as an <a> on the page and as its label in JSON-LD', () => {
    const body = `Intro.\n\n### FAQ: What is the minimum?\n\n25/50/25 or a $60,000 single limit ([KRS 304.39-110](${KRS})). See **this** and [the auto page](/personal/auto.html).\n`;
    const faqs = extractFAQs(body);
    assert.equal(faqs.length, 1);
    assert.equal(faqs[0].answer, '25/50/25 or a $60,000 single limit (KRS 304.39-110). See this and the auto page.');
    const html = generateBlogPost({ title: 'SYNTHETIC', slug: 'synthetic-faq', date: '2026-01-07', description: 'x' }, '<p>Intro.</p>', faqs, { team: [] });
    const { visible, ld } = faqParts(html);
    assert.equal(visible.length, 1);
    assert.ok(visible[0].includes(`<a href="${KRS}">KRS 304.39-110</a>`), visible[0]);
    assert.ok(visible[0].includes('<a href="/personal/auto">the auto page</a>'), 'site links print extensionless');
    assert.ok(visible[0].includes('<strong>this</strong>'));
    assert.deepEqual(ld, ['25/50/25 or a $60,000 single limit (KRS 304.39-110). See this and the auto page.']);
    assert.doesNotMatch(visible[0], RAW_LINK);
  });

  test('answer markup is escaped, and script or data link targets are dropped', () => {
    const out = faqAnswerHtml('A <b>"x"</b> & [bad](javascript:alert(1)) [q](/x" onmouseover="y)');
    assert.doesNotMatch(out, /<b>/);
    assert.match(out, /&lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp;/);
    assert.match(out, /<a href="#">bad<\/a>/);
    assert.doesNotMatch(out, /href="[^"]*" onmouseover=/);
    assert.equal(faqAnswerText('See [KRS 1](https://e.example/1), **b**, *i*.'), 'See KRS 1, b, i.');
  });

  test('no post prints raw markdown links in its visible FAQ answers or its FAQPage JSON-LD', () => {
    const files = fs.readdirSync(BLOG).filter((f) => f.endsWith('.md') && f !== 'README.md');
    let checked = 0;
    for (const file of files) {
      const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(BLOG, file), 'utf8'));
      const faqs = extractFAQs(body);
      if (!faqs.length) continue;
      const html = generateBlogPost({ ...meta, slug: meta.slug || 'x' }, '<p>x</p>', faqs, { team: [] });
      const { visible, ld } = faqParts(html);
      assert.equal(visible.length, faqs.length, file);
      for (const v of visible) assert.doesNotMatch(v.replace(/<[^>]*>/g, ''), RAW_LINK, `${file}: visible FAQ answer`);
      for (const t of ld) assert.doesNotMatch(t, RAW_LINK, `${file}: FAQPage answer text`);
      checked++;
    }
    assert.ok(checked > 10, `checked ${checked} posts with FAQs`);
  });
});
