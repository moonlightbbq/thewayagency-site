/**
 * The portal page only ever sends SAGE a token-shaped token.
 *
 * src/portal.html reads ?t= and puts it in the path of every request it makes
 * to SAGE (/api/portal/<t>, /verify, /partial, /upload ...). It used to use the
 * raw value, so a crafted link re-aimed those requests at any SAGE path from
 * the visitor's own browser: /portal?t=..%2F..%2Fadmin fetched SAGE's /admin.
 * That is one of SAGE's decoy routes, and a hit there blocks the visitor's IP
 * address for 24 hours. A single redirect to such a link from any web page
 * would have locked a whole office (one shared IP) out of SAGE for a day.
 *
 * Extracts portalToken() from the page source and runs it; also checks the
 * resulting request path with the URL parser.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'portal.html'), 'utf8');
const start = src.indexOf('function portalToken(');
const end = src.indexOf('\n}\n', start) + 3;
const portalToken = vm.runInNewContext(`(${src.slice(start, end)})`);

/** The path and query SAGE would receive for a given ?t= value, or null when the page sends nothing. */
function requestFor(query) {
  const token = portalToken(new URLSearchParams(query).get('t'));
  if (!token) return null;
  const u = new URL('https://sage.example.test/api/portal/' + token);
  return u.pathname + u.search;
}

test('portalToken() is found in the page, and TOKEN is taken from it', () => {
  assert.ok(start > 0 && end > start, 'portalToken() not found in src/portal.html');
  assert.match(src, /const TOKEN = portalToken\(params\.get\('t'\)\);/);
  assert.doesNotMatch(src, /const TOKEN = params\.get\('t'\)/);
});

test('a real link works: the UUID SAGE issues, and older hex or base64url tokens', () => {
  const uuid = '3f2c1a9e-7b4d-4c2a-9e1f-0a1b2c3d4e5f';
  assert.equal(requestFor('t=' + uuid), '/api/portal/' + uuid);
  assert.equal(portalToken('a'.repeat(64)), 'a'.repeat(64));
  assert.equal(portalToken('Zm9vYmFyLWJhel9xdXg'), 'Zm9vYmFyLWJhel9xdXg');
});

test('a value that would re-aim the request is no token at all', () => {
  for (const q of [
    't=..%2F..%2Fadmin', // -> /admin
    't=..%2F..%2F.env',
    't=../../admin',
    't=x%2F..%2F..%2F..%2Fadmin',
    't=%2e%2e%2f%2e%2e%2fadmin',
    't=x%3Fu%3Dlocalhost', // adds a query
    't=x%23frag',
    't=x%5C..%5Cadmin', // backslashes
    't=x%0d%0aHeader',
    't=x y',
    't=x%25252e',
    't=short',
    't=' + 'a'.repeat(129),
    't=',
    'other=1',
  ]) {
    assert.equal(requestFor(q), null, q);
  }
});

test('non-strings are refused', () => {
  for (const v of [null, undefined, 42, {}, ['3f2c1a9e-7b4d-4c2a-9e1f-0a1b2c3d4e5f']]) assert.equal(portalToken(v), null);
});

test('every request to SAGE in the page is built from TOKEN, never from the raw parameter', () => {
  const uses = src.match(/SAGE_API \+ '\/api\/portal\/' \+ [A-Za-z_.()' ]+/g) || [];
  assert.ok(uses.length >= 6, 'expected the six portal requests');
  for (const u of uses) assert.match(u, /\+ TOKEN\b/, u);
  assert.equal((src.match(/params\.get\('t'\)/g) || []).length, 1, "?t= is read in one place only");
});
