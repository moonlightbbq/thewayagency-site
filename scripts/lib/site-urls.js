'use strict';
/**
 * The one place that decides what an internal URL looks like.
 * Cloudflare Pages serves /x from x.html and 308s /x.html -> /x and
 * /dir/index.html -> /dir/ (developers.cloudflare.com/pages/configuration/serving-pages/,
 * updated 2026-04-21). Every URL the site emits is therefore the extensionless
 * form on the www host (TECH-02; url-hygiene spec 3.1).
 *
 * Dependency-free: validate-build.js loads it on Node 18 without npm ci.
 */
const path = require('path');

const SITE_ORIGIN = 'https://www.thewayagency.com';

function splitSuffix(s) {
  const i = s.search(/[?#]/);
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i)];
}

/** '/a/b.html#x' -> '/a/b#x', '/a/index.html' -> '/a/'. Anything that is not a site-relative path is returned unchanged. */
function pagePath(value) {
  const s = String(value === undefined || value === null ? '' : value);
  if (!s.startsWith('/') || s.startsWith('//')) return s;
  let [p, rest] = splitSuffix(s);
  if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
  else if (p.endsWith('.html')) p = p.slice(0, -'.html'.length);
  return p + rest;
}

/** Absolute canonical URL for a site path, or for a URL already on SITE_ORIGIN. The bare origin and other hosts are unchanged. */
function pageUrl(value) {
  const s = String(value === undefined || value === null ? '' : value);
  if (s === SITE_ORIGIN) return s;
  if (s.startsWith(SITE_ORIGIN + '/')) return SITE_ORIGIN + pagePath(s.slice(SITE_ORIGIN.length));
  if (s.startsWith('/') && !s.startsWith('//')) return SITE_ORIGIN + pagePath(s);
  return s;
}

/** A build/ file's served route: 'about/team.html' -> '/about/team', 'blog/index.html' -> '/blog/', 'index.html' -> '/'. */
function routeOfFile(rel) {
  return pagePath('/' + String(rel).split(path.sep).join('/'));
}

module.exports = { SITE_ORIGIN, pagePath, pageUrl, routeOfFile, canonicalHref: pagePath };
