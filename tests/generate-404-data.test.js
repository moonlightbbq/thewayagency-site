/**
 * build/404-suggestions.json carries page titles as text (sage-server BL-07
 * fix round 4, a review nit). generate-blog.js HTML-escapes the <title> it
 * prints, and scripts/generate-404-data.js scrapes titles from the built
 * pages, so without decoding the JSON carried "Agency&#39;s" where main had
 * "Agency's". Runs the real script against a temp tree with synthetic pages.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');

test('titles scraped from built blog pages are decoded back to text', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-404-'));
  try {
    for (const dir of ['scripts', 'data', 'build/blog']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'scripts', 'generate-404-data.js'), path.join(tmp, 'scripts', 'generate-404-data.js'));
    fs.writeFileSync(path.join(tmp, 'data', 'products.json'), JSON.stringify({ personal: [] }));
    fs.writeFileSync(path.join(tmp, 'data', 'landing-pages.json'), JSON.stringify({ cities: [], industries: [] }));
    const page = (title) => `<!DOCTYPE html><html><head><title>${title} | The Way Agency</title></head><body></body></html>`;
    fs.writeFileSync(path.join(tmp, 'build', 'blog', 'test-apostrophe.html'), page('Giving Back: The Way Agency&#39;s Year'));
    fs.writeFileSync(path.join(tmp, 'build', 'blog', 'test-entities.html'), page('Home &amp; Auto: &quot;Bundling&quot; &lt;101&gt; &amp;lt;'));
    const run = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'generate-404-data.js')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const out = JSON.parse(fs.readFileSync(path.join(tmp, 'build', '404-suggestions.json'), 'utf8'));
    const title = (slug) => out.find((s) => s.url === `/blog/${slug}.html`).title;
    assert.equal(title('test-apostrophe'), "Giving Back: The Way Agency's Year");
    assert.equal(title('test-entities'), 'Home & Auto: "Bundling" <101> &lt;', '&amp; is decoded last, once');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
