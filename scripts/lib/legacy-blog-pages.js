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
  'after-car-accident-kentucky.html': '20a0368921e2c36cab1a3a309ced299687b78dc061a6f1afc05aed465724b245',
  'bundling-home-auto.html': '21db90d4c65ac766be461d606d10c04239fe1ea4fe6381f388c9f029f0b026e0',
  'cyber-safety.html': 'a2d901385f14d12a974e4f50798254df2dc4ea80a88d08d8d1a0f38b320a135a',
  'earthquake-insurance.html': 'fa2e7623be4832c8348f4786911df973381ec941bbbe060e99029b5f5df57273',
  'home-vs-landlord-insurance.html': '087e2749fbd8fc6979ef74733f2704548afb7de3c0d47e033314b7948d9b6817',
  'index.html': '2409619e80d9f53b551c6065777a5bae504be843d6e9e7d876f604628a252268',
  'landlord-insurance.html': '795bb70ca43f8e175bbfc0eb2db5fb17d5efddb6273983180c801bc073393d72',
  'medicare-enrollment-guide.html': '18dd74d6bb8d58b50ef5d4b3c75120d37747a8596705f2252bd63ecaeb768cc6',
  'pet-insurance-guide.html': '2fcdb33339adc020ba5019632d55dfac5ccc8d5885939cbe91fc265f4413b1a4',
  'tornado-season.html': 'efd7b537f69249b040eda8457cc650b6bc61d0edd9fd602b0fdba43148448484',
  'understanding-deductibles.html': '8197ae9023d011cd5287fa869e746d6a5f3be08753193cc58f65755e6c0fcc92',
  'winter-storm.html': '83f5ddb3a504dd7a1a7fd6a756367519db5d7395b483fcbd9a9ba2077d266da0',
  'workers-comp-kentucky.html': '90ae415cc963633c99abf91b2c166f33826f74e1c5557a64ce71011f3d040be7',
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
