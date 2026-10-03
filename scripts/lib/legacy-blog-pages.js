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
  'after-car-accident-kentucky.html': '03f98c2934b3e298d975187f6820aa31364210359993bbcbc2a521c994944758',
  'bundling-home-auto.html': '2a16db22f38908275ffcbfc35640600eb1ed8161ad8ba6bb9cb631ba11ca1690',
  'cyber-safety.html': '1e7d695310642e86e87272908c35aff9826168a26d7facdde522da2853ab0a80',
  'earthquake-insurance.html': '7058d21ada1a2f8abdfb86ef6f0b397227af6765fda11094174def0bb169d77b',
  'home-vs-landlord-insurance.html': 'a20e430fed95837bcec1d60edbbce27562b36b490f1f55fc254861682700514b',
  'index.html': 'fae40302cba4c41f0445dd81fe8a01d7cfa9bc402ef583631c2e3e89caf2f151',
  'landlord-insurance.html': '9e23d01625d90431dd4c45a44838b2cc87e3de896b67d3294eb50435e7525c41',
  'medicare-enrollment-guide.html': '791f4688fc6f051b806d95193bf082c4e47508d503e8617a3a2f1b007027c062',
  'pet-insurance-guide.html': '597abad4e8ce4d590d735db899ce52662f34a41ba0b2770fcb9f23cd727f59c0',
  'tornado-season.html': '809d0ce285cda0f065ef8ba509d2ffdff6e6efd6aab376e2f7572b401f35c0b3',
  'understanding-deductibles.html': 'ac75080599aca8518358f721add1b996f69cd66c818250b32236f636e6f5f248',
  'winter-storm.html': '8fad02a3d854679343418efc6a0ea9857a4b3cab29b23b68b9cd20341528d17c',
  'workers-comp-kentucky.html': '49d3da212c4e5131a589a17bac6ba813675d53a4568084ceaf108d9a36d396b7',
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
