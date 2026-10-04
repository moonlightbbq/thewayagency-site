'use strict';
/**
 * The blog HTML guard (sage-server BL-54, AIA-089): a built blog page runs no
 * script it was not built with.
 *
 * AI-written posts reach this site as markdown, committed to main by SAGE's
 * publish step and rendered by scripts/generate-blog.js on the domain that
 * hosts the intake forms, under a CSP that still allows 'unsafe-inline'. The
 * renderer is the first control (its link-scheme allowlist and its encoding of
 * every front-matter value), and blog-content-guard.js refuses a post whose
 * text says "javascript:" before SAGE commits it or the site renders it. This
 * is the last one: it reads what was actually built and refuses
 *
 *   - "javascript:" anywhere in the page, in any case;
 *   - any event-handler attribute (on*) and any srcdoc attribute, on any
 *     element. The template has none (the Copy Link button is wired by
 *     src/js/app.js), so any one is foreign;
 *   - an attribute value that, decoded once as the browser decodes it, is a
 *     javascript: or vbscript: URL (entity-encoded, or with a tab or newline
 *     inside the scheme, or leading controls), or a data: URL in a link,
 *     form or object target;
 *   - inside the post's <article>, any element that runs or loads active
 *     content or posts a form (ARTICLE_ACTIVE). The generator emits none of
 *     them there (ARTICLE_ACTIVE_ALLOWED is empty); the template's own
 *     scripts sit outside the article. A page with no <article> is checked
 *     whole, because the guard cannot tell its post from its template, except
 *     the blog listing (index.html, { listing: true }): it carries no post
 *     text, only encoded calendar titles and descriptions, and its own filter
 *     script sits in its <main>.
 *
 * The page is read by a walk that follows the HTML tokenizer's rules for tags,
 * attributes and comments (WHATWG HTML 13.2.5): attributes split on HTML
 * whitespace only, a quoted value may hold '>', end tags carry attributes,
 * and a comment ends at "<!-->", "<!--->", "-->" or "--!>". Whether an
 * element's content is markup or text depends on where it sits (<title> and
 * <style> are text in HTML but markup inside <svg>; <noscript> is text only
 * when scripting is on), so the page is walked twice and both readings must
 * be clean:
 *   1. every element's content as markup (<svg><title>, <textarea>, a
 *      scripting-off <noscript>, <xmp>);
 *   2. the HTML elements whose content is text, as text, with scripting on
 *      (script, style, xmp, iframe, noembed, noframes, noscript, title,
 *      textarea; plaintext to the end), which is where a "</noscript>" inside
 *      an attribute value ends the element early.
 * Reading 1 can refuse markup a browser shows as text (an <img onerror> typed
 * inside <textarea>): the guard fails closed. tests/blog-html-guard.test.js
 * checks it against jsdom, both ways.
 *
 * Why not a real parser: scripts/build.js and validate-build.js run where
 * Cloudflare builds and in CI's safe-build job, on Node 18 without npm ci.
 * jsdom needs Node 20.19 or later and parse5 8 is ESM-only, so neither can be
 * required there. Dependency-free on purpose.
 *
 * scripts/build.js runs it over build/blog/*.html and throws, because
 * Cloudflare Pages runs that file and SAGE's publish commits skip CI: a failure
 * keeps the last good deploy live. scripts/validate-build.js (CI) runs it too.
 */

// HTML whitespace (13.2.5): only these end a tag name or separate attributes.
const WS = /[\t\n\f\r ]/;
const WS_OR = (extra) => new RegExp(`[\\t\\n\\f\\r ${extra}]`);
const NAME_END = WS_OR('/>');
const ATTR_NAME_END = WS_OR('/>=');
const BETWEEN_ATTRS = WS_OR('/');
const UNQUOTED_END = WS_OR('>');
const ALPHA = /[a-zA-Z]/;

// HTML elements whose content the tokenizer reads as text (scripting on).
const RAW_TEXT_ELEMENTS = ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'title', 'textarea'];
// Attributes whose value a browser navigates to, submits to or loads as a document.
const LINK_ATTRIBUTES = ['href', 'xlink:href', 'action', 'formaction', 'data'];
// Elements that run or load active content, or post a form.
const ARTICLE_ACTIVE = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'form', 'base', 'meta', 'link'];
// Of those, the ones scripts/generate-blog.js puts inside a post's <article>: none.
const ARTICLE_ACTIVE_ALLOWED = [];
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', nbsp: ' ', sol: '/', lpar: '(', rpar: ')', period: '.', comma: ',', semi: ';', equals: '=', excl: '!', num: '#' };

/** An attribute value as the browser reads it: character references decoded once. */
function decodeOnce(value) {
  return String(value).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);?/g, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()];
    return named === undefined ? m : named;
  });
}

/**
 * The URL scheme a browser would act on, as the URL parser reads it: leading
 * and trailing C0 controls and spaces stripped, tabs and newlines removed
 * anywhere, lower case. Any other character (a control inside the word) means
 * there is no scheme.
 */
function schemeOf(value) {
  const s = decodeOnce(value).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '').toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(s);
  return m ? m[1] : null;
}

/** Where a comment that opens at `j` (just after "<!--") ends. */
function _commentEnd(s, j) {
  if (s[j] === '>') return j + 1; // <!-->
  if (s[j] === '-' && s[j + 1] === '>') return j + 2; // <!--->
  const re = /--!?>/g;
  re.lastIndex = j;
  const m = re.exec(s);
  return m ? m.index + m[0].length : s.length;
}

/** The index just after the first '>' at or after `j` (a bogus comment's end). */
function _afterGt(s, j) {
  const e = s.indexOf('>', j);
  return e < 0 ? s.length : e + 1;
}

/** Where raw text started at `i` ends: the '<' of its "</tag" end tag, else the end. */
function _rawTextEnd(lower, tag, i) {
  const re = new RegExp(`</${tag}[\\t\\n\\f\\r />]`, 'g');
  re.lastIndex = i;
  const m = re.exec(lower);
  return m ? m.index : lower.length;
}

/** A tag whose name starts at `j`: its name, attributes and the index after it. */
function _readTag(s, j) {
  let k = j;
  while (k < s.length && !NAME_END.test(s[k])) k++;
  const tag = s.slice(j, k).toLowerCase();
  const attrs = [];
  while (k < s.length) {
    while (k < s.length && BETWEEN_ATTRS.test(s[k])) k++;
    if (k >= s.length || s[k] === '>') break;
    let e = k + 1; // the first character may be '=': it is then part of the name
    while (e < s.length && !ATTR_NAME_END.test(s[e])) e++;
    const name = s.slice(k, e).toLowerCase();
    k = e;
    while (k < s.length && WS.test(s[k])) k++;
    let value = null;
    if (s[k] === '=') {
      k++;
      while (k < s.length && WS.test(s[k])) k++;
      if (s[k] === '"' || s[k] === "'") {
        const end = s.indexOf(s[k], k + 1);
        value = s.slice(k + 1, end < 0 ? s.length : end);
        k = end < 0 ? s.length : end + 1;
      } else {
        let e2 = k;
        while (e2 < s.length && !UNQUOTED_END.test(s[e2])) e2++;
        value = s.slice(k, e2);
        k = e2;
      }
    }
    attrs.push({ name, value });
  }
  return { tag, attrs, next: k + 1 };
}

/**
 * Every start and end tag in the page, with attributes.
 * @param {string} html
 * @param {{rawText?: boolean}} [opts]  rawText: read the RAW_TEXT_ELEMENTS'
 *   content as text (reading 2); else every element's content is markup (reading 1)
 * @returns {Array<{tag:string, attrs:Array<{name:string, value:string|null}>, at:number, end?:true}>}
 */
function tokens(html, { rawText = false } = {}) {
  const s = String(html === undefined || html === null ? '' : html);
  const lower = s.toLowerCase();
  const out = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    const c = s[lt + 1] || '';
    if (s.startsWith('<!--', lt)) { i = _commentEnd(s, lt + 4); continue; }
    if (c === '!' || c === '?') { i = _afterGt(s, lt + 2); continue; } // DOCTYPE, CDATA, bogus comments
    if (c === '/') {
      const c2 = s[lt + 2] || '';
      if (ALPHA.test(c2)) {
        const t = _readTag(s, lt + 2);
        out.push({ tag: t.tag, attrs: t.attrs, at: lt, end: true });
        i = t.next;
      } else {
        i = c2 === '>' ? lt + 3 : _afterGt(s, lt + 2);
      }
      continue;
    }
    if (!ALPHA.test(c)) { i = lt + 1; continue; }
    const t = _readTag(s, lt + 1);
    out.push({ tag: t.tag, attrs: t.attrs, at: lt });
    i = t.next;
    if (rawText) {
      if (t.tag === 'plaintext') break;
      if (RAW_TEXT_ELEMENTS.includes(t.tag)) i = _rawTextEnd(lower, t.tag, i);
    }
  }
  return out;
}

/** Start tags only (reading 1 by default). */
function startTags(html, opts) {
  return tokens(html, opts).filter((t) => !t.end);
}

/**
 * [start, end) of the part of the page that holds the post, in reading 2: its
 * <article>, else the whole page; null for the listing page (no post).
 */
function _postRange(toks, listing) {
  const open = toks.find((t) => !t.end && t.tag === 'article');
  if (!open) return listing ? null : [-1, Infinity];
  const closes = toks.filter((t) => t.end && t.tag === 'article' && t.at > open.at);
  return [open.at, closes.length ? closes[closes.length - 1].at : Infinity];
}

/**
 * Why a built blog page could run script it was not built with: one sentence
 * per problem, prefixed with the page. [] when it is clean.
 * @param {string} html
 * @param {string} rel  the page, for the message (blog/<slug>.html)
 * @param {{listing?: boolean}} [opts]  listing: the blog index page (no post of its own)
 * @returns {string[]}
 */
function blogHtmlProblems(html, rel = 'blog page', { listing = false } = {}) {
  const s = String(html === undefined || html === null ? '' : html);
  const problems = new Set();
  const raw = /javascript:/i.exec(s);
  if (raw) problems.add(`${rel}: "javascript:" in the page (at character ${raw.index})`);
  const asText = tokens(s, { rawText: true });
  const asMarkup = tokens(s);
  const post = _postRange(asText, listing);
  for (const t of [...asMarkup, ...asText]) {
    if (t.end) continue;
    if (post && t.at > post[0] && t.at < post[1] && ARTICLE_ACTIVE.includes(t.tag) && !ARTICLE_ACTIVE_ALLOWED.includes(t.tag)) {
      problems.add(`${rel}: <${t.tag}> ${post[0] < 0 ? 'on a page with no <article> (checked whole)' : 'inside the post\'s <article>'}; the generator puts no ${ARTICLE_ACTIVE.join(', ')} in a post`);
    }
    for (const a of t.attrs) {
      if (/^on/.test(a.name)) {
        problems.add(`${rel}: <${t.tag}> has an event-handler attribute ${a.name}= (blog pages carry none; src/js/app.js wires the template's buttons)`);
        continue;
      }
      if (a.name === 'srcdoc') {
        problems.add(`${rel}: <${t.tag}> has a srcdoc attribute (an inline document)`);
        continue;
      }
      if (a.value === null) continue;
      const scheme = schemeOf(a.value);
      if (scheme === 'javascript' || scheme === 'vbscript') {
        problems.add(`${rel}: <${t.tag} ${a.name}> is a ${scheme}: URL`);
      } else if (scheme === 'data' && LINK_ATTRIBUTES.includes(a.name)) {
        problems.add(`${rel}: <${t.tag} ${a.name}> is a data: URL`);
      }
    }
  }
  return [...problems];
}

module.exports = { blogHtmlProblems, tokens, startTags, decodeOnce, schemeOf, ARTICLE_ACTIVE, ARTICLE_ACTIVE_ALLOWED, RAW_TEXT_ELEMENTS };
