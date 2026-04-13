#!/usr/bin/env node
/**
 * One-shot internal dead-link audit.
 * Walks build/**.html, extracts internal href/src targets, reports any
 * that don't resolve to a built file or a _redirects rule.
 */
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const REDIRECTS_FILE = path.join(BUILD, '_redirects');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function loadRedirectSources() {
  const set = new Set();
  if (!fs.existsSync(REDIRECTS_FILE)) return set;
  for (const raw of fs.readFileSync(REDIRECTS_FILE, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [src] = line.split(/\s+/);
    if (src) set.add(src.replace(/^https?:\/\/[^/]+/, ''));
  }
  return set;
}

function fileExists(urlPath) {
  if (urlPath === '/') return fs.existsSync(path.join(BUILD, 'index.html'));
  let rel = urlPath.replace(/^\//, '');
  if (rel.endsWith('/')) rel += 'index.html';
  const direct = path.join(BUILD, rel);
  if (fs.existsSync(direct)) return true;
  if (!rel.endsWith('.html') && fs.existsSync(path.join(BUILD, rel + '.html'))) return true;
  if (fs.existsSync(path.join(BUILD, rel, 'index.html'))) return true;
  return false;
}

function matchesRedirect(urlPath, redirectSources) {
  if (redirectSources.has(urlPath)) return true;
  for (const src of redirectSources) {
    if (src.endsWith('/*')) {
      const prefix = src.slice(0, -2);
      if (urlPath.startsWith(prefix + '/') || urlPath === prefix) return true;
    }
  }
  return false;
}

const HREF_RE = /(?:href|src)="([^"#?][^"#?]*?)"/gi;
const redirectSources = loadRedirectSources();
const dead = new Map(); // url -> Set(sourceFile)

for (const file of walk(BUILD)) {
  const html = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = HREF_RE.exec(html))) {
    let target = m[1];
    if (!target.startsWith('/')) continue; // skip external + relative
    if (target.startsWith('//')) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    if (target.startsWith('/src/') || target.startsWith('/api/')) continue; // assets / SPA APIs
    if (fileExists(target)) continue;
    if (matchesRedirect(target, redirectSources)) continue;
    if (!dead.has(target)) dead.set(target, new Set());
    dead.get(target).add(path.relative(BUILD, file));
  }
}

if (dead.size === 0) {
  console.log('✓ No internal dead links found.');
  process.exit(0);
}

console.log(`✗ ${dead.size} dead internal targets:\n`);
const sorted = [...dead.entries()].sort((a, b) => b[1].size - a[1].size);
for (const [target, sources] of sorted) {
  const srcList = [...sources].slice(0, 3).join(', ');
  const more = sources.size > 3 ? ` (+${sources.size - 3} more)` : '';
  console.log(`  ${target}  —  ${sources.size}× from: ${srcList}${more}`);
}
process.exit(1);
