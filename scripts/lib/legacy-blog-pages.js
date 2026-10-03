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
  'after-car-accident-kentucky.html': '2a9935b488bedd30abd1aa48fd92a9b1546414f20378ff68ff35aaeb259972af',
  'bundling-home-auto.html': '92a8eb01c85acbc7fc2abd44dfcb1b33e813c4cb8b38cf8648f72489685f8e2e',
  'cyber-safety.html': '0852161bf72711089fed9da0aad19d635b824fbef65e4891a1927da719e9f0e1',
  'earthquake-insurance.html': 'ee149c2c8b2f99c8a267490963ebdbfdea9c42cd0d10cba21419f4892d2d812e',
  'home-vs-landlord-insurance.html': '0f2abbd8d147f685afa70ddb2c684d19abad7ae012b206ee138e5ec97f7730a5',
  'index.html': '4e1ec220476993ec3c438f42fa23be0bca156342f905ec386414d239cf4badfb',
  'landlord-insurance.html': '206f61a661bab0d4b1b2a975b3bfbc7310b684ea14e4f20d2df85ff5e73dbae2',
  'medicare-enrollment-guide.html': '51a7535bcde887416a0a42dbde5621e69d62a6b0867a7240228f4075435b2cf3',
  'pet-insurance-guide.html': '5b7d4833c27129814448f490fafd9677aaa4697679a3eacef824ddc4c73bb42e',
  'tornado-season.html': '47dfc0aa66eb8b4f7afcc2983a4ba0885134ef38f3895e1ffde571d037beb5e5',
  'understanding-deductibles.html': 'e1c1147d10923fd040b456de970304a605f6a2b35fb276b93e71189cabc8e914',
  'winter-storm.html': 'd8912e4c6f9b5458bae807c5bfc66d9f8b4fe6486c424720569867950a046fd7',
  'workers-comp-kentucky.html': '352cae4cb2f238e3a58f02b40eb4dbc835ab7a9f040c5c94186f498bf473d9b3',
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
