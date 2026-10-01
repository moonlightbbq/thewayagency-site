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
  'after-car-accident-kentucky.html': 'aa75d056d4a9c90b4c937c2b3ceafa750c10208401d6f1cc65aea2679340a36e',
  'bundling-home-auto.html': 'a01fb5532e07d4cd8029e1d572bcbf0d2f0b927f2c5fdcaae2835c2d1edcba7e',
  'cyber-safety.html': '59af24f81b66e57c0b09de8490dd34b1af4072c782e8c6ac39f4f6e504e5c129',
  'earthquake-insurance.html': '6acf8b3b5a355d7df9c23b449898071f1d1e3742ce31712c811baea214aa365d',
  'home-vs-landlord-insurance.html': '95512992e7e44ababe2bda07b47a8c189d47f89a0818c26b31b0b43131e46171',
  'index.html': 'bbfe86a5bf4b24ede9a2370dcc218088d830964209ba865137240d494d57ec90',
  'landlord-insurance.html': '19baa7f469b501958e4a7a543e8845eafa9aefaaca406db38ae7c2e882dc5631',
  'medicare-enrollment-guide.html': '8cc8a1d653ecc1ae45b9d91ffead2a06134a10638aa04051a4e5d332bafe0ef6',
  'pet-insurance-guide.html': '47711c70b39619849503ca0d84429283a99d461f86196a4a8f89e7ed1b9c5e90',
  'tornado-season.html': 'e56625cd9330f3fdaf69155e1cf060f26156828d1cb1b66129ad4def2d4a2a25',
  'understanding-deductibles.html': '43d8bf26877f8c2f9d14565b27fc559884a446b3c24af65f61e272f68b7a07cb',
  'winter-storm.html': 'dce058fd63e5a7d26d07b9a8416767370c05d539e14dc5a172f9705e2cab98ca',
  'workers-comp-kentucky.html': '36276e77c33cc2b2f291d367344a079dd18c9b08f474877769e3d979d02a918f',
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
