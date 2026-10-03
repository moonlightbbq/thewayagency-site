#!/usr/bin/env node
'use strict';
/**
 * TECH-02 (url-hygiene spec 3.4, Appendix C): rewrite internal links in the
 * hand-made pages from the .html file form to the extensionless URL Pages
 * serves. Pages 308s /x.html -> /x and /dir/index.html -> /dir/, so every
 * .html link is a redirect hop.
 *
 * It rewrites only:
 *   href="<built page>.html"  (and ...#frag, ...?query; single or double quotes)
 *   https://www.thewayagency.com/<built page>.html  (followed by " ' # ? or <)
 * where <built page> is a page the build actually wrote (read from build/), so
 * a .html path that is not a page (a lead-attribution value such as
 * contact.html's `page: '/contact.html'`, a code comment, an asset) is left
 * alone. Idempotent: a second run changes nothing. Never point it at
 * legal-archive/ (write-once snapshots).
 *
 * Usage (after `node scripts/build.js`):
 *   node scripts/codemods/extensionless-links.js [--build build] [--check]
 *        [--exclude-compliance-main | --only-compliance-main] [files...]
 *   --check                    change nothing; exit 1 if any file would change
 *   --exclude-compliance-main  leave the <main> of the six compliance pages as is
 *                              (a links-only change there needs a Version bump
 *                              and archive: url-hygiene D2, owner action OA-19)
 *   --only-compliance-main     rewrite only inside those six <main> elements
 * With no files, it runs on src/pages/**\/*.html and src/intake.html.
 *
 * After it runs on a hash-frozen legacy page (scripts/lib/legacy-blog-pages.js),
 * re-pin that page's sha256 in the same commit (url-hygiene D3).
 */
const fs = require('fs');
const path = require('path');
const { SITE_ORIGIN, pagePath } = require('../lib/site-urls');

const ROOT = path.join(__dirname, '..', '..');
const COMPLIANCE_PAGES = ['privacy', 'terms', 'disclosures', 'privacy-notice', 'ai-disclosure', 'information-security']
  .map((n) => path.join('src', 'pages', `${n}.html`));

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

/** '/about/team.html', '/blog/index.html', ... for every page in a build dir (assets under build/src/ excluded). */
function builtPagePaths(buildDir) {
  return walk(buildDir)
    .filter((f) => f.endsWith('.html') && !path.relative(buildDir, f).startsWith('src' + path.sep))
    .map((f) => '/' + path.relative(buildDir, f).split(path.sep).join('/'));
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrite one string. Returns { text, count }.
 * @param {string} text
 * @param {string[]} fromPaths '/x.html' paths of built pages
 */
function rewriteLinks(text, fromPaths) {
  const set = new Set(fromPaths);
  let count = 0;
  // href="/x.html", href='/x.html#a', href="https://www.thewayagency.com/x.html?q"
  const origin = escRe(SITE_ORIGIN);
  const hrefRe = new RegExp(`(\\bhref\\s*=\\s*)(["'])(${origin})?(/[^"'#?\\s<>]*\\.html)(?=[#?"'])`, 'g');
  let out = text.replace(hrefRe, (m, pre, q, abs, p) => {
    if (!set.has(p)) return m;
    count++;
    return `${pre}${q}${abs || ''}${pagePath(p)}`;
  });
  // Absolute www URLs anywhere else (JSON-LD, og:url content, share links, scripts).
  const absRe = new RegExp(`${origin}(/[^"'#?\\s<>)\\\\]*\\.html)(?=[#?"'<\\s)\\\\]|$)`, 'g');
  out = out.replace(absRe, (m, p) => {
    if (!set.has(p)) return m;
    count++;
    return SITE_ORIGIN + pagePath(p);
  });
  return { text: out, count };
}

/** [start, end) of the first <main>...</main>, or null. */
function mainRange(html) {
  const a = html.search(/<main[\s>]/i);
  if (a < 0) return null;
  const close = html.indexOf('</main>', a);
  return [a, close < 0 ? html.length : close + '</main>'.length];
}

/**
 * Rewrite a page, optionally leaving (or touching only) its <main>.
 * @param {string} html
 * @param {string[]} fromPaths
 * @param {{main?: 'all'|'exclude'|'only'}} [opts]
 */
function rewritePage(html, fromPaths, { main = 'all' } = {}) {
  if (main === 'all') return rewriteLinks(html, fromPaths);
  const r = mainRange(html);
  if (!r) return main === 'only' ? { text: html, count: 0 } : rewriteLinks(html, fromPaths);
  const [a, b] = r;
  const parts = [html.slice(0, a), html.slice(a, b), html.slice(b)];
  const doIt = main === 'exclude' ? [true, false, true] : [false, true, false];
  let count = 0;
  const text = parts.map((p, i) => {
    if (!doIt[i]) return p;
    const res = rewriteLinks(p, fromPaths);
    count += res.count;
    return res.text;
  }).join('');
  return { text, count };
}

function main(argv) {
  const args = argv.slice(2);
  let buildDir = path.join(ROOT, 'build');
  let check = false;
  let mode = 'all';
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--build') buildDir = path.resolve(args[++i]);
    else if (a === '--check') check = true;
    else if (a === '--exclude-compliance-main') mode = 'exclude';
    else if (a === '--only-compliance-main') mode = 'only';
    else files.push(a);
  }
  if (!fs.existsSync(buildDir)) {
    console.error(`No build at ${buildDir}: run node scripts/build.js first (the page list comes from the build).`);
    return 2;
  }
  const fromPaths = builtPagePaths(buildDir);
  const targets = files.length
    ? files.map((f) => path.resolve(f))
    : [...walk(path.join(ROOT, 'src', 'pages')), path.join(ROOT, 'src', 'intake.html')].filter((f) => f.endsWith('.html'));
  let total = 0;
  let changed = 0;
  for (const file of targets) {
    const rel = path.relative(ROOT, file);
    if (rel.split(path.sep)[0] === 'legal-archive') { console.error(`refusing ${rel}: legal-archive is write-once`); return 2; }
    const isCompliance = COMPLIANCE_PAGES.includes(rel);
    if (mode === 'only' && !isCompliance) continue;
    const before = fs.readFileSync(file, 'utf8');
    const { text, count } = rewritePage(before, fromPaths, { main: isCompliance ? mode : 'all' });
    if (text !== before) {
      changed++;
      total += count;
      if (!check) fs.writeFileSync(file, text);
      console.log(`${String(count).padStart(5)}  ${rel}`);
    }
  }
  console.log(`${check ? 'would rewrite' : 'rewrote'} ${total} link(s) in ${changed} file(s)`);
  return check && changed ? 1 : 0;
}

module.exports = { rewriteLinks, rewritePage, mainRange, builtPagePaths, COMPLIANCE_PAGES };
if (require.main === module) process.exitCode = main(process.argv);
