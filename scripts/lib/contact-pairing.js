'use strict';
/**
 * Call-and-text pairing lint (CONV-04; docs/CONTENT_RULES.md rule 3).
 *
 * Every tel: link must have an sms: link as a peer, and both must point at the
 * agency's one verified number. Third-party numbers (1-800-MEDICARE, the SHIP
 * line, carrier claims lines) are plain text, never tel: links, so any other
 * number fails too. An sms: link never carries a prefilled body (GTM's
 * text_click sends link_url to GA4).
 *
 * Dependency-free on purpose: CI's safe-build job runs validate-build.js on
 * Node 18 without `npm ci`, so this cannot use jsdom. It is a small HTML
 * tokenizer that tracks element nesting (not a regex over links): comments and
 * the contents of <script>, <style> and <textarea> are skipped, void and
 * self-closing elements never open a scope, and an open <p> or <li> is closed
 * implicitly the way browsers close it.
 *
 * A tel: link is paired when an sms: link sits inside its parent or its
 * grandparent element.
 */

const AGENCY_NUMBER = '+15024135335';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
// Start tags that close an open <p> (HTML "close a p element" list, trimmed).
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);

function attr(attrs, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i').exec(attrs);
  if (!m) return null;
  return (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]).replace(/&amp;/g, '&');
}

function decodeText(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&middot;/g, '·')
    .replace(/&#\d+;|&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Visible text between `from` and `to`, last 40 characters. A window that
// starts inside a tag skips to that tag's end first.
function textBefore(html, from, to) {
  let chunk = html.slice(from, to);
  const lt = chunk.indexOf('<');
  const gt = chunk.indexOf('>');
  if (gt >= 0 && (lt < 0 || gt < lt)) chunk = chunk.slice(gt + 1);
  return decodeText(chunk).slice(-40);
}

/**
 * Parse every <a href="tel:|sms:"> with its ancestor chain.
 * Returns [{ scheme, href, line, chain, text, before }] where chain is the list
 * of open element ids (outermost first) when the <a> started.
 */
function contactAnchors(html) {
  const out = [];
  const stack = []; // { tag, id }
  let nextId = 1;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let m;
  let open = null; // the tel/sms anchor whose text is being collected
  const lineAt = (idx) => html.slice(0, idx).split('\n').length;
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith('<!--')) continue;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (closing) {
      if (tag === 'a' && open) {
        open.text = decodeText(html.slice(open._start, m.index));
        delete open._start;
        open = null;
      }
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    if (RAW_TEXT.has(tag)) {
      const end = html.toLowerCase().indexOf('</' + tag, re.lastIndex);
      re.lastIndex = end < 0 ? html.length : end;
      continue;
    }
    if (stack.length && stack[stack.length - 1].tag === 'p' && CLOSES_P.has(tag)) stack.pop();
    if (tag === 'li' && stack.length && stack[stack.length - 1].tag === 'li') stack.pop();
    if (tag === 'a') {
      const href = (attr(attrs, 'href') || '').trim();
      const scheme = /^tel:/i.test(href) ? 'tel' : /^sms:/i.test(href) ? 'sms' : null;
      if (scheme) {
        const parentStart = stack.length ? stack[stack.length - 1].start : 0;
        const rec = {
          scheme, href, line: lineAt(m.index), chain: stack.map((s) => s.id),
          before: textBefore(html, Math.max(parentStart, m.index - 400), m.index),
          text: '', _start: re.lastIndex,
        };
        out.push(rec);
        open = rec;
      }
    }
    if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
    stack.push({ tag, id: nextId++, start: re.lastIndex });
  }
  for (const r of out) if (r._start !== undefined) { r.text = ''; delete r._start; }
  return out;
}

function numberOf(href) {
  return href.replace(/^(tel|sms):/i, '').split('?')[0].replace(/[\s().-]/g, '');
}

function matches(ex, p) {
  if (ex.rule !== p.rule) return false;
  if (ex.page instanceof RegExp ? !ex.page.test(p.file) : ex.page !== p.file) return false;
  if (ex.href && ex.href !== p.href) return false;
  if (ex.before && !p.before.endsWith(ex.before)) return false;
  if (ex.text && p.text !== ex.text) return false;
  return true;
}

/**
 * All pairing problems in one HTML document.
 * opts.file: the page path (build-relative, '/' separators) used for exemptions.
 * opts.exemptions: [{ page, rule: 'unpaired'|'number'|'sms-body', href?, before?, text?, decision, reason }]
 * opts.usedExemptions: optional Set; every exemption that suppressed a problem is added.
 * Returns [{ rule, file, line, href, before, text, message }].
 */
function findContactLinkProblems(html, opts = {}) {
  const file = opts.file || '';
  const exemptions = opts.exemptions || [];
  const anchors = contactAnchors(html);
  const smsScopes = new Set();
  for (const a of anchors) if (a.scheme === 'sms') for (const id of a.chain) smsScopes.add(id);
  const problems = [];
  const add = (rule, a, message) => {
    const p = { rule, file, line: a.line, href: a.href, before: a.before, text: a.text, message };
    const ex = exemptions.find((e) => matches(e, p));
    if (!ex) problems.push(p);
    else if (opts.usedExemptions) opts.usedExemptions.add(ex);
  };
  for (const a of anchors) {
    if (numberOf(a.href) !== AGENCY_NUMBER) {
      add('number', a, `${a.scheme}: link to a number other than ${AGENCY_NUMBER} (${a.href}); third-party numbers are plain text`);
    }
    if (a.scheme === 'sms' && /[?&]body=/i.test(a.href)) add('sms-body', a, `sms: link prefills a body (${a.href})`);
    if (a.scheme === 'tel') {
      const parent = a.chain[a.chain.length - 1];
      const grand = a.chain[a.chain.length - 2];
      if (!smsScopes.has(parent) && !(grand !== undefined && smsScopes.has(grand))) {
        add('unpaired', a, `tel: link without an sms: peer in its parent or grandparent ("${a.before} [${a.text}]")`);
      }
    }
  }
  return problems;
}

/** The spec's name: only the unpaired tel: links. */
function findUnpairedTelLinks(html, opts = {}) {
  return findContactLinkProblems(html, opts).filter((p) => p.rule === 'unpaired');
}

module.exports = { AGENCY_NUMBER, contactAnchors, findContactLinkProblems, findUnpairedTelLinks };
