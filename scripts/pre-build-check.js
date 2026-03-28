#!/usr/bin/env node
/**
 * Pre-Build Safety Gate
 * Runs before build to catch issues early. Exit 1 to block build.
 *
 * Usage: node scripts/pre-build-check.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');

let errors = 0;
let warnings = 0;

function error(msg) { console.log(`  ✗ ${msg}`); errors++; }
function warn(msg) { console.log(`  ! ${msg}`); warnings++; }
function pass(msg) { console.log(`  ✓ ${msg}`); }

console.log('\nPre-build safety checks...\n');

// 1. Run data integrity checks
try {
  execSync('node scripts/check-data-integrity.js', { cwd: ROOT, stdio: 'pipe' });
  pass('Data integrity checks passed');
} catch (e) {
  error('Data integrity checks failed — run "node scripts/check-data-integrity.js" for details');
}

// 2. Block if any data/*.json completely empty
const jsonFiles = fs.readdirSync(DATA).filter(f => f.endsWith('.json') && !f.startsWith('.'));
let emptyCount = 0;
for (const file of jsonFiles) {
  const content = fs.readFileSync(path.join(DATA, file), 'utf8').trim();
  if (!content || content === '{}' || content === '[]') {
    error(`Empty data file: data/${file}`);
    emptyCount++;
  }
}
if (emptyCount === 0) pass('No empty data files');

// 3. Warn on uncommitted data/ changes
try {
  const status = execSync('git status --porcelain data/', { cwd: ROOT }).toString().trim();
  if (status) {
    warn(`Uncommitted data/ changes:\n${status.split('\n').map(l => '      ' + l).join('\n')}`);
  } else {
    pass('No uncommitted data/ changes');
  }
} catch {
  warn('Could not check git status');
}

// 4. Verify builder modules exist
const requiredModules = ['builders/seo.js', 'builders/assets.js', 'builders/pages.js', 'builders/blog-helpers.js', 'builders/sitemap.js', 'shared-templates.js', 'generate-blog.js'];
let missingModules = 0;
for (const mod of requiredModules) {
  if (!fs.existsSync(path.join(ROOT, 'scripts', mod))) {
    error(`Missing builder module: scripts/${mod}`);
    missingModules++;
  }
}
if (missingModules === 0) pass(`All ${requiredModules.length} builder modules present`);

// 5. Blog frontmatter validation
if (fs.existsSync(BLOG_SRC)) {
  const mdFiles = fs.readdirSync(BLOG_SRC).filter(f => f.endsWith('.md'));
  let fmErrors = 0;
  for (const file of mdFiles) {
    const content = fs.readFileSync(path.join(BLOG_SRC, file), 'utf8');
    if (!content.startsWith('---')) { error(`${file}: missing frontmatter`); fmErrors++; continue; }
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) { error(`${file}: malformed frontmatter`); fmErrors++; continue; }
    const fm = fmMatch[1];
    if (!fm.includes('title:')) { error(`${file}: missing title in frontmatter`); fmErrors++; }
    if (!fm.includes('slug:')) { error(`${file}: missing slug in frontmatter`); fmErrors++; }
  }
  if (fmErrors === 0) pass(`All ${mdFiles.length} blog posts have valid frontmatter`);
}

// Summary
console.log(`\n${errors === 0 ? '✅' : '❌'} Pre-build: ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
