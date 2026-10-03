#!/usr/bin/env node
/**
 * IndexNow: tell Bing (and the other IndexNow engines) which URLs changed, after
 * production serves them (AEO-02). Run only by .github/workflows/indexnow.yml,
 * never by scripts/build.js: build.js runs on every local, CI and preview build,
 * before anything is live, and would submit unchanged URLs.
 *
 * Commands (dependency-free, Node 18+):
 *   live                                  print the full commit production serves (from /version.json)
 *   wait --sha <commit> [--timeout-s N]   wait until production serves <commit> or a descendant of it
 *   changed --base <commit> --head <commit> [--out file]
 *                                         build both commits in temporary worktrees and list the sitemap
 *                                         URLs whose built HTML differs (plus URLs dropped from the
 *                                         sitemap). Empty --base = no baseline yet: list nothing.
 *   submit --file <urls.txt> [--dry-run]  check the key file is live, then POST the URLs to IndexNow
 *
 * The key is public by design (it is served at https://www.thewayagency.com/<key>.txt); this
 * script still never prints it.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://www.thewayagency.com';
const HOST = 'www.thewayagency.com';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const UA = 'thewayagency-indexnow/1.0 (+https://www.thewayagency.com/)';
const KEY_FILE_RE = /^[0-9a-f]{32}\.txt$/;
// Paths that never reach build/: a range that touches only these needs no build.
const NON_BUILD_PATHS = ['.github/', 'docs/', 'tests/', '.githooks/', 'README.md', 'CLAUDE.md', 'LICENSE',
  'wrangler.toml', '.gitignore'];

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/** The one key file at the repo root: { name, key }. Throws unless exactly one valid file exists. */
function findKeyFile(dir = ROOT) {
  const files = fs.readdirSync(dir).filter((f) => KEY_FILE_RE.test(f));
  if (files.length !== 1) throw new Error(`expected exactly one IndexNow key file at the repo root, found ${files.length}`);
  const key = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim();
  if (key + '.txt' !== files[0]) throw new Error('IndexNow key file content does not match its name');
  return { name: files[0], key };
}

/**
 * Strip what changes on every build without a content change: the build comments and
 * meta tag, and every other use of the build version string (the ?v= cache-bust on
 * stylesheet and script URLs).
 */
function normalizeHtml(html, buildVersion) {
  let out = String(html)
    .replace(/<meta name="build-version" content="[^"]*">\s*/g, '')
    .replace(/<!-- build: [^>]*-->\s*/g, '');
  if (buildVersion) out = out.split(buildVersion).join('{build}');
  return out;
}

function buildVersionOf(buildDir) {
  try { return JSON.parse(fs.readFileSync(path.join(buildDir, 'version.json'), 'utf8')).version || null; } catch { return null; }
}

function sitemapUrls(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

/** Built file for a sitemap URL: '/x/' -> x/index.html, '/x' -> x.html or x/index.html. */
function urlToFile(buildDir, url) {
  const p = decodeURIComponent(new URL(url).pathname);
  if (p.endsWith('/')) return path.join(buildDir, p, 'index.html');
  const candidates = [path.join(buildDir, p + '.html'), path.join(buildDir, p), path.join(buildDir, p, 'index.html')];
  return candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) || candidates[0];
}

function readNormalized(file, buildVersion) {
  try { return normalizeHtml(fs.readFileSync(file, 'utf8'), buildVersion); } catch { return null; }
}

/**
 * Compare two build directories. Returns the head sitemap's URLs whose page is new or
 * differs, and the base sitemap's URLs that the head sitemap no longer lists.
 * Only our own host's URLs are returned.
 */
function diffBuilds(baseDir, headDir) {
  const read = (d) => { try { return sitemapUrls(fs.readFileSync(path.join(d, 'sitemap.xml'), 'utf8')); } catch { return []; } };
  const own = (u) => { try { return new URL(u).host === HOST; } catch { return false; } };
  const headUrls = read(headDir).filter(own);
  const baseUrls = new Set(read(baseDir).filter(own));
  const hv = buildVersionOf(headDir); const bv = buildVersionOf(baseDir);
  const changed = [];
  for (const u of headUrls) {
    const h = readNormalized(urlToFile(headDir, u), hv);
    const b = readNormalized(urlToFile(baseDir, u), bv);
    if (h !== b) changed.push(u);
  }
  const headSet = new Set(headUrls);
  const removed = [...baseUrls].filter((u) => !headSet.has(u));
  return { changed, removed };
}

/** True when every path in the list is outside the build inputs. */
function onlyNonBuildPaths(files) {
  return files.every((f) => NON_BUILD_PATHS.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)));
}

// ─── Git and network ─────────────────────────────────────────────────────────
function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}
function resolveCommit(ref) { return git(['rev-parse', '--verify', ref + '^{commit}']); }
function isAncestor(a, b) {
  try { git(['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; }
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
  return { status: res.status, text: await res.text() };
}

async function liveCommit() {
  const { status, text } = await fetchText(`${ORIGIN}/version.json?indexnow=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
  if (status !== 200) throw new Error(`version.json returned ${status}`);
  const short = JSON.parse(text).commit;
  if (!/^[0-9a-f]{7,40}$/.test(short || '')) throw new Error('version.json has no commit');
  return resolveCommit(short);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Commands ────────────────────────────────────────────────────────────────
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const flag = (name) => process.argv.includes('--' + name);

async function cmdWait() {
  const sha = resolveCommit(arg('sha', 'HEAD'));
  const timeout = Number(arg('timeout-s', '1800')) * 1000;
  const interval = Number(arg('interval-s', '30')) * 1000;
  const t0 = Date.now();
  for (;;) {
    try {
      const live = await liveCommit();
      if (isAncestor(sha, live)) { console.error(`production serves ${live.slice(0, 7)} (contains ${sha.slice(0, 7)})`); return; }
      console.error(`production still serves ${live.slice(0, 7)}; waiting for ${sha.slice(0, 7)}`);
    } catch (e) {
      console.error(`live check failed: ${e.message}`);
    }
    if (Date.now() - t0 > timeout) throw new Error(`production did not serve ${sha.slice(0, 7)} within ${timeout / 1000}s`);
    await sleep(interval);
  }
}

function buildAt(commit, dir) {
  git(['worktree', 'add', '--detach', dir, commit]);
  execFileSync(process.execPath, ['scripts/build.js'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  return path.join(dir, 'build');
}

function cmdChanged() {
  const out = arg('out', null);
  const write = (urls) => {
    const text = urls.length ? urls.join('\n') + '\n' : '';
    if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  };
  const baseRef = arg('base', '');
  const head = resolveCommit(arg('head', 'HEAD'));
  if (!baseRef) { console.error('no baseline commit yet: nothing is submitted; this run records the baseline'); return write([]); }
  let base;
  try { base = resolveCommit(baseRef); } catch { console.error(`baseline ${baseRef} is not in this history (rewritten?): resetting the baseline, nothing submitted`); return write([]); }
  if (base === head) { console.error('production has not moved since the last submission'); return write([]); }
  if (!isAncestor(base, head)) { console.error('baseline is not an ancestor of the live commit (history rewritten): resetting the baseline, nothing submitted'); return write([]); }
  const files = git(['diff', '--name-only', base, head]).split('\n').filter(Boolean);
  if (!files.length || onlyNonBuildPaths(files)) { console.error(`${files.length} file(s) changed, none of them build inputs`); return write([]); }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-'));
  try {
    const { changed, removed } = diffBuilds(buildAt(base, path.join(tmp, 'base')), buildAt(head, path.join(tmp, 'head')));
    console.error(`${base.slice(0, 7)}..${head.slice(0, 7)}: ${files.length} file(s) changed; ${changed.length} sitemap URL(s) changed or added, ${removed.length} dropped from the sitemap`);
    write([...changed, ...removed]);
  } finally {
    for (const d of ['base', 'head']) { try { git(['worktree', 'remove', '--force', path.join(tmp, d)]); } catch { /* not created */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function cmdSubmit() {
  const file = arg('file', null);
  if (!file) throw new Error('--file is required');
  const urls = [...new Set(fs.readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))];
  if (!urls.length) { console.error('no changed URLs: nothing to submit'); return; }
  if (urls.length > 10000) throw new Error(`${urls.length} URLs exceed IndexNow's 10,000 per request`);
  for (const u of urls) if (new URL(u).host !== HOST) throw new Error('refusing a URL on another host');
  for (const u of urls) console.error(`  ${u}`);
  if (flag('dry-run')) { console.error(`dry run: ${urls.length} URL(s) not submitted (set the repository variable INDEXNOW_ENABLED=true to submit)`); return; }

  const { name, key } = findKeyFile();
  const keyLocation = `${ORIGIN}/${name}`;
  const live = await fetchText(keyLocation);
  if (live.status !== 200 || live.text.trim() !== key) throw new Error(`key file is not live (HTTP ${live.status}); not submitting`);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': UA },
    body: JSON.stringify({ host: HOST, key, keyLocation, urlList: urls }),
  });
  console.error(`IndexNow answered HTTP ${res.status} for ${urls.length} URL(s)`);
  if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow refused the submission (HTTP ${res.status})`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'live') process.stdout.write((await liveCommit()) + '\n');
  else if (cmd === 'wait') await cmdWait();
  else if (cmd === 'changed') cmdChanged();
  else if (cmd === 'submit') await cmdSubmit();
  else { console.error('usage: indexnow.js live | wait --sha <c> | changed --base <c> --head <c> [--out f] | submit --file f [--dry-run]'); process.exit(2); }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { findKeyFile, normalizeHtml, sitemapUrls, urlToFile, diffBuilds, onlyNonBuildPaths, KEY_FILE_RE, NON_BUILD_PATHS };
