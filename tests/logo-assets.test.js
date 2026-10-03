/**
 * The nav and footer logos are right-sized 2x assets with intrinsic dimensions
 * (PERF-08). The originals are 1979x390 (35 KB WebP / 52 KB PNG) for a 203x40
 * slot. Reads the PNG header directly (no image library).
 *
 *   node --test tests/          (npm test)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'src/assets/images');
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 12, 16), 'IHDR', `${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
}

test('nav logo: 406x80 (2x of 203x40), 15 KB or less', () => {
  const s = pngSize(path.join(IMG, 'logo-horizontal-2x.png'));
  assert.deepEqual([s.width, s.height], [406, 80]);
  assert.ok(s.bytes <= 15 * 1024, `${s.bytes} bytes`);
});

test('footer logo: 2x of 36 px tall, small', () => {
  const s = pngSize(path.join(IMG, 'logo-horizontal-white-2x.png'));
  assert.equal(s.height, 72);
  assert.ok(Math.abs(s.width / s.height - 1979 / 390) < 0.02, 'same aspect ratio as the original');
  assert.ok(s.bytes <= 10 * 1024, `${s.bytes} bytes`);
});

test('every nav and footer logo in source uses the 2x asset with width and height', () => {
  const files = [path.join(ROOT, 'scripts/shared-templates.js')];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (e.name.endsWith('.html')) files.push(f);
    }
  })(path.join(ROOT, 'src'));
  let navs = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const tag of src.match(/<img\b[^>]*logo-horizontal-2x\.png[^>]*>/g) || []) {
      navs++;
      assert.match(tag, /\swidth="203" height="40"/, f);
    }
    for (const tag of src.match(/<img\b[^>]*class="footer__logo"[^>]*>/g) || []) {
      assert.match(tag, /logo-horizontal-white-2x\.png/, f);
      assert.match(tag, /\swidth="183" height="36"/, f);
    }
    // The nav no longer loads the full-size file (portal/partner headers are other sizes).
    if (!/(portal|partner)\.html$/.test(f)) assert.doesNotMatch(src, /logo-horizontal\.(png|webp)/, f);
  }
  assert.ok(navs >= 36, `expected the template plus 35 handcrafted navs, saw ${navs}`);
});

test('the generated-page preload points at the same 2x file (no page fetches both)', () => {
  const pages = fs.readFileSync(path.join(ROOT, 'scripts/builders/pages.js'), 'utf8');
  assert.match(pages, /rel="preload" as="image" type="image\/png" href="\/src\/assets\/images\/logo-horizontal-2x\.png"/);
  assert.doesNotMatch(pages, /logo-horizontal\.webp/);
});
