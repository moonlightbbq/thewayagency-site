/**
 * Call-and-text pairing lint (CONV-04; docs/CONTENT_RULES.md rule 3).
 * scripts/lib/contact-pairing.js is dependency-free (validate-build.js runs it on
 * Node 18 without npm ci), so these fixtures pin its parsing as well as its rules.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { findContactLinkProblems, findUnpairedTelLinks, contactAnchors } = require('../scripts/lib/contact-pairing');
const { DEFAULT_EXEMPTIONS, D10_EXEMPTIONS } = require('../scripts/lib/contact-pairing-config');

const TEL = '<a href="tel:+15024135335">Call (502) 413-5335</a>';
const SMS = '<a href="sms:+15024135335">Text (502) 413-5335</a>';
const page = (body) => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

describe('findContactLinkProblems', () => {
  test('a sibling sms: link pairs the call link', () => {
    assert.deepEqual(findContactLinkProblems(page(`<p>${TEL} or ${SMS}</p>`)), []);
  });

  test('a tel-only fixture fails', () => {
    const p = findUnpairedTelLinks(page(`<p>Or call us at ${TEL}</p><p>nothing here</p>`), { file: 'x.html' });
    assert.equal(p.length, 1);
    assert.equal(p[0].rule, 'unpaired');
    assert.equal(p[0].file, 'x.html');
    assert.match(p[0].before, /Or call us at$/);
  });

  test('a pair in the grandparent passes (shared footer shape)', () => {
    const html = page(`<div class="brand"><div class="row"><svg><path d="M1 1"/></svg>${TEL}</div><div class="row">${SMS}</div></div>`);
    assert.deepEqual(findContactLinkProblems(html), []);
  });

  test('an sms: link three levels up does not count', () => {
    const html = page(`<section><div><div><p>${TEL}</p></div></div>${SMS}</section>`);
    assert.equal(findUnpairedTelLinks(html).length, 1);
  });

  test('a different number fails on tel: and on sms:', () => {
    const html = page('<p><a href="tel:+18006334227">1-800-MEDICARE</a> <a href="sms:+18006334227">text</a></p>');
    const p = findContactLinkProblems(html);
    assert.deepEqual(p.map((x) => x.rule).sort(), ['number', 'number']);
  });

  test('a producer number paired with the agency text line still fails on the number', () => {
    const html = page(`<p><a href="tel:+15025550123">Call Zz</a> or ${SMS}</p>`);
    const p = findContactLinkProblems(html);
    assert.equal(p.length, 1);
    assert.equal(p[0].rule, 'number');
  });

  test('an sms: body is refused', () => {
    const html = page(`<p>${TEL} <a href="sms:+15024135335?body=Hi%20there">Text</a></p>`);
    assert.deepEqual(findContactLinkProblems(html).map((x) => x.rule), ['sms-body']);
  });

  test('formatting variants of the agency number pass', () => {
    const html = page('<p><a href="tel:+1-502-413-5335">c</a> <a href="sms:+1 (502) 413-5335">t</a></p>');
    assert.deepEqual(findContactLinkProblems(html), []);
  });

  test('links inside <script>, <style> and comments are ignored', () => {
    const html = page(`<script>var x = '<a href="tel:+1' + d + '">';</script><style>a[href^="tel:"]{}</style><!-- ${TEL} --><p>ok</p>`);
    assert.deepEqual(contactAnchors(html), []);
  });

  test('an open <p> is closed by a block start tag, as browsers do', () => {
    // <div> closes the <p>, so the sms link sits beside the p, not inside it.
    const [tel, sms] = contactAnchors(page(`<section><p>${TEL}<div>${SMS}</div></section>`));
    assert.equal(sms.chain.length, tel.chain.length);
    assert.notEqual(sms.chain[sms.chain.length - 1], tel.chain[tel.chain.length - 1]);
  });

  test('an exemption suppresses only the matching link, and reports itself used', () => {
    const html = page(`<main><p>Phone: ${TEL}</p></main><footer><p>${TEL}</p></footer>`);
    const used = new Set();
    const ex = { page: 'ai-disclosure.html', rule: 'unpaired', before: 'Phone:' };
    const p = findContactLinkProblems(html, { file: 'ai-disclosure.html', exemptions: [ex], usedExemptions: used });
    assert.equal(p.length, 1, 'the footer link is still flagged');
    assert.ok(used.has(ex));
    assert.equal(findContactLinkProblems(html, { file: 'other.html', exemptions: [ex] }).length, 2, 'exemptions are per page');
  });
});

describe('exemption list', () => {
  test('every D10 entry names its decision and waits on OA-18', () => {
    assert.ok(D10_EXEMPTIONS.length > 0);
    for (const ex of D10_EXEMPTIONS) {
      assert.match(ex.decision, /D10/);
      assert.match(ex.decision, /OA-18/);
      assert.ok(ex.reason && ex.page && ex.rule);
    }
  });

  test('no exemption covers the number rule or sms bodies', () => {
    for (const ex of DEFAULT_EXEMPTIONS) assert.equal(ex.rule, 'unpaired');
  });
});

describe('source pages that the lint reads after the build', () => {
  // The team page's extension links are paired in the same sentence (D10 asks for
  // "or text" next to each, since a text cannot reach an extension).
  test('/about/team: every extension link has a text link in its sentence', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src/pages/about/team.html'), 'utf8');
    assert.deepEqual(findContactLinkProblems(html, { file: 'about/team.html' }), []);
  });

  test('validate-build.js wires the lint over build/ with the config list', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts/validate-build.js'), 'utf8');
    assert.match(src, /require\('\.\/lib\/contact-pairing'\)/);
    assert.match(src, /DEFAULT_EXEMPTIONS/);
  });

  test('the lint and its config load with no dependencies (Node 18 CI, no npm ci)', () => {
    for (const rel of ['scripts/lib/contact-pairing.js', 'scripts/lib/contact-pairing-config.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      const reqs = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
      assert.deepEqual(reqs.filter((r) => !r.startsWith('.')), [], `${rel} requires a package`);
    }
  });

  test('fails a tel-only fixture build and a different-number fixture build end to end', () => {
    // Run the real lint the way validate-build does, over a temporary build dir.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pairing-'));
    try {
      fs.writeFileSync(path.join(dir, 'tel-only.html'), page(`<p>Call ${TEL}</p>`));
      fs.writeFileSync(path.join(dir, 'other-number.html'), page('<p><a href="tel:+18005550199">c</a> <a href="sms:+18005550199">t</a></p>'));
      fs.writeFileSync(path.join(dir, 'ok.html'), page(`<p>${TEL} ${SMS}</p>`));
      const script = `
        const fs = require('fs'), path = require('path');
        const { findContactLinkProblems } = require(${JSON.stringify(path.join(__dirname, '..', 'scripts/lib/contact-pairing'))});
        let n = 0;
        for (const f of fs.readdirSync(${JSON.stringify(dir)})) {
          for (const p of findContactLinkProblems(fs.readFileSync(path.join(${JSON.stringify(dir)}, f), 'utf8'), { file: f })) { console.log(f, p.rule); n++; }
        }
        process.exit(n ? 1 : 0);`;
      let out = '';
      let code = 0;
      try { out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }); } catch (e) { code = e.status; out = e.stdout; }
      assert.equal(code, 1);
      assert.match(out, /tel-only\.html unpaired/);
      assert.match(out, /other-number\.html number/);
      assert.doesNotMatch(out, /ok\.html/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
