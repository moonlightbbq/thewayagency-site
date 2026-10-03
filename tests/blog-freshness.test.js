/**
 * BLOG-07: a post's visible date, its Article dateModified and its
 * article:modified_time are one date. The byline used to print only
 * "Published", so a corrected post showed no sign of the correction while the
 * structured data could carry a different date (Google: visible and
 * structured dates must agree). "Updated" prints only when the front matter's
 * `modified` is a real YYYY-MM-DD later than `date`; a missing, equal,
 * earlier or malformed value leaves only "Published" and all three dates equal
 * to the publish date. Dates stay date-only: no invented time.
 *
 * Pure: renders in memory, never writes build/.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { generateBlogPost, markdownToHtml } = require('../scripts/generate-blog');

const ROOT = path.join(__dirname, '..');
const body = markdownToHtml('Synthetic body text for the freshness test.');

function render(patch) {
  const meta = { title: 'SYNTHETIC freshness', slug: 'test-freshness', description: 'd', date: '2026-03-27', ...patch };
  return generateBlogPost(meta, body, [], { team: [] });
}

function article(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const j = JSON.parse(m[1]);
    const nodes = Array.isArray(j['@graph']) ? j['@graph'] : [j];
    const a = nodes.find((n) => n['@type'] === 'Article');
    if (a) return a;
  }
  throw new Error('no Article');
}

const metaContent = (html, prop) => (new RegExp(`<meta property="${prop}" content="([^"]*)">`).exec(html) || [])[1];
const bylineTimes = (html) => {
  const meta = /<div class="blog-meta">([\s\S]*?)<\/div>/.exec(html)[1];
  return [...meta.matchAll(/<span>(Published|Updated) <time datetime="([^"]+)">([^<]+)<\/time><\/span>/g)].map((m) => ({ label: m[1], datetime: m[2], text: m[3] }));
};

describe('visible Updated date and matching structured dates (BLOG-07)', () => {
  test('modified later than date: "Updated <date>", and dateModified, article:modified_time and <time datetime> all equal it', () => {
    const html = render({ modified: '2026-10-03' });
    const times = bylineTimes(html);
    assert.deepEqual(times.map((t) => t.label), ['Published', 'Updated']);
    assert.equal(times[0].datetime, '2026-03-27');
    assert.equal(times[0].text, 'March 27, 2026');
    assert.equal(times[1].datetime, '2026-10-03');
    assert.equal(times[1].text, 'October 3, 2026');
    const a = article(html);
    assert.equal(a.datePublished, '2026-03-27');
    assert.equal(a.dateModified, '2026-10-03');
    assert.equal(metaContent(html, 'article:published_time'), '2026-03-27');
    assert.equal(metaContent(html, 'article:modified_time'), '2026-10-03');
  });

  for (const [why, modified] of [['equal to date', '2026-03-27'], ['earlier than date', '2026-01-02'], ['malformed', '2026-10'], ['missing', undefined], ['not a date', 'yesterday']]) {
    test(`modified ${why}: only "Published", and every date is the publish date`, () => {
      const html = render(modified === undefined ? {} : { modified });
      const times = bylineTimes(html);
      assert.deepEqual(times.map((t) => t.label), ['Published']);
      assert.ok(!/>Updated /.test(html));
      assert.equal(article(html).dateModified, '2026-03-27');
      assert.equal(metaContent(html, 'article:modified_time'), '2026-03-27');
    });
  }

  test('dates stay date-only (no invented time or zone)', () => {
    const html = render({ modified: '2026-10-03' });
    assert.ok(!/T\d{2}:\d{2}/.test(article(html).dateModified));
    assert.ok(!/T\d{2}:\d{2}/.test(metaContent(html, 'article:modified_time')));
  });
});

describe('the modified policy is written down (BLOG-07)', () => {
  test('src/blog/README.md says when to bump modified and that it is never automatic', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'src', 'blog', 'README.md'), 'utf8');
    assert.match(readme, /`modified`/);
    assert.match(readme, /substantive/i);
    assert.match(readme, /never auto/i);
  });
});
