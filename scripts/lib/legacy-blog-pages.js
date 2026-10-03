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
  'after-car-accident-kentucky.html': '181522f8665b355cfe20d324ffcd976e0107e73b5da7e8e29b82963c0d7fd497',
  'bundling-home-auto.html': '84915595b795cfb050a9e7559f0754eab2b228b22c6cc7aaf156463bbcde6bc2',
  'cyber-safety.html': '46d6f5498682ceed0258148b70f5bcdad1ae869fed179960b81b28113dec80c0',
  'earthquake-insurance.html': '31d4316693329044efdfc600da181d1ab586051db26e23db61c3a0dea2ee52dc',
  'home-vs-landlord-insurance.html': '7a1fd1a4d8154f10dd0b5f280b8c790dfeae9d3cc17bbc927331f397258d1e7e',
  'index.html': '642cb95b0e20cf8c229c27e3e806acb25cd327e7f8d1ab077348db5447561bca',
  'landlord-insurance.html': '40f7a0925411ff7d32d90d3d6b7261fec52c0b49d0194d379dcd0c64435f9404',
  'medicare-enrollment-guide.html': 'ef8e07683cd3b8e706eaa2aaa32d0c2bf17c6a08d5c52a4ea1c9bee1ec155579',
  'pet-insurance-guide.html': '6c218a48e8592bec0399eecfa7dde2117b5ca7a90698e1e997e3a18b493e10e9',
  'tornado-season.html': '45ef8a1ca49addfbe178eec90bc2ecf2049404ae9f8a90e8bebe345ba05bb889',
  'understanding-deductibles.html': '181c3b9e058a77ce8ed7ddaa0e43d3ae365062b0d4197ffa0ca82f4cf4a2c1ab',
  'winter-storm.html': 'd056ebb128d0e71bfe6036d723cb913f69becef41beccfe16bf79b12564aec28',
  'workers-comp-kentucky.html': '4ae2a2f113a1bb273d49ae68b456c0e0ac66180080d7b68d5589c424c89553b5',
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
