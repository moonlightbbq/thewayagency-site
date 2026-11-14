/**
 * Bing Webmaster Tools verifies ownership by fetching /BingSiteAuth.xml and re-checks it
 * later, so the file must stay in the repo root and reach the build root on every build.
 * Hermetic: a temp directory stands in for the repo and the build; nothing touches build/.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { copyRootFiles } = require('../scripts/builders/assets');

const ROOT = path.join(__dirname, '..');
const FILE = 'BingSiteAuth.xml';

describe('Bing site verification file', () => {
  test('is in the repo root with exactly one user code', () => {
    const xml = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
    assert.match(xml, /^<\?xml version="1\.0"\?>\s*<users>\s*<user>[0-9A-F]{32}<\/user>\s*<\/users>\s*$/);
  });

  test('copyRootFiles serves it from the build root', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bing-auth-'));
    try {
      const src = path.join(tmp, 'repo');
      const build = path.join(tmp, 'build');
      fs.mkdirSync(src);
      fs.mkdirSync(build);
      fs.copyFileSync(path.join(ROOT, FILE), path.join(src, FILE));
      const log = console.log;
      console.log = () => {};
      try { copyRootFiles(src, build); } finally { console.log = log; }
      assert.strictEqual(fs.readFileSync(path.join(build, FILE), 'utf8'), fs.readFileSync(path.join(ROOT, FILE), 'utf8'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
