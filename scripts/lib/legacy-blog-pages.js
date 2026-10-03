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
  'after-car-accident-kentucky.html': '00a4dc24eca403e3a87e7b12c5806f7b110a766a544a5121d42c5c1e421646de',
  'bundling-home-auto.html': 'ad14538f18add71e0f9433dac7e8ca7d16fb25060fc85610c97f2923881e7dde',
  'cyber-safety.html': '3217d72aff522f0a351578afc9d7bda59a80e1677e0fd8c0ddc8431e10440e57',
  'earthquake-insurance.html': '000d83792aee21fa5c25348e27407013850f374cd45740ec1866b1a3dc874946',
  'home-vs-landlord-insurance.html': '57acab7fb1cacaa0cfee3ca3403af71888de6f94f2187ea3123d7bd8c6e49b52',
  'index.html': '36b0ad7e76950c8f09778041b5e059f129f39a4af023bce63f7f8a170540ebb9',
  'landlord-insurance.html': '2accc51867f7ba7ec7b11d72b52a70d45a16594b1d73741ce09428a169472d39',
  'medicare-enrollment-guide.html': '7a097a40dcba53e55893154fa7bb6012114cab6d4cbd618ea9a4662c178cdf04',
  'pet-insurance-guide.html': '2175de8960905ccdc5f7231e939307868d1e384e78192a5c2809995ea60339d5',
  'tornado-season.html': '5e0ea9fc94e4c2c5faac2a4479e9d897266380781d2df2d2bf6dddb3159cc270',
  'understanding-deductibles.html': '71dc89adc875c7a90088364b4beb76ba054ad2ab3a53608d7cd2ec07f2f6dddc',
  'winter-storm.html': '14d766135361a06438a2073f6e14ee93795542aec3a7784b2f456f04ba26b177',
  'workers-comp-kentucky.html': 'b6b652083d8052e2da45ab2a5ec7b0fe0fcba5bd391f08d2c0fd496c6900190a',
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
