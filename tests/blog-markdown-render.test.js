/**
 * BLOG-04: markdownToHtml used to turn "1. " lines into bare <li> elements
 * after the "- " pass had already wrapped its own items in <ul>, and the
 * paragraph pass then put those bare items inside a <p>. Twelve posts carried
 * 57 orphan <li> (Lighthouse "listitem" failed), and base.css reset the list
 * markers, so readers saw no numbers either.
 *
 * Pure: renders fixture strings and the markdown in src/blog/ in memory; never
 * runs the build or writes build/ (node --test runs suites in parallel).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const { markdownToHtml, wrapOrderedLists } = require('../scripts/generate-blog');

const ROOT = path.join(__dirname, '..');

/** <li> elements whose parent is not a <ul> or <ol>, after HTML5 parsing. */
function orphanItems(html) {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  return [...doc.querySelectorAll('li')].filter((li) => !/^(UL|OL)$/.test(li.parentElement.tagName));
}

function lists(html, tag) {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  return [...doc.querySelectorAll(tag)];
}

describe('ordered lists (BLOG-04)', () => {
  test('a tight list is one <ol> with items 1..N, and the text around it stays in paragraphs', () => {
    const html = markdownToHtml('Intro line.\n\n1. **First** step\n2. Second step\n3. Third step\n\nAfter the list.');
    const ols = lists(html, 'ol');
    assert.equal(ols.length, 1);
    assert.deepEqual([...ols[0].children].map((li) => li.textContent), ['First step', 'Second step', 'Third step']);
    assert.equal(ols[0].getAttribute('start'), null);
    assert.ok(html.includes('<strong>First</strong>'), 'inline markup still converts inside items');
    assert.equal(orphanItems(html).length, 0);
    assert.ok(!html.includes('<p><li>'));
    assert.ok(!/<p>(?:(?!<\/p>)[\s\S])*<ol/.test(html), 'the list is not inside a paragraph');
    assert.match(html, /<p>Intro line\.<\/p>/);
    assert.match(html, /<p>After the list\.<\/p>/);
  });

  test('a loose list (one blank line between items) is still ONE <ol>', () => {
    const html = markdownToHtml('1. Alpha\n\n2. Beta\n\n3. Gamma\n\nClosing paragraph.');
    const ols = lists(html, 'ol');
    assert.equal(ols.length, 1);
    assert.equal(ols[0].children.length, 3);
    assert.equal(orphanItems(html).length, 0);
    assert.match(html, /<p>Closing paragraph\.<\/p>/);
  });

  test('a list that starts at 3 keeps its numbering with start="3"', () => {
    const html = markdownToHtml('3. Third\n4. Fourth');
    const [ol] = lists(html, 'ol');
    assert.equal(ol.getAttribute('start'), '3');
    assert.equal(ol.children.length, 2);
  });

  test('a list directly under a paragraph line (no blank line) is not swallowed by the paragraph', () => {
    const html = markdownToHtml('Here is the process:\n1. One\n2. Two');
    assert.equal(lists(html, 'ol').length, 1);
    assert.equal(orphanItems(html).length, 0);
    assert.match(html, /<p>Here is the process:<\/p>/);
  });

  test('two lists separated by a paragraph stay two lists', () => {
    const html = markdownToHtml('1. A\n2. B\n\nMiddle.\n\n1. C\n2. D');
    assert.equal(lists(html, 'ol').length, 2);
  });

  test('"- " lists still produce <ul>, and a mixed post has no orphan items', () => {
    const html = markdownToHtml('- one\n- two\n\n1. first\n2. second\n\n- three');
    assert.equal(lists(html, 'ul').length, 2);
    assert.equal(lists(html, 'ol').length, 1);
    assert.equal(orphanItems(html).length, 0);
  });

  test('item text stays escaped', () => {
    const html = markdownToHtml('1. <script>alert(1)</script>');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('wrapOrderedLists leaves text without numbered lines unchanged', () => {
    const text = 'Plain line\n\nAnother 1. not a list';
    assert.equal(wrapOrderedLists(text), text);
  });

  test('every markdown post in src/blog renders with 0 orphan <li> and no <p><li>', () => {
    const dir = path.join(ROOT, 'src', 'blog');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
    assert.ok(files.length > 10);
    for (const f of files) {
      const body = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
      const html = markdownToHtml(body);
      assert.equal(orphanItems(html).length, 0, `${f}: orphan <li>`);
      assert.ok(!html.includes('<p><li>'), `${f}: <p><li>`);
    }
  });
});

describe('ordered-list markers (BLOG-04 CSS)', () => {
  test('blog.css restores decimal markers on blog ordered lists (base.css resets ul,ol to none)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'css', 'blog.css'), 'utf8');
    assert.match(css, /\.blog-content ol\{list-style:decimal\}/);
  });
});
