'use strict';
/**
 * Link-structure gates over a built site (TECH-01, LOCAL-01; priority-hubs R1-13).
 * scripts/validate-build.js runs them in CI on Node 18 without `npm ci`, so this
 * file uses only Node built-ins.
 *
 *  - breadcrumbProblems: at most one BreadcrumbList per page; every item is an
 *    extensionless URL of a built page (no dead /insurance/ or /industries/
 *    parent, no .html item that 308s).
 *  - htmlHubLinkProblems: no internal href to /insurance/<x>.html or
 *    /industries/<x>.html.
 *  - clickDepthProblems: breadth-first from the homepage over href="/..."
 *    links: the priority hubs and /industries/ within their click-depth limits,
 *    and no /insurance/ or /industries/ page unreachable.
 *  - relatedBlockedProblems: no generated post's Related Articles block links
 *    a post in data/internal-links.json blocked_guides.
 */
const fs = require('fs');
const path = require('path');
const { SITE_ORIGIN, routeOfFile, pagePath } = require('./site-urls');

const DEPTH_LIMITS = Object.freeze({
  '/insurance/owensboro-ky': 1,
  '/insurance/mt-washington-ky': 1,
  '/insurance/daviess-county-ky': 2,
  '/insurance/shepherdsville-ky': 2,
  '/industries/': 2,
});

function listPages(buildDir) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (path.relative(buildDir, full) !== 'src') walk(full); }
      else if (e.name.endsWith('.html')) out.push(full);
    }
  })(buildDir);
  return out.sort();
}

/** route -> { rel, html } for every built page outside build/src/. */
function readSite(buildDir) {
  const site = new Map();
  for (const file of listPages(buildDir)) {
    const rel = path.relative(buildDir, file).split(path.sep).join('/');
    site.set(routeOfFile(rel), { rel, html: fs.readFileSync(file, 'utf8') });
  }
  return site;
}

function jsonLdNodes(html) {
  const nodes = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    for (const top of [].concat(data)) {
      if (!top || typeof top !== 'object') continue;
      if (Array.isArray(top['@graph'])) nodes.push(...top['@graph']); else nodes.push(top);
    }
  }
  return nodes;
}

function breadcrumbProblems(site) {
  const problems = [];
  for (const { rel, html } of site.values()) {
    const lists = jsonLdNodes(html).filter((n) => n && n['@type'] === 'BreadcrumbList');
    if (lists.length > 1) problems.push(`${rel}: ${lists.length} BreadcrumbList trails (one per page)`);
    for (const list of lists) {
      for (const item of Array.isArray(list.itemListElement) ? list.itemListElement : []) {
        const raw = item && (typeof item.item === 'string' ? item.item : item.item && item.item['@id']);
        if (!raw) continue;
        if (!raw.startsWith(SITE_ORIGIN)) { problems.push(`${rel}: breadcrumb item ${raw} is not on ${SITE_ORIGIN}`); continue; }
        const p = raw.slice(SITE_ORIGIN.length) || '/';
        if (p === '/') continue;
        if (/\.html(?:[?#]|$)/.test(p)) { problems.push(`${rel}: breadcrumb item ${p} ends in .html (it 308s; use ${pagePath(p)})`); continue; }
        const target = p.replace(/[?#].*$/, '');
        if (!site.has(target)) problems.push(`${rel}: breadcrumb item ${target} is not a built page`);
      }
    }
  }
  return problems;
}

function htmlHubLinkProblems(site) {
  const problems = [];
  for (const { rel, html } of site.values()) {
    const hits = new Set((html.match(/href="\/(?:insurance|industries)\/[a-z0-9-]+\.html[^"]*"/g) || []));
    for (const h of hits) problems.push(`${rel}: internal link ${h.slice(5)} uses the .html form`);
  }
  return problems;
}

function linkGraph(site) {
  const graph = new Map();
  for (const [route, { html }] of site) {
    const out = new Set();
    for (const m of html.matchAll(/href="(\/(?!\/)[^"]*)"/g)) {
      const t = pagePath(m[1].replace(/[?#].*$/, ''));
      if (site.has(t) && t !== route) out.add(t);
    }
    graph.set(route, out);
  }
  return graph;
}

function clickDepths(site) {
  const graph = linkGraph(site);
  const depth = new Map([['/', 0]]);
  const queue = ['/'];
  while (queue.length) {
    const r = queue.shift();
    for (const t of graph.get(r) || []) if (!depth.has(t)) { depth.set(t, depth.get(r) + 1); queue.push(t); }
  }
  return depth;
}

function clickDepthProblems(site, limits = DEPTH_LIMITS) {
  const problems = [];
  const depth = clickDepths(site);
  for (const [route, max] of Object.entries(limits)) {
    const d = depth.get(route);
    if (d === undefined) problems.push(`${route}: ${site.has(route) ? 'not reachable from the homepage' : 'not built'} (max click depth ${max})`);
    else if (d > max) problems.push(`${route}: click depth ${d} (max ${max})`);
  }
  for (const route of site.keys()) {
    if (/^\/(insurance|industries)\//.test(route) && !depth.has(route)) problems.push(`${route}: orphaned (no link path from the homepage)`);
  }
  return problems;
}

/**
 * Related Articles links (generated posts only) into a blocked_guides slug.
 * @param {Map} site readSite() output
 * @param {Iterable<string>} blockedSlugs keys of internal-links.json blocked_guides
 * @param {Set<string>} [skipRels] build-relative files to skip (the frozen hand-made posts)
 */
function relatedBlockedProblems(site, blockedSlugs, skipRels = new Set()) {
  const blocked = new Set(blockedSlugs);
  const out = [];
  for (const [route, { rel, html }] of site) {
    if (!rel.startsWith('blog/') || skipRels.has(rel)) continue;
    const i = html.indexOf('>Related Articles</h2>');
    if (i < 0) continue;
    const end = html.indexOf('</section>', i);
    const block = html.slice(i, end < 0 ? undefined : end);
    for (const m of block.matchAll(/href="\/blog\/([a-z0-9-]+)(?:\.html)?"/g)) {
      if (blocked.has(m[1])) out.push(`${route}: Related Articles links ${m[1]}, which internal-links.json blocked_guides holds`);
    }
  }
  return out;
}

module.exports = { DEPTH_LIMITS, readSite, jsonLdNodes, breadcrumbProblems, htmlHubLinkProblems, clickDepths, clickDepthProblems, relatedBlockedProblems };
