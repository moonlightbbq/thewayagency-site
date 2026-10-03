/**
 * Where a blog post's mid-post quote CTA goes (AEO-04, content-accuracy
 * WP-A7a): below section 3, never between a heading and its answer.
 *
 * - 4 or more H2s: immediately before the 4th H2;
 * - exactly 3: after the first block (paragraph, list or div) that follows the
 *   3rd H2, or at the end when none does;
 * - fewer than 3: nowhere (-1).
 *
 * H2s are matched as `<h2` followed by a space or `>`, since generateTOC() may
 * have added id attributes. Dependency-free.
 */
'use strict';

/** Character offset in `html` at which to insert the CTA, or -1 for none. */
function midPostCtaOffset(html) {
  const text = String(html || '');
  const starts = [];
  const h2 = /<h2[\s>]/g;
  let m;
  while ((m = h2.exec(text)) !== null) starts.push(m.index);
  if (starts.length >= 4) return starts[3];
  if (starts.length < 3) return -1;
  const close = text.indexOf('</h2>', starts[2]);
  if (close < 0) return -1;
  const block = /<\/(?:p|ul|ol|div)>/g;
  block.lastIndex = close + '</h2>'.length;
  const end = block.exec(text);
  return end ? end.index + end[0].length : text.length;
}

module.exports = { midPostCtaOffset };
