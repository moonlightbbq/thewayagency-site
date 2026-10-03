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
  'after-car-accident-kentucky.html': '123f3800c48c6f6fd9510640be8db323e85e2dfb5d8d2ba821fe013841782f28',
  'bundling-home-auto.html': 'caf2601007f60210b5f4bc9077933c4728eb2140f3d40ba6b9ad3d62e359e2a1',
  'cyber-safety.html': 'b2815d5efda02988fdbd5f209e788a1e58fe746942f6bb4b24586b1eaf14be90',
  'earthquake-insurance.html': '2e1fae31547546a177ee12e09e4ffdc5921cb31f5d1b3dd236dfde625d6adf79',
  'home-vs-landlord-insurance.html': 'f96fec8ec1bb152a725de320c562d4706b503590f8c1750fc2f2127be1a44938',
  'index.html': 'c20d7b20b2be28b3a103dc130b085abf24431d656057dbdcf349ef5655c02cbe',
  'landlord-insurance.html': 'c66defab1ecae64e7aafc0b6376c9605b4888f2ac93f681c80761b0d51e036c3',
  'medicare-enrollment-guide.html': '406c8425d1b6ee9f43cefd630d16996bbec37d7fee294571ac307a8982e9d774',
  'pet-insurance-guide.html': 'c2304f9c7a103eb8e7e69d9aecc647041e022051f9627853a14c1d815591cc06',
  'tornado-season.html': 'ffccc953b16c11c1e3aea10a51966d93a2e2c30c0e19fccd12d282f1b0c2ea32',
  'understanding-deductibles.html': 'e4700e0adc4f18ce8e41cc8285efe933c64f8271246c03e276484c9040050a54',
  'winter-storm.html': '0d2078c5696c8256236a7f1a7249370c956abb652496a749b282bbb2c4b4a52a',
  'workers-comp-kentucky.html': '1766fd6f789e14642b8ff5b274a1ba70104246ce13eb17145b60b0395dc909ea',
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
