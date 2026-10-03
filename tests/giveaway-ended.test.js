'use strict';
// TRUST-09: the Forrest Frank giveaway's entry period ended 2026-07-24 11:59 PM ET.
// The page must show that it has ended and must not collect entries any more
// (SAGE answers 410 Gone to late entries; sage-server PR "TRUST-09: closed
// giveaway returns 410"). Reads the source page only; never builds.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'src', 'pages', 'forrest-frank-2026.html');
const html = fs.readFileSync(PAGE, 'utf8');

test('giveaway page says the giveaway has ended', () => {
  assert.match(html, /This giveaway has <span>ended<\/span>\./);
  assert.match(html, /no longer accepting entries/);
});

test('giveaway page has no entry form, entry script or Turnstile', () => {
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /giveawayForm/);
  assert.doesNotMatch(html, /api\/intake\/giveaway/);
  assert.doesNotMatch(html, /challenges\.cloudflare\.com\/turnstile/);
  assert.doesNotMatch(html, /Enter the Giveaway/);
});

test('giveaway page stays noindex', () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});

test('every call link on the giveaway page has a text link to the same number', () => {
  const tel = (html.match(/href="tel:\+15024135335"/g) || []).length;
  const sms = (html.match(/href="sms:\+15024135335"/g) || []).length;
  assert.ok(tel >= 1);
  assert.strictEqual(sms, tel);
  assert.deepStrictEqual(html.match(/href="(?:tel|sms):(?!\+15024135335")[^"]*"/g), null);
});
