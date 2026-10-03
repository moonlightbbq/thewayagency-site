/**
 * IndexNow (AEO-02): the post-deploy job submits only URLs whose built page
 * changed, after production serves them, and never from build.js.
 *
 * Everything here runs on temporary directories: no test runs scripts/build.js
 * or writes build/, and nothing reaches the network.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const {
  findKeyFile, normalizeHtml, sitemapUrls, urlToFile, diffBuilds, onlyNonBuildPaths,
} = require('../scripts/indexnow');
const { copyRootFiles } = require('../scripts/builders/assets');

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-test-')); }
function put(dir, rel, text) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}
const sitemap = (paths) => `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>https://www.thewayagency.com${p}</loc></url>`).join('')}</urlset>`;
const page = (body, stamp) => `<!DOCTYPE html>\n<!-- build: ${stamp} | main | 2026-10-0${stamp.length % 9}T00:00:00.000Z -->\n<html><head><meta charset="UTF-8">\n  <meta name="build-version" content="${stamp}"></head><body>${body}<!-- build: ${stamp} --></body></html>`;

describe('IndexNow key file', () => {
  test('exactly one <32 hex>.txt at the repo root, holding its own name', () => {
    const { name, key } = findKeyFile(ROOT);
    assert.match(name, /^[0-9a-f]{32}\.txt$/);
    assert.equal(key + '.txt', name);
    // Not a low-entropy placeholder: IndexNow keys must be random.
    assert.ok(new Set(key).size >= 8);
  });

  test('copyRootFiles serves it from the build root', () => {
    const { name } = findKeyFile(ROOT);
    const src = tmpdir(); const build = tmpdir();
    fs.copyFileSync(path.join(ROOT, name), path.join(src, name));
    fs.writeFileSync(path.join(src, 'robots.txt'), 'User-agent: *\n');
    fs.writeFileSync(path.join(src, 'notes.txt'), 'not a key\n');
    copyRootFiles(src, build);
    assert.equal(fs.readFileSync(path.join(build, name), 'utf8'), fs.readFileSync(path.join(src, name), 'utf8'));
    assert.ok(fs.existsSync(path.join(build, 'robots.txt')));
    assert.ok(!fs.existsSync(path.join(build, 'notes.txt')));
  });

  test('findKeyFile refuses a mismatched or missing key file', () => {
    const d = tmpdir();
    assert.throws(() => findKeyFile(d), /found 0/);
    fs.writeFileSync(path.join(d, 'a'.repeat(32) + '.txt'), 'b'.repeat(32));
    assert.throws(() => findKeyFile(d), /does not match/);
  });
});

describe('changed-URL computation', () => {
  test('normalizeHtml removes only the build stamps', () => {
    assert.equal(normalizeHtml(page('<p>Hi</p>', '2026-10-03-aaaaaaa')), normalizeHtml(page('<p>Hi</p>', '2026-10-04-bbbbbbb')));
    assert.notEqual(normalizeHtml(page('<p>Hi</p>', 'x')), normalizeHtml(page('<p>Hello</p>', 'x')));
    // The ?v= cache-bust carries the build version on every page.
    const css = (v) => `<link rel="stylesheet" href="/src/css/base.css?v=${v}"><p>Hi</p>`;
    assert.equal(normalizeHtml(css('2026-10-03-aaaaaaa'), '2026-10-03-aaaaaaa'), normalizeHtml(css('2026-10-04-bbbbbbb'), '2026-10-04-bbbbbbb'));
  });

  test('sitemapUrls and urlToFile follow the build layout', () => {
    const d = tmpdir();
    put(d, 'index.html', 'x'); put(d, 'contact.html', 'x'); put(d, 'personal/index.html', 'x'); put(d, 'insurance/owensboro-ky.html', 'x');
    assert.deepEqual(sitemapUrls(sitemap(['/', '/contact'])), ['https://www.thewayagency.com/', 'https://www.thewayagency.com/contact']);
    assert.equal(urlToFile(d, 'https://www.thewayagency.com/'), path.join(d, 'index.html'));
    assert.equal(urlToFile(d, 'https://www.thewayagency.com/contact'), path.join(d, 'contact.html'));
    assert.equal(urlToFile(d, 'https://www.thewayagency.com/personal/'), path.join(d, 'personal', 'index.html'));
    assert.equal(urlToFile(d, 'https://www.thewayagency.com/insurance/owensboro-ky'), path.join(d, 'insurance', 'owensboro-ky.html'));
  });

  test('diffBuilds lists changed and new sitemap pages and dropped URLs, ignoring build stamps and noindexed pages', () => {
    const base = tmpdir(); const head = tmpdir();
    put(base, 'version.json', JSON.stringify({ version: 'b1' }));
    put(head, 'version.json', JSON.stringify({ version: 'h1' }));
    put(base, 'sitemap.xml', sitemap(['/', '/contact', '/blog/old-post']));
    put(head, 'sitemap.xml', sitemap(['/', '/contact', '/blog/new-post']));
    put(base, 'index.html', page('<p>Home</p><a href="/x.css?v=b1">', 'b1'));
    put(head, 'index.html', page('<p>Home</p><a href="/x.css?v=h1">', 'h1')); // stamps only: unchanged
    put(base, 'contact.html', page('<p>Call</p>', 'b1'));
    put(head, 'contact.html', page('<p>Call or text</p>', 'h1')); // changed
    put(base, 'blog/old-post.html', page('old', 'b1'));
    put(head, 'blog/new-post.html', page('new', 'h1')); // added
    put(base, 'intake/index.html', page('form', 'b1'));
    put(head, 'intake/index.html', page('form v2', 'h1')); // not in the sitemap: never submitted
    const r = diffBuilds(base, head);
    assert.deepEqual(r.changed, ['https://www.thewayagency.com/contact', 'https://www.thewayagency.com/blog/new-post']);
    assert.deepEqual(r.removed, ['https://www.thewayagency.com/blog/old-post']);
  });

  test('ranges that touch only non-build paths skip the build', () => {
    assert.equal(onlyNonBuildPaths(['.github/workflows/x.yml', 'docs/a.md', 'tests/a.test.js', 'README.md']), true);
    assert.equal(onlyNonBuildPaths(['docs/a.md', 'src/pages/index.html']), false);
    assert.equal(onlyNonBuildPaths(['data/content-calendar.json']), false);
  });
});

describe('wiring', () => {
  test('build.js never submits to IndexNow', () => {
    const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
    assert.doesNotMatch(build, /indexnow/i);
  });

  test('the workflow runs after a production deploy, is gated, and keeps the key out of its text', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'indexnow.yml'), 'utf8');
    assert.match(wf, /branches: \[main\]/);
    assert.match(wf, /indexnow\.js wait/);
    assert.match(wf, /indexnow\.js changed/);
    assert.match(wf, /vars\.INDEXNOW_ENABLED == 'true'/);
    assert.doesNotMatch(wf, /[0-9a-f]{32}/);
  });
});
