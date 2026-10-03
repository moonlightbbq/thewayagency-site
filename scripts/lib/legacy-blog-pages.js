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
  'after-car-accident-kentucky.html': '54596d39c00614a855aad922972e76a3b260a77bbab42136d9990432f3957cbe',
  'bundling-home-auto.html': 'e109097168b444d16bcdc9f5f8004ccdd03f9ff2d4cb827adbb08e56266c3814',
  'cyber-safety.html': '40ebca5cb113a0a2882e0e29164f67be1d61bea8ff40458015c86c008a01c9a2',
  'earthquake-insurance.html': '943c97aacb37d8d1dc545c9d99aa886d4b3c2c90e231f5154a796d8f901162f1',
  'home-vs-landlord-insurance.html': '9db856d000c60ae3ae4c6b4f911785012408ee3a47ac08d93d5791000ff49e92',
  'index.html': 'c2f0d0121388ad6157f26506afd68f27ce96fc17c5ed278b2112c5e27632f4d4',
  'landlord-insurance.html': 'f5b1d6498150d0e4fde602cdd426b33571d2a3f476b3e09b28ba4e11db4c7b76',
  'medicare-enrollment-guide.html': '34db184059b45895cc394040c8f4bac135689ebe5e6e8422a08d03e5b2f536fc',
  'pet-insurance-guide.html': '755d335d4b769c3af2dcdce3b72d989fbb89b131f073565faec5f21d24818a8b',
  'tornado-season.html': '4feb7efd5beba77447a355fc16e378443eb4c798fdaac2030d3488590687526f',
  'understanding-deductibles.html': '5014047eb218679a0261c61a478817c81d84987a91498aacf8499ba6b3f824c6',
  'winter-storm.html': '831eb389caa9099c009e6c72298d424a4206b64ad7469bf785e3e35f46bd7f07',
  'workers-comp-kentucky.html': '6a4cc72d0e972b937f2f56d6d91c0876ec1f6ef9dd463d00aacbeb236e7fb288',
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
