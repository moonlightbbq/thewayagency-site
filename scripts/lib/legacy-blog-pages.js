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
  'after-car-accident-kentucky.html': 'c80879fa91f2d265d15eb15f6eabf7bb616044e4a7876fd1a82b5dec7d06161e',
  'bundling-home-auto.html': 'a59b6381195f5d3aef3223f6ca5f93608e0079223a262bde52c58e5d88d010f2',
  'cyber-safety.html': '4801a03d4bcf40c4e59a2e28d7f73c57db2a767fdf84c4a58b722be2c1384f15',
  'earthquake-insurance.html': '9f863d92915251dfd60fcb9291f648bf0c06f5754f0bff89c5a641f900eabeef',
  'home-vs-landlord-insurance.html': '807ef3de899a044ecaa5fc9902029993e0bf1efd5d2594e4c86ded9b44d118e5',
  'index.html': 'a1638282189479814d6badc7b44879ed53cfc3e09dffbd47118ed214ca7144c2',
  'landlord-insurance.html': '6c3fb4ab67e07441258310faeaac3d734214206873360f3953a9d37ab2493bda',
  'medicare-enrollment-guide.html': '9460d60f59a958ddbc05de9e8693888be7e6fbca36f3c7afa102fa80fb557c2b',
  'pet-insurance-guide.html': '7c3b8d46005c49dcda075a62c204887082d2e6a6a96ec87a029f1022cb75b35a',
  'tornado-season.html': '61101efd9b0d266eedd39ac5600225bebe188dac196bb94837b0881c881a7a6a',
  'understanding-deductibles.html': '14172f8ad4d47340b7911c8bb8f91056c473034a18e250fb2767608486b3f92f',
  'winter-storm.html': 'dfe5f62beac6faa3fcb9bd3748237d4b5ae0769caf0c4f8405de7821b42c1d02',
  'workers-comp-kentucky.html': '6851def63a3b66571ab5fe8130641c876124445f15a70325956cf2a0be402ad7',
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
