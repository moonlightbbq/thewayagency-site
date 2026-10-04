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
 *   - inside the post, any element or attribute scripts/generate-blog.js does
 *     not put there (POST_ELEMENTS, POST_ATTRIBUTES: allowlists) and any
 *     comment. The post is the
 *     page's <article>; a page with no <article> is all post, because the
 *     guard cannot tell its post from its template, except the blog listing
 *     (index.html, { listing: true }), which carries no post text (only
 *     encoded calendar titles and descriptions) and keeps its own filter
 *     script in its <main>.
 *
 * What is guaranteed, and where. The page is read by a walk that follows the
 * HTML tokenizer's rules for tags, attributes and comments (WHATWG HTML
 * 13.2.5): attributes split on HTML whitespace only, a quoted value may hold
 * '>', end tags carry attributes, a comment ends at "<!-->", "<!--->", "-->"
 * or "--!>". What it cannot follow without a tree builder is where an
 * element's content stops being markup: <title>, <style>, <noscript>, <xmp>
 * and <plaintext> are text in HTML but markup inside <svg> or <math>, and a
 * comment or an open quote inside one shifts everything after it. So:
 *   - Inside the post the allowlists close that class: every element the
 *     generator puts there leaves the tokenizer in its ordinary data state,
 *     and a comment is refused, so the walk reads the post exactly as a
 *     browser does. Whatever a browser would run from the post's own markup
 *     (an on* or srcdoc attribute, a script URL, an element outside the
 *     allowlist) is refused. The attribute allowlist also keeps site scripts
 *     from being turned on the post: a site script that reads a data-*
 *     attribute and writes HTML from it is a gadget (the testimonial carousel
 *     in src/js/app.js wrote [data-testimonials] JSON into innerHTML until
 *     BL-54), and the only data-* attribute allowed in a post is the
 *     generator's data-copy-link, which app.js only copies to the clipboard.
 *     Scripts that find elements by class or id write only their own static
 *     markup. tests/blog-html-guard.test.js checks every review payload
 *     against jsdom, scripting off and on, and the third review's gadget
 *     payloads against src/js/app.js.
 *   - Outside the post (the template the generator owns, where front matter
 *     lands encoded) the page is walked twice and both readings must be
 *     clean: every element's content as markup, then the HTML raw-text
 *     elements (RAW_TEXT_ELEMENTS) as text with scripting on. These readings
 *     are a backstop, not a proof: markup that nests a raw-text element
 *     inside foreign content can mislead both. Nothing a post or a calendar
 *     entry says reaches the template as markup.
 * Either reading can refuse markup a browser shows as text: the guard fails
 * closed.
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
// Every element scripts/generate-blog.js puts inside a post's <article>: the
// markdown renderer (p, h2-h4, strong, em, a, ul, li, blockquote, hr, div and
// span for stat highlights), the template (figure and img for a featured
// image, the byline, share and Copy Link buttons with their svg icons, the
// table of contents, the FAQ, the mid-post CTA, Related Coverage) and the
// Related Articles and local-help blocks added after it. None of them is a
// raw-text, RCDATA or script element, so none changes how what follows is
// tokenized. The 78 pages built on 2026-10-04 use a subset of these.
const POST_ELEMENTS = ['a', 'blockquote', 'button', 'div', 'em', 'figure', 'h2', 'h3', 'h4', 'hr', 'img', 'li', 'nav', 'p', 'path', 'section', 'span', 'strong', 'svg', 'ul'];
// Every attribute the generator puts on those elements inside a post (the 78
// pages built on 2026-10-04 use all but the featured image's src, alt,
// loading and fetchpriority). Lower case, as the tokenizer reports them
// (viewBox is viewbox). Any other attribute is refused, every data-*
// attribute but data-copy-link among them.
//
// Markdown the renderer does not support today, and what supporting it would
// add to these lists in the same change: numbered lists wrapped in <ol>;
// tables (table, thead, tbody, tr, th, td); code (pre, code); hard line
// breaks (br); h5 and h6; images in the body (img with title, srcset is never
// allowed); figcaption; footnotes (sup, a with id and href to #fn-...).
const POST_ATTRIBUTES = ['alt', 'aria-expanded', 'aria-label', 'class', 'd', 'data-copy-link', 'fetchpriority', 'fill', 'height', 'href', 'id', 'loading', 'rel', 'src', 'stroke', 'stroke-width', 'style', 'target', 'type', 'viewbox', 'width'];
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
 * Every start tag, end tag and comment in the page (comments, DOCTYPEs, CDATA
 * and bogus comments as { comment: true, at }).
 * @param {string} html
 * @param {{rawText?: boolean}} [opts]  rawText: read the RAW_TEXT_ELEMENTS'
 *   content as text (reading 2); else every element's content is markup (reading 1)
 * @returns {Array<{tag?:string, attrs?:Array<{name:string, value:string|null}>, at:number, end?:true, comment?:true}>}
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
    if (s.startsWith('<!--', lt)) { out.push({ comment: true, at: lt }); i = _commentEnd(s, lt + 4); continue; }
    if (c === '!' || c === '?') { out.push({ comment: true, at: lt }); i = _afterGt(s, lt + 2); continue; } // DOCTYPE, CDATA, bogus comments
    if (c === '/') {
      const c2 = s[lt + 2] || '';
      if (ALPHA.test(c2)) {
        const t = _readTag(s, lt + 2);
        out.push({ tag: t.tag, attrs: t.attrs, at: lt, end: true });
        i = t.next;
      } else {
        if (c2 !== '>') out.push({ comment: true, at: lt }); // "</" + other: a bogus comment
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
  return tokens(html, opts).filter((t) => !t.end && !t.comment);
}

/**
 * [start, end) of the part of the page that holds the post, in reading 2: its
 * <article>, else the whole page; null for the listing page (no post).
 */
function _postRange(toks, listing) {
  const open = toks.find((t) => !t.end && !t.comment && t.tag === 'article');
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
  const where = post && post[0] < 0 ? 'on a page with no <article> (all post)' : 'inside the post\'s <article>';
  const inPost = (t) => post && t.at > post[0] && t.at < post[1];
  for (const t of [...asMarkup, ...asText]) {
    if (t.end) continue;
    if (t.comment) {
      if (inPost(t)) problems.add(`${rel}: a comment, DOCTYPE or CDATA ${where} at character ${t.at} (the generator writes none in a post)`);
      continue;
    }
    if (inPost(t) && !POST_ELEMENTS.includes(t.tag)) {
      problems.add(`${rel}: <${t.tag}> ${where}; the generator puts only ${POST_ELEMENTS.join(', ')} in a post`);
    }
    if (inPost(t)) {
      for (const a of t.attrs) {
        if (!POST_ATTRIBUTES.includes(a.name)) problems.add(`${rel}: <${t.tag} ${a.name}> ${where}; the generator puts only ${POST_ATTRIBUTES.join(', ')} on elements in a post`);
      }
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

module.exports = { blogHtmlProblems, tokens, startTags, decodeOnce, schemeOf, POST_ELEMENTS, POST_ATTRIBUTES, RAW_TEXT_ELEMENTS };
