/**
 * Blog Build Helpers
 * Copies hand-crafted blog posts and runs the Markdown blog generator.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ensureDir } = require('./assets');
const { legacyPageProblem } = require('../lib/legacy-blog-pages');
const { frontMatterOf } = require('../lib/blog-content-guard');
const { renderTpmoForAreas } = require('../lib/medicare-disclaimer');

// A frozen page marks where the CMS TPMO statement goes with this comment
// (src/pages/blog/medicare-enrollment-guide.html, under the byline). The
// statement is filled in here from data/medicare-tpmo.json, so the counts can
// change without re-hashing the frozen source (TRUST-01, spec 3.10).
const TPMO_PLACEHOLDER = '<!--TPMO-DISCLAIMER-->';

/** The URL slugs src/blog/*.md claims: each file's name and its front-matter slug. */
function markdownSlugs(blogMdDir) {
  const slugs = new Set();
  if (!fs.existsSync(blogMdDir)) return slugs;
  for (const file of fs.readdirSync(blogMdDir)) {
    if (!file.endsWith('.md')) continue;
    slugs.add(file.slice(0, -'.md'.length));
    const fm = frontMatterOf(fs.readFileSync(path.join(blogMdDir, file), 'utf8'));
    if (fm && typeof fm.meta.slug === 'string' && fm.meta.slug) slugs.add(fm.meta.slug);
  }
  return slugs;
}

/**
 * Copy the frozen hand-made blog pages (scripts/lib/legacy-blog-pages.js) into
 * build/blog/. A page there passes none of a markdown post's review gates
 * (sage-server BL-07), so the build FAILS on any other file, or on a listed
 * one whose bytes changed, instead of publishing it. A hand-made page whose
 * name a markdown post claims is not copied: the post owns that URL, and
 * renders there only if the review gate lets it (scripts/generate-blog.js
 * removes what it does not render).
 *
 * `tpmo` is the data/medicare-tpmo.json record: each TPMO_PLACEHOLDER becomes
 * its statement (renderTpmoForAreas: nothing unless the record is active with
 * counts, and nothing when display.legacy_guide is off).
 */
function copyBlogPages(SRC, BUILD, injectVersion, tpmo = null) {
  const blogSrcDir = path.join(SRC, 'pages', 'blog');
  if (!fs.existsSync(blogSrcDir)) return;
  const claimed = markdownSlugs(path.join(SRC, 'blog'));
  const problems = [];
  const pages = [];
  for (const file of fs.readdirSync(blogSrcDir)) {
    if (!file.endsWith('.html')) continue;
    const content = fs.readFileSync(path.join(blogSrcDir, file), 'utf8');
    const problem = legacyPageProblem(file, content);
    if (problem) problems.push(problem);
    else pages.push({ file, content });
  }
  if (problems.length) {
    console.error('\n✗ Hand-made blog page guard failed:');
    problems.forEach((p) => console.error('  - ' + p));
    throw new Error(`Hand-made blog page guard failed (${problems.length} issue(s)).`);
  }
  ensureDir(path.join(BUILD, 'blog'));
  const tpmoHtml = tpmo && tpmo.display && tpmo.display.legacy_guide ? renderTpmoForAreas(tpmo) : '';
  let blogCount = 0;
  for (const { file, content } of pages) {
    const slug = file.slice(0, -'.html'.length);
    if (file !== 'index.html' && claimed.has(slug)) {
      console.log(`  ~ Not copied blog/${file}  -  src/blog/ has a markdown post for /blog/${slug}, which renders there only through the review gate`);
      continue;
    }
    // split/join rather than replace(): every placeholder is filled, and a '$&'
    // in the statement stays text.
    const filled = content.split(TPMO_PLACEHOLDER).join(tpmoHtml);
    fs.writeFileSync(path.join(BUILD, 'blog', file), injectVersion(filled));
    blogCount++;
  }
  if (blogCount > 0) console.log(`  ✓ Copied ${blogCount} blog pages (including index)`);
}

/**
 * Run scripts/generate-blog.js. A failure fails the build: the generator is
 * the review gate (sage-server BL-07), and it exits nonzero rather than render
 * when it cannot tell a held post from a due one (an unreadable content
 * calendar). Logging and carrying on deployed whatever build/blog/ held.
 */
function runBlogGenerator(ROOT) {
  try {
    execSync('node scripts/generate-blog.js', { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('\n✗ Blog generation failed: ' + e.message);
    throw new Error('Blog generation failed (scripts/generate-blog.js exited nonzero); see its output above.');
  }
}

module.exports = { copyBlogPages, runBlogGenerator, markdownSlugs, TPMO_PLACEHOLDER };
