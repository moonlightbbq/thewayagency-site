/**
 * The CSS minifier must keep calc() valid (PERF-03, above-the-fold spec Step 1.1).
 *
 * minifyCss() used to strip the whitespace around '+', so `calc(100% + 8px)` shipped
 * as `calc(100%+8px)`. Chrome drops such a declaration: the desktop dropdown offset,
 * the mobile menu's padding, the step connector lines and the product sidebar's
 * sticky offset all silently fell back. The inlined critical.css hid part of it.
 * calc(), min(), max() and clamp() need whitespace on both sides of a binary + or -.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { minifyCss } = require('../scripts/builders/assets');

const CSS_DIR = path.join(__dirname, '..', 'src', 'css');

// Replace var(...)/env(...) (nested parens included) with a placeholder so the hyphens
// in custom-property names are not mistaken for minus signs.
function stripVarEnv(expr) {
  let out = '';
  for (let i = 0; i < expr.length; i++) {
    const m = /^(?:var|env)\(/.exec(expr.slice(i));
    if (!m) { out += expr[i]; continue; }
    let depth = 0, j = i + m[0].length - 1;
    for (; j < expr.length; j++) {
      if (expr[j] === '(') depth++;
      else if (expr[j] === ')' && --depth === 0) break;
    }
    out += 'V';
    i = j;
  }
  return out;
}

// Every math-function expression (calc/min/max/clamp), with its own parentheses.
function mathExpressions(css) {
  const found = [];
  const re = /\b(?:calc|min|max|clamp)\(/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    let depth = 0, j = m.index + m[0].length - 1;
    for (; j < css.length; j++) {
      if (css[j] === '(') depth++;
      else if (css[j] === ')' && --depth === 0) break;
    }
    found.push(css.slice(m.index, j + 1));
  }
  return found;
}

// A binary + must be ` + `. A - glued to the value before it (`100%-8px`) is invalid,
// and so is a value followed by a negative number with no operator between them
// (`100% -8px`). A negative operand after an operator, `(` or `,` is fine (`2 * -1`).
function badOperators(expr) {
  const e = stripVarEnv(expr);
  const problems = [];
  if (/\S\+|\+\S/.test(e)) problems.push('+ without whitespace on both sides');
  if (/[^\s(,*/]-/.test(e)) problems.push('- glued to the value before it');
  if (/[^\s(,*/+-]\s+-\S/.test(e)) problems.push('value followed by a negative number with no operator');
  return problems;
}

describe('minifyCss keeps math functions valid', () => {
  test('keeps the spaces around + and - inside calc()', () => {
    assert.equal(minifyCss('a{top:calc(100% + 8px)}'), 'a{top:calc(100% + 8px)}');
    assert.equal(minifyCss('a { width : calc( 100% - 72px + var(--gap) ) ; }'), 'a{width:calc( 100% - 72px + var(--gap) )}');
    assert.equal(
      minifyCss('.n{padding:var(--a) 0 calc(var(--b) + env(safe-area-inset-bottom, 0px))}'),
      '.n{padding:var(--a) 0 calc(var(--b) + env(safe-area-inset-bottom,0px))}',
    );
  });

  test('a calc() split across lines keeps its spaces (newlines become a space, never nothing)', () => {
    assert.equal(minifyCss('a{top:calc(100%\n+ 8px)}'), 'a{top:calc(100% + 8px)}');
    assert.equal(minifyCss('a{top:calc(100%\n-\n8px)}'), 'a{top:calc(100% - 8px)}');
  });

  test('the + sibling combinator stays valid', () => {
    assert.equal(minifyCss('.a + .b { color: red; }'), '.a + .b{color:red}');
  });

  test('still strips comments, trailing semicolons and the whitespace around { } : ; , > ~', () => {
    assert.equal(
      minifyCss('/* c */\n.a > .b ,\n.c ~ .d {\n  color : red ;\n  margin : 0 ;\n}\n'),
      '.a>.b,.c~.d{color:red;margin:0}',
    );
  });

  test('the helpers in this file flag the old minifier output', () => {
    assert.deepEqual(badOperators('calc(100%+var(--space-sm))'), ['+ without whitespace on both sides']);
    assert.deepEqual(badOperators('calc(100% - 72px+var(--space-2xl))'), ['+ without whitespace on both sides']);
    assert.ok(badOperators('calc(100%-8px)').length > 0);
    assert.deepEqual(badOperators('calc(100% - var(--space-xl) * 2)'), []);
    assert.deepEqual(badOperators('calc(var(--scroll-y,0) * -1)'), []);
  });

  for (const file of fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))) {
    test(`every calc/min/max/clamp in minified ${file} has whitespace around binary + and -`, () => {
      const min = minifyCss(fs.readFileSync(path.join(CSS_DIR, file), 'utf8'));
      for (const expr of mathExpressions(min)) {
        assert.deepEqual(badOperators(expr), [], `${file}: ${expr}`);
      }
    });
  }
});
