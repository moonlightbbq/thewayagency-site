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
  'after-car-accident-kentucky.html': '25b8f8558dc0aca72b04bee6b41507ea8cdb5cb68a7c4d869eb994966e9a038c',
  'bundling-home-auto.html': 'ace5d613eceac7b499037a153657f4967ac11bd025cdc34c8d5d3687a63a55be',
  'cyber-safety.html': 'f3ab529aaeca21ddf90d85ed1c35d6679d86efeb1f551e09664df59d0c660b38',
  'earthquake-insurance.html': 'ccb49f4f2833b29f6a71f28c396329e3bad30a59bbbceb7a618fb07430016566',
  'home-vs-landlord-insurance.html': '549c09a31aaa2212b58a51debc9376e43f5b3290b5c39f81dd9500ebabc95080',
  'index.html': 'fae40302cba4c41f0445dd81fe8a01d7cfa9bc402ef583631c2e3e89caf2f151',
  'landlord-insurance.html': '463abe47bac867214e0a71558d5bfa096da0c92a8dd9a20a4fb18aab51edddbd',
  'medicare-enrollment-guide.html': '2882d8849a685a969927e635a89b2853e68425bb3da02fea8d4f56b087bdc9de',
  'pet-insurance-guide.html': '1081bec9f1d4abcdb573b9179745d7f365c55de47084d77f838b9096e35be873',
  'tornado-season.html': '05c23541ecb1ab8d82b289cf95fe3e1b35ca08a5512b85fd7a536ac6efa110b9',
  'understanding-deductibles.html': 'd02ede38b1e5b3728211af049d89dd1d6893d90793228b6be980c7983ea76533',
  'winter-storm.html': '11f68546480a82cf4d026a75f1b09eab210459404c11a6127b758896246d88e8',
  'workers-comp-kentucky.html': '03c3694e3f37b4266c6f2114596921cbef92b2251da642c50690755114c03cd3',
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
