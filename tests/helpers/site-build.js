/**
 * Y-97: building the site from tests without racing other tests.
 *
 * `node --test` runs test files in parallel. tests/build-gate-wiring.test.js
 * used to run the REAL build in the repo, so build/ was rewritten (or left half
 * built by a refused build) while other files read it. Those other files are
 * licensed-states-guard, agency-email-guard and flyer-redirects. In CI, where no
 * build exists before `npm test`, whether they RAN or SKIPPED depended on
 * scheduling.
 *
 * Now:
 *   - `npm test` builds build/ once, first (tests/helpers/prebuild.js), against a
 *     stub SAGE. Every "the built site" test reads that build and never skips.
 *   - a test that needs builds of its own (build-gate-wiring) builds in a
 *     throwaway copy of the repo (copySite), never in the repo.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

function productIdsFromForm(root = ROOT) {
  const html = fs.readFileSync(path.join(root, 'src', 'intake.html'), 'utf8');
  const grid = html.match(/const PRODUCTS = \[[\s\S]*?\n\];/);
  const ids = grid ? [...grid[0].matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]) : [];
  return ids.filter((id) => id !== 'other');
}

// A healthy GET /api/intake/rules, as SAGE serves it. The decline apologises and
// says nothing whatsoever about commercial lines. We write CL nationwide, but the
// owner was explicit that this is for us to know and never to pitch to a
// personal-lines applicant we are declining. Every tile the form offers has to be
// classifiable; the list is read off the real PRODUCTS grid in src/intake.html so
// this stub cannot drift away from the page.
function goodRules(root = ROOT) {
  return {
    serviceStates: ['KY', 'IN', 'TN'],
    stateNames: { KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' },
    stateToken: '{{STATE}}',
    declineTemplate:
      "We're really sorry, but we aren't licensed to write personal insurance in {{STATE}}. "
      + 'We can only take care of folks in Kentucky, Indiana and Tennessee right now, so we '
      + "can't help with this one. We hate to turn you away, and we hope you find great coverage.",
    productLines: productIdsFromForm(root).reduce((m, id) => { m[id] = 'personal'; return m; }, {}),
  };
}

/** A local stand-in for SAGE's /api/intake/rules. `rules()` is read on every request. */
function startStubSage(rules) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url === '/api/intake/rules') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rules()));
        return;
      }
      res.writeHead(404).end();
    });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) }));
  });
}

/**
 * Run `node scripts/build.js` in `root` against `sageApi`. Resolves { code, out }.
 * Refuses the repo itself unless { repo: true } (only prebuild.js passes it):
 * a test that builds builds in copySite().
 */
function runBuild(root, sageApi, { repo = false } = {}) {
  if (!repo && fs.realpathSync(root) === fs.realpathSync(ROOT)) {
    return Promise.reject(new Error('runBuild: a test builds in copySite(), never in the repo (other test files read build/ while it runs)'));
  }
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'scripts', 'build.js')], {
      cwd: root,
      env: { ...process.env, SAGE_API: sageApi },
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout) + String(stderr) });
    });
  });
}

/**
 * A throwaway copy of the repo to build in: everything but .git, build/ and
 * node_modules (linked, not copied). The caller removes it with `done()`.
 */
function copySite(prefix = 'site-build-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const skip = new Set(['.git', 'build', 'node_modules']);
  fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !skip.has(path.relative(ROOT, src).split(path.sep)[0]) });
  fs.symlinkSync(fs.realpathSync(path.join(ROOT, 'node_modules')), path.join(dir, 'node_modules'), 'dir');
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

module.exports = { ROOT, productIdsFromForm, goodRules, startStubSage, runBuild, copySite };
