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
  'after-car-accident-kentucky.html': '5daeffdadb2f6f63ed92c34e4235a9508539517fb66c0945b1da967e29cbb7cc',
  'bundling-home-auto.html': '5c609624f627aee9c9007b6088f1d632cc3173787574435995de3b915fcf1502',
  'cyber-safety.html': 'b8e7cce06a8b75b420aee48389df60c24d54f7c5c1a74548aa210d17edf731e7',
  'earthquake-insurance.html': 'bdee5bf5cbacc0b0a6f48d6c20413849b83e08bc656719f33d8969fd94338573',
  'home-vs-landlord-insurance.html': '10b16775ae5be50e10adc4f177010afaed88103b0022736fd4f867a6ac6ff4f3',
  'index.html': '3877b98c7730e5fe526b9368f42a3fc4188e4ddf1950c4e9f5846905a1e4a78e',
  'landlord-insurance.html': 'a1e55b53e30b60a0d963ddb3f5922b3ac25651f63756d7780245f91d742c6c4b',
  'medicare-enrollment-guide.html': 'ab8d5ac074f3e515a7f1508c7f204769abfdbdce4d3b521b677ac20750104ac4',
  'pet-insurance-guide.html': 'cc0f2376a8311c01859b94eb0dc547d298472f52175344b9ee223a446f6c4227',
  'tornado-season.html': 'ad17450937ff72b529debba31aa98cf998d7572c1ee22fa7154fd4fff3dcae61',
  'understanding-deductibles.html': '92731c3803551aaab9f5e69ba995331b678663861b799da081e43b2708ef8083',
  'winter-storm.html': '04feb935526d96b67f20bf3411fe003ad07460520779d5f2bdf3e58e78e1646d',
  'workers-comp-kentucky.html': 'b9b357f5b7836c7cc23fc961a8fbc9792395678bf469f44d2d641da7c9d13a30',
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
