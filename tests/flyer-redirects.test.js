/**
 * Y-76 flyer redirects (owner's website brief 11/14 item 3; Y0 design ruling (A)):
 * on /personal/ and /personal/home only, a visit with exactly src=flyer-rv,
 * flyer-co or flyer-ll moves to its new page with the query string and hash
 * unchanged; every other visit, and every other page, is unchanged.
 * The built script runs in a sandbox with a stub location. Synthetic URLs only.
 *
 *   node --test tests/flyer-redirects.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const fr = require('../scripts/lib/flyer-redirects');

// The 22 flyer codes in the owner's brief (BOARD Y-89).
const CODES = ['pl', 'ho', 'au', 're', 'co', 'll', 'fl', 'um', 'cl', 'li', 'eq', 'bt', 'rv', 'mc', 'cc', 'pt', 'gl', 'cp', 'ca', 'wc', 'clm', 'stm'].map((c) => `flyer-${c}`);

/** Run `page`'s built script against a URL query and hash: the URL it moved to, or null. */
function visit(page, search, hash = '') {
  const script = fr.flyerRedirectScript(page);
  if (!script) return null;
  const body = /<script data-flyer-redirect>([\s\S]*)<\/script>/.exec(script)[1];
  let moved = null;
  const location = { search, hash, replace: (u) => { moved = u; }, assign: () => { throw new Error('assign'); } };
  vm.runInNewContext(body, { location, URLSearchParams });
  return moved;
}

describe('which visits move', () => {
  test('all 22 codes on both pages: only the three pairs move, to the table\'s page', () => {
    const moves = [];
    for (const page of ['/personal/', '/personal/home']) {
      for (const code of CODES) {
        const to = visit(page, `?src=${code}`);
        if (to !== null) moves.push(`${page} ${code} -> ${to}`);
      }
    }
    assert.deepEqual(moves.sort(), [
      '/personal/ flyer-ll -> /personal/landlord?src=flyer-ll',
      '/personal/ flyer-rv -> /personal/rv?src=flyer-rv',
      '/personal/home flyer-co -> /personal/condo?src=flyer-co',
    ]);
  });
  test('the query string and the hash are carried over unchanged', () => {
    assert.equal(visit('/personal/', '?src=flyer-rv&rep=JS&utm_source=print', '#quote'), '/personal/rv?src=flyer-rv&rep=JS&utm_source=print#quote');
    assert.equal(visit('/personal/home', '?rep=AB&src=flyer-co'), '/personal/condo?rep=AB&src=flyer-co');
  });
  test('MUST-FAIL: no prefix, contains or case-insensitive match; no src or an empty one is a no-op', () => {
    for (const q of ['', '?', '?src=', '?src=FLYER-RV', '?src=Flyer-rv', '?src=flyer-rv2', '?src=xflyer-rv', '?src=flyer-r', '?src=%20flyer-rv', '?rep=JS', '?source=flyer-rv']) {
      assert.equal(visit('/personal/', q), null, q);
    }
    assert.equal(visit('/personal/home', '?src=flyer-rv'), null, 'flyer-rv belongs to /personal/ only');
    assert.equal(visit('/personal/', '?src=flyer-co'), null, 'flyer-co belongs to /personal/home only');
  });
  test('a src holding markup or a URL is a no-op, and the target never comes from the URL', () => {
    for (const q of ['?src=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '?src=https%3A%2F%2Fevil.example%2F', '?src=//evil.example', '?src=/personal/rv']) {
      assert.equal(visit('/personal/', q), null, q);
    }
    const to = visit('/personal/', '?src=flyer-rv&to=https%3A%2F%2Fevil.example%2F');
    assert.ok(to.startsWith('/personal/rv?'), to);
  });
});

describe('where the script is', () => {
  test('the table: three pairs, each a fixed same-site path', () => {
    assert.equal(fr.FLYER_REDIRECTS.length, 3);
    for (const r of fr.FLYER_REDIRECTS) {
      assert.match(r.to, /^\/personal\/[a-z-]+$/);
      assert.match(r.src, /^flyer-[a-z]+$/);
    }
  });
  test('MUST-FAIL: no other page gets a script', () => {
    for (const p of ['/personal/auto', '/personal/rv', '/personal/condo', '/personal/landlord', '/commercial/', '/life/', '/', '/personal']) {
      assert.equal(fr.flyerRedirectScript(p), '', p);
    }
  });
  test('the built site: the script is on exactly personal/index.html and personal/home.html, first in <head>', () => {
    const build = path.join(ROOT, 'build');
    assert.ok(fs.existsSync(path.join(build, 'personal', 'index.html')), 'npm test builds build/ first (tests/helpers/prebuild.js); run it, or node scripts/build.js'); // Y-97: never skipped
    const found = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.html') && fs.readFileSync(p, 'utf8').includes('data-flyer-redirect')) found.push(path.relative(build, p).split(path.sep).join('/'));
      }
    };
    walk(build);
    assert.deepEqual(found.sort(), ['personal/home.html', 'personal/index.html']);
    for (const f of found) {
      const html = fs.readFileSync(path.join(build, f), 'utf8');
      const at = html.indexOf('data-flyer-redirect');
      assert.ok(at < html.indexOf('googletagmanager.com/gtm.js'), `${f}: before GTM`);
      assert.ok(at < html.indexOf('<title>'), `${f}: first in <head>`);
    }
  });
  test('scripts/build.js checks the pages after the product pages are built', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
    assert.ok(src.indexOf('assertFlyerPages(BUILD)') > src.indexOf('product pages from JSON'));
  });
});

describe('the build refuses a missing page', () => {
  test('MUST-FAIL: a target page that is not built throws, naming it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flyer-redirects-'));
    try {
      fs.mkdirSync(path.join(dir, 'personal'));
      for (const f of ['index.html', 'home.html', 'rv.html', 'condo.html']) fs.writeFileSync(path.join(dir, 'personal', f), '<html></html>');
      assert.throws(() => fr.assertFlyerPages(dir), /no built page for \/personal\/landlord \(flyer-ll\)/);
      fs.writeFileSync(path.join(dir, 'personal', 'landlord.html'), '<html></html>');
      assert.doesNotThrow(() => fr.assertFlyerPages(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('builtFileFor maps site paths to built files', () => {
    assert.equal(fr.builtFileFor('/personal/'), path.join('personal', 'index.html'));
    assert.equal(fr.builtFileFor('/personal/rv'), 'personal/rv.html');
  });
});

// INFERRED landing map (Y0's inference from the owner's brief, 11/14; NOT the
// owner's statement, and not used by any runtime code): which page each flyer's
// QR opens. 'flyer-cl' is unknown and asked of the owner. Used only to check
// that every landing page is built (the live 200 check after merge uses it too).
const INFERRED_LANDING = {
  'flyer-pl': '/personal/', 'flyer-rv': '/personal/', 'flyer-ll': '/personal/', 'flyer-ho': '/personal/home', 'flyer-co': '/personal/home',
  'flyer-au': '/personal/auto', 'flyer-re': '/personal/renters', 'flyer-fl': '/personal/flood', 'flyer-um': '/personal/umbrella',
  'flyer-eq': '/personal/earthquake', 'flyer-bt': '/personal/boat', 'flyer-mc': '/personal/motorcycle', 'flyer-cc': '/personal/classic-car',
  'flyer-pt': '/personal/pet', 'flyer-gl': '/commercial/general-liability', 'flyer-cp': '/commercial/commercial-property',
  'flyer-ca': '/commercial/commercial-auto', 'flyer-wc': '/commercial/workers-compensation', 'flyer-li': '/life/',
  'flyer-clm': '/about/claims', 'flyer-stm': '/contact', 'flyer-cl': null,
};

describe('inferred landing pages (Y0 inference, not the owner\'s list)', () => {
  test('the map covers all 22 codes', () => {
    assert.deepEqual(Object.keys(INFERRED_LANDING).sort(), [...CODES].sort());
  });
  test('the built site: every inferred landing page is built, and a landing that redirects lands on a built page', () => {
    const build = path.join(ROOT, 'build');
    assert.ok(fs.existsSync(path.join(build, 'personal', 'index.html')), 'npm test builds build/ first (tests/helpers/prebuild.js); run it, or node scripts/build.js'); // Y-97: never skipped
    for (const [code, page] of Object.entries(INFERRED_LANDING)) {
      if (page === null) continue;
      assert.ok(fs.existsSync(path.join(build, fr.builtFileFor(page))), `${code}: ${page}`);
      const to = visit(page, `?src=${code}`);
      if (to !== null) assert.ok(fs.existsSync(path.join(build, fr.builtFileFor(to.split('?')[0]))), `${code}: ${to}`);
    }
  });
});
