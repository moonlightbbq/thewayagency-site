/**
 * The hand-made blog pages in src/pages/blog/, frozen (sage-server BL-07,
 * AIA-018).
 *
 * scripts/builders/blog-helpers.js copyBlogPages copies these into build/blog/
 * as they are. They pass none of the gates a markdown post passes (the content
 * calendar, a reviewer's hold, the signed review credit, the front-matter
 * checks of blog-content-guard.js), so any new or edited page there would
 * publish whatever it says, including a "Reviewed by <a licensed agent>"
 * byline and a JSON-LD reviewedBy nobody approved, at any /blog/<name>.html
 * URL, around a hold on the post of that name. The set is therefore frozen:
 * the build copies a page only when its name is listed here and its bytes hash
 * to the listed sha256, and fails otherwise. None of these pages makes a review
 * claim (tests/blog-byline-honesty.test.js keeps it so).
 *
 * New posts are markdown in src/blog/ (src/blog/README.md). Editing one of
 * these pages is a deliberate code change: update its hash here in the same
 * commit (the build's error message prints the new one). SAGE never writes
 * here: AI file blocks can only reach src/, and sage-server
 * hive/lib/parse-file-blocks.js refuses src/pages/blog/ as well as src/blog/.
 *
 * The hash is of the file with CRLF line endings read as LF, so a Windows
 * checkout builds the same.
 */
'use strict';

const crypto = require('crypto');

const LEGACY_BLOG_PAGES = Object.freeze({
  'after-car-accident-kentucky.html': '6152347644bee1e8e6162fba277a666c3f271c015eee3aaadffb1b66b7861f65',
  'bundling-home-auto.html': '26457e541ff6faa7dbf374bcd8716120c9a40836a38db3a3d8b5eabcd76ece29',
  'cyber-safety.html': '23f74a688aa757b9af4f29a793d74d68a0076f116aa13deb7367f96ec382af35',
  'earthquake-insurance.html': '807b405ae01df85893a2af6f505c9b690622320809f965e1eea5cf37bfa9a59a',
  'home-vs-landlord-insurance.html': '233da1a93ac892d2e286c8838dee97d946e2b5d7e381709ef563329dedf3524c',
  'index.html': 'afe0b2f81a6fdee5eeacd2ef9c377bf16ffb5cef2226c4538d83c8b893cdf180',
  'landlord-insurance.html': 'dc19ed2b5f1de6d41599828680029360a65164a7e6600cc78644c53ffb1433fb',
  'medicare-enrollment-guide.html': '9ae6b66ba3f9f721a50dad53205859165ebfc8aa9fe0a42dce374499d38ee427',
  'pet-insurance-guide.html': '77cf6cbb7ec8722e3625e380021af154f016059ed5db3717a66d20bc7716f874',
  'tornado-season.html': '4adec184232f1ac0e91c4608136afb4f51446a1ac25dc9066d5fcfd161f92434',
  'understanding-deductibles.html': '92131d45d970d377515caa79b8c295e94cc5423511002a22f7597540b745d680',
  'winter-storm.html': '6479db09b299e3536d19a571a2afdc861d6aa389694c87f58fdbddeb88dc6657',
  'workers-comp-kentucky.html': '89d964e382b3de92c06caa440fe5ad5fe0f2cfb487abfd6b62fc7e7a3ffa2207',
});

/** sha256 hex of a page's text, CRLF read as LF. */
function legacyPageHash(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Why a file in src/pages/blog/ must not be copied into build/blog/, or null.
 * @param {string} file     the file name
 * @param {string|Buffer} content
 */
function legacyPageProblem(file, content) {
  if (!Object.prototype.hasOwnProperty.call(LEGACY_BLOG_PAGES, file)) {
    return `src/pages/blog/${file} is not one of the frozen hand-made blog pages (scripts/lib/legacy-blog-pages.js): a new post is markdown in src/blog/, where the review gate applies`;
  }
  const got = legacyPageHash(content);
  if (got !== LEGACY_BLOG_PAGES[file]) {
    return `src/pages/blog/${file} changed (sha256 ${got}, frozen ${LEGACY_BLOG_PAGES[file]}): a hand-made blog page passes no review gate, so an edit must update its hash in scripts/lib/legacy-blog-pages.js deliberately`;
  }
  return null;
}

module.exports = { LEGACY_BLOG_PAGES, legacyPageHash, legacyPageProblem };
