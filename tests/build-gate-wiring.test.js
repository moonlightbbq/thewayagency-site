/**
 * The cross-repo guard has to actually RUN (ticket c2cc96ea, round 3).
 *
 * check-intake-gate.js exports two halves:
 *
 *   checkIntakeGate()   — static: reads this repo's own markup.
 *   checkDeclineCopy()  — cross-repo: fetches GET /api/intake/rules from SAGE and
 *                         fails the build if the decline copy has started pitching
 *                         commercial, or if this form offers a product tile SAGE
 *                         cannot classify.
 *
 * scripts/build.js called only the first one. The second ran solely when
 * check-intake-gate.js was executed as main — which no build, no workflow and no
 * npm script ever did. So the guarantee that the two repos agree about who we are
 * licensed to write, and about what we say to the people we turn away, was enforced
 * by nothing at all, while the comments claimed it was enforced by the build.
 *
 * These tests do not call checkDeclineCopy() directly — that would prove nothing
 * about the wiring, which is the whole defect. They run the REAL `node
 * scripts/build.js` against a stub SAGE and check the build's exit code.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'scripts', 'build.js');

// A healthy GET /api/intake/rules, as SAGE serves it. The decline apologises and
// says nothing whatsoever about commercial lines — we write CL nationwide, but the
// owner was explicit that this is for us to know and never to pitch to a
// personal-lines applicant we are declining.
const GOOD_RULES = {
  serviceStates: ['KY', 'IN', 'TN'],
  stateNames: { KY: 'Kentucky', IN: 'Indiana', TN: 'Tennessee' },
  stateToken: '{{STATE}}',
  declineTemplate:
    "We're really sorry, but we aren't licensed to write personal insurance in {{STATE}}. "
    + 'We can only take care of folks in Kentucky, Indiana and Tennessee right now, so we '
    + "can't help with this one. We hate to turn you away, and we hope you find great coverage.",
  // Every tile the form offers has to be classifiable. The list is read off the real
  // PRODUCTS grid in src/intake.html so this stub cannot drift away from the page.
  productLines: productIdsFromForm().reduce((m, id) => { m[id] = 'personal'; return m; }, {}),
};

function productIdsFromForm() {
  const html = require('node:fs').readFileSync(path.join(ROOT, 'src', 'intake.html'), 'utf8');
  const grid = html.match(/const PRODUCTS = \[[\s\S]*?\n\];/);
  const ids = grid ? [...grid[0].matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]) : [];
  return ids.filter((id) => id !== 'other');
}

// Run the real build against the stub. Resolves with the exit code + output.
function runBuild(sageApi) {
  return new Promise((resolve) => {
    execFile('node', [BUILD], {
      cwd: ROOT,
      env: { ...process.env, SAGE_API: sageApi },
      timeout: 60000,
    }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout) + String(stderr) });
    });
  });
}

describe('scripts/build.js actually enforces the cross-repo intake gate', () => {
  let srv, rules, url;

  before(async () => {
    rules = structuredClone(GOOD_RULES);
    // One server for all the tests; each test swaps what it serves.
    srv = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        if (req.url === '/api/intake/rules') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rules));
          return;
        }
        res.writeHead(404).end();
      });
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    url = `http://127.0.0.1:${srv.address().port}`;
  });

  after(() => { if (srv) srv.close(); });

  // The control. If this fails, every "the build refuses" assertion below is
  // worthless, because the build would be failing for some unrelated reason.
  test('CONTROL: the build passes when SAGE and the form agree', async () => {
    rules = structuredClone(GOOD_RULES);
    const { code, out } = await runBuild(url);
    assert.equal(code, 0, `build should pass with healthy rules:\n${out}`);
    assert.match(out, /Intake out-of-area decline intact/);
  });

  // THE DEFECT. The decline must never mention commercial lines. Before this fix the
  // build never looked, because it never called checkDeclineCopy().
  test('the build REFUSES a decline that has started pitching commercial', async () => {
    rules = structuredClone(GOOD_RULES);
    rules.declineTemplate = "We're sorry, we aren't licensed to write personal insurance in "
      + '{{STATE}}. If you need commercial coverage, please call us and we can help.';

    const { code, out } = await runBuild(url);
    assert.equal(code, 1, `build should have failed on a CL pitch:\n${out}`);
    assert.match(out, /decline copy mentions commercial lines/);
  });

  // The other half: a product tile the server cannot classify. This is exactly how
  // special_event slipped through — the form offered it, SAGE had never heard of the
  // id, and the two sides silently disagreed about whether we could write it.
  test('the build REFUSES a product tile SAGE cannot classify', async () => {
    rules = structuredClone(GOOD_RULES);
    delete rules.productLines.bop;   // the form still offers it; SAGE no longer knows it

    const { code, out } = await runBuild(url);
    assert.equal(code, 1, `build should have failed on an unclassifiable tile:\n${out}`);
    assert.match(out, /SAGE cannot classify/);
    assert.match(out, /bop/);
  });

  // A warm decline is the entire point of the ticket. Copy that stops apologising is
  // a validation error wearing a decline's clothes.
  test('the build REFUSES a decline that no longer apologises', async () => {
    rules = structuredClone(GOOD_RULES);
    rules.declineTemplate = 'Personal insurance is not available in {{STATE}}.';

    const { code, out } = await runBuild(url);
    assert.equal(code, 1, `build should have failed on a cold decline:\n${out}`);
    assert.match(out, /no longer apologises/);
  });

  // A deploy must never be blocked because SAGE is briefly unreachable — the server
  // enforces these rules itself; the build check is a drift tripwire, not a gate on
  // SAGE's uptime.
  test('the build still passes when SAGE is unreachable', async () => {
    // Port 9 (discard) — nothing is listening.
    const { code, out } = await runBuild('http://127.0.0.1:9');
    assert.equal(code, 0, `an unreachable SAGE must not block a deploy:\n${out}`);
    assert.match(out, /skipping the live decline-copy check/);
  });
});
