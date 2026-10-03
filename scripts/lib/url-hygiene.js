'use strict';
/**
 * Report-only checks for URL hygiene (url-hygiene spec 3.9): _redirects
 * (TECH-07), the blog RSS feed (TECH-05) and internal links that name a page
 * by its .html file (TECH-02). Nothing here rewrites output;
 * scripts/validate-build.js fails CI on what these return.
 *
 * Dependency-free: CI's safe-build job runs validate-build.js on Node 18
 * without npm ci.
 */
const { SITE_ORIGIN } = require('./site-urls');

const REDIRECT_STATUSES = new Set([200, 301, 302, 303, 307, 308]);

/** A site-relative or www URL that names a page by its .html (or /index.html) file. */
function isHtmlFileUrl(value) {
  let s = String(value === undefined || value === null ? '' : value).trim();
  if (s.startsWith(SITE_ORIGIN + '/')) s = s.slice(SITE_ORIGIN.length);
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/src/')) return false;
  return /\.html$/i.test(s.split(/[?#]/)[0]);
}

/**
 * The rules of a Cloudflare Pages _redirects file, in file order.
 * A missing status is 302, as Pages applies it. `rawStatus` keeps the text
 * (e.g. '301!') so an undocumented form is reported, not guessed at.
 */
function parseRedirects(text) {
  const rules = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [source, destination, rawStatus] = line.split(/\s+/);
    const status = rawStatus === undefined ? 302 : (/^\d{3}$/.test(rawStatus) ? Number(rawStatus) : NaN);
    rules.push({ line: i + 1, source, destination, status, rawStatus: rawStatus === undefined ? '' : rawStatus });
  });
  return rules;
}

const isDynamic = (source) => /[*]|\/:[A-Za-z]/.test(source);

/** Pages source pattern -> RegExp: '*' (splat) matches anything, ':name' one path segment. */
function sourceRegExp(source) {
  const re = source.split(/(\*|:[A-Za-z]\w*)/).map((part) => {
    if (part === '*') return '.*';
    if (/^:[A-Za-z]\w*$/.test(part)) return '[^/]+';
    return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp('^' + re + '$');
}

/** The path of a site-relative or www destination ('/intake/?a=b' -> '/intake/'), or null for another host. */
function destinationPath(destination) {
  let d = String(destination);
  if (d.startsWith(SITE_ORIGIN + '/')) d = d.slice(SITE_ORIGIN.length);
  if (!d.startsWith('/') || d.startsWith('//')) return null;
  return d.split(/[?#]/)[0];
}

/** The first rule Pages applies to a request path (top-most match wins). */
function firstMatch(rules, urlPath) {
  return rules.find((r) => r.source && r.source.startsWith('/') && sourceRegExp(r.source).test(urlPath)) || null;
}

/**
 * Problems in a _redirects file, each a string naming the line.
 * @param {string} text            the file
 * @param {Set<string>|null} routes served routes of the build ('/', '/contact', '/blog/'); null skips that check
 * @param {Set<string>|null} files  build-relative files ('intake/index.html'); null skips the 200-target check
 */
function redirectProblems(text, routes = null, files = null) {
  const problems = [];
  const rules = parseRedirects(text);
  rules.forEach((r, i) => {
    const at = `_redirects:${r.line} "${r.source} ${r.destination || ''} ${r.rawStatus}"`.replace(/\s+"$/, '"');
    if (!r.source || !r.destination) { problems.push(`${at}: needs a source and a destination`); return; }
    if (!r.source.startsWith('/')) {
      problems.push(`${at}: Pages _redirects cannot match a host; canonicalise hosts with a Cloudflare Bulk Redirect`);
      return;
    }
    if (!REDIRECT_STATUSES.has(r.status)) {
      problems.push(`${at}: status "${r.rawStatus}" is not one Pages supports (200, 301, 302, 303, 307, 308)`);
      return;
    }
    if (r.source === r.destination) { problems.push(`${at}: redirects to itself`); return; }
    if (!isDynamic(r.source)) {
      const earlier = rules.slice(0, i).find((e) => e.source && e.source.startsWith('/') && isDynamic(e.source) && sourceRegExp(e.source).test(r.source));
      if (earlier) problems.push(`${at}: unreachable, line ${earlier.line} "${earlier.source}" matches it first; move it above that rule`);
    }
    const destPath = destinationPath(r.destination);
    if (r.status === 200) {
      if (files && destPath && !files.has(destPath.replace(/^\//, ''))) problems.push(`${at}: rewrite target is not a built file`);
      return;
    }
    if (destPath === null) return; // another host: not ours to resolve
    if (isHtmlFileUrl(r.destination)) {
      problems.push(`${at}: destination names a .html file; Pages 308s it, a second hop. Use the extensionless URL`);
      return;
    }
    if (/[*:]/.test(destPath)) return; // :splat / :placeholder: resolved per request
    const next = firstMatch(rules, destPath);
    if (next && next.status !== 200 && REDIRECT_STATUSES.has(next.status)) {
      problems.push(`${at}: destination is redirected again by line ${next.line} "${next.source}" (multi-hop); point it at the final URL`);
      return;
    }
    if (routes && !routes.has(destPath) && !(next && next.status === 200)) {
      const hint = routes.has(destPath + '/') ? ` (Pages 308s it to ${destPath}/)` : (routes.has(destPath.replace(/\/$/, '')) ? ` (Pages 308s it to ${destPath.replace(/\/$/, '')})` : '');
      problems.push(`${at}: destination is not a page the build serves with 200${hint}`);
    }
  });
  return problems;
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The <item>s of an RSS 2.0 feed: link, guid (with isPermaLink), pubDate. */
function feedItems(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const link = /<link>([^<]*)<\/link>/.exec(body);
    const guid = /<guid(\s[^>]*)?>([^<]*)<\/guid>/.exec(body);
    const pub = /<pubDate>([^<]*)<\/pubDate>/.exec(body);
    items.push({
      link: link ? decode(link[1].trim()) : null,
      guid: guid ? decode(guid[2].trim()) : null,
      guidIsPermaLink: guid ? !/\bisPermaLink\s*=\s*"false"/.test(guid[1] || '') : null,
      pubDate: pub ? pub[1].trim() : null,
    });
  }
  return items;
}

/**
 * Problems in the blog feed (TECH-05).
 * @param {string} xml
 * @param {object} [opts]
 * @param {Set<string>} [opts.routes]        served routes; each <link> must be one
 * @param {string[]}    [opts.expectedSlugs] the posts the feed must list, in order
 * @param {number}      [opts.max=20]
 */
function feedProblems(xml, { routes = null, expectedSlugs = null, max = 20 } = {}) {
  const problems = [];
  const items = feedItems(xml);
  if (items.length > max) problems.push(`feed has ${items.length} items, more than ${max}`);
  let prev = Infinity;
  items.forEach((it, i) => {
    const at = `feed item ${i + 1} (${it.link || 'no link'})`;
    const t = it.pubDate ? Date.parse(it.pubDate) : NaN;
    if (Number.isNaN(t)) problems.push(`${at}: pubDate missing or unreadable`);
    else {
      if (t > prev) problems.push(`${at}: pubDate ${it.pubDate} is newer than the item before it; the feed must be newest first`);
      prev = t;
    }
    if (!it.link || !it.link.startsWith(SITE_ORIGIN + '/')) problems.push(`${at}: <link> is not a ${SITE_ORIGIN} URL`);
    else {
      if (isHtmlFileUrl(it.link)) problems.push(`${at}: <link> names a .html file, which 308s; use the extensionless URL`);
      if (routes && !routes.has(it.link.slice(SITE_ORIGIN.length))) problems.push(`${at}: <link> is not a built page`);
    }
    if (it.guid === null) problems.push(`${at}: no <guid>`);
    else if (it.guidIsPermaLink && it.guid !== it.link) problems.push(`${at}: permalink <guid> ${it.guid} differs from <link>; keep the old guid string with isPermaLink="false"`);
  });
  if (expectedSlugs) {
    const got = items.map((it) => (it.link || '').replace(SITE_ORIGIN + '/blog/', ''));
    const want = expectedSlugs.slice(0, max);
    if (got.join('\n') !== want.join('\n')) {
      const firstDiff = want.findIndex((s, i) => got[i] !== s);
      problems.push(`feed lists [${got.slice(0, 3).join(', ')}, ...] (${got.length}); expected the ${want.length} newest posts [${want.slice(0, 3).join(', ')}, ...]${firstDiff >= 0 ? `, first difference at item ${firstDiff + 1}: ${got[firstDiff] || 'none'} vs ${want[firstDiff]}` : ''}`);
    }
  }
  return problems;
}

// ─── Internal links that redirect (TECH-02) ─────────────────

const ATTR_RE = /\b(?:href|src|action|formaction|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const LD_RE = /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ABS_RE = /https:\/\/www\.thewayagency\.com\/[^\s"'<>)\\]*/g;
const MD_LINK_RE = /\]\((\/[^)\s]*)\)/g;
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
};

/**
 * Every internal URL in a page that names a page by its .html (or /index.html)
 * file: attribute values (href, src, action, formaction, content), JSON-LD
 * strings, and absolute www URLs anywhere (share links, copy-link scripts).
 * Plain-text relative paths are not links and are not reported. Pages 308s
 * each of these to the extensionless URL, so each is a redirect hop.
 * @param {string} html
 * @param {{skip?: Array<[number, number]>}} [opts] character ranges to ignore
 *   (start inclusive, end exclusive), e.g. a <main> that waits on an owner sign-off
 * @returns {Array<{kind: 'attr'|'jsonld'|'absolute', url: string, index: number}>}
 */
function htmlFileUrlsInHtml(html, { skip = [] } = {}) {
  const src = String(html);
  const skipped = (i) => skip.some(([a, b]) => i >= a && i < b);
  const hits = [];
  for (const m of src.matchAll(ATTR_RE)) {
    const v = m[1] !== undefined ? m[1] : m[2];
    if (isHtmlFileUrl(v) && !skipped(m.index)) hits.push({ kind: 'attr', url: v, index: m.index });
  }
  for (const m of src.matchAll(LD_RE)) {
    if (skipped(m.index)) continue;
    let d;
    try { d = JSON.parse(m[1]); } catch { continue; }
    for (const s of strings(d)) if (isHtmlFileUrl(s)) hits.push({ kind: 'jsonld', url: s, index: m.index });
  }
  // Absolute URLs not already reported as an attribute value or inside JSON-LD.
  const ldRanges = [...src.matchAll(LD_RE)].map((m) => [m.index, m.index + m[0].length]);
  const attrRanges = [...src.matchAll(ATTR_RE)].map((m) => [m.index, m.index + m[0].length, m[1] !== undefined ? m[1] : m[2]]);
  for (const m of src.matchAll(ABS_RE)) {
    if (!isHtmlFileUrl(m[0]) || skipped(m.index)) continue;
    if (ldRanges.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (attrRanges.some(([a, b, v]) => m.index >= a && m.index < b && v === m[0])) continue;
    hits.push({ kind: 'absolute', url: m[0], index: m.index });
  }
  return hits;
}

/** The same for a text file (llms.txt, llms-full.txt): absolute www URLs, attribute values and markdown link targets. */
function htmlFileUrlsInText(text) {
  const src = String(text);
  const hits = [];
  for (const m of src.matchAll(ABS_RE)) if (isHtmlFileUrl(m[0])) hits.push({ kind: 'absolute', url: m[0], index: m.index });
  for (const m of src.matchAll(ATTR_RE)) {
    const v = m[1] !== undefined ? m[1] : m[2];
    if (isHtmlFileUrl(v) && !v.startsWith(SITE_ORIGIN)) hits.push({ kind: 'attr', url: v, index: m.index });
  }
  for (const m of src.matchAll(MD_LINK_RE)) if (isHtmlFileUrl(m[1])) hits.push({ kind: 'markdown', url: m[1], index: m.index });
  return hits;
}

/** [start, end) of the first <main>...</main> element, or null. */
function mainRange(html) {
  const src = String(html);
  const a = src.search(/<main[\s>]/i);
  if (a < 0) return null;
  const close = src.indexOf('</main>', a);
  return [a, close < 0 ? src.length : close + '</main>'.length];
}

module.exports = {
  isHtmlFileUrl, parseRedirects, redirectProblems, sourceRegExp, feedItems, feedProblems,
  htmlFileUrlsInHtml, htmlFileUrlsInText, mainRange,
};
