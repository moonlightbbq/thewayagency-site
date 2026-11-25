'use strict';
// Snowball Daddy Daughter Dance giveaway (/snowball-2026). The form posts to
// SAGE /api/intake/giveaway with campaign 'snowball-2026'; SAGE's GIVEAWAYS
// entry closes at 2026-11-30T05:00:00Z (11:59 PM ET Sun 11/29), and the page
// hides its form at the same instant. Reads the source page only; never builds.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'snowball-2026.html'), 'utf8');
const assets = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'builders', 'assets.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');

test('the page is built as a root page and stays noindex', () => {
  assert.match(assets, /'snowball-2026\.html'/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.thewayagency\.com\/snowball-2026">/);
});

test('the form posts the snowball-2026 campaign to the giveaway endpoint', () => {
  assert.match(html, /<form id="giveawayForm"/);
  assert.match(html, /fetch\('https:\/\/sage\.thewayagency\.com\/api\/intake\/giveaway'/);
  assert.match(html, /campaign: 'snowball-2026', page: '\/snowball-2026'/);
  assert.match(html, /onload=_sbTurnstileReady/);
  assert.match(html, /window\._sbTurnstileReady = initTurnstile;/);
});

test('the page uses the site Turnstile key, and the placeholders are filled', () => {
  const page = /var TURNSTILE_KEY = '([^']+)';/.exec(html);
  const site = /turnstileSiteKey: '([^']+)'/.exec(app);
  assert.ok(page && site);
  assert.strictEqual(page[1], site[1]);
  assert.doesNotMatch(html, /__TURNSTILE_SITE_KEY__|<!--NAV-->|<!--FOOTER-->/);
});

test('the page closes at the same instant as SAGE (11:59 PM ET Sun 2026-11-29)', () => {
  assert.match(html, /var CLOSES_AT = Date\.parse\('2026-11-30T05:00:00Z'\);/);
  const t = Date.parse('2026-11-30T05:00:00Z') - 1;
  assert.strictEqual(new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York' }), '11/29/2026, 11:59:59 PM');
  assert.match(html, /Entries must be received by 11:59 PM Eastern Time on Sunday, November 29, 2026\./);
  assert.match(html, /announced on Monday, November 30, 2026/);
});

test('the dates and the prize agree with the event', () => {
  assert.match(html, /Friday, December 4, 2026, from 6:00 PM to 8:00 PM/);
  assert.match(html, /One \(1\) couple ticket/);
  // Sold out (owner, 11/25): no ticket-buying link, and the page says so.
  assert.doesNotMatch(html, /registersbddd|Get tickets from/);
  assert.match(html, /<p class="sb-soldout">.*Sold out<span class="sb-soldout__sep" aria-hidden="true">&middot;<\/span>1 ticket left to win</);
  // ...and says a ticket is still winnable, so sold out never reads as "too late".
  assert.match(html, /Tickets are <strong>sold out<\/strong>, but we're giving one away\. Enter free for your chance to still go\./);
});

test('every call link has a text link to the same number', () => {
  const tel = (html.match(/href="tel:\+15024135335"/g) || []).length;
  const sms = (html.match(/href="sms:\+15024135335"/g) || []).length;
  assert.ok(tel >= 1);
  assert.strictEqual(sms, tel);
  assert.deepStrictEqual(html.match(/href="(?:tel|sms):(?!\+15024135335")[^"]*"/g), null);
});

test('ODT logo and the share card exist and are wired in', () => {
  const img = (f) => path.join(__dirname, '..', 'src', 'assets', 'images', f);
  for (const f of ['partners/odt-logo-gold-white.webp', 'partners/odt-logo-gold-white.png', 'og-snowball-2026-win.jpg']) {
    assert.ok(fs.statSync(img(f)).size > 1000, f);
  }
  assert.match(html, /<source srcset="\/src\/assets\/images\/partners\/odt-logo-gold-white\.webp" type="image\/webp">/);
  assert.match(html, /<img class="sb-odt" src="\/src\/assets\/images\/partners\/odt-logo-gold-white\.png" alt="Owensboro Dance Theatre"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.thewayagency\.com\/src\/assets\/images\/og-snowball-2026-win\.jpg">/);
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/www\.thewayagency\.com\/src\/assets\/images\/og-snowball-2026-win\.jpg">/);
});

test('the countdown starts hidden (no-JS visitors never see zeros) and stops at the close', () => {
  assert.match(html, /<div class="sb-count__wrap" id="sb-count" hidden>/);
  assert.match(html, /if \(left <= 0\) \{ showEnded\(\); return false; \}/);
  assert.match(html, /if \(tick\(\)\) \{\n\s*countEl\.hidden = false;/);
});

test('a confirmed entry keeps its confirmation past the close', () => {
  assert.match(html, /function showEnded\(\) \{\n\s*stopCountdown\(\);\n\s*if \(entered\) return;/);
  assert.match(html, /entered = true;\n\s*stopCountdown\(\);/);
});
