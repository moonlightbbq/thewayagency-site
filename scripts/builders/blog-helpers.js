/**
 * Blog Build Helpers
 * Copies hand-crafted blog posts and runs the Markdown blog generator.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ensureDir } = require('./assets');

function copyBlogPages(SRC, BUILD, injectVersion) {
  const blogSrcDir = path.join(SRC, 'pages', 'blog');
  if (fs.existsSync(blogSrcDir)) {
    ensureDir(path.join(BUILD, 'blog'));
    let blogCount = 0;
    for (const file of fs.readdirSync(blogSrcDir)) {
      if (file.endsWith('.html')) {
        const content = fs.readFileSync(path.join(blogSrcDir, file), 'utf8');
        fs.writeFileSync(path.join(BUILD, 'blog', file), injectVersion(content));
        blogCount++;
      }
    }
    if (blogCount > 0) console.log(`  ✓ Copied ${blogCount} blog pages (including index)`);
  }
}

function runBlogGenerator(ROOT) {
  try {
    execSync('node scripts/generate-blog.js', { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.log('  ! Blog generation error: ' + e.message);
  }
}

module.exports = { copyBlogPages, runBlogGenerator };
