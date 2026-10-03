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
  'after-car-accident-kentucky.html': '28f53569f156d4b5ca79785e53f276d059ee3b18d17a325d0248ae12dd432de1',
  'bundling-home-auto.html': 'a1aeba4ae16bcb2022403b3498def7ebb6c0a62fc20fd3f348b35b0a19ec2e4f',
  'cyber-safety.html': '20793ea046c6f7f7d0721b9dcfa0d504a81d102da3e601cbca66506fd1704918',
  'earthquake-insurance.html': 'ae8be11bbcf07804fba9b8bb8c15a1f11dea048a08c4188ebd599e0fa6767834',
  'home-vs-landlord-insurance.html': '39cc1b7aa886a39209df6732e96f84518511499d8a154264b4fe0e9be4cde696',
  'index.html': 'd0c58167573ff66f351330a98076e4ae1efd3c9cc5cba1f92870b22084a6d945',
  'landlord-insurance.html': 'b201a8cc342c8d3d1449fe75a00cbb6a310a32ad9cc05dcfc02cb70dfe1ccc72',
  'medicare-enrollment-guide.html': '977a9a3a37ffd7873020eab6fff78412d0c4b8842b7c6cfb58359c0da5eea858',
  'pet-insurance-guide.html': 'b43827e78e5dc6b169c77fe6c8d8312c4bc65ac5f427721bf426a3c262de39d6',
  'tornado-season.html': 'c5bed8bdf752b0d241cf36511a79bbeb355e711fa24f8a9b6af45a7ea3b1f810',
  'understanding-deductibles.html': '6308f981611b3b16a3ccd3145b01c47d4238a48a94e4ebf6cc457f50c75b5ef1',
  'winter-storm.html': '18ec5abf91f73b8297baade26a3c5123de1cde49f5c45adfb00b75ff9181bc00',
  'workers-comp-kentucky.html': 'c7b2ed773be830b31d4681ef0c7569192bef1834398920e2d756db16599c6d6a',
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
