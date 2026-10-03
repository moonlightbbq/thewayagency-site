'use strict';
/**
 * Pipe tables for blog markdown (content-accuracy WP-A2, BLOG-01).
 *
 * markdownToHtml() escapes raw HTML, so before this module no post could show
 * a table: `| a | b |` lines printed as raw pipe text. A table is a header row,
 * a delimiter row (`|---|:---:|---:|`) and any number of body rows, each line
 * starting and ending with `|`. Anything else (a lone pipe line, a header with
 * no delimiter row) is left exactly as it was.
 *
 * The text this module sees has already been HTML-escaped and inline-converted
 * (bold, italic, links), so cell text is safe to print as is. A `|` inside a
 * tag (an href) never splits a cell, and `\|` prints a literal pipe.
 *
 * Output (one block, blank line on each side so the paragraph pass leaves it
 * alone; its skip list already passes blocks that start with `<div`):
 *
 *   <div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table>
 *   <thead><tr><th scope="col">...</th></tr></thead>
 *   <tbody>
 *   <tr><td>...</td></tr>
 *   </tbody>
 *   </table></div>
 *
 * - Alignment colons map to classes ta-c / ta-r (no inline styles: STRICT_CSP).
 * - Short rows are padded with empty cells; extra cells past the header are dropped.
 * - An empty header cell prints as <td></td>, not an empty <th> (axe empty-table-header).
 * - The wrapper scrolls sideways on a narrow screen; tabindex="0" lets a keyboard
 *   user scroll it (axe scrollable-region-focusable).
 *
 * Site-only. Not part of the byte-shared scripts/lib/blog-content-guard.js.
 */

const ROW_RE = /^\|.*\|[ \t]*$/;
const DELIM_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
// Two or more consecutive lines that start and end with a pipe.
const BLOCK_RE = /^\|.*\|[ \t]*(?:\n\|.*\|[ \t]*)+$/gm;

/** The cells of one `| a | b |` line: outer pipes dropped, `|` inside a tag kept, `\|` unescaped. */
function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  let inTag = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '<') inTag = true;
    else if (c === '>') inTag = false;
    if (c === '|' && !inTag) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** '' | 'ta-c' | 'ta-r' for one delimiter cell. */
function alignClass(cell) {
  const t = cell.trim();
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'ta-c';
  if (right) return 'ta-r';
  return '';
}

function cellHtml(tag, text, cls, extra) {
  const attrs = `${extra || ''}${cls ? ` class="${cls}"` : ''}`;
  return `<${tag}${attrs}>${text}</${tag}>`;
}

/**
 * One run of pipe lines as table HTML, or the run unchanged when its second
 * line is not a delimiter row.
 * @param {string} block
 * @returns {string}
 */
function pipeTableBlock(block) {
  const lines = String(block).split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  if (lines.length < 2 || !ROW_RE.test(lines[0]) || !DELIM_RE.test(lines[1])) return block;
  const header = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map(alignClass);
  const width = header.length;
  const fit = (cells) => {
    const out = cells.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  };
  const head = header.map((text, i) => (text
    ? cellHtml('th', text, aligns[i], ' scope="col"')
    : cellHtml('td', '', aligns[i])));
  const body = lines.slice(2).filter((l) => ROW_RE.test(l)).map((l) => `<tr>${fit(splitRow(l)).map((text, i) => cellHtml('td', text, aligns[i])).join('')}</tr>`);
  return [
    '',
    '',
    '<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table>',
    `<thead><tr>${head.join('')}</tr></thead>`,
    '<tbody>',
    ...body,
    '</tbody>',
    '</table></div>',
    '',
  ].join('\n');
}

/** Every pipe table in `text` converted; all other text unchanged. */
function wrapPipeTables(text) {
  return String(text === undefined || text === null ? '' : text).replace(BLOCK_RE, (m) => pipeTableBlock(m));
}

module.exports = { BLOCK_RE, DELIM_RE, splitRow, pipeTableBlock, wrapPipeTables };
