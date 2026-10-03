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
  'after-car-accident-kentucky.html': '9690f0f983a7ac76acb4eb3c454741545dbf7b5bb3d7be0b28c12089479f5235',
  'bundling-home-auto.html': 'c0a817292d1f9644c4bed13c309b0847784e6319755f5294e75d3ca67cd56ca8',
  'cyber-safety.html': '070931ae8421f128cc803bcf4a2e1627ed212349cc481b8928854452a1dcac02',
  'earthquake-insurance.html': 'bb4987c15184f75415be99a6b06b076453fba1a935c98080681b1c55c5a26639',
  'home-vs-landlord-insurance.html': 'de0a5b1688f0121b76f33cc05229b73a73814904a9194eb3981013de4fdd62e4',
  'index.html': 'ba0ed616d2d574513e97721e9c643f85b140177d172e653a5c3a93868ed35a30',
  'landlord-insurance.html': '9a3ff20664fd1861d861461352836fc9d4d9c1377f73f23eab61d06a18d8aea3',
  'medicare-enrollment-guide.html': '4c94d6c00447f48cb52b9a5b0505b82d387b36aed5590a14364fd71729115210',
  'pet-insurance-guide.html': '2722a9a7e87ad7d33005c7f5595ef93ce81235da402b13010d601ee0baf07133',
  'tornado-season.html': '13d7380a25fb9dfd1042762fe82f9824b83e68203fbf27297566ae2e691d23bd',
  'understanding-deductibles.html': 'fa3b126678d35f15b476fe83f24ca637e1f55116e657420540d7e3d23172f1d4',
  'winter-storm.html': '29e4eced7302d62e199a6237078c1e15f339aed88581b2980a86e39800a515c6',
  'workers-comp-kentucky.html': 'c788386b11c97e7638d5f61664dd1696b4c4781b905f167efda48b667913c2b1',
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
