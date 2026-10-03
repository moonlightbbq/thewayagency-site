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
  'after-car-accident-kentucky.html': 'a632c1e39c1edca46c1c092e62af7161f3df46388c7b3631c93c3457bdb1fb61',
  'bundling-home-auto.html': 'd774374ece2677163a9945d1f5e7195797c9e36f3f11ee5bff6ac39c0671af80',
  'cyber-safety.html': 'db14be6acee3de55e3afa7b66d99ba38cbb0a0d3dd3f32000284daebb3c4dc4c',
  'earthquake-insurance.html': '29024431eb50bd17adf72866c4ed8922108b70af5b613e99d1c23eeee1f4dee7',
  'home-vs-landlord-insurance.html': 'e1b807b011c0e72c78c3f4dc42cc8dfbe7b90795e0aeca32304c8036ca5adfe8',
  'index.html': '4e1ec220476993ec3c438f42fa23be0bca156342f905ec386414d239cf4badfb',
  'landlord-insurance.html': 'a5c6a644cf99d082417353f881610efc27366a071eb5b17df1dad18dbbebeb4c',
  'medicare-enrollment-guide.html': '1874d36355813b5ffa65e10ac58aba188b79aa14c6c35e82540e30619d80c740',
  'pet-insurance-guide.html': '4e8e7a9f8a995d1cc0fade3806a7ee59a6b850b03a19eb995a1e83f80f3abff8',
  'tornado-season.html': '6696e71de26cd9b265b259508ebc97e0455400916b1e2442d8bec7005bbaab3a',
  'understanding-deductibles.html': '844f01d26ec348261b537cc1ba82f381f0717ea789d2cf1542b8e5468d24a75a',
  'winter-storm.html': '01f9060f99cf7860782e2cd27566ef4bdd09639e0d62477c02e5ca95a53aec2d',
  'workers-comp-kentucky.html': 'a66423a50780f4dc93999e6d39372da997e03983e3310ff61433b4917ece4135',
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
