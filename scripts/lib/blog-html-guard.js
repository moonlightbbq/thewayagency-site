'use strict';
/**
 * The blog HTML guard (sage-server BL-54, AIA-089): a built blog page runs no
 * script it was not built with.
 *
 * AI-written posts reach this site as markdown, committed to main by SAGE's
 * publish step and rendered by scripts/generate-blog.js on the domain that
 * hosts the intake forms, under a CSP that still allows 'unsafe-inline'. The
 * renderer is the first control (its link-scheme allowlist and its encoding of
 * every front-matter value). This is the second: it reads what was actually
 * built and refuses
 *
 *   - "javascript:" anywhere in the page, in any case;
 *   - any event-handler attribute (on*) on any element. The template has none
 *     (the Copy Link button is wired by src/js/app.js), so any one is foreign;
 *   - an attribute value that, decoded once as the browser decodes it, is a
 *     javascript: or vbscript: URL (entity-encoded or with tabs and newlines
 *     inside the scheme), or a data: URL in a link or form target.
 *
 * Attributes are found by an HTML-tokenizer walk, not a text search, so a
 * neutralized injection inside an escaped value (alt="a&quot; onerror=&quot;x")
 * is not mistaken for an attribute, and one a text search would miss
 * (<a/onclick=x>, a newline before the name, a '>' inside a quoted value) is
 * found. Script, style, title and textarea contents are text, not tags.
 *
 * scripts/build.js runs it over build/blog/*.html and throws, because
 * Cloudflare Pages runs that file and SAGE's publish commits skip CI: a failure
 * keeps the last good deploy live. scripts/validate-build.js (CI) runs it too.
 * Dependency-free: CI's safe-build job runs without npm ci.
 */

const RAW_TEXT_ELEMENTS = ['script', 'style', 'title', 'textarea'];
const LINK_ATTRIBUTES = ['href', 'xlink:href', 'action', 'formaction'];
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

/** The URL scheme a browser would act on: ASCII whitespace and controls removed, lower case. */
function schemeOf(value) {
  const s = decodeOnce(value).replace(/[\u0000- \u007f]/g, '').toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(s);
  return m ? m[1] : null;
}

/**
 * Every start tag in the page with its attributes, by a walk that follows the
 * HTML tokenizer's rules for tag and attribute boundaries.
 * @returns {Array<{tag:string, attrs:Array<{name:string, value:string|null}>, at:number}>}
 */
function startTags(html) {
  const s = String(html === undefined || html === null ? '' : html);
  const lower = s.toLowerCase();
  const tags = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s[lt + 1] === '!' || s[lt + 1] === '?' || s[lt + 1] === '/') {
      const end = s.indexOf('>', lt + 1);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (!/[a-zA-Z]/.test(s[lt + 1] || '')) { i = lt + 1; continue; }
    let j = lt + 1;
    while (j < s.length && !/[\s/>]/.test(s[j])) j++;
    const tag = s.slice(lt + 1, j).toLowerCase();
    const attrs = [];
    while (j < s.length) {
      while (j < s.length && /[\s/]/.test(s[j])) j++;
      if (j >= s.length || s[j] === '>') break;
      let k = j + 1; // the first character may be '=' (it is then part of the name)
      while (k < s.length && !/[\s/>=]/.test(s[k])) k++;
      const name = s.slice(j, k).toLowerCase();
      j = k;
      while (j < s.length && /\s/.test(s[j])) j++;
      let value = null;
      if (s[j] === '=') {
        j++;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === '"' || s[j] === "'") {
          const q = s[j];
          const end = s.indexOf(q, j + 1);
          value = s.slice(j + 1, end < 0 ? s.length : end);
          j = end < 0 ? s.length : end + 1;
        } else {
          let e = j;
          while (e < s.length && !/[\s>]/.test(s[e])) e++;
          value = s.slice(j, e);
          j = e;
        }
      }
      attrs.push({ name, value });
    }
    tags.push({ tag, attrs, at: lt });
    i = j + 1;
    if (RAW_TEXT_ELEMENTS.includes(tag)) {
      const close = lower.indexOf(`</${tag}`, i);
      i = close < 0 ? s.length : close;
    }
  }
  return tags;
}

/**
 * Why a built blog page could run script it was not built with: one sentence
 * per problem, prefixed with the page. [] when it is clean.
 * @param {string} html
 * @param {string} rel  the page, for the message (blog/<slug>.html)
 * @returns {string[]}
 */
function blogHtmlProblems(html, rel = 'blog page') {
  const s = String(html === undefined || html === null ? '' : html);
  const problems = [];
  const raw = /javascript:/i.exec(s);
  if (raw) problems.push(`${rel}: "javascript:" in the page (at character ${raw.index})`);
  for (const t of startTags(s)) {
    for (const a of t.attrs) {
      if (/^on/.test(a.name)) {
        problems.push(`${rel}: <${t.tag}> has an event-handler attribute ${a.name}= (blog pages carry none; src/js/app.js wires the template's buttons)`);
        continue;
      }
      if (a.value === null) continue;
      const scheme = schemeOf(a.value);
      if (scheme === 'javascript' || scheme === 'vbscript') {
        problems.push(`${rel}: <${t.tag} ${a.name}> is a ${scheme}: URL`);
      } else if (scheme === 'data' && LINK_ATTRIBUTES.includes(a.name)) {
        problems.push(`${rel}: <${t.tag} ${a.name}> is a data: URL`);
      }
    }
  }
  return problems;
}

module.exports = { blogHtmlProblems, startTags, decodeOnce, schemeOf };
