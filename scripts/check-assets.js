#!/usr/bin/env node
/**
 * CSS & Asset Integrity Checker
 * Validates CSS, JS, images, and CSP headers.
 *
 * Usage: node scripts/check-assets.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let errors = 0;
let warnings = 0;

function error(msg) { console.log(`  ✗ ${msg}`); errors++; }
function warn(msg) { console.log(`  ! ${msg}`); warnings++; }
function pass(msg) { console.log(`  ✓ ${msg}`); }

console.log('\nChecking asset integrity...\n');

// ─── CSS Checks ─────────────────────────────────

const cssDir = path.join(SRC, 'css');
if (fs.existsSync(cssDir)) {
  const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
  let cssErrors = 0;

  for (const file of cssFiles) {
    const fp = path.join(cssDir, file);
    const content = fs.readFileSync(fp, 'utf8');
    const size = fs.statSync(fp).size;

    // Not empty
    if (size === 0) { error(`CSS empty: ${file}`); cssErrors++; continue; }

    // Under 500KB
    if (size > 500 * 1024) { warn(`CSS too large (${(size / 1024).toFixed(0)}KB): ${file}`); }

    // Balanced braces
    const opens = (content.match(/{/g) || []).length;
    const closes = (content.match(/}/g) || []).length;
    if (opens !== closes) { error(`CSS unbalanced braces in ${file}: ${opens} open, ${closes} close`); cssErrors++; }

    // No @import (should be concatenated at build time)
    if (content.includes('@import')) { warn(`CSS @import found in ${file} — consider inlining`); }

    // Check var(--x) references resolve to :root
    const rootMatch = content.match(/:root\s*{([^}]+)}/);
    if (rootMatch) {
      const rootVars = new Set();
      const varDecls = rootMatch[1].match(/--[\w-]+/g) || [];
      for (const v of varDecls) rootVars.add(v);

      const varRefs = content.match(/var\(--[\w-]+\)/g) || [];
      for (const ref of varRefs) {
        const varName = ref.match(/var\((--[\w-]+)\)/)[1];
        if (!rootVars.has(varName)) {
          // Check if it's defined elsewhere in the file or is a common standard
          if (!content.includes(`${varName}:`)) {
            warn(`CSS var ${varName} used in ${file} but not defined in :root`);
          }
        }
      }
    }
  }
  if (cssErrors === 0) pass(`${cssFiles.length} CSS files, all structurally valid`);
}

// ─── JS Checks ──────────────────────────────────

const jsDir = path.join(SRC, 'js');
if (fs.existsSync(jsDir)) {
  const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
  let jsErrors = 0;

  for (const file of jsFiles) {
    const fp = path.join(jsDir, file);
    const content = fs.readFileSync(fp, 'utf8');

    // Syntax check
    try {
      execSync(`node -c "${fp}"`, { stdio: 'pipe' });
    } catch {
      error(`JS syntax error in ${file}`);
      jsErrors++;
    }

    // Warn on console.log (but not console.error/warn)
    const consoleLogs = (content.match(/console\.log\(/g) || []).length;
    if (consoleLogs > 0) warn(`${file}: ${consoleLogs} console.log() found`);

    // Error on debugger statements
    if (/\bdebugger\b/.test(content)) { error(`${file}: debugger statement found`); jsErrors++; }
  }
  if (jsErrors === 0) pass(`${jsFiles.length} JS files, all valid syntax`);
}

// ─── Image Checks ───────────────────────────────

const assetsDir = path.join(SRC, 'assets');
if (fs.existsSync(assetsDir)) {
  let imageCount = 0;
  let imageErrors = 0;

  function checkImages(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { checkImages(full); continue; }
      if (!/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(entry.name)) continue;
      imageCount++;

      const stat = fs.statSync(full);
      const rel = path.relative(SRC, full);

      // Not empty
      if (stat.size === 0) { error(`Empty image: ${rel}`); imageErrors++; continue; }

      // Warn on >500KB
      if (stat.size > 500 * 1024) { warn(`Large image (${(stat.size / 1024).toFixed(0)}KB): ${rel}`); }

      // Valid magic bytes for non-SVG
      if (!entry.name.endsWith('.svg')) {
        const buf = Buffer.alloc(4);
        const fd = fs.openSync(full, 'r');
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);

        const isPNG = buf[0] === 0x89 && buf[1] === 0x50;
        const isJPEG = buf[0] === 0xFF && buf[1] === 0xD8;
        const isWebP = buf.toString('ascii', 0, 4) === 'RIFF';
        const isGIF = buf.toString('ascii', 0, 3) === 'GIF';

        if (!isPNG && !isJPEG && !isWebP && !isGIF) {
          warn(`${rel}: unrecognized image format (magic bytes: ${buf.toString('hex')})`);
        }
      }
    }
  }
  checkImages(assetsDir);
  if (imageErrors === 0) pass(`${imageCount} images, all valid`);
}

// ─── CSP Check ──────────────────────────────────

const headersPath = path.join(ROOT, '_headers');
if (fs.existsSync(headersPath)) {
  const headers = fs.readFileSync(headersPath, 'utf8');
  const cspMatch = headers.match(/Content-Security-Policy:\s*(.+)/);
  if (cspMatch) {
    const csp = cspMatch[1];
    const allowedDomains = new Set();
    const directives = csp.split(';');
    for (const d of directives) {
      const parts = d.trim().split(/\s+/);
      for (const part of parts) {
        if (part.startsWith('https://')) allowedDomains.add(part.replace(/\*/g, ''));
      }
    }

    // Scan HTML/JS for external domains
    const externalDomains = new Set();
    function scanForDomains(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { scanForDomains(full); continue; }
        if (!entry.name.endsWith('.html') && !entry.name.endsWith('.js')) continue;
        const content = fs.readFileSync(full, 'utf8');
        const domainMatches = content.match(/https:\/\/[a-zA-Z0-9.-]+/g) || [];
        for (const d of domainMatches) {
          const domain = d.replace(/^https:\/\//, '');
          if (!domain.includes('thewayagency.com')) externalDomains.add(domain);
        }
      }
    }
    scanForDomains(path.join(SRC, 'js'));
    scanForDomains(path.join(SRC, 'pages'));

    // Check if external domains are in CSP
    let cspWarnings = 0;
    for (const domain of externalDomains) {
      const isAllowed = [...allowedDomains].some(allowed => domain.includes(allowed.replace('https://', '')));
      if (!isAllowed && !domain.includes('schema.org') && !domain.includes('fonts.')) {
        warn(`External domain "${domain}" found in source but not explicitly in CSP`);
        cspWarnings++;
      }
    }
    if (cspWarnings === 0) pass('CSP covers all external domains in source files');
  } else {
    warn('No Content-Security-Policy header found');
  }
}

// ─── Summary ────────────────────────────────────

console.log(`\n${errors === 0 ? '✅' : '❌'} Asset integrity: ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
