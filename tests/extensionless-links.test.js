/**
 * TECH-02 (url-hygiene PR-1): the site prints extensionless internal URLs.
 * Pages serves /x from x.html and 308s /x.html -> /x, so every .html link is a
 * redirect hop. Nothing here reads or writes build/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { productSlugFromRelatedPage, intakeHref } = require('../scripts/generate-blog');

describe('mid-post CTA keeps its ?product= prefill whatever form related_page takes (TECH-02 step 1)', () => {
  test('productSlugFromRelatedPage accepts the .html and the extensionless form', () => {
    for (const [line, slug] of [['personal', 'auto'], ['commercial', 'general-liability'], ['life', 'term-life'], ['health', 'dental-vision']]) {
      assert.equal(productSlugFromRelatedPage(`/${line}/${slug}.html`), slug);
      assert.equal(productSlugFromRelatedPage(`/${line}/${slug}`), slug);
    }
  });
  test('no prefill for an absent, general or non-product related_page', () => {
    for (const v of [undefined, null, '', 'null', '/personal/', '/contact', '/insurance/owensboro-ky', '/blog/x.html', '/personal/auto/extra']) {
      assert.equal(productSlugFromRelatedPage(v), null, String(v));
      assert.equal(intakeHref(v), '/intake/', String(v));
    }
  });
  test('intakeHref is the same for both forms', () => {
    assert.equal(intakeHref('/personal/auto.html'), '/intake/?product=auto');
    assert.equal(intakeHref('/personal/auto'), '/intake/?product=auto');
  });
});
